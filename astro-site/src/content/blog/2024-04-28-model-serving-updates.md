---
title: "Databricks Model Serving Updates: April 2024"
author: "Michael John Peña"
draft: false
date: 2024-04-28
tags: ["Databricks", "Model Serving", "MLOps", "AI", "Deployment"]

---

I wrote "Databricks Model Serving Updates: April 2024" to share practical, production-minded guidance on this topic.

Databricks Model Serving continues to evolve with new features for deploying and scaling ML models. This guide covers the latest updates and best practices.

## April 2024 Updates

```python
MODEL_SERVING_UPDATES = {
    "serverless_compute": {
        "description": "Pay-per-request serverless model endpoints",
        "features": [
            "Automatic scaling to zero",
            "No infrastructure management",
            "Cost-effective for variable workloads"
        ]
    },
    "provisioned_throughput": {
        "description": "Dedicated compute for predictable workloads",
        "features": [
            "Guaranteed latency",
            "Reserved capacity",
            "Cost predictability"
        ]
    },
    "foundation_models": {
        "description": "Pre-deployed foundation model APIs",
        "models": [
            "Meta Llama 3",
            "DBRX",
            "Mixtral",
            "BGE embeddings"
        ]
    },
    "gpu_serving": {
        "description": "GPU-accelerated inference",
        "features": [
            "Multiple GPU types",
            "Automatic batching",
            "Tensor parallelism"
        ]
    }
}
```

## Creating Model Endpoints

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import (
    EndpointCoreConfigInput,
    ServedEntityInput,
    AutoCaptureConfigInput,
    TrafficConfig,
    Route
)

client = WorkspaceClient()

# Create a serverless model endpoint
def create_serverless_endpoint(
    name: str,
    model_name: str,
    model_version: str
):
    """Create serverless model serving endpoint"""

    endpoint = client.serving_endpoints.create_and_wait(
        name=name,
        config=EndpointCoreConfigInput(
            name=name,
            served_entities=[
                ServedEntityInput(
                    entity_name=model_name,
                    entity_version=model_version,
                    workload_size="Small",  # Small, Medium, Large
                    scale_to_zero_enabled=True
                )
            ],
            # Enable auto-capture for monitoring
            auto_capture_config=AutoCaptureConfigInput(
                catalog_name="main",
                schema_name="ml_monitoring",
                table_name_prefix=name.replace("-", "_")
            )
        )
    )

    return endpoint

# Create endpoint
endpoint = create_serverless_endpoint(
    name="churn-predictor",
    model_name="main.ml_models.churn_classifier",
    model_version="1"
)

print(f"Endpoint URL: {endpoint.pending_config.served_entities[0].state.deployment.url}")
```

## A/B Testing with Traffic Splitting

```python
def setup_ab_test(
    endpoint_name: str,
    model_a: dict,
    model_b: dict,
    traffic_split: tuple = (90, 10)
):
    """Setup A/B test with traffic splitting"""

    # Update endpoint with two models
    client.serving_endpoints.update_config_and_wait(
        name=endpoint_name,
        served_entities=[
            ServedEntityInput(
                name="model-a",
                entity_name=model_a["name"],
                entity_version=model_a["version"],
                workload_size="Small",
                scale_to_zero_enabled=True
            ),
            ServedEntityInput(
                name="model-b",
                entity_name=model_b["name"],
                entity_version=model_b["version"],
                workload_size="Small",
                scale_to_zero_enabled=True
            )
        ],
        traffic_config=TrafficConfig(
            routes=[
                Route(served_model_name="model-a", traffic_percentage=traffic_split[0]),
                Route(served_model_name="model-b", traffic_percentage=traffic_split[1])
            ]
        )
    )

# Setup A/B test
setup_ab_test(
    endpoint_name="churn-predictor",
    model_a={"name": "main.ml_models.churn_v1", "version": "1"},
    model_b={"name": "main.ml_models.churn_v2", "version": "1"},
    traffic_split=(90, 10)
)
```

## GPU Model Serving

```python
# Deploy a large model with GPU serving
def create_gpu_endpoint(
    name: str,
    model_name: str,
    model_version: str,
    gpu_type: str = "GPU_MEDIUM"
):
    """Create GPU-accelerated model endpoint"""

    endpoint = client.serving_endpoints.create_and_wait(
        name=name,
        config=EndpointCoreConfigInput(
            served_entities=[
                ServedEntityInput(
                    entity_name=model_name,
                    entity_version=model_version,
                    workload_type="GPU_MEDIUM",  # GPU_SMALL, GPU_MEDIUM, GPU_LARGE
                    scale_to_zero_enabled=False,  # Keep warm for low latency
                    min_provisioned_throughput=1,  # Minimum tokens/second
                    max_provisioned_throughput=10
                )
            ]
        )
    )

    return endpoint

