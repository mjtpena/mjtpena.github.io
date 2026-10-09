---
title: "Custom Model Deployment on Azure: From Training to Production"
description: "Deploying custom AI models to production requires careful consideration of scalability, reliability, and cost. This guide covers the complete journey from…"
author: "Michael John Peña"
draft: false
date: 2024-03-12
tags: ["Azure", "Machine Learning", "MLOps", "Deployment", "AI"]
---

Deploying custom AI models to production requires careful consideration of scalability, reliability, and cost. This guide covers the complete journey from trained model to production endpoint.

## Deployment Options Overview

| Option | Best For | Scaling | Complexity |
|--------|----------|---------|------------|
| Managed Online Endpoints | Production ML models | Auto | Low |
| Azure Kubernetes Service | High customization | Manual/Auto | High |
| Azure Container Instances | Dev/Test | Manual | Low |
| Azure Functions | Lightweight models | Auto | Medium |

## Option 1: Managed Online Endpoints

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model,
    CodeConfiguration,
    Environment
)
from azure.identity import DefaultAzureCredential

# Initialize client
credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription",
    resource_group="your-rg",
    workspace_name="your-workspace"
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="custom-model-endpoint",
    description="Production endpoint for custom NLP model",
    auth_mode="key",
    tags={"environment": "production", "model": "custom-nlp-v1"}
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Register model
model = Model(
    path="./model/",
    name="custom-nlp-model",
    description="Custom NLP classification model",
    type="custom_model"
)
registered_model = ml_client.models.create_or_update(model)

# Create deployment
deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="custom-model-endpoint",
    model=registered_model,
    code_configuration=CodeConfiguration(
        code="./scoring/",
        scoring_script="score.py"
    ),
    environment=Environment(
        conda_file="./environment/conda.yml",
        image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest"
    ),
    instance_type="Standard_DS3_v2",
    instance_count=2
)

ml_client.online_deployments.begin_create_or_update(deployment).result()

# Set traffic
endpoint.traffic = {"blue": 100}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()
```

## Scoring Script

```python
# scoring/score.py
import os
import json
import logging
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

def init():
    """Initialize model and tokenizer"""
    global model, tokenizer

    model_path = os.path.join(
        os.getenv("AZUREML_MODEL_DIR"),
        "model"
    )

    model = AutoModelForSequenceClassification.from_pretrained(model_path)
    tokenizer = AutoTokenizer.from_pretrained(model_path)

    model.eval()
    logging.info("Model initialized successfully")

def run(raw_data):
    """Process inference request"""
    try:
        data = json.loads(raw_data)
        texts = data.get("texts", [])

        # Tokenize
        inputs = tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt"
        )

        # Inference
        with torch.no_grad():
            outputs = model(**inputs)
            predictions = torch.softmax(outputs.logits, dim=-1)

        # Format response
        results = []
        for i, text in enumerate(texts):
            results.append({
                "text": text,
                "predictions": predictions[i].tolist(),
                "predicted_class": predictions[i].argmax().item()
            })

        return json.dumps({"results": results})

    except Exception as e:
        logging.error(f"Error in inference: {str(e)}")
        return json.dumps({"error": str(e)})
```

## Option 2: Azure Kubernetes Service

```python
# For more control over infrastructure
from azure.ai.ml.entities import KubernetesOnlineEndpoint, KubernetesOnlineDeployment

# Attach AKS cluster first
from azure.ai.ml.entities import KubernetesCompute

aks_compute = KubernetesCompute(
    name="aks-cluster",
    resource_id="/subscriptions/.../resourceGroups/.../providers/Microsoft.ContainerService/managedClusters/your-aks"
)
ml_client.compute.begin_create_or_update(aks_compute).result()

# Create Kubernetes endpoint
k8s_endpoint = KubernetesOnlineEndpoint(
    name="custom-model-k8s",
    compute="aks-cluster",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(k8s_endpoint).result()

# Deploy
k8s_deployment = KubernetesOnlineDeployment(
    name="blue",
    endpoint_name="custom-model-k8s",
    model=registered_model,
    code_configuration=CodeConfiguration(
        code="./scoring/",
        scoring_script="score.py"
    ),
    environment=Environment(
        conda_file="./environment/conda.yml",
        image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest"
    ),
    resources={
        "requests": {"cpu": "2", "memory": "4Gi", "nvidia.com/gpu": "1"},
        "limits": {"cpu": "4", "memory": "8Gi", "nvidia.com/gpu": "1"}
    },
    scale_settings={
        "type": "target_utilization",
        "min_instances": 2,
        "max_instances": 10,
        "target_utilization_percentage": 70
    }
)
ml_client.online_deployments.begin_create_or_update(k8s_deployment).result()
```

## Option 3: Azure Functions for Lightweight Models

```python
# function_app.py
import azure.functions as func
import json
import pickle
import numpy as np

app = func.FunctionApp()

# Load model at cold start
with open("model.pkl", "rb") as f:
    model = pickle.load(f)

@app.route(route="predict", methods=["POST"])
def predict(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        features = np.array(data["features"])

        prediction = model.predict(features)
        probability = model.predict_proba(features)

        return func.HttpResponse(
            json.dumps({
                "prediction": prediction.tolist(),
                "probability": probability.tolist()
            }),
            mimetype="application/json"
        )
    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )
```

## Blue-Green Deployment Pattern

```python
def blue_green_deployment(
    ml_client: MLClient,
    endpoint_name: str,
    new_model: Model,
    traffic_percentage: int = 10
):
    """Implement blue-green deployment with gradual traffic shift"""

    # Get current endpoint
    endpoint = ml_client.online_endpoints.get(endpoint_name)

    # Create new deployment (green)
    green_deployment = ManagedOnlineDeployment(
        name="green",
        endpoint_name=endpoint_name,
        model=new_model,
        code_configuration=CodeConfiguration(
            code="./scoring/",
            scoring_script="score.py"
        ),
        environment=Environment(
            conda_file="./environment/conda.yml",
            image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest"
        ),
        instance_type="Standard_DS3_v2",
        instance_count=2
    )

    ml_client.online_deployments.begin_create_or_update(green_deployment).result()

    # Shift traffic gradually
    endpoint.traffic = {
        "blue": 100 - traffic_percentage,
        "green": traffic_percentage
    }
    ml_client.online_endpoints.begin_create_or_update(endpoint).result()

    return endpoint

# Usage
blue_green_deployment(ml_client, "custom-model-endpoint", new_model, 10)
```

## Monitoring and Scaling

```python
from azure.monitor.query import MetricsQueryClient
from datetime import timedelta

metrics_client = MetricsQueryClient(credential)

def get_endpoint_metrics(endpoint_name: str):
    """Get endpoint performance metrics"""
    response = metrics_client.query_resource(
        resource_uri=f"/subscriptions/.../providers/Microsoft.MachineLearningServices/workspaces/.../onlineEndpoints/{endpoint_name}",
        metric_names=["RequestLatency", "RequestsPerMinute", "CPUUtilization"],
        timespan=timedelta(hours=1)
    )

    for metric in response.metrics:
        print(f"{metric.name}: {metric.timeseries[0].data[-1].average}")

# Auto-scaling configuration
scaling_config = {
    "scale_type": "TargetUtilization",
    "min_instances": 2,
    "max_instances": 10,
    "target_utilization_percentage": 70,
    "polling_interval": 30,
    "cooldown_period": 300
}
```

## Conclusion

Azure provides multiple paths for deploying custom models. Choose Managed Online Endpoints for simplicity, AKS for control, or Azure Functions for lightweight scenarios. Always implement proper monitoring and gradual rollout strategies.
