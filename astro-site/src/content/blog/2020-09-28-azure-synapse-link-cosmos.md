---
title: "Azure Synapse Link for Cosmos DB: Real-Time Analytics"
description: "Synapse Link: analytics without the pipeline complexity."
author: Michael John Peña
draft: false
date: 2020-09-28
tags:
  - Azure
  - Synapse
  - Cosmos DB
  - Analytics
---

## How It Works

```
Cosmos DB              Synapse Link           Synapse Analytics
┌──────────────┐      ┌────────────┐         ┌──────────────┐
│ Operational  │ ──▶  │ Analytical │  ──▶    │ Serverless   │
│    Store     │ auto │   Store    │ query   │    SQL       │
│  (Row-based) │ sync │ (Columnar) │         │    Spark     │
└──────────────┘      └────────────┘         └──────────────┘
```

## Enable Synapse Link

```bash
# Enable on Cosmos DB account
az cosmosdb update \
    --name mycosmosdb \
    --resource-group myRG \
    --enable-analytical-storage true

# Enable on container
az cosmosdb sql container create \
    --account-name mycosmosdb \
    --database-name mydb \
    --name orders \
    --partition-key-path /customerId \
    --analytical-storage-ttl -1  # Never expire
```

## Query with Serverless SQL

```sql
-- No ETL required!
SELECT
    c.customerId,
    c.orderDate,
    c.items,
    c.total
FROM OPENROWSET(
    'CosmosDB',
    'Account=mycosmosdb;Database=mydb;Key=xxx',
    orders
) AS c
WHERE c.orderDate > '2020-01-01'
```

## Query with Spark

```python
# Read from analytical store
df = spark.read \
    .format("cosmos.olap") \
    .option("spark.synapse.linkedService", "CosmosDbLink") \
    .option("spark.cosmos.container", "orders") \
    .load()

# Analyze
df.groupBy("customerId") \
    .agg(
        count("*").alias("orderCount"),
        sum("total").alias("totalSpent")
    ) \
    .orderBy(desc("totalSpent")) \
    .show()
```

## Schema Inference

```sql
-- Cosmos DB stores schema-less JSON
-- Synapse infers schema automatically

-- Nested properties
SELECT
    c.customer.name AS customerName,
    c.customer.email AS email,
    item.productId,
    item.quantity
FROM OPENROWSET('CosmosDB', '...', orders) AS c
CROSS APPLY OPENJSON(c.items) WITH (
    productId VARCHAR(50),
    quantity INT
) AS item
```

## WITH Clause for Schema

```sql
SELECT *
FROM OPENROWSET(
    'CosmosDB',
    'Account=mycosmosdb;Database=mydb;Key=xxx',
    orders
) WITH (
    id VARCHAR(100),
    customerId VARCHAR(100),
    orderDate DATE,
    total DECIMAL(10,2),
    items VARCHAR(MAX)  -- Keep as JSON
) AS c
```

## Performance Tips

### Partition Pruning

```sql
-- Include partition key in WHERE clause
SELECT * FROM orders
WHERE customerId = 'cust-123'
  AND orderDate > '2020-01-01'
```

### Aggregation Pushdown

```sql
-- Aggregations pushed to Cosmos DB
SELECT
    customerId,
    COUNT(*) as orderCount,
    SUM(total) as totalSpent
FROM OPENROWSET('CosmosDB', '...', orders) c
GROUP BY customerId
```

## Real-Time Dashboard

```python
# Power BI DirectQuery to Synapse
# Synapse queries Cosmos DB analytical store
# Near real-time insights!

# Create view for Power BI
spark.sql("""
CREATE OR REPLACE VIEW daily_sales AS
SELECT
    DATE(orderDate) as date,
    COUNT(*) as orders,
    SUM(total) as revenue
FROM cosmos_orders
GROUP BY DATE(orderDate)
""")
```

## Analytical TTL

```bash
# Set TTL for analytical store (independent of transactional)
az cosmosdb sql container update \
    --account-name mycosmosdb \
    --database-name mydb \
    --name orders \
    --analytical-storage-ttl 2592000  # 30 days
```

## Use Cases

| Scenario | Benefit |
|----------|---------|
| Real-time dashboards | No ETL delay |
| Customer 360 | Combine operational data |
| Fraud detection | Analyze patterns instantly |
| IoT analytics | Process device data |

Synapse Link: analytics without the pipeline complexity.
