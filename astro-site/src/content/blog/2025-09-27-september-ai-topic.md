---
title: "Microsoft Fabric Notebooks: Collaborative Data Science at Scale"
author: Michael John Peña
draft: false
date: 2025-09-27
tags:
  - Microsoft Fabric
  - Notebooks
  - Data Science
  - PySpark
  - Collaboration

---

I wrote "Microsoft Fabric Notebooks: Collaborative Data Science at Scale" to share practical, production-minded guidance on this topic.

## Environment Setup

```python
# Fabric notebooks come pre-configured with common libraries
# Access Lakehouse data directly with semantic links

from pyspark.sql import SparkSession
import pandas as pd
import numpy as np

# Spark session is automatically available
spark = SparkSession.builder.getOrCreate()

# Read from Lakehouse tables directly
df = spark.read.table("lakehouse.sales_data")
print(f"Loaded {df.count()} rows")
```

## Efficient Data Processing

```python
from pyspark.sql import functions as F
from pyspark.sql.window import Window

def create_features(df):
    """Create time-series features for ML models."""

    # Window functions for rolling aggregates
    window_7d = Window.partitionBy("customer_id").orderBy("order_date").rowsBetween(-6, 0)
    window_30d = Window.partitionBy("customer_id").orderBy("order_date").rowsBetween(-29, 0)

    features_df = df \
        .withColumn("rolling_7d_avg", F.avg("amount").over(window_7d)) \
        .withColumn("rolling_30d_avg", F.avg("amount").over(window_30d)) \
        .withColumn("rolling_7d_count", F.count("order_id").over(window_7d)) \
        .withColumn("days_since_first_order",
            F.datediff(F.col("order_date"),
                      F.min("order_date").over(Window.partitionBy("customer_id")))
        ) \
        .withColumn("day_of_week", F.dayofweek("order_date")) \
        .withColumn("month", F.month("order_date")) \
        .withColumn("is_weekend",
            F.when(F.col("day_of_week").isin(1, 7), 1).otherwise(0)
        )

    return features_df

# Apply feature engineering
features = create_features(df)
features.write.format("delta").mode("overwrite").saveAsTable("gold.customer_features")
```

## Interactive Visualization

```python
# Fabric notebooks support rich visualizations
import matplotlib.pyplot as plt
import seaborn as sns

# Convert to pandas for visualization (sample for large datasets)
sample_df = features.sample(0.1).toPandas()

fig, axes = plt.subplots(2, 2, figsize=(14, 10))

# Distribution of order amounts
axes[0, 0].hist(sample_df["amount"], bins=50, edgecolor="black")
axes[0, 0].set_title("Distribution of Order Amounts")
axes[0, 0].set_xlabel("Amount")

# Orders by day of week
daily_orders = sample_df.groupby("day_of_week")["order_id"].count()
axes[0, 1].bar(daily_orders.index, daily_orders.values)
axes[0, 1].set_title("Orders by Day of Week")

# Rolling average trend
sample_df_sorted = sample_df.sort_values("order_date")
axes[1, 0].plot(sample_df_sorted["order_date"], sample_df_sorted["rolling_7d_avg"])
axes[1, 0].set_title("7-Day Rolling Average")

# Customer segmentation
axes[1, 1].scatter(sample_df["rolling_30d_count"],
                   sample_df["rolling_30d_avg"],
                   alpha=0.5)
axes[1, 1].set_title("Customer Activity vs Spend")

plt.tight_layout()
plt.show()
```

## MLflow Integration

```python
import mlflow
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

# Fabric integrates with MLflow for experiment tracking
mlflow.set_experiment("customer_lifetime_value")

with mlflow.start_run(run_name="rf_baseline"):
    # Prepare data
    X = sample_df[["rolling_7d_avg", "rolling_30d_avg", "rolling_7d_count",
                   "days_since_first_order", "day_of_week", "is_weekend"]]
    y = sample_df["amount"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

    # Train model
    model = RandomForestRegressor(n_estimators=100, max_depth=10)
    model.fit(X_train, y_train)

    # Log parameters and metrics
    mlflow.log_params({"n_estimators": 100, "max_depth": 10})
    mlflow.log_metric("train_score", model.score(X_train, y_train))
    mlflow.log_metric("test_score", model.score(X_test, y_test))

    # Log model
    mlflow.sklearn.log_model(model, "model")
```

Fabric notebooks provide a seamless path from exploration to production, with built-in governance, collaboration, and scalable compute.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
