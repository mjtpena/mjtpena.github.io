---
title: Real-Time Analytics with Cosmos DB Analytical Store
description: "The question that sparked this post came from a data engineer on a client project: \"can we run Power BI reports against Cosmos DB without destroying the…"
author: Michael John Pena
draft: false
date: 2021-03-08
url: /blog/cosmos-db-analytical-store/
tags:
  - Azure
  - Cosmos DB
  - Analytics
  - Synapse
  - HTAP
---

The question that sparked this post came from a data engineer on a client project: "can we run Power BI reports against Cosmos DB without destroying the throughput budget?" The answer is the Analytical Store. It's a column-oriented copy of your transactional Cosmos data, maintained automatically by the service at no extra RU cost, and readable by Synapse Analytics (Spark or Serverless SQL) without touching the operational partition. HTAP in practice—the transactional workload and the analytical query run in isolation. Today's post is the architecture and the gotchas I found in six weeks of using it in production.

## Understanding HTAP Architecture

Traditional architecture requires ETL pipelines to move data from operational databases to analytical systems. Cosmos DB Analytical Store changes this by:

1. Automatically syncing data to a column-oriented store
2. No impact on transactional workload performance
3. Near real-time sync (typically under 2 minutes)
4. Direct querying from Azure Synapse Analytics

## Enabling Analytical Store

```bash
# Create Cosmos DB account with analytical storage
az cosmosdb create \
    --name mycosmosdb-htap \
    --resource-group myResourceGroup \
    --locations regionName=eastus \
    --enable-analytical-storage true

# Create database
az cosmosdb sql database create \
    --account-name mycosmosdb-htap \
    --resource-group myResourceGroup \
    --name salesdb

# Create container with analytical store enabled
az cosmosdb sql container create \
    --account-name mycosmosdb-htap \
    --resource-group myResourceGroup \
    --database-name salesdb \
    --name orders \
    --partition-key-path "/customerId" \
    --analytical-storage-ttl -1
```

## Querying with Azure Synapse

### Setting Up Synapse Link

```bash
# Create Synapse workspace
az synapse workspace create \
    --name mysynapseworkspace \
    --resource-group myResourceGroup \
    --storage-account mystorageaccount \
    --file-system synapse-fs \
    --sql-admin-login-user sqladmin \
    --sql-admin-login-password 'ComplexPassword123!' \
    --location eastus

# Create Synapse Link for Cosmos DB (in Azure Portal or Synapse Studio)
```

### Synapse Serverless SQL Queries

```sql
-- Query Cosmos DB analytical store directly
SELECT TOP 100
    JSON_VALUE(doc, '$.orderId') as OrderId,
    JSON_VALUE(doc, '$.customerId') as CustomerId,
    CAST(JSON_VALUE(doc, '$.orderDate') as datetime2) as OrderDate,
    CAST(JSON_VALUE(doc, '$.total') as decimal(10,2)) as Total,
    JSON_VALUE(doc, '$.status') as Status
FROM OPENROWSET(
    'CosmosDB',
    'Account=mycosmosdb-htap;Database=salesdb;Key=<your-key>',
    orders
) as doc
WHERE JSON_VALUE(doc, '$.status') = 'Completed'
ORDER BY CAST(JSON_VALUE(doc, '$.orderDate') as datetime2) DESC;

-- Aggregation query
SELECT
    JSON_VALUE(doc, '$.customerId') as CustomerId,
    COUNT(*) as OrderCount,
    SUM(CAST(JSON_VALUE(doc, '$.total') as decimal(10,2))) as TotalSpent,
    AVG(CAST(JSON_VALUE(doc, '$.total') as decimal(10,2))) as AvgOrderValue
FROM OPENROWSET(
    'CosmosDB',
    'Account=mycosmosdb-htap;Database=salesdb;Key=<your-key>',
    orders
) as doc
GROUP BY JSON_VALUE(doc, '$.customerId')
HAVING COUNT(*) > 5
ORDER BY TotalSpent DESC;

-- Time-series analysis
SELECT
    DATEPART(year, CAST(JSON_VALUE(doc, '$.orderDate') as datetime2)) as Year,
    DATEPART(month, CAST(JSON_VALUE(doc, '$.orderDate') as datetime2)) as Month,
    COUNT(*) as OrderCount,
    SUM(CAST(JSON_VALUE(doc, '$.total') as decimal(10,2))) as Revenue
FROM OPENROWSET(
    'CosmosDB',
    'Account=mycosmosdb-htap;Database=salesdb;Key=<your-key>',
    orders
) as doc
GROUP BY
    DATEPART(year, CAST(JSON_VALUE(doc, '$.orderDate') as datetime2)),
    DATEPART(month, CAST(JSON_VALUE(doc, '$.orderDate') as datetime2))
ORDER BY Year, Month;
```

