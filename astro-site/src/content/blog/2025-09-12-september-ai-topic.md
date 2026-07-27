---
title: "Microsoft Fabric Lakehouse: Medallion Architecture Implementation"
author: Michael John Peña
draft: false
date: 2025-09-12
tags:
  - Microsoft Fabric
  - Lakehouse
  - Medallion Architecture
  - Delta Lake
  - Data Engineering

---

I wrote "Microsoft Fabric Lakehouse: Medallion Architecture Implementation" to share practical, production-minded guidance on this topic.

## Understanding the Layers

Bronze holds raw ingested data. Silver contains cleansed and conformed data. Gold presents business-level aggregates ready for consumption.

## Implementing Bronze Layer

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import current_timestamp, input_file_name, lit
from delta.tables import DeltaTable

spark = SparkSession.builder.getOrCreate()

def ingest_to_bronze(
    source_path: str,
    bronze_table: str,
    source_system: str
):
    """Ingest raw data to bronze layer with metadata."""

    # Read raw data
    df = spark.read.format("json").load(source_path)

    # Add ingestion metadata
    df_with_metadata = df \
        .withColumn("_ingestion_timestamp", current_timestamp()) \
        .withColumn("_source_file", input_file_name()) \
        .withColumn("_source_system", lit(source_system))

    # Write to bronze (append mode preserves history)
    df_with_metadata.write \
        .format("delta") \
        .mode("append") \
        .option("mergeSchema", "true") \
        .saveAsTable(bronze_table)

    return df_with_metadata.count()

# Ingest sales data
records = ingest_to_bronze(
    source_path="abfss://raw@storage.dfs.core.windows.net/sales/2025/09/",
    bronze_table="bronze.sales_raw",
    source_system="pos_system"
)
print(f"Ingested {records} records to bronze")
```

## Implementing Silver Layer

```python
from pyspark.sql.functions import col, when, trim, upper, to_date

def transform_to_silver(bronze_table: str, silver_table: str):
    """Transform bronze data to silver with cleansing rules."""

    bronze_df = spark.table(bronze_table)

    # Apply cleansing transformations
    silver_df = bronze_df \
        .filter(col("order_id").isNotNull()) \
        .withColumn("customer_name", trim(upper(col("customer_name")))) \
        .withColumn("order_date", to_date(col("order_date_str"), "yyyy-MM-dd")) \
        .withColumn("amount", col("amount").cast("decimal(18,2)")) \
        .withColumn("status",
            when(col("status").isin("complete", "completed"), "COMPLETED")
            .when(col("status").isin("cancel", "cancelled"), "CANCELLED")
            .otherwise(upper(col("status")))
        ) \
        .drop("order_date_str") \
        .dropDuplicates(["order_id"])

    # Merge into silver (upsert pattern)
    if DeltaTable.isDeltaTable(spark, f"Tables/{silver_table}"):
        delta_table = DeltaTable.forName(spark, silver_table)
        delta_table.alias("target").merge(
            silver_df.alias("source"),
            "target.order_id = source.order_id"
        ).whenMatchedUpdateAll() \
         .whenNotMatchedInsertAll() \
         .execute()
    else:
        silver_df.write.format("delta").saveAsTable(silver_table)

transform_to_silver("bronze.sales_raw", "silver.sales_cleansed")
```

## Implementing Gold Layer

```python
def build_gold_aggregates(silver_table: str, gold_table: str):
    """Build business-level aggregates for gold layer."""

    silver_df = spark.table(silver_table)

    gold_df = silver_df \
        .filter(col("status") == "COMPLETED") \
        .groupBy("order_date", "region", "product_category") \
        .agg(
            count("order_id").alias("order_count"),
            sum("amount").alias("total_revenue"),
            avg("amount").alias("avg_order_value"),
            countDistinct("customer_id").alias("unique_customers")
        )

    gold_df.write \
        .format("delta") \
        .mode("overwrite") \
        .saveAsTable(gold_table)
```

The medallion architecture provides clear data lineage, enables incremental processing, and separates concerns between data engineering and analytics teams.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
