---
title: "High-Performance Data Loading with COPY Command in Synapse"
author: "Michael John Peña"
draft: false
date: 2021-10-21
tags: ["Azure", "Synapse", "ETL", "Data Loading", "Performance"]

---

I wrote "High-Performance Data Loading with COPY Command in Synapse" to share practical, production-minded guidance on this topic.

The COPY command replaced PolyBase as the recommended data loading mechanism for Synapse Dedicated SQL Pool because it's simpler to use and performs at the same level without requiring external table definitions and database-scoped credentials configured in advance. The syntax is a single T-SQL statement: `COPY INTO target_table FROM 'https://storage.blob.core.windows.net/...' WITH (...)`. It supports CSV, Parquet, ORC, and Delta format, handles authentication via Managed Identity or SAS tokens, and provides row error tolerance (skip malformed rows up to a configured threshold) that PolyBase doesn't support natively. For ELT pipelines where data lands in ADLS Gen2 and needs to be loaded into Synapse, COPY is the right starting point—the reduced setup complexity and equivalent throughput make it the better default for most teams.

## Why Use COPY?

The COPY command provides:
- **Faster loading** - Optimized for Synapse architecture
- **Simpler syntax** - No external objects required
- **Better error handling** - Detailed error messages and options
- **Identity column support** - Auto-generate identity values
- **Flexible authentication** - Multiple credential options

## Basic COPY Syntax

```sql
-- Simple COPY from Parquet files
COPY INTO [dbo].[FactSales]
FROM 'https://storageaccount.blob.core.windows.net/container/sales/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);
```

## Authentication Options

### Managed Identity

```sql
COPY INTO [dbo].[FactSales]
FROM 'https://storageaccount.dfs.core.windows.net/container/data/'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);
```

### Shared Access Signature

```sql
COPY INTO [dbo].[FactSales]
FROM 'https://storageaccount.blob.core.windows.net/container/data/'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Shared Access Signature',
                  SECRET = 'sv=2020-08-04&ss=b&srt=sco&sp=rl...')
);
```

### Storage Account Key

```sql
COPY INTO [dbo].[FactSales]
FROM 'https://storageaccount.blob.core.windows.net/container/data/'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Storage Account Key',
                  SECRET = 'your-storage-account-key')
);
```

## File Format Options

### Parquet Files

```sql
COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET'
);
```

### CSV Files

```sql
COPY INTO [dbo].[FactSales]
(
    [SalesOrderId],
    [OrderDate],
    [CustomerId],
    [Amount]
)
FROM 'https://storage.blob.core.windows.net/container/*.csv'
WITH (
    FILE_TYPE = 'CSV',
    FIELDTERMINATOR = ',',
    ROWTERMINATOR = '\n',
    FIRSTROW = 2,
    ENCODING = 'UTF8',
    FIELDQUOTE = '"'
);
```

### Compressed CSV

```sql
COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/*.csv.gz'
WITH (
    FILE_TYPE = 'CSV',
    COMPRESSION = 'Gzip',
    FIELDTERMINATOR = ','
);
```

## Column Mapping

### Explicit Column Mapping

```sql
COPY INTO [dbo].[FactSales]
(
    [SalesOrderId] 1,     -- First column in file
    [OrderDate] 2,        -- Second column
    [Amount] 4            -- Fourth column (skip third)
)
FROM 'https://storage.blob.core.windows.net/container/*.csv'
WITH (
    FILE_TYPE = 'CSV',
    FIELDTERMINATOR = ','
);
```

### Column Mapping with Default Values

```sql
COPY INTO [dbo].[FactSales]
(
    [SalesOrderId] 1,
    [OrderDate] 2,
    [Amount] 3,
    [LoadDate] DEFAULT GETDATE(),
    [BatchId] DEFAULT 'Batch-001'
)
FROM 'https://storage.blob.core.windows.net/container/*.csv'
WITH (
    FILE_TYPE = 'CSV'
);
```

## Error Handling

### Reject Options

```sql
COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/*.csv'
WITH (
    FILE_TYPE = 'CSV',
    MAXERRORS = 100,              -- Allow up to 100 errors
    ERRORFILE = 'https://storage.blob.core.windows.net/errors/',
    ERRORFILE_CREDENTIAL = (IDENTITY = 'Managed Identity')
);
```

### Viewing Rejected Rows

```sql
-- After COPY with ERRORFILE, check rejected rows
SELECT *
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/errors/FactSales_rejected.csv',
    FORMAT = 'CSV'
) AS errors;
```

## Identity Column Handling

### Auto-Generate Identity Values

