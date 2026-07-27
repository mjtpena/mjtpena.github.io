---
title: "Azure Synapse Serverless SQL: Query Data Lake On-Demand"
author: Michael John Peña
draft: false
date: 2021-01-04
tags:
  - Azure
  - Synapse
  - SQL
  - Data Lake

---

I wrote "Azure Synapse Serverless SQL: Query Data Lake On-Demand" to share practical, production-minded guidance on this topic.

## Query Parquet Files

```sql
-- Query parquet directly from storage
SELECT
    CustomerID,
    OrderDate,
    TotalAmount
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/data/orders/*.parquet',
    FORMAT = 'PARQUET'
) AS orders
WHERE OrderDate >= '2021-01-01'
```

## Query CSV Files

```sql
SELECT *
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/data/sales.csv',
    FORMAT = 'CSV',
    PARSER_VERSION = '2.0',
    HEADER_ROW = TRUE,
    FIELDTERMINATOR = ',',
    ROWTERMINATOR = '\n'
) AS sales
```

## Define Schema with WITH

```sql
SELECT *
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/data/customers.csv',
    FORMAT = 'CSV',
    PARSER_VERSION = '2.0',
    HEADER_ROW = TRUE
) WITH (
    CustomerID INT,
    FirstName VARCHAR(50),
    LastName VARCHAR(50),
    Email VARCHAR(100),
    CreatedDate DATE
) AS customers
```

## Query JSON Files

```sql
SELECT
    JSON_VALUE(doc, '$.customerId') AS customerId,
    JSON_VALUE(doc, '$.order.total') AS total,
    JSON_QUERY(doc, '$.order.items') AS items
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/data/orders.json',
    FORMAT = 'CSV',
    FIELDTERMINATOR = '0x0b',
    FIELDQUOTE = '0x0b'
) WITH (doc NVARCHAR(MAX)) AS orders
```

## Delta Lake Support

```sql
-- Query Delta tables directly
SELECT *
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/delta/sales',
    FORMAT = 'DELTA'
) AS delta_sales
WHERE SaleDate >= '2021-01-01'
```

## Create External Tables

```sql
-- Create database
CREATE DATABASE analytics;

-- Create external data source
CREATE EXTERNAL DATA SOURCE DataLake
WITH (
    LOCATION = 'https://storage.blob.core.windows.net/data'
);

-- Create external file format
CREATE EXTERNAL FILE FORMAT ParquetFormat
WITH (FORMAT_TYPE = PARQUET);

-- Create external table
CREATE EXTERNAL TABLE Sales (
    SaleId INT,
    ProductId INT,
    Quantity INT,
    Amount DECIMAL(10,2),
    SaleDate DATE
)
WITH (
    LOCATION = 'sales/',
    DATA_SOURCE = DataLake,
    FILE_FORMAT = ParquetFormat
);

-- Query like regular table
SELECT * FROM Sales WHERE SaleDate >= '2021-01-01'
```

## Partition Pruning

```sql
-- Leverage partition columns for efficiency
SELECT *
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/data/sales/year=*/month=*/*.parquet',
    FORMAT = 'PARQUET'
) AS sales
WHERE sales.filepath(1) = '2021'  -- year partition
  AND sales.filepath(2) = '01'    -- month partition
```

## Create Views

```sql
CREATE VIEW vw_RecentOrders AS
SELECT
    OrderId,
    CustomerID,
    OrderDate,
    TotalAmount
FROM OPENROWSET(
    BULK 'https://storage.blob.core.windows.net/data/orders/*.parquet',
    FORMAT = 'PARQUET'
) AS orders
WHERE OrderDate >= DATEADD(day, -30, GETDATE())
```

## CETAS (Create External Table As Select)

```sql
-- Transform and persist results
CREATE EXTERNAL TABLE ProcessedSales
WITH (
    LOCATION = 'processed/sales/',
    DATA_SOURCE = DataLake,
    FILE_FORMAT = ParquetFormat
)
AS
SELECT
    CustomerID,
    YEAR(OrderDate) AS Year,
    MONTH(OrderDate) AS Month,
    SUM(TotalAmount) AS TotalSales
FROM OPENROWSET(...) AS orders
GROUP BY CustomerID, YEAR(OrderDate), MONTH(OrderDate)
```

## Cost Optimization

| Tip | Benefit |
|-----|---------|
| Use Parquet | Columnar = less data scanned |
| Partition data | Prune irrelevant files |
| Select specific columns | Don't SELECT * |
| Use external tables | Metadata caching |

Serverless SQL: query anything, pay for what you scan.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
