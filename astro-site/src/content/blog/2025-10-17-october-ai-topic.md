---
title: "Azure Machine Learning Pipelines: Orchestrating ML Workflows"
author: Michael John Peña
draft: false
date: 2025-10-17
tags:
  - Azure Machine Learning
  - MLOps
  - Pipelines
  - Automation
  - Workflows

---

I wrote "Azure Machine Learning Pipelines: Orchestrating ML Workflows" to share practical, production-minded guidance on this topic.

## Building Pipeline Components

Create reusable components for your ML workflow:

```python
from azure.ai.ml import MLClient, command, Input, Output
from azure.ai.ml.dsl import pipeline
from azure.ai.ml.entities import Environment
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="rg-mlops",
    workspace_name="mlw-production"
)

# Data preparation component
data_prep_component = command(
    name="data_preparation",
    display_name="Prepare Training Data",
    inputs={
        "raw_data": Input(type="uri_folder"),
        "test_split_ratio": Input(type="number", default=0.2)
    },
    outputs={
        "train_data": Output(type="uri_folder"),
        "test_data": Output(type="uri_folder")
    },
    code="./components/data_prep",
    command="python prep.py --raw_data ${{inputs.raw_data}} --test_split ${{inputs.test_split_ratio}} --train_output ${{outputs.train_data}} --test_output ${{outputs.test_data}}",
    environment=Environment(
        image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest",
        conda_file="./environments/data_prep_env.yml"
    )
)

# Training component
training_component = command(
    name="model_training",
    display_name="Train Model",
    inputs={
        "train_data": Input(type="uri_folder"),
        "learning_rate": Input(type="number", default=0.01),
        "epochs": Input(type="integer", default=10)
    },
    outputs={
        "model": Output(type="uri_folder"),
        "metrics": Output(type="uri_file")
    },
    code="./components/training",
    command="python train.py --data ${{inputs.train_data}} --lr ${{inputs.learning_rate}} --epochs ${{inputs.epochs}} --model_output ${{outputs.model}} --metrics_output ${{outputs.metrics}}",
    environment="azureml:pytorch-training:1"
)
```

## Composing the Pipeline

Chain components together into a complete workflow:

```python
@pipeline(
    display_name="End-to-End ML Pipeline",
    description="Complete pipeline from data prep to model evaluation"
)
def ml_pipeline(
    raw_data: Input,
    learning_rate: float = 0.01,
    epochs: int = 10,
    test_split: float = 0.2
):
    # Data preparation step
    prep_step = data_prep_component(
        raw_data=raw_data,
        test_split_ratio=test_split
    )

    # Training step
    train_step = training_component(
        train_data=prep_step.outputs.train_data,
        learning_rate=learning_rate,
        epochs=epochs
    )

    # Evaluation step
    eval_step = evaluation_component(
        model=train_step.outputs.model,
        test_data=prep_step.outputs.test_data
    )

    return {
        "trained_model": train_step.outputs.model,
        "evaluation_results": eval_step.outputs.evaluation_report
    }

# Create and submit pipeline
pipeline_job = ml_pipeline(
    raw_data=Input(type="uri_folder", path="azureml:raw-training-data:1"),
    learning_rate=0.001,
    epochs=20
)

submitted_job = ml_client.jobs.create_or_update(pipeline_job)
```

## Scheduling and Triggers

Configure pipelines to run on schedules or in response to data changes, enabling fully automated ML operations with minimal manual intervention.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
