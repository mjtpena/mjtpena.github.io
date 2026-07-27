---
title: "Synapse Serverless SQL Performance: Optimization Strategies"
author: Michael John Peña
draft: false
date: 2022-02-02
url: /blog/synapse-serverless-sql-performance/
tags:
  - azure
  - synapse
  - serverless
  - performance

---

I wrote "Synapse Serverless SQL Performance: Optimization Strategies" to share practical, production-minded guidance on this topic.

## Understanding Serverless SQL Costs

Serverless SQL charges based on data processed. Optimization reduces both cost and query time.

```sql
-- Check data processed per query
SELECT
    request_id,
    command,
    data_processed_mb,
    total_elapsed_time_ms
FROM sys.dm_exec_requests_history
WHERE login_name = 'your-user'
ORDER BY start_time DESC;
```

## File Format Optimization

### Use Parquet with Proper Partitioning

```sql
-- Create optimized external table
CREATE EXTERNAL TABLE Sales
WITH (
    LOCATION = 'curated/sales/',
    DATA_SOURCE = DataLakeSource,
    FILE_FORMAT = ParquetFormat
)
AS
SELECT
    OrderID,
    CustomerID,
    ProductID,
    Amount,
    Quantity,
    OrderDate,
    YEAR(OrderDate) as Year,
    MONTH(OrderDate) as Month
FROM OPENROWSET(
    BULK 'raw/sales/*.csv',
    DATA_SOURCE = 'DataLakeSource',
    FORMAT = 'CSV',
    PARSER_VERSION = '2.0',
    HEADER_ROW = TRUE
) AS source;
```

### Optimal File Sizes

```python
# PySpark script to optimize file sizes
from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("FileOptimization").getOrCreate()

# Read source data
df = spark.read.parquet("abfss://raw@storage.dfs.core.windows.net/sales/")

# Repartition for optimal file sizes (100-250MB per file)
row_count = df.count()
optimal_partitions = max(1, row_count // 1000000)  # ~1M rows per file

df.repartition(optimal_partitions) \
    .write \
    .mode("overwrite") \
    .parquet("abfss://optimized@storage.dfs.core.windows.net/sales/")
```

## Query Optimization

### Partition Elimination

```sql
-- Use filepath() for partition pruning
SELECT *
FROM OPENROWSET(
    BULK 'sales/year=*/month=*/*.parquet',
    DATA_SOURCE = 'DataLakeSource',
    FORMAT = 'PARQUET'
) AS sales
WHERE
    sales.filepath(1) = '2022' AND  -- Year partition
    sales.filepath(2) IN ('01', '02', '03')  -- Month partitions
```

### Column Projection

```sql
-- Only select needed columns (Parquet column pruning)
SELECT
    CustomerID,
    SUM(Amount) as TotalSales
FROM OPENROWSET(
    BULK 'sales/**/*.parquet',
    DATA_SOURCE = 'DataLakeSource',
    FORMAT = 'PARQUET'
) AS sales
GROUP BY CustomerID;

-- Avoid SELECT * on wide tables
-- This scans ALL columns:
-- SELECT * FROM sales WHERE CustomerID = 123

-- This only scans needed columns:
-- SELECT CustomerID, Amount FROM sales WHERE CustomerID = 123
```

### Predicate Pushdown

```sql
-- Ensure predicates can be pushed down
-- Good: Simple comparisons
SELECT * FROM sales WHERE OrderDate >= '2022-01-01'

-- Bad: Functions on columns prevent pushdown
-- SELECT * FROM sales WHERE YEAR(OrderDate) = 2022

-- Better: Pre-compute in source
SELECT * FROM sales WHERE Year = 2022
```

## Statistics and Metadata

```sql
-- Create statistics for better query plans
CREATE STATISTICS stats_customer_id ON Sales(CustomerID)
WITH FULLSCAN;

CREATE STATISTICS stats_order_date ON Sales(OrderDate)
WITH FULLSCAN;

-- Check statistics
SELECT
    name AS statistics_name,
    STATS_DATE(object_id, stats_id) AS statistics_update_date
FROM sys.stats
WHERE object_id = OBJECT_ID('Sales');
```

## CETAS for Materialized Views

```sql
-- Create materialized aggregation
CREATE EXTERNAL TABLE SalesByCustomerMonthlySummary
WITH (
    LOCATION = 'curated/sales_summary/',
    DATA_SOURCE = DataLakeSource,
    FILE_FORMAT = ParquetFormat
)
AS
SELECT
    CustomerID,
    YEAR(OrderDate) as Year,
    MONTH(OrderDate) as Month,
    SUM(Amount) as TotalAmount,
    COUNT(*) as OrderCount,
    AVG(Amount) as AvgOrderValue
FROM OPENROWSET(
    BULK 'sales/**/*.parquet',
    DATA_SOURCE = 'DataLakeSource',
    FORMAT = 'PARQUET'
) AS sales
GROUP BY
    CustomerID,
    YEAR(OrderDate),
    MONTH(OrderDate);

-- Query the summary instead of raw data
SELECT * FROM SalesByCustomerMonthlySummary
WHERE Year = 2022 AND Month = 1;
```

## Monitoring and Diagnostics

```sql
-- Create a diagnostic view
CREATE VIEW QueryPerformanceDiag AS
SELECT
    dr.request_id,
    dr.status,
    dr.start_time,
    dr.end_time,
    dr.total_elapsed_time / 1000.0 as elapsed_seconds,
    dr.data_processed_mb,
    dr.data_processed_mb / (dr.total_elapsed_time / 1000.0) as mb_per_second,
    dr.command
FROM sys.dm_exec_requests_history dr
WHERE dr.total_elapsed_time > 0;

-- Find expensive queries
SELECT TOP 20
    data_processed_mb,
    elapsed_seconds,
    SUBSTRING(command, 1, 200) as query_preview
FROM QueryPerformanceDiag
ORDER BY data_processed_mb DESC;
```

## Best Practices Summary

1. **Use Parquet format** - Column pruning and predicate pushdown
2. **Partition by query patterns** - Enable partition elimination
3. **Target 100-250MB files** - Optimal for parallel processing
4. **Select only needed columns** - Reduce data scanned
5. **Use CETAS for frequent aggregations** - Pre-compute summaries
6. **Create statistics** - Better query plans
7. **Monitor data processed** - Track costs

Proper optimization can reduce serverless SQL costs by 80-90% while dramatically improving query performance.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
