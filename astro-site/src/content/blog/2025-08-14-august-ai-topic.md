---
title: "Apache Iceberg on Microsoft Fabric: Open Table Format Integration"
author: Michael John Peña
draft: false
date: 2025-08-14
tags:
  - Apache Iceberg
  - Microsoft Fabric
  - Data Engineering
  - Open Table Format
  - Lakehouse

---

I wrote "Apache Iceberg on Microsoft Fabric: Open Table Format Integration" to share practical, production-minded guidance on this topic.

## Why Iceberg Matters

Iceberg provides ACID transactions, schema evolution, time travel, and partition evolution for data lakes. Its format-agnostic design works with Spark, Trino, Flink, and many other engines.

## Reading Iceberg Tables in Fabric

```python
# Configure Spark session for Iceberg
spark.conf.set("spark.sql.catalog.iceberg_catalog", "org.apache.iceberg.spark.SparkCatalog")
spark.conf.set("spark.sql.catalog.iceberg_catalog.type", "hadoop")
spark.conf.set("spark.sql.catalog.iceberg_catalog.warehouse", "abfss://container@storage.dfs.core.windows.net/iceberg")

# Read Iceberg table
df = spark.read.format("iceberg").load("iceberg_catalog.db.events")

# Query with time travel
df_historical = spark.read \
    .format("iceberg") \
    .option("as-of-timestamp", "2025-08-01 00:00:00") \
    .load("iceberg_catalog.db.events")

# View table history
spark.sql("SELECT * FROM iceberg_catalog.db.events.history").show()
```

## Creating Iceberg Tables

```python
# Create a new Iceberg table
df.writeTo("iceberg_catalog.db.new_events") \
    .using("iceberg") \
    .partitionedBy("date", "region") \
    .create()

# Append data
new_data.writeTo("iceberg_catalog.db.new_events").append()

# Upsert with MERGE
spark.sql("""
    MERGE INTO iceberg_catalog.db.events t
    USING updates s
    ON t.event_id = s.event_id
    WHEN MATCHED THEN UPDATE SET *
    WHEN NOT MATCHED THEN INSERT *
""")
```

## Iceberg vs Delta Lake

Both formats provide similar core capabilities. Delta Lake has deeper Fabric integration through native OneLake support. Iceberg offers broader ecosystem compatibility. Many organizations use both, choosing based on specific workload requirements and existing tool investments.

The ability to work with Iceberg in Fabric ensures you're not locked into a single format and can integrate with diverse data sources.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
