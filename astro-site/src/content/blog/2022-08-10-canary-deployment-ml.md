---
title: "Canary Deployments for ML Models"
author: "Michael John Peña"
draft: false
date: 2022-08-10
tags: ["Azure", "Machine Learning", "MLOps", "Canary Deployment", "Risk Management"]

---

I wrote "Canary Deployments for ML Models" to share practical, production-minded guidance on this topic.

## Understanding Canary Deployment

Canary deployment differs from blue-green:
- Traffic shifts gradually (e.g., 5% -> 25% -> 50% -> 100%)
- Issues affect only a subset of users
- Automatic rollback based on metrics

## Setting Up Canary Deployment

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import ManagedOnlineEndpoint, ManagedOnlineDeployment
from azure.identity import DefaultAzureCredential
import time

ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Assume blue (stable) is already deployed with 100% traffic
# Deploy canary (new version)
canary_deployment = ManagedOnlineDeployment(
    name="canary",
    endpoint_name="production-endpoint",
    model="azureml:my-model:2",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    code_configuration=CodeConfiguration(
        code="./src",
        scoring_script="score.py"
    ),
    instance_type="Standard_DS2_v2",
    instance_count=1
)

ml_client.online_deployments.begin_create_or_update(canary_deployment).result()
print("Canary deployment created")
```

## Gradual Traffic Shift

```python
class CanaryDeploymentManager:
    def __init__(self, ml_client, endpoint_name, stable_name, canary_name):
        self.ml_client = ml_client
        self.endpoint_name = endpoint_name
        self.stable_name = stable_name
        self.canary_name = canary_name

    def set_traffic(self, canary_percentage):
        """Set traffic split between stable and canary"""
        endpoint = self.ml_client.online_endpoints.get(self.endpoint_name)

        stable_percentage = 100 - canary_percentage
        endpoint.traffic = {
            self.stable_name: stable_percentage,
            self.canary_name: canary_percentage
        }

        self.ml_client.online_endpoints.begin_create_or_update(endpoint).result()
        print(f"Traffic: {self.stable_name}={stable_percentage}%, {self.canary_name}={canary_percentage}%")

    def get_current_traffic(self):
        """Get current traffic allocation"""
        endpoint = self.ml_client.online_endpoints.get(self.endpoint_name)
        return endpoint.traffic

    def rollback(self):
        """Rollback all traffic to stable"""
        self.set_traffic(0)
        print("Rolled back to stable deployment")

    def promote(self):
        """Promote canary to 100%"""
        self.set_traffic(100)
        print("Canary promoted to 100%")

# Initialize manager
canary_manager = CanaryDeploymentManager(
    ml_client,
    "production-endpoint",
    "blue",
    "canary"
)

# Start with 5% canary traffic
canary_manager.set_traffic(5)
```

## Monitoring Canary Health

```python
import requests
from datetime import datetime, timedelta
from azure.monitor.query import MetricsQueryClient, LogsQueryClient

class CanaryHealthMonitor:
    def __init__(self, endpoint_name, metrics_client, logs_client):
        self.endpoint_name = endpoint_name
        self.metrics_client = metrics_client
        self.logs_client = logs_client
        self.workspace_id = "your-log-analytics-workspace-id"

    def get_metrics(self, deployment_name, duration_minutes=15):
        """Get metrics for a specific deployment"""
        resource_uri = f"/subscriptions/.../providers/Microsoft.MachineLearningServices/workspaces/.../onlineEndpoints/{self.endpoint_name}/deployments/{deployment_name}"

        response = self.metrics_client.query_resource(
            resource_uri=resource_uri,
            metric_names=["RequestLatencyP99", "RequestsPerMinute", "CPUUtilization"],
            timespan=timedelta(minutes=duration_minutes)
        )

        metrics = {}
        for metric in response.metrics:
            values = [dp.average for ts in metric.timeseries for dp in ts.data if dp.average]
            metrics[metric.name] = sum(values) / len(values) if values else 0

        return metrics

    def get_error_rate(self, deployment_name, duration_minutes=15):
        """Get error rate from logs"""
        query = f"""
        AzureMLOnlineEndpoint
        | where TimeGenerated > ago({duration_minutes}m)
        | where EndpointName == '{self.endpoint_name}'
        | where DeploymentName == '{deployment_name}'
        | summarize
            TotalRequests = count(),
            Errors = countif(ResultCode >= 400)
        | extend ErrorRate = Errors * 100.0 / TotalRequests
        """

        response = self.logs_client.query_workspace(
            workspace_id=self.workspace_id,
            query=query,
            timespan=timedelta(minutes=duration_minutes)
        )

        for row in response.tables[0].rows:
            return {
                "total_requests": row[0],
                "errors": row[1],
                "error_rate": row[2]
            }

        return {"total_requests": 0, "errors": 0, "error_rate": 0}

    def compare_deployments(self, stable_name, canary_name):
        """Compare metrics between stable and canary"""
        stable_metrics = self.get_metrics(stable_name)
        canary_metrics = self.get_metrics(canary_name)

        stable_errors = self.get_error_rate(stable_name)
        canary_errors = self.get_error_rate(canary_name)

        comparison = {
            "stable": {**stable_metrics, **stable_errors},
            "canary": {**canary_metrics, **canary_errors},
            "differences": {}
        }

        for metric in stable_metrics:
            if stable_metrics[metric] > 0:
                diff = (canary_metrics.get(metric, 0) - stable_metrics[metric]) / stable_metrics[metric] * 100
                comparison["differences"][metric] = diff

        return comparison
