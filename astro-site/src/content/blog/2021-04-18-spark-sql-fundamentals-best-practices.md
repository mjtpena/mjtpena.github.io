---
title: Spark SQL Fundamentals and Best Practices
author: Michael John Peña
draft: false
date: 2021-04-18
url: /blog/spark-sql-fundamentals-best-practices/
tags:
  - Apache Spark
  - Spark SQL
  - Big Data
  - Data Engineering
  - Analytics
---

Spark SQL is where I've seen the highest productivity for data engineers who already know SQL but are new to distributed processing. You write familiar SQL against DataFrames registered as temporary views or Hive tables, and Spark's Catalyst optimiser turns it into an execution plan that runs across the cluster. The behaviour that trips up SQL-native engineers is the lazy evaluation model—transformations don't execute until an action is called—and the significance of partitioning for join and aggregate performance. Today's post covers the optimiser hints, caching strategy, and partition advice that made the biggest difference on real Spark workloads I've run in production.

## Understanding Spark SQL Architecture

```
              SQL Query / DataFrame API
                        │
                        ▼
               ┌────────────────┐
               │ Catalyst       │
               │ Optimizer      │
               │ (Logical Plan) │
               └────────────────┘
                        │
                        ▼
               ┌────────────────┐
               │ Tungsten       │
               │ Execution      │
               │ Engine         │
               └────────────────┘
                        │
                        ▼
               ┌────────────────┐
               │ Physical Plan  │
               │ (RDD)          │
               └────────────────┘
```

## Getting Started with Spark SQL

### Creating a SparkSession

```python
from pyspark.sql import SparkSession

spark = SparkSession.builder \
    .appName("SparkSQLDemo") \
    .config("spark.sql.adaptive.enabled", "true") \
    .config("spark.sql.adaptive.coalescePartitions.enabled", "true") \
    .config("spark.sql.shuffle.partitions", "200") \
    .getOrCreate()

# Set log level
spark.sparkContext.setLogLevel("WARN")
```

### Reading Data

```python
# Read from various sources
df_parquet = spark.read.parquet("data/sales/*.parquet")

df_csv = spark.read \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .csv("data/products.csv")

df_json = spark.read \
    .option("multiLine", "true") \
    .json("data/events/*.json")

df_delta = spark.read.format("delta").load("data/customers")

# Read with schema
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, TimestampType

schema = StructType([
    StructField("order_id", StringType(), False),
    StructField("customer_id", StringType(), False),
    StructField("amount", DoubleType(), True),
    StructField("order_date", TimestampType(), True)
])

df = spark.read.schema(schema).parquet("data/orders")
```

## SQL Queries

### Register Tables and Views

```python
# Create temporary view
df_orders.createOrReplaceTempView("orders")
df_customers.createOrReplaceTempView("customers")

# Create global temporary view (accessible across sessions)
df_products.createOrReplaceGlobalTempView("products")

# Query with SQL
result = spark.sql("""
    SELECT
        c.customer_name,
        COUNT(o.order_id) as order_count,
        SUM(o.amount) as total_spent
    FROM orders o
    JOIN customers c ON o.customer_id = c.customer_id
    WHERE o.order_date >= '2021-01-01'
    GROUP BY c.customer_name
    HAVING SUM(o.amount) > 1000
    ORDER BY total_spent DESC
    LIMIT 100
""")

result.show()
```

### Complex Queries

```python
# Window functions
result = spark.sql("""
    SELECT
        customer_id,
        order_date,
        amount,
        SUM(amount) OVER (
            PARTITION BY customer_id
            ORDER BY order_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as running_total,
        ROW_NUMBER() OVER (
            PARTITION BY customer_id
            ORDER BY order_date
        ) as order_sequence,
        LAG(amount, 1) OVER (
            PARTITION BY customer_id
            ORDER BY order_date
        ) as previous_order_amount
    FROM orders
""")

# Common Table Expressions (CTEs)
result = spark.sql("""
    WITH monthly_sales AS (
        SELECT
            DATE_TRUNC('month', order_date) as month,
            customer_id,
            SUM(amount) as monthly_amount
        FROM orders
        GROUP BY DATE_TRUNC('month', order_date), customer_id
    ),
    customer_segments AS (
        SELECT
            customer_id,
            AVG(monthly_amount) as avg_monthly_spend,
            CASE
                WHEN AVG(monthly_amount) > 10000 THEN 'Premium'
                WHEN AVG(monthly_amount) > 1000 THEN 'Standard'
                ELSE 'Basic'
            END as segment
        FROM monthly_sales
        GROUP BY customer_id
    )
    SELECT
        segment,
        COUNT(*) as customer_count,
        AVG(avg_monthly_spend) as avg_spend
    FROM customer_segments
    GROUP BY segment
""")
```

