---
title: Building Data Pipelines with Delta Lake on Azure Databricks
author: Michael John Pena
draft: false
date: 2021-01-20
url: /blog/delta-lake-data-pipelines/
tags:
  - Databricks
  - Delta Lake
  - Data Engineering
  - ETL
  - Streaming

---


Delta Lake has gone from "interesting open source project" to the default storage layer for data lakes inside about eighteen months. ACID, schema enforcement, time travel, and the streaming/batch unification that took Lambda architectures off my whiteboard. Today I want to dig into the patterns that move you from "I use Delta tables" to "we have a production lakehouse"—medallion zoning, Z-ordering, OPTIMIZE/VACUUM cadence, and the structured streaming idioms that don't melt under load.

## What is Delta Lake?

Delta Lake is an open-source storage layer that brings reliability to data lakes. Key features include:

- **ACID transactions** - Atomic commits ensure data integrity
- **Schema enforcement** - Prevent bad data from corrupting your tables
- **Time travel** - Query historical versions of your data
- **Unified batch and streaming** - Same tables work for both paradigms

## Creating Delta Tables

```python
from pyspark.sql.functions import *
from delta.tables import DeltaTable

# Create Delta table from DataFrame
df = spark.read.format("json").load("/data/raw/events/")

df.write \
    .format("delta") \
    .mode("overwrite") \
    .partitionBy("event_date") \
    .save("/delta/events")

# Create managed table
df.write \
    .format("delta") \
    .saveAsTable("analytics.events")

# Create table with SQL
spark.sql("""
    CREATE TABLE IF NOT EXISTS analytics.customers (
        customer_id STRING,
        name STRING,
        email STRING,
        created_at TIMESTAMP
    )
    USING DELTA
    PARTITIONED BY (created_date DATE)
    LOCATION '/delta/customers'
""")
```

## The Medallion Architecture

The medallion architecture organizes data into progressive layers of refinement:

### Bronze Layer - Raw Ingestion

```python
# Ingest raw data preserving original format
def ingest_raw_events(source_path, target_path):
    """Ingest raw events into bronze layer."""
    raw_df = spark.read \
        .format("json") \
        .option("multiLine", True) \
        .load(source_path)

    # Add metadata columns
    bronze_df = raw_df \
        .withColumn("_ingestion_timestamp", current_timestamp()) \
        .withColumn("_source_file", input_file_name())

    bronze_df.write \
        .format("delta") \
        .mode("append") \
        .partitionBy("_ingestion_date") \
        .save(target_path)

    return bronze_df.count()

# Auto Loader for continuous ingestion
bronze_stream = spark.readStream \
    .format("cloudFiles") \
    .option("cloudFiles.format", "json") \
    .option("cloudFiles.schemaLocation", "/schemas/events") \
    .option("cloudFiles.inferColumnTypes", True) \
    .load("/data/landing/events/")

bronze_stream.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/bronze_events") \
    .trigger(processingTime="1 minute") \
    .start("/delta/bronze/events")
```

### Silver Layer - Cleaned and Conformed

```python
def transform_to_silver(bronze_path, silver_path):
    """Transform bronze data to silver layer."""
    bronze_df = spark.read.format("delta").load(bronze_path)

    # Data cleaning and standardization
    silver_df = bronze_df \
        .filter(col("event_id").isNotNull()) \
        .filter(col("user_id").isNotNull()) \
        .withColumn("event_timestamp", to_timestamp("event_time")) \
        .withColumn("event_date", to_date("event_timestamp")) \
        .withColumn("event_type", lower(trim(col("event_type")))) \
        .drop("_source_file") \
        .dropDuplicates(["event_id"])

    # Merge into silver table
    if DeltaTable.isDeltaTable(spark, silver_path):
        delta_table = DeltaTable.forPath(spark, silver_path)

        delta_table.alias("target").merge(
            silver_df.alias("source"),
            "target.event_id = source.event_id"
        ).whenMatchedUpdateAll() \
         .whenNotMatchedInsertAll() \
         .execute()
    else:
        silver_df.write \
            .format("delta") \
            .mode("overwrite") \
            .partitionBy("event_date") \
            .save(silver_path)

# Streaming silver transformation
silver_stream = spark.readStream \
    .format("delta") \
    .load("/delta/bronze/events")

cleaned_stream = silver_stream \
    .filter(col("event_id").isNotNull()) \
    .withColumn("event_timestamp", to_timestamp("event_time")) \
    .withColumn("event_date", to_date("event_timestamp"))

cleaned_stream.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/silver_events") \
    .trigger(processingTime="5 minutes") \
    .start("/delta/silver/events")
```

### Gold Layer - Business Aggregations

