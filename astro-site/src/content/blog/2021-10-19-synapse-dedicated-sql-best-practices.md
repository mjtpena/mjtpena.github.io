---
title: "Azure Synapse Dedicated SQL Pool Best Practices"
description: "Synapse Dedicated SQL Pool (formerly Azure SQL Data Warehouse) is the massively parallel processing (MPP) engine for structured, petabyte-scale analytical…"
author: "Michael John Peña"
draft: false
date: 2021-10-19
tags: ["Azure", "Synapse", "SQL", "Data Warehouse", "Performance"]
---

Synapse Dedicated SQL Pool (formerly Azure SQL Data Warehouse) is the massively parallel processing (MPP) engine for structured, petabyte-scale analytical workloads—and the configuration decisions made at design time have outsized impact on query performance and cost. The DWU (Data Warehouse Units) setting controls compute allocation and cost; the distribution strategy (hash, round-robin, or replicated) for each table controls how data is distributed across compute nodes and whether queries can avoid expensive data movement. Getting the distribution key right for fact tables—choosing a column with high cardinality that matches common join conditions—eliminates the skew and data shuffle that are the two most common causes of poor Synapse query performance. Row-count statistics, maintained by `CREATE STATISTICS` and `UPDATE STATISTICS`, are the input the query optimiser uses to choose efficient execution plans.

## Architecture Fundamentals

Dedicated SQL pools use:
- **Control node** - Query parsing, optimization, orchestration
- **Compute nodes** - Distributed query execution
- **Distributions** - Data partitioned across 60 distributions
- **DWUs** - Data Warehouse Units measuring compute capacity

## Table Design

### Distribution Strategy

#### Hash Distribution (Large Fact Tables)

```sql
-- Hash distribute large tables on a column with many unique values
CREATE TABLE [dbo].[FactSales]
(
    [SalesOrderId] INT NOT NULL,
    [ProductKey] INT NOT NULL,
    [CustomerKey] INT NOT NULL,
    [OrderDate] DATE NOT NULL,
    [Quantity] INT NOT NULL,
    [Amount] DECIMAL(18,2) NOT NULL
)
WITH
(
    DISTRIBUTION = HASH([CustomerKey]),
    CLUSTERED COLUMNSTORE INDEX
);
```

#### Replicate Distribution (Small Dimension Tables)

```sql
-- Replicate small tables to all compute nodes
CREATE TABLE [dbo].[DimProduct]
(
    [ProductKey] INT NOT NULL,
    [ProductName] NVARCHAR(255) NOT NULL,
    [Category] NVARCHAR(100) NOT NULL,
    [SubCategory] NVARCHAR(100) NOT NULL
)
WITH
(
    DISTRIBUTION = REPLICATE,
    CLUSTERED COLUMNSTORE INDEX
);
```

#### Round Robin (Staging Tables)

```sql
-- Round robin for staging tables
CREATE TABLE [staging].[RawSales]
(
    [RawData] NVARCHAR(MAX)
)
WITH
(
    DISTRIBUTION = ROUND_ROBIN,
    HEAP
);
```

### Choosing Distribution Column

Good distribution columns:
- High cardinality (many unique values)
- No or few NULLs
- Not frequently updated
- Used in JOIN conditions

```sql
-- Check distribution skew
DBCC PDW_SHOWSPACEUSED('dbo.FactSales');

-- Query to find skew
SELECT
    distribution_id,
    COUNT(*) as row_count
FROM sys.pdw_table_distribution_properties
GROUP BY distribution_id
ORDER BY row_count DESC;
```

### Indexing Strategies

#### Clustered Columnstore (Default)

```sql
-- Best for large tables with analytical queries
CREATE TABLE [dbo].[FactOrders]
(
    [OrderId] BIGINT NOT NULL,
    [OrderDate] DATE NOT NULL,
    [Amount] DECIMAL(18,2)
)
WITH
(
    CLUSTERED COLUMNSTORE INDEX
);
```

#### Heap (Staging)

```sql
-- Best for staging/loading
CREATE TABLE [staging].[Orders]
(
    [OrderId] BIGINT NOT NULL,
    [OrderDate] DATE NOT NULL
)
WITH
(
    HEAP
);
```

#### Clustered Index (Point Lookups)

```sql
-- Use for tables with frequent point lookups
CREATE TABLE [dbo].[DimCustomer]
(
    [CustomerKey] INT NOT NULL,
    [CustomerName] NVARCHAR(255)
)
WITH
(
    CLUSTERED INDEX ([CustomerKey])
);
```

## Partitioning

### Create Partitioned Table

```sql
-- Partition by date for efficient data management
CREATE TABLE [dbo].[FactSales]
(
    [SalesOrderId] BIGINT NOT NULL,
    [OrderDate] DATE NOT NULL,
    [Amount] DECIMAL(18,2)
)
WITH
(
    DISTRIBUTION = HASH([SalesOrderId]),
    CLUSTERED COLUMNSTORE INDEX,
    PARTITION ([OrderDate] RANGE RIGHT FOR VALUES
        ('2021-01-01', '2021-02-01', '2021-03-01', '2021-04-01',
         '2021-05-01', '2021-06-01', '2021-07-01', '2021-08-01',
         '2021-09-01', '2021-10-01', '2021-11-01', '2021-12-01'))
);
```

### Partition Switching

