---
title: Building ML Workflows with Azure Machine Learning Pipelines
description: "The first ML pipeline I helped build was a series of Python scripts duct-taped together with a bash wrapper and a nightly cron job. It worked exactly as…"
author: Michael John Peña
draft: false
date: 2021-02-17
url: /blog/azure-ml-pipelines/
tags:
  - Azure
  - Machine Learning
  - MLOps
  - Pipelines
  - AI
---

The first ML pipeline I helped build was a series of Python scripts duct-taped together with a bash wrapper and a nightly cron job. It worked exactly as well as you'd expect. Azure ML Pipelines are the grown-up version: named steps, parameter binding between steps, cacheable intermediate outputs, published endpoints you can trigger from ADF or DevOps, and run history you can diff when accuracy unexpectedly drops. The reusability is what changes the team dynamic—data engineers own the data steps, data scientists own the training, and they compose without stepping on each other.

## Understanding ML Pipelines

ML Pipelines provide:

- **Modularity** - Break complex workflows into reusable steps
- **Reproducibility** - Track inputs, outputs, and parameters
- **Scalability** - Run steps on different compute targets
- **Automation** - Schedule and trigger pipeline runs
- **Collaboration** - Share pipelines across teams

## Creating Your First Pipeline

```python
from azureml.core import Workspace, Experiment, Dataset
from azureml.core.compute import ComputeTarget, AmlCompute
from azureml.pipeline.core import Pipeline, PipelineData
from azureml.pipeline.steps import PythonScriptStep

# Connect to workspace
ws = Workspace.from_config()

# Get or create compute target
compute_name = "cpu-cluster"
if compute_name not in ws.compute_targets:
    compute_config = AmlCompute.provisioning_configuration(
        vm_size="STANDARD_DS3_V2",
        min_nodes=0,
        max_nodes=4
    )
    compute_target = ComputeTarget.create(ws, compute_name, compute_config)
    compute_target.wait_for_completion(show_output=True)
else:
    compute_target = ws.compute_targets[compute_name]

# Get default datastore
datastore = ws.get_default_datastore()

# Define pipeline data (intermediate outputs)
prepared_data = PipelineData(
    "prepared_data",
    datastore=datastore,
    output_mode="mount"
)

trained_model = PipelineData(
    "trained_model",
    datastore=datastore,
    output_mode="mount"
)

evaluation_results = PipelineData(
    "evaluation_results",
    datastore=datastore,
    output_mode="mount"
)
```

## Pipeline Steps

### Data Preparation Step

```python
# data_prep.py
import argparse
import pandas as pd
from sklearn.model_selection import train_test_split
import os

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input_data", type=str)
    parser.add_argument("--output_path", type=str)
    parser.add_argument("--test_size", type=float, default=0.2)
    args = parser.parse_args()

    # Load data
    df = pd.read_parquet(args.input_data)
    print(f"Loaded {len(df)} records")

    # Clean data
    df = df.dropna()
    df = df.drop_duplicates()

    # Feature engineering
    df['year'] = pd.to_datetime(df['date']).dt.year
    df['month'] = pd.to_datetime(df['date']).dt.month
    df['day_of_week'] = pd.to_datetime(df['date']).dt.dayofweek

    # Split data
    train_df, test_df = train_test_split(
        df,
        test_size=args.test_size,
        random_state=42
    )

    # Save outputs
    os.makedirs(args.output_path, exist_ok=True)
    train_df.to_parquet(os.path.join(args.output_path, "train.parquet"))
    test_df.to_parquet(os.path.join(args.output_path, "test.parquet"))

    print(f"Train: {len(train_df)}, Test: {len(test_df)}")

if __name__ == "__main__":
    main()
```

### Training Step

