---
title: "Building Production MLOps Pipelines with Azure Machine Learning"
author: Michael John Peña
draft: false
date: 2025-08-09
tags:
  - MLOps
  - Azure Machine Learning
  - CI/CD
  - Model Deployment
  - Python

---

I wrote "Building Production MLOps Pipelines with Azure Machine Learning" to share practical, production-minded guidance on this topic.

## Defining a Training Pipeline

```python
from azure.ai.ml import MLClient, command, Input, Output
from azure.ai.ml.entities import Environment, BuildContext
from azure.identity import DefaultAzureCredential

# Connect to workspace
ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription-id",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Define training component
training_component = command(
    name="train_model",
    display_name="Train Classification Model",
    inputs={
        "training_data": Input(type="uri_folder"),
        "learning_rate": Input(type="number", default=0.01),
        "epochs": Input(type="integer", default=10)
    },
    outputs={
        "model_output": Output(type="uri_folder")
    },
    code="./src",
    command="python train.py --data ${{inputs.training_data}} --lr ${{inputs.learning_rate}} --epochs ${{inputs.epochs}} --output ${{outputs.model_output}}",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu:1"
)

# Submit training job
job = ml_client.jobs.create_or_update(
    command(
        experiment_name="fraud-detection",
        compute="gpu-cluster",
        inputs={
            "training_data": Input(
                path="azureml://datastores/training/paths/fraud_data/"
            )
        },
        **training_component
    )
)
```

## Model Registration and Deployment

```python
from azure.ai.ml.entities import Model, ManagedOnlineEndpoint, ManagedOnlineDeployment

# Register the trained model
model = ml_client.models.create_or_update(
    Model(
        path=f"azureml://jobs/{job.name}/outputs/model_output",
        name="fraud-detection-model",
        type="mlflow_model"
    )
)

# Create endpoint and deploy
endpoint = ManagedOnlineEndpoint(name="fraud-detection-endpoint")
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name=endpoint.name,
    model=model,
    instance_type="Standard_DS3_v2",
    instance_count=2
)
ml_client.online_deployments.begin_create_or_update(deployment).result()
```

Automated pipelines ensure reproducibility, enable A/B testing, and provide audit trails for model governance.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
