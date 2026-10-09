---
title: MLflow Experiments - Tracking and Managing Machine Learning Models
description: "MLflow became the experiment tracking tool I recommend to every ML team regardless of their cloud platform choice. The core value proposition is simple…"
author: Michael John Peña
draft: false
date: 2021-04-21
url: /blog/mlflow-experiment-tracking-model-management/
tags:
  - MLflow
  - Machine Learning
  - MLOps
  - Model Management
  - Databricks
---

MLflow became the experiment tracking tool I recommend to every ML team regardless of their cloud platform choice. The core value proposition is simple: every training run logs parameters, metrics, and artefacts, and the UI lets you compare runs at a glance. The model registry adds a promotion workflow—from experiment run to staging to production—with model versioning and transition history. In Azure ML, MLflow is the default tracking backend; in Databricks, the managed MLflow server is built in. The habit that makes it worth the initial setup effort: logging runs consistently, including failed experiments, so that "why did we pick this model?" has a documented answer six months later.

## Understanding MLflow Components

MLflow consists of four main components:

1. **MLflow Tracking** - Log parameters, metrics, and artifacts
2. **MLflow Projects** - Package code for reproducibility
3. **MLflow Models** - Standard format for model packaging
4. **MLflow Model Registry** - Centralized model store with versioning

## Setting Up MLflow

### Local Setup

```python
import mlflow
import mlflow.sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score

# Set tracking URI (local or remote)
mlflow.set_tracking_uri("sqlite:///mlflow.db")  # Local SQLite
# mlflow.set_tracking_uri("https://mlflow.company.com")  # Remote server

# Create or set experiment
mlflow.set_experiment("customer-churn-prediction")
```

### Databricks Setup

```python
# In Databricks, MLflow is pre-configured
# Just set the experiment
mlflow.set_experiment("/Users/username/experiments/customer-churn")

# Or use workspace path
experiment_path = "/Shared/experiments/customer-churn"
mlflow.set_experiment(experiment_path)
```

## Experiment Tracking

### Basic Tracking

```python
import mlflow
import mlflow.sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

# Load data
iris = load_iris()
X_train, X_test, y_train, y_test = train_test_split(
    iris.data, iris.target, test_size=0.2, random_state=42
)

# Start MLflow run
with mlflow.start_run(run_name="random-forest-baseline"):
    # Log parameters
    n_estimators = 100
    max_depth = 5

    mlflow.log_param("n_estimators", n_estimators)
    mlflow.log_param("max_depth", max_depth)
    mlflow.log_param("random_state", 42)

    # Train model
    model = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=42
    )
    model.fit(X_train, y_train)

    # Make predictions
    predictions = model.predict(X_test)

    # Log metrics
    accuracy = accuracy_score(y_test, predictions)
    mlflow.log_metric("accuracy", accuracy)

    # Log model
    mlflow.sklearn.log_model(model, "model")

    print(f"Run ID: {mlflow.active_run().info.run_id}")
    print(f"Accuracy: {accuracy:.4f}")
```

### Advanced Tracking with Artifacts

```python
import mlflow
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.metrics import confusion_matrix, classification_report
import seaborn as sns
import json

with mlflow.start_run(run_name="detailed-experiment"):
    # Log parameters (can use dict)
    params = {
        "n_estimators": 200,
        "max_depth": 10,
        "min_samples_split": 5,
        "min_samples_leaf": 2,
        "class_weight": "balanced"
    }
    mlflow.log_params(params)

    # Train model
    model = RandomForestClassifier(**params, random_state=42)
    model.fit(X_train, y_train)

    # Predictions
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)

    # Log multiple metrics
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "precision_macro": precision_score(y_test, y_pred, average='macro'),
        "recall_macro": recall_score(y_test, y_pred, average='macro'),
        "f1_macro": f1_score(y_test, y_pred, average='macro')
    }
    mlflow.log_metrics(metrics)

    # Log confusion matrix as artifact
    cm = confusion_matrix(y_test, y_pred)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues')
    plt.title('Confusion Matrix')
    plt.ylabel('Actual')
    plt.xlabel('Predicted')
    plt.savefig("confusion_matrix.png")
    mlflow.log_artifact("confusion_matrix.png")
    plt.close()

    # Log classification report
    report = classification_report(y_test, y_pred, output_dict=True)
    with open("classification_report.json", "w") as f:
        json.dump(report, f, indent=2)
    mlflow.log_artifact("classification_report.json")

    # Log feature importance
    feature_importance = pd.DataFrame({
        'feature': iris.feature_names,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)

    feature_importance.to_csv("feature_importance.csv", index=False)
    mlflow.log_artifact("feature_importance.csv")

    # Log model with signature
    from mlflow.models.signature import infer_signature
    signature = infer_signature(X_train, model.predict(X_train))

    mlflow.sklearn.log_model(
        model,
        "model",
        signature=signature,
        input_example=X_train[:5]
    )
```

