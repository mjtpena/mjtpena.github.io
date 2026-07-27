---
title: MLflow Integration with Azure Databricks for MLOps
author: Michael John Peña
draft: false
date: 2021-02-08
url: /blog/databricks-mlflow-integration/
tags:
  - Azure
  - Databricks
  - MLflow
  - MLOps
  - Machine Learning
---

MLflow is the closest thing to a standard the ML tooling space has right now—experiment tracking, run metadata, model registry, and a deployment abstraction that works across frameworks. Databricks acquired MLflow and built the tightest integration on the market. Run tracking writes to the MLflow server that's already there, Model Registry handles approval and staging transitions, and the `mlflow.databricks` integration lets you serve a registered model through REST in minutes. Today I'm walking through the patterns that make MLflow useful beyond "track my loss curve."

## Understanding MLflow Components

MLflow consists of four main components:

1. **MLflow Tracking** - Record and query experiments: code, data, config, results
2. **MLflow Projects** - Package data science code in a reusable format
3. **MLflow Models** - Deploy models in diverse serving environments
4. **MLflow Model Registry** - Centralize model management with versioning

## Setting Up MLflow in Databricks

Azure Databricks comes with MLflow pre-installed. Let's start with a basic tracking example:

```python
import mlflow
import mlflow.sklearn
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
import pandas as pd
import numpy as np

# Load sample data
from sklearn.datasets import load_iris
iris = load_iris()
X = pd.DataFrame(iris.data, columns=iris.feature_names)
y = iris.target

# Split the data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Set experiment name
mlflow.set_experiment("/Users/your-email/iris-classification")

# Start MLflow run
with mlflow.start_run(run_name="random-forest-baseline"):
    # Define parameters
    params = {
        "n_estimators": 100,
        "max_depth": 5,
        "min_samples_split": 2,
        "random_state": 42
    }

    # Log parameters
    mlflow.log_params(params)

    # Train model
    model = RandomForestClassifier(**params)
    model.fit(X_train, y_train)

    # Make predictions
    predictions = model.predict(X_test)

    # Calculate metrics
    accuracy = accuracy_score(y_test, predictions)
    precision = precision_score(y_test, predictions, average='weighted')
    recall = recall_score(y_test, predictions, average='weighted')
    f1 = f1_score(y_test, predictions, average='weighted')

    # Log metrics
    mlflow.log_metrics({
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1_score": f1
    })

    # Log model
    mlflow.sklearn.log_model(
        model,
        "model",
        registered_model_name="IrisClassifier"
    )

    # Log feature importance
    feature_importance = pd.DataFrame({
        'feature': iris.feature_names,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)

    mlflow.log_table(feature_importance, "feature_importance.json")

    print(f"Model accuracy: {accuracy:.4f}")
```

## Hyperparameter Tuning with MLflow

Track hyperparameter tuning experiments:

```python
from sklearn.model_selection import GridSearchCV
import mlflow

def train_with_hyperparameters(X_train, y_train, X_test, y_test):
    """Run hyperparameter tuning with MLflow tracking."""

    mlflow.set_experiment("/Users/your-email/iris-hyperparameter-tuning")

    # Define parameter grid
    param_grid = {
        'n_estimators': [50, 100, 200],
        'max_depth': [3, 5, 10, None],
        'min_samples_split': [2, 5, 10],
        'min_samples_leaf': [1, 2, 4]
    }

    # Parent run for the entire tuning process
    with mlflow.start_run(run_name="hyperparameter-tuning"):
        mlflow.log_param("tuning_method", "GridSearchCV")
        mlflow.log_param("cv_folds", 5)

        rf = RandomForestClassifier(random_state=42)
        grid_search = GridSearchCV(
            rf, param_grid, cv=5, scoring='accuracy', n_jobs=-1, verbose=1
        )

        grid_search.fit(X_train, y_train)

        # Log best parameters
        mlflow.log_params({f"best_{k}": v for k, v in grid_search.best_params_.items()})
        mlflow.log_metric("best_cv_score", grid_search.best_score_)

        # Evaluate on test set
        best_model = grid_search.best_estimator_
        test_predictions = best_model.predict(X_test)
        test_accuracy = accuracy_score(y_test, test_predictions)

        mlflow.log_metric("test_accuracy", test_accuracy)

        # Log the best model
        mlflow.sklearn.log_model(
            best_model,
            "best_model",
            registered_model_name="IrisClassifier-Tuned"
        )

        # Log all trial results as a table
        results_df = pd.DataFrame(grid_search.cv_results_)
        results_df = results_df[['params', 'mean_test_score', 'std_test_score', 'rank_test_score']]
        results_df = results_df.sort_values('rank_test_score')

        mlflow.log_table(results_df, "cv_results.json")

        # Create nested runs for top 5 configurations
        top_5 = results_df.head(5)
        for idx, row in top_5.iterrows():
            with mlflow.start_run(run_name=f"config-rank-{row['rank_test_score']}", nested=True):
                params = row['params']
                mlflow.log_params(params)
                mlflow.log_metric("cv_mean_score", row['mean_test_score'])
                mlflow.log_metric("cv_std_score", row['std_test_score'])

        return best_model, grid_search.best_params_

# Run tuning
best_model, best_params = train_with_hyperparameters(X_train, y_train, X_test, y_test)
print(f"Best parameters: {best_params}")
```

