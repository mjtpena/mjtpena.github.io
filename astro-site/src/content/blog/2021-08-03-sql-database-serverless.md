---
title: "Azure SQL Database Serverless: Auto-Scaling and Auto-Pause for Variable Workloads"
description: "Serverless is perfect for dev/test environments, infrequently used applications, and workloads with predictable quiet periods. For consistent…"
author: "Michael John Peña"
draft: false
date: 2021-08-03
tags: ["Azure", "SQL", "Serverless", "Auto-Scale", "Cost Optimization"]
---

## How Serverless Differs from Provisioned

Unlike provisioned compute tiers where you pay for fixed resources 24/7, serverless:
- Automatically scales compute within a configured range
- Can auto-pause during periods of inactivity
- Bills only for compute used (storage is always billed)

## Creating a Serverless Database

```bash
# Create serverless database with Azure CLI
az sql db create \
    --resource-group myResourceGroup \
    --server myserver \
    --name ServerlessDB \
    --edition GeneralPurpose \
    --compute-model Serverless \
    --family Gen5 \
    --min-capacity 0.5 \
    --capacity 4 \
    --auto-pause-delay 60
```

Using T-SQL:

```sql
-- Create serverless database
CREATE DATABASE ServerlessDB
(
    EDITION = 'GeneralPurpose',
    SERVICE_OBJECTIVE = 'GP_S_Gen5_4',
    MAXSIZE = 32 GB
);

-- Configure auto-pause delay (minutes)
ALTER DATABASE ServerlessDB
SET AUTO_PAUSE_DELAY = 60;
```

## Understanding Auto-Pause Behavior

```csharp
// C# handling for auto-pause warm-up
public class ServerlessDbConnection
{
    private readonly string _connectionString;

    public ServerlessDbConnection(string connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<SqlConnection> GetConnectionAsync()
    {
        var connection = new SqlConnection(_connectionString);

        // Set longer timeout for potential auto-resume
        connection.ConnectionTimeout = 120;

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await connection.OpenAsync();

            if (stopwatch.ElapsedMilliseconds > 10000)
            {
                // Database was likely paused and resumed
                Console.WriteLine($"Database resumed in {stopwatch.ElapsedMilliseconds}ms");
            }

            return connection;
        }
        catch (SqlException ex) when (ex.Number == 40613)
        {
            // Database is resuming, retry with exponential backoff
            return await RetryConnectionAsync();
        }
    }

    private async Task<SqlConnection> RetryConnectionAsync()
    {
        var maxRetries = 5;
        var delay = TimeSpan.FromSeconds(5);

        for (int i = 0; i < maxRetries; i++)
        {
            await Task.Delay(delay);
            delay = TimeSpan.FromSeconds(delay.TotalSeconds * 2);

            try
            {
                var connection = new SqlConnection(_connectionString);
                await connection.OpenAsync();
                return connection;
            }
            catch (SqlException ex) when (ex.Number == 40613)
            {
                continue;
            }
        }

        throw new Exception("Failed to connect after maximum retries");
    }
}
```

## Keeping the Database Warm

For applications that need predictable response times, you can prevent auto-pause:

```python
# Python keep-alive service
import schedule
import time
import pyodbc

def keep_database_warm():
    connection_string = (
        "Driver={ODBC Driver 17 for SQL Server};"
        "Server=myserver.database.windows.net;"
        "Database=ServerlessDB;"
        "Authentication=ActiveDirectoryMsi;"
    )

    try:
        with pyodbc.connect(connection_string, timeout=30) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            print(f"Keep-alive ping successful at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    except Exception as e:
        print(f"Keep-alive failed: {e}")

# Schedule ping every 30 minutes (before 60-min auto-pause)
schedule.every(30).minutes.do(keep_database_warm)

while True:
    schedule.run_pending()
    time.sleep(60)
```

## Monitoring Serverless Costs

```sql
-- Check serverless billing metrics
SELECT
    database_name,
    start_time,
    end_time,
    sku,
    avg_cpu_percent,
    avg_memory_usage_percent,
    avg_instance_cpu_percent,
    DATEDIFF(SECOND, start_time, end_time) AS duration_seconds
FROM sys.server_resource_stats
WHERE database_name = 'ServerlessDB'
ORDER BY end_time DESC;

-- Calculate approximate compute cost
SELECT
    CAST(SUM(
        DATEDIFF(SECOND, start_time, end_time) *
        (avg_cpu_percent / 100.0) *
        vcores
    ) / 3600.0 AS DECIMAL(10,2)) AS approximate_vcore_hours
FROM sys.dm_db_resource_stats
CROSS APPLY (SELECT 4 AS vcores) AS config;
```

## Configuring Min/Max vCores

```bash
# Update serverless configuration
az sql db update \
    --resource-group myResourceGroup \
    --server myserver \
    --name ServerlessDB \
    --min-capacity 1 \
    --capacity 8 \
    --auto-pause-delay 120
```

## Best Practices for Serverless

1. **Set appropriate min vCores**: Higher min reduces resume latency
2. **Configure auto-pause wisely**: Balance cost savings vs. cold start impact
3. **Use connection retry logic**: Always handle resume scenarios
4. **Monitor actual usage**: Ensure workload matches serverless economics

```csharp
// Entity Framework Core with retry policy
services.AddDbContext<MyDbContext>(options =>
{
    options.UseSqlServer(connectionString, sqlOptions =>
    {
        sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: new[] { 40613 }
        );
        sqlOptions.CommandTimeout(120);
    });
});
```

Serverless is perfect for dev/test environments, infrequently used applications, and workloads with predictable quiet periods. For consistent high-utilization workloads, provisioned compute remains more cost-effective.
