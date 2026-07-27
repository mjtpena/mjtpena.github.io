---
title: "Synapse Spark Pools: Optimization and Best Practices"
author: Michael John Peña
draft: false
date: 2022-02-04
url: /blog/synapse-spark-pools-optimization/
tags:
  - azure
  - synapse
  - spark
  - big-data

---

I wrote "Synapse Spark Pools: Optimization and Best Practices" to share practical, production-minded guidance on this topic.

## Spark Pool Configuration

Choose the right pool configuration:

```json
{
  "name": "OptimizedSparkPool",
  "nodeSize": "Medium",
  "nodeSizeFamily": "MemoryOptimized",
  "autoScale": {
    "enabled": true,
    "minNodeCount": 3,
    "maxNodeCount": 20
  },
  "autoPause": {
    "enabled": true,
    "delayInMinutes": 15
  },
  "sparkVersion": "3.2",
  "sparkConfigProperties": {
    "spark.sql.adaptive.enabled": "true",
    "spark.sql.adaptive.coalescePartitions.enabled": "true",
    "spark.sql.adaptive.skewJoin.enabled": "true",
    "spark.sql.shuffle.partitions": "auto"
  }
}
```

## Session Configuration

```python
%%configure
{
    "conf": {
        "spark.sql.adaptive.enabled": "true",
        "spark.sql.adaptive.coalescePartitions.enabled": "true",
        "spark.sql.shuffle.partitions": "200",
        "spark.sql.files.maxPartitionBytes": "268435456",
        "spark.serializer": "org.apache.spark.serializer.KryoSerializer",
        "spark.sql.parquet.compression.codec": "snappy"
    }
}
```

## Data Reading Optimization

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import *

spark = SparkSession.builder.getOrCreate()

# Optimal: Read with schema inference disabled
schema = StructType([
    StructField("OrderID", LongType(), False),
    StructField("CustomerID", IntegerType(), False),
    StructField("Amount", DecimalType(18, 2), True),
    StructField("OrderDate", DateType(), True)
])

df = spark.read \
    .format("parquet") \
    .schema(schema) \
    .option("basePath", "abfss://data@storage.dfs.core.windows.net/sales/") \
    .load("abfss://data@storage.dfs.core.windows.net/sales/year=2022/month=*/*.parquet")

# Use partition pruning
df_filtered = df.filter(
    (col("OrderDate") >= "2022-01-01") &
    (col("OrderDate") < "2022-02-01")
)

# Predicate pushdown with Delta Lake
delta_df = spark.read \
    .format("delta") \
    .option("versionAsOf", 10) \
    .load("abfss://data@storage.dfs.core.windows.net/delta/sales/")
```

## Handling Data Skew

```python
# Identify skewed keys
df.groupBy("CustomerID") \
    .count() \
    .orderBy(desc("count")) \
    .show(20)

# Solution 1: Salting
from pyspark.sql.functions import rand, lit, concat

# Add salt to skewed key
num_salts = 10
df_salted = df.withColumn(
    "salted_key",
    concat(col("CustomerID"), lit("_"), (rand() * num_salts).cast("int"))
)

# Join with salted dimension
dim_salted = dim_customer.crossJoin(
    spark.range(num_salts).withColumnRenamed("id", "salt")
).withColumn(
    "salted_key",
    concat(col("CustomerID"), lit("_"), col("salt"))
)

result = df_salted.join(dim_salted, "salted_key")

# Solution 2: Broadcast join for small tables
from pyspark.sql.functions import broadcast

result = df.join(
    broadcast(dim_product),
    df.ProductID == dim_product.ProductID
)
```

## Caching and Persistence

```python
# Cache frequently accessed data
df_cached = df.filter(col("Year") == 2022).cache()
df_cached.count()  # Trigger caching

# Use Delta Lake caching
spark.conf.set("spark.databricks.io.cache.enabled", "true")
spark.conf.set("spark.databricks.io.cache.maxDiskUsage", "50g")

# Checkpoint for iterative algorithms
spark.sparkContext.setCheckpointDir("abfss://temp@storage.dfs.core.windows.net/checkpoints/")
df_checkpoint = df.checkpoint()

# Unpersist when done
df_cached.unpersist()
```

## Writing Optimization

```python
# Optimal write with partitioning
df.repartition(100) \
    .write \
    .format("delta") \
    .mode("overwrite") \
    .partitionBy("Year", "Month") \
    .option("overwriteSchema", "true") \
    .save("abfss://data@storage.dfs.core.windows.net/delta/sales_optimized/")

# Z-Order for Delta Lake (improves query performance)
spark.sql("""
    OPTIMIZE delta.`abfss://data@storage.dfs.core.windows.net/delta/sales/`
    ZORDER BY (CustomerID, ProductID)
""")

# Compact small files
spark.sql("""
    OPTIMIZE delta.`abfss://data@storage.dfs.core.windows.net/delta/sales/`
    WHERE Year = 2022
""")
```

## Monitoring and Debugging

```python
# Enable Spark UI for debugging
spark.sparkContext.setLogLevel("INFO")

# Track job metrics
from pyspark.sql.utils import AnalysisException

def log_metrics(df, operation_name):
    """Log execution metrics for a DataFrame operation."""
    try:
        # Explain the query plan
        print(f"=== {operation_name} ===")
        df.explain(extended=True)

        # Get execution stats
        start_time = time.time()
        count = df.count()
        duration = time.time() - start_time

        print(f"Rows: {count:,}")
        print(f"Duration: {duration:.2f}s")
        print(f"Partitions: {df.rdd.getNumPartitions()}")

    except AnalysisException as e:
        print(f"Analysis error: {e}")

# Usage
log_metrics(df_filtered, "Filtered Sales Data")
```

## Memory Management

```python
# Configure memory settings
%%configure
{
    "conf": {
        "spark.executor.memory": "28g",
        "spark.executor.memoryOverhead": "4g",
        "spark.driver.memory": "8g",
        "spark.memory.fraction": "0.8",
        "spark.memory.storageFraction": "0.3"
    }
}

# Handle out-of-memory errors with disk spill
spark.conf.set("spark.sql.shuffle.spill.compress", "true")
spark.conf.set("spark.shuffle.spill.compress", "true")
```

## Best Practices Summary

1. **Use adaptive query execution** - Let Spark optimize at runtime
2. **Right-size partitions** - 100-250MB per partition
3. **Broadcast small tables** - Avoid shuffle for dimension joins
4. **Use Delta Lake** - Better performance and ACID transactions
5. **Cache wisely** - Only frequently reused data
6. **Monitor with Spark UI** - Identify bottlenecks
7. **Handle skew proactively** - Salt keys or use skew hints

Properly optimized Spark pools can process petabytes of data efficiently and cost-effectively.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
