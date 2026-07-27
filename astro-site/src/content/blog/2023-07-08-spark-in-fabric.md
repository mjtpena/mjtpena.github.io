---
title: "Apache Spark in Microsoft Fabric: Getting Started"
author: Michael John Peña
draft: false
date: 2023-07-08
tags:
  - Microsoft Fabric
  - Apache Spark
  - Data Engineering
  - PySpark

---

I wrote "Apache Spark in Microsoft Fabric: Getting Started" to share practical, production-minded guidance on this topic.

## Spark in Fabric Overview

Fabric provides a managed Spark experience:

```python
# Fabric Spark characteristics
fabric_spark = {
    "runtime": "Spark 3.4 with Delta Lake 2.4",
    "languages": ["Python (PySpark)", "Scala", "SparkSQL", "R"],
    "management": "Fully managed - no cluster configuration",
    "startup": "Starter pools for fast spin-up",
    "integration": "Native OneLake integration"
}

# Key differences from Databricks/Synapse:
# - No cluster creation required
# - Fixed compute configurations in preview
# - Automatic session management
# - Built-in Lakehouse integration
```

## Creating a Spark Notebook

```python
# 1. In your workspace, click "+ New" > "Notebook"
# 2. Name your notebook
# 3. Attach to a Lakehouse (provides default context)

# Once created, you have access to:
# - spark: SparkSession (pre-configured)
# - sc: SparkContext
# - dbutils: Utility functions
```

## Basic Spark Operations

### Reading Data

```python
# Read from Lakehouse Tables
df = spark.read.format("delta").table("sales")

# Read from Lakehouse Files
csv_df = spark.read.format("csv") \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .load("Files/raw/sales/*.csv")

json_df = spark.read.format("json") \
    .load("Files/raw/events/*.json")

parquet_df = spark.read.format("parquet") \
    .load("Files/raw/data.parquet")

# Read with explicit schema (recommended for production)
from pyspark.sql.types import *

schema = StructType([
    StructField("id", IntegerType(), False),
    StructField("name", StringType(), True),
    StructField("amount", DoubleType(), True),
    StructField("date", DateType(), True)
])

df = spark.read.format("csv") \
    .schema(schema) \
    .option("header", "true") \
    .load("Files/raw/data.csv")
```

### Transformations

```python
from pyspark.sql.functions import *

# Select and filter
result = df.select("id", "name", "amount") \
    .filter(col("amount") > 100) \
    .orderBy(col("amount").desc())

# Add computed columns
df_enriched = df.withColumn(
    "amount_with_tax",
    col("amount") * 1.1
).withColumn(
    "processed_date",
    current_timestamp()
)

# Aggregations
summary = df.groupBy("category") \
    .agg(
        count("*").alias("count"),
        sum("amount").alias("total"),
        avg("amount").alias("average"),
        min("amount").alias("min_amount"),
        max("amount").alias("max_amount")
    )

# Window functions
from pyspark.sql.window import Window

window_spec = Window.partitionBy("customer_id") \
    .orderBy("order_date") \
    .rowsBetween(Window.unboundedPreceding, Window.currentRow)

df_with_running_total = df.withColumn(
    "running_total",
    sum("amount").over(window_spec)
)
```

### Joins

```python
# Inner join
result = orders.join(
    customers,
    orders.customer_id == customers.id,
    "inner"
).select(
    orders.order_id,
    customers.name,
    orders.amount
)

# Left join with aliasing
from pyspark.sql.functions import col

result = orders.alias("o").join(
    products.alias("p"),
    col("o.product_id") == col("p.id"),
    "left"
).select(
    col("o.order_id"),
    col("p.product_name"),
    col("o.quantity")
)

# Broadcast join for small tables
from pyspark.sql.functions import broadcast

result = large_orders.join(
    broadcast(small_lookup),
    "lookup_key"
)
```

### Writing Data

