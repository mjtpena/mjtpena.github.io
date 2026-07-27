---
title: "Azure Machine Learning Pipelines: MLOps Workflows"
author: Michael John Peña
draft: false
date: 2020-12-07
tags:
  - Azure
  - Machine Learning
  - MLOps
  - Pipelines
---

The first ML model I helped put into production was a notebook a data scientist ran by hand every Monday morning. That worked exactly as well as you'd expect. Azure ML Pipelines is the upgrade path: data prep, training, evaluation, registration, and deployment as named steps in a DAG, parameterised, versioned, and triggerable. Once a pipeline exists, "retrain on the new data" is a one-liner instead of a meeting.

## Pipeline Components

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Data      │ → │   Train     │ → │  Evaluate   │
│   Prep      │    │   Model     │    │   Model     │
└─────────────┘    └─────────────┘    └─────────────┘
                                            │
                         ┌──────────────────┴──────────────────┐
                         │                                     │
                   ┌─────┴─────┐                         ┌─────┴─────┐
                   │  Register  │                         │   Alert   │
                   │   Model    │                         │  (if bad) │
                   └─────┬─────┘                         └───────────┘
                         │
                   ┌─────┴─────┐
                   │  Deploy   │
                   │  Model    │
                   └───────────┘
```

## Creating Pipeline Steps

```python
from azureml.core import Workspace, Experiment
from azureml.pipeline.core import Pipeline, PipelineData
from azureml.pipeline.steps import PythonScriptStep

ws = Workspace.from_config()
compute_target = ws.compute_targets["cpu-cluster"]

# Define data references
raw_data = Dataset.get_by_name(ws, "raw-sales-data")
processed_data = PipelineData("processed_data", datastore=ws.get_default_datastore())
model_output = PipelineData("model_output", datastore=ws.get_default_datastore())

# Step 1: Data preparation
prep_step = PythonScriptStep(
    name="prepare_data",
    script_name="prep.py",
    arguments=["--input", raw_data.as_mount(), "--output", processed_data],
    outputs=[processed_data],
    compute_target=compute_target,
    source_directory="./src"
)

# Step 2: Train model
train_step = PythonScriptStep(
    name="train_model",
    script_name="train.py",
    arguments=[
        "--input", processed_data,
        "--output", model_output,
        "--learning_rate", 0.01
    ],
    inputs=[processed_data],
    outputs=[model_output],
    compute_target=compute_target,
    source_directory="./src"
)

# Step 3: Evaluate model
evaluate_step = PythonScriptStep(
    name="evaluate_model",
    script_name="evaluate.py",
    arguments=["--model", model_output],
    inputs=[model_output],
    compute_target=compute_target,
    source_directory="./src"
)

# Create pipeline
pipeline = Pipeline(workspace=ws, steps=[prep_step, train_step, evaluate_step])
```

## Pipeline Scripts

```python
# prep.py
import argparse
import pandas as pd
from azureml.core import Run

run = Run.get_context()

parser = argparse.ArgumentParser()
parser.add_argument("--input", type=str)
parser.add_argument("--output", type=str)
args = parser.parse_args()

# Load and process data
df = pd.read_parquet(args.input)
df_processed = preprocess(df)

# Save output
df_processed.to_parquet(f"{args.output}/processed.parquet")

# Log metrics
run.log("rows_processed", len(df_processed))
```

```python
# train.py
import argparse
from sklearn.ensemble import RandomForestClassifier
import joblib
from azureml.core import Run

run = Run.get_context()

parser = argparse.ArgumentParser()
parser.add_argument("--input", type=str)
parser.add_argument("--output", type=str)
parser.add_argument("--learning_rate", type=float, default=0.01)
args = parser.parse_args()

# Load data and train
df = pd.read_parquet(f"{args.input}/processed.parquet")
X, y = df.drop("target", axis=1), df["target"]

model = RandomForestClassifier(n_estimators=100)
model.fit(X, y)

# Log metrics
run.log("accuracy", model.score(X, y))

# Save model
joblib.dump(model, f"{args.output}/model.pkl")
```

## Run Pipeline

```python
# Submit pipeline
experiment = Experiment(ws, "sales-prediction")
pipeline_run = experiment.submit(pipeline)
pipeline_run.wait_for_completion(show_output=True)
```

## Publish Pipeline

```python
# Publish for scheduled/triggered runs
published_pipeline = pipeline.publish(
    name="Sales Prediction Pipeline",
    description="End-to-end sales prediction workflow"
)

print(f"Pipeline endpoint: {published_pipeline.endpoint}")

# Trigger via REST
import requests

response = requests.post(
    published_pipeline.endpoint,
    headers={"Authorization": f"Bearer {token}"},
    json={"ExperimentName": "scheduled-run"}
)
```

## Schedule Pipeline

```python
from azureml.pipeline.core import ScheduleRecurrence, Schedule

recurrence = ScheduleRecurrence(
    frequency="Week",
    interval=1,
    week_days=["Monday"],
    time_of_day="03:00"
)

schedule = Schedule.create(
    ws,
    name="weekly-training",
    pipeline_id=published_pipeline.id,
    experiment_name="scheduled-training",
    recurrence=recurrence
)
```

## Pipeline Parameters

```python
from azureml.pipeline.core import PipelineParameter

learning_rate_param = PipelineParameter(name="learning_rate", default_value=0.01)
epochs_param = PipelineParameter(name="epochs", default_value=100)

train_step = PythonScriptStep(
    name="train",
    arguments=[
        "--learning_rate", learning_rate_param,
        "--epochs", epochs_param
    ]
)
```

Azure ML Pipelines: reproducible ML at enterprise scale.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
