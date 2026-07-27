---
title: "Databricks Delta Lake: Advanced Patterns"
author: Michael John Peña
draft: false
date: 2020-11-16
tags:
  - Databricks
  - Delta Lake
  - Data Engineering
  - Lakehouse

---

I wrote "Databricks Delta Lake: Advanced Patterns" to share practical, production-minded guidance on this topic.

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

## MERGE (Upsert)

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

```python
# Read specific version
df = spark.read.format("delta").option("versionAsOf", 5).load("/delta/events")

# Read at timestamp
df = spark.read.format("delta").option("timestampAsOf", "2020-11-16 10:00:00").load("/delta/events")

# View history
deltaTable = DeltaTable.forPath(spark, "/delta/events")
deltaTable.history().show()

# Restore to previous version
deltaTable.restoreToVersion(5)
```

## Schema Evolution

```python
# Enable auto-merge schema
df.write \
    .format("delta") \
    .option("mergeSchema", "true") \
    .mode("append") \
    .save("/delta/events")

# Explicit schema evolution
spark.sql("""
    ALTER TABLE events
    ADD COLUMNS (
        new_column STRING AFTER existing_column
    )
""")
```

## Optimize and Z-Order

```python
# Compact small files
deltaTable.optimize().executeCompaction()

# Z-Order for query optimization
deltaTable.optimize().executeZOrderBy("date", "customer_id")
```

```sql
-- SQL syntax
OPTIMIZE events ZORDER BY (date, customer_id)
```

## Vacuum (Delete Old Files)

```python
# Delete files older than 7 days
deltaTable.vacuum(168)  # hours

# Aggressive cleanup (careful!)
spark.conf.set("spark.databricks.delta.retentionDurationCheck.enabled", "false")
deltaTable.vacuum(0)
```

## Change Data Feed

```python
# Enable change data feed
spark.sql("""
    ALTER TABLE events
    SET TBLPROPERTIES (delta.enableChangeDataFeed = true)
""")

# Read changes
changes = spark.read.format("delta") \
    .option("readChangeFeed", "true") \
    .option("startingVersion", 10) \
    .table("events")

# Columns: _change_type (insert, update_preimage, update_postimage, delete)
changes.filter("_change_type = 'update_postimage'").show()
```

## Constraints

```sql
-- NOT NULL
ALTER TABLE events ALTER COLUMN customer_id SET NOT NULL

-- CHECK constraint
ALTER TABLE events ADD CONSTRAINT valid_amount CHECK (amount > 0)

-- View constraints
DESCRIBE DETAIL events
```

## Generated Columns

```sql
CREATE TABLE events (
    id BIGINT,
    event_time TIMESTAMP,
    event_date DATE GENERATED ALWAYS AS (CAST(event_time AS DATE))
)
USING DELTA
PARTITIONED BY (event_date)
```

## Clone Tables

```python
# Shallow clone (metadata only)
DeltaTable.forPath(spark, "/delta/events").clone("/delta/events_clone", isShallow=True)

# Deep clone (full copy)
DeltaTable.forPath(spark, "/delta/events").clone("/delta/events_backup", isShallow=False)
```

## Best Practices

| Aspect | Recommendation |
|--------|----------------|
| Partitions | 1GB+ per partition, avoid over-partitioning |
| File size | Target 1GB files |
| Z-Order | Columns frequently in WHERE clauses |
| Vacuum | Run weekly, keep 7+ days history |

Delta Lake: the foundation of the modern lakehouse.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