## Model Registry

Use the Model Registry to manage model versions and transitions:

```python
from mlflow.tracking import MlflowClient

client = MlflowClient()

def register_model_version(model_name, run_id, stage="Staging"):
    """Register a model version and transition to specified stage."""

    # Get the model URI from the run
    model_uri = f"runs:/{run_id}/model"

    # Register the model
    result = mlflow.register_model(model_uri, model_name)

    # Wait for registration
    from mlflow.tracking.client import MlflowClient
    from mlflow.entities.model_registry.model_version_status import ModelVersionStatus

    client = MlflowClient()

    # Check status
    version = result.version
    while True:
        model_version = client.get_model_version(model_name, version)
        if model_version.status == ModelVersionStatus.READY:
            break

    # Transition to staging
    client.transition_model_version_stage(
        name=model_name,
        version=version,
        stage=stage,
        archive_existing_versions=False
    )

    # Add description
    client.update_model_version(
        name=model_name,
        version=version,
        description=f"Model trained on {pd.Timestamp.now()}"
    )

    return version

def promote_model_to_production(model_name, version):
    """Promote a model version to production."""

    client = MlflowClient()

    # Archive existing production models
    for mv in client.search_model_versions(f"name='{model_name}'"):
        if mv.current_stage == "Production":
            client.transition_model_version_stage(
                name=model_name,
                version=mv.version,
                stage="Archived"
            )

    # Promote to production
    client.transition_model_version_stage(
        name=model_name,
        version=version,
        stage="Production"
    )

    print(f"Model {model_name} version {version} promoted to Production")

def load_production_model(model_name):
    """Load the production version of a model."""

    model_uri = f"models:/{model_name}/Production"
    model = mlflow.sklearn.load_model(model_uri)

    return model

# Usage
# register_model_version("IrisClassifier", "abc123", "Staging")
# promote_model_to_production("IrisClassifier", "1")
# model = load_production_model("IrisClassifier")
```

## Automated Model Validation

Create a validation pipeline before promoting models:

```python
def validate_model(model_name, version, validation_data, validation_labels, thresholds):
    """
    Validate a model against defined thresholds before promotion.

    Args:
        model_name: Name of the registered model
        version: Version to validate
        validation_data: Validation features
        validation_labels: Validation labels
        thresholds: Dict of metric thresholds

    Returns:
        Tuple of (passed, results_dict)
    """

    # Load the model
    model_uri = f"models:/{model_name}/{version}"
    model = mlflow.sklearn.load_model(model_uri)

    # Make predictions
    predictions = model.predict(validation_data)

    # Calculate metrics
    results = {
        "accuracy": accuracy_score(validation_labels, predictions),
        "precision": precision_score(validation_labels, predictions, average='weighted'),
        "recall": recall_score(validation_labels, predictions, average='weighted'),
        "f1_score": f1_score(validation_labels, predictions, average='weighted')
    }

    # Check against thresholds
    passed = True
    for metric, threshold in thresholds.items():
        if results.get(metric, 0) < threshold:
            passed = False
            print(f"FAILED: {metric} = {results[metric]:.4f} < {threshold}")
        else:
            print(f"PASSED: {metric} = {results[metric]:.4f} >= {threshold}")

    # Log validation results
    with mlflow.start_run(run_name=f"validation-{model_name}-v{version}"):
        mlflow.log_params({"model_name": model_name, "version": version})
        mlflow.log_metrics(results)
        mlflow.log_param("validation_passed", passed)

    return passed, results

# Define validation thresholds
thresholds = {
    "accuracy": 0.90,
    "precision": 0.85,
    "recall": 0.85,
    "f1_score": 0.85
}

# Run validation
# passed, results = validate_model("IrisClassifier", "1", X_test, y_test, thresholds)
# if passed:
#     promote_model_to_production("IrisClassifier", "1")
```

