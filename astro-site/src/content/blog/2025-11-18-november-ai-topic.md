---
title: "Building Data Lakehouses: Medallion Architecture Best Practices"
description: "Each layer serves a specific purpose in the data refinement pipeline. Bronze captures raw data, silver cleans and conforms it, and gold delivers…"
author: Michael John Peña
draft: false
date: 2025-11-18
tags:
  - Lakehouse
  - Data Architecture
  - Microsoft Fabric
  - Delta Lake
  - Best Practices
---

## Understanding the Layers

Each layer serves a specific purpose in the data refinement pipeline. Bronze captures raw data, silver cleans and conforms it, and gold delivers business-ready datasets.

## Bronze Layer: Raw Ingestion

Capture data with minimal transformation, preserving the original state:

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import current_timestamp, input_file_name, lit
from delta.tables import DeltaTable

class BronzeIngestion:
    def __init__(self, spark: SparkSession, source_name: str):
        self.spark = spark
        self.source_name = source_name
        self.bronze_path = f"Tables/bronze/{source_name}"

    def ingest_batch(self, source_path: str, file_format: str = "json"):
        """Ingest raw data with metadata preservation."""

        raw_df = self.spark.read \
            .format(file_format) \
            .option("inferSchema", "true") \
            .load(source_path)

        # Add ingestion metadata
        enriched_df = raw_df \
            .withColumn("_ingestion_timestamp", current_timestamp()) \
            .withColumn("_source_file", input_file_name()) \
            .withColumn("_source_system", lit(self.source_name)) \
            .withColumn("_batch_id", lit(self.generate_batch_id()))

        # Append to bronze table
        enriched_df.write \
            .format("delta") \
            .mode("append") \
            .option("mergeSchema", "true") \
            .save(self.bronze_path)

        return enriched_df.count()

    def ingest_stream(self, source_config: dict):
        """Stream data continuously to bronze layer."""

        stream_df = self.spark.readStream \
            .format(source_config["format"]) \
            .options(**source_config["options"]) \
            .load()

        # Add streaming metadata
        enriched_df = stream_df \
            .withColumn("_ingestion_timestamp", current_timestamp()) \
            .withColumn("_source_system", lit(self.source_name))

        query = enriched_df.writeStream \
            .format("delta") \
            .outputMode("append") \
            .option("checkpointLocation", f"/checkpoints/bronze/{self.source_name}") \
            .trigger(processingTime="1 minute") \
            .start(self.bronze_path)

        return query
```

## Silver Layer: Cleansed Data

Apply data quality rules and business transformations:

```python
class SilverTransformation:
    def __init__(self, spark: SparkSession):
        self.spark = spark

    def transform_customers(self):
        """Transform customer data from bronze to silver."""

        bronze_df = self.spark.table("bronze.customers")

        # Get only new/updated records since last run
        last_processed = self.get_watermark("silver.customers")
        incremental_df = bronze_df.filter(
            col("_ingestion_timestamp") > last_processed
        )

        # Apply cleaning rules
        cleaned_df = incremental_df \
            .dropDuplicates(["customer_id"]) \
            .filter(col("email").isNotNull()) \
            .withColumn("email", lower(trim(col("email")))) \
            .withColumn("phone", self.standardize_phone(col("phone"))) \
            .withColumn("created_date", to_date(col("created_date"))) \
            .withColumn("_silver_timestamp", current_timestamp())

        # Validate data quality
        valid_df = cleaned_df.filter(
            col("email").rlike(r'^[\w\.-]+@[\w\.-]+\.\w+$')
        )

        # Quarantine invalid records
        invalid_df = cleaned_df.subtract(valid_df)
        self.quarantine_records(invalid_df, "customers")

        # Merge into silver table
        silver_table = DeltaTable.forName(self.spark, "silver.customers")

        silver_table.alias("target").merge(
            valid_df.alias("source"),
            "target.customer_id = source.customer_id"
        ).whenMatchedUpdateAll() \
         .whenNotMatchedInsertAll() \
         .execute()

        self.update_watermark("silver.customers")
        return valid_df.count()
```

## Gold Layer: Business Aggregates

Create analytics-ready datasets optimized for consumption:

```python
class GoldAggregation:
    def __init__(self, spark: SparkSession):
        self.spark = spark

    def build_customer_360(self):
        """Build comprehensive customer view for analytics."""

        customers = self.spark.table("silver.customers")
        orders = self.spark.table("silver.orders")
        interactions = self.spark.table("silver.customer_interactions")

        # Customer metrics
        customer_metrics = orders \
            .groupBy("customer_id") \
            .agg(
                count("order_id").alias("total_orders"),
                sum("amount").alias("lifetime_value"),
                avg("amount").alias("avg_order_value"),
                max("order_date").alias("last_order_date"),
                min("order_date").alias("first_order_date")
            )

        # Build 360 view
        customer_360 = customers \
            .join(customer_metrics, "customer_id", "left") \
            .withColumn("customer_tenure_days",
                datediff(current_date(), col("first_order_date"))) \
            .withColumn("days_since_last_order",
                datediff(current_date(), col("last_order_date"))) \
            .withColumn("_gold_timestamp", current_timestamp())

        customer_360.write \
            .format("delta") \
            .mode("overwrite") \
            .saveAsTable("gold.customer_360")
```

The medallion architecture provides clear data lineage and quality gates. Each layer can be tested and validated independently, making the entire pipeline more maintainable and reliable.