```

## Automated Canary Progression

```python
class AutomatedCanaryRollout:
    def __init__(self, manager, monitor, thresholds):
        self.manager = manager
        self.monitor = monitor
        self.thresholds = thresholds  # e.g., {"error_rate": 5, "latency_increase": 20}

    def check_health(self):
        """Check if canary is healthy"""
        comparison = self.monitor.compare_deployments(
            self.manager.stable_name,
            self.manager.canary_name
        )

        issues = []

        # Check error rate
        if comparison["canary"]["error_rate"] > self.thresholds["error_rate"]:
            issues.append(f"Error rate too high: {comparison['canary']['error_rate']:.2f}%")

        # Check latency
        latency_diff = comparison["differences"].get("RequestLatencyP99", 0)
        if latency_diff > self.thresholds["latency_increase"]:
            issues.append(f"Latency increased by {latency_diff:.1f}%")

        return len(issues) == 0, issues

    def run_rollout(self, stages=[5, 25, 50, 75, 100], wait_minutes=15):
        """Run automated canary rollout"""
        for stage in stages:
            print(f"\n=== Stage: {stage}% canary traffic ===")
            self.manager.set_traffic(stage)

            # Wait for metrics to accumulate
            print(f"Waiting {wait_minutes} minutes for metrics...")
            time.sleep(wait_minutes * 60)

            # Check health
            healthy, issues = self.check_health()

            if not healthy:
                print(f"UNHEALTHY! Issues: {issues}")
                self.manager.rollback()
                return False, f"Rollback at {stage}%: {issues}"

            print(f"HEALTHY - proceeding to next stage")

        print("\nCanary rollout completed successfully!")
        return True, "Rollout complete"

# Configure thresholds
thresholds = {
    "error_rate": 5,  # Max 5% error rate
    "latency_increase": 20  # Max 20% latency increase
}

# Run automated rollout
rollout = AutomatedCanaryRollout(canary_manager, health_monitor, thresholds)
success, message = rollout.run_rollout(
    stages=[5, 25, 50, 100],
    wait_minutes=10
)
print(f"Rollout {'succeeded' if success else 'failed'}: {message}")
```

## Shadow Testing (Pre-Canary)

```python
class ShadowTester:
    """Run shadow traffic before canary deployment"""

    def __init__(self, stable_endpoint, shadow_endpoint):
        self.stable_endpoint = stable_endpoint
        self.shadow_endpoint = shadow_endpoint
        self.results = []

    async def shadow_request(self, request_data):
        """Send request to both endpoints and compare"""
        import aiohttp

        async with aiohttp.ClientSession() as session:
            # Send to stable (actual response)
            stable_response = await self._send_request(session, self.stable_endpoint, request_data)

            # Send to shadow (comparison only)
            shadow_response = await self._send_request(session, self.shadow_endpoint, request_data)

            # Compare
            comparison = self._compare_responses(stable_response, shadow_response)
            self.results.append(comparison)

            # Return stable response to user
            return stable_response

    def _compare_responses(self, stable, shadow):
        """Compare responses from stable and shadow"""
        return {
            "predictions_match": stable.get("predictions") == shadow.get("predictions"),
            "stable_latency": stable.get("latency"),
            "shadow_latency": shadow.get("latency"),
            "stable_predictions": stable.get("predictions"),
            "shadow_predictions": shadow.get("predictions")
        }

    def get_summary(self):
        """Get summary of shadow testing"""
        if not self.results:
            return None

        match_rate = sum(r["predictions_match"] for r in self.results) / len(self.results)
        avg_stable_latency = sum(r["stable_latency"] for r in self.results) / len(self.results)
        avg_shadow_latency = sum(r["shadow_latency"] for r in self.results) / len(self.results)

        return {
            "total_requests": len(self.results),
            "match_rate": match_rate,
            "avg_stable_latency": avg_stable_latency,
            "avg_shadow_latency": avg_shadow_latency
        }
```

Canary deployment provides a controlled, observable approach to rolling out new model versions with minimal risk.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