```python
# train.py
import argparse
import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
import joblib
import os
import mlflow

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input_path", type=str)
    parser.add_argument("--output_path", type=str)
    parser.add_argument("--n_estimators", type=int, default=100)
    parser.add_argument("--max_depth", type=int, default=5)
    parser.add_argument("--learning_rate", type=float, default=0.1)
    args = parser.parse_args()

    # Start MLflow run
    mlflow.start_run()

    # Log parameters
    mlflow.log_params({
        "n_estimators": args.n_estimators,
        "max_depth": args.max_depth,
        "learning_rate": args.learning_rate
    })

    # Load training data
    train_df = pd.read_parquet(os.path.join(args.input_path, "train.parquet"))

    # Prepare features and target
    feature_columns = ['feature1', 'feature2', 'year', 'month', 'day_of_week']
    X_train = train_df[feature_columns]
    y_train = train_df['target']

    # Train model
    model = GradientBoostingRegressor(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        learning_rate=args.learning_rate,
        random_state=42
    )
    model.fit(X_train, y_train)

    # Calculate training metrics
    train_predictions = model.predict(X_train)
    train_rmse = np.sqrt(np.mean((y_train - train_predictions) ** 2))
    train_mae = np.mean(np.abs(y_train - train_predictions))

    mlflow.log_metrics({
        "train_rmse": train_rmse,
        "train_mae": train_mae
    })

    # Save model
    os.makedirs(args.output_path, exist_ok=True)
    model_path = os.path.join(args.output_path, "model.pkl")
    joblib.dump(model, model_path)

    # Log model to MLflow
    mlflow.sklearn.log_model(model, "model")

    print(f"Model saved to {model_path}")
    print(f"Train RMSE: {train_rmse:.4f}")

    mlflow.end_run()

if __name__ == "__main__":
    main()
```

### Evaluation Step

```python
# evaluate.py
import argparse
import pandas as pd
import numpy as np
import joblib
import json
import os
import mlflow

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_path", type=str)
    parser.add_argument("--model_path", type=str)
    parser.add_argument("--output_path", type=str)
    args = parser.parse_args()

    mlflow.start_run()

    # Load test data
    test_df = pd.read_parquet(os.path.join(args.data_path, "test.parquet"))

    # Load model
    model = joblib.load(os.path.join(args.model_path, "model.pkl"))

    # Prepare features
    feature_columns = ['feature1', 'feature2', 'year', 'month', 'day_of_week']
    X_test = test_df[feature_columns]
    y_test = test_df['target']

    # Make predictions
    predictions = model.predict(X_test)

    # Calculate metrics
    rmse = np.sqrt(np.mean((y_test - predictions) ** 2))
    mae = np.mean(np.abs(y_test - predictions))
    mape = np.mean(np.abs((y_test - predictions) / y_test)) * 100

    metrics = {
        "test_rmse": rmse,
        "test_mae": mae,
        "test_mape": mape
    }

    mlflow.log_metrics(metrics)

    # Save evaluation results
    os.makedirs(args.output_path, exist_ok=True)
    with open(os.path.join(args.output_path, "metrics.json"), "w") as f:
        json.dump(metrics, f)

    print(f"Test RMSE: {rmse:.4f}")
    print(f"Test MAE: {mae:.4f}")
    print(f"Test MAPE: {mape:.2f}%")

    mlflow.end_run()

if __name__ == "__main__":
    main()
```

## Assembling the Pipeline

```python
from azureml.core import Environment
from azureml.core.runconfig import RunConfiguration

# Create environment
env = Environment.from_conda_specification(
    name="ml-pipeline-env",
    file_path="environment.yml"
)

# Create run configuration
run_config = RunConfiguration()
run_config.environment = env

# Define pipeline steps
data_prep_step = PythonScriptStep(
    name="Data Preparation",
    script_name="data_prep.py",
    arguments=[
        "--input_data", input_dataset.as_mount(),
        "--output_path", prepared_data,
        "--test_size", 0.2
    ],
    outputs=[prepared_data],
    compute_target=compute_target,
    runconfig=run_config,
    source_directory="./src"
)

train_step = PythonScriptStep(
    name="Model Training",
    script_name="train.py",
    arguments=[
        "--input_path", prepared_data,
        "--output_path", trained_model,
        "--n_estimators", 100,
        "--max_depth", 5,
        "--learning_rate", 0.1
    ],
    inputs=[prepared_data],
    outputs=[trained_model],
    compute_target=compute_target,
    runconfig=run_config,
    source_directory="./src"
)

evaluate_step = PythonScriptStep(
    name="Model Evaluation",
    script_name="evaluate.py",
    arguments=[
        "--data_path", prepared_data,
        "--model_path", trained_model,
        "--output_path", evaluation_results
    ],
    inputs=[prepared_data, trained_model],
    outputs=[evaluation_results],
    compute_target=compute_target,
    runconfig=run_config,
    source_directory="./src"
)

# Create pipeline
pipeline = Pipeline(
    workspace=ws,
    steps=[data_prep_step, train_step, evaluate_step]
)

# Validate pipeline
pipeline.validate()

# Submit pipeline
experiment = Experiment(ws, "ml-training-pipeline")
pipeline_run = experiment.submit(pipeline)
pipeline_run.wait_for_completion(show_output=True)
```

