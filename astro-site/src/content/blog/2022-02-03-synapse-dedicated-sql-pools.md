---
title: "Synapse Dedicated SQL Pools: Performance Tuning Guide"
description: "These optimizations can dramatically improve dedicated SQL pool performance while reducing resource consumption."
author: Michael John Peña
draft: false
date: 2022-02-03
url: /blog/synapse-dedicated-sql-pools/
tags:
  - Azure
  - Synapse
  - SQL
  - performance-tuning
---

## Understanding Distribution

Choose the right distribution strategy for your tables:

```sql
-- Hash distribution for large fact tables
CREATE TABLE FactSales
(
    SalesKey BIGINT NOT NULL,
    CustomerKey INT NOT NULL,
    ProductKey INT NOT NULL,
    OrderDate DATE NOT NULL,
    Amount DECIMAL(18,2),
    Quantity INT
)
WITH
(
    DISTRIBUTION = HASH(CustomerKey),
    CLUSTERED COLUMNSTORE INDEX
);

-- Replicate small dimension tables
CREATE TABLE DimProduct
(
    ProductKey INT NOT NULL,
    ProductName NVARCHAR(100),
    Category NVARCHAR(50),
    SubCategory NVARCHAR(50)
)
WITH
(
    DISTRIBUTION = REPLICATE,
    CLUSTERED COLUMNSTORE INDEX
);

-- Round-robin for staging tables
CREATE TABLE StgSales
(
    SalesKey BIGINT,
    CustomerKey INT,
    RawData NVARCHAR(MAX)
)
WITH
(
    DISTRIBUTION = ROUND_ROBIN,
    HEAP
);
```

## Columnstore Index Optimization

```sql
-- Check columnstore health
SELECT
    t.name AS table_name,
    i.name AS index_name,
    rg.state_description,
    rg.total_rows,
    rg.deleted_rows,
    CAST(100.0 * rg.deleted_rows / rg.total_rows AS DECIMAL(5,2)) AS deleted_pct
FROM sys.column_store_row_groups rg
JOIN sys.tables t ON rg.object_id = t.object_id
JOIN sys.indexes i ON rg.object_id = i.object_id AND rg.index_id = i.index_id
WHERE rg.state_description = 'OPEN' OR rg.deleted_rows > 0
ORDER BY deleted_pct DESC;

-- Rebuild fragmented columnstore indexes
ALTER INDEX CCI_FactSales ON FactSales REBUILD
WITH (ONLINE = ON);

-- Reorganize to merge row groups
ALTER INDEX CCI_FactSales ON FactSales REORGANIZE
WITH (COMPRESS_ALL_ROW_GROUPS = ON);
```

## Statistics Management

```sql
-- Create statistics on key columns
CREATE STATISTICS stats_customer ON FactSales(CustomerKey);
CREATE STATISTICS stats_product ON FactSales(ProductKey);
CREATE STATISTICS stats_date ON FactSales(OrderDate);

-- Multi-column statistics
CREATE STATISTICS stats_customer_product
ON FactSales(CustomerKey, ProductKey);

-- Update statistics
UPDATE STATISTICS FactSales;

-- Check statistics freshness
SELECT
    t.name AS table_name,
    s.name AS statistics_name,
    STATS_DATE(s.object_id, s.stats_id) AS last_updated,
    sp.rows AS row_count,
    sp.modification_counter AS modifications
FROM sys.stats s
JOIN sys.tables t ON s.object_id = t.object_id
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
ORDER BY sp.modification_counter DESC;
```

## Workload Management

```sql
-- Create workload classifier for priority queries
CREATE WORKLOAD CLASSIFIER HighPriorityReports
WITH (
    WORKLOAD_GROUP = 'xlargerc',
    MEMBERNAME = 'ReportingUser',
    IMPORTANCE = HIGH
);

-- Create workload group for batch processing
CREATE WORKLOAD GROUP BatchProcessing
WITH (
    MIN_PERCENTAGE_RESOURCE = 0,
    MAX_PERCENTAGE_RESOURCE = 50,
    CAP_PERCENTAGE_RESOURCE = 50,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 10,
    REQUEST_MAX_RESOURCE_GRANT_PERCENT = 25
);

CREATE WORKLOAD CLASSIFIER BatchJobs
WITH (
    WORKLOAD_GROUP = 'BatchProcessing',
    MEMBERNAME = 'ETLUser',
    IMPORTANCE = LOW
);

-- Monitor workload groups
SELECT
    wg.name AS workload_group,
    wc.name AS classifier_name,
    wc.importance,
    running_requests = r.active_count,
    queued_requests = r.queued_count
FROM sys.workload_management_workload_groups wg
LEFT JOIN sys.workload_management_workload_classifiers wc
    ON wg.group_id = wc.group_id
LEFT JOIN (
    SELECT
        group_id,
        COUNT(CASE WHEN status = 'Running' THEN 1 END) as active_count,
        COUNT(CASE WHEN status = 'Queued' THEN 1 END) as queued_count
    FROM sys.dm_pdw_exec_requests
    WHERE status IN ('Running', 'Queued')
    GROUP BY group_id
) r ON wg.group_id = r.group_id;
```

## Materialized Views

```sql
-- Create materialized view for common aggregations
CREATE MATERIALIZED VIEW mv_DailySalesSummary
WITH (DISTRIBUTION = HASH(CustomerKey))
AS
SELECT
    CustomerKey,
    ProductKey,
    CAST(OrderDate AS DATE) AS SaleDate,
    SUM(Amount) AS TotalAmount,
    SUM(Quantity) AS TotalQuantity,
    COUNT(*) AS TransactionCount
FROM FactSales
GROUP BY
    CustomerKey,
    ProductKey,
    CAST(OrderDate AS DATE);

-- Check if materialized view is being used
EXPLAIN
SELECT
    CustomerKey,
    SUM(Amount) AS TotalAmount
FROM FactSales
GROUP BY CustomerKey;
```

## Query Optimization

```sql
-- Use EXPLAIN to analyze query plans
EXPLAIN
SELECT
    c.CustomerName,
    SUM(f.Amount) as TotalSales
FROM FactSales f
JOIN DimCustomer c ON f.CustomerKey = c.CustomerKey
WHERE f.OrderDate >= '2022-01-01'
GROUP BY c.CustomerName
ORDER BY TotalSales DESC;

-- Avoid data movement with proper distribution
-- Good: Join on distribution column
SELECT f.*, c.CustomerName
FROM FactSales f
JOIN DimCustomer c ON f.CustomerKey = c.CustomerKey;

-- Monitor data movement
SELECT
    request_id,
    type,
    status,
    total_elapsed_time,
    data_processed
FROM sys.dm_pdw_dms_workers
WHERE request_id IN (
    SELECT request_id
    FROM sys.dm_pdw_exec_requests
    WHERE status = 'Running'
)
ORDER BY total_elapsed_time DESC;
```

## Result Set Caching

```sql
-- Enable result set caching
ALTER DATABASE [YourDatabase]
SET RESULT_SET_CACHING ON;

-- Check cache hit ratio
SELECT
    result_cache_hit,
    COUNT(*) as query_count
FROM sys.dm_pdw_exec_requests
WHERE status = 'Completed'
    AND command LIKE 'SELECT%'
GROUP BY result_cache_hit;
```

These optimizations can dramatically improve dedicated SQL pool performance while reducing resource consumption.
