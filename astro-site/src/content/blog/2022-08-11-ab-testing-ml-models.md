---
title: "A/B Testing for ML Models in Production"
description: "A/B testing provides statistical evidence for model selection based on actual business outcomes."
author: "Michael John Peña"
draft: false
date: 2022-08-11
tags: ["Azure", "Machine Learning", "A/B Testing", "MLOps", "Experimentation"]
---

## A/B Testing vs Canary Deployment

| Aspect | A/B Testing | Canary Deployment |
|--------|-------------|-------------------|
| Goal | Compare effectiveness | Validate stability |
| Duration | Weeks | Hours to days |
| Metrics | Business KPIs | Error rates, latency |
| Traffic split | Fixed (e.g., 50/50) | Gradual increase |

## Setting Up A/B Testing

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import ManagedOnlineEndpoint, ManagedOnlineDeployment
from azure.identity import DefaultAzureCredential
import uuid

ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Deploy Model A (control)
model_a_deployment = ManagedOnlineDeployment(
    name="model-a",
    endpoint_name="ab-test-endpoint",
    model="azureml:recommendation-model:1",
    instance_type="Standard_DS2_v2",
    instance_count=2
)

# Deploy Model B (treatment)
model_b_deployment = ManagedOnlineDeployment(
    name="model-b",
    endpoint_name="ab-test-endpoint",
    model="azureml:recommendation-model:2",
    instance_type="Standard_DS2_v2",
    instance_count=2
)

ml_client.online_deployments.begin_create_or_update(model_a_deployment).result()
ml_client.online_deployments.begin_create_or_update(model_b_deployment).result()

# Set 50/50 traffic split
endpoint = ml_client.online_endpoints.get("ab-test-endpoint")
endpoint.traffic = {"model-a": 50, "model-b": 50}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()
```

## User Assignment and Tracking

```python
import hashlib
from typing import Tuple

class ABTestAssigner:
    """Consistently assign users to experiment variants"""

    def __init__(self, experiment_name: str, variants: dict):
        """
        variants: {"model-a": 50, "model-b": 50} - percentages
        """
        self.experiment_name = experiment_name
        self.variants = variants
        self._build_ranges()

    def _build_ranges(self):
        """Build percentage ranges for variant assignment"""
        self.ranges = []
        cumulative = 0
        for variant, percentage in self.variants.items():
            self.ranges.append((cumulative, cumulative + percentage, variant))
            cumulative += percentage

    def assign(self, user_id: str) -> str:
        """Assign user to a variant deterministically"""
        # Create hash of user_id + experiment_name for consistent assignment
        hash_input = f"{user_id}:{self.experiment_name}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16)
        bucket = hash_value % 100

        for low, high, variant in self.ranges:
            if low <= bucket < high:
                return variant

        return self.ranges[0][2]  # Default to first variant

    def get_assignment_with_tracking(self, user_id: str) -> Tuple[str, dict]:
        """Get assignment with tracking metadata"""
        variant = self.assign(user_id)
        tracking_data = {
            "experiment_name": self.experiment_name,
            "user_id": user_id,
            "variant": variant,
            "assignment_time": datetime.utcnow().isoformat()
        }
        return variant, tracking_data

# Usage
assigner = ABTestAssigner("recommendation-v2", {"model-a": 50, "model-b": 50})

# Same user always gets same variant
print(assigner.assign("user123"))  # Always returns same variant
print(assigner.assign("user123"))  # Same result
```

## Calling the Right Model

```python
import requests
import json

class ABTestClient:
    def __init__(self, endpoint_uri, api_key, assigner):
        self.endpoint_uri = endpoint_uri
        self.api_key = api_key
        self.assigner = assigner

    def predict(self, user_id: str, features: dict) -> dict:
        """Get prediction from assigned model variant"""
        variant, tracking = self.assigner.get_assignment_with_tracking(user_id)

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "azureml-model-deployment": variant  # Route to specific deployment
        }

        response = requests.post(
            self.endpoint_uri,
            data=json.dumps(features),
            headers=headers
        )

        result = response.json()
        result["_ab_test"] = tracking

        # Log for analysis
        self._log_prediction(tracking, features, result)

        return result

    def _log_prediction(self, tracking, features, result):
        """Log prediction for later analysis"""
        log_entry = {
            **tracking,
            "features": features,
            "prediction": result.get("predictions"),
            "timestamp": datetime.utcnow().isoformat()
        }
        # Send to logging service (Event Hub, Application Insights, etc.)
        print(f"Logged: {log_entry}")

# Usage
client = ABTestClient(endpoint_uri, api_key, assigner)
result = client.predict("user123", {"product_history": [1, 2, 3]})
print(f"Variant: {result['_ab_test']['variant']}")
print(f"Predictions: {result['predictions']}")
```

## Tracking Business Metrics

```python
from azure.eventhub import EventHubProducerClient
import json

