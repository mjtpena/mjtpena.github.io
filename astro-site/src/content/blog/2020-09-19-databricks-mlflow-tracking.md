---
title: "MLflow on Azure Databricks: Experiment Tracking"
description: "MLflow makes ML experiments reproducible and models traceable."
author: Michael John Peña
draft: false
date: 2020-09-19
tags:
  - Azure
  - Databricks
  - MLflow
  - Machine Learning
---

## Tracking Experiments

```python
import mlflow
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score

# Set experiment (creates if doesn't exist)
mlflow.set_experiment("/Users/mj/churn-prediction")

with mlflow.start_run(run_name="random-forest-v1"):
    # Log parameters
    params = {"n_estimators": 100, "max_depth": 10, "min_samples_split": 5}
    mlflow.log_params(params)

    # Train model
    model = RandomForestClassifier(**params)
    model.fit(X_train, y_train)

    # Log metrics
    y_pred = model.predict(X_test)
    mlflow.log_metric("accuracy", accuracy_score(y_test, y_pred))
    mlflow.log_metric("f1_score", f1_score(y_test, y_pred))

    # Log model
    mlflow.sklearn.log_model(model, "model")

    # Log artifacts
    mlflow.log_artifact("feature_importance.png")
```

## Comparing Runs

```python
from mlflow.tracking import MlflowClient

client = MlflowClient()
experiment = client.get_experiment_by_name("/Users/mj/churn-prediction")
runs = client.search_runs(
    experiment_ids=[experiment.experiment_id],
    order_by=["metrics.f1_score DESC"]
)

for run in runs[:5]:
    print(f"Run: {run.info.run_id}, F1: {run.data.metrics['f1_score']:.4f}")
```

## Model Registry

```python
# Register best model
model_uri = f"runs:/{best_run_id}/model"
model_details = mlflow.register_model(model_uri, "churn-prediction-model")

# Transition to production
client.transition_model_version_stage(
    name="churn-prediction-model",
    version=model_details.version,
    stage="Production"
)
```

## Loading Production Model

```python
# Load from registry
model = mlflow.pyfunc.load_model("models:/churn-prediction-model/Production")
predictions = model.predict(new_data)
```

MLflow makes ML experiments reproducible and models traceable.