```sql
-- Create staging table with same structure
CREATE TABLE [staging].[FactSales_October]
WITH
(
    DISTRIBUTION = HASH([SalesOrderId]),
    CLUSTERED COLUMNSTORE INDEX,
    PARTITION ([OrderDate] RANGE RIGHT FOR VALUES ())
)
AS SELECT * FROM [dbo].[FactSales] WHERE 1=0;

-- Load data into staging
INSERT INTO [staging].[FactSales_October]
SELECT * FROM [external].[RawSales]
WHERE OrderDate >= '2021-10-01' AND OrderDate < '2021-11-01';

-- Switch partition
ALTER TABLE [staging].[FactSales_October]
SWITCH TO [dbo].[FactSales]
PARTITION 10;
```

## Query Optimization

### Statistics

```sql
-- Create statistics on filter columns
CREATE STATISTICS [stats_OrderDate] ON [dbo].[FactSales]([OrderDate]);
CREATE STATISTICS [stats_CustomerKey] ON [dbo].[FactSales]([CustomerKey]);

-- Update statistics
UPDATE STATISTICS [dbo].[FactSales];

-- Check statistics freshness
SELECT
    OBJECT_NAME(s.object_id) as table_name,
    s.name as stats_name,
    STATS_DATE(s.object_id, s.stats_id) as last_updated
FROM sys.stats s
WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1;
```

### Query Hints

```sql
-- Force specific distribution for joins
SELECT /*+ SHUFFLE_MOVE(f) */
    f.*, d.*
FROM dbo.FactSales f
JOIN dbo.DimCustomer d ON f.CustomerKey = d.CustomerKey
OPTION (LABEL = 'Fact-Dimension Join');
```

### Explain Plans

```sql
-- Get query plan
EXPLAIN
SELECT CustomerKey, SUM(Amount)
FROM dbo.FactSales
GROUP BY CustomerKey;
```

## Data Loading

### Using COPY Command

```sql
-- Fast data loading with COPY
COPY INTO [dbo].[FactSales]
FROM 'https://storageaccount.blob.core.windows.net/container/sales/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);
```

### Using PolyBase

```sql
-- Create external data source
CREATE EXTERNAL DATA SOURCE AzureStorage
WITH (
    TYPE = HADOOP,
    LOCATION = 'wasbs://container@storageaccount.blob.core.windows.net',
    CREDENTIAL = AzureStorageCredential
);

-- Create external table
CREATE EXTERNAL TABLE [ext].[Sales]
(
    [SalesOrderId] BIGINT,
    [OrderDate] DATE,
    [Amount] DECIMAL(18,2)
)
WITH (
    LOCATION = '/sales/',
    DATA_SOURCE = AzureStorage,
    FILE_FORMAT = ParquetFormat
);

-- Load via CTAS
CREATE TABLE [dbo].[FactSales]
WITH (
    DISTRIBUTION = HASH([SalesOrderId]),
    CLUSTERED COLUMNSTORE INDEX
)
AS SELECT * FROM [ext].[Sales];
```

## Workload Management

### Resource Classes

```sql
-- Create user in larger resource class for big loads
EXEC sp_addrolemember 'largerc', 'LoadUser';

-- Check current resource class
SELECT * FROM sys.database_principals WHERE name = 'LoadUser';
```

### Workload Groups

```sql
-- Create workload group
CREATE WORKLOAD GROUP wgETL
WITH (
    MIN_PERCENTAGE_RESOURCE = 25,
    CAP_PERCENTAGE_RESOURCE = 50,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 10
);

-- Create workload classifier
CREATE WORKLOAD CLASSIFIER wcETL
WITH (
    WORKLOAD_GROUP = 'wgETL',
    MEMBERNAME = 'ETLUser',
    IMPORTANCE = HIGH
);
```

## Monitoring

### Active Queries

```sql
-- View active queries
SELECT
    request_id,
    status,
    submit_time,
    start_time,
    total_elapsed_time,
    command
FROM sys.dm_pdw_exec_requests
WHERE status NOT IN ('Completed', 'Failed', 'Cancelled')
ORDER BY submit_time DESC;
```

### Query History

```sql
-- Query performance history
SELECT TOP 100
    request_id,
    command,
    total_elapsed_time,
    resource_class,
    row_count
FROM sys.dm_pdw_exec_requests
WHERE status = 'Completed'
ORDER BY total_elapsed_time DESC;
```

### Data Movement

```sql
-- Check data movement operations
SELECT
    request_id,
    step_index,
    operation_type,
    distribution_type,
    location_type,
    status,
    total_elapsed_time
FROM sys.dm_pdw_request_steps
WHERE request_id = 'QID1234'
ORDER BY step_index;
```

## Maintenance

### Index Maintenance

```sql
-- Rebuild columnstore indexes
ALTER INDEX ALL ON [dbo].[FactSales] REBUILD;

-- Reorganize specific index
ALTER INDEX [CCI_FactSales] ON [dbo].[FactSales] REORGANIZE;
```

### Table Maintenance

```sql
-- Check table health
SELECT
    OBJECT_NAME(object_id) as table_name,
    SUM(row_count) as rows,
    SUM(reserved_space_page_count) * 8 / 1024 as reserved_mb
FROM sys.dm_pdw_nodes_db_partition_stats
GROUP BY object_id
ORDER BY reserved_mb DESC;
```

## Best Practices Summary

1. **Choose distribution wisely** - Hash for large facts, replicate for small dims
2. **Use columnstore indexes** - Default for analytical workloads
3. **Partition large tables** - Enable efficient data management
4. **Maintain statistics** - Keep them up to date
5. **Use COPY for loading** - Fastest loading method
6. **Implement workload management** - Control resource allocation
7. **Monitor regularly** - Track query performance

## Conclusion

Synapse dedicated SQL pools provide powerful capabilities for enterprise data warehousing. By following these best practices for distribution, indexing, and workload management, you can achieve optimal performance for your analytical workloads.

Tomorrow, we'll deep dive into PolyBase for data virtualization scenarios.
