---
title: "Azure SQL Database Updates - September 2022"
description: "Azure SQL Database's continuous improvements make it an excellent choice for cloud-native applications requiring robust, scalable database capabilities."
author: "Michael John Peña"
draft: false
date: 2022-09-12
tags: ["Azure", "SQL Database", "Database", "Cloud"]
---

## New Features Overview

### Serverless Tier Enhancements

```sql
-- Create a serverless database with new configurations
CREATE DATABASE MyServerlessDB
(
    EDITION = 'GeneralPurpose',
    SERVICE_OBJECTIVE = 'GP_S_Gen5_2',
    MAXSIZE = 32 GB
);

-- Configure auto-pause delay (minimum 1 hour)
ALTER DATABASE MyServerlessDB
SET AUTO_PAUSE_DELAY = 60; -- minutes

-- Query current serverless status
SELECT
    database_id,
    name,
    state_desc,
    is_auto_pause_enabled,
    auto_pause_delay_in_minutes
FROM sys.databases
WHERE name = 'MyServerlessDB';
```

### Query Store Improvements

```sql
-- Enable Query Store with new options
ALTER DATABASE MyDatabase
SET QUERY_STORE = ON
(
    OPERATION_MODE = READ_WRITE,
    CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = 30),
    DATA_FLUSH_INTERVAL_SECONDS = 900,
    MAX_STORAGE_SIZE_MB = 1000,
    INTERVAL_LENGTH_MINUTES = 60,
    SIZE_BASED_CLEANUP_MODE = AUTO,
    QUERY_CAPTURE_MODE = AUTO,
    MAX_PLANS_PER_QUERY = 200
);

-- Query performance insights from Query Store
SELECT TOP 20
    q.query_id,
    qt.query_sql_text,
    rs.avg_duration / 1000000.0 AS avg_duration_sec,
    rs.avg_cpu_time / 1000000.0 AS avg_cpu_sec,
    rs.avg_logical_io_reads,
    rs.count_executions,
    p.query_plan
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
JOIN sys.query_store_runtime_stats_interval rsi ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
WHERE rsi.start_time > DATEADD(day, -7, GETUTCDATE())
ORDER BY rs.avg_duration DESC;
```

### Intelligent Query Processing

```sql
-- Batch mode on rowstore (no columnstore required)
-- Automatically enabled for compatible queries

-- Memory grant feedback
-- Adjusts memory grants based on actual usage
SELECT /*+ USE_HINT('ENABLE_BATCH_MODE_ON_ROWSTORE') */
    c.CustomerName,
    COUNT(o.OrderID) AS OrderCount,
    SUM(o.TotalAmount) AS TotalSpent
FROM Customers c
JOIN Orders o ON c.CustomerID = o.CustomerID
GROUP BY c.CustomerName
HAVING SUM(o.TotalAmount) > 10000
ORDER BY TotalSpent DESC;

-- Table variable deferred compilation
DECLARE @RecentOrders TABLE (
    OrderID INT,
    CustomerID INT,
    OrderDate DATE,
    TotalAmount DECIMAL(18,2)
);

INSERT INTO @RecentOrders
SELECT OrderID, CustomerID, OrderDate, TotalAmount
FROM Orders
WHERE OrderDate > DATEADD(month, -1, GETDATE());

-- Query optimizer now uses accurate cardinality estimates
SELECT c.CustomerName, ro.TotalAmount
FROM Customers c
JOIN @RecentOrders ro ON c.CustomerID = ro.CustomerID
WHERE ro.TotalAmount > 500;
```

## Performance Optimizations

### Automatic Tuning

