---
title: "Online Feature Serving in Databricks: Real-Time ML Features"
description: "Online feature serving enables real-time ML inference by providing low-latency access to features. This guide covers setting up and using Databricks online…"
author: "Michael John Peña"
draft: false
date: 2024-04-27
tags:
  - Databricks
  - Feature Serving
  - ML
  - Real-Time
  - MLOps
---

Online feature serving enables real-time ML inference by providing low-latency access to features. This guide covers setting up and using Databricks online feature serving.

## Online vs Offline Features

```python
FEATURE_SERVING_COMPARISON = {
    "offline": {
        "latency": "Seconds to minutes",
        "use_case": "Batch predictions, training",
        "storage": "Delta tables",
        "update_frequency": "Batch (hourly/daily)"
    },
    "online": {
        "latency": "Milliseconds",
        "use_case": "Real-time inference",
        "storage": "Online store (managed)",
        "update_frequency": "Near real-time"
    }
}
```

## Setting Up Online Tables

```python
from databricks.feature_engineering import FeatureEngineeringClient

fe = FeatureEngineeringClient()

# Create feature table with online serving enabled
def create_online_feature_table(spark):
    """Create a feature table configured for online serving"""

    # Compute features
    features_df = spark.sql("""
        SELECT
            customer_id,
            total_orders,
            total_spend,
            avg_order_value,
            days_since_last_order,
            preferred_category,
            customer_tier,
            updated_at
        FROM customer_features_staging
    """)

    # Create table with online config
    fe.create_table(
        name="main.features.customer_realtime_features",
        primary_keys=["customer_id"],
        df=features_df,
        description="Real-time customer features for online serving",
        # Enable online serving
        online_config={
            "enabled": True,
            "ttl_seconds": 86400  # 24 hour TTL
        }
    )

    return features_df

# Create the table
features = create_online_feature_table(spark)
```

## Publishing to Online Store

```python
# Publish features to online store
def publish_to_online_store(feature_table: str):
    """Publish feature table to online store"""

    fe.publish_table(
        name=feature_table,
        online_store_name="main.online_stores.production",
        filter_condition="updated_at >= current_timestamp() - interval 1 day",
        mode="merge"
    )

# Publish incrementally
publish_to_online_store("main.features.customer_realtime_features")
```

## Creating Feature Serving Endpoints

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import (
    EndpointCoreConfigInput,
    ServedEntityInput,
    ServedEntitySpec
)

client = WorkspaceClient()

def create_feature_serving_endpoint(endpoint_name: str, feature_spec: dict):
    """Create endpoint for online feature serving"""

    # Create feature spec
    # Feature specs define which features to serve

    endpoint = client.serving_endpoints.create_and_wait(
        name=endpoint_name,
        config=EndpointCoreConfigInput(
            served_entities=[
                ServedEntityInput(
                    entity_name=feature_spec["name"],
                    entity_version=feature_spec["version"],
                    workload_size="Small",
                    scale_to_zero_enabled=True
                )
            ]
        )
    )

    return endpoint

# Create endpoint
endpoint = create_feature_serving_endpoint(
    "customer-features-endpoint",
    {"name": "main.features.customer_realtime_features", "version": "1"}
)
```

## Querying Online Features

```python
import requests
import json

class OnlineFeatureClient:
    """Client for querying online features"""

    def __init__(self, endpoint_url: str, token: str):
        self.endpoint_url = endpoint_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def get_features(
        self,
        entity_ids: list,
        feature_names: list = None
    ) -> dict:
        """Get features for given entities"""

        payload = {
            "entities": [{"customer_id": eid} for eid in entity_ids]
        }

        if feature_names:
            payload["features"] = feature_names

        response = requests.post(
            f"{self.endpoint_url}/invocations",
            headers=self.headers,
            json=payload
        )

        return response.json()

    def get_features_batch(
        self,
        entity_ids: list,
        batch_size: int = 100
    ) -> list:
        """Get features in batches"""

        all_features = []

        for i in range(0, len(entity_ids), batch_size):
            batch = entity_ids[i:i + batch_size]
            result = self.get_features(batch)
            all_features.extend(result.get("features", []))

        return all_features

# Usage
client = OnlineFeatureClient(
    endpoint_url="https://endpoint-url/serving-endpoints/customer-features-endpoint",
    token="your-token"
)

# Get features for customers
features = client.get_features(
    entity_ids=["customer_123", "customer_456"],
    feature_names=["total_spend", "avg_order_value", "customer_tier"]
)

print(features)
```

## Real-Time Inference with Online Features

```python
import mlflow
import requests

