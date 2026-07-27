---
title: "Feature Engineering Best Practices for Production ML"
author: Michael John Pena
draft: false
date: 2021-12-09
tags:
  - Machine Learning
  - Feature Engineering
  - MLOps
  - Azure ML
  - Data Science

---

I wrote "Feature Engineering Best Practices for Production ML" to share practical, production-minded guidance on this topic.

## The Feature Store Pattern

Feature stores solve the training-serving skew problem:

```python
from feast import FeatureStore, Entity, Feature, FeatureView, FileSource
from feast.types import Float32, Int64, String
from datetime import timedelta

# Define entities
customer = Entity(
    name="customer_id",
    value_type=String,
    description="Unique customer identifier"
)

# Define feature source
customer_features_source = FileSource(
    path="abfss://features@datalake.dfs.core.windows.net/customer_features/",
    file_format="parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_timestamp"
)

# Define feature view
customer_features = FeatureView(
    name="customer_features",
    entities=["customer_id"],
    ttl=timedelta(days=90),
    features=[
        Feature(name="total_purchases_30d", dtype=Float32),
        Feature(name="avg_order_value_30d", dtype=Float32),
        Feature(name="purchase_frequency_30d", dtype=Float32),
        Feature(name="days_since_last_purchase", dtype=Int64),
        Feature(name="preferred_category", dtype=String),
        Feature(name="lifetime_value", dtype=Float32),
    ],
    online=True,
    source=customer_features_source,
    tags={"team": "customer-analytics", "version": "1.0"}
)

# Initialize store and apply
store = FeatureStore(repo_path=".")
store.apply([customer, customer_features])
```

## Feature Engineering Pipeline

Building features at scale:

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window

spark = SparkSession.builder.appName("FeatureEngineering").getOrCreate()

def build_customer_features(transactions_df, as_of_date):
    """Build customer features as of a specific date"""

    # Filter to historical data only
    historical = transactions_df.filter(F.col("transaction_date") < as_of_date)

    # Define windows
    window_30d = Window.partitionBy("customer_id").orderBy(F.col("transaction_date").desc())

    # Calculate features
    features = (historical
        # Basic aggregations
        .groupBy("customer_id")
        .agg(
            # Recency
            F.datediff(F.lit(as_of_date), F.max("transaction_date")).alias("days_since_last_purchase"),

            # Frequency
            F.count("*").alias("total_transactions"),
            F.countDistinct(F.date_trunc("month", "transaction_date")).alias("active_months"),

            # Monetary
            F.sum("amount").alias("total_spend"),
            F.avg("amount").alias("avg_transaction_value"),
            F.stddev("amount").alias("transaction_value_stddev"),

            # 30-day rolling
            F.sum(F.when(
                F.col("transaction_date") >= F.date_sub(F.lit(as_of_date), 30),
                F.col("amount")
            )).alias("spend_30d"),

            F.count(F.when(
                F.col("transaction_date") >= F.date_sub(F.lit(as_of_date), 30),
                True
            )).alias("transactions_30d"),

            # Category preferences
            F.first(F.col("category")).alias("most_recent_category"),
        )
        # Derived features
        .withColumn("purchase_frequency",
            F.col("total_transactions") / F.greatest(F.col("active_months"), F.lit(1)))
        .withColumn("avg_spend_30d",
            F.col("spend_30d") / F.greatest(F.col("transactions_30d"), F.lit(1)))
        .withColumn("spend_trend",
            (F.col("avg_spend_30d") - F.col("avg_transaction_value")) /
            F.greatest(F.col("avg_transaction_value"), F.lit(1)))

        # Add metadata
        .withColumn("feature_timestamp", F.lit(as_of_date))
        .withColumn("feature_version", F.lit("1.0"))
    )

    return features

# Build features for training
training_features = build_customer_features(transactions, "2021-12-01")
```

## Handling Categorical Features

```python
from sklearn.preprocessing import LabelEncoder, OneHotEncoder
from category_encoders import TargetEncoder, WOEEncoder
import pandas as pd
import numpy as np

class CategoricalFeatureEncoder:
    """Production-ready categorical encoding"""

    def __init__(self, encoding_strategy: dict):
        """
        encoding_strategy: dict mapping column -> encoding type
        e.g., {"category": "target", "region": "onehot", "brand": "label"}
        """
        self.encoding_strategy = encoding_strategy
        self.encoders = {}

    def fit(self, df: pd.DataFrame, target: pd.Series = None):
        for col, strategy in self.encoding_strategy.items():
            if strategy == "onehot":
                encoder = OneHotEncoder(sparse=False, handle_unknown="ignore")
                encoder.fit(df[[col]])
            elif strategy == "label":
                encoder = LabelEncoder()
                encoder.fit(df[col].fillna("__MISSING__"))
            elif strategy == "target":
                if target is None:
                    raise ValueError("Target required for target encoding")
                encoder = TargetEncoder(cols=[col], smoothing=10)
                encoder.fit(df[[col]], target)
            elif strategy == "woe":
                if target is None:
                    raise ValueError("Target required for WOE encoding")
                encoder = WOEEncoder(cols=[col])
                encoder.fit(df[[col]], target)
            else:
                raise ValueError(f"Unknown encoding strategy: {strategy}")

            self.encoders[col] = encoder

        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        result = df.copy()

        for col, encoder in self.encoders.items():
            strategy = self.encoding_strategy[col]

            if strategy == "onehot":
                encoded = encoder.transform(df[[col]])
                feature_names = encoder.get_feature_names_out([col])
                for i, name in enumerate(feature_names):
                    result[name] = encoded[:, i]
                result = result.drop(columns=[col])
            elif strategy == "label":
                result[f"{col}_encoded"] = encoder.transform(
                    df[col].fillna("__MISSING__")
                )
            else:
                result[f"{col}_encoded"] = encoder.transform(df[[col]])

        return result
