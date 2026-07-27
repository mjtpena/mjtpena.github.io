---
title: "MLflow in Fabric: Experiment Tracking and Model Management"
author: Michael John Peña
draft: false
date: 2023-07-25
tags:
  - Microsoft Fabric
  - MLflow
  - Machine Learning
  - Experiment Tracking
---

MLflow in Fabric is the managed tracking layer that turns a Spark notebook into a reproducible experiment record. The integration is transparent — you import `mlflow`, call `mlflow.set_experiment("my-experiment")`, and from that point every `mlflow.log_param()`, `mlflow.log_metric()`, and `mlflow.log_artifact()` call writes to Fabric's hosted MLflow tracking server without any URI configuration. The experiment UI appears in the Fabric workspace as an Experiment item, and you can compare runs across hyperparameter values, training data versions, or algorithm choices in a table or parallel coordinates chart. Where Fabric's MLflow integration shines is in the combination with the Lakehouse: the training data is in a Delta table in the same workspace, the model artefact is registered in the model registry in the same workspace, and batch scoring reads from and writes to that same Lakehouse. No cross-service authentication, no separate MLflow deployment to maintain.

## MLflow in Fabric Overview

```python
# MLflow capabilities in Fabric
mlflow_features = {
    "experiment_tracking": "Log parameters, metrics, artifacts",
    "model_registry": "Version and manage models",
    "autologging": "Automatic parameter/metric capture",
    "ui": "Visual experiment comparison",
    "api": "Programmatic access to all features"
}

# MLflow is pre-configured in Fabric notebooks
import mlflow
print(f"Tracking URI: {mlflow.get_tracking_uri()}")
print(f"MLflow version: {mlflow.__version__}")
```

## Experiment Management

### Creating and Managing Experiments

```python
import mlflow

# Create new experiment
experiment_name = "customer_churn_prediction"
mlflow.set_experiment(experiment_name)

# Get experiment info
experiment = mlflow.get_experiment_by_name(experiment_name)
print(f"Experiment ID: {experiment.experiment_id}")
print(f"Artifact Location: {experiment.artifact_location}")

# List all experiments
experiments = mlflow.search_experiments()
for exp in experiments:
    print(f"{exp.name}: {exp.experiment_id}")
```

### Organizing with Tags

```python
# Set experiment-level tags
mlflow.set_experiment_tag("team", "data_science")
mlflow.set_experiment_tag("project", "customer_analytics")
mlflow.set_experiment_tag("owner", "michael.pena")

# Search experiments by tag
experiments = mlflow.search_experiments(
    filter_string="tags.team = 'data_science'"
)
```

## Comprehensive Run Tracking

### Logging Parameters

```python
with mlflow.start_run(run_name="experiment_v1"):
    # Log individual parameters
    mlflow.log_param("learning_rate", 0.01)
    mlflow.log_param("n_estimators", 100)

    # Log multiple parameters
    params = {
        "max_depth": 10,
        "min_samples_split": 5,
        "criterion": "gini",
        "random_state": 42
    }
    mlflow.log_params(params)

    # Log nested parameters (flattened)
    model_config = {
        "model": {
            "type": "random_forest",
            "hyperparameters": {
                "n_estimators": 100
            }
        }
    }
    mlflow.log_params({"config": str(model_config)})
```

### Logging Metrics

```python
with mlflow.start_run():
    # Log single metrics
    mlflow.log_metric("accuracy", 0.95)
    mlflow.log_metric("precision", 0.93)

    # Log metric with step (for training curves)
    for epoch in range(100):
        loss = train_one_epoch()
        mlflow.log_metric("training_loss", loss, step=epoch)

    # Log multiple metrics
    metrics = {
        "test_accuracy": 0.94,
        "test_precision": 0.92,
        "test_recall": 0.91,
        "test_f1": 0.915
    }
    mlflow.log_metrics(metrics)
```

### Logging Artifacts

```python
import matplotlib.pyplot as plt
import json

with mlflow.start_run():
    # Log figure
    fig, ax = plt.subplots()
    ax.plot([1, 2, 3, 4], [1, 4, 2, 3])
    ax.set_title("Training Progress")
    mlflow.log_figure(fig, "training_progress.png")
    plt.close()

    # Log file
    with open("/tmp/feature_list.json", "w") as f:
        json.dump({"features": ["col1", "col2", "col3"]}, f)
    mlflow.log_artifact("/tmp/feature_list.json")

    # Log directory
    mlflow.log_artifacts("/tmp/model_outputs/", artifact_path="outputs")

    # Log text
    mlflow.log_text("Model trained successfully", "training_notes.txt")

    # Log dictionary as JSON
    mlflow.log_dict({"config": "value"}, "config.json")
```

