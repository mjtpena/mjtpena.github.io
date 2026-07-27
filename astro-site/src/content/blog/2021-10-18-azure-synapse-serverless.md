---
title: "Azure Synapse Serverless SQL Pools for Big Data Analytics"
author: "Michael John Peña"
draft: false
date: 2021-10-18
tags: ["Azure", "Synapse", "SQL", "Serverless", "Big Data"]

---

I wrote "Azure Synapse Serverless SQL Pools for Big Data Analytics" to share practical, production-minded guidance on this topic.

Synapse Serverless SQL Pool is the query engine that turned Azure Data Lake into an ad-hoc analytics platform—you write T-SQL, point it at files in ADLS Gen2, and pay per terabyte of data scanned, with no cluster to provision or manage. The key insight is the separation of compute from storage: your data lives in ADLS Gen2 in Parquet, Delta, or CSV format; the serverless pool brings compute to that data on demand, without ingesting it into a managed database. The `OPENROWSET` function is the foundation—it reads files directly from storage with a defined schema. External tables and views built on top of `OPENROWSET` expose the data lake as a relational schema, so Power BI and other SQL-connected tools can query it without knowing about the underlying file structure. The cost model (per TB scanned) rewards columnar formats and partition pruning—wide CSV scans get expensive fast.

## Understanding Serverless SQL Pools

Key benefits:
- **No infrastructure** - No clusters to manage
- **Pay per query** - Billed by data scanned
- **T-SQL interface** - Familiar SQL syntax
- **Scale automatically** - Handles any data size
- **Query data in place** - No ETL required

## Connecting to Serverless Pool

### Built-in Serverless Endpoint

Every Synapse workspace includes a built-in serverless SQL endpoint:

```
<workspace-name>-ondemand.sql.azuresynapse.net
```

### Connection String

```
Server=tcp:myworkspace-ondemand.sql.azuresynapse.net,1433;
Initial Catalog=master;
Encrypt=True;
TrustServerCertificate=False;
Connection Timeout=30;
Authentication=Active Directory Default;
```

## Querying Data Lake Files

### Query Parquet Files

```sql
-- Query Parquet files directly
SELECT *
FROM OPENROWSET(
    BULK 'https://storageaccount.dfs.core.windows.net/container/path/*.parquet',
    FORMAT = 'PARQUET'
) AS [data]
WHERE data.year = 2021
LIMIT 100;
```

### Query CSV Files

```sql
-- Query CSV with schema inference
SELECT *
FROM OPENROWSET(
    BULK 'https://storageaccount.dfs.core.windows.net/container/logs/*.csv',
    FORMAT = 'CSV',
    PARSER_VERSION = '2.0',
    HEADER_ROW = TRUE
) AS [logs]
WHERE logs.timestamp > '2021-10-01';
```

### Query JSON Files

```sql
-- Query JSON files
SELECT
    JSON_VALUE(doc, '$.id') AS id,
    JSON_VALUE(doc, '$.name') AS name,
    JSON_VALUE(doc, '$.timestamp') AS timestamp
FROM OPENROWSET(
    BULK 'https://storageaccount.dfs.core.windows.net/container/events/*.json',
    FORMAT = 'CSV',
    FIELDTERMINATOR = '0x0b',
    FIELDQUOTE = '0x0b'
) WITH (doc NVARCHAR(MAX)) AS [events];
```

## Creating External Data Sources

### Set Up Credentials

```sql
-- Create master key
CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'StrongP@ssword123!';

-- Create credential for storage access
CREATE DATABASE SCOPED CREDENTIAL AzureStorageCredential
WITH IDENTITY = 'SHARED ACCESS SIGNATURE',
SECRET = 'sv=2020-08-04&ss=bfqt&srt=sco&sp=rwdlacuptfx...';
```

### Create External Data Source

```sql
-- Create external data source
CREATE EXTERNAL DATA SOURCE DataLakeStorage
WITH (
    LOCATION = 'https://storageaccount.dfs.core.windows.net/container',
    CREDENTIAL = AzureStorageCredential
);

-- Query using data source
SELECT *
FROM OPENROWSET(
    BULK 'logs/2021/10/*.parquet',
    DATA_SOURCE = 'DataLakeStorage',
    FORMAT = 'PARQUET'
) AS [data];
```

## Creating External Tables

### Define File Format

```sql
-- Create external file format
CREATE EXTERNAL FILE FORMAT ParquetFormat
WITH (
    FORMAT_TYPE = PARQUET
);

CREATE EXTERNAL FILE FORMAT CsvFormat
WITH (
    FORMAT_TYPE = DELIMITEDTEXT,
    FORMAT_OPTIONS (
        FIELD_TERMINATOR = ',',
        STRING_DELIMITER = '"',
        FIRST_ROW = 2,
        USE_TYPE_DEFAULT = TRUE
    )
);
```

### Create External Table

```sql
-- Create external table
CREATE EXTERNAL TABLE [dbo].[ContainerLogs] (
    [TimeGenerated] DATETIME2,
    [Computer] VARCHAR(255),
    [ContainerID] VARCHAR(255),
    [LogEntry] VARCHAR(MAX),
    [Namespace] VARCHAR(100),
    [PodName] VARCHAR(255)
)
WITH (
    LOCATION = 'logs/',
    DATA_SOURCE = DataLakeStorage,
    FILE_FORMAT = ParquetFormat
);

-- Query external table
SELECT
    Namespace,
    COUNT(*) as LogCount
FROM dbo.ContainerLogs
WHERE TimeGenerated > '2021-10-01'
GROUP BY Namespace;
```

