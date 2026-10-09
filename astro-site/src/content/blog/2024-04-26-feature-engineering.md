---
title: "Feature Engineering in Databricks: From Raw Data to ML Features"
description: "Feature engineering transforms raw data into meaningful inputs for machine learning models. Databricks provides powerful tools for building and managing…"
author: "Michael John Peña"
draft: false
date: 2024-04-26
tags: ["Databricks", "Feature Engineering", "Machine Learning", "MLOps", "Data"]
---

Feature engineering transforms raw data into meaningful inputs for machine learning models. Databricks provides powerful tools for building and managing feature pipelines.

## Feature Engineering Architecture

```python
FEATURE_ENGINEERING_COMPONENTS = {
    "feature_store": {
        "description": "Centralized repository for features",
        "capabilities": [
            "Feature discovery",
            "Feature versioning",
            "Point-in-time lookups",
            "Online/offline serving"
        ]
    },
    "feature_tables": {
        "description": "Delta tables optimized for features",
        "properties": [
            "Primary key enforcement",
            "Time-series support",
            "Automatic CDC"
        ]
    },
    "feature_functions": {
        "description": "On-demand feature computation",
        "use_cases": [
            "Real-time features",
            "Complex transformations"
        ]
    }
}
```

## Creating Feature Tables

```python
from databricks.feature_engineering import FeatureEngineeringClient
from pyspark.sql import SparkSession
from pyspark.sql.functions import *

spark = SparkSession.builder.getOrCreate()
fe = FeatureEngineeringClient()

# Create customer features
def compute_customer_features(spark) -> DataFrame:
    """Compute customer behavioral features"""

    return spark.sql("""
        WITH order_stats AS (
            SELECT
                customer_id,
                COUNT(*) as order_count,
                SUM(amount) as total_spend,
                AVG(amount) as avg_order_value,
                STDDEV(amount) as std_order_value,
                MIN(order_date) as first_order_date,
                MAX(order_date) as last_order_date,
                DATEDIFF(MAX(order_date), MIN(order_date)) as customer_tenure_days
            FROM orders
            WHERE status = 'completed'
            GROUP BY customer_id
        ),
        category_stats AS (
            SELECT
                customer_id,
                COUNT(DISTINCT product_category) as categories_purchased,
                FIRST(product_category) as most_frequent_category
            FROM orders o
            JOIN products p ON o.product_id = p.product_id
            GROUP BY customer_id
        ),
        recency AS (
            SELECT
                customer_id,
                DATEDIFF(CURRENT_DATE(), MAX(order_date)) as days_since_last_order
            FROM orders
            GROUP BY customer_id
        )
        SELECT
            o.customer_id,
            o.order_count,
            o.total_spend,
            o.avg_order_value,
            o.std_order_value,
            o.customer_tenure_days,
            o.order_count / GREATEST(o.customer_tenure_days, 1) as order_frequency,
            c.categories_purchased,
            c.most_frequent_category,
            r.days_since_last_order,
            CASE
                WHEN r.days_since_last_order <= 30 THEN 'active'
                WHEN r.days_since_last_order <= 90 THEN 'at_risk'
                ELSE 'churned'
            END as customer_status
        FROM order_stats o
        JOIN category_stats c ON o.customer_id = c.customer_id
        JOIN recency r ON o.customer_id = r.customer_id
    """)

# Compute features
customer_features_df = compute_customer_features(spark)

# Create feature table
fe.create_table(
    name="main.features.customer_behavioral_features",
    primary_keys=["customer_id"],
    df=customer_features_df,
    description="Customer behavioral features including RFM metrics"
)
```

## Time-Series Features

```python
from pyspark.sql.window import Window

def compute_time_series_features(spark, lookback_days: int = 30):
    """Compute time-series features with windowing"""

    # Define windows
    window_7d = Window.partitionBy("customer_id").orderBy("order_date").rangeBetween(-7 * 86400, 0)
    window_30d = Window.partitionBy("customer_id").orderBy("order_date").rangeBetween(-30 * 86400, 0)

    df = spark.table("orders")

    # Convert date to timestamp for window operations
    df = df.withColumn("order_ts", unix_timestamp("order_date"))

    features = df.select(
        "customer_id",
        "order_date",
        "amount",
        # 7-day rolling features
        sum("amount").over(window_7d).alias("revenue_7d"),
        count("*").over(window_7d).alias("orders_7d"),
        avg("amount").over(window_7d).alias("avg_order_7d"),
        # 30-day rolling features
        sum("amount").over(window_30d).alias("revenue_30d"),
        count("*").over(window_30d).alias("orders_30d"),
        avg("amount").over(window_30d).alias("avg_order_30d"),
        # Trend indicators
        (sum("amount").over(window_7d) / sum("amount").over(window_30d)).alias("revenue_trend")
    )

    return features

# Create time-series feature table with timestamp key
ts_features = compute_time_series_features(spark)

fe.create_table(
    name="main.features.customer_timeseries_features",
    primary_keys=["customer_id", "order_date"],
    timestamp_keys=["order_date"],
    df=ts_features,
    description="Time-series customer features for point-in-time lookups"
)
```

