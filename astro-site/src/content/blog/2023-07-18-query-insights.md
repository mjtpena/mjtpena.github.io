---
title: "Query Insights in Fabric: Monitoring and Optimization"
author: Michael John Peña
draft: false
date: 2023-07-18
tags:
  - Microsoft Fabric
  - Query Insights
  - Performance
  - Monitoring

---

I wrote "Query Insights in Fabric: Monitoring and Optimization" to share practical, production-minded guidance on this topic.

## Understanding Query Insights

```sql
-- Query Insights captures:
-- - Query text and parameters
-- - Execution time and resources
-- - Row counts
-- - Execution plans
-- - Historical trends

-- Access Query Insights:
-- 1. Open your Warehouse
-- 2. Click "Query Insights" in the toolbar
-- 3. Or query the system views directly
```

## System Views for Query Analysis

### Query History

```sql
-- View recent query history
SELECT
    query_id,
    login_name,
    start_time,
    end_time,
    DATEDIFF(second, start_time, end_time) as duration_seconds,
    row_count,
    status,
    LEFT(query_text, 200) as query_preview
FROM sys.dm_exec_requests_history
WHERE start_time > DATEADD(hour, -24, GETUTCDATE())
ORDER BY start_time DESC;

-- Find slow queries
SELECT
    query_id,
    login_name,
    start_time,
    DATEDIFF(second, start_time, end_time) as duration_seconds,
    row_count,
    query_text
FROM sys.dm_exec_requests_history
WHERE DATEDIFF(second, start_time, end_time) > 60  -- Over 1 minute
    AND start_time > DATEADD(day, -7, GETUTCDATE())
ORDER BY duration_seconds DESC;
```

### Resource Consumption

```sql
-- Analyze resource usage patterns
SELECT
    CAST(start_time AS DATE) as query_date,
    COUNT(*) as query_count,
    AVG(DATEDIFF(second, start_time, end_time)) as avg_duration_seconds,
    MAX(DATEDIFF(second, start_time, end_time)) as max_duration_seconds,
    SUM(row_count) as total_rows_processed
FROM sys.dm_exec_requests_history
WHERE start_time > DATEADD(day, -30, GETUTCDATE())
GROUP BY CAST(start_time AS DATE)
ORDER BY query_date DESC;

-- Peak usage times
SELECT
    DATEPART(hour, start_time) as hour_of_day,
    COUNT(*) as query_count,
    AVG(DATEDIFF(second, start_time, end_time)) as avg_duration_seconds
FROM sys.dm_exec_requests_history
WHERE start_time > DATEADD(day, -7, GETUTCDATE())
GROUP BY DATEPART(hour, start_time)
ORDER BY hour_of_day;
```

## Identifying Performance Issues

### Finding Expensive Queries

```sql
-- Top 10 longest running queries
SELECT TOP 10
    query_id,
    start_time,
    DATEDIFF(second, start_time, end_time) as duration_seconds,
    row_count,
    query_text
FROM sys.dm_exec_requests_history
WHERE status = 'Succeeded'
    AND start_time > DATEADD(day, -7, GETUTCDATE())
ORDER BY DATEDIFF(second, start_time, end_time) DESC;

-- Queries with high row counts
SELECT TOP 10
    query_id,
    start_time,
    duration_seconds,
    row_count,
    query_text
FROM (
    SELECT
        query_id,
        start_time,
        DATEDIFF(second, start_time, end_time) as duration_seconds,
        row_count,
        query_text
    FROM sys.dm_exec_requests_history
    WHERE start_time > DATEADD(day, -7, GETUTCDATE())
) q
ORDER BY row_count DESC;
```

### Failed Queries

```sql
-- Review failed queries
SELECT
    query_id,
    login_name,
    start_time,
    status,
    error_message,
    query_text
FROM sys.dm_exec_requests_history
WHERE status = 'Failed'
    AND start_time > DATEADD(day, -7, GETUTCDATE())
ORDER BY start_time DESC;

-- Error frequency analysis
SELECT
    error_message,
    COUNT(*) as error_count,
    MIN(start_time) as first_occurrence,
    MAX(start_time) as last_occurrence
FROM sys.dm_exec_requests_history
WHERE status = 'Failed'
    AND start_time > DATEADD(day, -30, GETUTCDATE())
GROUP BY error_message
ORDER BY error_count DESC;
```

