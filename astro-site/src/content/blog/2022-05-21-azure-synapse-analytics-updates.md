---
title: "Azure Synapse Analytics: Build 2022 Updates"
author: Michael John Peña
draft: false
date: 2022-05-21
tags:
  - Azure
  - Synapse
  - data-analytics
  - big-data
---

## Synapse Link Enhancements

Connect operational data to analytics:

```sql
-- Create Synapse Link for Cosmos DB
CREATE EXTERNAL DATA SOURCE CosmosDB_Analytics
WITH (
    LOCATION = 'https://mycosmosaccount.documents.azure.com:443/',
    CREDENTIAL = CosmosCredential
);

-- Query Cosmos DB data directly
SELECT
    c.customerId,
    c.name,
    c.email,
    COUNT(o.orderId) as orderCount,
    SUM(o.totalAmount) as totalSpent
FROM OPENROWSET(
    PROVIDER = 'CosmosDB',
    CONNECTION = 'Account=mycosmosaccount;Database=ecommerce',
    OBJECT = 'customers',
    SERVER_CREDENTIAL = 'CosmosCredential'
) AS c
JOIN OPENROWSET(
    PROVIDER = 'CosmosDB',
    CONNECTION = 'Account=mycosmosaccount;Database=ecommerce',
    OBJECT = 'orders',
    SERVER_CREDENTIAL = 'CosmosCredential'
) AS o ON c.customerId = o.customerId
GROUP BY c.customerId, c.name, c.email
ORDER BY totalSpent DESC;
```

## Serverless SQL Pool Improvements

Enhanced query capabilities:

```sql
-- Query Parquet files with automatic schema inference
SELECT
    year,
    month,
    productCategory,
    SUM(revenue) as totalRevenue,
    COUNT(DISTINCT customerId) as uniqueCustomers,
    AVG(orderValue) as avgOrderValue
FROM OPENROWSET(
    BULK 'https://datalake.blob.core.windows.net/sales/**/*.parquet',
    FORMAT = 'PARQUET'
) AS sales
WHERE year = 2022
GROUP BY ROLLUP(year, month, productCategory)
ORDER BY year, month, productCategory;

-- Create external table with partitioning
CREATE EXTERNAL TABLE dbo.SalesPartitioned
WITH (
    LOCATION = 'sales/partitioned/',
    DATA_SOURCE = DataLakeStorage,
    FILE_FORMAT = ParquetFormat,
    PARTITION_KEY = 'year,month'
)
AS
SELECT
    *,
    YEAR(orderDate) as year,
    MONTH(orderDate) as month
FROM staging.Sales;

-- Query with partition elimination
SELECT *
FROM dbo.SalesPartitioned
WHERE year = 2022 AND month = 5;  -- Automatically filters partitions
```

## Spark Pool Integration

Use Spark for complex analytics:

```python
# PySpark notebook for customer analytics
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.clustering import KMeans

# Read data from Delta Lake
customers_df = spark.read.format("delta").load(
    "abfss://analytics@datalake.dfs.core.windows.net/customers"
)

orders_df = spark.read.format("delta").load(
    "abfss://analytics@datalake.dfs.core.windows.net/orders"
)

# Customer RFM analysis
rfm_df = orders_df.groupBy("customerId").agg(
    datediff(current_date(), max("orderDate")).alias("recency"),
    count("orderId").alias("frequency"),
    sum("totalAmount").alias("monetary")
)

# Feature engineering
assembler = VectorAssembler(
    inputCols=["recency", "frequency", "monetary"],
    outputCol="features"
)
rfm_features = assembler.transform(rfm_df)

# K-means clustering for customer segmentation
kmeans = KMeans(k=4, seed=42)
model = kmeans.fit(rfm_features)
predictions = model.transform(rfm_features)

# Save results to Delta Lake
predictions.select(
    "customerId", "recency", "frequency", "monetary", "prediction"
).write.format("delta").mode("overwrite").save(
    "abfss://analytics@datalake.dfs.core.windows.net/customer_segments"
)

# Display cluster centers
print("Cluster Centers:")
for i, center in enumerate(model.clusterCenters()):
    print(f"Cluster {i}: Recency={center[0]:.2f}, Frequency={center[1]:.2f}, Monetary={center[2]:.2f}")
```

## Data Explorer Integration

Time-series and log analytics:

```kql
// Kusto Query Language in Synapse Data Explorer

// Analyze IoT sensor data
SensorReadings
| where Timestamp > ago(24h)
| summarize
    AvgTemperature = avg(Temperature),
    MaxTemperature = max(Temperature),
    MinTemperature = min(Temperature),
    ReadingCount = count()
    by SensorId, bin(Timestamp, 1h)
| order by Timestamp desc

// Detect anomalies in sensor data
SensorReadings
| where Timestamp > ago(7d)
| make-series AvgTemp=avg(Temperature) on Timestamp step 1h by SensorId
| extend anomalies = series_decompose_anomalies(AvgTemp)
| mv-expand Timestamp, AvgTemp, anomalies
| where anomalies != 0
| project Timestamp, SensorId, AvgTemp, AnomalyScore = anomalies

// Log analytics for application monitoring
AppLogs
| where Timestamp > ago(1h)
| where Level == "Error"
| summarize ErrorCount = count() by ServiceName, ErrorMessage
| top 10 by ErrorCount
| render barchart
```

## Pipeline Orchestration

Build data pipelines:

```json
{
    "name": "DailyETLPipeline",
    "properties": {
        "activities": [
            {
                "name": "ExtractFromSource",
                "type": "Copy",
                "inputs": [
                    {
                        "referenceName": "SourceSQL",
                        "type": "DatasetReference"
                    }
                ],
                "outputs": [
                    {
                        "referenceName": "StagingParquet",
                        "type": "DatasetReference"
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT * FROM Orders WHERE ModifiedDate > @{pipeline().parameters.LastRunDate}"
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
                        "activity": "ExtractFromSource",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "notebook": {
                        "referenceName": "TransformOrders",
                        "type": "NotebookReference"
                    },
                    "parameters": {
                        "inputPath": {
                            "value": "@pipeline().parameters.StagingPath",
                            "type": "string"
                        },
                        "outputPath": {
                            "value": "@pipeline().parameters.OutputPath",
                            "type": "string"
                        }
                    }
                }
            },
            {
                "name": "LoadToDWH",
                "type": "SqlPoolStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "TransformWithSpark",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "dbo.usp_LoadOrders",
                    "storedProcedureParameters": {
                        "SourcePath": {
                            "value": "@pipeline().parameters.OutputPath",
                            "type": "String"
                        }
                    }
                }
            }
        ],
        "parameters": {
            "LastRunDate": {
                "type": "string",
                "defaultValue": "2022-01-01"
            },
            "StagingPath": {
                "type": "string"
            },
            "OutputPath": {
                "type": "string"
            }
        }
    }
}
```

## Dedicated SQL Pool Optimization

```sql
-- Create optimized table with distribution
CREATE TABLE dbo.FactSales
WITH (
    DISTRIBUTION = HASH(CustomerKey),
    CLUSTERED COLUMNSTORE INDEX,
    PARTITION (OrderDateKey RANGE RIGHT FOR VALUES
        (20220101, 20220201, 20220301, 20220401, 20220501, 20220601))
)
AS
SELECT
    s.SalesOrderId,
    c.CustomerKey,
    p.ProductKey,
    d.DateKey as OrderDateKey,
    s.Quantity,
    s.UnitPrice,
    s.TotalAmount,
    s.DiscountAmount
FROM staging.Sales s
JOIN dbo.DimCustomer c ON s.CustomerId = c.CustomerId
JOIN dbo.DimProduct p ON s.ProductId = p.ProductId
JOIN dbo.DimDate d ON CAST(s.OrderDate as DATE) = d.Date;

-- Create statistics for query optimization
CREATE STATISTICS stat_FactSales_CustomerKey ON dbo.FactSales (CustomerKey);
CREATE STATISTICS stat_FactSales_OrderDateKey ON dbo.FactSales (OrderDateKey);

-- Materialized view for common aggregations
CREATE MATERIALIZED VIEW dbo.vw_DailySalesSummary
WITH (DISTRIBUTION = HASH(OrderDateKey))
AS
SELECT
    OrderDateKey,
    CustomerKey,
    COUNT_BIG(*) as OrderCount,
    SUM(TotalAmount) as TotalRevenue,
    SUM(Quantity) as TotalQuantity
FROM dbo.FactSales
GROUP BY OrderDateKey, CustomerKey;
```

## Summary

Azure Synapse Analytics at Build 2022 delivers:

- Enhanced Synapse Link for real-time analytics
- Improved serverless SQL capabilities
- Better Spark and Data Explorer integration
- Streamlined pipeline orchestration
- Optimized dedicated SQL pools

Build unified analytics solutions across all your data.
