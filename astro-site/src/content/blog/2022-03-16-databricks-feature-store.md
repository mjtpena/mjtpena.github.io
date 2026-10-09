---
title: "Databricks Feature Store: Centralized Feature Management for ML"
description: "The Feature Store solves these problems."
author: Michael John Peña
draft: false
date: 2022-03-16
tags:
  - Azure
  - Databricks
  - Feature Store
  - Machine Learning
  - MLOps
---

## Why Feature Stores Matter

Without a feature store:
- Teams duplicate feature engineering work
- Training/serving skew causes prediction errors
- Feature discovery is difficult
- Point-in-time correctness is hard to achieve

The Feature Store solves these problems.

## Creating Feature Tables

```python
from databricks.feature_store import FeatureStoreClient, FeatureLookup

fs = FeatureStoreClient()

# Create customer features
customer_features_df = spark.sql("""
    SELECT
        customer_id,
        COUNT(DISTINCT order_id) as total_orders,
        SUM(order_amount) as lifetime_value,
        AVG(order_amount) as avg_order_value,
        DATEDIFF(current_date(), MAX(order_date)) as days_since_last_order,
        DATEDIFF(current_date(), MIN(order_date)) as customer_tenure_days
    FROM production.sales.orders
    GROUP BY customer_id
""")

# Create feature table
fs.create_table(
    name="production.features.customer_features",
    primary_keys=["customer_id"],
    df=customer_features_df,
    description="Customer behavior features derived from order history",
    tags={"team": "data-science", "domain": "customer"}
)
```

## Time-Series Feature Tables

For point-in-time correctness:

```python
# Create time-series feature table with timestamp key
product_price_features = spark.sql("""
    SELECT
        product_id,
        effective_date,
        price,
        discount_pct,
        price * (1 - discount_pct/100) as effective_price
    FROM production.catalog.price_history
""")

fs.create_table(
    name="production.features.product_pricing",
    primary_keys=["product_id"],
    timestamp_keys=["effective_date"],
    df=product_price_features,
    description="Historical product pricing for point-in-time joins"
)
```

## Updating Features

```python
# Compute updated features
updated_features = compute_customer_features(spark)

# Write to feature table (merge/upsert)
fs.write_table(
    name="production.features.customer_features",
    df=updated_features,
    mode="merge"  # or "overwrite"
)

# For streaming updates
streaming_features = (
    spark.readStream
    .table("production.sales.orders")
    .groupBy("customer_id")
    .agg(...)
)

fs.write_table(
    name="production.features.customer_features",
    df=streaming_features,
    mode="merge",
    trigger={"processingTime": "1 hour"}
)
```

## Feature Discovery

```python
# Search for features
features = fs.search_feature_tables(
    filter_string="tags.domain = 'customer'"
)

for feature in features:
    print(f"Table: {feature.name}")
    print(f"Description: {feature.description}")
    print(f"Primary keys: {feature.primary_keys}")
    print("---")

# Get feature table details
table = fs.get_table("production.features.customer_features")
print(f"Features: {[f.name for f in table.features]}")
```

## Training with Feature Lookups

```python
# Define training data with labels
training_labels = spark.sql("""
    SELECT
        customer_id,
        order_date as label_date,
        CASE WHEN churned_within_30_days THEN 1 ELSE 0 END as label
    FROM production.analytics.churn_labels
""")

# Define feature lookups
feature_lookups = [
    FeatureLookup(
        table_name="production.features.customer_features",
        lookup_key=["customer_id"],
        feature_names=["total_orders", "lifetime_value", "avg_order_value", "days_since_last_order"]
    ),
    FeatureLookup(
        table_name="production.features.customer_demographics",
        lookup_key=["customer_id"],
        feature_names=["age_group", "region", "account_type"]
    )
]

# Create training set with automatic feature joins
training_set = fs.create_training_set(
    df=training_labels,
    feature_lookups=feature_lookups,
    label="label",
    exclude_columns=["customer_id", "label_date"]  # Don't use as features
)

# Load as pandas DataFrame
training_df = training_set.load_df().toPandas()

# Or load as Spark DataFrame for distributed training
training_spark_df = training_set.load_df()
```