```csharp
using Microsoft.Data.SqlClient;

public class AutoTuningManager
{
    private readonly string _connectionString;

    public async Task EnableAutoTuningAsync()
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        // Enable automatic plan correction
        var enableCmd = new SqlCommand(@"
            ALTER DATABASE CURRENT
            SET AUTOMATIC_TUNING (
                FORCE_LAST_GOOD_PLAN = ON,
                CREATE_INDEX = ON,
                DROP_INDEX = ON
            )", connection);

        await enableCmd.ExecuteNonQueryAsync();
    }

    public async Task<List<TuningRecommendation>> GetRecommendationsAsync()
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var query = @"
            SELECT
                reason,
                score,
                JSON_VALUE(details, '$.indexName') AS index_name,
                JSON_VALUE(details, '$.schema') AS schema_name,
                JSON_VALUE(details, '$.table') AS table_name,
                JSON_VALUE(details, '$.indexType') AS index_type,
                script
            FROM sys.dm_db_tuning_recommendations
            WHERE state_desc = 'Active'
            ORDER BY score DESC";

        using var command = new SqlCommand(query, connection);
        using var reader = await command.ExecuteReaderAsync();

        var recommendations = new List<TuningRecommendation>();
        while (await reader.ReadAsync())
        {
            recommendations.Add(new TuningRecommendation
            {
                Reason = reader.GetString(0),
                Score = reader.GetDecimal(1),
                IndexName = reader.IsDBNull(2) ? null : reader.GetString(2),
                SchemaName = reader.IsDBNull(3) ? null : reader.GetString(3),
                TableName = reader.IsDBNull(4) ? null : reader.GetString(4),
                Script = reader.IsDBNull(6) ? null : reader.GetString(6)
            });
        }

        return recommendations;
    }
}

public class TuningRecommendation
{
    public string Reason { get; set; }
    public decimal Score { get; set; }
    public string IndexName { get; set; }
    public string SchemaName { get; set; }
    public string TableName { get; set; }
    public string Script { get; set; }
}
```

### Connection Resiliency

```csharp
public class ResilientDatabaseConnection
{
    public static SqlConnection CreateResilientConnection(string connectionString)
    {
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            ConnectRetryCount = 3,
            ConnectRetryInterval = 10,
            ConnectTimeout = 30,
            ApplicationIntent = ApplicationIntent.ReadWrite,
            MultipleActiveResultSets = true,
            Encrypt = SqlConnectionEncryptOption.Mandatory,
            TrustServerCertificate = false
        };

        return new SqlConnection(builder.ConnectionString);
    }

    public static async Task<T> ExecuteWithRetryAsync<T>(
        SqlConnection connection,
        Func<SqlConnection, Task<T>> operation,
        int maxRetries = 3)
    {
        var retryCount = 0;
        var delay = TimeSpan.FromSeconds(1);

        while (true)
        {
            try
            {
                if (connection.State != ConnectionState.Open)
                    await connection.OpenAsync();

                return await operation(connection);
            }
            catch (SqlException ex) when (IsTransient(ex) && retryCount < maxRetries)
            {
                retryCount++;
                await Task.Delay(delay);
                delay = TimeSpan.FromSeconds(delay.TotalSeconds * 2);

                // Reset connection
                if (connection.State == ConnectionState.Open)
                    await connection.CloseAsync();
            }
        }
    }

    private static bool IsTransient(SqlException ex)
    {
        // Transient error codes
        int[] transientErrors = { 4060, 40197, 40501, 40613, 49918, 49919, 49920, 4221 };
        return transientErrors.Contains(ex.Number);
    }
}
```

### Query Hints and Optimization

```sql
-- Use latest cardinality estimator
SELECT * FROM Orders
WHERE OrderDate > '2022-01-01'
OPTION (USE HINT('FORCE_DEFAULT_CARDINALITY_ESTIMATION'));

-- Disable parameter sniffing for specific query
SELECT * FROM Orders
WHERE CustomerID = @CustomerID
OPTION (RECOMPILE);

-- Force specific join type
SELECT c.CustomerName, o.OrderID
FROM Customers c
INNER HASH JOIN Orders o ON c.CustomerID = o.CustomerID
WHERE o.OrderDate > '2022-01-01';

-- Limit parallelism
SELECT *
FROM LargeTable
WHERE ProcessedDate IS NULL
OPTION (MAXDOP 4);
```

## Monitoring and Diagnostics

```sql
-- Current activity
SELECT
    r.session_id,
    r.status,
    r.command,
    r.wait_type,
    r.wait_time,
    r.cpu_time,
    r.total_elapsed_time,
    r.reads,
    r.writes,
    t.text AS query_text
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id > 50
ORDER BY r.total_elapsed_time DESC;

-- Resource usage
SELECT
    end_time,
    avg_cpu_percent,
    avg_data_io_percent,
    avg_log_write_percent,
    avg_memory_usage_percent,
    max_worker_percent,
    max_session_percent
FROM sys.dm_db_resource_stats
ORDER BY end_time DESC;
```

Azure SQL Database's continuous improvements make it an excellent choice for cloud-native applications requiring robust, scalable database capabilities.