## Feature Functions (On-Demand Features)

```python
from databricks.feature_engineering import FeatureFunction
from pyspark.sql.types import DoubleType, StringType

# Register a feature function for real-time computation
@feature_function(
    name="main.features.calculate_discount_eligibility",
    return_type=DoubleType(),
    input_bindings={
        "total_spend": "total_spend",
        "order_count": "order_count",
        "days_since_last_order": "days_since_last_order"
    }
)
def calculate_discount_eligibility(
    total_spend: float,
    order_count: int,
    days_since_last_order: int
) -> float:
    """Calculate discount eligibility score"""

    # Base score from spend
    spend_score = min(total_spend / 1000, 10)

    # Loyalty bonus
    loyalty_score = min(order_count / 10, 5)

    # Recency penalty
    if days_since_last_order > 90:
        recency_multiplier = 0.5
    elif days_since_last_order > 30:
        recency_multiplier = 0.8
    else:
        recency_multiplier = 1.0

    return (spend_score + loyalty_score) * recency_multiplier

# Use feature function in model training
training_set = fe.create_training_set(
    df=labels_df,
    label="target",
    feature_lookups=[
        FeatureLookup(
            table_name="main.features.customer_behavioral_features",
            lookup_key="customer_id"
        )
    ],
    feature_functions=[
        "main.features.calculate_discount_eligibility"
    ]
)
```

## Feature Pipelines

```python
from databricks.sdk import WorkspaceClient
from datetime import datetime, timedelta

class FeaturePipeline:
    """Orchestrate feature computation"""

    def __init__(self):
        self.fe = FeatureEngineeringClient()
        self.spark = SparkSession.builder.getOrCreate()

    def run_daily_features(self):
        """Compute daily feature updates"""

        # Compute features
        customer_features = compute_customer_features(self.spark)
        ts_features = compute_time_series_features(self.spark)

        # Update feature tables
        self._update_feature_table(
            "main.features.customer_behavioral_features",
            customer_features
        )
        self._update_feature_table(
            "main.features.customer_timeseries_features",
            ts_features
        )

        return {"status": "success", "timestamp": datetime.now().isoformat()}

    def _update_feature_table(self, table_name: str, df):
        """Merge updates into feature table"""

        # Use merge for incremental updates
        self.fe.write_table(
            name=table_name,
            df=df,
            mode="merge"
        )

    def validate_features(self, table_name: str) -> dict:
        """Validate feature quality"""

        df = self.spark.table(table_name)

        validation = {
            "table": table_name,
            "row_count": df.count(),
            "null_checks": {},
            "value_ranges": {}
        }

        # Check for nulls
        for col in df.columns:
            null_count = df.filter(col(col).isNull()).count()
            validation["null_checks"][col] = null_count

        # Check value ranges for numeric columns
        numeric_cols = [f.name for f in df.schema.fields
                       if f.dataType.typeName() in ['double', 'float', 'integer', 'long']]

        for col_name in numeric_cols:
            stats = df.select(
                min(col_name).alias("min"),
                max(col_name).alias("max"),
                avg(col_name).alias("avg")
            ).collect()[0]

            validation["value_ranges"][col_name] = {
                "min": stats["min"],
                "max": stats["max"],
                "avg": stats["avg"]
            }

        return validation

# Usage
pipeline = FeaturePipeline()
result = pipeline.run_daily_features()
validation = pipeline.validate_features("main.features.customer_behavioral_features")
```

## Using Features for Training

```python
import mlflow
from sklearn.model_selection import train_test_split
from sklearn.ensemble import GradientBoostingClassifier

def train_model_with_features():
    """Train model using Feature Store"""

    # Get labels
    labels = spark.table("main.ml_data.churn_labels")

    # Create training set with feature lookups
    training_set = fe.create_training_set(
        df=labels,
        label="churned",
        feature_lookups=[
            FeatureLookup(
                table_name="main.features.customer_behavioral_features",
                feature_names=[
                    "order_count",
                    "total_spend",
                    "avg_order_value",
                    "days_since_last_order",
                    "categories_purchased"
                ],
                lookup_key="customer_id"
            )
        ]
    )

    # Load as pandas DataFrame
    training_df = training_set.load_df().toPandas()

    # Prepare data
    X = training_df.drop(["customer_id", "churned"], axis=1)
    y = training_df["churned"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

    # Train model
    with mlflow.start_run():
        model = GradientBoostingClassifier(n_estimators=100)
        model.fit(X_train, y_train)

        accuracy = model.score(X_test, y_test)
        mlflow.log_metric("accuracy", accuracy)

        # Log model with feature engineering metadata
        fe.log_model(
            model=model,
            artifact_path="model",
            flavor=mlflow.sklearn,
            training_set=training_set,
            registered_model_name="main.ml_models.churn_predictor"
        )

    return model
```

## Conclusion

Feature engineering in Databricks provides end-to-end capabilities from computation to serving. Use feature tables for batch features, feature functions for real-time computation, and Unity Catalog for governance.