class ABTestMetricsTracker:
    def __init__(self, eventhub_connection_string, eventhub_name):
        self.producer = EventHubProducerClient.from_connection_string(
            eventhub_connection_string,
            eventhub_name=eventhub_name
        )

    def track_event(self, user_id: str, event_type: str, event_data: dict):
        """Track a business event for A/B analysis"""
        event = {
            "user_id": user_id,
            "event_type": event_type,
            "event_data": event_data,
            "timestamp": datetime.utcnow().isoformat()
        }

        event_data_batch = self.producer.create_batch()
        event_data_batch.add(EventData(json.dumps(event)))
        self.producer.send_batch(event_data_batch)

    def track_conversion(self, user_id: str, variant: str, conversion_value: float):
        """Track a conversion event"""
        self.track_event(user_id, "conversion", {
            "variant": variant,
            "value": conversion_value
        })

    def track_click(self, user_id: str, variant: str, item_id: str, position: int):
        """Track a click event"""
        self.track_event(user_id, "click", {
            "variant": variant,
            "item_id": item_id,
            "position": position
        })

# Usage
tracker = ABTestMetricsTracker(connection_string, "ab-test-events")

# When user clicks a recommendation
tracker.track_click("user123", "model-b", "product-456", position=2)

# When user converts
tracker.track_conversion("user123", "model-b", 99.99)
```

## Statistical Analysis

```python
import scipy.stats as stats
import numpy as np
from typing import Dict

class ABTestAnalyzer:
    def __init__(self, control_data: list, treatment_data: list):
        self.control = np.array(control_data)
        self.treatment = np.array(treatment_data)

    def calculate_statistics(self) -> Dict:
        """Calculate basic statistics for both groups"""
        return {
            "control": {
                "n": len(self.control),
                "mean": np.mean(self.control),
                "std": np.std(self.control),
                "sum": np.sum(self.control)
            },
            "treatment": {
                "n": len(self.treatment),
                "mean": np.mean(self.treatment),
                "std": np.std(self.treatment),
                "sum": np.sum(self.treatment)
            }
        }

    def t_test(self) -> Dict:
        """Perform two-sample t-test"""
        statistic, p_value = stats.ttest_ind(self.control, self.treatment)

        return {
            "statistic": statistic,
            "p_value": p_value,
            "significant_at_95": p_value < 0.05,
            "significant_at_99": p_value < 0.01
        }

    def calculate_lift(self) -> float:
        """Calculate lift (relative improvement)"""
        control_mean = np.mean(self.control)
        treatment_mean = np.mean(self.treatment)

        if control_mean == 0:
            return float('inf')

        return (treatment_mean - control_mean) / control_mean * 100

    def confidence_interval(self, confidence=0.95) -> Dict:
        """Calculate confidence interval for the difference"""
        diff = np.mean(self.treatment) - np.mean(self.control)
        se = np.sqrt(
            np.var(self.treatment) / len(self.treatment) +
            np.var(self.control) / len(self.control)
        )

        z = stats.norm.ppf((1 + confidence) / 2)
        ci_low = diff - z * se
        ci_high = diff + z * se

        return {
            "difference": diff,
            "ci_low": ci_low,
            "ci_high": ci_high,
            "confidence": confidence
        }

    def full_analysis(self) -> Dict:
        """Run full A/B test analysis"""
        stats_result = self.calculate_statistics()
        t_test_result = self.t_test()
        lift = self.calculate_lift()
        ci = self.confidence_interval()

        return {
            "statistics": stats_result,
            "t_test": t_test_result,
            "lift_percent": lift,
            "confidence_interval": ci,
            "recommendation": self._get_recommendation(t_test_result, lift)
        }

    def _get_recommendation(self, t_test_result, lift):
        """Generate recommendation based on results"""
        if not t_test_result["significant_at_95"]:
            return "CONTINUE - Not yet statistically significant"
        elif lift > 0:
            return f"ADOPT TREATMENT - {lift:.1f}% improvement (p < 0.05)"
        else:
            return f"KEEP CONTROL - Treatment is {abs(lift):.1f}% worse (p < 0.05)"

# Example analysis
control_conversions = [0, 1, 0, 0, 1, 0, 1, 1, 0, 0]  # Model A
treatment_conversions = [1, 1, 0, 1, 1, 0, 1, 1, 1, 0]  # Model B

analyzer = ABTestAnalyzer(control_conversions, treatment_conversions)
results = analyzer.full_analysis()

print(f"Lift: {results['lift_percent']:.1f}%")
print(f"P-value: {results['t_test']['p_value']:.4f}")
print(f"Recommendation: {results['recommendation']}")
```

A/B testing provides statistical evidence for model selection based on actual business outcomes.
