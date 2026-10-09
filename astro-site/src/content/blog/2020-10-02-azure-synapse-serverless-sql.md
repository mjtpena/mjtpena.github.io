---
title: "Azure Synapse Serverless SQL (Preview): Query Your Data Lake"
description: "A second Synapse-preview note, on what I think is the genuinely new idea in the platform: serverless SQL. Point T-SQL at parquet, CSV, or JSON in your data…"
author: Michael John Peña
draft: false
date: 2020-10-02
tags:
  - Azure
  - Synapse
  - SQL
  - Serverless
---

A second Synapse-preview note, on what I think is the genuinely new idea in the platform: serverless SQL. Point T-SQL at parquet, CSV, or JSON in your data lake, pay per terabyte scanned, no compute to provision. For exploratory analytics — "what's actually in this dataset?" — it's faster and cheaper than spinning up a dedicated SQL pool. Notes are based on the public preview; final pricing and limits may shift before GA.

**Note**: Synapse is in public preview with GA expected in late 2020. Features may change.

## Basic Query

```sql
SELECT TOP 100 *
FROM OPENROWSET(
    BULK 'https://mydatalake.dfs.core.windows.net/raw/sales/*.parquet',
    FORMAT = 'PARQUET'
) AS sales
```

## CSV Files

```sql
SELECT *
FROM OPENROWSET(
    BULK 'https://mydatalake.dfs.core.windows.net/raw/customers/*.csv',
    FORMAT = 'CSV',
    PARSER_VERSION = '2.0',
    HEADER_ROW = TRUE,
    FIELDTERMINATOR = ',',
    ROWTERMINATOR = '\n'
) WITH (
    customer_id INT,
    name VARCHAR(100),
    email VARCHAR(256),
    created_date DATE
) AS customers
```

## Creating Views

```sql
CREATE VIEW curated.vw_monthly_sales
AS
SELECT
    year(sale_date) AS year,
    month(sale_date) AS month,
    region,
    SUM(amount) AS total_sales
FROM OPENROWSET(
    BULK 'https://mydatalake.dfs.core.windows.net/raw/sales/**',
    FORMAT = 'PARQUET'
) AS sales
GROUP BY year(sale_date), month(sale_date), region
```

## External Tables

```sql
CREATE EXTERNAL DATA SOURCE DataLake
WITH (LOCATION = 'https://mydatalake.dfs.core.windows.net/curated/');

CREATE EXTERNAL FILE FORMAT ParquetFormat
WITH (FORMAT_TYPE = PARQUET);

CREATE EXTERNAL TABLE curated.sales (
    sale_id BIGINT,
    customer_id INT,
    amount DECIMAL(18,2),
    sale_date DATE
)
WITH (
    LOCATION = 'sales/',
    DATA_SOURCE = DataLake,
    FILE_FORMAT = ParquetFormat
);
```

## Cost Management

Pricing: ~$5 per TB scanned

Optimize by:
1. **Using Parquet** (columnar, compressed)
2. **Partitioning** by date or other filter columns
3. **Selecting only needed columns**
4. **Filtering early** in queries

```sql
-- Good: Selective query
SELECT sale_date, amount
FROM curated.sales
WHERE sale_date >= '2020-01-01'

-- Bad: Full table scan
SELECT * FROM curated.sales
```

Serverless SQL democratizes data lake access for SQL users.