## Point-in-Time Lookups

```python
# For time-series features, ensure point-in-time correctness
training_labels = spark.sql("""
    SELECT
        customer_id,
        product_id,
        transaction_date,
        label
    FROM training_data
""")

feature_lookups = [
    # Customer features at time of transaction
    FeatureLookup(
        table_name="production.features.customer_features_timeseries",
        lookup_key=["customer_id"],
        timestamp_lookup_key=["transaction_date"],
        feature_names=["orders_last_30d", "spend_last_30d"]
    ),
    # Product pricing at time of transaction
    FeatureLookup(
        table_name="production.features.product_pricing",
        lookup_key=["product_id"],
        timestamp_lookup_key=["transaction_date"],
        feature_names=["price", "effective_price"]
    )
]

# Features are joined as-of the timestamp, preventing data leakage
training_set = fs.create_training_set(
    df=training_labels,
    feature_lookups=feature_lookups,
    label="label"
)
```

## Training and Logging Models

```python
from sklearn.ensemble import GradientBoostingClassifier
import mlflow

# Prepare data
X = training_df.drop(columns=["label"])
y = training_df["label"]

# Train model
model = GradientBoostingClassifier(n_estimators=100, max_depth=5)
model.fit(X, y)

# Log model with feature store metadata
fs.log_model(
    model=model,
    artifact_path="model",
    flavor=mlflow.sklearn,
    training_set=training_set,
    registered_model_name="churn-predictor"
)
```

## Batch Scoring with Feature Store

```python
# Score new customers - features are automatically looked up
customers_to_score = spark.sql("""
    SELECT customer_id FROM production.customers.active_users
""")

# Load model logged with feature store
model_uri = "models:/churn-predictor/Production"

# Score batch - feature lookups happen automatically
scored_df = fs.score_batch(
    model_uri=model_uri,
    df=customers_to_score,
    result_type="float"  # Probability output
)

# Save predictions
scored_df.write.mode("overwrite").saveAsTable("analytics.predictions.churn_scores")
```

## Real-Time Serving

```python
# Publish features to online store for real-time serving
from databricks.feature_store import FeatureStoreClient
from databricks.feature_store.online_store_spec import AzureCosmosDBSpec

# Configure online store
online_store_spec = AzureCosmosDBSpec(
    account_uri="https://myaccount.documents.azure.com:443/",
    write_secret_prefix="feature-store/cosmosdb",
    read_secret_prefix="feature-store/cosmosdb",
    database_name="feature_store",
    container_name="customer_features"
)

# Publish to online store
fs.publish_table(
    name="production.features.customer_features",
    online_store=online_store_spec,
    mode="merge"
)
```

## Feature Engineering Patterns

### Aggregate Features

```python
def compute_aggregate_features(spark, window_days=[7, 30, 90]):
    """Compute rolling aggregate features"""

    base_query = """
    SELECT
        customer_id,
        SUM(CASE WHEN order_date >= date_sub(current_date(), {days}) THEN 1 ELSE 0 END) as orders_last_{days}d,
        SUM(CASE WHEN order_date >= date_sub(current_date(), {days}) THEN order_amount ELSE 0 END) as spend_last_{days}d,
        AVG(CASE WHEN order_date >= date_sub(current_date(), {days}) THEN order_amount END) as avg_order_last_{days}d
    FROM production.sales.orders
    GROUP BY customer_id
    """

    dfs = []
    for days in window_days:
        df = spark.sql(base_query.format(days=days))
        dfs.append(df)

    # Join all windows
    result = dfs[0]
    for df in dfs[1:]:
        result = result.join(df, "customer_id", "outer")

    return result
```

