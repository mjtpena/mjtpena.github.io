---
title: "Hyperparameter Tuning with Azure ML Sweep Jobs"
description: "Sweep jobs automate the tedious process of hyperparameter tuning, helping you find optimal configurations faster."
author: "Michael John Peña"
draft: false
date: 2022-08-19
tags: ["Azure", "Machine Learning", "Hyperparameter Tuning", "Sweep", "Optimization"]
---

## Basic Sweep Job

```python
from azure.ai.ml import MLClient, command, Input
from azure.ai.ml.sweep import Choice, Uniform, LogUniform, BanditPolicy
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Define training command with hyperparameters
training_command = command(
    code="./src",
    command="""python train.py \
        --data ${{inputs.training_data}} \
        --learning-rate ${{inputs.learning_rate}} \
        --n-estimators ${{inputs.n_estimators}} \
        --max-depth ${{inputs.max_depth}} \
        --min-samples-split ${{inputs.min_samples_split}}""",
    inputs={
        "training_data": Input(path="azureml://datastores/workspaceblobstore/paths/train.csv"),
        "learning_rate": 0.1,  # Will be swept
        "n_estimators": 100,   # Will be swept
        "max_depth": 5,        # Will be swept
        "min_samples_split": 2 # Will be swept
    },
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    compute="cpu-cluster"
)

# Configure sweep
sweep_job = training_command.sweep(
    compute="cpu-cluster",
    sampling_algorithm="random",
    primary_metric="accuracy",
    goal="maximize",
    limits={
        "max_total_trials": 50,
        "max_concurrent_trials": 10,
        "timeout": 3600
    }
)

# Define search space
sweep_job.set_inputs(
    learning_rate=LogUniform(min_value=-4, max_value=-1),  # 0.0001 to 0.1
    n_estimators=Choice([50, 100, 200, 500]),
    max_depth=Choice([3, 5, 7, 10, 15]),
    min_samples_split=Choice([2, 5, 10, 20])
)

# Submit sweep job
returned_job = ml_client.jobs.create_or_update(sweep_job)
print(f"Sweep job submitted: {returned_job.name}")
```

## Training Script for Sweep

```python
# src/train.py
import argparse
import pandas as pd
import mlflow
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score

def train(args):
    # Start MLflow run
    mlflow.start_run()

    # Log hyperparameters
    mlflow.log_param("learning_rate", args.learning_rate)
    mlflow.log_param("n_estimators", args.n_estimators)
    mlflow.log_param("max_depth", args.max_depth)
    mlflow.log_param("min_samples_split", args.min_samples_split)

    # Load data
    df = pd.read_csv(args.data)
    X = df.drop("target", axis=1)
    y = df["target"]

    # Train model
    model = RandomForestClassifier(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        min_samples_split=args.min_samples_split,
        random_state=42
    )

    # Cross-validation
    scores = cross_val_score(model, X, y, cv=5)
    accuracy = scores.mean()

    # Log metrics
    mlflow.log_metric("accuracy", accuracy)
    mlflow.log_metric("accuracy_std", scores.std())

    # Train final model
    model.fit(X, y)
    mlflow.sklearn.log_model(model, "model")

    mlflow.end_run()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--learning-rate", type=float)
    parser.add_argument("--n-estimators", type=int)
    parser.add_argument("--max-depth", type=int)
    parser.add_argument("--min-samples-split", type=int)
    args = parser.parse_args()

    train(args)
```

## Sampling Algorithms

```python
from azure.ai.ml.sweep import RandomParameterSampling, GridParameterSampling, BayesianParameterSampling

# Random sampling
sweep_job_random = training_command.sweep(
    sampling_algorithm="random",
    primary_metric="accuracy",
    goal="maximize"
)

# Grid sampling (exhaustive)
sweep_job_grid = training_command.sweep(
    sampling_algorithm="grid",
    primary_metric="accuracy",
    goal="maximize"
)

# Bayesian optimization
sweep_job_bayesian = training_command.sweep(
    sampling_algorithm="bayesian",
    primary_metric="accuracy",
    goal="maximize"
)
```

## Search Space Types

