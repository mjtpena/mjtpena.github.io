---
title: Understanding Feature Stores for Machine Learning
author: Michael John Pena
draft: false
date: 2021-09-05
tags:
  - Azure
  - Machine Learning
  - Feature Engineering
  - MLOps
  - Data Engineering

---

I wrote "2021-09-05-feature-stores-concepts" to share practical, production-minded guidance on this topic.

## What is a Feature Store?

A feature store is a centralized repository that:

1. **Stores feature definitions and values**: Both historical and real-time
2. **Ensures consistency**: Same features for training and inference
3. **Enables reusability**: Share features across teams and models
4. **Tracks lineage**: Know how features are computed
5. **Serves features**: Low-latency access for online inference

## The Training-Serving Skew Problem

```python
# Without a feature store - training code
def compute_features_training(df):
    df['customer_lifetime_value'] = df.groupby('customer_id')['amount'].transform('sum')
    df['days_since_last_purchase'] = (pd.Timestamp.now() - df['last_purchase_date']).dt.days
    df['purchase_frequency'] = df.groupby('customer_id')['order_id'].transform('count') / 365
    return df

# Without a feature store - inference code (different implementation!)
def compute_features_inference(customer_id):
    # Oops! Different aggregation logic
    ltv = db.query(f"SELECT SUM(amount) FROM orders WHERE customer_id = {customer_id}")
    # Bug: This uses different date calculation
    days = (datetime.now() - get_last_purchase(customer_id)).days
    return {'ltv': ltv, 'days_since_purchase': days}
```

## Feature Store Architecture

```
+-------------------+     +-------------------+     +-------------------+
|   Data Sources    |     |   Feature Store   |     |   Consumers       |
|-------------------|     |-------------------|     |-------------------|
| - Databases       | --> | - Feature Catalog | --> | - Training Jobs   |
| - Event Streams   |     | - Offline Store   |     | - Online Serving  |
| - Data Lakes      |     | - Online Store    |     | - Batch Inference |
| - APIs            |     | - Feature Pipeline|     | - Analytics       |
+-------------------+     +-------------------+     +-------------------+
```

## Implementing a Simple Feature Store Pattern

```python
# feature_store.py
from datetime import datetime, timedelta
from typing import Dict, List, Any
import pandas as pd
import redis
from azure.storage.blob import BlobServiceClient

class FeatureStore:
    def __init__(self, offline_storage_url: str, online_store_host: str):
        self.blob_client = BlobServiceClient.from_connection_string(offline_storage_url)
        self.redis_client = redis.Redis(host=online_store_host, port=6379)
        self.feature_registry = {}

    def register_feature(self, name: str, description: str,
                        entity: str, computation_fn,
                        value_type: str = "float"):
        """Register a feature definition"""
        self.feature_registry[name] = {
            "description": description,
            "entity": entity,
            "computation_fn": computation_fn,
            "value_type": value_type,
            "created_at": datetime.now().isoformat()
        }

    def compute_and_store_offline(self, feature_name: str,
                                   source_df: pd.DataFrame,
                                   timestamp_col: str = "event_time"):
        """Compute features and store in offline store (blob)"""
        feature_def = self.feature_registry[feature_name]

        # Compute features
        result_df = feature_def["computation_fn"](source_df)

        # Store in offline store with timestamp partitioning
        container = self.blob_client.get_container_client("features")
        partition = datetime.now().strftime("%Y/%m/%d")
        blob_path = f"{feature_name}/{partition}/data.parquet"

        result_df.to_parquet(f"/tmp/{feature_name}.parquet")
        with open(f"/tmp/{feature_name}.parquet", "rb") as f:
            container.upload_blob(blob_path, f, overwrite=True)

        return result_df

    def materialize_to_online(self, feature_name: str,
                               entity_df: pd.DataFrame,
                               entity_col: str,
                               value_col: str):
        """Copy features to online store for low-latency serving"""
        for _, row in entity_df.iterrows():
            key = f"{feature_name}:{row[entity_col]}"
            self.redis_client.set(key, str(row[value_col]))
            # Set TTL for freshness
            self.redis_client.expire(key, timedelta(hours=24))

    def get_online_features(self, feature_names: List[str],
                            entity_id: str) -> Dict[str, Any]:
        """Get features for online inference"""
        features = {}
        for name in feature_names:
            key = f"{name}:{entity_id}"
            value = self.redis_client.get(key)
            if value:
                features[name] = float(value.decode())
        return features

    def get_historical_features(self, feature_names: List[str],
                                 entity_df: pd.DataFrame,
                                 timestamp_col: str) -> pd.DataFrame:
        """Point-in-time join for training data"""
        # Implementation would perform point-in-time correct joins
        # to avoid data leakage
        pass

# Usage example
def compute_customer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Feature computation function"""
    return df.groupby('customer_id').agg({
        'amount': ['sum', 'mean', 'std'],
        'order_id': 'count'
    }).reset_index()

# Initialize and use
fs = FeatureStore(
    offline_storage_url="your-connection-string",
    online_store_host="your-redis-host"
)

# Register feature
fs.register_feature(
    name="customer_spending_stats",
    description="Customer spending aggregations",
    entity="customer_id",
    computation_fn=compute_customer_features
)
```

