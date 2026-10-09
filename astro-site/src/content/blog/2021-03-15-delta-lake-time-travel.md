---
title: Delta Lake Time Travel - Versioned Data Lake Queries
description: "Delta Lake time travel is the feature that makes \"oops\" survivable. An engineer runs a DELETE with a typo in the WHERE clause. A batch job writes corrupt…"
author: Michael John Pena
draft: false
date: 2021-03-15
url: /blog/delta-lake-time-travel/
tags:
  - Azure
  - Delta Lake
  - Databricks
  - Data Lake
  - Version Control
---

Delta Lake time travel is the feature that makes "oops" survivable. An engineer runs a DELETE with a typo in the WHERE clause. A batch job writes corrupt data. A pipeline produces the wrong transformation output. Without time travel, recovery means restoring a backup—slow, noisy, and often losing hours of good data alongside the bad. With Delta, you roll back to the previous version in seconds. The `RESTORE TABLE` syntax appeared in Delta 0.8, and the `VERSION AS OF` and `TIMESTAMP AS OF` clauses let you query any historical snapshot for auditing. Today's post is the mechanics, the retention settings you need to understand, and the operational patterns I use to make time travel a routine tool rather than an emergency one.

## Understanding Delta Lake Versioning

Every transaction on a Delta table creates a new version. The transaction log maintains a complete history, enabling:
- Query data as of any previous version
- Rollback to previous states
- Audit data changes over time
- Reproduce analytical results

## Basic Time Travel Queries

```python
from pyspark.sql import SparkSession
from delta.tables import DeltaTable

spark = SparkSession.builder \
    .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
    .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
    .getOrCreate()

# Create a sample Delta table
data = [
    (1, "Alice", 1000),
    (2, "Bob", 2000),
    (3, "Charlie", 1500)
]
df = spark.createDataFrame(data, ["id", "name", "balance"])
df.write.format("delta").mode("overwrite").save("/delta/accounts")

# Make some updates
spark.sql("UPDATE delta.`/delta/accounts` SET balance = balance + 500 WHERE id = 1")
spark.sql("UPDATE delta.`/delta/accounts` SET balance = balance - 200 WHERE id = 2")
spark.sql("DELETE FROM delta.`/delta/accounts` WHERE id = 3")
```

### Query by Version Number

```python
# Query current version
current_df = spark.read.format("delta").load("/delta/accounts")
print("Current state:")
current_df.show()

# Query version 0 (original)
version_0_df = spark.read.format("delta") \
    .option("versionAsOf", 0) \
    .load("/delta/accounts")
print("Version 0 (original):")
version_0_df.show()

# Query version 1 (after first update)
version_1_df = spark.read.format("delta") \
    .option("versionAsOf", 1) \
    .load("/delta/accounts")
print("Version 1:")
version_1_df.show()
```

### Query by Timestamp

```python
from datetime import datetime, timedelta

# Query data as of specific timestamp
timestamp = "2021-03-15 10:00:00"
historical_df = spark.read.format("delta") \
    .option("timestampAsOf", timestamp) \
    .load("/delta/accounts")

# Query data as of 1 hour ago
one_hour_ago = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
df_1h_ago = spark.read.format("delta") \
    .option("timestampAsOf", one_hour_ago) \
    .load("/delta/accounts")
```

### SQL Syntax for Time Travel

```sql
-- Query by version
SELECT * FROM delta.`/delta/accounts` VERSION AS OF 0;

-- Query by timestamp
SELECT * FROM delta.`/delta/accounts` TIMESTAMP AS OF '2021-03-15 10:00:00';

-- Using table alias
SELECT * FROM delta.`/delta/accounts`@v0;

-- Compare versions
SELECT
    curr.id,
    curr.name,
    curr.balance AS current_balance,
    prev.balance AS previous_balance,
    curr.balance - prev.balance AS change
FROM delta.`/delta/accounts` AS curr
FULL OUTER JOIN delta.`/delta/accounts` VERSION AS OF 0 AS prev
    ON curr.id = prev.id;
```

## Viewing Table History

```python
# Get table history
delta_table = DeltaTable.forPath(spark, "/delta/accounts")
history_df = delta_table.history()

history_df.select(
    "version",
    "timestamp",
    "operation",
    "operationParameters",
    "operationMetrics"
).show(truncate=False)
```

```sql
-- SQL syntax for history
DESCRIBE HISTORY delta.`/delta/accounts`;

-- Get specific number of versions
DESCRIBE HISTORY delta.`/delta/accounts` LIMIT 10;
```

## Rolling Back Changes

```python
# Rollback to a specific version
delta_table = DeltaTable.forPath(spark, "/delta/accounts")

# Method 1: Restore command (Delta Lake 1.0+)
delta_table.restoreToVersion(0)

# Method 2: Restore to timestamp
delta_table.restoreToTimestamp("2021-03-15 10:00:00")

# Method 3: Overwrite with historical data
historical_df = spark.read.format("delta") \
    .option("versionAsOf", 0) \
    .load("/delta/accounts")

historical_df.write.format("delta") \
    .mode("overwrite") \
    .option("overwriteSchema", "true") \
    .save("/delta/accounts")
```

