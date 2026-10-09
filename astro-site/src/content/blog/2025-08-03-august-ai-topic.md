---
title: "Microsoft Fabric Lakehouse: Unified Analytics for the Modern Data Stack"
description: "A Lakehouse stores data in open formats like Delta Lake while providing SQL query capabilities, ACID transactions, and schema enforcement. In Microsoft…"
author: Michael John Peña
draft: false
date: 2025-08-03
tags:
  - Microsoft Fabric
  - Lakehouse
  - Delta Lake
  - Data Engineering
  - Analytics
---

## Understanding the Lakehouse Concept

A Lakehouse stores data in open formats like Delta Lake while providing SQL query capabilities, ACID transactions, and schema enforcement. In Microsoft Fabric, the Lakehouse is your central hub for raw data, refined datasets, and analytical workloads.

## Creating and Managing a Fabric Lakehouse

```python
# Spark notebook in Microsoft Fabric
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, current_timestamp

# Data is automatically available in Fabric Lakehouse
df = spark.read.format("csv") \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .load("Files/raw/sales_data/*.csv")

# Transform and write to Delta table
df_transformed = df \
    .withColumn("ingested_at", current_timestamp()) \
    .withColumn("total_amount", col("quantity") * col("unit_price"))

# Write to managed Delta table in the Lakehouse
df_transformed.write \
    .format("delta") \
    .mode("overwrite") \
    .option("overwriteSchema", "true") \
    .saveAsTable("gold.sales_summary")

# Enable time travel for auditing
spark.sql("""
    ALTER TABLE gold.sales_summary
    SET TBLPROPERTIES (
        'delta.logRetentionDuration' = 'interval 30 days',
        'delta.deletedFileRetentionDuration' = 'interval 7 days'
    )
""")
```

## Key Benefits

The Fabric Lakehouse provides automatic table discovery, making Delta tables instantly queryable from the SQL endpoint. Data engineers work with Spark notebooks while analysts query the same data through familiar SQL tools like Power BI.

OneLake's unified storage layer means data is stored once and accessed everywhere, eliminating costly data movement and duplication. The integration with Copilot in Fabric further accelerates development by generating code and insights.
