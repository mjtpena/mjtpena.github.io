---
title: "Getting Started with Delta Lake on Azure Databricks"
description: "Data lakes have a long-standing reputation problem: cheap to fill, painful to trust. Schema drift, half-written files from failed jobs, \"is this row a…"
author: Michael John Peña
draft: false
date: 2020-11-16
tags:
  - Databricks
  - Delta Lake
  - Data Engineering
  - Lakehouse
---

Data lakes have a long-standing reputation problem: cheap to fill, painful to trust. Schema drift, half-written files from failed jobs, "is this row a duplicate of yesterday's run?"—I've debugged all of them. Delta Lake is the layer that fixes this. ACID transactions, schema enforcement, and time travel on top of Parquet in object storage. Since being open-sourced in 2019 it's matured fast, and on Azure Databricks it's the default I now reach for.

## What is Delta Lake?

Delta Lake is an open-source storage layer that brings ACID transactions to Apache Spark and big data workloads. Key capabilities include:

- **ACID Transactions**: Serializable isolation levels
- **Schema Enforcement**: Prevents bad data from corrupting your tables
- **Time Travel**: Query previous versions of your data
- **Unified Batch and Streaming**: Same table for both workloads

## Creating Delta Tables

```python
# From DataFrame
df.write.format("delta").save("/delta/events")

# Managed table
df.write.format("delta").saveAsTable("events")

# With partitioning
df.write \
    .format("delta") \
    .partitionBy("year", "month") \
    .save("/delta/events")
```

## Reading Delta Tables

```python
# Read latest version
df = spark.read.format("delta").load("/delta/events")

# SQL syntax
spark.sql("SELECT * FROM delta.`/delta/events`")

# Registered table
spark.sql("SELECT * FROM events")
```

## MERGE (Upsert) Operations

One of Delta Lake's most powerful features is the MERGE command for upserts:

```python
from delta.tables import DeltaTable

# Load target table
target = DeltaTable.forPath(spark, "/delta/customers")

# Merge source updates
target.alias("t").merge(
    updates_df.alias("s"),
    "t.customer_id = s.customer_id"
).whenMatchedUpdate(set={
    "name": "s.name",
    "email": "s.email",
    "updated_at": "current_timestamp()"
}).whenNotMatchedInsert(values={
    "customer_id": "s.customer_id",
    "name": "s.name",
    "email": "s.email",
    "created_at": "current_timestamp()",
    "updated_at": "current_timestamp()"
}).execute()
```

## Time Travel

Query historical versions of your data:

```python
# Read specific version
df = spark.read.format("delta").option("versionAsOf", 5).load("/delta/events")

# Read at timestamp
df = spark.read.format("delta").option("timestampAsOf", "2020-11-16 10:00:00").load("/delta/events")

# View history
deltaTable = DeltaTable.forPath(spark, "/delta/events")
deltaTable.history().show()
```

```sql
-- SQL syntax
SELECT * FROM events VERSION AS OF 5;
SELECT * FROM events TIMESTAMP AS OF '2020-11-16';
DESCRIBE HISTORY events;
```

## Schema Evolution

```python
# Enable auto-merge schema
df.write \
    .format("delta") \
    .option("mergeSchema", "true") \
    .mode("append") \
    .save("/delta/events")
```

```sql
-- Explicit schema changes
ALTER TABLE events ADD COLUMNS (
    new_column STRING AFTER existing_column
);
```

## Optimize Performance

### Compaction

Small files hurt query performance. Use OPTIMIZE to compact them:

```python
from delta.tables import DeltaTable

deltaTable = DeltaTable.forPath(spark, "/delta/events")
deltaTable.optimize().executeCompaction()
```

```sql
OPTIMIZE events;
```

### Z-Ordering

Co-locate related data for faster queries:

```sql
OPTIMIZE events ZORDER BY (date, customer_id);
```

## Vacuum Old Files

Remove files no longer referenced by the Delta table:

```python
# Delete files older than 7 days (default retention)
deltaTable.vacuum()

# Specify retention period in hours
deltaTable.vacuum(168)  # 7 days
```

```sql
VACUUM events RETAIN 168 HOURS;
```

## Streaming with Delta Lake

Delta Lake works seamlessly with Spark Structured Streaming:

```python
# Stream reads
stream_df = spark.readStream \
    .format("delta") \
    .load("/delta/events")

# Stream writes
stream_df.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/events") \
    .start("/delta/processed_events")
```

## Best Practices

| Aspect | Recommendation |
|--------|----------------|
| Partitions | 1GB+ per partition, avoid over-partitioning |
| File size | Target 1GB files using OPTIMIZE |
| Z-Order | Columns frequently in WHERE clauses |
| Vacuum | Run weekly, keep 7+ days history |
| Statistics | Delta collects automatically, no manual action needed |

## Integration with Azure

Delta Lake integrates well with the Azure ecosystem:

- **Azure Data Lake Storage Gen2**: Primary storage layer
- **Azure Data Factory**: Orchestrate Delta Lake pipelines
- **Power BI**: Direct query support via Databricks connector
- **Azure Synapse** (preview): Query Delta tables from Synapse

## Getting Started

```python
# Create your first Delta table
data = [
    (1, "Alice", "2020-01-01"),
    (2, "Bob", "2020-01-02"),
    (3, "Charlie", "2020-01-03")
]

df = spark.createDataFrame(data, ["id", "name", "date"])

df.write \
    .format("delta") \
    .mode("overwrite") \
    .save("/delta/my_first_table")

# Query it
spark.read.format("delta").load("/delta/my_first_table").show()
```

Delta Lake brings data warehouse reliability to your data lake, enabling the modern lakehouse architecture.

## Resources

- [Delta Lake Documentation](https://docs.delta.io/)
- [Azure Databricks Delta Lake Guide](https://docs.microsoft.com/en-us/azure/databricks/delta/)
- [Delta Lake GitHub](https://github.com/delta-io/delta)
