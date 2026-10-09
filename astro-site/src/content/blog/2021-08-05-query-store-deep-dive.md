---
title: "Query Store Deep Dive: Your Database's Flight Recorder"
description: "Query Store transforms database performance troubleshooting from guesswork into data-driven analysis, making it an indispensable tool for maintaining…"
author: "Michael John Peña"
draft: false
date: 2021-08-05
tags: ["Azure", "SQL", "Query Store", "Performance", "Monitoring"]
---

## Enabling and Configuring Query Store

```sql
-- Enable Query Store
ALTER DATABASE MyDatabase SET QUERY_STORE = ON;

-- Configure Query Store settings
ALTER DATABASE MyDatabase SET QUERY_STORE (
    OPERATION_MODE = READ_WRITE,
    CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = 30),
    DATA_FLUSH_INTERVAL_SECONDS = 900,
    INTERVAL_LENGTH_MINUTES = 60,
    MAX_STORAGE_SIZE_MB = 1024,
    QUERY_CAPTURE_MODE = AUTO,
    SIZE_BASED_CLEANUP_MODE = AUTO,
    MAX_PLANS_PER_QUERY = 200
);

-- Verify configuration
SELECT * FROM sys.database_query_store_options;
```

## Understanding Query Store Views

```sql
-- Find top resource-consuming queries
SELECT TOP 20
    q.query_id,
    qt.query_sql_text,
    SUM(rs.count_executions) AS total_executions,
    SUM(rs.avg_duration * rs.count_executions) AS total_duration,
    AVG(rs.avg_duration) AS avg_duration,
    AVG(rs.avg_cpu_time) AS avg_cpu_time,
    AVG(rs.avg_logical_io_reads) AS avg_logical_reads
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
JOIN sys.query_store_runtime_stats_interval rsi ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
WHERE rsi.start_time >= DATEADD(DAY, -7, GETDATE())
GROUP BY q.query_id, qt.query_sql_text
ORDER BY total_duration DESC;
```

## Identifying Query Regressions

```sql
-- Find queries that have regressed
WITH QueryPerformance AS (
    SELECT
        q.query_id,
        qt.query_sql_text,
        rs.avg_duration,
        rsi.start_time,
        ROW_NUMBER() OVER (
            PARTITION BY q.query_id
            ORDER BY rsi.start_time
        ) AS execution_order
    FROM sys.query_store_query q
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
    JOIN sys.query_store_plan p ON q.query_id = p.query_id
    JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
    JOIN sys.query_store_runtime_stats_interval rsi
        ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
)
SELECT
    recent.query_id,
    LEFT(recent.query_sql_text, 200) AS query_text,
    baseline.avg_duration AS baseline_duration,
    recent.avg_duration AS recent_duration,
    (recent.avg_duration - baseline.avg_duration) / baseline.avg_duration * 100 AS pct_regression
FROM QueryPerformance recent
JOIN QueryPerformance baseline
    ON recent.query_id = baseline.query_id
WHERE recent.execution_order = (
    SELECT MAX(execution_order)
    FROM QueryPerformance
    WHERE query_id = recent.query_id
)
AND baseline.execution_order = 1
AND recent.avg_duration > baseline.avg_duration * 1.5
ORDER BY pct_regression DESC;
```

## Forcing Query Plans

When you identify a good plan, you can force the query optimizer to use it:

```sql
-- View available plans for a query
SELECT
    p.plan_id,
    p.query_id,
    p.plan_group_id,
    p.engine_version,
    p.is_forced_plan,
    p.force_failure_count,
    p.last_force_failure_reason_desc,
    CAST(p.query_plan AS XML) AS plan_xml
FROM sys.query_store_plan p
WHERE p.query_id = @query_id;

-- Force a specific plan
EXEC sp_query_store_force_plan @query_id = 42, @plan_id = 103;

-- Unforce a plan
EXEC sp_query_store_unforce_plan @query_id = 42, @plan_id = 103;
```

## Building a Query Performance Dashboard

```csharp
// C# Query Store monitoring service
public class QueryStoreMonitor
{
    private readonly string _connectionString;

    public QueryStoreMonitor(string connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<List<QueryRegression>> FindRegressedQueriesAsync(
        int daysBack = 7,
        double regressionThreshold = 1.5)
    {
        var query = @"
            WITH Recent AS (
                SELECT
                    q.query_id,
                    qt.query_sql_text,
                    AVG(rs.avg_duration) AS avg_duration
                FROM sys.query_store_query q
                JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
                JOIN sys.query_store_plan p ON q.query_id = p.query_id
                JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
                JOIN sys.query_store_runtime_stats_interval rsi
                    ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
                WHERE rsi.start_time >= DATEADD(DAY, -1, GETDATE())
                GROUP BY q.query_id, qt.query_sql_text
            ),
            Historical AS (
                SELECT
                    q.query_id,
                    AVG(rs.avg_duration) AS avg_duration
                FROM sys.query_store_query q
                JOIN sys.query_store_plan p ON q.query_id = p.query_id
                JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
                JOIN sys.query_store_runtime_stats_interval rsi
                    ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
                WHERE rsi.start_time >= DATEADD(DAY, @DaysBack, GETDATE())
                  AND rsi.start_time < DATEADD(DAY, -1, GETDATE())
                GROUP BY q.query_id
            )
            SELECT
                r.query_id,
                r.query_sql_text,
                h.avg_duration AS baseline_duration,
                r.avg_duration AS recent_duration,
                r.avg_duration / h.avg_duration AS regression_factor
            FROM Recent r
            JOIN Historical h ON r.query_id = h.query_id
            WHERE r.avg_duration > h.avg_duration * @Threshold
            ORDER BY regression_factor DESC";

        var regressions = new List<QueryRegression>();

        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        using var command = new SqlCommand(query, connection);
        command.Parameters.AddWithValue("@DaysBack", -daysBack);
        command.Parameters.AddWithValue("@Threshold", regressionThreshold);

        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            regressions.Add(new QueryRegression
            {
                QueryId = reader.GetInt64(0),
                QueryText = reader.GetString(1),
                BaselineDuration = reader.GetDouble(2),
                RecentDuration = reader.GetDouble(3),
                RegressionFactor = reader.GetDouble(4)
            });
        }

        return regressions;
    }
}

public class QueryRegression
{
    public long QueryId { get; set; }
    public string QueryText { get; set; }
    public double BaselineDuration { get; set; }
    public double RecentDuration { get; set; }
    public double RegressionFactor { get; set; }
}
```

## Query Store Best Practices

```sql
-- Clean up ad-hoc queries consuming space
EXEC sp_query_store_flush_db;

-- Remove specific query from Query Store
EXEC sp_query_store_remove_query @query_id = 42;

-- Clear all Query Store data (use with caution)
ALTER DATABASE MyDatabase SET QUERY_STORE CLEAR;

-- Monitor Query Store space usage
SELECT
    current_storage_size_mb,
    max_storage_size_mb,
    (current_storage_size_mb * 100.0 / max_storage_size_mb) AS pct_used,
    readonly_reason
FROM sys.database_query_store_options;
```

Query Store transforms database performance troubleshooting from guesswork into data-driven analysis, making it an indispensable tool for maintaining optimal database performance.
