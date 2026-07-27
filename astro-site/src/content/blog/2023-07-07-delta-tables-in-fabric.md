---
title: "Delta Tables in Microsoft Fabric: Deep Dive"
author: Michael John Peña
draft: false
date: 2023-07-07
tags:
  - Microsoft Fabric
  - Delta Lake
  - Data Engineering
  - Lakehouse
---

The theoretical benefits of Delta Lake — ACID transactions, time travel, schema enforcement — are easy to describe, but the practical payoff becomes clear when things go wrong. A Spark job that fails halfway through a write doesn't leave a corrupt table; the transaction rolls back and the table stays in its last valid state. A bad transformation that runs to completion can be undone with `RESTORE TABLE ... TO VERSION AS OF N` rather than a restore from backup. Schema enforcement rejects columns you didn't declare rather than silently adding nulls. I've been using Delta tables in Fabric for a month now and I want to go through the operations that matter most in practice: `OPTIMIZE` for small file compaction, `VACUUM` for log cleanup, and `Z-ORDER` for query-optimised clustering on frequently filtered columns.

## Understanding Delta Lake

Delta Lake adds a transaction log layer on top of Parquet files:

```python
# Delta table structure
"""
Tables/customers/
├── _delta_log/                    # Transaction log
│   ├── 00000000000000000000.json # First commit
│   ├── 00000000000000000001.json # Second commit
│   └── _last_checkpoint          # Checkpoint marker
├── part-00000-xxx.snappy.parquet # Data file
├── part-00001-xxx.snappy.parquet # Data file
└── part-00002-xxx.snappy.parquet # Data file
"""

# Key Delta features in Fabric:
delta_features = {
    "acid_transactions": "Atomic, Consistent, Isolated, Durable",
    "schema_evolution": "Add columns without rewriting data",
    "time_travel": "Query historical versions",
    "merge_operations": "Upsert support (INSERT/UPDATE/DELETE)",
    "z_ordering": "Data clustering for query optimization",
    "vacuum": "Clean up old files"
}
```

## Creating Delta Tables

### Method 1: Create from DataFrame

```python
from pyspark.sql.types import *
from pyspark.sql.functions import *

# Define schema
schema = StructType([
    StructField("transaction_id", StringType(), False),
    StructField("customer_id", IntegerType(), False),
    StructField("product_id", IntegerType(), False),
    StructField("quantity", IntegerType(), False),
    StructField("unit_price", DecimalType(10, 2), False),
    StructField("transaction_date", DateType(), False)
])

# Create sample data
data = [
    ("TXN001", 1, 101, 2, 29.99, "2023-07-01"),
    ("TXN002", 2, 102, 1, 49.99, "2023-07-01"),
    ("TXN003", 1, 103, 3, 19.99, "2023-07-02"),
]

df = spark.createDataFrame(data, schema)

# Write as Delta table
df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("transactions")

print("Delta table created successfully!")
```

### Method 2: Create with SQL

```sql
-- Create managed Delta table
CREATE TABLE IF NOT EXISTS products (
    product_id INT NOT NULL,
    product_name STRING NOT NULL,
    category STRING,
    unit_price DECIMAL(10, 2),
    stock_quantity INT,
    last_updated TIMESTAMP
)
USING DELTA
COMMENT 'Product catalog table';

-- Create table with partitioning
CREATE TABLE IF NOT EXISTS sales_partitioned (
    sale_id STRING,
    product_id INT,
    customer_id INT,
    sale_date DATE,
    quantity INT,
    amount DECIMAL(10, 2)
)
USING DELTA
PARTITIONED BY (sale_date)
COMMENT 'Sales transactions partitioned by date';
```

## CRUD Operations with Delta

### INSERT Operations

```python
# Insert via DataFrame
new_data = [
    ("TXN004", 3, 104, 1, 99.99, "2023-07-03"),
    ("TXN005", 4, 101, 2, 29.99, "2023-07-03"),
]

new_df = spark.createDataFrame(new_data, schema)
new_df.write.format("delta").mode("append").saveAsTable("transactions")

# Insert via SQL
spark.sql("""
    INSERT INTO transactions VALUES
    ('TXN006', 5, 102, 1, 49.99, '2023-07-04'),
    ('TXN007', 6, 103, 2, 19.99, '2023-07-04')
""")
```

### UPDATE Operations

```python
# Update via SQL
spark.sql("""
    UPDATE transactions
    SET unit_price = 34.99
    WHERE product_id = 101
""")

# Update via DeltaTable API
from delta.tables import DeltaTable

delta_table = DeltaTable.forName(spark, "transactions")
delta_table.update(
    condition="product_id = 102",
    set={"unit_price": "54.99"}
)
```

### DELETE Operations

```python
# Delete via SQL
spark.sql("""
    DELETE FROM transactions
    WHERE transaction_date < '2023-07-01'
""")

# Delete via DeltaTable API
delta_table.delete(condition="quantity = 0")
```

