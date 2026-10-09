---
title: "Result Set Caching for Query Acceleration in Synapse"
description: "Result set caching in Synapse Dedicated SQL Pool stores the output of a query in the dedicated pool's storage and returns the cached result for subsequent…"
author: "Michael John Peña"
draft: false
date: 2021-10-22
tags: ["Azure", "Synapse", "Performance", "Caching", "Query Optimization"]
---

Result set caching in Synapse Dedicated SQL Pool stores the output of a query in the dedicated pool's storage and returns the cached result for subsequent identical queries—zero compute consumed for cache hits. For BI dashboards and reports where the same aggregate query runs dozens of times per day against slowly-changing data, result set caching can eliminate the query compute cost almost entirely. The cache is automatic when enabled: if the same query text is submitted and the underlying data hasn't changed since the result was cached, the cached result is returned. The cache lifetime is 48 hours and is invalidated automatically when the underlying table data changes. The caveat: result set caching is most valuable for expensive queries against stable data; for queries against frequently updated tables, cache hit rates will be low and the feature adds minimal value.

## Understanding Result Set Caching

When enabled, Synapse:
- Stores query results in the control node
- Returns cached results for identical queries
- Automatically invalidates cache when data changes
- Provides sub-second response for cached queries

## Enabling Result Set Caching

### At Database Level

```sql
-- Enable result set caching for the database
ALTER DATABASE [AnalyticsDB]
SET RESULT_SET_CACHING ON;

-- Check current setting
SELECT name, is_result_set_caching_on
FROM sys.databases
WHERE name = 'AnalyticsDB';
```

### At Session Level

```sql
-- Disable caching for current session (useful for testing)
SET RESULT_SET_CACHING OFF;

-- Re-enable for session
SET RESULT_SET_CACHING ON;
```

## Verifying Cache Usage

### Check if Query Hit Cache

```sql
-- Run a query
SELECT
    Region,
    SUM(Amount) as TotalSales
FROM dbo.FactSales
GROUP BY Region;

-- Check cache status
SELECT
    request_id,
    command,
    result_cache_hit
FROM sys.dm_pdw_exec_requests
WHERE command LIKE '%FactSales%'
ORDER BY submit_time DESC;
```

### View Cache Statistics

```sql
-- Get cache statistics
SELECT
    COUNT(*) as CachedQueries,
    SUM(CASE WHEN result_cache_hit = 1 THEN 1 ELSE 0 END) as CacheHits,
    SUM(CASE WHEN result_cache_hit = 0 THEN 1 ELSE 0 END) as CacheMisses
FROM sys.dm_pdw_exec_requests
WHERE submit_time > DATEADD(hour, -24, GETDATE())
  AND status = 'Completed';
```

## Cache Behavior

### Automatic Cache Invalidation

The cache is automatically invalidated when:
- Underlying data changes (INSERT, UPDATE, DELETE)
- Table schema changes
- Statistics are updated
- Permissions change

```sql
-- This invalidates the cache for affected tables
INSERT INTO dbo.FactSales (OrderId, Amount)
VALUES (1001, 500.00);

-- Next query will miss cache
SELECT SUM(Amount) FROM dbo.FactSales;
```

### Cache Lifetime

```sql
-- Cached results expire after 48 hours of inactivity
-- To manually clear cache:
DBCC DROPRESULTSETCACHE;

-- Check cache size
SELECT
    cache_object_count,
    space_used_mb = space_used_bytes / 1024 / 1024
FROM sys.dm_pdw_nodes_db_file_space_usage
WHERE database_id = DB_ID()
  AND file_id = 65537;  -- Cache file ID
```

## Cache-Friendly Query Patterns

### Consistent Query Text

```sql
-- These queries WON'T share cache (different text)
SELECT * FROM dbo.FactSales WHERE Region = 'East';
SELECT * FROM dbo.FactSales  WHERE Region = 'East';  -- Extra space
select * from dbo.FactSales where Region = 'East';   -- Different case

-- Use consistent formatting for cache hits
SELECT * FROM dbo.FactSales WHERE Region = 'East';
```

### Parameterized Queries

```sql
-- Each different value creates a new cache entry
SELECT * FROM dbo.FactSales WHERE Region = 'East';
SELECT * FROM dbo.FactSales WHERE Region = 'West';

-- Both are cached separately
```

### Deterministic Queries

```sql
-- Non-deterministic functions prevent caching
SELECT *, GETDATE() as QueryTime  -- Won't be cached
FROM dbo.FactSales;

-- Use deterministic alternatives
SELECT *, '2021-10-22' as ReportDate  -- Will be cached
FROM dbo.FactSales;
```

## Best Practices for Caching

### Dashboard Queries

```sql
-- Dashboard-style queries benefit most from caching
-- Aggregated results over large datasets

-- Good candidate for caching
SELECT
    YEAR(OrderDate) as Year,
    MONTH(OrderDate) as Month,
    Region,
    COUNT(*) as OrderCount,
    SUM(Amount) as Revenue
FROM dbo.FactSales
WHERE OrderDate >= '2021-01-01'
GROUP BY YEAR(OrderDate), MONTH(OrderDate), Region;
```

