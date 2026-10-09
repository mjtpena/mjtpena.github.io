---
title: Getting Started with Apache Spark 3.0 in Azure Synapse Analytics
author: Michael John Peña
draft: false
date: 2021-07-01
url: /blog/azure-synapse-spark-3/
tags:
  - Azure
  - Data
  - Synapse
  - Spark
  - Big Data
---

## Setting Up a Spark 3.0 Pool

First, let us create a new Spark pool with version 3.0 in Azure Synapse:

```python
# Using Azure CLI to create a Spark pool
az synapse spark pool create \
    --name spark30pool \
    --workspace-name mysynapseworkspace \
    --resource-group myresourcegroup \
    --spark-version 3.0 \
    --node-count 3 \
    --node-size Medium \
    --enable-auto-pause true \
    --delay 15
```

## Adaptive Query Execution (AQE)

One of the most significant improvements in Spark 3.0 is Adaptive Query Execution. AQE optimizes query plans at runtime based on actual data statistics:

```python
from pyspark.sql import SparkSession

# AQE is enabled by default in Spark 3.0
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", "true")
spark.conf.set("spark.sql.adaptive.skewJoin.enabled", "true")

# Read data from Azure Data Lake
df = spark.read.parquet("abfss://container@storage.dfs.core.windows.net/data/")

# This join will benefit from AQE's skew handling
result = df.join(large_dimension_df, "key_column")

# AQE will automatically optimize partition sizes
result.write.parquet("abfss://container@storage.dfs.core.windows.net/output/")
```

## Dynamic Partition Pruning

Dynamic partition pruning significantly improves query performance when joining a partitioned table with another table:

```python
# Create a partitioned table
spark.sql("""
    CREATE TABLE sales_data (
        product_id STRING,
        quantity INT,
        price DECIMAL(10,2),
        sale_date DATE
    )
    USING DELTA
    PARTITIONED BY (sale_date)
    LOCATION 'abfss://container@storage.dfs.core.windows.net/sales/'
""")

# Dynamic partition pruning kicks in automatically
filtered_sales = spark.sql("""
    SELECT s.product_id, s.quantity, s.price, p.product_name
    FROM sales_data s
    JOIN products p ON s.product_id = p.product_id
    WHERE p.category = 'Electronics'
    AND s.sale_date BETWEEN '2021-01-01' AND '2021-06-30'
""")
```

## Improved Pandas API with PyArrow

Spark 3.0 brings better pandas integration through PyArrow:

```python
import pandas as pd
from pyspark.sql.functions import pandas_udf
from pyspark.sql.types import DoubleType

# Enable PyArrow optimization
spark.conf.set("spark.sql.execution.arrow.pyspark.enabled", "true")

# Define a pandas UDF for complex calculations
@pandas_udf(DoubleType())
def calculate_moving_average(values: pd.Series) -> pd.Series:
    return values.rolling(window=7, min_periods=1).mean()

# Apply the UDF
df_with_ma = df.withColumn("moving_avg", calculate_moving_average("value"))

# Convert to pandas efficiently
pandas_df = df_with_ma.toPandas()
```

## New SQL Functions

Spark 3.0 adds many new SQL functions:

```python
from pyspark.sql.functions import *

# New date functions
df = df.withColumn("formatted_date", date_format("timestamp", "yyyy-MM-dd"))
df = df.withColumn("extracted_year", extract("year", "timestamp"))

# New string functions
df = df.withColumn("overlayed", overlay("name", lit("***"), 1, 3))

# New aggregate functions
df.groupBy("category").agg(
    count_if(col("status") == "active").alias("active_count"),
    percentile_approx("value", 0.5).alias("median_value")
)
```

## Integration with Azure Services

Leverage the full power of Azure ecosystem:

```python
# Read from Azure SQL Database
jdbc_df = spark.read \
    .format("jdbc") \
    .option("url", "jdbc:sqlserver://server.database.windows.net:1433;database=mydb") \
    .option("dbtable", "dbo.customers") \
    .option("user", dbutils.secrets.get("keyvault", "sql-user")) \
    .option("password", dbutils.secrets.get("keyvault", "sql-password")) \
    .load()

# Write to Cosmos DB
df.write \
    .format("cosmos.oltp") \
    .option("spark.synapse.linkedService", "CosmosDbLinkedService") \
    .option("spark.cosmos.container", "mycontainer") \
    .mode("append") \
    .save()
```

## Conclusion

Apache Spark 3.0 in Azure Synapse Analytics brings substantial performance improvements through Adaptive Query Execution, dynamic partition pruning, and enhanced pandas support. These features allow you to build more efficient and scalable data pipelines with less manual tuning.

Start migrating your existing Spark 2.4 workloads to Spark 3.0 to take advantage of these improvements. The migration is generally straightforward, with most existing code working without modifications.
