---
title: "Data Lakehouse Patterns: Best of Both Worlds"
description: "The lakehouse architecture proved its value in 2021. Organizations are consolidating their data warehouses and data lakes into unified lakehouses, reducing…"
author: Michael John Pena
draft: false
date: 2021-12-08
tags:
  - Data Lakehouse
  - Delta Lake
  - Data Engineering
  - Azure Synapse
  - Databricks
---

## The Lakehouse Architecture

A lakehouse provides:
- ACID transactions on object storage
- Schema enforcement and evolution
- Time travel and versioning
- Support for both streaming and batch
- Direct BI tool access

## Implementing with Delta Lake

Delta Lake became the de facto lakehouse format:

```python
from delta.tables import DeltaTable
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder \
    .appName("Lakehouse") \
    .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
    .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
    .getOrCreate()

# Bronze layer: Raw ingestion
def ingest_to_bronze(source_path: str, bronze_path: str):
    df = (spark.readStream
        .format("cloudFiles")  # Auto Loader
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", f"{bronze_path}/_schema")
        .option("cloudFiles.inferColumnTypes", "true")
        .load(source_path)
        .withColumn("_ingestion_timestamp", F.current_timestamp())
        .withColumn("_source_file", F.input_file_name())
    )

    return (df.writeStream
        .format("delta")
        .outputMode("append")
        .option("checkpointLocation", f"{bronze_path}/_checkpoint")
        .trigger(availableNow=True)
        .start(bronze_path)
    )

# Silver layer: Cleaned and conformed
def process_to_silver(bronze_path: str, silver_path: str):
    bronze_df = spark.read.format("delta").load(bronze_path)

    silver_df = (bronze_df
        .filter(F.col("customer_id").isNotNull())
        .withColumn("email", F.lower(F.trim(F.col("email"))))
        .withColumn("order_date", F.to_date(F.col("order_timestamp")))
        .withColumn("order_amount", F.col("order_amount").cast("decimal(18,2)"))
        .dropDuplicates(["order_id"])
    )

    # Merge for incremental updates
    if DeltaTable.isDeltaTable(spark, silver_path):
        delta_table = DeltaTable.forPath(spark, silver_path)

        (delta_table.alias("target")
            .merge(
                silver_df.alias("source"),
                "target.order_id = source.order_id"
            )
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        silver_df.write.format("delta").mode("overwrite").save(silver_path)

# Gold layer: Business aggregates
def build_gold_aggregates(silver_path: str, gold_path: str):
    silver_df = spark.read.format("delta").load(silver_path)

    # Daily sales summary
    daily_sales = (silver_df
        .groupBy("order_date", "product_category")
        .agg(
            F.sum("order_amount").alias("total_revenue"),
            F.count("order_id").alias("order_count"),
            F.countDistinct("customer_id").alias("unique_customers"),
            F.avg("order_amount").alias("avg_order_value")
        )
    )

    (daily_sales.write
        .format("delta")
        .mode("overwrite")
        .partitionBy("order_date")
        .save(f"{gold_path}/daily_sales")
    )
```

## Schema Evolution

Handling schema changes gracefully:

```python
# Enable schema evolution
spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", "true")

# Or explicitly during write
(df.write
    .format("delta")
    .mode("append")
    .option("mergeSchema", "true")
    .save(delta_path)
)

# Schema enforcement for critical tables
(df.write
    .format("delta")
    .mode("append")
    .option("mergeSchema", "false")  # Fail on schema mismatch
    .save(delta_path)
)

# View schema history
delta_table = DeltaTable.forPath(spark, delta_path)
history = delta_table.history()
history.select("version", "timestamp", "operation", "operationParameters").show()
```

## Time Travel Queries

Accessing historical data states:

