---
title: "Delta Lake in Microsoft Fabric: ACID Transactions for Data Lakes"
author: Michael John Peña
draft: false
date: 2023-06-02
tags:
  - Delta Lake
  - Microsoft Fabric
  - ACID
  - Data Engineering
  - Lakehouse
---

Delta Lake isn't a bolt-on feature in Microsoft Fabric — it's the foundational table format for everything. Every table you write through a Spark notebook, a Dataflow Gen2, or a pipeline lands as Delta, and the SQL analytics endpoint reads those Delta files directly. That means you get ACID transactions, time travel queries with `VERSION AS OF` and `TIMESTAMP AS OF`, and automatic schema enforcement without configuring anything extra. What surprised me when I started working with Fabric seriously is how much the Delta checkpoint and transaction log design matters for query performance at scale — something that wasn't obvious when I first saw the demos at Build.

## What is Delta Lake?

Delta Lake adds reliability to data lakes through:

```
┌─────────────────────────────────────────────────────┐
│                    Delta Lake                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              Delta Table                         ││
│  │  ┌───────────────────────────────────────────┐  ││
│  │  │           Transaction Log                 │  ││
│  │  │  (_delta_log/00000.json)                  │  ││
│  │  │  (_delta_log/00001.json)                  │  ││
│  │  │  (_delta_log/...)                         │  ││
│  │  └───────────────────────────────────────────┘  ││
│  │                      │                          ││
│  │                      ▼                          ││
│  │  ┌───────────────────────────────────────────┐  ││
│  │  │           Parquet Files                   │  ││
│  │  │  (part-00000.parquet)                     │  ││
│  │  │  (part-00001.parquet)                     │  ││
│  │  │  (...)                                    │  ││
│  │  └───────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  Features:                                           │
│  - ACID Transactions                                │
│  - Time Travel                                       │
│  - Schema Evolution                                  │
│  - Unified Batch/Streaming                          │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Creating Delta Tables

```python
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DecimalType, DateType

# Define schema
schema = StructType([
    StructField("order_id", StringType(), False),
    StructField("customer_id", StringType(), False),
    StructField("product_id", StringType(), False),
    StructField("quantity", IntegerType(), True),
    StructField("unit_price", DecimalType(18, 2), True),
    StructField("order_date", DateType(), True)
])

# Create empty Delta table with schema
spark.createDataFrame([], schema) \
    .write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("orders")

# Or create with SQL
spark.sql("""
    CREATE TABLE IF NOT EXISTS orders (
        order_id STRING NOT NULL,
        customer_id STRING NOT NULL,
        product_id STRING NOT NULL,
        quantity INT,
        unit_price DECIMAL(18, 2),
        order_date DATE
    )
    USING DELTA
    PARTITIONED BY (order_date)
""")
```

## ACID Transactions

### Atomic Writes

```python
from delta.tables import DeltaTable

# All-or-nothing write operation
try:
    df.write \
        .format("delta") \
        .mode("append") \
        .saveAsTable("orders")
    print("Transaction committed successfully")
except Exception as e:
    print(f"Transaction failed and rolled back: {e}")
```

### MERGE (Upsert)

```python
# MERGE operation - atomically update or insert
from delta.tables import DeltaTable
from pyspark.sql.functions import current_timestamp

# Source data with updates
updates_df = spark.read.format("delta").table("staging_orders")

# Target Delta table
target_table = DeltaTable.forName(spark, "orders")

# Perform merge
target_table.alias("target") \
    .merge(
        updates_df.alias("source"),
        "target.order_id = source.order_id"
    ) \
    .whenMatchedUpdate(set={
        "quantity": "source.quantity",
        "unit_price": "source.unit_price",
        "updated_at": "current_timestamp()"
    }) \
    .whenNotMatchedInsert(values={
        "order_id": "source.order_id",
        "customer_id": "source.customer_id",
        "product_id": "source.product_id",
        "quantity": "source.quantity",
        "unit_price": "source.unit_price",
        "order_date": "source.order_date",
        "created_at": "current_timestamp()",
        "updated_at": "current_timestamp()"
    }) \
    .execute()

print("Merge completed")
```

### Conditional Updates

```python
# Update with conditions
target_table.alias("target") \
    .merge(
        updates_df.alias("source"),
        "target.order_id = source.order_id"
    ) \
    .whenMatchedUpdate(
        condition="source.quantity > target.quantity",  # Only update if quantity increased
        set={
            "quantity": "source.quantity",
            "updated_at": "current_timestamp()"
        }
    ) \
    .whenMatchedDelete(
        condition="source.is_cancelled = true"  # Delete cancelled orders
    ) \
    .whenNotMatchedInsertAll() \
    .execute()
```

## Time Travel

```python
# View table history
orders_table = DeltaTable.forName(spark, "orders")
display(orders_table.history())