### Nested Runs for Hyperparameter Tuning

```python
from sklearn.model_selection import GridSearchCV

param_grid = {
    'n_estimators': [50, 100, 200],
    'max_depth': [5, 10, 15],
    'min_samples_split': [2, 5, 10]
}

with mlflow.start_run(run_name="hyperparameter-search"):
    mlflow.log_param("search_method", "grid_search")
    mlflow.log_param("cv_folds", 5)

    best_accuracy = 0
    best_params = None

    for n_est in param_grid['n_estimators']:
        for depth in param_grid['max_depth']:
            for min_split in param_grid['min_samples_split']:

                # Nested run for each combination
                with mlflow.start_run(run_name=f"rf_{n_est}_{depth}_{min_split}", nested=True):
                    params = {
                        'n_estimators': n_est,
                        'max_depth': depth,
                        'min_samples_split': min_split
                    }
                    mlflow.log_params(params)

                    model = RandomForestClassifier(**params, random_state=42)
                    model.fit(X_train, y_train)

                    accuracy = accuracy_score(y_test, model.predict(X_test))
                    mlflow.log_metric("accuracy", accuracy)

                    if accuracy > best_accuracy:
                        best_accuracy = accuracy
                        best_params = params

    # Log best results in parent run
    mlflow.log_metric("best_accuracy", best_accuracy)
    mlflow.log_params({f"best_{k}": v for k, v in best_params.items()})
```

## MLflow Projects

### MLproject File

```yaml
# MLproject
name: customer-churn-model

conda_env: conda.yaml

entry_points:
  main:
    parameters:
      data_path: {type: string, default: "data/train.csv"}
      n_estimators: {type: int, default: 100}
      max_depth: {type: int, default: 10}
      output_path: {type: string, default: "models/"}
    command: "python train.py --data-path {data_path} --n-estimators {n_estimators} --max-depth {max_depth} --output-path {output_path}"

  preprocess:
    parameters:
      input_path: {type: string}
      output_path: {type: string}
    command: "python preprocess.py --input {input_path} --output {output_path}"
```

### Running Projects

```python
# Run locally
mlflow.run(
    uri=".",
    entry_point="main",
    parameters={
        "data_path": "data/train.csv",
        "n_estimators": 200,
        "max_depth": 15
    }
)

# Run from Git
mlflow.run(
    uri="https://github.com/company/ml-project",
    entry_point="main",
    version="v1.0",
    parameters={"data_path": "/mnt/data/train.csv"}
)
```

## Model Registry

### Register a Model

```python
# Register during training
with mlflow.start_run():
    # ... training code ...

    mlflow.sklearn.log_model(
        model,
        "model",
        registered_model_name="customer-churn-model"
    )

# Or register an existing run
result = mlflow.register_model(
    "runs:/abc123def456/model",
    "customer-churn-model"
)
print(f"Registered version: {result.version}")
```

### Model Versioning and Stages

```python
from mlflow.tracking import MlflowClient

client = MlflowClient()

# Get model versions
model_name = "customer-churn-model"
versions = client.search_model_versions(f"name='{model_name}'")

for v in versions:
    print(f"Version {v.version}: {v.current_stage}")

# Transition model to staging
client.transition_model_version_stage(
    name=model_name,
    version=2,
    stage="Staging"
)

# Transition to production
client.transition_model_version_stage(
    name=model_name,
    version=2,
    stage="Production",
    archive_existing_versions=True
)

# Add description
client.update_model_version(
    name=model_name,
    version=2,
    description="Improved model with feature engineering"
)

# Set tags
client.set_model_version_tag(
    name=model_name,
    version=2,
    key="validation_status",
    value="approved"
)
```

