---
title: "Azure Machine Learning Updates and New Features"
description: "Azure Machine Learning SDK v2 provides a cleaner, more intuitive API for the complete ML lifecycle."
author: "Michael John Peña"
draft: false
date: 2022-08-01
tags: ["Azure", "Machine Learning", "Azure ML", "AI", "MLOps"]
---

## What's New in Azure ML

The latest updates focus on:
- Improved MLOps capabilities
- Enhanced responsible AI tools
- Simplified deployment options
- Better integration with open-source tools

## Getting Started with Azure ML SDK v2

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

# Connect to workspace
ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription-id",
    resource_group_name="your-resource-group",
    workspace_name="your-workspace"
)

# List compute instances
for compute in ml_client.compute.list():
    print(f"{compute.name}: {compute.type} - {compute.provisioning_state}")
```

## Creating Environments

```python
from azure.ai.ml.entities import Environment

# Create a custom environment
custom_env = Environment(
    name="sklearn-training-env",
    description="Environment for scikit-learn training",
    conda_file="./conda.yaml",
    image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest"
)

ml_client.environments.create_or_update(custom_env)
```

conda.yaml:
```yaml
name: sklearn-training
channels:
  - conda-forge
dependencies:
  - python=3.9
  - pip
  - pip:
    - scikit-learn==1.1.1
    - pandas==1.4.3
    - numpy==1.23.0
    - mlflow==1.27.0
    - azureml-mlflow==1.43.0
```

## Registering Data Assets

```python
from azure.ai.ml.entities import Data
from azure.ai.ml.constants import AssetTypes

# Register a data asset
training_data = Data(
    name="customer-churn-data",
    description="Customer churn training dataset",
    path="azureml://datastores/workspaceblobstore/paths/data/churn.csv",
    type=AssetTypes.URI_FILE
)

ml_client.data.create_or_update(training_data)

# Register a folder of data
image_data = Data(
    name="product-images",
    description="Product image dataset",
    path="azureml://datastores/workspaceblobstore/paths/images/",
    type=AssetTypes.URI_FOLDER
)

ml_client.data.create_or_update(image_data)
```

## Training Jobs with SDK v2

```python
from azure.ai.ml import command, Input

# Define a training job
training_job = command(
    code="./src",
    command="python train.py --data ${{inputs.training_data}} --learning-rate ${{inputs.learning_rate}}",
    inputs={
        "training_data": Input(
            type="uri_file",
            path="azureml://datastores/workspaceblobstore/paths/data/train.csv"
        ),
        "learning_rate": 0.01
    },
    environment="sklearn-training-env@latest",
    compute="cpu-cluster",
    display_name="churn-training",
    experiment_name="customer-churn",
    description="Training job for customer churn prediction"
)

# Submit the job
returned_job = ml_client.jobs.create_or_update(training_job)
print(f"Job submitted: {returned_job.name}")

# Wait for completion
ml_client.jobs.stream(returned_job.name)
```

## Model Registration

```python
from azure.ai.ml.entities import Model
from azure.ai.ml.constants import AssetTypes

# Register model from job output
model = Model(
    name="churn-predictor",
    description="Customer churn prediction model",
    path=f"azureml://jobs/{returned_job.name}/outputs/model",
    type=AssetTypes.MLFLOW_MODEL
)

ml_client.models.create_or_update(model)

# List model versions
for m in ml_client.models.list(name="churn-predictor"):
    print(f"Version {m.version}: {m.description}")
```

## Managed Online Endpoints

```python
from azure.ai.ml.entities import ManagedOnlineEndpoint, ManagedOnlineDeployment

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="churn-endpoint",
    description="Endpoint for churn prediction",
    auth_mode="key"
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Create deployment
deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="churn-endpoint",
    model="azureml:churn-predictor:1",
    instance_type="Standard_DS2_v2",
    instance_count=1
)

ml_client.online_deployments.begin_create_or_update(deployment).result()

# Test the endpoint
result = ml_client.online_endpoints.invoke(
    endpoint_name="churn-endpoint",
    request_file="./sample-request.json"
)
print(result)
```

## Enhanced Experiment Tracking

```python
import mlflow

# Start MLflow run
mlflow.set_experiment("customer-churn")

with mlflow.start_run():
    # Log parameters
    mlflow.log_param("algorithm", "RandomForest")
    mlflow.log_param("n_estimators", 100)

    # Train model
    model = train_model(X_train, y_train)

    # Log metrics
    accuracy = model.score(X_test, y_test)
    mlflow.log_metric("accuracy", accuracy)
    mlflow.log_metric("f1_score", f1)

    # Log artifacts
    mlflow.log_artifact("confusion_matrix.png")

    # Log model
    mlflow.sklearn.log_model(model, "model")
```

Azure Machine Learning SDK v2 provides a cleaner, more intuitive API for the complete ML lifecycle.