# Read specific version
df_v5 = spark.read \
    .format("delta") \
    .option("versionAsOf", 5) \
    .table("orders")

# Read at specific timestamp
df_yesterday = spark.read \
    .format("delta") \
    .option("timestampAsOf", "2023-06-01 10:00:00") \
    .table("orders")

# Compare versions
df_current = spark.read.format("delta").table("orders")
df_previous = spark.read.format("delta").option("versionAsOf", 10).table("orders")

# Find changes
new_orders = df_current.subtract(df_previous)
deleted_orders = df_previous.subtract(df_current)

print(f"New orders: {new_orders.count()}")
print(f"Deleted orders: {deleted_orders.count()}")
```

### Restore to Previous Version

```python
# Restore table to previous version
orders_table = DeltaTable.forName(spark, "orders")

# Restore to version 5
orders_table.restoreToVersion(5)

# Or restore to timestamp
orders_table.restoreToTimestamp("2023-06-01 00:00:00")
```

## Schema Evolution

```python
# Enable automatic schema evolution
spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", "true")

# Or per-write schema merge
df_with_new_columns.write \
    .format("delta") \
    .mode("append") \
    .option("mergeSchema", "true") \
    .saveAsTable("orders")

# Add column manually
spark.sql("ALTER TABLE orders ADD COLUMN discount DECIMAL(5,2)")

# Change column type (with care)
spark.sql("ALTER TABLE orders ALTER COLUMN quantity TYPE BIGINT")
```

## Change Data Capture (CDC)

```python
# Enable Change Data Feed
spark.sql("""
    ALTER TABLE orders
    SET TBLPROPERTIES (delta.enableChangeDataFeed = true)
""")

# Read changes since version
changes_df = spark.read \
    .format("delta") \
    .option("readChangeFeed", "true") \
    .option("startingVersion", 10) \
    .table("orders")

# Changes include _change_type column:
# - insert
# - update_preimage (before update)
# - update_postimage (after update)
# - delete

# Process only inserts and updates
new_and_updated = changes_df.filter(
    col("_change_type").isin(["insert", "update_postimage"])
)

display(new_and_updated)
```

## Optimization

### OPTIMIZE and Z-ORDER

```python
# Compact small files
spark.sql("OPTIMIZE orders")

# Z-order for query optimization
# Place related data together for faster filtering
spark.sql("OPTIMIZE orders ZORDER BY (customer_id, product_id)")

# Optimize specific partitions
spark.sql("OPTIMIZE orders WHERE order_date >= '2023-06-01'")
```

### VACUUM

```python
# Remove old files (default 7 days retention)
spark.sql("VACUUM orders")

# Remove files older than 24 hours (use with caution)
spark.conf.set("spark.databricks.delta.retentionDurationCheck.enabled", "false")
spark.sql("VACUUM orders RETAIN 24 HOURS")
```

### Statistics

```python
# Compute statistics for query optimization
spark.sql("ANALYZE TABLE orders COMPUTE STATISTICS FOR ALL COLUMNS")

# View table details
spark.sql("DESCRIBE DETAIL orders").show(truncate=False)
```

## Streaming with Delta

```python
# Read stream from Delta table
stream_df = spark.readStream \
    .format("delta") \
    .table("orders")

# Process stream
processed_stream = stream_df \
    .withColumn("total_amount", col("quantity") * col("unit_price"))

# Write stream to another Delta table
query = processed_stream.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/orders_processed") \
    .toTable("orders_processed")

# Using Change Data Feed for streaming
cdf_stream = spark.readStream \
    .format("delta") \
    .option("readChangeFeed", "true") \
    .option("startingVersion", 0) \
    .table("orders")
```

## Best Practices

```python
best_practices = {
    "partitioning": [
        "Partition by date for time-series data",
        "Avoid too many partitions (< 10,000)",
        "Partition column should be low cardinality"
    ],
    "optimization": [
        "Run OPTIMIZE regularly (daily for active tables)",
        "Use Z-ORDER for common filter columns",
        "Set appropriate retention for VACUUM"
    ],
    "schema": [
        "Define NOT NULL constraints where applicable",
        "Use appropriate data types",
        "Document schema changes"
    ],
    "operations": [
        "Use MERGE for upserts instead of delete+insert",
        "Enable Change Data Feed for CDC scenarios",
        "Use time travel for debugging and auditing"
    ]
}
```

Delta Lake provides the reliability foundation for Fabric Lakehouses. Tomorrow, I will cover Shortcuts in OneLake.

## Resources

- [Delta Lake in Fabric](https://learn.microsoft.com/en-us/fabric/data-engineering/lakehouse-and-delta-tables)
- [Delta Lake Documentation](https://docs.delta.io/)
- [Delta Lake Operations](https://learn.microsoft.com/en-us/fabric/data-engineering/delta-optimization-and-v-order)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
