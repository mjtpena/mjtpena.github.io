---
title: "Azure Synapse Dedicated SQL Pools (Preview): Enterprise Data Warehousing"
description: "Note: While dedicated SQL pools are mature (evolved from Azure SQL DW), the Synapse unified experience is still in preview."
author: Michael John Peña
draft: false
date: 2020-10-25
tags:
  - Azure
  - Synapse
  - SQL
  - Data Warehouse
---

**Note**: While dedicated SQL pools are mature (evolved from Azure SQL DW), the Synapse unified experience is still in preview.

## Architecture

```
┌──────────────────────────────────────────────┐
│              Control Node                      │
│         (Query parsing, optimization)          │
└─────────────────────┬────────────────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
┌───┴───┐        ┌───┴───┐        ┌───┴───┐
│Compute│        │Compute│        │Compute│
│Node 1 │        │Node 2 │        │Node N │
└───┬───┘        └───┬───┘        └───┬───┘
    │                │                 │
┌───┴────────────────┴────────────────┴───┐
│            Azure Storage                  │
│      (60 distributions across nodes)      │
└─────────────────────────────────────────┘
```

## Creating a Pool

```sql
-- In Synapse workspace
CREATE DATABASE mywarehouse
COLLATE Latin1_General_100_BIN2_UTF8;

-- Scale DWUs (Data Warehouse Units)
ALTER DATABASE mywarehouse
MODIFY (SERVICE_OBJECTIVE = 'DW1000c');
```

## Table Distribution

### Hash Distribution

```sql
-- Best for large fact tables
CREATE TABLE FactSales (
    SalesKey BIGINT NOT NULL,
    DateKey INT NOT NULL,
    ProductKey INT NOT NULL,
    CustomerKey INT NOT NULL,
    Amount DECIMAL(18,2)
)
WITH (
    DISTRIBUTION = HASH(CustomerKey),
    CLUSTERED COLUMNSTORE INDEX
);
```

### Round Robin

```sql
-- For staging tables or when no good hash column
CREATE TABLE StgSales (
    SalesKey BIGINT,
    DateKey INT,
    Amount DECIMAL(18,2)
)
WITH (
    DISTRIBUTION = ROUND_ROBIN,
    HEAP
);
```

### Replicated

```sql
-- For small dimension tables (< 2GB)
CREATE TABLE DimProduct (
    ProductKey INT NOT NULL,
    ProductName NVARCHAR(100),
    Category NVARCHAR(50)
)
WITH (
    DISTRIBUTION = REPLICATE,
    CLUSTERED COLUMNSTORE INDEX
);
```

## Best Practices

### Distribution Key Selection

```sql
-- Good: High cardinality, evenly distributed, frequently joined
DISTRIBUTION = HASH(CustomerKey)  -- millions of customers

-- Bad: Low cardinality, skewed data
DISTRIBUTION = HASH(Country)  -- few countries, uneven data
```

### Columnstore Indexes

```sql
-- Default for fact tables - best compression and performance
CREATE TABLE FactSales (...)
WITH (CLUSTERED COLUMNSTORE INDEX);

-- Check index health
SELECT
    object_name(object_id) AS table_name,
    avg_fragmentation_in_percent
FROM sys.dm_pdw_dms_external_work
WHERE type = 'COLUMNSTORE_REBUILD';
```

## Loading Data

### COPY Command (Recommended)

```sql
COPY INTO FactSales
FROM 'https://mystorageaccount.blob.core.windows.net/data/sales/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);
```

### PolyBase

```sql
-- External data source
CREATE EXTERNAL DATA SOURCE AzureBlob
WITH (
    TYPE = HADOOP,
    LOCATION = 'wasbs://data@mystorageaccount.blob.core.windows.net',
    CREDENTIAL = MyBlobCredential
);

-- External file format
CREATE EXTERNAL FILE FORMAT ParquetFormat
WITH (FORMAT_TYPE = PARQUET);

-- External table
CREATE EXTERNAL TABLE ExtSales (
    SalesKey BIGINT,
    Amount DECIMAL(18,2)
)
WITH (
    LOCATION = '/sales/',
    DATA_SOURCE = AzureBlob,
    FILE_FORMAT = ParquetFormat
);

-- Load via CTAS
CREATE TABLE FactSales
WITH (DISTRIBUTION = HASH(CustomerKey))
AS SELECT * FROM ExtSales;
```

## Performance Tuning

```sql
-- Check data skew
DBCC PDW_SHOWSPACEUSED('FactSales');

-- Explain query plan
EXPLAIN SELECT * FROM FactSales WHERE CustomerKey = 123;

-- Update statistics
UPDATE STATISTICS FactSales;

-- Rebuild indexes
ALTER INDEX ALL ON FactSales REBUILD;
```

## Pause and Resume

```bash
# Pause to save costs
az synapse sql pool pause --name mypool --workspace-name myws --resource-group myRG

# Resume when needed
az synapse sql pool resume --name mypool --workspace-name myws --resource-group myRG
```

Dedicated SQL pools deliver warehouse-scale analytics performance.