## MLflow Projects

Package your code as an MLflow Project for reproducibility:

```yaml
# MLproject file
name: iris-classification

conda_env: conda.yaml

entry_points:
  main:
    parameters:
      n_estimators: {type: int, default: 100}
      max_depth: {type: int, default: 5}
      data_path: {type: string, default: "data/iris.csv"}
    command: "python train.py --n_estimators {n_estimators} --max_depth {max_depth} --data_path {data_path}"

  validate:
    parameters:
      model_name: {type: string}
      version: {type: string}
    command: "python validate.py --model_name {model_name} --version {version}"
```

```yaml
# conda.yaml
name: iris-classification
channels:
  - defaults
  - conda-forge
dependencies:
  - python=3.8
  - scikit-learn=0.24
  - pandas=1.2
  - pip:
    - mlflow>=1.13
    - azureml-mlflow
```

Run the project:

```python
# Run MLflow project
mlflow.run(
    uri=".",  # or a git URL
    entry_point="main",
    parameters={
        "n_estimators": 200,
        "max_depth": 10
    },
    experiment_name="/Users/your-email/iris-project-runs"
)
```

## Model Serving with Databricks

Deploy models for real-time inference:

```python
# Enable model serving in Databricks
import mlflow.deployments

# Get deployment client
client = mlflow.deployments.get_deploy_client("databricks")

# Create endpoint
endpoint = client.create_endpoint(
    name="iris-classifier-endpoint",
    config={
        "served_models": [{
            "model_name": "IrisClassifier",
            "model_version": "1",
            "workload_size": "Small",
            "scale_to_zero_enabled": True
        }]
    }
)

# Make predictions
import requests
import json

def predict(features):
    """Make predictions using the deployed model."""

    endpoint_url = "https://your-workspace.azuredatabricks.net/serving-endpoints/iris-classifier-endpoint/invocations"

    headers = {
        "Authorization": f"Bearer {dbutils.secrets.get('scope', 'token')}",
        "Content-Type": "application/json"
    }

    data = {
        "dataframe_records": features.to_dict('records')
    }

    response = requests.post(endpoint_url, headers=headers, json=data)
    return response.json()

# Example prediction
# sample = X_test.head(5)
# predictions = predict(sample)
```

## Batch Inference with Spark

For large-scale batch predictions:

```python
from pyspark.sql.functions import struct, col
import mlflow.pyfunc

# Load model as a Spark UDF
model_uri = "models:/IrisClassifier/Production"
predict_udf = mlflow.pyfunc.spark_udf(spark, model_uri, result_type="int")

# Apply to DataFrame
spark_df = spark.createDataFrame(X_test)

predictions_df = spark_df.withColumn(
    "prediction",
    predict_udf(struct([col(c) for c in spark_df.columns]))
)

predictions_df.show()

# Save predictions
predictions_df.write.format("delta").mode("overwrite").save("/mnt/predictions/iris")
```

## Conclusion

MLflow on Azure Databricks provides a comprehensive platform for managing the ML lifecycle. By combining experiment tracking, model registry, and deployment capabilities, you can build robust MLOps pipelines that ensure reproducibility, governance, and scalability.

Key takeaways:
- Track all experiments with parameters, metrics, and artifacts
- Use the Model Registry for version control and stage transitions
- Implement validation pipelines before production promotion
- Package code as MLflow Projects for reproducibility
- Deploy models for both real-time and batch inference

Start with experiment tracking and gradually adopt more MLflow features as your ML practice matures.