## Query Patterns Analysis

```sql
-- Identify repeated queries (candidates for views/caching)
SELECT
    -- Normalize query text (remove literals)
    HASHBYTES('SHA2_256', query_text) as query_hash,
    COUNT(*) as execution_count,
    AVG(DATEDIFF(second, start_time, end_time)) as avg_duration_seconds,
    SUM(row_count) as total_rows,
    MIN(query_text) as sample_query
FROM sys.dm_exec_requests_history
WHERE start_time > DATEADD(day, -7, GETUTCDATE())
GROUP BY HASHBYTES('SHA2_256', query_text)
HAVING COUNT(*) > 10
ORDER BY execution_count DESC;

-- User activity analysis
SELECT
    login_name,
    COUNT(*) as query_count,
    AVG(DATEDIFF(second, start_time, end_time)) as avg_duration_seconds,
    SUM(row_count) as total_rows_processed
FROM sys.dm_exec_requests_history
WHERE start_time > DATEADD(day, -7, GETUTCDATE())
GROUP BY login_name
ORDER BY query_count DESC;
```

## Creating Monitoring Dashboards

```sql
-- Create a monitoring table
CREATE TABLE query_performance_log (
    log_date DATE,
    total_queries INT,
    avg_duration_seconds FLOAT,
    max_duration_seconds INT,
    failed_queries INT,
    total_rows_processed BIGINT,
    logged_at DATETIME2 DEFAULT GETUTCDATE()
);

-- Populate daily
CREATE PROCEDURE usp_log_daily_performance
AS
BEGIN
    DECLARE @log_date DATE = CAST(DATEADD(day, -1, GETUTCDATE()) AS DATE);

    INSERT INTO query_performance_log (
        log_date,
        total_queries,
        avg_duration_seconds,
        max_duration_seconds,
        failed_queries,
        total_rows_processed
    )
    SELECT
        @log_date,
        COUNT(*),
        AVG(CAST(DATEDIFF(second, start_time, end_time) AS FLOAT)),
        MAX(DATEDIFF(second, start_time, end_time)),
        SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END),
        SUM(row_count)
    FROM sys.dm_exec_requests_history
    WHERE CAST(start_time AS DATE) = @log_date;
END;

-- Query the log for trends
SELECT
    log_date,
    total_queries,
    avg_duration_seconds,
    failed_queries,
    CAST(failed_queries AS FLOAT) / NULLIF(total_queries, 0) * 100 as failure_rate_percent
FROM query_performance_log
ORDER BY log_date DESC;
```

## Optimization Strategies

```python
# Based on Query Insights findings:
optimization_strategies = {
    "slow_queries": [
        "Review query plan for full scans",
        "Add appropriate filters",
        "Consider materialized views",
        "Optimize joins"
    ],
    "high_frequency_queries": [
        "Create views for common patterns",
        "Consider caching layer",
        "Optimize for repeated execution"
    ],
    "failed_queries": [
        "Fix data type mismatches",
        "Handle null values",
        "Add error handling",
        "Review permissions"
    ],
    "resource_spikes": [
        "Schedule heavy queries off-peak",
        "Implement query queuing",
        "Consider capacity increase"
    ]
}
```

```sql
-- Example: Optimize a slow query identified via insights
-- Original (slow - full scan)
SELECT * FROM fact_sales WHERE YEAR(order_date) = 2023;

-- Optimized (uses date filtering)
SELECT * FROM fact_sales
WHERE order_date >= '2023-01-01' AND order_date < '2024-01-01';
```

## Alerting on Performance Issues

```python
# Set up alerts using Power Automate or Azure Logic Apps
# Query the performance log and trigger alerts

alert_conditions = {
    "slow_query_threshold": "duration_seconds > 300",
    "failure_rate_threshold": "failure_rate > 5%",
    "volume_spike": "query_count > 2x average",
    "long_running_active": "active queries > 30 minutes"
}
```

Tomorrow we'll explore Fabric Real-Time Analytics.

## Resources

- [Query Insights Documentation](https://learn.microsoft.com/en-us/fabric/data-warehouse/query-insights)
- [Performance Tuning](https://learn.microsoft.com/en-us/fabric/data-warehouse/guidelines-warehouse-performance)
- [Monitoring DMVs](https://learn.microsoft.com/en-us/fabric/data-warehouse/monitoring-dmvs)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
