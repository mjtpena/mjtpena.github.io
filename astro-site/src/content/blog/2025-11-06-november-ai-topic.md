---
title: "Delta Lake Deep Dive: Time Travel and Schema Evolution in Fabric"
author: Michael John Peña
draft: false
date: 2025-11-06
tags:
  - Microsoft Fabric
  - Delta Lake
  - Data Engineering
  - Lakehouse
  - Version Control

---

I wrote "Delta Lake Deep Dive: Time Travel and Schema Evolution in Fabric" to share practical, production-minded guidance on this topic.

## Understanding Delta Lake Versioning

Every write operation to a Delta table creates a new version. This transaction log enables point-in-time queries and rollback capabilities essential for production data systems.

## Time Travel Queries

Access historical data states without maintaining separate backup copies:

```python
from pyspark.sql import SparkSession
from delta.tables import DeltaTable

spark = SparkSession.builder.getOrCreate()

# Query data as it existed at a specific version
df_v5 = spark.read.format("delta") \
    .option("versionAsOf", 5) \
    .load("Tables/sales_transactions")

# Query data as it existed at a specific timestamp
df_historical = spark.read.format("delta") \
    .option("timestampAsOf", "2025-11-01T10:00:00") \
    .load("Tables/sales_transactions")

# Compare current and historical data
current_df = spark.table("sales_transactions")

changes = current_df.subtract(df_historical)
print(f"New records since Nov 1: {changes.count()}")

# Audit trail: review all changes
delta_table = DeltaTable.forName(spark, "sales_transactions")
history = delta_table.history()

history.select(
    "version",
    "timestamp",
    "operation",
    "operationParameters",
    "operationMetrics"
).show(truncate=False)
```

## Schema Evolution

Delta Lake handles schema changes gracefully, enabling agile data development:

```python
# Enable automatic schema evolution
spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", "true")

# Add new columns automatically during merge
delta_table = DeltaTable.forName(spark, "customer_profiles")

new_data = spark.createDataFrame([
    {"customer_id": "C001", "name": "John", "loyalty_tier": "Gold"},  # New column
    {"customer_id": "C002", "name": "Jane", "loyalty_tier": "Silver"}
])

delta_table.alias("target").merge(
    new_data.alias("source"),
    "target.customer_id = source.customer_id"
).whenMatchedUpdateAll() \
 .whenNotMatchedInsertAll() \
 .execute()

# Schema evolution for additive changes
new_data_with_extra_columns = spark.createDataFrame([
    {"customer_id": "C003", "name": "Bob", "loyalty_tier": "Bronze", "region": "APAC"}
])

new_data_with_extra_columns.write \
    .format("delta") \
    .mode("append") \
    .option("mergeSchema", "true") \
    .saveAsTable("customer_profiles")

# Review schema history
delta_table = DeltaTable.forName(spark, "customer_profiles")
for version in range(delta_table.history().count()):
    schema_at_version = spark.read.format("delta") \
        .option("versionAsOf", version) \
        .load(delta_table.detail().select("location").first()[0]) \
        .schema
    print(f"Version {version}: {[f.name for f in schema_at_version.fields]}")
```

## Rollback and Recovery

When issues occur, Delta Lake enables quick recovery:

```python
# Restore table to previous version
delta_table.restoreToVersion(10)

# Or restore to timestamp
delta_table.restoreToTimestamp("2025-11-05T14:30:00")
```

Delta Lake's versioning capabilities transform data lakes from fragile file stores into robust, auditable data platforms suitable for enterprise workloads.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
