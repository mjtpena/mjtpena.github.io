---
title: Real-Time Analytics with Azure Synapse Link for Cosmos DB
description: "\"Run analytics on Cosmos data without burning RU/s on the OLTP container\" used to mean ETL-by-night. Synapse Link makes the trade-off go away. A…"
author: Michael John Pena
draft: false
date: 2021-01-28
url: /blog/synapse-link-cosmos-db/
tags:
  - Azure
  - Synapse Analytics
  - CosmosDB
  - Analytics
  - HTAP
---

"Run analytics on Cosmos data without burning RU/s on the OLTP container" used to mean ETL-by-night. Synapse Link makes the trade-off go away. A column-oriented analytical store sits next to your transactional containers, automatically synced, and Synapse can query it without touching the operational throughput. The first time I demoed a Spark notebook running aggregations against a hot ecommerce database while the live order flow continued unaffected, the architect on the call cancelled the planned ETL pipeline. Today's post is how to wire it up properly.

## Understanding Synapse Link Architecture

Synapse Link creates an analytical store that is:
- Automatically synced from transactional store (near real-time)
- Column-oriented for analytical queries
- Isolated from transactional workloads
- Accessible via Synapse Spark and SQL Serverless

## Enabling Synapse Link

### Configure Cosmos DB Account

```bash
# Enable Synapse Link on existing account
az cosmosdb update \
    --name my-cosmos-account \
    --resource-group my-rg \
    --enable-analytical-storage true
```

### Enable Analytical Store on Container

```bicep
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2021-06-15' = {
  name: 'cosmos-analytics'
  location: location
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAnalyticalStorage: true
    analyticalStorageConfiguration: {
      schemaType: 'WellDefined'  // or 'FullFidelity'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2021-06-15' = {
  parent: cosmosAccount
  name: 'ecommerce'
  properties: {
    resource: {
      id: 'ecommerce'
    }
  }
}

resource ordersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2021-06-15' = {
  parent: database
  name: 'orders'
  properties: {
    resource: {
      id: 'orders'
      partitionKey: {
        paths: ['/customerId']
        kind: 'Hash'
      }
      analyticalStorageTtl: -1  // Enable analytical store, never expire
      defaultTtl: -1
    }
  }
}
```

## Querying with Synapse SQL Serverless

### Create Linked Service

```sql
-- Create credential for Cosmos DB
CREATE CREDENTIAL [CosmosDBCredential]
WITH IDENTITY = 'SHARED ACCESS SIGNATURE',
SECRET = '<cosmos-db-account-key>';

-- Query analytical store directly
SELECT TOP 100
    JSON_VALUE(doc, '$.orderId') as OrderId,
    JSON_VALUE(doc, '$.customerId') as CustomerId,
    JSON_VALUE(doc, '$.status') as Status,
    CAST(JSON_VALUE(doc, '$.totalAmount') AS DECIMAL(18,2)) as TotalAmount,
    JSON_VALUE(doc, '$.orderDate') as OrderDate
FROM OPENROWSET(
    'CosmosDB',
    'Account=my-cosmos-account;Database=ecommerce;Key=<key>',
    orders
) WITH (doc NVARCHAR(MAX)) as rows
WHERE JSON_VALUE(doc, '$.status') = 'Completed';
```

### Create External Table

```sql
-- Create database
CREATE DATABASE AnalyticsDB;
GO

USE AnalyticsDB;
GO

-- Create external data source
CREATE EXTERNAL DATA SOURCE CosmosDB_Orders
WITH (
    LOCATION = 'https://my-cosmos-account.documents.azure.com:443/',
    CREDENTIAL = CosmosDBCredential
);

-- Create external table with schema
CREATE EXTERNAL TABLE Orders (
    orderId VARCHAR(50),
    customerId VARCHAR(50),
    status VARCHAR(20),
    totalAmount DECIMAL(18,2),
    orderDate DATETIME2,
    items NVARCHAR(MAX)  -- JSON array
)
WITH (
    LOCATION = 'ecommerce.orders',
    DATA_SOURCE = CosmosDB_Orders,
    CREDENTIAL = CosmosDBCredential
);

-- Query the external table
SELECT
    customerId,
    COUNT(*) as OrderCount,
    SUM(totalAmount) as TotalRevenue,
    AVG(totalAmount) as AvgOrderValue
FROM Orders
WHERE orderDate >= DATEADD(day, -30, GETUTCDATE())
GROUP BY customerId
ORDER BY TotalRevenue DESC;
```

### Working with Nested JSON