```python
def create_gold_aggregations():
    """Create business-level aggregations in gold layer."""

    # Daily active users
    daily_active_users = spark.sql("""
        SELECT
            event_date,
            COUNT(DISTINCT user_id) as active_users,
            COUNT(*) as total_events,
            COUNT(DISTINCT session_id) as total_sessions
        FROM delta.`/delta/silver/events`
        GROUP BY event_date
    """)

    daily_active_users.write \
        .format("delta") \
        .mode("overwrite") \
        .save("/delta/gold/daily_active_users")

    # User engagement metrics
    user_engagement = spark.sql("""
        SELECT
            user_id,
            COUNT(*) as total_events,
            COUNT(DISTINCT event_date) as active_days,
            MIN(event_date) as first_seen,
            MAX(event_date) as last_seen,
            DATEDIFF(MAX(event_date), MIN(event_date)) as user_lifetime_days
        FROM delta.`/delta/silver/events`
        GROUP BY user_id
    """)

    user_engagement.write \
        .format("delta") \
        .mode("overwrite") \
        .save("/delta/gold/user_engagement")
```

## Delta Lake Operations

### MERGE (Upsert)

```python
from delta.tables import DeltaTable

# Load target Delta table
target_table = DeltaTable.forPath(spark, "/delta/customers")

# Source data with updates
updates_df = spark.read.format("json").load("/data/customer_updates/")

# Perform merge
target_table.alias("target").merge(
    updates_df.alias("source"),
    "target.customer_id = source.customer_id"
).whenMatchedUpdate(
    condition="source.updated_at > target.updated_at",
    set={
        "name": "source.name",
        "email": "source.email",
        "updated_at": "source.updated_at"
    }
).whenNotMatchedInsert(
    values={
        "customer_id": "source.customer_id",
        "name": "source.name",
        "email": "source.email",
        "created_at": "source.created_at",
        "updated_at": "source.updated_at"
    }
).execute()
```

### Time Travel

```python
# Read historical version
df_v1 = spark.read \
    .format("delta") \
    .option("versionAsOf", 1) \
    .load("/delta/customers")

# Read as of timestamp
df_yesterday = spark.read \
    .format("delta") \
    .option("timestampAsOf", "2021-01-19") \
    .load("/delta/customers")

# View history
spark.sql("DESCRIBE HISTORY delta.`/delta/customers`").show()

# Restore to previous version
spark.sql("RESTORE TABLE delta.`/delta/customers` TO VERSION AS OF 5")
```

### Schema Evolution

```python
# Enable schema evolution for merge
spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", True)

# Or specify in merge operation
target_table.alias("target").merge(
    updates_df.alias("source"),
    "target.customer_id = source.customer_id"
).whenNotMatchedInsertAll() \
 .execute()

# Add new column
spark.sql("""
    ALTER TABLE delta.`/delta/customers`
    ADD COLUMN phone_number STRING
""")
```

## Optimization Techniques

### OPTIMIZE and Z-ORDER

```python
# Compact small files
spark.sql("OPTIMIZE delta.`/delta/events`")

# Z-Order for faster queries on specific columns
spark.sql("""
    OPTIMIZE delta.`/delta/events`
    ZORDER BY (user_id, event_type)
""")
```

### Auto-Compaction and Optimized Writes

```python
# Enable auto-compaction
spark.conf.set("spark.databricks.delta.autoCompact.enabled", True)

# Enable optimized writes
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", True)
```

### Vacuum Old Files

```python
# Remove files older than retention period (default 7 days)
spark.sql("VACUUM delta.`/delta/events`")

# Override retention check (use with caution)
spark.sql("VACUUM delta.`/delta/events` RETAIN 24 HOURS")
```

## Streaming with Delta Lake

```python
# Stream from Delta table
events_stream = spark.readStream \
    .format("delta") \
    .option("ignoreDeletes", True) \
    .option("ignoreChanges", True) \
    .load("/delta/silver/events")

# Aggregation with watermark
aggregated_stream = events_stream \
    .withWatermark("event_timestamp", "10 minutes") \
    .groupBy(
        window("event_timestamp", "5 minutes"),
        "event_type"
    ) \
    .agg(
        count("*").alias("event_count"),
        countDistinct("user_id").alias("unique_users")
    )

# Write to Delta
aggregated_stream.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/event_aggregates") \
    .start("/delta/gold/event_aggregates")
```

## Data Quality with Constraints

```python
# Add check constraint
spark.sql("""
    ALTER TABLE delta.`/delta/transactions`
    ADD CONSTRAINT valid_amount CHECK (amount > 0)
""")

# Add NOT NULL constraint
spark.sql("""
    ALTER TABLE delta.`/delta/transactions`
    ALTER COLUMN transaction_id SET NOT NULL
""")
```

## Best Practices

1. **Partition wisely** - Use date columns for time-series data
2. **Optimize regularly** - Run OPTIMIZE on frequently queried tables
3. **Monitor table health** - Check for small files and skewed partitions
4. **Use merge carefully** - Large merges can be resource-intensive
5. **Set retention policies** - Balance storage costs with time travel needs

## Conclusion

Delta Lake transforms data lakes into reliable data platforms. Combined with Azure Databricks, you can build scalable data pipelines that handle both batch and streaming workloads while maintaining data quality and enabling time travel capabilities.