## Publishing Pipelines

```python
# Publish pipeline for reuse
published_pipeline = pipeline.publish(
    name="ML Training Pipeline",
    description="Pipeline for data prep, training, and evaluation",
    version="1.0"
)

print(f"Pipeline ID: {published_pipeline.id}")
print(f"Endpoint: {published_pipeline.endpoint}")

# Create pipeline endpoint for versioning
from azureml.pipeline.core import PipelineEndpoint

pipeline_endpoint = PipelineEndpoint.publish(
    workspace=ws,
    name="ml-training-endpoint",
    pipeline=published_pipeline,
    description="Endpoint for ML training pipeline"
)
```

## Scheduling Pipelines

```python
from azureml.pipeline.core import Schedule, ScheduleRecurrence

# Schedule to run daily at midnight
recurrence = ScheduleRecurrence(
    frequency="Day",
    interval=1,
    start_time="2021-02-17T00:00:00"
)

schedule = Schedule.create(
    workspace=ws,
    name="daily-training-schedule",
    pipeline_id=published_pipeline.id,
    experiment_name="scheduled-training",
    recurrence=recurrence
)

print(f"Schedule ID: {schedule.id}")

# Trigger pipeline on data changes
from azureml.pipeline.core import Schedule, TimeZone

datastore_schedule = Schedule.create(
    workspace=ws,
    name="data-trigger-schedule",
    pipeline_id=published_pipeline.id,
    experiment_name="data-triggered-training",
    datastore=datastore,
    path_on_datastore="raw_data/",
    polling_interval=60  # Check every 60 minutes
)
```

## Parameterized Pipelines

```python
from azureml.pipeline.core import PipelineParameter

# Define parameters
n_estimators_param = PipelineParameter(
    name="n_estimators",
    default_value=100
)

max_depth_param = PipelineParameter(
    name="max_depth",
    default_value=5
)

learning_rate_param = PipelineParameter(
    name="learning_rate",
    default_value=0.1
)

# Use parameters in step
train_step = PythonScriptStep(
    name="Model Training",
    script_name="train.py",
    arguments=[
        "--input_path", prepared_data,
        "--output_path", trained_model,
        "--n_estimators", n_estimators_param,
        "--max_depth", max_depth_param,
        "--learning_rate", learning_rate_param
    ],
    inputs=[prepared_data],
    outputs=[trained_model],
    compute_target=compute_target,
    runconfig=run_config,
    source_directory="./src"
)

# Submit with custom parameters
pipeline_run = experiment.submit(
    pipeline,
    pipeline_parameters={
        "n_estimators": 200,
        "max_depth": 10,
        "learning_rate": 0.05
    }
)
```

## Best Practices

1. **Modularize steps** for reusability and easier debugging
2. **Use caching** - Azure ML automatically caches step outputs
3. **Parameterize pipelines** for flexibility
4. **Version your pipelines** using pipeline endpoints
5. **Monitor pipeline runs** with MLflow integration
6. **Use parallel steps** when steps don't depend on each other

## Conclusion

Azure Machine Learning Pipelines provide a robust framework for building production-ready ML workflows. By breaking down your ML process into modular, reusable steps, you can iterate faster, collaborate effectively, and scale your ML operations.

Start with simple pipelines and gradually add complexity as your ML maturity grows.