### MERGE (Upsert) Operations

```python
# MERGE is the most powerful Delta operation
# Handles INSERT, UPDATE, and DELETE in one operation

# Source data (could be CDC feed, new file, etc.)
source_data = [
    ("TXN001", 1, 101, 5, 29.99, "2023-07-01"),  # Update: quantity changed
    ("TXN008", 7, 105, 1, 79.99, "2023-07-05"),  # New record
]
source_df = spark.createDataFrame(source_data, schema)

# Perform merge
delta_table.alias("target").merge(
    source_df.alias("source"),
    "target.transaction_id = source.transaction_id"
).whenMatchedUpdate(set={
    "quantity": "source.quantity",
    "unit_price": "source.unit_price"
}).whenNotMatchedInsertAll().execute()

# SQL version of MERGE
spark.sql("""
    MERGE INTO transactions AS target
    USING source_transactions AS source
    ON target.transaction_id = source.transaction_id
    WHEN MATCHED THEN UPDATE SET *
    WHEN NOT MATCHED THEN INSERT *
""")
```

## Time Travel

Delta Lake maintains history, enabling time travel:

```python
# View table history
spark.sql("DESCRIBE HISTORY transactions").show(truncate=False)

# Query by version number
df_v1 = spark.read.format("delta") \
    .option("versionAsOf", 1) \
    .table("transactions")

# Query by timestamp
df_yesterday = spark.read.format("delta") \
    .option("timestampAsOf", "2023-07-06 10:00:00") \
    .table("transactions")

# Restore to previous version
spark.sql("RESTORE TABLE transactions TO VERSION AS OF 1")

# Compare versions
v1 = spark.read.format("delta").option("versionAsOf", 1).table("transactions")
v2 = spark.read.format("delta").option("versionAsOf", 2).table("transactions")

# Find changes
changes = v2.subtract(v1)
changes.show()
```

## Schema Evolution

```python
# Add new columns without rewriting data
spark.sql("""
    ALTER TABLE transactions ADD COLUMNS (
        discount_percent DECIMAL(5, 2) DEFAULT 0,
        notes STRING
    )
""")

# Enable automatic schema evolution for writes
new_df_with_extra_column = df.withColumn("source_system", lit("web"))

new_df_with_extra_column.write \
    .format("delta") \
    .mode("append") \
    .option("mergeSchema", "true") \
    .saveAsTable("transactions")
```

## Optimization Commands

```python
# OPTIMIZE: Compacts small files into larger ones
spark.sql("OPTIMIZE transactions")

# OPTIMIZE with Z-ORDER: Colocate related data
spark.sql("OPTIMIZE transactions ZORDER BY (customer_id, transaction_date)")

# VACUUM: Remove old files
# Default retention: 7 days (168 hours)
spark.sql("VACUUM transactions RETAIN 168 HOURS")

# Check vacuum status
spark.sql("VACUUM transactions DRY RUN").show()
```

## Delta Table Properties

```python
# Set table properties
spark.sql("""
    ALTER TABLE transactions SET TBLPROPERTIES (
        'delta.logRetentionDuration' = 'interval 30 days',
        'delta.deletedFileRetentionDuration' = 'interval 7 days',
        'delta.autoOptimize.optimizeWrite' = 'true',
        'delta.autoOptimize.autoCompact' = 'true'
    )
""")

# View table properties
spark.sql("SHOW TBLPROPERTIES transactions").show(truncate=False)

# Describe table in detail
spark.sql("DESCRIBE DETAIL transactions").show(truncate=False)
```

## Best Practices

```python
# 1. Partition strategy
# Partition by low-cardinality columns commonly used in filters
# Avoid over-partitioning (creates too many small files)

# Good: Partition by date for time-series data
df.write.format("delta") \
    .partitionBy("year", "month") \
    .mode("overwrite") \
    .saveAsTable("sales_by_month")

# 2. Z-ORDER for high-cardinality columns
# Use for columns frequently in WHERE clauses
spark.sql("OPTIMIZE sales ZORDER BY (customer_id, product_id)")

# 3. Regular maintenance
maintenance_tasks = """
-- Run weekly
OPTIMIZE table_name;
VACUUM table_name RETAIN 168 HOURS;

-- Monitor table health
DESCRIBE DETAIL table_name;
DESCRIBE HISTORY table_name;
"""

# 4. Use Delta-specific features
# - Enable auto-optimize for write-heavy workloads
# - Use MERGE instead of DELETE + INSERT
# - Leverage time travel for debugging
```

Tomorrow we'll explore Spark in Fabric and how to use notebooks effectively.

## Resources

- [Delta Lake Documentation](https://learn.microsoft.com/en-us/fabric/data-engineering/delta-lake)
- [Delta Lake Best Practices](https://docs.delta.io/latest/best-practices.html)
- [Time Travel](https://learn.microsoft.com/en-us/fabric/data-engineering/delta-lake#delta-lake-time-travel)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
