---
title: "Serverless Model Serving: Pay-Per-Request ML Inference"
description: "Serverless model serving eliminates infrastructure management while providing cost-effective, scalable ML inference. This guide covers implementing…"
author: "Michael John Peña"
draft: false
date: 2024-04-29
tags: ["Databricks", "Serverless", "Model Serving", "MLOps", "Cost Optimization"]
---

Serverless model serving eliminates infrastructure management while providing cost-effective, scalable ML inference. This guide covers implementing serverless patterns in Databricks.

## Serverless Benefits

```python
SERVERLESS_ADVANTAGES = {
    "cost_efficiency": {
        "description": "Pay only for actual inference requests",
        "best_for": ["Variable workloads", "Dev/test environments", "Batch-heavy patterns"]
    },
    "scalability": {
        "description": "Automatic scaling from zero to high throughput",
        "best_for": ["Unpredictable traffic", "Burst handling", "Global deployments"]
    },
    "simplicity": {
        "description": "No infrastructure management",
        "best_for": ["Small teams", "Rapid prototyping", "Focus on ML not ops"]
    }
}
```

## Creating Serverless Endpoints

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import (
    EndpointCoreConfigInput,
    ServedEntityInput
)

client = WorkspaceClient()

def create_serverless_endpoint(
    name: str,
    model_name: str,
    model_version: str,
    min_scale: int = 0,
    max_scale: int = 10
):
    """Create a serverless model endpoint"""

    endpoint = client.serving_endpoints.create_and_wait(
        name=name,
        config=EndpointCoreConfigInput(
            served_entities=[
                ServedEntityInput(
                    entity_name=model_name,
                    entity_version=model_version,
                    # Serverless configuration
                    workload_size="Small",
                    scale_to_zero_enabled=(min_scale == 0),
                    # Custom scaling bounds
                    min_instances=min_scale,
                    max_instances=max_scale
                )
            ]
        )
    )

    print(f"Endpoint created: {name}")
    print(f"State: {endpoint.state.ready}")

    return endpoint

# Create endpoint that scales to zero
endpoint = create_serverless_endpoint(
    name="recommendation-engine",
    model_name="main.ml_models.product_recommender",
    model_version="1",
    min_scale=0,
    max_scale=5
)
```

## Cold Start Optimization

```python
import time
import requests
from typing import Optional

class ServerlessEndpointClient:
    """Client optimized for serverless endpoints"""

    def __init__(
        self,
        workspace_url: str,
        token: str,
        warm_up_enabled: bool = True
    ):
        self.workspace_url = workspace_url
        self.token = token
        self.warm_up_enabled = warm_up_enabled
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def predict(
        self,
        endpoint_name: str,
        inputs: list,
        timeout: int = 60
    ) -> dict:
        """Make prediction with cold start handling"""

        url = f"{self.workspace_url}/serving-endpoints/{endpoint_name}/invocations"

        # Retry logic for cold starts
        max_retries = 3
        retry_delay = 5

        for attempt in range(max_retries):
            try:
                response = requests.post(
                    url,
                    headers=self.headers,
                    json={"inputs": inputs},
                    timeout=timeout
                )

                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 503:
                    # Endpoint scaling up
                    print(f"Endpoint scaling up, retry in {retry_delay}s...")
                    time.sleep(retry_delay)
                else:
                    response.raise_for_status()

            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    print(f"Request timed out, retry {attempt + 1}/{max_retries}")
                    time.sleep(retry_delay)
                else:
                    raise

        raise Exception("Max retries exceeded")

    def warm_up(self, endpoint_name: str, sample_input: dict):
        """Send warm-up request to prevent cold start"""

        if not self.warm_up_enabled:
            return

        try:
            self.predict(endpoint_name, [sample_input], timeout=120)
            print(f"Endpoint {endpoint_name} warmed up")
        except Exception as e:
            print(f"Warm-up failed (non-critical): {e}")

    def batch_predict(
        self,
        endpoint_name: str,
        inputs: list,
        batch_size: int = 100
    ) -> list:
        """Batch predictions with optimal batching"""

        results = []

        for i in range(0, len(inputs), batch_size):
            batch = inputs[i:i + batch_size]
            result = self.predict(endpoint_name, batch)
            results.extend(result.get("predictions", []))

        return results