```python
# Write to Delta table
df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("processed_sales")

# Write modes:
# - "overwrite": Replace entire table
# - "append": Add to existing data
# - "ignore": Skip if table exists
# - "error": Fail if table exists (default)

# Write with partitioning
df.write \
    .format("delta") \
    .mode("overwrite") \
    .partitionBy("year", "month") \
    .saveAsTable("sales_partitioned")

# Write to Files folder (non-Delta)
df.write \
    .format("parquet") \
    .mode("overwrite") \
    .save("Files/processed/sales_output")
```

## Spark SQL

```python
# Register DataFrame as temp view
df.createOrReplaceTempView("temp_sales")

# Run SQL queries
result = spark.sql("""
    SELECT
        customer_id,
        SUM(amount) as total_amount,
        COUNT(*) as order_count
    FROM temp_sales
    WHERE order_date >= '2023-01-01'
    GROUP BY customer_id
    HAVING COUNT(*) > 5
    ORDER BY total_amount DESC
""")

# Query Lakehouse tables directly
sales_df = spark.sql("SELECT * FROM sales_lakehouse.sales")

# Create permanent views
spark.sql("""
    CREATE OR REPLACE VIEW sales_summary AS
    SELECT
        DATE_TRUNC('month', order_date) as month,
        SUM(amount) as monthly_total
    FROM sales
    GROUP BY DATE_TRUNC('month', order_date)
""")
```

## Spark Configuration

```python
# View current Spark configuration
for item in spark.sparkContext.getConf().getAll():
    print(f"{item[0]}: {item[1]}")

# Set session-level configurations
spark.conf.set("spark.sql.shuffle.partitions", "200")
spark.conf.set("spark.sql.adaptive.enabled", "true")

# Delta-specific settings
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.autoCompact.enabled", "true")

# Note: Some settings are fixed in Fabric and cannot be changed
```

## Using dbutils

```python
# File system utilities
dbutils.fs.ls("Files/")
dbutils.fs.cp("Files/source.csv", "Files/destination.csv")
dbutils.fs.mv("Files/old_name", "Files/new_name")
dbutils.fs.rm("Files/to_delete", recurse=True)
dbutils.fs.mkdirs("Files/new_folder/subfolder")

# Notebook utilities
dbutils.notebook.run("./other_notebook", timeout_seconds=300)

# Parameter handling
# In parent notebook:
dbutils.notebook.run("./child_notebook", 300, {"param1": "value1"})

# In child notebook:
param1 = dbutils.widgets.get("param1")
```

## Performance Tips

```python
# 1. Cache frequently used DataFrames
df.cache()
df.count()  # Triggers caching

# Use unpersist when done
df.unpersist()

# 2. Use appropriate partitioning
# Repartition for even distribution
df.repartition(100)

# Coalesce to reduce partitions (no shuffle)
df.coalesce(10)

# 3. Use broadcast for small tables
from pyspark.sql.functions import broadcast
result = big_df.join(broadcast(small_df), "key")

# 4. Push down predicates
# Filter early, select only needed columns
df.filter(col("date") > "2023-01-01") \
    .select("id", "name", "amount")

# 5. Use Delta's optimization features
spark.sql("OPTIMIZE large_table ZORDER BY (customer_id)")
```

## Error Handling

```python
from pyspark.sql.utils import AnalysisException

try:
    df = spark.read.table("non_existent_table")
except AnalysisException as e:
    print(f"Table not found: {e}")

# Validate data before processing
def validate_dataframe(df, required_columns):
    missing = set(required_columns) - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    return df

# Schema validation
expected_schema = StructType([...])
if df.schema != expected_schema:
    print("Schema mismatch detected")
```

Tomorrow we'll dive deeper into Fabric notebooks and their unique features.

## Resources

- [Spark in Fabric](https://learn.microsoft.com/en-us/fabric/data-engineering/spark-compute)
- [PySpark Documentation](https://spark.apache.org/docs/latest/api/python/)
- [Delta Lake + Spark](https://learn.microsoft.com/en-us/fabric/data-engineering/delta-lake)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