```

## Time-Based Feature Engineering

```python
def create_time_features(df, timestamp_col: str):
    """Extract temporal features from timestamp"""

    return (df
        # Basic time components
        .withColumn("hour", F.hour(timestamp_col))
        .withColumn("day_of_week", F.dayofweek(timestamp_col))
        .withColumn("day_of_month", F.dayofmonth(timestamp_col))
        .withColumn("month", F.month(timestamp_col))
        .withColumn("quarter", F.quarter(timestamp_col))
        .withColumn("year", F.year(timestamp_col))

        # Cyclic encoding for periodic features
        .withColumn("hour_sin", F.sin(2 * 3.14159 * F.col("hour") / 24))
        .withColumn("hour_cos", F.cos(2 * 3.14159 * F.col("hour") / 24))
        .withColumn("dow_sin", F.sin(2 * 3.14159 * F.col("day_of_week") / 7))
        .withColumn("dow_cos", F.cos(2 * 3.14159 * F.col("day_of_week") / 7))
        .withColumn("month_sin", F.sin(2 * 3.14159 * F.col("month") / 12))
        .withColumn("month_cos", F.cos(2 * 3.14159 * F.col("month") / 12))

        # Business logic features
        .withColumn("is_weekend", F.col("day_of_week").isin([1, 7]).cast("int"))
        .withColumn("is_business_hours",
            (F.col("hour").between(9, 17) & ~F.col("is_weekend").cast("boolean")).cast("int"))
    )

def create_lag_features(df, partition_cols, order_col, value_cols, lags):
    """Create lag features for time series"""

    for col in value_cols:
        for lag in lags:
            window = Window.partitionBy(*partition_cols).orderBy(order_col)
            df = df.withColumn(f"{col}_lag_{lag}", F.lag(col, lag).over(window))

    return df

def create_rolling_features(df, partition_cols, order_col, value_cols, windows):
    """Create rolling window features"""

    for col in value_cols:
        for window_size in windows:
            window = (Window
                .partitionBy(*partition_cols)
                .orderBy(order_col)
                .rowsBetween(-window_size, -1))

            df = (df
                .withColumn(f"{col}_rolling_mean_{window_size}", F.avg(col).over(window))
                .withColumn(f"{col}_rolling_std_{window_size}", F.stddev(col).over(window))
                .withColumn(f"{col}_rolling_min_{window_size}", F.min(col).over(window))
                .withColumn(f"{col}_rolling_max_{window_size}", F.max(col).over(window))
            )

    return df
```

## Feature Validation

```python
from great_expectations.dataset import PandasDataset

def validate_features(features_df):
    """Validate feature quality before training"""

    ge_df = PandasDataset(features_df)

    validations = [
        # No null values in key features
        ge_df.expect_column_values_to_not_be_null("customer_id"),

        # Numeric ranges
        ge_df.expect_column_values_to_be_between(
            "purchase_frequency", min_value=0, max_value=100
        ),
        ge_df.expect_column_values_to_be_between(
            "days_since_last_purchase", min_value=0
        ),

        # Distribution checks
        ge_df.expect_column_mean_to_be_between(
            "avg_transaction_value", min_value=10, max_value=1000
        ),

        # Completeness
        ge_df.expect_column_values_to_not_be_null(
            "total_transactions", mostly=0.99
        ),
    ]

    failed = [v for v in validations if not v.success]
    if failed:
        raise FeatureValidationError(f"Feature validation failed: {failed}")
```

## Key Principles for 2021

1. **Feature Stores are Essential**: Solve training-serving skew
2. **Point-in-Time Correctness**: Prevent data leakage
3. **Feature Versioning**: Track feature definitions
4. **Monitoring**: Watch for feature drift in production

Feature engineering in 2021 became more systematic and production-oriented. The ad-hoc notebook approach is giving way to proper engineering practices.

## Resources

- [Feast Feature Store](https://feast.dev/)
- [Azure ML Feature Store](https://docs.microsoft.com/en-us/azure/machine-learning/concept-what-is-managed-feature-store)
- [Feature Engineering for ML](https://www.oreilly.com/library/view/feature-engineering-for/9781491953235/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