# Usage
client = ServerlessEndpointClient(
    workspace_url="https://adb-xxx.azuredatabricks.net",
    token="your-token"
)

# Warm up endpoint (e.g., before expected traffic)
client.warm_up(
    "recommendation-engine",
    sample_input={"user_id": "test", "product_id": "test"}
)

# Make predictions
predictions = client.predict(
    "recommendation-engine",
    inputs=[{"user_id": "user123", "product_id": "prod456"}]
)
```

## Cost Optimization Strategies

```python
class CostOptimizedServing:
    """Cost optimization patterns for serverless serving"""

    def __init__(self, workspace_client):
        self.client = workspace_client

    def get_usage_report(self, endpoint_name: str, days: int = 30) -> dict:
        """Generate usage and cost report"""

        # Query usage metrics
        usage = spark.sql(f"""
            SELECT
                DATE(timestamp) as date,
                COUNT(*) as request_count,
                SUM(compute_duration_ms) / 1000 / 60 as compute_minutes,
                AVG(input_tokens + output_tokens) as avg_tokens
            FROM main.ml_monitoring.{endpoint_name.replace('-', '_')}_usage
            WHERE timestamp >= current_date() - INTERVAL {days} DAYS
            GROUP BY DATE(timestamp)
            ORDER BY date
        """).collect()

        # Calculate costs (simplified)
        total_compute_minutes = sum(row["compute_minutes"] for row in usage)
        total_requests = sum(row["request_count"] for row in usage)

        # Cost estimates (example rates)
        cost_per_minute = 0.01
        estimated_cost = total_compute_minutes * cost_per_minute

        return {
            "total_requests": total_requests,
            "total_compute_minutes": total_compute_minutes,
            "estimated_cost": estimated_cost,
            "cost_per_request": estimated_cost / total_requests if total_requests > 0 else 0,
            "daily_breakdown": usage
        }

    def recommend_configuration(self, usage_report: dict) -> dict:
        """Recommend endpoint configuration based on usage"""

        avg_daily_requests = usage_report["total_requests"] / 30

        if avg_daily_requests < 100:
            recommendation = {
                "config": "serverless_scale_to_zero",
                "workload_size": "Small",
                "min_instances": 0,
                "reason": "Low traffic - maximize cost savings with scale to zero"
            }
        elif avg_daily_requests < 10000:
            recommendation = {
                "config": "serverless_warm",
                "workload_size": "Small",
                "min_instances": 1,
                "reason": "Moderate traffic - keep one instance warm to avoid cold starts"
            }
        else:
            recommendation = {
                "config": "provisioned",
                "workload_size": "Medium",
                "min_instances": 2,
                "reason": "High traffic - consider provisioned throughput for cost predictability"
            }

        return recommendation

    def implement_caching(self, endpoint_name: str, cache_ttl: int = 300):
        """Implement response caching to reduce inference calls"""

        # Cache configuration
        return {
            "strategy": "lru_cache",
            "max_size": 10000,
            "ttl_seconds": cache_ttl,
            "key_function": "hash(input_features)"
        }

# Usage
optimizer = CostOptimizedServing(client)

# Get usage report
report = optimizer.get_usage_report("recommendation-engine", days=30)
print(f"Total cost: ${report['estimated_cost']:.2f}")
print(f"Cost per request: ${report['cost_per_request']:.4f}")