## DataFrame API

### Basic Operations

```python
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# Select and filter
df_filtered = df \
    .select("customer_id", "order_date", "amount") \
    .filter(F.col("amount") > 100) \
    .filter(F.col("order_date") >= "2021-01-01")

# Multiple conditions
df_filtered = df.filter(
    (F.col("status") == "completed") &
    (F.col("amount").between(100, 1000)) &
    (F.col("category").isin(["electronics", "clothing"]))
)

# Column operations
df_transformed = df \
    .withColumn("amount_with_tax", F.col("amount") * 1.1) \
    .withColumn("order_year", F.year("order_date")) \
    .withColumn("order_month", F.month("order_date")) \
    .withColumn("is_large_order", F.when(F.col("amount") > 500, True).otherwise(False))

# Aggregations
df_summary = df.groupBy("customer_id") \
    .agg(
        F.count("order_id").alias("order_count"),
        F.sum("amount").alias("total_amount"),
        F.avg("amount").alias("avg_amount"),
        F.min("order_date").alias("first_order"),
        F.max("order_date").alias("last_order"),
        F.collect_set("category").alias("categories_purchased")
    )
```

### Window Functions

```python
# Define window specifications
window_by_customer = Window.partitionBy("customer_id").orderBy("order_date")
window_by_customer_unbounded = Window.partitionBy("customer_id").orderBy("order_date") \
    .rowsBetween(Window.unboundedPreceding, Window.currentRow)

# Apply window functions
df_with_windows = df \
    .withColumn("running_total", F.sum("amount").over(window_by_customer_unbounded)) \
    .withColumn("order_rank", F.row_number().over(window_by_customer)) \
    .withColumn("prev_amount", F.lag("amount", 1).over(window_by_customer)) \
    .withColumn("next_amount", F.lead("amount", 1).over(window_by_customer)) \
    .withColumn("pct_of_customer_total",
                F.col("amount") / F.sum("amount").over(Window.partitionBy("customer_id")))
```

### Joins

```python
# Inner join
df_joined = df_orders.join(
    df_customers,
    df_orders.customer_id == df_customers.customer_id,
    "inner"
).select(
    df_orders["*"],
    df_customers.customer_name,
    df_customers.email
)

# Left anti join (records in left not in right)
df_new_customers = df_orders.join(
    df_existing_customers,
    "customer_id",
    "left_anti"
)

# Broadcast join for small tables
from pyspark.sql.functions import broadcast

df_joined = df_orders.join(
    broadcast(df_small_lookup),
    "lookup_key"
)
```

## Performance Optimization

### Partitioning

```python
# Repartition for parallelism
df_repartitioned = df.repartition(200, "customer_id")

# Coalesce to reduce partitions (avoids shuffle)
df_coalesced = df.coalesce(10)

# Write with partitioning
df.write \
    .partitionBy("year", "month") \
    .parquet("output/partitioned_data")
```

### Caching

```python
# Cache frequently used DataFrames
df_customers.cache()
df_customers.count()  # Trigger caching

# With storage level
from pyspark import StorageLevel
df_large.persist(StorageLevel.MEMORY_AND_DISK_SER)

# Unpersist when done
df_customers.unpersist()
```

### Broadcast Variables

```python
# For small lookup data
lookup_dict = {"A": 1, "B": 2, "C": 3}
broadcast_lookup = spark.sparkContext.broadcast(lookup_dict)

def apply_lookup(category):
    return broadcast_lookup.value.get(category, 0)

lookup_udf = F.udf(apply_lookup)
df_with_lookup = df.withColumn("category_code", lookup_udf("category"))
```