## Autologging

```python
# Enable autologging for common frameworks

# Scikit-learn
mlflow.sklearn.autolog()

# PyTorch
mlflow.pytorch.autolog()

# TensorFlow/Keras
mlflow.tensorflow.autolog()

# XGBoost
mlflow.xgboost.autolog()

# LightGBM
mlflow.lightgbm.autolog()

# Example with autolog
mlflow.sklearn.autolog(
    log_input_examples=True,
    log_model_signatures=True,
    log_models=True,
    log_post_training_metrics=True
)

from sklearn.ensemble import RandomForestClassifier

# Just train - everything is logged automatically!
model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)

# Disable after use
mlflow.sklearn.autolog(disable=True)
```

## Searching and Comparing Runs

```python
# Search runs with filters
runs = mlflow.search_runs(
    experiment_ids=[experiment.experiment_id],
    filter_string="metrics.accuracy > 0.9 AND params.n_estimators = '100'",
    order_by=["metrics.f1_score DESC"]
)

print(runs[['run_id', 'params.n_estimators', 'metrics.accuracy']].head())

# Get best run
best_run = runs.iloc[0]
print(f"Best run ID: {best_run.run_id}")
print(f"Best accuracy: {best_run['metrics.accuracy']}")

# Load best model
best_model = mlflow.sklearn.load_model(f"runs:/{best_run.run_id}/model")
```

## Nested Runs

```python
# Parent run for experiment
with mlflow.start_run(run_name="hyperparameter_search") as parent:
    best_score = 0
    best_params = None

    # Child runs for each configuration
    for lr in [0.01, 0.1, 0.5]:
        for depth in [5, 10, 15]:
            with mlflow.start_run(run_name=f"lr={lr}_depth={depth}", nested=True):
                params = {"learning_rate": lr, "max_depth": depth}
                mlflow.log_params(params)

                # Train and evaluate
                model = train_model(X_train, y_train, **params)
                score = evaluate_model(model, X_test, y_test)

                mlflow.log_metric("score", score)

                if score > best_score:
                    best_score = score
                    best_params = params

    # Log best results to parent
    mlflow.log_params({"best_" + k: v for k, v in best_params.items()})
    mlflow.log_metric("best_score", best_score)
```

## Custom Model Logging

```python
# Log model with custom signature
from mlflow.models import infer_signature

with mlflow.start_run():
    model = train_model(X_train, y_train)

    # Infer signature from data
    signature = infer_signature(X_train, model.predict(X_train))

    # Log with signature and input example
    mlflow.sklearn.log_model(
        model,
        artifact_path="model",
        signature=signature,
        input_example=X_train[:5],
        registered_model_name="my_production_model"
    )
```

## Model Registry Operations

```python
from mlflow import MlflowClient

client = MlflowClient()

# List registered models
for model in client.search_registered_models():
    print(f"Model: {model.name}")

# Get model details
model_details = client.get_registered_model("my_production_model")
print(f"Latest versions: {[v.version for v in model_details.latest_versions]}")

# Compare model versions
versions = client.search_model_versions("name='my_production_model'")
for v in versions:
    run = mlflow.get_run(v.run_id)
    print(f"Version {v.version}: accuracy={run.data.metrics.get('accuracy')}")
```

## Best Practices

```python
best_practices = {
    "naming": {
        "experiments": "project_task_version (e.g., churn_classification_v2)",
        "runs": "descriptive_unique_identifier"
    },
    "organization": {
        "tags": "Use for filtering and grouping",
        "artifacts": "Organize in subdirectories"
    },
    "reproducibility": {
        "log_code": "Always log training code as artifact",
        "log_data": "Log data version or hash",
        "set_seed": "Log random seed for reproducibility"
    },
    "efficiency": {
        "batch_logging": "Use log_params/log_metrics for multiple values",
        "autolog": "Enable for standard frameworks",
        "cleanup": "Delete failed/test runs"
    }
}

# Reproducibility example
with mlflow.start_run():
    # Log git commit
    import subprocess
    git_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode().strip()
    mlflow.set_tag("git_commit", git_hash)

    # Log data version
    mlflow.log_param("data_version", "2023-07-25")
    mlflow.log_param("data_rows", len(X_train))

    # Log training code
    mlflow.log_artifact("train.py")
```

Tomorrow we'll explore experiment tracking patterns in detail.

## Resources

- [MLflow in Fabric](https://learn.microsoft.com/en-us/fabric/data-science/mlflow-autologging)
- [MLflow Documentation](https://mlflow.org/docs/latest/index.html)
- [Experiment Tracking](https://learn.microsoft.com/en-us/fabric/data-science/experiment-tracking)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
