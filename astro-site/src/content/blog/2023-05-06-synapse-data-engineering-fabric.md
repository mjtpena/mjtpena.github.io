---
title: "Synapse Data Engineering in Microsoft Fabric: Spark at Scale"
author: Michael John Peña
draft: false
date: 2023-05-06
tags:
  - Microsoft Fabric
  - Synapse
  - Apache Spark
  - Data Engineering
  - PySpark

---

I wrote "Synapse Data Engineering in Microsoft Fabric: Spark at Scale" to share practical, production-minded guidance on this topic.

## Data Engineering in Fabric

The Data Engineering workload in Fabric includes:
- **Notebooks**: Interactive Spark development
- **Spark Job Definitions**: Production Spark jobs
- **Lakehouse**: Storage for Spark workloads
- **Environment**: Spark configuration and libraries

```
┌─────────────────────────────────────────────────────┐
│           Synapse Data Engineering                   │
├─────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐       │
│  │ Notebooks │  │ Spark Job │  │Environment│       │
│  │           │  │Definitions│  │           │       │
│  └───────────┘  └───────────┘  └───────────┘       │
│                       │                             │
│                       ▼                             │
│  ┌─────────────────────────────────────────┐       │
│  │            Apache Spark Pool            │       │
│  │  (Managed, auto-scaling, auto-pause)    │       │
│  └─────────────────────────────────────────┘       │
│                       │                             │
│                       ▼                             │
│  ┌─────────────────────────────────────────┐       │
│  │               Lakehouse                  │       │
│  └─────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

## Fabric Notebooks

### Creating Your First Notebook

```python
# Cell 1: Verify Spark session
print(f"Spark version: {spark.version}")
print(f"Default parallelism: {spark.sparkContext.defaultParallelism}")

# In Fabric, Spark sessions start automatically
# No cluster configuration needed
```

### Reading Data from Lakehouse

```python
# Cell 2: Read from attached Lakehouse

# Read a Delta table (Tables folder)
customers_df = spark.read.format("delta").table("customers")
display(customers_df.limit(10))

# Read files (Files folder)
raw_df = spark.read \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .csv("Files/raw/sales_data.csv")

# Read from another Lakehouse using absolute path
other_lakehouse_df = spark.read.format("delta").load(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/OtherLakehouse.Lakehouse/Tables/products"
)
```

### Data Transformation Patterns

```python
# Cell 3: Common transformation patterns
from pyspark.sql.functions import (
    col, lit, when, coalesce,
    year, month, dayofmonth,
    sum as spark_sum, avg, count, countDistinct,
    row_number, dense_rank,
    explode, split, trim, lower, upper,
    to_timestamp, date_format, datediff
)
from pyspark.sql.window import Window

# Read source data
sales_df = spark.read.format("delta").table("raw_sales")

# Data cleaning
cleaned_df = sales_df \
    .withColumn("customer_name", trim(col("customer_name"))) \
    .withColumn("email", lower(col("email"))) \
    .withColumn("amount", col("amount").cast("double")) \
    .withColumn("sale_date", to_timestamp(col("sale_date"), "yyyy-MM-dd")) \
    .filter(col("amount").isNotNull()) \
    .filter(col("amount") > 0) \
    .dropDuplicates(["order_id"])

# Add derived columns
enriched_df = cleaned_df \
    .withColumn("year", year(col("sale_date"))) \
    .withColumn("month", month(col("sale_date"))) \
    .withColumn("day", dayofmonth(col("sale_date"))) \
    .withColumn("amount_category",
        when(col("amount") > 1000, "high")
        .when(col("amount") > 100, "medium")
        .otherwise("low"))

display(enriched_df.limit(10))
```

### Window Functions

```python
# Cell 4: Window functions for analytics
from pyspark.sql.window import Window

# Define window specs
customer_window = Window.partitionBy("customer_id").orderBy(col("sale_date").desc())
monthly_window = Window.partitionBy("year", "month").orderBy(col("amount").desc())

# Add analytics columns
analytics_df = enriched_df \
    .withColumn("customer_rank", row_number().over(customer_window)) \
    .withColumn("monthly_rank", dense_rank().over(monthly_window)) \
    .withColumn("customer_running_total",
        spark_sum("amount").over(
            Window.partitionBy("customer_id")
                  .orderBy("sale_date")
                  .rowsBetween(Window.unboundedPreceding, Window.currentRow)
        ))

# Get latest order per customer
latest_orders = analytics_df.filter(col("customer_rank") == 1)
display(latest_orders.select("customer_id", "sale_date", "amount", "customer_running_total"))
```

### Aggregations

```python
# Cell 5: Build aggregation tables
# Monthly summary
monthly_summary = enriched_df \
    .groupBy("year", "month") \
    .agg(
        spark_sum("amount").alias("total_sales"),
        avg("amount").alias("avg_order_value"),
        count("order_id").alias("order_count"),
        countDistinct("customer_id").alias("unique_customers")
    ) \
    .orderBy("year", "month")

