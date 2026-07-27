---
title: "Fabric Data Pipelines: Orchestrating ML Feature Engineering at Scale"
author: Michael John Peña
draft: false
date: 2025-07-10
tags:
  - Microsoft Fabric
  - Data Pipelines
  - Feature Engineering
  - MLOps
  - PySpark

---

I wrote "Fabric Data Pipelines: Orchestrating ML Feature Engineering at Scale" to share practical, production-minded guidance on this topic.

## Building Feature Engineering Pipelines

Fabric notebooks integrate seamlessly with Data Factory pipelines for scheduled feature computation:

```python
# feature_engineering_notebook.py
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window

spark = SparkSession.builder.getOrCreate()

# Read from Lakehouse
transactions = spark.read.table("bronze.transactions")

# Time-based aggregation features
window_7d = Window.partitionBy("customer_id").orderBy(
    F.col("transaction_date").cast("long")
).rangeBetween(-7 * 86400, 0)

window_30d = Window.partitionBy("customer_id").orderBy(
    F.col("transaction_date").cast("long")
).rangeBetween(-30 * 86400, 0)

customer_features = transactions.select(
    "customer_id",
    "transaction_date",
    F.sum("amount").over(window_7d).alias("spend_7d"),
    F.sum("amount").over(window_30d).alias("spend_30d"),
    F.count("*").over(window_7d).alias("txn_count_7d"),
    F.avg("amount").over(window_30d).alias("avg_txn_30d"),
    F.stddev("amount").over(window_30d).alias("stddev_txn_30d")
).dropDuplicates(["customer_id", "transaction_date"])

# Write to feature store
customer_features.write.mode("overwrite").saveAsTable("gold.customer_features")
```

## Pipeline Orchestration

Configure Data Factory pipelines for incremental feature updates:

```json
{
  "name": "FeatureEngineeringPipeline",
  "properties": {
    "activities": [
      {
        "name": "ComputeDailyFeatures",
        "type": "SynapseNotebook",
        "linkedServiceName": "FabricWorkspace",
        "typeProperties": {
          "notebook": {
            "referenceName": "feature_engineering_notebook",
            "type": "NotebookReference"
          },
          "parameters": {
            "process_date": {
              "value": "@pipeline().TriggerTime",
              "type": "Expression"
            }
          }
        }
      }
    ],
    "triggers": [
      {
        "type": "ScheduleTrigger",
        "recurrence": {"frequency": "Hour", "interval": 1}
      }
    ]
  }
}
```

## Real-Time Feature Serving

For real-time inference, query the feature store directly from your model serving endpoint. Fabric's query optimization ensures millisecond-level feature retrieval.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
