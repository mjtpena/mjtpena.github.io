---
title: "PolyBase for Data Virtualization in Azure Synapse"
author: "Michael John Peña"
draft: false
date: 2021-10-20
tags: ["Azure", "Synapse", "PolyBase", "Data Virtualization", "ETL"]

---

I wrote "PolyBase for Data Virtualization in Azure Synapse" to share practical, production-minded guidance on this topic.

PolyBase is the T-SQL feature that makes Synapse Dedicated SQL Pool a data virtualisation engine, not just a data warehouse—it allows you to define external tables pointing to data in ADLS Gen2, Azure Blob Storage, or other databases, and query them with the same T-SQL you use for internal tables. The loading pattern: `CREATE EXTERNAL TABLE` pointing to your ADLS Gen2 files, then `CREATE TABLE AS SELECT` (CTAS) to load data from the external table into a distributed internal table at full MPP speed. For data virtualisation scenarios (querying data lake files without staging), `SELECT` from external tables works directly. The performance consideration: PolyBase reads are distributed—each Synapse compute node reads a portion of the external data in parallel. Parquet format with good partitioning gives the best PolyBase read performance; CSV files without compression are the slowest option.

## Understanding PolyBase

PolyBase allows you to:
- Query data in Azure Blob Storage and Data Lake
- Join external and internal data
- Load data without intermediate staging
- Query Hadoop clusters and other databases

## Setting Up PolyBase

### Create Master Key

```sql
-- Create master key for encryption
CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'StrongP@ssword123!';
```

### Create Database Scoped Credential

```sql
-- Using Storage Account Key
CREATE DATABASE SCOPED CREDENTIAL AzureStorageCredential
WITH IDENTITY = 'SHARED ACCESS SIGNATURE',
SECRET = 'sv=2020-08-04&ss=bfqt&srt=sco...';

-- Using Managed Identity
CREATE DATABASE SCOPED CREDENTIAL ManagedIdentityCredential
WITH IDENTITY = 'Managed Identity';
```

### Create External Data Source

```sql
-- Azure Blob Storage
CREATE EXTERNAL DATA SOURCE AzureBlobStorage
WITH (
    TYPE = HADOOP,
    LOCATION = 'wasbs://container@storageaccount.blob.core.windows.net',
    CREDENTIAL = AzureStorageCredential
);

-- Azure Data Lake Gen2
CREATE EXTERNAL DATA SOURCE AzureDataLake
WITH (
    TYPE = HADOOP,
    LOCATION = 'abfss://filesystem@storageaccount.dfs.core.windows.net',
    CREDENTIAL = ManagedIdentityCredential
);
```

### Create External File Format

```sql
-- Parquet format
CREATE EXTERNAL FILE FORMAT ParquetFormat
WITH (
    FORMAT_TYPE = PARQUET
);

-- CSV format
CREATE EXTERNAL FILE FORMAT CsvFormat
WITH (
    FORMAT_TYPE = DELIMITEDTEXT,
    FORMAT_OPTIONS (
        FIELD_TERMINATOR = ',',
        STRING_DELIMITER = '"',
        FIRST_ROW = 2,
        USE_TYPE_DEFAULT = TRUE,
        ENCODING = 'UTF8'
    )
);

-- ORC format
CREATE EXTERNAL FILE FORMAT OrcFormat
WITH (
    FORMAT_TYPE = ORC,
    DATA_COMPRESSION = 'org.apache.hadoop.io.compress.SnappyCodec'
);
```

## Creating External Tables

### Basic External Table

```sql
CREATE EXTERNAL TABLE [ext].[Sales]
(
    [SalesOrderId] BIGINT,
    [OrderDate] DATE,
    [CustomerId] INT,
    [ProductId] INT,
    [Quantity] INT,
    [UnitPrice] DECIMAL(18,2),
    [TotalAmount] DECIMAL(18,2)
)
WITH (
    LOCATION = '/sales/2021/',
    DATA_SOURCE = AzureDataLake,
    FILE_FORMAT = ParquetFormat
);
```

### External Table with Reject Options

```sql
CREATE EXTERNAL TABLE [ext].[RawLogs]
(
    [Timestamp] VARCHAR(50),
    [Level] VARCHAR(20),
    [Message] VARCHAR(MAX),
    [Source] VARCHAR(255)
)
WITH (
    LOCATION = '/logs/',
    DATA_SOURCE = AzureBlobStorage,
    FILE_FORMAT = CsvFormat,
    REJECT_TYPE = PERCENTAGE,
    REJECT_VALUE = 10,
    REJECT_SAMPLE_VALUE = 100
);
```

## Querying External Data

### Simple Query

```sql
-- Query external table like any other table
SELECT
    OrderDate,
    COUNT(*) as OrderCount,
    SUM(TotalAmount) as Revenue
FROM ext.Sales
WHERE OrderDate >= '2021-01-01'
GROUP BY OrderDate
ORDER BY OrderDate;
```

### Join External and Internal Data

```sql
-- Join external fact with internal dimension
SELECT
    s.OrderDate,
    c.CustomerName,
    c.Region,
    SUM(s.TotalAmount) as TotalRevenue
FROM ext.Sales s
JOIN dbo.DimCustomer c ON s.CustomerId = c.CustomerKey
WHERE s.OrderDate >= '2021-01-01'
GROUP BY s.OrderDate, c.CustomerName, c.Region;
```

