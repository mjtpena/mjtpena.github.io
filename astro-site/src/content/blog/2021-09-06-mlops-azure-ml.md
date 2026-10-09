---
title: MLOps Best Practices with Azure Machine Learning
description: "MLOps transforms ML from an experimental practice to a reliable engineering discipline. Azure ML provides the tools to implement these practices at scale."
author: Michael John Pena
draft: false
date: 2021-09-06
tags:
  - Azure
  - Machine Learning
  - MLOps
  - DevOps
  - CI/CD
---

## The MLOps Lifecycle

```
+------------+     +----------+     +----------+     +-----------+     +----------+
|   Data     | --> | Feature  | --> |  Model   | --> |   Model   | --> | Monitor  |
| Collection |     | Engineer |     | Training |     |  Deploy   |     | & Retrain|
+------------+     +----------+     +----------+     +-----------+     +----------+
      ^                                                                      |
      +----------------------------------------------------------------------+
                              Continuous Feedback Loop
```

## Setting Up CI/CD for ML

### GitHub Actions Workflow

```yaml
# .github/workflows/ml-pipeline.yml
name: ML Training Pipeline

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'data/**'
  workflow_dispatch:

env:
  AZURE_CREDENTIALS: ${{ secrets.AZURE_CREDENTIALS }}
  RESOURCE_GROUP: ml-production-rg
  WORKSPACE_NAME: ml-production-workspace

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest flake8

      - name: Lint code
        run: flake8 src/ --max-line-length=100

      - name: Run unit tests
        run: pytest tests/unit -v

  train:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ env.AZURE_CREDENTIALS }}

      - name: Install Azure ML CLI
        run: |
          az extension add -n ml

      - name: Submit Training Job
        run: |
          az ml job create \
            --file jobs/training-job.yml \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --workspace-name ${{ env.WORKSPACE_NAME }} \
            --stream

  register:
    needs: train
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ env.AZURE_CREDENTIALS }}

      - name: Register Model
        run: |
          az ml model create \
            --file models/model-registration.yml \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --workspace-name ${{ env.WORKSPACE_NAME }}

  deploy:
    needs: register
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ env.AZURE_CREDENTIALS }}

      - name: Deploy to Managed Endpoint
        run: |
          az ml online-deployment create \
            --file deployments/blue-deployment.yml \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --workspace-name ${{ env.WORKSPACE_NAME }} \
            --all-traffic
```

## Azure ML Pipeline Definition

```python
# pipeline.py
from azure.ai.ml import MLClient, Input, Output
from azure.ai.ml.dsl import pipeline
from azure.ai.ml import command
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="ml-production-rg",
    workspace_name="ml-production-workspace"
)

# Define pipeline components
@command(
    inputs={"raw_data": Input(type="uri_folder")},
    outputs={"processed_data": Output(type="uri_folder")},
    code="./src/preprocess",
    command="python preprocess.py --input ${{inputs.raw_data}} --output ${{outputs.processed_data}}",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    compute="cpu-cluster"
)
def preprocess_data():
    pass

@command(
    inputs={
        "training_data": Input(type="uri_folder"),
        "hyperparameters": Input(type="uri_file")
    },
    outputs={"model": Output(type="mlflow_model")},
    code="./src/train",
    command="python train.py --data ${{inputs.training_data}} --params ${{inputs.hyperparameters}} --output ${{outputs.model}}",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    compute="gpu-cluster"
)
def train_model():
    pass

@command(
    inputs={
        "model": Input(type="mlflow_model"),
        "test_data": Input(type="uri_folder")
    },
    outputs={"metrics": Output(type="uri_file")},
    code="./src/evaluate",
    command="python evaluate.py --model ${{inputs.model}} --data ${{inputs.test_data}} --output ${{outputs.metrics}}",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    compute="cpu-cluster"
)
def evaluate_model():
    pass

# Define the pipeline
@pipeline(
    description="End-to-end ML training pipeline",
    default_compute="cpu-cluster"
)
def ml_training_pipeline(raw_data: Input, hyperparams: Input):
    preprocess_step = preprocess_data(raw_data=raw_data)

    train_step = train_model(
        training_data=preprocess_step.outputs.processed_data,
        hyperparameters=hyperparams
    )

    evaluate_step = evaluate_model(
        model=train_step.outputs.model,
        test_data=preprocess_step.outputs.processed_data
    )

    return {
        "trained_model": train_step.outputs.model,
        "evaluation_metrics": evaluate_step.outputs.metrics
    }

# Submit pipeline
pipeline_job = ml_training_pipeline(
    raw_data=Input(type="uri_folder", path="azureml:raw-training-data:1"),
    hyperparams=Input(type="uri_file", path="azureml:hyperparameters:1")
)

submitted_job = ml_client.jobs.create_or_update(
    pipeline_job,
    experiment_name="mlops-training-pipeline"
)
print(f"Pipeline submitted: {submitted_job.name}")
```

