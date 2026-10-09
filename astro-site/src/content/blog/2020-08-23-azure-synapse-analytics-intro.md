---
title: "Introduction to Azure Synapse Analytics"
description: "\"We have a data warehouse and a Hadoop cluster and they don't talk to each other\" was a sentence I heard for years. Synapse is Microsoft's answer: a single…"
author: Michael John Peña
draft: false
date: 2020-08-23
tags:
  - Azure
  - Synapse
  - Data Analytics
  - Big Data
---

"We have a data warehouse and a Hadoop cluster and they don't talk to each other" was a sentence I heard for years. Synapse is Microsoft's answer: a single workspace where dedicated SQL pools (the old SQL DW), serverless SQL, Spark, and pipelines coexist. The unified-experience claim is genuine — you can query a parquet file in ADLS from a notebook, then immediately write a SQL query against the same data without moving it. A first-day tour with the bits I find useful and the bits I treat carefully.

## What is Azure Synapse?

Azure Synapse combines:
- **Dedicated SQL pools** - MPP data warehouse (formerly SQL DW)
- **Serverless SQL pools** - Query data lake without loading
- **Spark pools** - Big data processing
- **Pipelines** - Data integration (Data Factory)
- **Studio** - Unified workspace

## Creating a Synapse Workspace

```bash
# Create a storage account for the data lake
az storage account create \
    --name synapsedatalake2020 \
    --resource-group rg-analytics \
    --location australiaeast \
    --sku Standard_LRS \
    --kind StorageV2 \
    --enable-hierarchical-namespace true

# Create the Synapse workspace
az synapse workspace create \
    --name synapse-analytics-2020 \
    --resource-group rg-analytics \
    --storage-account synapsedatalake2020 \
    --file-system synapse-fs \
    --sql-admin-login-user sqladmin \
    --sql-admin-login-password 'YourSecurePassword123!' \
    --location australiaeast
```

## Dedicated SQL Pool

Create a dedicated pool for data warehousing:

```bash
# Create a dedicated SQL pool
az synapse sql pool create \
    --name dwpool \
    --workspace-name synapse-analytics-2020 \
    --resource-group rg-analytics \
    --performance-level DW100c
```

### Creating Tables

```sql
-- Create a dimension table
CREATE TABLE dbo.DimCustomer
(
    CustomerKey INT NOT NULL,
    CustomerName NVARCHAR(100) NOT NULL,
    Email NVARCHAR(255),
    Country NVARCHAR(50),
    CreatedDate DATE
)
WITH
(
    DISTRIBUTION = REPLICATE,
    CLUSTERED COLUMNSTORE INDEX
);

-- Create a fact table
CREATE TABLE dbo.FactSales
(
    SalesKey BIGINT NOT NULL,
    CustomerKey INT NOT NULL,
    ProductKey INT NOT NULL,
    OrderDate DATE NOT NULL,
    Quantity INT NOT NULL,
    UnitPrice DECIMAL(10, 2) NOT NULL,
    TotalAmount DECIMAL(10, 2) NOT NULL
)
WITH
(
    DISTRIBUTION = HASH(CustomerKey),
    CLUSTERED COLUMNSTORE INDEX,
    PARTITION (OrderDate RANGE RIGHT FOR VALUES
        ('2020-01-01', '2020-04-01', '2020-07-01', '2020-10-01'))
);
```

### Loading Data with COPY

```sql
-- Load data from data lake
COPY INTO dbo.FactSales
FROM 'https://synapsedatalake2020.dfs.core.windows.net/raw/sales/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);

-- Load from CSV
COPY INTO dbo.DimCustomer
FROM 'https://synapsedatalake2020.dfs.core.windows.net/raw/customers/*.csv'
WITH (
    FILE_TYPE = 'CSV',
    FIRSTROW = 2,
    FIELDTERMINATOR = ',',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);
```

## Serverless SQL Pool

Query data lake directly:

```sql
-- Query Parquet files
SELECT
    CustomerName,
    SUM(TotalAmount) as TotalRevenue,
    COUNT(*) as OrderCount
FROM OPENROWSET(
    BULK 'https://synapsedatalake2020.dfs.core.windows.net/raw/sales/2020/*.parquet',
    FORMAT = 'PARQUET'
) AS sales
JOIN OPENROWSET(
    BULK 'https://synapsedatalake2020.dfs.core.windows.net/raw/customers/*.parquet',
    FORMAT = 'PARQUET'
) AS customers ON sales.CustomerKey = customers.CustomerKey
GROUP BY CustomerName
ORDER BY TotalRevenue DESC;

-- Create external table for repeated queries
CREATE EXTERNAL DATA SOURCE DataLake
WITH (
    LOCATION = 'https://synapsedatalake2020.dfs.core.windows.net/raw'
);

CREATE EXTERNAL FILE FORMAT ParquetFormat
WITH (
    FORMAT_TYPE = PARQUET,
    DATA_COMPRESSION = 'org.apache.hadoop.io.compress.SnappyCodec'
);

CREATE EXTERNAL TABLE dbo.ExternalSales
WITH (
    LOCATION = 'sales/',
    DATA_SOURCE = DataLake,
    FILE_FORMAT = ParquetFormat
)
AS SELECT * FROM OPENROWSET(
    BULK 'https://synapsedatalake2020.dfs.core.windows.net/raw/sales/*.parquet',
    FORMAT = 'PARQUET'
) AS sales;
```

## Spark Pools

Create and use Spark for big data:

```bash
# Create a Spark pool
az synapse spark pool create \
    --name sparkpool \
    --workspace-name synapse-analytics-2020 \
    --resource-group rg-analytics \
    --spark-version 2.4 \
    --node-count 3 \
    --node-size Medium
```

### PySpark Notebook

```python
# Read data from data lake
df = spark.read.parquet("abfss://synapse-fs@synapsedatalake2020.dfs.core.windows.net/raw/sales/")

# Transform data
from pyspark.sql.functions import col, sum, count, avg

sales_summary = df \
    .groupBy("CustomerKey", "ProductKey") \
    .agg(
        sum("TotalAmount").alias("TotalRevenue"),
        count("*").alias("TransactionCount"),
        avg("Quantity").alias("AvgQuantity")
    )

# Write to data lake
sales_summary.write \
    .mode("overwrite") \
    .parquet("abfss://synapse-fs@synapsedatalake2020.dfs.core.windows.net/processed/sales_summary/")

# Write to dedicated SQL pool
sales_summary.write \
    .format("com.databricks.spark.sqldw") \
    .option("url", jdbc_url) \
    .option("tempDir", "abfss://synapse-fs@synapsedatalake2020.dfs.core.windows.net/temp/") \
    .option("forwardSparkAzureStorageCredentials", "true") \
    .option("dbTable", "dbo.SalesSummary") \
    .mode("overwrite") \
    .save()
```

## Data Pipelines

Create pipelines for data movement:

```json
{
    "name": "DailyDataIngestion",
    "properties": {
        "activities": [
            {
                "name": "CopyFromSource",
                "type": "Copy",
                "inputs": [
                    {
                        "referenceName": "SourceDataset",
                        "type": "DatasetReference"
                    }
                ],
                "outputs": [
                    {
                        "referenceName": "DataLakeDataset",
                        "type": "DatasetReference"
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "SqlSource",
                        "sqlReaderQuery": "SELECT * FROM Sales WHERE ModifiedDate >= '@{pipeline().parameters.startDate}'"
                    },
                    "sink": {
                        "type": "ParquetSink"
                    }
                }
            },
            {
                "name": "TransformWithSpark",
                "type": "SynapseNotebook",
                "dependsOn": [
                    {
                        "activity": "CopyFromSource",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "notebook": {
                        "referenceName": "TransformSalesData",
                        "type": "NotebookReference"
                    },
                    "parameters": {
                        "inputPath": {
                            "value": "@pipeline().parameters.dataPath",
                            "type": "string"
                        }
                    }
                }
            }
        ]
    }
}
```

## Security

```sql
-- Column-level security
CREATE USER DataAnalyst FROM EXTERNAL PROVIDER;
GRANT SELECT ON dbo.FactSales(OrderDate, Quantity, ProductKey) TO DataAnalyst;
DENY SELECT ON dbo.FactSales(UnitPrice, TotalAmount) TO DataAnalyst;

-- Row-level security
CREATE FUNCTION dbo.fn_SecurityPredicate(@Country AS NVARCHAR(50))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS result
WHERE @Country = USER_NAME() OR USER_NAME() = 'admin';

CREATE SECURITY POLICY SalesFilter
ADD FILTER PREDICATE dbo.fn_SecurityPredicate(Country) ON dbo.DimCustomer;
```

Azure Synapse Analytics provides a unified platform for all your analytics needs, from data warehousing to big data processing.

A practical note for anyone evaluating it: serverless SQL is the part of Synapse that surprises people most. You can point it at parquet files in ADLS, write SQL, and pay per TB scanned — no provisioning, no idle cost. For exploratory analytics over a data lake, it's frequently the right answer before you commit to a dedicated SQL pool's hourly cost. Start serverless, scale to dedicated only when query patterns and SLAs justify it.