# Deploy embedding model on GPU
endpoint = create_gpu_endpoint(
    name="embeddings-endpoint",
    model_name="main.ml_models.text_embeddings",
    model_version="1",
    gpu_type="GPU_MEDIUM"
)
```

## Calling Model Endpoints

```python
import requests
import json
from typing import List, Dict, Any

class ModelServingClient:
    """Client for Databricks Model Serving"""

    def __init__(self, workspace_url: str, token: str):
        self.workspace_url = workspace_url
        self.token = token

    def predict(
        self,
        endpoint_name: str,
        inputs: List[Dict[str, Any]]
    ) -> Dict:
        """Make prediction request"""

        url = f"{self.workspace_url}/serving-endpoints/{endpoint_name}/invocations"

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

        # Databricks serving expects this format
        payload = {
            "inputs": inputs
        }

        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()

        return response.json()

    def predict_dataframe(
        self,
        endpoint_name: str,
        df_records: List[Dict]
    ) -> Dict:
        """Predict using dataframe format"""

        url = f"{self.workspace_url}/serving-endpoints/{endpoint_name}/invocations"

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

        payload = {
            "dataframe_records": df_records
        }

        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()

        return response.json()

# Usage
client = ModelServingClient(
    workspace_url="https://adb-xxx.azuredatabricks.net",
    token="your-token"
)

# Predict
result = client.predict(
    endpoint_name="churn-predictor",
    inputs=[
        {
            "total_orders": 15,
            "total_spend": 1250.00,
            "days_since_last_order": 45
        }
    ]
)

print(f"Prediction: {result['predictions']}")
```

## Endpoint Monitoring

```python
def get_endpoint_metrics(endpoint_name: str, hours: int = 24):
    """Get endpoint metrics"""

    # Query from auto-capture tables
    metrics = spark.sql(f"""
        SELECT
            DATE_TRUNC('hour', timestamp) as hour,
            COUNT(*) as request_count,
            AVG(latency_ms) as avg_latency,
            PERCENTILE(latency_ms, 0.95) as p95_latency,
            AVG(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_rate
        FROM main.ml_monitoring.{endpoint_name.replace('-', '_')}_requests
        WHERE timestamp >= current_timestamp() - INTERVAL {hours} HOURS
        GROUP BY DATE_TRUNC('hour', timestamp)
        ORDER BY hour
    """)

    return metrics

# Get metrics
metrics = get_endpoint_metrics("churn-predictor", hours=24)
metrics.show()
```

## Model Endpoint Management

```python
class EndpointManager:
    """Manage model serving endpoints"""

    def __init__(self, workspace_client):
        self.client = workspace_client

    def list_endpoints(self) -> List[Dict]:
        """List all endpoints"""
        endpoints = self.client.serving_endpoints.list()
        return [
            {
                "name": e.name,
                "state": e.state.ready,
                "config": e.config
            }
            for e in endpoints
        ]

    def update_model_version(
        self,
        endpoint_name: str,
        new_version: str,
        gradual_rollout: bool = True
    ):
        """Update model to new version"""

        if gradual_rollout:
            # Start with 10% traffic to new version
            self._gradual_update(endpoint_name, new_version)
        else:
            # Direct update
            self._direct_update(endpoint_name, new_version)

    def _gradual_update(self, endpoint_name: str, new_version: str):
        """Gradual rollout of new model version"""

        traffic_stages = [10, 25, 50, 75, 100]

        for pct in traffic_stages:
            print(f"Rolling out to {pct}%")

            # Update traffic split
            # (Implementation depends on endpoint configuration)

            # Wait and monitor
            time.sleep(300)  # 5 minutes between stages

            # Check metrics
            metrics = self._check_health(endpoint_name)
            if not metrics["healthy"]:
                print("Rollout paused due to degraded metrics")
                return False

        return True

    def _direct_update(self, endpoint_name: str, new_version: str):
        """Direct version update"""
        # Update served entity version
        pass

    def _check_health(self, endpoint_name: str) -> Dict:
        """Check endpoint health"""
        # Query metrics and check thresholds
        return {"healthy": True, "latency_ok": True, "error_rate_ok": True}

    def delete_endpoint(self, endpoint_name: str):
        """Delete an endpoint"""
        self.client.serving_endpoints.delete(endpoint_name)

# Usage
manager = EndpointManager(client)
endpoints = manager.list_endpoints()
for ep in endpoints:
    print(f"{ep['name']}: {ep['state']}")
```

## Conclusion

Databricks Model Serving provides flexible options from serverless to GPU-accelerated endpoints. Use traffic splitting for safe deployments and auto-capture for monitoring. Match your workload size to your latency and cost requirements.

