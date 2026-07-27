---
title: "Azure Synapse Analytics Updates: What's New in 2022"
author: Michael John Peña
draft: false
date: 2022-02-01
url: /blog/azure-synapse-analytics-updates/
tags:
  - azure
  - synapse
  - analytics
  - data-engineering

---

I wrote "Azure Synapse Analytics Updates: What's New in 2022" to share practical, production-minded guidance on this topic.

## Synapse Link Enhancements

Synapse Link now supports more data sources with improved performance:

```sql
-- Create Synapse Link connection to Cosmos DB
CREATE DATABASE SCOPED CREDENTIAL CosmosDBCredential
WITH IDENTITY = 'Cosmos DB Account',
SECRET = 'your-cosmos-key';

CREATE EXTERNAL DATA SOURCE CosmosDBSource
WITH (
    LOCATION = 'https://yourcosmosaccount.documents.azure.com:443/',
    CREDENTIAL = CosmosDBCredential
);

-- Query Cosmos DB data directly
SELECT TOP 100 *
FROM OPENROWSET(
    PROVIDER = 'CosmosDB',
    CONNECTION = 'Account=yourcosmosaccount;Database=salesdb',
    OBJECT = 'orders',
    SERVER_CREDENTIAL = 'CosmosDBCredential'
) AS orders
WHERE orders.orderDate > '2022-01-01';
```

## Serverless SQL Pool Improvements

```sql
-- New CETAS (Create External Table As Select) improvements
CREATE EXTERNAL TABLE [dbo].[SalesSummary]
WITH (
    LOCATION = 'curated/sales_summary/',
    DATA_SOURCE = DataLakeStorage,
    FILE_FORMAT = ParquetFormat
)
AS
SELECT
    YEAR(OrderDate) as Year,
    MONTH(OrderDate) as Month,
    ProductCategory,
    SUM(Amount) as TotalSales,
    COUNT(*) as OrderCount
FROM OPENROWSET(
    BULK 'raw/sales/**/*.parquet',
    DATA_SOURCE = 'DataLakeStorage',
    FORMAT = 'PARQUET'
) AS sales
GROUP BY
    YEAR(OrderDate),
    MONTH(OrderDate),
    ProductCategory;

-- Query with partition elimination
SELECT *
FROM [dbo].[SalesSummary]
WHERE Year = 2022 AND Month = 1;
```

## Dedicated SQL Pool Updates

```sql
-- Result-set caching improvements
ALTER DATABASE [SynapseDB]
SET RESULT_SET_CACHING ON;

-- Materialized views with automatic refresh
CREATE MATERIALIZED VIEW [dbo].[DailySalesMV]
WITH (DISTRIBUTION = HASH(ProductID))
AS
SELECT
    CAST(OrderDate as DATE) as SaleDate,
    ProductID,
    SUM(Quantity) as TotalQuantity,
    SUM(Amount) as TotalAmount
FROM [dbo].[FactSales]
GROUP BY CAST(OrderDate as DATE), ProductID;

-- Check materialized view freshness
SELECT
    name,
    state_desc,
    is_switched_on,
    percentage_stale_row
FROM sys.pdw_materialized_view_mappings
WHERE name = 'DailySalesMV';
```

## Spark Pool Enhancements

```python
# New Spark 3.2 features in Synapse
from pyspark.sql import SparkSession
from pyspark.sql.functions import *

# Configure Spark pool
spark = SparkSession.builder \
    .appName("SynapseSparkAnalytics") \
    .config("spark.sql.adaptive.enabled", "true") \
    .config("spark.sql.adaptive.coalescePartitions.enabled", "true") \
    .getOrCreate()

# Read from Data Lake with predicate pushdown
df = spark.read \
    .format("delta") \
    .load("abfss://data@storage.dfs.core.windows.net/silver/sales")

# New ANSI SQL mode for better compatibility
spark.conf.set("spark.sql.ansi.enabled", "true")

# Use Synapse Link connector for Cosmos DB
cosmosdf = spark.read \
    .format("cosmos.olap") \
    .option("spark.synapse.linkedService", "CosmosDBLink") \
    .option("spark.cosmos.container", "orders") \
    .load()

# Delta Lake integration improvements
df.write \
    .format("delta") \
    .mode("overwrite") \
    .option("overwriteSchema", "true") \
    .partitionBy("Year", "Month") \
    .save("abfss://data@storage.dfs.core.windows.net/gold/sales_optimized")
```

## Pipeline Improvements

```json
{
  "name": "IncrementalLoadPipeline",
  "properties": {
    "activities": [
      {
        "name": "GetHighWatermark",
        "type": "Lookup",
        "policy": {
          "timeout": "7.00:00:00",
          "retry": 3
        },
        "typeProperties": {
          "source": {
            "type": "SqlPoolSource",
            "sqlReaderQuery": "SELECT MAX(ModifiedDate) as HighWatermark FROM control.Watermarks WHERE TableName = 'Sales'"
          },
          "dataset": {
            "referenceName": "ControlTable",
            "type": "DatasetReference"
          }
        }
      },
      {
        "name": "CopyIncrementalData",
        "type": "Copy",
        "dependsOn": [
          {
            "activity": "GetHighWatermark",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "source": {
            "type": "SqlSource",
            "sqlReaderQuery": {
              "value": "SELECT * FROM dbo.Sales WHERE ModifiedDate > '@{activity('GetHighWatermark').output.firstRow.HighWatermark}'",
              "type": "Expression"
            }
          },
          "sink": {
            "type": "ParquetSink",
            "storeSettings": {
              "type": "AzureBlobFSWriteSettings"
            }
          }
        }
      }
    ]
  }
}
```

## Integrated Monitoring

```kusto
// Synapse workspace diagnostics
SynapseSqlPoolDms
| where Category == "SqlRequests"
| where Duration > 60000  // Queries over 60 seconds
| project
    TimeGenerated,
    LoginName,
    QueryText = substring(Statement, 0, 200),
    Duration = Duration / 1000,
    ResourceClass
| order by Duration desc
| take 20
```

Azure Synapse Analytics in 2022 provides a more unified, performant, and feature-rich analytics platform.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
