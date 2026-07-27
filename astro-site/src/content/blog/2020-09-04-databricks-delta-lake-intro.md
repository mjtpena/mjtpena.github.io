---
title: "Introduction to Delta Lake on Azure Databricks"
author: Michael John Peña
draft: false
date: 2020-09-04
tags:
  - Azure
  - Databricks
  - Delta Lake
  - Data Engineering
---

Anyone who's run a "data lake" for any length of time has hit the same wall: parquet files everywhere, no transactional guarantees, partial-write disasters when a job dies mid-batch, and absolutely nothing resembling time-travel debugging when a downstream report goes wrong. Delta Lake adds an ACID layer over parquet that fixes most of those pain points. It's the difference between a data lake and a data lakehouse — and on Databricks, it's now the default storage format I reach for.

## Why Delta Lake?

Traditional data lake problems:
- No transactions (partial writes corrupt data)
- No schema enforcement (garbage in, garbage forever)
- No versioning (can't rollback mistakes)

Delta Lake solves all of these.

## Basic Operations

```python
# Write data as Delta
df.write \
    .format("delta") \
    .mode("overwrite") \
    .save("/mnt/datalake/sales")

# Read Delta table
sales = spark.read.format("delta").load("/mnt/datalake/sales")

# Create managed table
df.write.format("delta").saveAsTable("sales.transactions")
```

## MERGE for Upserts

```python
from delta.tables import DeltaTable

deltaTable = DeltaTable.forPath(spark, "/mnt/datalake/customers")

deltaTable.alias("target") \
    .merge(
        updates.alias("source"),
        "target.customer_id = source.customer_id"
    ) \
    .whenMatchedUpdate(set={
        "name": "source.name",
        "email": "source.email",
        "updated_at": "current_timestamp()"
    }) \
    .whenNotMatchedInsert(values={
        "customer_id": "source.customer_id",
        "name": "source.name",
        "email": "source.email",
        "created_at": "current_timestamp()",
        "updated_at": "current_timestamp()"
    }) \
    .execute()
```

## Time Travel

```python
# Read previous version
df_v5 = spark.read.format("delta").option("versionAsOf", 5).load("/mnt/datalake/sales")

# Read as of timestamp
df_yesterday = spark.read.format("delta") \
    .option("timestampAsOf", "2020-09-03") \
    .load("/mnt/datalake/sales")

# Restore to previous version
deltaTable.restoreToVersion(5)
```

Delta Lake transforms your data lake from a dumping ground into a reliable data platform.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