## Working with Partitioned Data

### Query Partitioned Data

```sql
-- Use filepath function to access partition values
SELECT
    data.*,
    data.filepath(1) AS year,
    data.filepath(2) AS month
FROM OPENROWSET(
    BULK 'logs/year=*/month=*/*.parquet',
    DATA_SOURCE = 'DataLakeStorage',
    FORMAT = 'PARQUET'
) AS [data]
WHERE data.filepath(1) = '2021' AND data.filepath(2) = '10';
```

### Create Partitioned External Table

```sql
-- Create external table with partitioned data
CREATE EXTERNAL TABLE [dbo].[PartitionedLogs] (
    [TimeGenerated] DATETIME2,
    [LogEntry] VARCHAR(MAX),
    [Namespace] VARCHAR(100)
)
WITH (
    LOCATION = 'logs/year=*/month=*/',
    DATA_SOURCE = DataLakeStorage,
    FILE_FORMAT = ParquetFormat
);
```

## CETAS - Create External Table As Select

Write query results back to data lake:

```sql
-- Create external table from query results
CREATE EXTERNAL TABLE [dbo].[ErrorSummary]
WITH (
    LOCATION = 'processed/error-summary/',
    DATA_SOURCE = DataLakeStorage,
    FILE_FORMAT = ParquetFormat
)
AS
SELECT
    CAST(TimeGenerated AS DATE) as LogDate,
    Namespace,
    COUNT(*) as ErrorCount
FROM dbo.ContainerLogs
WHERE LogEntry LIKE '%error%'
GROUP BY CAST(TimeGenerated AS DATE), Namespace;
```

## Views for Reusable Queries

```sql
-- Create view for common query pattern
CREATE VIEW vw_PodLogs AS
SELECT
    TimeGenerated,
    Namespace,
    PodName,
    LogEntry,
    CASE
        WHEN LogEntry LIKE '%error%' THEN 'Error'
        WHEN LogEntry LIKE '%warning%' THEN 'Warning'
        ELSE 'Info'
    END AS LogLevel
FROM OPENROWSET(
    BULK 'logs/**/*.parquet',
    DATA_SOURCE = 'DataLakeStorage',
    FORMAT = 'PARQUET'
) AS [logs];

-- Use the view
SELECT
    LogLevel,
    COUNT(*) as Count
FROM vw_PodLogs
WHERE TimeGenerated > DATEADD(day, -7, GETDATE())
GROUP BY LogLevel;
```

## Performance Optimization

### Partition Elimination

```sql
-- Good: Partition columns in WHERE clause
SELECT *
FROM OPENROWSET(
    BULK 'logs/year=2021/month=10/*.parquet',  -- Specific path
    DATA_SOURCE = 'DataLakeStorage',
    FORMAT = 'PARQUET'
) AS [data]
WHERE data.Namespace = 'production';
```

### Column Projection

```sql
-- Good: Select only needed columns
SELECT TimeGenerated, Namespace, LogEntry
FROM OPENROWSET(
    BULK 'logs/**/*.parquet',
    DATA_SOURCE = 'DataLakeStorage',
    FORMAT = 'PARQUET'
) WITH (
    TimeGenerated DATETIME2,
    Namespace VARCHAR(100),
    LogEntry VARCHAR(MAX)
) AS [data];
```

### Statistics

```sql
-- Create statistics for better query plans
CREATE STATISTICS LogStats ON dbo.ContainerLogs (TimeGenerated, Namespace);
```

## Cost Management

### Monitor Data Processed

```sql
-- Check data processed by recent queries
SELECT
    execution_time,
    query_text,
    data_processed_mb,
    result_cache_hit
FROM sys.dm_exec_requests_history
ORDER BY execution_time DESC;
```

### Use Result Caching

```sql
-- Enable result caching
ALTER DATABASE SCOPED CONFIGURATION SET QUERY_RESULT_CACHE = ON;

-- Check cache status
SELECT * FROM sys.dm_pdw_exec_requests
WHERE command LIKE '%ContainerLogs%';
```

## Integration with Spark

Query data created by Spark jobs:

```sql
-- Query Spark Delta Lake tables (via Parquet files)
SELECT *
FROM OPENROWSET(
    BULK 'delta-lake/my-table/_delta_log/*.json',
    DATA_SOURCE = 'DataLakeStorage',
    FORMAT = 'CSV',
    FIELDTERMINATOR = '0x0b',
    FIELDQUOTE = '0x0b'
) AS [delta_log];
```

## Best Practices

1. **Use Parquet format** - Best performance and cost
2. **Partition data** - Enable partition elimination
3. **Project columns** - Select only what you need
4. **Cache credentials** - Use database scoped credentials
5. **Create views** - Simplify complex queries
6. **Monitor costs** - Track data processed

## Conclusion

Azure Synapse serverless SQL pools provide a cost-effective way to query data lake storage using familiar T-SQL. By following best practices for partitioning and column projection, you can build efficient analytics solutions without managing infrastructure.

Tomorrow, we'll explore Synapse dedicated SQL pool best practices for high-performance data warehousing.

