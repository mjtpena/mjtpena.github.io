---
title: "Azure Machine Learning Managed Endpoints: Advanced Deployment Patterns"
author: Michael John Peña
draft: false
date: 2025-10-02
tags:
  - Azure Machine Learning
  - MLOps
  - Model Deployment
  - Kubernetes
  - Managed Endpoints

---

I wrote "Azure Machine Learning Managed Endpoints: Advanced Deployment Patterns" to share practical, production-minded guidance on this topic.

## Blue-Green Deployments with Traffic Splitting

Managed endpoints support traffic splitting across multiple deployments, enabling safe rollouts of new model versions:

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model,
    Environment,
    CodeConfiguration
)
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-subscription-id",
    resource_group_name="rg-mlops-prod",
    workspace_name="mlw-production"
)

# Create endpoint with traffic rules
endpoint = ManagedOnlineEndpoint(
    name="fraud-detection-endpoint",
    description="Production fraud detection with blue-green deployment",
    auth_mode="key",
    traffic={"blue-v1": 90, "green-v2": 10}  # 10% canary traffic
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Deploy new model version as green deployment
green_deployment = ManagedOnlineDeployment(
    name="green-v2",
    endpoint_name="fraud-detection-endpoint",
    model=Model(path="./models/fraud_model_v2"),
    environment=Environment(
        image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04",
        conda_file="./environment/conda.yml"
    ),
    instance_type="Standard_DS3_v2",
    instance_count=2,
    request_settings={
        "request_timeout_ms": 3000,
        "max_concurrent_requests_per_instance": 100
    }
)
```

## Implementing Gradual Traffic Shifting

Automate traffic shifting based on deployment health metrics:

```python
import time
from azure.monitor.query import MetricsQueryClient

def gradual_traffic_shift(
    ml_client: MLClient,
    metrics_client: MetricsQueryClient,
    endpoint_name: str,
    new_deployment: str,
    old_deployment: str,
    error_threshold: float = 0.01
):
    """Gradually shift traffic while monitoring error rates."""

    traffic_steps = [10, 25, 50, 75, 100]

    for target_traffic in traffic_steps:
        # Update traffic split
        endpoint = ml_client.online_endpoints.get(endpoint_name)
        endpoint.traffic = {
            new_deployment: target_traffic,
            old_deployment: 100 - target_traffic
        }
        ml_client.online_endpoints.begin_create_or_update(endpoint).result()

        # Wait and monitor
        time.sleep(300)  # 5 minute observation window

        error_rate = get_deployment_error_rate(
            metrics_client, endpoint_name, new_deployment
        )

        if error_rate > error_threshold:
            # Rollback on high error rate
            endpoint.traffic = {old_deployment: 100, new_deployment: 0}
            ml_client.online_endpoints.begin_create_or_update(endpoint)
            raise Exception(f"Rollback triggered: error rate {error_rate}")

        print(f"Traffic at {target_traffic}%, error rate: {error_rate:.4f}")
```

## Cost Optimization with Autoscaling

Configure autoscaling rules that balance responsiveness with cost for production deployments while maintaining service level objectives.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