### Synapse Spark Queries

```python
# Read from Cosmos DB analytical store using Spark
from pyspark.sql.functions import col, sum, avg, count, to_date

# Configure connection
spark.conf.set("spark.cosmos.accountEndpoint", "https://mycosmosdb-htap.documents.azure.com:443/")
spark.conf.set("spark.cosmos.accountKey", "<your-key>")
spark.conf.set("spark.cosmos.database", "salesdb")
spark.conf.set("spark.cosmos.container", "orders")

# Read from analytical store
df = spark.read \
    .format("cosmos.olap") \
    .option("spark.synapse.linkedService", "CosmosDbAnalyticalStore") \
    .option("spark.cosmos.container", "orders") \
    .load()

# Display schema
df.printSchema()

# Basic analytics
daily_sales = df \
    .withColumn("order_date", to_date(col("orderDate"))) \
    .groupBy("order_date") \
    .agg(
        count("*").alias("order_count"),
        sum("total").alias("daily_revenue"),
        avg("total").alias("avg_order_value")
    ) \
    .orderBy("order_date")

display(daily_sales)

# Customer segmentation
customer_segments = df \
    .groupBy("customerId") \
    .agg(
        count("*").alias("order_count"),
        sum("total").alias("total_spent"),
        avg("total").alias("avg_order_value")
    ) \
    .withColumn("segment",
        when(col("total_spent") > 10000, "Premium")
        .when(col("total_spent") > 1000, "Regular")
        .otherwise("New")
    )

display(customer_segments)

# Write results to Delta Lake
daily_sales.write \
    .format("delta") \
    .mode("overwrite") \
    .save("/analytics/daily_sales")
```

## Real-World Example: E-Commerce Analytics

### Operational Data Model

```csharp
// Order.cs - Operational model
public class Order
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    [JsonPropertyName("customerId")]
    public string CustomerId { get; set; }

    [JsonPropertyName("orderDate")]
    public DateTime OrderDate { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; }

    [JsonPropertyName("items")]
    public List<OrderItem> Items { get; set; } = new();

    [JsonPropertyName("total")]
    public decimal Total { get; set; }

    [JsonPropertyName("shippingAddress")]
    public Address ShippingAddress { get; set; }

    [JsonPropertyName("paymentMethod")]
    public string PaymentMethod { get; set; }
}

public class OrderItem
{
    [JsonPropertyName("productId")]
    public string ProductId { get; set; }

    [JsonPropertyName("productName")]
    public string ProductName { get; set; }

    [JsonPropertyName("quantity")]
    public int Quantity { get; set; }

    [JsonPropertyName("unitPrice")]
    public decimal UnitPrice { get; set; }

    [JsonPropertyName("category")]
    public string Category { get; set; }
}
```

### Analytical Queries