```sql
-- Extract nested items from orders
SELECT
    o.orderId,
    o.customerId,
    items.productId,
    items.productName,
    items.quantity,
    items.unitPrice,
    items.quantity * items.unitPrice as LineTotal
FROM Orders o
CROSS APPLY OPENJSON(o.items)
WITH (
    productId VARCHAR(50) '$.productId',
    productName VARCHAR(200) '$.productName',
    quantity INT '$.quantity',
    unitPrice DECIMAL(18,2) '$.unitPrice'
) as items
WHERE o.orderDate >= '2021-01-01';

-- Aggregate by product
SELECT
    items.productId,
    items.productName,
    SUM(items.quantity) as TotalQuantitySold,
    SUM(items.quantity * items.unitPrice) as TotalRevenue,
    COUNT(DISTINCT o.orderId) as OrderCount
FROM Orders o
CROSS APPLY OPENJSON(o.items)
WITH (
    productId VARCHAR(50) '$.productId',
    productName VARCHAR(200) '$.productName',
    quantity INT '$.quantity',
    unitPrice DECIMAL(18,2) '$.unitPrice'
) as items
GROUP BY items.productId, items.productName
ORDER BY TotalRevenue DESC;
```

## Synapse Spark Integration

### Reading from Analytical Store

```python
# PySpark in Synapse Notebook

# Configure Cosmos DB connection
cosmosConfig = {
    "spark.synapse.linkedService": "CosmosDB_LinkedService",
    "spark.cosmos.container": "orders",
    "spark.cosmos.database": "ecommerce"
}

# Read from analytical store
orders_df = spark.read \
    .format("cosmos.olap") \
    .options(**cosmosConfig) \
    .load()

# Show schema (automatically inferred)
orders_df.printSchema()

# Perform analytics
from pyspark.sql.functions import *

# Daily revenue analysis
daily_revenue = orders_df \
    .filter(col("status") == "Completed") \
    .withColumn("orderDate", to_date(col("orderDate"))) \
    .groupBy("orderDate") \
    .agg(
        count("*").alias("orderCount"),
        sum("totalAmount").alias("revenue"),
        avg("totalAmount").alias("avgOrderValue"),
        countDistinct("customerId").alias("uniqueCustomers")
    ) \
    .orderBy(desc("orderDate"))

display(daily_revenue)
```

### Customer Segmentation Analysis

```python
from pyspark.sql.functions import *
from pyspark.sql.window import Window

# Customer lifetime value calculation
customer_metrics = orders_df \
    .filter(col("status") == "Completed") \
    .groupBy("customerId") \
    .agg(
        count("*").alias("orderCount"),
        sum("totalAmount").alias("lifetimeValue"),
        avg("totalAmount").alias("avgOrderValue"),
        min("orderDate").alias("firstOrder"),
        max("orderDate").alias("lastOrder"),
        datediff(max("orderDate"), min("orderDate")).alias("customerTenureDays")
    )

# RFM Segmentation
reference_date = orders_df.agg(max("orderDate")).collect()[0][0]

rfm_df = orders_df \
    .filter(col("status") == "Completed") \
    .groupBy("customerId") \
    .agg(
        datediff(lit(reference_date), max("orderDate")).alias("recency"),
        count("*").alias("frequency"),
        sum("totalAmount").alias("monetary")
    )

# Calculate percentile-based scores
for metric in ["recency", "frequency", "monetary"]:
    quantiles = rfm_df.approxQuantile(metric, [0.25, 0.5, 0.75], 0.05)

    if metric == "recency":
        # Lower recency is better
        rfm_df = rfm_df.withColumn(
            f"{metric}_score",
            when(col(metric) <= quantiles[0], 4)
            .when(col(metric) <= quantiles[1], 3)
            .when(col(metric) <= quantiles[2], 2)
            .otherwise(1)
        )
    else:
        # Higher frequency/monetary is better
        rfm_df = rfm_df.withColumn(
            f"{metric}_score",
            when(col(metric) >= quantiles[2], 4)
            .when(col(metric) >= quantiles[1], 3)
            .when(col(metric) >= quantiles[0], 2)
            .otherwise(1)
        )

# Create RFM segment
rfm_df = rfm_df.withColumn(
    "rfm_segment",
    concat(
        col("recency_score"),
        col("frequency_score"),
        col("monetary_score")
    )
)

# Classify customers
rfm_df = rfm_df.withColumn(
    "customer_segment",
    when(col("rfm_segment").isin(["444", "443", "434"]), "Champions")
    .when(col("rfm_segment").isin(["344", "343", "334"]), "Loyal")
    .when(col("rfm_segment").isin(["144", "143", "134"]), "At Risk - High Value")
    .when(col("rfm_segment").startswith("1"), "Lost")
    .when(col("rfm_segment").startswith("4"), "Promising")
    .otherwise("Need Attention")
)

display(rfm_df.groupBy("customer_segment").count().orderBy("count"))
```