## Loading Data with PolyBase

### CTAS - Create Table As Select

```sql
-- Load external data into internal table
CREATE TABLE [dbo].[FactSales]
WITH (
    DISTRIBUTION = HASH([CustomerId]),
    CLUSTERED COLUMNSTORE INDEX
)
AS
SELECT *
FROM [ext].[Sales]
WHERE OrderDate >= '2021-01-01';
```

### INSERT...SELECT

```sql
-- Append data from external source
INSERT INTO [dbo].[FactSales]
SELECT *
FROM [ext].[Sales]
WHERE OrderDate >= '2021-10-01'
  AND OrderDate < '2021-11-01';
```

## PolyBase vs COPY Command

### PolyBase Advantages
- Query data in place without loading
- Join external and internal data
- Support for Hadoop clusters

### COPY Command Advantages
- Faster for pure data loading
- Simpler syntax
- Better error handling

```sql
-- COPY is faster for pure loading
COPY INTO [dbo].[FactSales]
FROM 'https://storageaccount.blob.core.windows.net/container/sales/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET = '...')
);
```

## Partitioned External Tables

### Query Partitioned Data

```sql
-- External table on partitioned data
CREATE EXTERNAL TABLE [ext].[PartitionedSales]
(
    [SalesOrderId] BIGINT,
    [CustomerId] INT,
    [Amount] DECIMAL(18,2)
)
WITH (
    LOCATION = '/sales/year=*/month=*/',
    DATA_SOURCE = AzureDataLake,
    FILE_FORMAT = ParquetFormat
);

-- Use filepath to access partition values
SELECT
    filepath(1) as Year,
    filepath(2) as Month,
    SUM(Amount) as TotalAmount
FROM ext.PartitionedSales
WHERE filepath(1) = '2021'
GROUP BY filepath(1), filepath(2);
```

## Statistics for External Tables

```sql
-- Create statistics for better query plans
CREATE STATISTICS [stats_CustomerId] ON [ext].[Sales]([CustomerId])
WITH SAMPLE 20 PERCENT;

CREATE STATISTICS [stats_OrderDate] ON [ext].[Sales]([OrderDate])
WITH FULLSCAN;

-- Update statistics
UPDATE STATISTICS [ext].[Sales];
```

## Performance Optimization

### Pushdown Optimization

```sql
-- Filters are pushed to external source
SELECT *
FROM ext.Sales
WHERE OrderDate = '2021-10-15'  -- Pushed down
  AND CustomerId = 12345;       -- Pushed down
```

### Parallel Loading

```sql
-- Use multiple files for parallel read
-- Data organized as: sales/part-00000.parquet, sales/part-00001.parquet, etc.
CREATE EXTERNAL TABLE [ext].[ParallelSales]
(...)
WITH (
    LOCATION = '/sales/',  -- Multiple files read in parallel
    DATA_SOURCE = AzureDataLake,
    FILE_FORMAT = ParquetFormat
);
```

### Reject Handling

```sql
-- Configure reject options for data quality
CREATE EXTERNAL TABLE [ext].[SalesWithRejects]
(...)
WITH (
    LOCATION = '/sales/',
    DATA_SOURCE = AzureDataLake,
    FILE_FORMAT = CsvFormat,
    REJECT_TYPE = VALUE,      -- Reject by count
    REJECT_VALUE = 1000       -- Max 1000 rejected rows
);
```

## Monitoring PolyBase Operations

```sql
-- View PolyBase requests
SELECT
    request_id,
    status,
    submit_time,
    total_elapsed_time,
    command
FROM sys.dm_pdw_exec_requests
WHERE command LIKE '%EXTERNAL%'
ORDER BY submit_time DESC;

-- View data movement
SELECT
    request_id,
    step_index,
    operation_type,
    location_type,
    status
FROM sys.dm_pdw_request_steps
WHERE request_id = 'QID1234'
ORDER BY step_index;
```

## Troubleshooting

### Check for Errors

```sql
-- View errors in external table queries
SELECT
    request_id,
    error_id,
    source,
    type,
    create_time,
    message
FROM sys.dm_pdw_errors
WHERE request_id = 'QID1234';
```

### Validate External Resources

```sql
-- Test external data source connectivity
SELECT * FROM ext.Sales WHERE 1=0;

-- If this fails, check:
-- 1. Credential permissions
-- 2. Data source URL
-- 3. Network connectivity
-- 4. File format compatibility
```

## Best Practices

1. **Use Parquet** - Best performance and compression
2. **Partition data** - Enable predicate pushdown
3. **Create statistics** - Improve query optimization
4. **Use managed identity** - Avoid credential management
5. **Size files appropriately** - 256MB to 1GB per file
6. **Handle rejects** - Configure appropriate reject options

## Conclusion

PolyBase enables powerful data virtualization scenarios in Azure Synapse. By understanding how to create and optimize external tables, you can build efficient hybrid analytics solutions that span cloud storage and your data warehouse.

Tomorrow, we'll explore the COPY command for high-performance data loading.