class RealTimePredictor:
    """Real-time predictions using online features"""

    def __init__(
        self,
        model_endpoint: str,
        feature_endpoint: str,
        token: str
    ):
        self.model_endpoint = model_endpoint
        self.feature_client = OnlineFeatureClient(feature_endpoint, token)
        self.token = token

    def predict(self, customer_id: str, additional_features: dict = None) -> dict:
        """Make prediction for a customer"""

        # 1. Fetch features from online store
        features = self.feature_client.get_features(
            entity_ids=[customer_id],
            feature_names=[
                "total_orders",
                "total_spend",
                "avg_order_value",
                "days_since_last_order"
            ]
        )

        if not features.get("features"):
            return {"error": "Features not found for customer"}

        # 2. Combine with additional features
        feature_vector = features["features"][0]
        if additional_features:
            feature_vector.update(additional_features)

        # 3. Call model endpoint
        prediction = self._call_model(feature_vector)

        return {
            "customer_id": customer_id,
            "features": feature_vector,
            "prediction": prediction
        }

    def _call_model(self, features: dict) -> dict:
        """Call model serving endpoint"""

        response = requests.post(
            f"{self.model_endpoint}/invocations",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json"
            },
            json={"inputs": [features]}
        )

        return response.json()

# Usage
predictor = RealTimePredictor(
    model_endpoint="https://model-endpoint",
    feature_endpoint="https://feature-endpoint",
    token="token"
)

result = predictor.predict(
    customer_id="customer_123",
    additional_features={"current_cart_value": 150.00}
)
print(f"Churn prediction: {result['prediction']}")
```

## Feature Freshness and Sync

```python
from datetime import datetime, timedelta

class FeatureSyncManager:
    """Manage feature freshness and synchronization"""

    def __init__(self, fe_client, spark):
        self.fe = fe_client
        self.spark = spark

    def check_freshness(self, table_name: str, max_age_hours: int = 1) -> dict:
        """Check if features are fresh"""

        # Get latest update time
        latest = self.spark.sql(f"""
            SELECT MAX(updated_at) as latest_update
            FROM {table_name}
        """).collect()[0]["latest_update"]

        age_hours = (datetime.now() - latest).total_seconds() / 3600

        return {
            "table": table_name,
            "latest_update": latest.isoformat(),
            "age_hours": age_hours,
            "is_fresh": age_hours <= max_age_hours
        }

    def sync_to_online(
        self,
        table_name: str,
        incremental: bool = True
    ):
        """Sync features to online store"""

        if incremental:
            # Only sync recent updates
            filter_condition = "updated_at >= current_timestamp() - interval 1 hour"
        else:
            filter_condition = None

        self.fe.publish_table(
            name=table_name,
            filter_condition=filter_condition,
            mode="merge" if incremental else "overwrite"
        )

    def schedule_sync(self, table_name: str, frequency_minutes: int = 15):
        """Configure automatic sync schedule"""

        # This would typically be done via a Databricks job
        sync_config = {
            "table": table_name,
            "frequency": f"*/{frequency_minutes} * * * *",  # Cron expression
            "incremental": True
        }

        return sync_config

# Usage
sync_manager = FeatureSyncManager(fe, spark)

# Check freshness
freshness = sync_manager.check_freshness("main.features.customer_realtime_features")
print(f"Features fresh: {freshness['is_fresh']}")

# Sync if stale
if not freshness["is_fresh"]:
    sync_manager.sync_to_online("main.features.customer_realtime_features")
```

## Monitoring Online Features

```python
class OnlineFeatureMonitor:
    """Monitor online feature serving"""

    def __init__(self, endpoint_name: str):
        self.endpoint_name = endpoint_name
        self.metrics = []

    def log_request(
        self,
        entity_ids: list,
        latency_ms: float,
        features_found: int,
        features_missing: int
    ):
        """Log request metrics"""

        self.metrics.append({
            "timestamp": datetime.now().isoformat(),
            "endpoint": self.endpoint_name,
            "num_entities": len(entity_ids),
            "latency_ms": latency_ms,
            "features_found": features_found,
            "features_missing": features_missing,
            "hit_rate": features_found / (features_found + features_missing)
        })

    def get_summary(self, last_n: int = 100) -> dict:
        """Get metrics summary"""

        recent = self.metrics[-last_n:]

        if not recent:
            return {}

        latencies = [m["latency_ms"] for m in recent]
        hit_rates = [m["hit_rate"] for m in recent]

        return {
            "total_requests": len(recent),
            "avg_latency_ms": sum(latencies) / len(latencies),
            "p95_latency_ms": sorted(latencies)[int(len(latencies) * 0.95)],
            "avg_hit_rate": sum(hit_rates) / len(hit_rates)
        }
```

## Conclusion

Online feature serving enables low-latency ML inference by providing millisecond access to pre-computed features. Design your feature pipeline with both offline training and online serving in mind for production ML systems.