```sql
-- Query data as of a specific version
SELECT * FROM delta.`/mnt/datalake/silver/orders`
VERSION AS OF 10;

-- Query data as of a timestamp
SELECT * FROM delta.`/mnt/datalake/silver/orders`
TIMESTAMP AS OF '2021-12-01 00:00:00';

-- Compare changes between versions
SELECT * FROM delta.`/mnt/datalake/silver/orders`
WHERE order_id = '12345'
VERSION AS OF 10

EXCEPT

SELECT * FROM delta.`/mnt/datalake/silver/orders`
WHERE order_id = '12345'
VERSION AS OF 9;
```

## Optimizing Lakehouse Performance

```python
# Optimize file layout
delta_table = DeltaTable.forPath(spark, delta_path)

# Compact small files
delta_table.optimize().executeCompaction()

# Z-Order for query performance
delta_table.optimize().executeZOrderBy("customer_id", "order_date")

# Vacuum old versions (retain 7 days)
delta_table.vacuum(retentionHours=168)

# Auto-optimize settings
spark.conf.set("spark.databricks.delta.autoOptimize.optimizeWrite", "true")
spark.conf.set("spark.databricks.delta.autoOptimize.autoCompact", "true")
```

## Direct BI Access with Synapse

Connecting Power BI directly to the lakehouse:

```sql
-- Synapse serverless SQL pool
CREATE DATABASE lakehouse_gold;

CREATE EXTERNAL DATA SOURCE datalake
WITH (
    LOCATION = 'abfss://gold@mydatalake.dfs.core.windows.net/'
);

-- Create view over Delta table
CREATE OR ALTER VIEW daily_sales_summary AS
SELECT *
FROM OPENROWSET(
    BULK 'daily_sales/',
    DATA_SOURCE = 'datalake',
    FORMAT = 'DELTA'
) AS sales
WHERE order_date >= DATEADD(month, -12, GETDATE());

-- Power BI connects via SQL endpoint
-- No data movement, direct query on lakehouse
```

## Data Quality in the Lakehouse

```python
from great_expectations.dataset import SparkDFDataset

def validate_silver_layer(df):
    ge_df = SparkDFDataset(df)

    # Define expectations
    results = []

    results.append(ge_df.expect_column_values_to_not_be_null("customer_id"))
    results.append(ge_df.expect_column_values_to_be_unique("order_id"))
    results.append(ge_df.expect_column_values_to_match_regex(
        "email",
        r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    ))
    results.append(ge_df.expect_column_values_to_be_between(
        "order_amount",
        min_value=0,
        max_value=1000000
    ))

    failures = [r for r in results if not r.success]

    if failures:
        raise DataQualityException(f"Validation failed: {failures}")

    return True
```

## Streaming into the Lakehouse

```python
# Streaming ingestion with exactly-once semantics
def stream_events_to_lakehouse(kafka_bootstrap: str, topic: str, lakehouse_path: str):
    stream = (spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", kafka_bootstrap)
        .option("subscribe", topic)
        .option("startingOffsets", "latest")
        .load()
        .select(
            F.col("key").cast("string"),
            F.from_json(F.col("value").cast("string"), event_schema).alias("data"),
            F.col("timestamp").alias("event_time")
        )
        .select("key", "data.*", "event_time")
    )

    return (stream.writeStream
        .format("delta")
        .outputMode("append")
        .option("checkpointLocation", f"{lakehouse_path}/_checkpoint")
        .trigger(processingTime="1 minute")
        .start(lakehouse_path)
    )
```

## Key Lakehouse Benefits Realized in 2021

1. **Unified Batch and Streaming**: Same storage, same tables
2. **Direct BI Access**: No ETL to data warehouse
3. **Cost Efficiency**: Object storage pricing with warehouse features
4. **Data Science Ready**: Direct access from notebooks

The lakehouse architecture proved its value in 2021. Organizations are consolidating their data warehouses and data lakes into unified lakehouses, reducing complexity and cost.

## Resources

- [Delta Lake Documentation](https://docs.delta.io/)
- [Azure Synapse Serverless](https://docs.microsoft.com/en-us/azure/synapse-analytics/sql/on-demand-workspace-overview)
- [Lakehouse Architecture](https://databricks.com/blog/2020/01/30/what-is-a-data-lakehouse.html)
