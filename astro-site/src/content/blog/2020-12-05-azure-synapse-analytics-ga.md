---
title: "Azure Synapse Analytics is Now Generally Available"
description: "All of this is unified through Synapse Studio - a single workspace where data engineers, data scientists, and analysts can collaborate."
author: Michael John Peña
draft: false
date: 2020-12-05
tags:
  - Azure
  - Synapse
  - Data Engineering
  - Analytics
  - Big Data
---

## What is Azure Synapse Analytics?

Synapse brings together:
- **Data Integration** (formerly Azure Data Factory experiences)
- **Enterprise Data Warehousing** (the evolved SQL Data Warehouse)
- **Big Data Analytics** (Apache Spark integration)
- **Data Exploration** (serverless SQL pools)

All of this is unified through Synapse Studio - a single workspace where data engineers, data scientists, and analysts can collaborate.

## The SQL Serverless Revolution

For me, the most exciting feature is the SQL Serverless pool (previously called SQL on-demand). You can query data directly in your data lake using familiar T-SQL syntax without provisioning any compute:

```sql
-- Query Parquet files directly in your data lake
SELECT
    VendorID,
    passenger_count,
    trip_distance,
    tip_amount
FROM
    OPENROWSET(
        BULK 'https://mydatalake.blob.core.windows.net/nyctaxi/yellow_tripdata_2020-*.parquet',
        FORMAT = 'PARQUET'
    ) AS [taxi]
WHERE
    trip_distance > 10
```

This is pay-per-query pricing. No clusters to manage, no compute to provision. You only pay for the data scanned - roughly $5 per terabyte.

## Dedicated SQL Pools

The dedicated SQL pool is the evolution of SQL Data Warehouse. If you have existing Azure SQL Data Warehouse workloads, they continue to work - the underlying engine is the same.

Key improvements in GA:
- **Workload Isolation**: Define workload groups to isolate resources for different users or query types
- **Result-set Caching**: Automatic caching of query results for repeated queries
- **Materialized Views**: Define pre-computed aggregations that the query optimizer can use automatically

```sql
-- Create a workload group for reporting queries
CREATE WORKLOAD GROUP reporting
WITH (
    MIN_PERCENTAGE_RESOURCE = 20,
    CAP_PERCENTAGE_RESOURCE = 50,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 5,
    REQUEST_MAX_RESOURCE_GRANT_PERCENT = 25
);

-- Create a classifier to route reporting queries
CREATE WORKLOAD CLASSIFIER reporting_classifier
WITH (
    WORKLOAD_GROUP = 'reporting',
    MEMBERNAME = 'reporting_user'
);
```

## Apache Spark Integration

Synapse includes managed Apache Spark pools, deeply integrated with the rest of the platform. What makes this different from standalone Databricks or HDInsight:

1. **Shared Metadata**: Tables created in Spark are visible to SQL pools and vice versa
2. **Linked Services**: Same connection definitions work across SQL and Spark
3. **Unified Security**: Azure AD and Synapse's role-based access control

```python
# Spark notebook in Synapse Studio
from pyspark.sql.functions import col, year, month

# Read from data lake
df = spark.read.parquet("abfss://raw@mydatalake.dfs.core.windows.net/sales/")

# Transform
aggregated = df \
    .withColumn("year", year(col("order_date"))) \
    .withColumn("month", month(col("order_date"))) \
    .groupBy("year", "month", "product_category") \
    .agg({"amount": "sum", "order_id": "count"})

# Write to curated zone
aggregated.write \
    .mode("overwrite") \
    .parquet("abfss://curated@mydatalake.dfs.core.windows.net/sales_monthly/")
```

## Synapse Pipelines

Data integration in Synapse uses the same engine as Azure Data Factory, but it's embedded in Synapse Studio. You get:
- Copy activities for data movement
- Data flows for code-free transformations
- Orchestration of Spark notebooks and SQL scripts

If you're already using ADF, you can continue to use it standalone or embed your pipelines in Synapse - the choice is yours.

## Azure Purview Preview

Alongside Synapse GA, Microsoft announced the preview of Azure Purview - a unified data governance service. While not part of Synapse itself, it's clearly designed to complement it:

- **Data Catalog**: Discover and understand your data assets
- **Data Lineage**: Track how data flows through your systems
- **Classification**: Automatically detect sensitive data

This fills a major gap in the Azure data platform - previously, you had to cobble together data governance from various tools or buy third-party solutions.

## Migration Considerations

If you're currently on Azure SQL Data Warehouse, the migration is straightforward - your existing workloads continue to work. You get the new Synapse Studio experience and can start using SQL Serverless and Spark alongside your existing dedicated pools.

For new projects, Synapse is now the clear choice for enterprise analytics workloads on Azure. The combination of serverless capabilities, integrated Spark, and unified tooling is compelling.

## What's Still in Preview

Not everything is GA yet. Notable features still in preview:
- Synapse Link for Cosmos DB (near-real-time analytics on operational data)
- Power BI integration in Synapse Studio
- Some security features like column-level encryption

I'll be tracking these as they mature. The Synapse Link feature, in particular, has potential to simplify real-time analytics architectures.

## Getting Started

Here's a quick start to explore Synapse:

1. Create a Synapse workspace in the Azure portal
2. Upload some sample data to your linked Data Lake Storage
3. Open Synapse Studio and create a SQL Serverless query
4. Experiment with querying your data lake files directly

```sql
-- First query in SQL Serverless
SELECT TOP 100 *
FROM OPENROWSET(
    BULK 'https://yourdatalake.dfs.core.windows.net/sample/*.csv',
    FORMAT = 'CSV',
    PARSER_VERSION = '2.0',
    HEADER_ROW = TRUE
) AS rows
```

The Azure Synapse Analytics documentation has improved significantly - start with the [quickstarts](https://docs.microsoft.com/en-us/azure/synapse-analytics/quickstart-create-workspace) to get hands-on experience.

## Resources

- [Azure Synapse Analytics Documentation](https://docs.microsoft.com/en-us/azure/synapse-analytics/)
- [Azure Synapse Analytics Pricing](https://azure.microsoft.com/en-us/pricing/details/synapse-analytics/)
- [Azure Purview Preview](https://docs.microsoft.com/en-us/azure/purview/)
- [James Serra's Blog on Synapse GA](https://www.jamesserra.com/archive/2020/12/azure-synapse-analytics-is-ga/)