# Get recommendations
recommendation = optimizer.recommend_configuration(report)
print(f"Recommended config: {recommendation['config']}")
print(f"Reason: {recommendation['reason']}")
```

## Hybrid Serving Patterns

```python
class HybridServingRouter:
    """Route between serverless and provisioned endpoints"""

    def __init__(self, serverless_endpoint: str, provisioned_endpoint: str):
        self.serverless = serverless_endpoint
        self.provisioned = provisioned_endpoint
        self.request_count = 0
        self.threshold = 100  # Requests per minute threshold

    def route(self, inputs: list, latency_requirement: str = "normal") -> str:
        """Determine which endpoint to use"""

        if latency_requirement == "low":
            # Use provisioned for low-latency requirements
            return self.provisioned
        elif self.request_count > self.threshold:
            # High traffic - use provisioned for cost efficiency
            return self.provisioned
        else:
            # Normal traffic - use serverless
            return self.serverless

    def predict(
        self,
        inputs: list,
        latency_requirement: str = "normal"
    ) -> dict:
        """Make prediction with automatic routing"""

        endpoint = self.route(inputs, latency_requirement)

        # Make prediction
        result = self._call_endpoint(endpoint, inputs)

        # Track request for routing decisions
        self.request_count += 1

        return {
            "predictions": result,
            "endpoint_used": endpoint
        }

    def _call_endpoint(self, endpoint: str, inputs: list) -> dict:
        # Implementation
        pass

# Usage
router = HybridServingRouter(
    serverless_endpoint="model-serverless",
    provisioned_endpoint="model-provisioned"
)

# Normal request - may use serverless
result = router.predict(inputs, latency_requirement="normal")

# Low-latency request - uses provisioned
result = router.predict(inputs, latency_requirement="low")
```

## Monitoring Serverless Endpoints

```python
class ServerlessMonitor:
    """Monitor serverless endpoint health and costs"""

    def __init__(self, endpoint_name: str):
        self.endpoint_name = endpoint_name

    def get_scaling_metrics(self, hours: int = 24) -> dict:
        """Get scaling behavior metrics"""

        metrics = spark.sql(f"""
            SELECT
                DATE_TRUNC('hour', timestamp) as hour,
                COUNT(*) as requests,
                MAX(active_instances) as max_instances,
                MIN(active_instances) as min_instances,
                SUM(CASE WHEN cold_start THEN 1 ELSE 0 END) as cold_starts
            FROM main.ml_monitoring.{self.endpoint_name.replace('-', '_')}_scaling
            WHERE timestamp >= current_timestamp() - INTERVAL {hours} HOURS
            GROUP BY DATE_TRUNC('hour', timestamp)
            ORDER BY hour
        """)

        return metrics.toPandas().to_dict('records')

    def get_cold_start_analysis(self) -> dict:
        """Analyze cold start patterns"""

        analysis = spark.sql(f"""
            SELECT
                HOUR(timestamp) as hour_of_day,
                COUNT(*) as total_requests,
                SUM(CASE WHEN cold_start THEN 1 ELSE 0 END) as cold_starts,
                AVG(CASE WHEN cold_start THEN latency_ms ELSE NULL END) as avg_cold_start_latency,
                AVG(CASE WHEN NOT cold_start THEN latency_ms ELSE NULL END) as avg_warm_latency
            FROM main.ml_monitoring.{self.endpoint_name.replace('-', '_')}_requests
            WHERE timestamp >= current_date() - INTERVAL 7 DAYS
            GROUP BY HOUR(timestamp)
            ORDER BY hour_of_day
        """).collect()

        return {
            "by_hour": analysis,
            "recommendation": self._get_warm_up_recommendation(analysis)
        }

    def _get_warm_up_recommendation(self, analysis) -> str:
        """Recommend warm-up schedule based on cold start patterns"""

        high_cold_start_hours = [
            row["hour_of_day"] for row in analysis
            if row["cold_starts"] / row["total_requests"] > 0.1
        ]

        if high_cold_start_hours:
            return f"Consider warm-up requests at hours: {high_cold_start_hours}"
        return "Cold starts are minimal, no warm-up needed"

# Usage
monitor = ServerlessMonitor("recommendation-engine")
cold_start_analysis = monitor.get_cold_start_analysis()
print(cold_start_analysis["recommendation"])
```

## Conclusion

Serverless model serving provides cost-effective, scalable ML inference. Handle cold starts with warm-up strategies, optimize costs with caching and intelligent routing, and monitor scaling behavior for continuous improvement.