## Point-in-Time Correctness

Critical for avoiding data leakage:

```python
def point_in_time_join(entity_df: pd.DataFrame,
                       feature_df: pd.DataFrame,
                       entity_col: str,
                       entity_timestamp_col: str,
                       feature_timestamp_col: str) -> pd.DataFrame:
    """
    Join features that were available at each entity timestamp.
    Prevents using future data for historical predictions.
    """
    # Sort both dataframes
    entity_df = entity_df.sort_values(entity_timestamp_col)
    feature_df = feature_df.sort_values(feature_timestamp_col)

    result = []

    for _, entity_row in entity_df.iterrows():
        entity_id = entity_row[entity_col]
        entity_time = entity_row[entity_timestamp_col]

        # Get features available BEFORE entity timestamp
        available_features = feature_df[
            (feature_df[entity_col] == entity_id) &
            (feature_df[feature_timestamp_col] < entity_time)
        ]

        if len(available_features) > 0:
            # Use most recent features
            latest_features = available_features.iloc[-1]
            merged = {**entity_row.to_dict(), **latest_features.to_dict()}
            result.append(merged)

    return pd.DataFrame(result)
```

## Feature Store in Azure

While Azure doesn't have a standalone feature store service, you can build one using:

```python
# Azure-native feature store architecture
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Data
from azure.synapse.spark import SparkSession

class AzureFeatureStore:
    def __init__(self, ml_client: MLClient):
        self.ml_client = ml_client

    def register_feature_set(self, name: str,
                             spark_df,
                             description: str):
        """Register a feature set as Azure ML dataset"""
        # Write to Delta Lake format in ADLS
        spark_df.write.format("delta").mode("overwrite").save(
            f"abfss://features@yourdatalake.dfs.core.windows.net/{name}"
        )

        # Register as Azure ML data asset
        data_asset = Data(
            name=name,
            path=f"abfss://features@yourdatalake.dfs.core.windows.net/{name}",
            type="uri_folder",
            description=description
        )
        self.ml_client.data.create_or_update(data_asset)
```

## Key Takeaways

1. **Consistency**: Feature stores ensure training and serving use identical feature logic
2. **Reusability**: Compute features once, use everywhere
3. **Freshness**: Dual-storage (offline + online) balances historical analysis and real-time serving
4. **Governance**: Track feature lineage and ownership
5. **Time-travel**: Point-in-time queries prevent data leakage

Feature stores are becoming essential infrastructure for production ML systems. Understanding these concepts will help you build more reliable and maintainable ML pipelines.