### Embedding Features

```python
# Store model embeddings as features
from sentence_transformers import SentenceTransformer

def compute_text_embeddings(texts):
    model = SentenceTransformer('all-MiniLM-L6-v2')
    return model.encode(texts)

# Compute embeddings for product descriptions
@pandas_udf("array<float>")
def embed_text_udf(texts: pd.Series) -> pd.Series:
    embeddings = compute_text_embeddings(texts.tolist())
    return pd.Series([e.tolist() for e in embeddings])

product_embeddings = spark.sql("""
    SELECT product_id, description FROM production.catalog.products
""").withColumn("description_embedding", embed_text_udf(col("description")))

# Store as feature table
fs.create_table(
    name="production.features.product_embeddings",
    primary_keys=["product_id"],
    df=product_embeddings.select("product_id", "description_embedding"),
    description="Product description embeddings using sentence-transformers"
)
```

## Feature Monitoring

```python
def monitor_feature_drift(feature_table, reference_date, current_date):
    """Compare feature distributions between two time periods"""
    from scipy import stats

    reference_df = spark.sql(f"""
        SELECT * FROM {feature_table}
        WHERE snapshot_date = '{reference_date}'
    """).toPandas()

    current_df = spark.sql(f"""
        SELECT * FROM {feature_table}
        WHERE snapshot_date = '{current_date}'
    """).toPandas()

    drift_results = {}
    numeric_columns = reference_df.select_dtypes(include=[np.number]).columns

    for col in numeric_columns:
        # KS test for distribution shift
        ks_stat, p_value = stats.ks_2samp(reference_df[col], current_df[col])
        drift_results[col] = {
            "ks_statistic": ks_stat,
            "p_value": p_value,
            "drift_detected": p_value < 0.05
        }

    return drift_results

# Run drift detection
drift = monitor_feature_drift(
    "production.features.customer_features",
    "2022-02-01",
    "2022-03-01"
)

for feature, result in drift.items():
    if result["drift_detected"]:
        print(f"DRIFT DETECTED: {feature} (p={result['p_value']:.4f})")
```

## Best Practices

### Feature Table Design

```python
# Good: Clear, documented feature tables
fs.create_table(
    name="production.features.customer_lifetime_metrics",
    primary_keys=["customer_id"],
    df=features_df,
    description="""
    Customer lifetime metrics computed from order history.
    Updated daily via scheduled job.
    Owner: data-science-team
    """,
    tags={
        "domain": "customer",
        "update_frequency": "daily",
        "data_quality": "production"
    }
)

# Good: Versioned feature definitions
feature_version = "v2"
fs.create_table(
    name=f"production.features.customer_features_{feature_version}",
    ...
)
```

### Avoiding Training-Serving Skew

```python
# Always use feature store for both training and serving
# DON'T: Manually join features for training
# DO: Use create_training_set

# DON'T: Compute features differently at serving time
# DO: Use score_batch or publish to online store

# DON'T: Include raw features in model
# DO: Log model with training_set reference
fs.log_model(
    model=model,
    training_set=training_set,  # Captures feature lineage
    ...
)
```

## Conclusion

The Databricks Feature Store brings discipline and organization to feature engineering:
- Centralized storage enables discovery and reuse
- Automatic feature lookups prevent training/serving skew
- Point-in-time joins ensure correctness
- Integration with MLflow provides complete lineage

By investing in feature infrastructure, teams can iterate faster, avoid duplicate work, and deploy more reliable models.

## Resources

- [Feature Store Documentation](https://docs.databricks.com/machine-learning/feature-store/index.html)
- [Feature Engineering Best Practices](https://docs.databricks.com/machine-learning/feature-store/best-practices.html)
- [Online Feature Serving](https://docs.databricks.com/machine-learning/feature-store/online-feature-stores.html)
