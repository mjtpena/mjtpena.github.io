---
title: "End-to-End MLOps with Azure Machine Learning and GitHub Actions"
description: "Implement approval gates before production deployment. Track model lineage, performance metrics, and data dependencies for full auditability."
author: Michael John Peña
draft: false
date: 2025-07-31
tags:
  - MLOps
  - Azure Machine Learning
  - GitHub Actions
  - CI/CD
  - Model Registry
---

## Pipeline Architecture

Define your ML pipeline as code for reproducibility:

```python
# training_pipeline.py
from azure.ai.ml import MLClient, command, Input, Output
from azure.ai.ml.dsl import pipeline
from azure.ai.ml.entities import Environment

ml_client = MLClient.from_config()

# Define training component
@command(
    display_name="Train Model",
    environment=Environment(
        image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest",
        conda_file="./environments/training.yml"
    )
)
def train_model(
    training_data: Input,
    model_output: Output,
    learning_rate: float = 0.001,
    epochs: int = 10
):
    return f"""
    python train.py \
        --data ${{inputs.training_data}} \
        --output ${{outputs.model_output}} \
        --lr {learning_rate} \
        --epochs {epochs}
    """

# Define evaluation component
@command(display_name="Evaluate Model")
def evaluate_model(
    model_input: Input,
    test_data: Input,
    metrics_output: Output
):
    return """
    python evaluate.py \
        --model ${inputs.model_input} \
        --test-data ${inputs.test_data} \
        --metrics ${outputs.metrics_output}
    """

# Compose pipeline
@pipeline(default_compute="gpu-cluster")
def training_pipeline(raw_data: Input):
    train_step = train_model(training_data=raw_data)
    eval_step = evaluate_model(
        model_input=train_step.outputs.model_output,
        test_data=raw_data
    )
    return {"model": train_step.outputs.model_output, "metrics": eval_step.outputs.metrics_output}
```

## GitHub Actions Workflow

Automate the entire pipeline:

```yaml
name: ML Pipeline
on:
  push:
    paths: ['src/**', 'data/**']
  workflow_dispatch:

jobs:
  train-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Run Training Pipeline
        run: |
          pip install azure-ai-ml
          python -c "
          from azure.ai.ml import MLClient
          from azure.identity import DefaultAzureCredential

          ml_client = MLClient(
              DefaultAzureCredential(),
              '${{ secrets.SUBSCRIPTION_ID }}',
              '${{ secrets.RESOURCE_GROUP }}',
              '${{ secrets.WORKSPACE }}'
          )

          from training_pipeline import training_pipeline
          pipeline_job = ml_client.jobs.create_or_update(
              training_pipeline(raw_data=Input(path='azureml:training-data:latest'))
          )
          ml_client.jobs.stream(pipeline_job.name)
          "

      - name: Register Model
        if: success()
        run: python scripts/register_model.py

      - name: Deploy to Staging
        run: python scripts/deploy_staging.py
```

## Model Governance

Implement approval gates before production deployment. Track model lineage, performance metrics, and data dependencies for full auditability.