```sql
-- SQL restore commands
RESTORE TABLE delta.`/delta/accounts` TO VERSION AS OF 0;

RESTORE TABLE delta.`/delta/accounts` TO TIMESTAMP AS OF '2021-03-15 10:00:00';
```

## Change Data Capture (CDC)

```python
# Enable change data feed
spark.sql("""
    ALTER TABLE delta.`/delta/accounts`
    SET TBLPROPERTIES (delta.enableChangeDataFeed = true)
""")

# Or set at creation time
df.write.format("delta") \
    .option("delta.enableChangeDataFeed", "true") \
    .mode("overwrite") \
    .save("/delta/accounts_cdf")

# Read changes between versions
changes_df = spark.read.format("delta") \
    .option("readChangeFeed", "true") \
    .option("startingVersion", 1) \
    .option("endingVersion", 3) \
    .load("/delta/accounts_cdf")

changes_df.show()
# Shows _change_type column: insert, update_preimage, update_postimage, delete

# Read changes since timestamp
changes_since = spark.read.format("delta") \
    .option("readChangeFeed", "true") \
    .option("startingTimestamp", "2021-03-15 00:00:00") \
    .load("/delta/accounts_cdf")
```

## Audit Trail Implementation

```python
from pyspark.sql.functions import *

def create_audit_report(table_path, start_version=None, end_version=None):
    """Generate audit report for Delta table changes."""

    delta_table = DeltaTable.forPath(spark, table_path)
    history = delta_table.history()

    if start_version is not None:
        history = history.filter(col("version") >= start_version)
    if end_version is not None:
        history = history.filter(col("version") <= end_version)

    audit_report = history.select(
        "version",
        "timestamp",
        "operation",
        "userName",
        col("operationMetrics.numOutputRows").alias("rows_affected"),
        col("operationMetrics.numAddedFiles").alias("files_added"),
        col("operationMetrics.numRemovedFiles").alias("files_removed"),
        col("operationParameters").alias("parameters")
    )

    return audit_report

# Generate audit report
audit = create_audit_report("/delta/accounts", start_version=0)
audit.show(truncate=False)

# Save audit report
audit.write.format("delta") \
    .mode("append") \
    .save("/delta/audit_logs")
```

## Reproducible Analytics

```python
# Pin analytics to specific version for reproducibility
def run_analytics_pipeline(table_path, version):
    """Run analytics on a specific version for reproducibility."""

    # Read data at specific version
    df = spark.read.format("delta") \
        .option("versionAsOf", version) \
        .load(table_path)

    # Perform analytics
    summary = df.groupBy("name").agg(
        sum("balance").alias("total_balance"),
        count("*").alias("record_count")
    )

    # Tag results with version
    result = summary.withColumn("source_version", lit(version)) \
                   .withColumn("analysis_timestamp", current_timestamp())

    return result

# Run reproducible analysis
result_v0 = run_analytics_pipeline("/delta/accounts", 0)
result_v1 = run_analytics_pipeline("/delta/accounts", 1)

# Compare results across versions
result_v0.show()
result_v1.show()
```

## Retention and Cleanup

```python
# Configure retention period
spark.sql("""
    ALTER TABLE delta.`/delta/accounts`
    SET TBLPROPERTIES (delta.logRetentionDuration = '30 days')
""")

spark.sql("""
    ALTER TABLE delta.`/delta/accounts`
    SET TBLPROPERTIES (delta.deletedFileRetentionDuration = '7 days')
""")

# Vacuum to clean up old files (respects retention)
delta_table = DeltaTable.forPath(spark, "/delta/accounts")
delta_table.vacuum(168)  # 168 hours = 7 days

# Warning: Vacuum with 0 hours will break time travel!
# Only do this if you explicitly want to remove all history
# spark.conf.set("spark.databricks.delta.retentionDurationCheck.enabled", "false")
# delta_table.vacuum(0)
```

## Best Practices

1. **Set appropriate retention periods** based on compliance requirements
2. **Use Change Data Feed** for efficient incremental processing
3. **Document version milestones** for important data states
4. **Test rollback procedures** before you need them
5. **Monitor table history growth** and vacuum regularly

```python
# Create version bookmark for important milestones
def bookmark_version(table_path, description):
    """Create a bookmark for current version."""
    delta_table = DeltaTable.forPath(spark, table_path)
    current_version = delta_table.history(1).select("version").first()[0]

    bookmark = spark.createDataFrame([
        (table_path, current_version, description, datetime.now())
    ], ["table_path", "version", "description", "created_at"])

    bookmark.write.format("delta") \
        .mode("append") \
        .save("/delta/version_bookmarks")

    return current_version

# Bookmark important versions
bookmark_version("/delta/accounts", "Pre-migration snapshot")
bookmark_version("/delta/accounts", "Q1 2021 close")
```

## Conclusion

Delta Lake time travel transforms your data lake into a versioned, auditable system. Key benefits:

- **Compliance**: Full audit trail of data changes
- **Recovery**: Easy rollback from errors or corruption
- **Reproducibility**: Pin analytics to specific data versions
- **Debugging**: Compare data across time to identify issues

Time travel is one of Delta Lake's most powerful features for enterprise data management.
