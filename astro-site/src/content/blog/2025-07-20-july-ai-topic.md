---
title: "Data Lakehouse Architecture with Microsoft Fabric: Medallion Pattern Implementation"
author: Michael John Peña
draft: false
date: 2025-07-20
tags:
  - Microsoft Fabric
  - Data Lakehouse
  - Medallion Architecture
  - Delta Lake
  - Data Engineering

---

I wrote "Data Lakehouse Architecture with Microsoft Fabric: Medallion Pattern Implementation" to share practical, production-minded guidance on this topic.

## Setting Up the Lakehouse Structure

Organize your Fabric workspace with clear layer separation:

```python
# Bronze Layer: Raw data ingestion
from pyspark.sql import SparkSession
from delta.tables import DeltaTable

spark = SparkSession.builder.getOrCreate()

# Ingest raw data preserving source format
def ingest_to_bronze(source_path: str, table_name: str):
    df = spark.read.format("parquet").load(source_path)

    # Add ingestion metadata
    df_with_metadata = df.withColumn(
        "_ingestion_timestamp", F.current_timestamp()
    ).withColumn(
        "_source_file", F.input_file_name()
    )

    # Write to bronze layer
    df_with_metadata.write \
        .format("delta") \
        .mode("append") \
        .option("mergeSchema", "true") \
        .saveAsTable(f"bronze.{table_name}")

# Silver Layer: Cleaned and conformed data
def process_to_silver(bronze_table: str, silver_table: str):
    bronze_df = spark.read.table(f"bronze.{bronze_table}")

    silver_df = bronze_df \
        .dropDuplicates(["id"]) \
        .filter(F.col("id").isNotNull()) \
        .withColumn("processed_date", F.to_date("date_string", "yyyy-MM-dd")) \
        .withColumn("amount_decimal", F.col("amount").cast("decimal(18,2)")) \
        .drop("_source_file")

    # Merge for incremental updates
    if spark.catalog.tableExists(f"silver.{silver_table}"):
        delta_table = DeltaTable.forName(spark, f"silver.{silver_table}")
        delta_table.alias("target").merge(
            silver_df.alias("source"),
            "target.id = source.id"
        ).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute()
    else:
        silver_df.write.format("delta").saveAsTable(f"silver.{silver_table}")
```

## Gold Layer: Business Aggregations

Create curated datasets optimized for specific use cases:

```python
def create_gold_aggregation():
    silver_df = spark.read.table("silver.transactions")

    # Business-level aggregations
    customer_metrics = silver_df.groupBy("customer_id").agg(
        F.sum("amount_decimal").alias("total_spend"),
        F.count("*").alias("transaction_count"),
        F.avg("amount_decimal").alias("avg_transaction"),
        F.max("processed_date").alias("last_transaction_date")
    ).withColumn(
        "customer_segment",
        F.when(F.col("total_spend") > 10000, "Premium")
         .when(F.col("total_spend") > 1000, "Standard")
         .otherwise("Basic")
    )

    customer_metrics.write \
        .format("delta") \
        .mode("overwrite") \
        .saveAsTable("gold.customer_metrics")
```

## Data Quality Enforcement

Use Delta Lake constraints and expectations to ensure data quality at each layer. Fabric's Data Quality monitoring provides visibility into quality metrics across your entire lakehouse.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
