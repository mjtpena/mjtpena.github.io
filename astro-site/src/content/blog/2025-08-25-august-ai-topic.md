---
title: "Medallion Architecture in Microsoft Fabric: Bronze, Silver, Gold Explained"
description: "Bronze tables store data exactly as received from source systems, preserving the original format for replayability and debugging."
author: Michael John Peña
draft: false
date: 2025-08-25
tags:
  - Medallion Architecture
  - Microsoft Fabric
  - Data Engineering
  - Delta Lake
  - Lakehouse
---

## Bronze Layer: Raw Data Landing

Bronze tables store data exactly as received from source systems, preserving the original format for replayability and debugging.

```python
# Bronze layer ingestion
from pyspark.sql.functions import current_timestamp, input_file_name

def ingest_to_bronze(source_path: str, table_name: str):
    df = spark.read.format("json").load(source_path)

    # Add metadata columns
    df_bronze = df \
        .withColumn("_ingested_at", current_timestamp()) \
        .withColumn("_source_file", input_file_name())

    # Write to Bronze table
    df_bronze.write \
        .format("delta") \
        .mode("append") \
        .option("mergeSchema", "true") \
        .saveAsTable(f"bronze.{table_name}")

ingest_to_bronze("Files/landing/orders/*.json", "raw_orders")
```

## Silver Layer: Cleaned and Conformed

Silver tables apply data quality rules, standardize formats, and enforce schemas.

```python
def transform_to_silver():
    df_bronze = spark.table("bronze.raw_orders")

    df_silver = df_bronze \
        .filter(col("order_id").isNotNull()) \
        .dropDuplicates(["order_id"]) \
        .withColumn("order_date", to_date("order_date_str", "yyyy-MM-dd")) \
        .withColumn("amount", col("amount").cast("decimal(18,2)")) \
        .withColumn("_processed_at", current_timestamp()) \
        .select("order_id", "customer_id", "order_date", "amount", "status",
                "_processed_at", "_ingested_at")

    # Upsert to Silver using MERGE
    silver_table = DeltaTable.forName(spark, "silver.orders")

    silver_table.alias("target").merge(
        df_silver.alias("source"),
        "target.order_id = source.order_id"
    ).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute()
```

## Gold Layer: Business Aggregates

Gold tables serve specific analytical use cases with pre-computed metrics.

```python
def build_gold_metrics():
    df = spark.table("silver.orders")

    df_gold = df \
        .groupBy("customer_id", date_trunc("month", "order_date").alias("month")) \
        .agg(
            sum("amount").alias("total_spend"),
            count("order_id").alias("order_count"),
            avg("amount").alias("avg_order_value")
        )

    df_gold.write.format("delta").mode("overwrite").saveAsTable("gold.customer_monthly_metrics")
```

The Medallion architecture scales from small projects to enterprise data platforms, providing consistent patterns your team can follow.