```sql
-- Product performance analysis
SELECT
    JSON_VALUE(item.value, '$.category') as Category,
    JSON_VALUE(item.value, '$.productName') as ProductName,
    SUM(CAST(JSON_VALUE(item.value, '$.quantity') as int)) as TotalQuantity,
    SUM(CAST(JSON_VALUE(item.value, '$.quantity') as int) *
        CAST(JSON_VALUE(item.value, '$.unitPrice') as decimal(10,2))) as Revenue
FROM OPENROWSET(
    'CosmosDB',
    'Account=mycosmosdb-htap;Database=salesdb;Key=<key>',
    orders
) as doc
CROSS APPLY OPENJSON(doc, '$.items') as item
WHERE CAST(JSON_VALUE(doc, '$.orderDate') as datetime2) > DATEADD(month, -3, GETUTCDATE())
GROUP BY
    JSON_VALUE(item.value, '$.category'),
    JSON_VALUE(item.value, '$.productName')
ORDER BY Revenue DESC;

-- Customer lifetime value
WITH CustomerOrders AS (
    SELECT
        JSON_VALUE(doc, '$.customerId') as CustomerId,
        CAST(JSON_VALUE(doc, '$.total') as decimal(10,2)) as OrderTotal,
        CAST(JSON_VALUE(doc, '$.orderDate') as datetime2) as OrderDate
    FROM OPENROWSET(
        'CosmosDB',
        'Account=mycosmosdb-htap;Database=salesdb;Key=<key>',
        orders
    ) as doc
)
SELECT
    CustomerId,
    COUNT(*) as OrderCount,
    SUM(OrderTotal) as LifetimeValue,
    MIN(OrderDate) as FirstOrder,
    MAX(OrderDate) as LastOrder,
    DATEDIFF(day, MIN(OrderDate), MAX(OrderDate)) as CustomerTenureDays
FROM CustomerOrders
GROUP BY CustomerId
ORDER BY LifetimeValue DESC;

-- Funnel analysis by payment method
SELECT
    JSON_VALUE(doc, '$.paymentMethod') as PaymentMethod,
    JSON_VALUE(doc, '$.status') as Status,
    COUNT(*) as OrderCount,
    SUM(CAST(JSON_VALUE(doc, '$.total') as decimal(10,2))) as TotalValue
FROM OPENROWSET(
    'CosmosDB',
    'Account=mycosmosdb-htap;Database=salesdb;Key=<key>',
    orders
) as doc
GROUP BY
    JSON_VALUE(doc, '$.paymentMethod'),
    JSON_VALUE(doc, '$.status')
ORDER BY PaymentMethod, Status;
```

## Best Practices

### 1. Schema Design for Analytics

```csharp
// Flatten nested objects for easier querying
public class AnalyticsOptimizedOrder
{
    public string Id { get; set; }
    public string CustomerId { get; set; }
    public DateTime OrderDate { get; set; }
    public decimal Total { get; set; }

    // Denormalized for analytics
    public string CustomerEmail { get; set; }
    public string CustomerSegment { get; set; }
    public string ShippingCity { get; set; }
    public string ShippingCountry { get; set; }

    // Pre-computed metrics
    public int ItemCount { get; set; }
    public decimal AvgItemPrice { get; set; }
}
```

### 2. Analytical TTL Configuration

```bash
# Set analytical TTL independent of transactional TTL
az cosmosdb sql container update \
    --account-name mycosmosdb-htap \
    --resource-group myResourceGroup \
    --database-name salesdb \
    --name orders \
    --analytical-storage-ttl 7776000  # 90 days in seconds
```

### 3. Monitoring Sync Latency

```python
# Monitor analytical store sync in Spark
sync_status = spark.read \
    .format("cosmos.olap") \
    .option("spark.cosmos.container", "orders") \
    .option("spark.cosmos.diagnostics", "true") \
    .load()

# Check the _ts field for sync verification
from pyspark.sql.functions import max as spark_max, current_timestamp

latest_sync = sync_status.select(
    spark_max("_ts").alias("latest_document_ts"),
    current_timestamp().alias("current_time")
)

display(latest_sync)
```

## Conclusion

Cosmos DB Analytical Store with Synapse Link provides:
- Zero-ETL architecture for real-time analytics
- No impact on transactional performance
- Cost-effective analytical storage
- Seamless integration with Synapse SQL and Spark

This HTAP capability is transformative for organizations needing real-time insights without the complexity of traditional data warehousing pipelines.
