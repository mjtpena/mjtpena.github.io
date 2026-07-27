---
title: "Azure Machine Learning Managed Endpoints: Deploying Models with Zero Downtime"
author: Michael John Peña
draft: false
date: 2025-07-17
tags:
  - Azure Machine Learning
  - MLOps
  - Model Deployment
  - Blue-Green Deployment
  - Python

---

I wrote "Azure Machine Learning Managed Endpoints: Deploying Models with Zero Downtime" to share practical, production-minded guidance on this topic.

## Creating Managed Endpoints

Set up an endpoint that supports multiple model versions:

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
    subscription_id="your-sub",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create the endpoint
endpoint = ManagedOnlineEndpoint(
    name="fraud-detection-endpoint",
    description="Real-time fraud detection model",
    auth_mode="key",
    tags={"team": "risk-analytics", "env": "production"}
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Create initial deployment
blue_deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="fraud-detection-endpoint",
    model=Model(path="./models/fraud_model_v1"),
    environment=Environment(
        image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04",
        conda_file="./environments/inference_env.yml"
    ),
    code_configuration=CodeConfiguration(
        code="./src",
        scoring_script="score.py"
    ),
    instance_type="Standard_DS3_v2",
    instance_count=3,
    request_settings={
        "request_timeout_ms": 3000,
        "max_concurrent_requests_per_instance": 100
    },
    liveness_probe={"initial_delay": 30, "period": 10},
    readiness_probe={"initial_delay": 30, "period": 10}
)

ml_client.online_deployments.begin_create_or_update(blue_deployment).result()
```

## Blue-Green Deployment Pattern

Deploy new versions without downtime using traffic splitting:

```python
# Deploy new version as green
green_deployment = ManagedOnlineDeployment(
    name="green",
    endpoint_name="fraud-detection-endpoint",
    model=Model(path="./models/fraud_model_v2"),
    # ... same configuration
)

ml_client.online_deployments.begin_create_or_update(green_deployment).result()

# Gradually shift traffic
endpoint.traffic = {"blue": 90, "green": 10}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Monitor metrics, then complete rollout
endpoint.traffic = {"blue": 0, "green": 100}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Clean up old deployment
ml_client.online_deployments.begin_delete(
    name="blue",
    endpoint_name="fraud-detection-endpoint"
).result()
```

## Monitoring and Rollback

Configure Azure Monitor alerts on latency and error rates. Implement automatic rollback triggers when thresholds are breached.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