# Write to Lakehouse
monthly_summary.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("monthly_sales_summary")

# Customer summary
customer_summary = enriched_df \
    .groupBy("customer_id", "customer_name") \
    .agg(
        spark_sum("amount").alias("lifetime_value"),
        count("order_id").alias("total_orders"),
        avg("amount").alias("avg_order_value")
    ) \
    .orderBy(col("lifetime_value").desc())

customer_summary.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("customer_summary")
```

### Incremental Processing

```python
# Cell 6: Incremental data processing with Delta Lake
from delta.tables import DeltaTable

# Check if target table exists
if spark.catalog.tableExists("sales_facts"):
    # Perform incremental merge
    target = DeltaTable.forName(spark, "sales_facts")

    target.alias("target") \
        .merge(
            enriched_df.alias("source"),
            "target.order_id = source.order_id"
        ) \
        .whenMatchedUpdate(set={
            "amount": "source.amount",
            "customer_name": "source.customer_name",
            "updated_at": "current_timestamp()"
        }) \
        .whenNotMatchedInsert(values={
            "order_id": "source.order_id",
            "customer_id": "source.customer_id",
            "customer_name": "source.customer_name",
            "amount": "source.amount",
            "sale_date": "source.sale_date",
            "year": "source.year",
            "month": "source.month",
            "created_at": "current_timestamp()",
            "updated_at": "current_timestamp()"
        }) \
        .execute()

    print("Incremental merge completed")
else:
    # Initial load
    enriched_df \
        .withColumn("created_at", current_timestamp()) \
        .withColumn("updated_at", current_timestamp()) \
        .write \
        .format("delta") \
        .mode("overwrite") \
        .saveAsTable("sales_facts")

    print("Initial load completed")
```

## Spark Job Definitions

For production workloads, use Spark Job Definitions:

```python
# main.py - Spark Job Definition
import sys
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, year, month, sum as spark_sum

def main():
    spark = SparkSession.builder.getOrCreate()

    # Get parameters
    source_table = sys.argv[1] if len(sys.argv) > 1 else "raw_sales"
    target_table = sys.argv[2] if len(sys.argv) > 2 else "sales_summary"

    # Read source
    df = spark.read.format("delta").table(source_table)

    # Transform
    summary = df \
        .withColumn("year", year(col("sale_date"))) \
        .withColumn("month", month(col("sale_date"))) \
        .groupBy("year", "month") \
        .agg(spark_sum("amount").alias("total_sales"))

    # Write
    summary.write \
        .format("delta") \
        .mode("overwrite") \
        .saveAsTable(target_table)

    print(f"Job completed. Wrote {summary.count()} rows to {target_table}")

if __name__ == "__main__":
    main()
```

## Environment Configuration

```yaml
# environment.yml
name: data-engineering-env
dependencies:
  - pip:
    - pandas==2.0.0
    - numpy==1.24.0
    - scikit-learn==1.2.0
    - great-expectations==0.16.0

# Spark configuration
spark_config:
  spark.sql.shuffle.partitions: 200
  spark.sql.adaptive.enabled: true
  spark.sql.adaptive.coalescePartitions.enabled: true
```

## Performance Optimization

```python
# Cell 7: Performance best practices

# 1. Partition strategy for large tables
large_df.write \
    .format("delta") \
    .partitionBy("year", "month") \
    .mode("overwrite") \
    .saveAsTable("partitioned_sales")

# 2. Z-ordering for query optimization
spark.sql("OPTIMIZE partitioned_sales ZORDER BY (customer_id)")

# 3. Cache frequently used DataFrames
frequently_used_df = spark.read.format("delta").table("dimension_products")
frequently_used_df.cache()

# 4. Broadcast small tables for joins
from pyspark.sql.functions import broadcast

small_df = spark.read.format("delta").table("dim_regions")  # < 10MB
large_df = spark.read.format("delta").table("sales_facts")  # Large

result = large_df.join(broadcast(small_df), "region_id")

# 5. Use Delta table stats
spark.sql("ANALYZE TABLE sales_facts COMPUTE STATISTICS FOR ALL COLUMNS")
```

Synapse Data Engineering in Fabric provides a managed Spark experience that removes infrastructure concerns while delivering the full power of Apache Spark. Tomorrow, I will cover Synapse Data Science for machine learning workloads.

## Resources

- [Data Engineering Tutorial](https://learn.microsoft.com/en-us/fabric/data-engineering/tutorial-lakehouse-introduction)
- [Spark Notebooks](https://learn.microsoft.com/en-us/fabric/data-engineering/how-to-use-notebook)
- [Spark Job Definitions](https://learn.microsoft.com/en-us/fabric/data-engineering/spark-job-definition)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