```python
from azure.ai.ml.sweep import (
    Choice,
    Uniform,
    LogUniform,
    Normal,
    LogNormal,
    QUniform,
    QLogUniform,
    QNormal,
    QLogNormal
)

sweep_job.set_inputs(
    # Categorical
    optimizer=Choice(["adam", "sgd", "rmsprop"]),

    # Continuous uniform
    dropout=Uniform(min_value=0.1, max_value=0.5),

    # Log-uniform (good for learning rates)
    learning_rate=LogUniform(min_value=-5, max_value=-1),

    # Normal distribution
    weight_decay=Normal(mu=0.01, sigma=0.005),

    # Quantized (discrete steps)
    batch_size=QUniform(min_value=16, max_value=128, q=16),  # 16, 32, 48, ...

    # Integer choice
    num_layers=Choice([1, 2, 3, 4, 5])
)
```

## Early Termination Policies

```python
from azure.ai.ml.sweep import BanditPolicy, MedianStoppingPolicy, TruncationSelectionPolicy

# Bandit policy - terminate runs falling behind
sweep_job.early_termination = BanditPolicy(
    slack_factor=0.1,  # Within 10% of best run
    evaluation_interval=1,  # Check every epoch
    delay_evaluation=5  # Start checking after 5 epochs
)

# Median stopping policy
sweep_job.early_termination = MedianStoppingPolicy(
    evaluation_interval=1,
    delay_evaluation=5
)

# Truncation selection - terminate worst performers
sweep_job.early_termination = TruncationSelectionPolicy(
    truncation_percentage=25,  # Terminate bottom 25%
    evaluation_interval=1
)
```

## Analyzing Sweep Results

```python
# Get sweep job
sweep_job = ml_client.jobs.get(returned_job.name)

# Get best trial
best_trial = sweep_job.properties.get("best_child_run_id")
print(f"Best trial: {best_trial}")

# Get all child runs
child_jobs = ml_client.jobs.list(parent_job_name=sweep_job.name)

results = []
for job in child_jobs:
    if job.status == "Completed":
        results.append({
            "run_id": job.name,
            "accuracy": job.properties.get("accuracy"),
            "learning_rate": job.inputs.get("learning_rate"),
            "n_estimators": job.inputs.get("n_estimators")
        })

# Create results dataframe
results_df = pd.DataFrame(results).sort_values("accuracy", ascending=False)
print(results_df.head(10))
```

## Visualization

```python
import matplotlib.pyplot as plt
import seaborn as sns

# Parallel coordinates plot
fig, ax = plt.subplots(figsize=(12, 6))
pd.plotting.parallel_coordinates(
    results_df,
    'accuracy',
    colormap='viridis'
)
plt.title('Hyperparameter Space Exploration')
plt.savefig('sweep_results.png')

# Hyperparameter vs metric scatter plots
fig, axes = plt.subplots(2, 2, figsize=(12, 10))

axes[0, 0].scatter(results_df['learning_rate'], results_df['accuracy'])
axes[0, 0].set_xlabel('Learning Rate')
axes[0, 0].set_ylabel('Accuracy')
axes[0, 0].set_xscale('log')

axes[0, 1].scatter(results_df['n_estimators'], results_df['accuracy'])
axes[0, 1].set_xlabel('N Estimators')
axes[0, 1].set_ylabel('Accuracy')

# ... more plots

plt.tight_layout()
plt.savefig('hyperparameter_analysis.png')
```

## Registering Best Model

```python
# Get best model from sweep
best_run = ml_client.jobs.get(best_trial)

# Download model
ml_client.jobs.download(
    name=best_trial,
    output_name="model",
    download_path="./best_model"
)

# Register model
from azure.ai.ml.entities import Model

model = Model(
    path="./best_model/model",
    name="optimized-classifier",
    description=f"Best model from sweep {sweep_job.name}",
    properties={
        "accuracy": str(best_run.properties.get("accuracy")),
        "sweep_job": sweep_job.name
    }
)

ml_client.models.create_or_update(model)
```

Sweep jobs automate the tedious process of hyperparameter tuning, helping you find optimal configurations faster.