### Real-Time Dashboard Aggregations

```python
# Create aggregated views for dashboards
# These will be continuously updated as new data arrives

# Hourly metrics
hourly_metrics = orders_df \
    .withColumn("hour", date_trunc("hour", col("orderDate"))) \
    .groupBy("hour") \
    .agg(
        count("*").alias("orders"),
        sum("totalAmount").alias("revenue"),
        countDistinct("customerId").alias("customers")
    )

# Write to Delta Lake for Power BI
hourly_metrics.write \
    .format("delta") \
    .mode("overwrite") \
    .option("overwriteSchema", "true") \
    .save("/analytics/hourly_metrics")

# Product performance
from pyspark.sql.functions import explode

product_metrics = orders_df \
    .filter(col("status") == "Completed") \
    .withColumn("item", explode(col("items"))) \
    .groupBy(
        col("item.productId").alias("productId"),
        col("item.productName").alias("productName")
    ) \
    .agg(
        sum(col("item.quantity")).alias("totalQuantity"),
        sum(col("item.quantity") * col("item.unitPrice")).alias("totalRevenue"),
        countDistinct("orderId").alias("orderCount"),
        avg(col("item.unitPrice")).alias("avgPrice")
    )

product_metrics.write \
    .format("delta") \
    .mode("overwrite") \
    .save("/analytics/product_metrics")
```

## Materialized Views with Spark Structured Streaming

```python
# Continuous aggregation using Structured Streaming

# Configure streaming read from analytical store
streaming_df = spark.readStream \
    .format("cosmos.olap") \
    .options(**cosmosConfig) \
    .option("spark.cosmos.read.inferSchema.enabled", "true") \
    .option("spark.cosmos.changeFeed.startFrom", "Beginning") \
    .load()

# Real-time aggregation
realtime_metrics = streaming_df \
    .filter(col("status") == "Completed") \
    .withWatermark("orderDate", "1 hour") \
    .groupBy(
        window(col("orderDate"), "1 hour"),
        col("status")
    ) \
    .agg(
        count("*").alias("orderCount"),
        sum("totalAmount").alias("revenue")
    )

# Write to Delta Lake
query = realtime_metrics.writeStream \
    .format("delta") \
    .outputMode("complete") \
    .option("checkpointLocation", "/checkpoints/realtime_metrics") \
    .trigger(processingTime="5 minutes") \
    .start("/analytics/realtime_metrics")
```

## Synapse Pipeline Integration

```json
{
  "name": "CosmosAnalyticsPipeline",
  "properties": {
    "activities": [
      {
        "name": "RefreshProductMetrics",
        "type": "SynapseNotebook",
        "linkedServiceName": {
          "referenceName": "AzureSynapseWorkspace",
          "type": "LinkedServiceReference"
        },
        "typeProperties": {
          "notebook": {
            "referenceName": "ProductMetricsNotebook",
            "type": "NotebookReference"
          },
          "parameters": {
            "startDate": {
              "value": {
                "value": "@pipeline().parameters.startDate",
                "type": "Expression"
              },
              "type": "string"
            }
          },
          "sparkPool": {
            "referenceName": "SparkPool1",
            "type": "BigDataPoolReference"
          }
        }
      },
      {
        "name": "RefreshPowerBIDataset",
        "type": "WebActivity",
        "dependsOn": [
          {
            "activity": "RefreshProductMetrics",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "url": "https://api.powerbi.com/v1.0/myorg/datasets/{datasetId}/refreshes",
          "method": "POST",
          "authentication": {
            "type": "MSI",
            "resource": "https://analysis.windows.net/powerbi/api"
          }
        }
      }
    ],
    "parameters": {
      "startDate": {
        "type": "string",
        "defaultValue": "@addDays(utcNow(), -1)"
      }
    }
  }
}
```

## Best Practices

1. **Schema Design**: Use consistent schemas for efficient analytical queries
2. **Partitioning**: Align analytical queries with partition keys
3. **TTL Management**: Set appropriate TTL for analytical store based on retention needs
4. **Query Optimization**: Use projections and filters to minimize data scanned
5. **Cost Management**: Monitor analytical storage and query costs
6. **Latency**: Expect 2-5 minute sync latency for analytical store updates

Synapse Link for Cosmos DB enables powerful real-time analytics without ETL pipelines or impacting operational workloads. This HTAP capability unlocks new possibilities for operational analytics and real-time decision making.
