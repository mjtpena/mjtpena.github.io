---
title: Mastering Delta Lake MERGE Operations for Upserts and SCD
author: Michael John Peña
draft: false
date: 2021-07-02
url: /blog/delta-lake-merge-operations/
tags:
  - Azure
  - Data
  - Delta Lake
  - Databricks
  - ETL
---

## Basic MERGE Syntax

The MERGE statement combines INSERT, UPDATE, and DELETE operations in a single atomic transaction:

```python
from delta.tables import DeltaTable
from pyspark.sql.functions import *

# Load the target Delta table
target_table = DeltaTable.forPath(spark, "/delta/customers")

# Source data with updates
source_df = spark.read.parquet("/staging/customer_updates")

# Perform MERGE operation
target_table.alias("target").merge(
    source_df.alias("source"),
    "target.customer_id = source.customer_id"
).whenMatchedUpdate(set={
    "name": "source.name",
    "email": "source.email",
    "updated_at": "current_timestamp()"
}).whenNotMatchedInsert(values={
    "customer_id": "source.customer_id",
    "name": "source.name",
    "email": "source.email",
    "created_at": "current_timestamp()",
    "updated_at": "current_timestamp()"
}).execute()
```

## Conditional MERGE with Multiple Conditions

Handle complex business logic with conditional updates:

```python
from delta.tables import DeltaTable
from pyspark.sql.functions import col, current_timestamp, lit

target_table = DeltaTable.forPath(spark, "/delta/products")

target_table.alias("t").merge(
    source_df.alias("s"),
    "t.product_id = s.product_id"
).whenMatchedUpdate(
    condition="s.price > t.price",
    set={
        "price": "s.price",
        "price_increased_at": "current_timestamp()",
        "price_change_count": "t.price_change_count + 1"
    }
).whenMatchedUpdate(
    condition="s.price < t.price",
    set={
        "price": "s.price",
        "price_decreased_at": "current_timestamp()",
        "discount_flag": "true"
    }
).whenMatchedDelete(
    condition="s.is_discontinued = true"
).whenNotMatchedInsert(
    condition="s.is_active = true",
    values={
        "product_id": "s.product_id",
        "name": "s.name",
        "price": "s.price",
        "created_at": "current_timestamp()"
    }
).execute()
```

## Implementing SCD Type 2

Slowly Changing Dimension Type 2 maintains history by creating new records:

```python
from pyspark.sql.functions import *
from delta.tables import DeltaTable

# Define the SCD Type 2 merge logic
def merge_scd2(target_path, source_df, key_columns, tracked_columns):
    target_table = DeltaTable.forPath(spark, target_path)

    # Prepare source with hash for change detection
    source_with_hash = source_df.withColumn(
        "row_hash",
        sha2(concat_ws("||", *[col(c) for c in tracked_columns]), 256)
    )

    # Create staging view for new records
    staged_updates = source_with_hash.alias("s").join(
        target_table.toDF().alias("t"),
        [col(f"s.{k}") == col(f"t.{k}") for k in key_columns],
        "left"
    ).filter(
        (col("t.is_current") == True) &
        (col("t.row_hash") != col("s.row_hash"))
    ).select("s.*")

    # Close existing records
    target_table.alias("t").merge(
        staged_updates.alias("u"),
        " AND ".join([f"t.{k} = u.{k}" for k in key_columns]) +
        " AND t.is_current = true"
    ).whenMatchedUpdate(set={
        "is_current": "false",
        "end_date": "current_timestamp()"
    }).execute()

    # Insert new current records
    new_records = staged_updates.withColumn("is_current", lit(True)) \
        .withColumn("start_date", current_timestamp()) \
        .withColumn("end_date", lit(None).cast("timestamp"))

    new_records.write.format("delta").mode("append").save(target_path)

# Usage
merge_scd2(
    target_path="/delta/dim_customer",
    source_df=customer_updates,
    key_columns=["customer_id"],
    tracked_columns=["name", "email", "address", "phone"]
)
```

## Change Data Capture (CDC) Processing

Process CDC events from sources like Debezium or Azure Data Factory:

```python
from pyspark.sql.functions import *
from delta.tables import DeltaTable

def process_cdc_events(target_path, cdc_df):
    """
    Process CDC events with operation types:
    'I' = Insert, 'U' = Update, 'D' = Delete
    """
    target_table = DeltaTable.forPath(spark, target_path)

    # Get the latest event per key
    windowed = cdc_df.withColumn(
        "row_num",
        row_number().over(
            Window.partitionBy("key").orderBy(col("timestamp").desc())
        )
    ).filter(col("row_num") == 1)

    # Separate by operation type
    inserts = windowed.filter(col("operation") == "I")
    updates = windowed.filter(col("operation") == "U")
    deletes = windowed.filter(col("operation") == "D")

    # Merge updates and inserts
    upserts = inserts.union(updates)

    target_table.alias("t").merge(
        upserts.alias("s"),
        "t.id = s.key"
    ).whenMatchedUpdate(set={
        "value": "s.value",
        "updated_at": "s.timestamp"
    }).whenNotMatchedInsert(values={
        "id": "s.key",
        "value": "s.value",
        "created_at": "s.timestamp",
        "updated_at": "s.timestamp"
    }).execute()

    # Handle deletes separately
    target_table.alias("t").merge(
        deletes.alias("d"),
        "t.id = d.key"
    ).whenMatchedDelete().execute()

# Read CDC events from Event Hubs
cdc_events = spark.readStream \
    .format("eventhubs") \
    .options(**eventhub_conf) \
    .load() \
    .select(from_json(col("body").cast("string"), cdc_schema).alias("data")) \
    .select("data.*")

# Process in micro-batches
cdc_events.writeStream \
    .foreachBatch(lambda df, epoch: process_cdc_events("/delta/target", df)) \
    .outputMode("update") \
    .start()
```

## Performance Optimization

Optimize MERGE performance with these techniques:

```python
# 1. Partition pruning - filter source to relevant partitions
source_df = source_df.filter(col("date") >= "2021-07-01")

# 2. Z-Order for faster lookups
spark.sql("""
    OPTIMIZE delta.`/delta/customers`
    ZORDER BY (customer_id)
""")

# 3. Use broadcast for small source tables
from pyspark.sql.functions import broadcast

target_table.alias("t").merge(
    broadcast(small_source_df).alias("s"),
    "t.id = s.id"
).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute()

# 4. Enable optimized writes
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.autoCompact.enabled", "true")
```

## SQL-Based MERGE

You can also use SQL syntax for MERGE operations:

```sql
MERGE INTO delta.`/delta/inventory` AS target
USING staging_inventory AS source
ON target.sku = source.sku AND target.warehouse_id = source.warehouse_id
WHEN MATCHED AND source.quantity = 0 THEN DELETE
WHEN MATCHED THEN UPDATE SET
    target.quantity = source.quantity,
    target.last_updated = current_timestamp()
WHEN NOT MATCHED THEN INSERT (
    sku, warehouse_id, quantity, last_updated
) VALUES (
    source.sku, source.warehouse_id, source.quantity, current_timestamp()
)
```

## Conclusion

Delta Lake MERGE operations are fundamental for building reliable data pipelines. Whether you are implementing simple upserts, complex SCD Type 2 patterns, or processing CDC events, the MERGE command provides a transactional and performant solution.

Remember to optimize your MERGE operations by leveraging partitioning, Z-Ordering, and broadcast joins for smaller source datasets. With these patterns, you can build robust data lakes that handle real-world data update scenarios effectively.
