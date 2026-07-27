---
title: "Azure ML Managed Online Endpoints for Model Deployment"
author: "Michael John Peña"
draft: false
date: 2022-08-08
tags: ["Azure", "Machine Learning", "Deployment", "MLOps", "Endpoints"]

---

I wrote "Azure ML Managed Online Endpoints for Model Deployment" to share practical, production-minded guidance on this topic.

## Creating a Managed Online Endpoint

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

# Connect to workspace
ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="churn-prediction-endpoint",
    description="Endpoint for customer churn prediction",
    auth_mode="key"  # or "aml_token"
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()
print(f"Endpoint {endpoint.name} created")
```

## Deploying a Model

```python
# Register the model
model = Model(
    path="./model",
    name="churn-model",
    description="XGBoost churn prediction model"
)
registered_model = ml_client.models.create_or_update(model)

# Create environment
env = Environment(
    name="churn-inference-env",
    conda_file="./conda.yaml",
    image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest"
)

# Create deployment
deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="churn-prediction-endpoint",
    model=registered_model,
    environment=env,
    code_configuration=CodeConfiguration(
        code="./src",
        scoring_script="score.py"
    ),
    instance_type="Standard_DS2_v2",
    instance_count=1
)

ml_client.online_deployments.begin_create_or_update(deployment).result()

# Set traffic to the deployment
endpoint.traffic = {"blue": 100}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()
```

## Scoring Script

```python
# score.py
import os
import json
import joblib
import pandas as pd

def init():
    """Initialize the model"""
    global model
    model_path = os.path.join(os.getenv("AZUREML_MODEL_DIR"), "model.pkl")
    model = joblib.load(model_path)

def run(raw_data):
    """Run inference"""
    try:
        data = json.loads(raw_data)
        df = pd.DataFrame(data)

        # Make predictions
        predictions = model.predict(df)
        probabilities = model.predict_proba(df)

        result = {
            "predictions": predictions.tolist(),
            "probabilities": probabilities.tolist()
        }

        return json.dumps(result)

    except Exception as e:
        return json.dumps({"error": str(e)})
```

## Testing the Endpoint

```python
import requests
import json

# Get endpoint details
endpoint = ml_client.online_endpoints.get("churn-prediction-endpoint")
scoring_uri = endpoint.scoring_uri
api_key = ml_client.online_endpoints.get_keys("churn-prediction-endpoint").primary_key

# Prepare test data
test_data = {
    "data": [
        {
            "tenure": 12,
            "monthly_charges": 50.0,
            "contract_type": "month-to-month",
            "payment_method": "credit_card"
        }
    ]
}

# Make request
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}"
}

response = requests.post(
    scoring_uri,
    data=json.dumps(test_data),
    headers=headers
)

print(f"Status: {response.status_code}")
print(f"Response: {response.json()}")
```

## Scaling Configuration

```python
# Update deployment with autoscaling
from azure.ai.ml.entities import OnlineRequestSettings, ProbeSettings

deployment_with_scaling = ManagedOnlineDeployment(
    name="blue-scaled",
    endpoint_name="churn-prediction-endpoint",
    model=registered_model,
    environment=env,
    code_configuration=CodeConfiguration(
        code="./src",
        scoring_script="score.py"
    ),
    instance_type="Standard_DS3_v2",
    instance_count=2,
    request_settings=OnlineRequestSettings(
        request_timeout_ms=90000,
        max_concurrent_requests_per_instance=10,
        max_queue_wait_ms=60000
    ),
    liveness_probe=ProbeSettings(
        initial_delay=30,
        period=10,
        timeout=2,
        failure_threshold=3
    ),
    readiness_probe=ProbeSettings(
        initial_delay=10,
        period=10,
        timeout=2,
        failure_threshold=30
    )
)

ml_client.online_deployments.begin_create_or_update(deployment_with_scaling).result()
```

## Monitoring and Logging

```python
# Get deployment logs
logs = ml_client.online_deployments.get_logs(
    name="blue",
    endpoint_name="churn-prediction-endpoint",
    lines=100
)
print(logs)

# Enable Application Insights
endpoint_with_insights = ManagedOnlineEndpoint(
    name="churn-prediction-endpoint",
    description="Endpoint with monitoring",
    auth_mode="key",
    properties={
        "azureml.observability.enableAppInsights": "true"
    }
)

ml_client.online_endpoints.begin_create_or_update(endpoint_with_insights).result()
```

## Querying Metrics

```python
from azure.monitor.query import MetricsQueryClient
from azure.identity import DefaultAzureCredential
from datetime import timedelta

metrics_client = MetricsQueryClient(DefaultAzureCredential())

# Query endpoint metrics
response = metrics_client.query_resource(
    resource_uri=f"/subscriptions/.../resourceGroups/.../providers/Microsoft.MachineLearningServices/workspaces/.../onlineEndpoints/churn-prediction-endpoint",
    metric_names=["RequestsPerMinute", "RequestLatency", "DeploymentCapacity"],
    timespan=timedelta(hours=24)
)

for metric in response.metrics:
    print(f"{metric.name}:")
    for ts in metric.timeseries:
        for dp in ts.data:
            print(f"  {dp.time_stamp}: {dp.average}")
```

## Cleanup

```python
# Delete deployment
ml_client.online_deployments.begin_delete(
    name="blue",
    endpoint_name="churn-prediction-endpoint"
).result()

# Delete endpoint
ml_client.online_endpoints.begin_delete(
    name="churn-prediction-endpoint"
).result()
```

Managed online endpoints simplify model deployment while providing enterprise-grade reliability and scalability.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