## Model Validation Gates

```python
# evaluate.py
import json
import argparse
import mlflow
import pandas as pd
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

def evaluate_model(model_path: str, test_data_path: str) -> dict:
    """Evaluate model and return metrics"""
    # Load model
    model = mlflow.sklearn.load_model(model_path)

    # Load test data
    test_df = pd.read_parquet(test_data_path)
    X_test = test_df.drop('target', axis=1)
    y_test = test_df['target']

    # Predict
    y_pred = model.predict(X_test)

    # Calculate metrics
    metrics = {
        'accuracy': accuracy_score(y_test, y_pred),
        'precision': precision_score(y_test, y_pred, average='weighted'),
        'recall': recall_score(y_test, y_pred, average='weighted'),
        'f1': f1_score(y_test, y_pred, average='weighted')
    }

    return metrics

def validate_model(metrics: dict, thresholds: dict) -> bool:
    """Check if model meets quality thresholds"""
    for metric, threshold in thresholds.items():
        if metrics.get(metric, 0) < threshold:
            print(f"FAILED: {metric} = {metrics[metric]:.4f} < {threshold}")
            return False
        print(f"PASSED: {metric} = {metrics[metric]:.4f} >= {threshold}")
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    # Evaluation thresholds
    thresholds = {
        'accuracy': 0.85,
        'precision': 0.80,
        'recall': 0.80,
        'f1': 0.82
    }

    # Evaluate
    metrics = evaluate_model(args.model, args.data)

    # Validate
    passed = validate_model(metrics, thresholds)
    metrics['validation_passed'] = passed

    # Save metrics
    with open(args.output, 'w') as f:
        json.dump(metrics, f)

    if not passed:
        raise ValueError("Model did not meet quality thresholds")

if __name__ == "__main__":
    main()
```

## Infrastructure as Code with Terraform

```hcl
# main.tf
provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "ml" {
  name     = "ml-production-rg"
  location = "eastus"
}

resource "azurerm_application_insights" "ml" {
  name                = "ml-appinsights"
  location            = azurerm_resource_group.ml.location
  resource_group_name = azurerm_resource_group.ml.name
  application_type    = "web"
}

resource "azurerm_key_vault" "ml" {
  name                = "ml-keyvault"
  location            = azurerm_resource_group.ml.location
  resource_group_name = azurerm_resource_group.ml.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"
}

resource "azurerm_storage_account" "ml" {
  name                     = "mlprodstorage"
  location                 = azurerm_resource_group.ml.location
  resource_group_name      = azurerm_resource_group.ml.name
  account_tier             = "Standard"
  account_replication_type = "GRS"
}

resource "azurerm_machine_learning_workspace" "ml" {
  name                    = "ml-production-workspace"
  location                = azurerm_resource_group.ml.location
  resource_group_name     = azurerm_resource_group.ml.name
  application_insights_id = azurerm_application_insights.ml.id
  key_vault_id            = azurerm_key_vault.ml.id
  storage_account_id      = azurerm_storage_account.ml.id

  identity {
    type = "SystemAssigned"
  }
}
```

## Key MLOps Practices

1. **Version Everything**: Code, data, models, and configurations
2. **Automate Testing**: Unit tests, integration tests, model validation
3. **Continuous Training**: Retrain on new data automatically
4. **Model Monitoring**: Track drift and performance degradation
5. **Rollback Strategy**: Blue-green deployments for safe updates

MLOps transforms ML from an experimental practice to a reliable engineering discipline. Azure ML provides the tools to implement these practices at scale.
