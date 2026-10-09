---
title: "Azure Synapse Spark Pools (Preview): Big Data Processing"
description: "Spark on Synapse is the same managed Spark story most cloud providers offer now, but it's done with the parts of Azure I already use — same workspace as the…"
author: Michael John Peña
draft: false
date: 2020-10-01
tags:
  - Azure
  - Synapse
  - Spark
  - Data Engineering
---

Spark on Synapse is the same managed Spark story most cloud providers offer now, but it's done with the parts of Azure I already use — same workspace as the SQL pools and pipelines, same security model, same ADLS Gen2 storage. For teams that want notebooks-and-Spark without standing up Databricks separately, the Synapse path keeps everything under one bill and one IAM model.

**Note**: Synapse is in public preview. Features and APIs may change before GA.

## Creating a Spark Pool

```hcl
resource "azurerm_synapse_spark_pool" "main" {
  name                 = "sparkpool"
  synapse_workspace_id = azurerm_synapse_workspace.main.id
  node_size_family     = "MemoryOptimized"
  node_size            = "Medium"

  auto_scale {
    min_node_count = 3
    max_node_count = 10
  }

  auto_pause {
    delay_in_minutes = 15
  }

  library_requirement {
    content  = file("requirements.txt")
    filename = "requirements.txt"
  }
}
```

## Notebook Development

```python
# Read from Data Lake
df = spark.read \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .csv("abfss://raw@mydatalake.dfs.core.windows.net/sales/*.csv")

# Transform
from pyspark.sql.functions import col, year, month, sum as spark_sum

monthly_sales = df \
    .withColumn("year", year(col("sale_date"))) \
    .withColumn("month", month(col("sale_date"))) \
    .groupBy("year", "month", "region") \
    .agg(spark_sum("amount").alias("total_sales"))

# Write as Delta
monthly_sales.write \
    .format("delta") \
    .mode("overwrite") \
    .save("abfss://curated@mydatalake.dfs.core.windows.net/monthly_sales/")
```

## Shared Metadata

Tables created in Spark are visible in SQL:

```python
# In Spark notebook
monthly_sales.write.saveAsTable("curated.monthly_sales")
```

```sql
-- In SQL pool or serverless
SELECT * FROM curated.monthly_sales WHERE year = 2020
```

## Optimizations

```python
# Partition for query performance
df.write \
    .partitionBy("year", "month") \
    .format("delta") \
    .save("/path/to/table")

# Broadcast small tables
from pyspark.sql.functions import broadcast
result = large_df.join(broadcast(small_df), "key")

# Cache frequently used DataFrames
df.cache()
```

## Cost Control

- **Auto-pause**: Clusters pause when idle
- **Auto-scale**: Scale down during low usage
- **Spot instances**: Coming soon for cost savings

Synapse Spark brings enterprise Spark without the ops burden.