### Query Optimization Tips

```python
# 1. Filter early
df_optimized = df \
    .filter(F.col("date") >= "2021-01-01") \
    .filter(F.col("status") == "completed") \
    .select("customer_id", "amount") \
    .groupBy("customer_id") \
    .sum("amount")

# 2. Use column pruning
df_needed = df.select("col1", "col2", "col3")  # Only select needed columns

# 3. Avoid UDFs when possible (use built-in functions)
# Bad: Using UDF
# @udf
# def upper_case(s):
#     return s.upper() if s else None

# Good: Using built-in
df = df.withColumn("upper_name", F.upper("name"))

# 4. Use explain to understand query plan
df.explain(mode="extended")

# 5. Enable AQE (Adaptive Query Execution)
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.conf.set("spark.sql.adaptive.skewJoin.enabled", "true")
```

## Handling Complex Data Types

### Arrays

```python
# Array operations
df_with_arrays = df \
    .withColumn("items_array", F.split("items_string", ",")) \
    .withColumn("array_size", F.size("items_array")) \
    .withColumn("first_item", F.element_at("items_array", 1)) \
    .withColumn("contains_item", F.array_contains("items_array", "item1"))

# Explode array to rows
df_exploded = df.select(
    "order_id",
    F.explode("items_array").alias("item")
)

# Collect list
df_collected = df.groupBy("customer_id").agg(
    F.collect_list("product_id").alias("products_purchased")
)
```

### Structs and Maps

```python
# Create struct
df_with_struct = df.withColumn(
    "address",
    F.struct(
        F.col("street"),
        F.col("city"),
        F.col("state"),
        F.col("zip")
    )
)

# Access struct fields
df_with_city = df.withColumn("city", F.col("address.city"))

# Create map
df_with_map = df.withColumn(
    "attributes",
    F.create_map(
        F.lit("color"), F.col("color"),
        F.lit("size"), F.col("size")
    )
)

# Access map values
df_with_color = df.withColumn("color", F.col("attributes")["color"])
```

### JSON Processing

```python
# Parse JSON string
from pyspark.sql.types import StructType, StructField, StringType, IntegerType

json_schema = StructType([
    StructField("name", StringType()),
    StructField("age", IntegerType()),
    StructField("city", StringType())
])

df_parsed = df.withColumn(
    "parsed_json",
    F.from_json("json_column", json_schema)
)

# Extract JSON fields
df_extracted = df \
    .withColumn("name", F.get_json_object("json_column", "$.name")) \
    .withColumn("nested_value", F.get_json_object("json_column", "$.address.city"))

# Convert to JSON
df_as_json = df.withColumn(
    "json_output",
    F.to_json(F.struct("col1", "col2", "col3"))
)
```

## Writing Data

```python
# Write to various formats
df.write \
    .mode("overwrite") \
    .partitionBy("year", "month") \
    .parquet("output/data.parquet")

df.write \
    .format("delta") \
    .mode("append") \
    .option("mergeSchema", "true") \
    .save("output/delta_table")

# Write to table
df.write \
    .mode("overwrite") \
    .saveAsTable("database.table_name")

# Insert into existing table
df.write.insertInto("database.table_name")
```

## Best Practices Summary

1. **Always define schema** - Don't rely on schema inference in production
2. **Filter early** - Push filters as close to the source as possible
3. **Select only needed columns** - Enable column pruning
4. **Avoid UDFs** - Use built-in functions whenever possible
5. **Use broadcast joins** - For small dimension tables
6. **Enable AQE** - Adaptive Query Execution helps with skewed data
7. **Monitor with Spark UI** - Understand job execution
8. **Cache wisely** - Cache DataFrames that are reused multiple times

## Conclusion

Spark SQL provides a powerful and familiar interface for big data processing. By understanding the query optimizer, using the DataFrame API effectively, and applying performance optimization techniques, you can build efficient data processing pipelines. The key is combining SQL knowledge with an understanding of Spark's distributed execution model.