```sql
-- Table with identity column
CREATE TABLE [dbo].[FactSales]
(
    [SalesKey] BIGINT IDENTITY(1,1) NOT NULL,
    [SalesOrderId] BIGINT NOT NULL,
    [OrderDate] DATE NOT NULL,
    [Amount] DECIMAL(18,2) NOT NULL
)
WITH (DISTRIBUTION = HASH([SalesOrderId]));

-- COPY generates identity values automatically
COPY INTO [dbo].[FactSales]
(
    [SalesOrderId],
    [OrderDate],
    [Amount]
)
FROM 'https://storage.blob.core.windows.net/container/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    AUTO_CREATE_TABLE = 'OFF'
);
```

## Advanced Scenarios

### Date Format Handling

```sql
COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/*.csv'
WITH (
    FILE_TYPE = 'CSV',
    DATEFORMAT = 'ymd'  -- YYYY-MM-DD format
);
```

### Loading Multiple File Patterns

```sql
-- Load from multiple paths
COPY INTO [dbo].[FactSales]
FROM
    'https://storage.blob.core.windows.net/container/2021/10/*.parquet',
    'https://storage.blob.core.windows.net/container/2021/11/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET'
);
```

### Wildcard Patterns

```sql
-- Use wildcards for flexible file selection
COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/sales/year=2021/month=*/day=*/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET'
);
```

## Performance Optimization

### File Sizing Guidelines

Optimal file sizes for COPY:
- **Minimum**: 256 MB per file
- **Optimal**: 256 MB to 1 GB per file
- **Avoid**: Many small files or few huge files

### Parallel Loading

```sql
-- COPY automatically parallelizes across files
-- Structure data as multiple files for best performance

-- Good: /sales/part-00000.parquet through part-00059.parquet
-- This maps to 60 distributions

COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/sales/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET'
);
```

### Compression Recommendations

```sql
-- Parquet with Snappy compression (best overall)
-- Already compressed, no COMPRESSION option needed
COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET'
);

-- CSV with Gzip (good compression ratio)
COPY INTO [dbo].[FactSales]
FROM 'https://storage.blob.core.windows.net/container/*.csv.gz'
WITH (
    FILE_TYPE = 'CSV',
    COMPRESSION = 'Gzip'
);
```

## Monitoring COPY Operations

### Check COPY Progress

```sql
SELECT
    request_id,
    status,
    percent_complete,
    total_elapsed_time,
    row_count,
    command
FROM sys.dm_pdw_exec_requests
WHERE command LIKE '%COPY%'
ORDER BY submit_time DESC;
```

### View Detailed Steps

```sql
SELECT
    step_index,
    operation_type,
    location_type,
    status,
    row_count,
    total_elapsed_time
FROM sys.dm_pdw_request_steps
WHERE request_id = 'QID1234'
ORDER BY step_index;
```

## Comparison: COPY vs PolyBase vs BCP

| Feature | COPY | PolyBase | BCP |
|---------|------|----------|-----|
| Performance | Fastest | Fast | Slower |
| Setup | Simple | Complex | Simple |
| Error Handling | Excellent | Good | Basic |
| Query Data in Place | No | Yes | No |
| Identity Columns | Yes | No | Yes |

## ETL Pattern with COPY

```sql
-- Common ETL pattern using COPY
BEGIN TRANSACTION;

-- Truncate staging
TRUNCATE TABLE [staging].[Sales];

-- Load new data
COPY INTO [staging].[Sales]
FROM 'https://storage.blob.core.windows.net/incoming/sales_*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);

-- Merge into fact table
MERGE [dbo].[FactSales] AS target
USING [staging].[Sales] AS source
ON target.SalesOrderId = source.SalesOrderId
WHEN MATCHED THEN
    UPDATE SET Amount = source.Amount, ModifiedDate = GETDATE()
WHEN NOT MATCHED THEN
    INSERT (SalesOrderId, OrderDate, Amount, LoadDate)
    VALUES (source.SalesOrderId, source.OrderDate, source.Amount, GETDATE());

COMMIT;
```

## Best Practices

1. **Use Parquet format** - Best performance and compression
2. **Size files appropriately** - 256MB to 1GB per file
3. **Use Managed Identity** - Simplifies credential management
4. **Handle errors** - Configure MAXERRORS and ERRORFILE
5. **Monitor progress** - Track long-running COPY operations
6. **Match file count to distributions** - 60 files for optimal parallelism

## Conclusion

The COPY command is the preferred method for loading data into Synapse dedicated SQL pools. Its combination of performance, simplicity, and robust error handling makes it the go-to choice for ETL workloads.

Tomorrow, we'll explore result set caching for accelerating repeated queries.