### Pre-Warming Cache

```sql
-- Run common queries during off-peak hours to warm cache
DECLARE @sql NVARCHAR(MAX);

-- Query 1: Daily summary
SET @sql = '
SELECT
    CAST(OrderDate AS DATE) as Date,
    SUM(Amount) as DailyRevenue
FROM dbo.FactSales
WHERE OrderDate >= DATEADD(day, -30, CAST(GETDATE() AS DATE))
GROUP BY CAST(OrderDate AS DATE);
';
EXEC sp_executesql @sql;

-- Query 2: Regional summary
SET @sql = '
SELECT
    Region,
    COUNT(*) as Orders,
    SUM(Amount) as Revenue
FROM dbo.FactSales
WHERE OrderDate >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
GROUP BY Region;
';
EXEC sp_executesql @sql;
```

### Monitoring Cache Effectiveness

```sql
-- Create view for cache monitoring
CREATE VIEW vw_CacheMetrics
AS
SELECT
    CAST(submit_time AS DATE) as QueryDate,
    COUNT(*) as TotalQueries,
    SUM(CASE WHEN result_cache_hit = 1 THEN 1 ELSE 0 END) as CacheHits,
    SUM(CASE WHEN result_cache_hit = 0 THEN 1 ELSE 0 END) as CacheMisses,
    CAST(SUM(CASE WHEN result_cache_hit = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS DECIMAL(5,2)) as HitRatePercent,
    AVG(CASE WHEN result_cache_hit = 1 THEN total_elapsed_time END) as AvgCacheHitTime,
    AVG(CASE WHEN result_cache_hit = 0 THEN total_elapsed_time END) as AvgCacheMissTime
FROM sys.dm_pdw_exec_requests
WHERE status = 'Completed'
  AND command NOT LIKE '%sys.%'
GROUP BY CAST(submit_time AS DATE);

-- Query the metrics
SELECT * FROM vw_CacheMetrics
ORDER BY QueryDate DESC;
```

## Limitations

### Queries That Cannot Be Cached

```sql
-- These queries won't be cached:

-- 1. Non-deterministic functions
SELECT *, NEWID() as UniqueId FROM dbo.FactSales;
SELECT *, GETDATE() as CurrentTime FROM dbo.FactSales;

-- 2. User-defined functions
SELECT *, dbo.MyFunction(Amount) FROM dbo.FactSales;

-- 3. Queries with TOP without ORDER BY
SELECT TOP 100 * FROM dbo.FactSales;

-- 4. Queries returning > 10GB results
SELECT * FROM dbo.VeryLargeTable;
```

### Cache Size Limits

- Maximum single result: 10 GB
- Total cache size: Limited by control node memory
- Maximum cache entries: Based on available space

## Troubleshooting

### Why Isn't My Query Cached?

```sql
-- Check query details
SELECT
    request_id,
    command,
    result_cache_hit,
    status,
    error_id
FROM sys.dm_pdw_exec_requests
WHERE request_id = 'QID1234';

-- Check for errors
SELECT *
FROM sys.dm_pdw_errors
WHERE request_id = 'QID1234';
```

### Cache Miss Reasons

```sql
-- Analyze cache miss patterns
SELECT
    command,
    COUNT(*) as Executions,
    SUM(CASE WHEN result_cache_hit = 1 THEN 1 ELSE 0 END) as Hits,
    MAX(submit_time) as LastRun
FROM sys.dm_pdw_exec_requests
WHERE status = 'Completed'
  AND submit_time > DATEADD(hour, -24, GETDATE())
GROUP BY command
HAVING SUM(CASE WHEN result_cache_hit = 0 THEN 1 ELSE 0 END) >
       SUM(CASE WHEN result_cache_hit = 1 THEN 1 ELSE 0 END)
ORDER BY Executions DESC;
```

## Combining with Other Features

### With Materialized Views

```sql
-- Materialized views + result set caching = maximum performance

-- Create materialized view
CREATE MATERIALIZED VIEW mv_DailySales
WITH (DISTRIBUTION = HASH(Region))
AS
SELECT
    CAST(OrderDate AS DATE) as SalesDate,
    Region,
    SUM(Amount) as TotalAmount,
    COUNT(*) as OrderCount
FROM dbo.FactSales
GROUP BY CAST(OrderDate AS DATE), Region;

-- Query the view (benefits from both MV and caching)
SELECT * FROM mv_DailySales WHERE SalesDate >= '2021-10-01';
```

## Best Practices Summary

1. **Enable at database level** - Default for interactive workloads
2. **Use consistent query text** - Exact match required
3. **Avoid non-deterministic functions** - Use literals instead
4. **Pre-warm cache** - Run common queries in advance
5. **Monitor hit rates** - Track cache effectiveness
6. **Combine with materialized views** - Maximum performance

## Conclusion

Result set caching is a powerful feature for accelerating dashboard and reporting workloads in Synapse. By understanding its behavior and limitations, you can design query patterns that maximize cache hits and deliver sub-second response times.

Tomorrow, we'll explore workload management for balancing different types of queries.
