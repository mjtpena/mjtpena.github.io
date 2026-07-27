---
title: Deploying Machine Learning Models with Azure ML
author: Michael John Pena
draft: false
date: 2021-09-08
tags:
  - Azure
  - Machine Learning
  - Model Deployment
  - MLOps
  - REST API

---

I wrote "2021-09-08-azure-ml-model-deployment" to share practical, production-minded guidance on this topic.

## Deployment Options Overview

| Option | Use Case | Latency | Scale |
|--------|----------|---------|-------|
| Managed Online Endpoints | Real-time inference | Low | Auto-scaling |
| Kubernetes Endpoints | Enterprise/hybrid | Low | Custom |
| Batch Endpoints | Large-scale batch | N/A | High throughput |
| Azure Container Instances | Dev/test | Medium | Manual |

## Creating a Scoring Script

```python
# score.py
import os
import json
import logging
import joblib
import numpy as np

def init():
    """
    Initialize model when the container starts.
    Called once when the deployment is created.
    """
    global model
    logging.info("Initializing model...")

    # AZUREML_MODEL_DIR is set by Azure ML
    model_path = os.path.join(os.getenv('AZUREML_MODEL_DIR'), 'model.pkl')
    model = joblib.load(model_path)

    logging.info("Model loaded successfully")

def run(raw_data):
    """
    Process inference requests.
    Called for each prediction request.
    """
    try:
        # Parse input data
        data = json.loads(raw_data)

        # Handle both single and batch predictions
        if isinstance(data, dict):
            input_data = np.array([list(data.values())])
        else:
            input_data = np.array(data)

        # Make predictions
        predictions = model.predict(input_data)
        probabilities = model.predict_proba(input_data)

        # Return results
        return {
            "predictions": predictions.tolist(),
            "probabilities": probabilities.tolist()
        }

    except Exception as e:
        logging.error(f"Error during inference: {str(e)}")
        return {"error": str(e)}
```

## MLflow Model Scoring (No Custom Script)

```python
# For MLflow models, Azure ML can auto-generate the scoring script
# Just deploy the model directly

from azure.ai.ml.entities import ManagedOnlineEndpoint, ManagedOnlineDeployment

# Endpoint handles routing
endpoint = ManagedOnlineEndpoint(
    name="churn-predictor-endpoint",
    description="Customer churn prediction service",
    auth_mode="key"
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Deployment handles the model serving
deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="churn-predictor-endpoint",
    model="azureml:customer-churn-predictor:2",
    instance_type="Standard_DS3_v2",
    instance_count=1
)

ml_client.online_deployments.begin_create_or_update(deployment).result()
```

## Custom Environment for Deployment

```python
from azure.ai.ml.entities import Environment, BuildContext

# From conda specification
conda_env = """
name: inference-env
channels:
  - conda-forge
dependencies:
  - python=3.9
  - pip
  - pip:
    - scikit-learn==1.0.0
    - joblib==1.1.0
    - numpy==1.21.0
    - inference-schema
"""

# Create environment
env = Environment(
    name="sklearn-inference-env",
    description="Environment for sklearn model inference",
    conda_file="conda.yml",
    image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest"
)

ml_client.environments.create_or_update(env)
```

## Deployment with Custom Code

```python
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model,
    CodeConfiguration
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="fraud-detector-endpoint",
    description="Real-time fraud detection",
    auth_mode="key",
    tags={"team": "risk-analytics"}
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Create deployment with custom scoring script
deployment = ManagedOnlineDeployment(
    name="green",
    endpoint_name="fraud-detector-endpoint",
    model="azureml:fraud-detector:3",
    code_configuration=CodeConfiguration(
        code="./src/scoring",
        scoring_script="score.py"
    ),
    environment="azureml:sklearn-inference-env:1",
    instance_type="Standard_DS3_v2",
    instance_count=2,
    request_settings={
        "request_timeout_ms": 5000,
        "max_concurrent_requests_per_instance": 100
    },
    liveness_probe={
        "initial_delay": 30,
        "period": 10,
        "failure_threshold": 3
    },
    readiness_probe={
        "initial_delay": 10,
        "period": 10,
        "failure_threshold": 3
    }
)

ml_client.online_deployments.begin_create_or_update(deployment).result()

# Route all traffic to the new deployment
endpoint.traffic = {"green": 100}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()
```

## Testing Deployed Models

```python
import json
import urllib.request

# Get endpoint details
endpoint = ml_client.online_endpoints.get("fraud-detector-endpoint")
scoring_uri = endpoint.scoring_uri
api_key = ml_client.online_endpoints.get_keys("fraud-detector-endpoint").primary_key

# Prepare request
data = {
    "transaction_amount": 150.00,
    "merchant_category": "online_retail",
    "user_history_score": 0.85,
    "time_since_last_transaction": 120
}

body = json.dumps(data).encode('utf-8')

headers = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {api_key}'
}

req = urllib.request.Request(scoring_uri, body, headers)

with urllib.request.urlopen(req) as response:
    result = json.loads(response.read())
    print(f"Prediction: {result}")
```

## Using the Azure ML SDK for Inference

```python
# Simpler approach using the SDK
result = ml_client.online_endpoints.invoke(
    endpoint_name="fraud-detector-endpoint",
    request_file="./test-request.json"
)

print(result)
```

## Blue-Green Deployment Strategy

```python
# Create new deployment (green) alongside existing (blue)
green_deployment = ManagedOnlineDeployment(
    name="green",
    endpoint_name="fraud-detector-endpoint",
    model="azureml:fraud-detector:4",  # New model version
    environment="azureml:sklearn-inference-env:1",
    instance_type="Standard_DS3_v2",
    instance_count=2
)

ml_client.online_deployments.begin_create_or_update(green_deployment).result()

# Gradually shift traffic
endpoint = ml_client.online_endpoints.get("fraud-detector-endpoint")

# 10% to green for testing
endpoint.traffic = {"blue": 90, "green": 10}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# After validation, shift more traffic
endpoint.traffic = {"blue": 50, "green": 50}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Complete migration
endpoint.traffic = {"blue": 0, "green": 100}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Delete old deployment
ml_client.online_deployments.begin_delete(
    name="blue",
    endpoint_name="fraud-detector-endpoint"
).result()
```

## Monitoring Deployments

```python
# Get deployment logs
logs = ml_client.online_deployments.get_logs(
    name="green",
    endpoint_name="fraud-detector-endpoint",
    lines=100
)
print(logs)

# Deployment metrics are available in Azure Monitor
# Query via Azure CLI or portal
```

## Best Practices

1. **Use MLflow models**: Simplifies deployment with auto-generated scoring
2. **Implement health probes**: Ensure reliable service discovery
3. **Set request timeouts**: Protect against slow requests
4. **Use blue-green deployments**: Zero-downtime updates
5. **Monitor inference latency**: Set up alerts for performance degradation
6. **Scale appropriately**: Use auto-scaling rules based on traffic

Model deployment is where your ML work delivers business value. Azure ML's managed endpoints make it straightforward to deploy, scale, and update models in production.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