### Loading Models from Registry

```python
import mlflow.pyfunc

# Load by version
model = mlflow.pyfunc.load_model("models:/customer-churn-model/2")

# Load by stage
model_staging = mlflow.pyfunc.load_model("models:/customer-churn-model/Staging")
model_prod = mlflow.pyfunc.load_model("models:/customer-churn-model/Production")

# Make predictions
predictions = model_prod.predict(X_new)
```

## Custom Model Flavors

### Creating a Custom Model

```python
import mlflow.pyfunc

class ChurnPredictor(mlflow.pyfunc.PythonModel):
    """Custom model wrapper with preprocessing."""

    def __init__(self, preprocessor, model, threshold=0.5):
        self.preprocessor = preprocessor
        self.model = model
        self.threshold = threshold

    def predict(self, context, model_input):
        # Apply preprocessing
        processed = self.preprocessor.transform(model_input)

        # Get probabilities
        probabilities = self.model.predict_proba(processed)[:, 1]

        # Apply threshold
        predictions = (probabilities >= self.threshold).astype(int)

        return pd.DataFrame({
            'prediction': predictions,
            'probability': probabilities
        })


# Log custom model
with mlflow.start_run():
    custom_model = ChurnPredictor(preprocessor, trained_model, threshold=0.6)

    mlflow.pyfunc.log_model(
        artifact_path="custom_model",
        python_model=custom_model,
        conda_env={
            'channels': ['conda-forge'],
            'dependencies': [
                'python=3.8',
                'scikit-learn=0.24',
                'pandas=1.2',
                {'pip': ['mlflow']}
            ]
        },
        code_path=["src/"],  # Include source code
        registered_model_name="churn-predictor-custom"
    )
```

## Querying Experiments

```python
from mlflow.tracking import MlflowClient

client = MlflowClient()

# Search runs
runs = mlflow.search_runs(
    experiment_names=["customer-churn-prediction"],
    filter_string="metrics.accuracy > 0.85 AND params.n_estimators = '200'",
    order_by=["metrics.accuracy DESC"],
    max_results=10
)

print(runs[['run_id', 'params.n_estimators', 'metrics.accuracy']])

# Get best run
best_run = runs.iloc[0]
print(f"Best run: {best_run['run_id']}")
print(f"Accuracy: {best_run['metrics.accuracy']}")

# Load best model
best_model = mlflow.sklearn.load_model(f"runs:/{best_run['run_id']}/model")
```

## Integration with CI/CD

### GitHub Actions Workflow

```yaml
# .github/workflows/ml-pipeline.yml
name: ML Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  train-and-evaluate:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2

    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: '3.8'

    - name: Install dependencies
      run: |
        pip install mlflow scikit-learn pandas

    - name: Run training
      env:
        MLFLOW_TRACKING_URI: ${{ secrets.MLFLOW_TRACKING_URI }}
        MLFLOW_TRACKING_USERNAME: ${{ secrets.MLFLOW_TRACKING_USERNAME }}
        MLFLOW_TRACKING_PASSWORD: ${{ secrets.MLFLOW_TRACKING_PASSWORD }}
      run: |
        python train.py --experiment "ci-cd-pipeline"

    - name: Evaluate model
      run: |
        python evaluate.py --min-accuracy 0.85
```

## Best Practices

1. **Use consistent naming** for experiments and runs
2. **Log all relevant parameters** - reproducibility is key
3. **Track metrics over time** - use `mlflow.log_metric(key, value, step=epoch)`
4. **Store artifacts** - confusion matrices, feature importance, sample predictions
5. **Use model signatures** - validate input/output schemas
6. **Implement model staging** - Staging -> Production workflow
7. **Tag runs** - add metadata for filtering
8. **Clean up old runs** - implement retention policies

## Conclusion

MLflow provides essential infrastructure for machine learning projects, from experiment tracking to model deployment. By integrating MLflow into your workflow, you gain reproducibility, collaboration, and a clear path from experimentation to production. The Model Registry adds governance and versioning, making it easier to manage models at scale.
