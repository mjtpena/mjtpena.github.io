---
title: "Azure ML Pipelines v2: Modern ML Workflows"
author: "Michael John Peña"
draft: false
date: 2022-08-17
tags: ["Azure", "Machine Learning", "Pipelines", "MLOps", "Workflows"]

---

I wrote "Azure ML Pipelines v2: Modern ML Workflows" to share practical, production-minded guidance on this topic.

## Pipeline Basics

```python
from azure.ai.ml import MLClient, Input, Output, dsl, command
from azure.ai.ml.entities import Environment, AmlCompute
from azure.identity import DefaultAzureCredential

# Connect to workspace
ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Define a command component
data_prep_component = command(
    name="data_preparation",
    display_name="Prepare Training Data",
    description="Clean and prepare data for training",
    inputs={
        "raw_data": Input(type="uri_file"),
        "test_split": Input(type="number", default=0.2)
    },
    outputs={
        "train_data": Output(type="uri_folder"),
        "test_data": Output(type="uri_folder")
    },
    code="./src/data_prep",
    command="python prep.py --raw-data ${{inputs.raw_data}} --test-split ${{inputs.test_split}} --train-output ${{outputs.train_data}} --test-output ${{outputs.test_data}}",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest"
)

# Register the component
ml_client.components.create_or_update(data_prep_component)
```

## Building a Pipeline

```python
from azure.ai.ml import dsl, Input, Output

# Load components
data_prep = ml_client.components.get("data_preparation")
train_model = ml_client.components.get("train_model")
evaluate_model = ml_client.components.get("evaluate_model")

@dsl.pipeline(
    name="training_pipeline",
    description="End-to-end training pipeline",
    compute="cpu-cluster"
)
def training_pipeline(
    raw_data: Input,
    model_name: str,
    learning_rate: float = 0.01
):
    # Data preparation step
    prep_step = data_prep(
        raw_data=raw_data,
        test_split=0.2
    )

    # Training step
    train_step = train_model(
        train_data=prep_step.outputs.train_data,
        model_name=model_name,
        learning_rate=learning_rate
    )

    # Evaluation step
    eval_step = evaluate_model(
        model=train_step.outputs.model,
        test_data=prep_step.outputs.test_data
    )

    return {
        "trained_model": train_step.outputs.model,
        "metrics": eval_step.outputs.metrics
    }

# Create pipeline instance
pipeline = training_pipeline(
    raw_data=Input(path="azureml://datastores/workspaceblobstore/paths/data/raw.csv"),
    model_name="churn_classifier",
    learning_rate=0.001
)

# Submit pipeline
pipeline_job = ml_client.jobs.create_or_update(
    pipeline,
    experiment_name="churn-experiment"
)

# Stream logs
ml_client.jobs.stream(pipeline_job.name)
```

## Component Definition Files

```yaml
# component.yaml
$schema: https://azuremlschemas.azureedge.net/latest/commandComponent.schema.json
name: train_model
display_name: Train Model
version: 1
type: command

inputs:
  train_data:
    type: uri_folder
    description: Training data folder
  model_name:
    type: string
    description: Name of the model
  learning_rate:
    type: number
    default: 0.01

outputs:
  model:
    type: mlflow_model
    description: Trained model

code: ./src
environment:
  image: mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04
  conda_file: conda.yaml

command: >-
  python train.py
  --train-data ${{inputs.train_data}}
  --model-name ${{inputs.model_name}}
  --learning-rate ${{inputs.learning_rate}}
  --model-output ${{outputs.model}}
```

## Conditional Execution

```python
from azure.ai.ml.dsl import condition

@dsl.pipeline(name="conditional_pipeline")
def conditional_pipeline(data: Input, model_type: str):
    # Data prep runs always
    prep_step = data_prep(raw_data=data)

    # Conditional training based on model type
    with condition(model_type == "xgboost"):
        xgb_train = train_xgboost(
            train_data=prep_step.outputs.train_data
        )

    with condition(model_type == "sklearn"):
        sklearn_train = train_sklearn(
            train_data=prep_step.outputs.train_data
        )

    return {
        "model": xgb_train.outputs.model if model_type == "xgboost" else sklearn_train.outputs.model
    }
```

## Parallel Processing

```python
from azure.ai.ml.parallel import parallel_run_function, RunFunction

# Define parallel component
parallel_score = parallel_run_function(
    name="batch_scoring",
    display_name="Parallel Batch Scoring",
    inputs={
        "input_data": Input(type="uri_folder"),
        "model": Input(type="mlflow_model")
    },
    outputs={
        "scored_data": Output(type="uri_folder")
    },
    input_data="${{inputs.input_data}}",
    mini_batch_size="10",
    instance_count=4,
    max_concurrency_per_instance=2,
    error_threshold=5,
    mini_batch_error_threshold=5,
    logging_level="INFO",
    task=RunFunction(
        code="./src/scoring",
        entry_script="score.py",
        environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest"
    )
)

@dsl.pipeline(name="batch_scoring_pipeline")
def batch_scoring_pipeline(input_data: Input, model: Input):
    scoring_step = parallel_score(
        input_data=input_data,
        model=model
    )

    return {"predictions": scoring_step.outputs.scored_data}
```

## Pipeline with Multiple Compute Targets

```python
@dsl.pipeline(name="multi_compute_pipeline")
def multi_compute_pipeline(raw_data: Input):
    # CPU for data prep
    prep_step = data_prep(raw_data=raw_data)
    prep_step.compute = "cpu-cluster"

    # GPU for training
    train_step = train_deep_learning(
        train_data=prep_step.outputs.train_data
    )
    train_step.compute = "gpu-cluster"

    # CPU for evaluation
    eval_step = evaluate(
        model=train_step.outputs.model,
        test_data=prep_step.outputs.test_data
    )
    eval_step.compute = "cpu-cluster"

    return {"model": train_step.outputs.model}
```

## Pipeline Scheduling

```python
from azure.ai.ml.entities import RecurrenceTrigger, JobSchedule

# Create schedule
schedule = JobSchedule(
    name="daily_training",
    trigger=RecurrenceTrigger(
        frequency="day",
        interval=1,
        start_time="2022-08-17T08:00:00",
        time_zone="UTC"
    ),
    create_job=training_pipeline(
        raw_data=Input(path="azureml://datastores/workspaceblobstore/paths/data/daily/"),
        model_name="daily_model"
    )
)

ml_client.schedules.begin_create_or_update(schedule)

# List schedules
for s in ml_client.schedules.list():
    print(f"{s.name}: {s.trigger}")
```

## Pipeline Debugging

```python
# Download outputs for debugging
ml_client.jobs.download(
    name=pipeline_job.name,
    output_name="trained_model",
    download_path="./outputs"
)

# Get specific step output
step_job = ml_client.jobs.get(f"{pipeline_job.name}/train_step")
print(step_job.status)

# Stream logs from specific step
ml_client.jobs.stream(f"{pipeline_job.name}/train_step")
```

Azure ML Pipelines v2 provides a modern, Pythonic way to build production-ready ML workflows.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
