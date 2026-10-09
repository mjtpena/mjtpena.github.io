---
title: "Unity Catalog for ML: Governed Machine Learning"
description: "Unity Catalog extends governance to machine learning assets. Manage models, features, and experiments with the same rigor as your data."
author: "Michael John Peña"
draft: false
date: 2024-04-25
tags: ["Databricks", "Unity Catalog", "MLOps", "Machine Learning", "Governance"]
---

Unity Catalog extends governance to machine learning assets. Manage models, features, and experiments with the same rigor as your data.

## Unity Catalog ML Components

```python
UNITY_CATALOG_ML = {
    "models": {
        "description": "Registered ML models with versioning",
        "features": [
            "Model versioning",
            "Stage transitions",
            "Model lineage",
            "Access control"
        ]
    },
    "features": {
        "description": "Feature tables for ML",
        "features": [
            "Feature definitions",
            "Feature serving",
            "Point-in-time lookups",
            "Online/offline serving"
        ]
    },
    "functions": {
        "description": "User-defined functions including ML",
        "features": [
            "Python UDFs",
            "Model inference UDFs",
            "Vectorized UDFs"
        ]
    }
}
```

## Registering Models in Unity Catalog

```python
import mlflow
from mlflow.tracking import MlflowClient

# Set registry URI to Unity Catalog
mlflow.set_registry_uri("databricks-uc")

# Train and log a model
with mlflow.start_run() as run:
    # Your training code here
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.datasets import load_iris

    X, y = load_iris(return_X_y=True)
    model = RandomForestClassifier(n_estimators=100)
    model.fit(X, y)

    # Log model to Unity Catalog
    mlflow.sklearn.log_model(
        model,
        artifact_path="model",
        registered_model_name="main.ml_models.iris_classifier"
    )

    # Log metrics
    mlflow.log_metric("accuracy", 0.95)

    # Log parameters
    mlflow.log_params({"n_estimators": 100, "max_depth": None})

print(f"Model logged with run ID: {run.info.run_id}")
```

## Model Versioning and Stages

```python
from mlflow.tracking import MlflowClient

client = MlflowClient()

# Get model details
model_name = "main.ml_models.iris_classifier"
model = client.get_registered_model(model_name)

print(f"Model: {model.name}")
print(f"Latest versions:")
for v in model.latest_versions:
    print(f"  Version {v.version}: {v.current_stage}")

# Transition model to production
client.transition_model_version_stage(
    name=model_name,
    version="1",
    stage="Production",
    archive_existing_versions=True
)

# Set model alias (new approach)
client.set_registered_model_alias(
    name=model_name,
    alias="champion",
    version="1"
)

# Load model by alias
model = mlflow.pyfunc.load_model(f"models:/{model_name}@champion")
```

## Model Lineage Tracking

```python
# Unity Catalog automatically tracks model lineage

# View lineage in code
from databricks.sdk import WorkspaceClient

client = WorkspaceClient()

# Get model lineage
def get_model_lineage(model_name: str, version: str) -> dict:
    """Get lineage information for a model version"""

    # Get the run that created this model version
    mlflow_client = MlflowClient()
    model_version = mlflow_client.get_model_version(model_name, version)
    run_id = model_version.run_id

    # Get run details
    run = mlflow_client.get_run(run_id)

    lineage = {
        "model_name": model_name,
        "version": version,
        "run_id": run_id,
        "experiment_id": run.info.experiment_id,
        "start_time": run.info.start_time,
        "user": run.info.user_id,
        "parameters": run.data.params,
        "metrics": run.data.metrics,
        "source_code": run.data.tags.get("mlflow.source.name"),
        "git_commit": run.data.tags.get("mlflow.source.git.commit")
    }

    # Get input datasets if logged
    if "mlflow.datasets" in run.data.tags:
        lineage["input_datasets"] = run.data.tags["mlflow.datasets"]

    return lineage

lineage = get_model_lineage("main.ml_models.iris_classifier", "1")
print(lineage)
```

## Model Serving from Unity Catalog

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import (
    EndpointCoreConfigInput,
    ServedEntityInput
)

client = WorkspaceClient()

# Create model serving endpoint
endpoint = client.serving_endpoints.create_and_wait(
    name="iris-classifier-endpoint",
    config=EndpointCoreConfigInput(
        served_entities=[
            ServedEntityInput(
                entity_name="main.ml_models.iris_classifier",
                entity_version="1",
                workload_size="Small",
                scale_to_zero_enabled=True
            )
        ]
    )
)

print(f"Endpoint created: {endpoint.name}")
print(f"URL: {endpoint.state.config_update}")
```

## Feature Engineering with Unity Catalog

```python
from databricks.feature_engineering import FeatureEngineeringClient

fe = FeatureEngineeringClient()

# Create a feature table
def create_customer_features(spark):
    """Create customer feature table"""

    # Compute features
    customer_features = spark.sql("""
        SELECT
            customer_id,
            COUNT(*) as total_orders,
            SUM(amount) as total_spend,
            AVG(amount) as avg_order_value,
            DATEDIFF(CURRENT_DATE, MAX(order_date)) as days_since_last_order,
            COUNT(DISTINCT product_category) as categories_purchased
        FROM orders
        GROUP BY customer_id
    """)

    # Create feature table in Unity Catalog
    fe.create_table(
        name="main.features.customer_features",
        primary_keys=["customer_id"],
        df=customer_features,
        description="Customer behavioral features for ML models"
    )

    return customer_features

# Write features
customer_features = create_customer_features(spark)

# Read features for training
training_set = fe.create_training_set(
    df=spark.table("main.ml_data.training_labels"),
    label="churn_label",
    feature_lookups=[
        FeatureLookup(
            table_name="main.features.customer_features",
            feature_names=["total_orders", "total_spend", "avg_order_value"],
            lookup_key="customer_id"
        )
    ]
)

training_df = training_set.load_df()
```

## Permissions and Access Control

```sql
-- Grant permissions on ML assets

-- Grant access to models
GRANT EXECUTE ON MODEL main.ml_models.iris_classifier TO `data-scientists`;
GRANT SELECT ON MODEL main.ml_models.iris_classifier TO `analysts`;

-- Grant access to feature tables
GRANT SELECT ON TABLE main.features.customer_features TO `ml-engineers`;
GRANT MODIFY ON TABLE main.features.customer_features TO `feature-engineers`;

-- Grant access to all models in a schema
GRANT EXECUTE ON ALL MODELS IN SCHEMA main.ml_models TO `ml-platform`;
```

## Model Monitoring with Unity Catalog

```python
from databricks.sdk import WorkspaceClient

def setup_model_monitoring(
    model_name: str,
    inference_table: str
):
    """Setup monitoring for a deployed model"""

    client = WorkspaceClient()

    # Create monitoring configuration
    # (Actual API may vary based on Databricks version)

    monitoring_config = {
        "model_name": model_name,
        "inference_table": inference_table,
        "metrics": [
            "prediction_drift",
            "feature_drift",
            "accuracy"  # If labels available
        ],
        "alert_thresholds": {
            "prediction_drift": 0.1,
            "feature_drift": 0.15
        },
        "schedule": "0 */6 * * *"  # Every 6 hours
    }

    return monitoring_config

# Log inference results for monitoring
def log_inference(
    model_name: str,
    features: dict,
    prediction: any,
    timestamp: str
):
    """Log inference for monitoring"""

    # Write to inference table
    inference_record = {
        "model_name": model_name,
        "timestamp": timestamp,
        "features": features,
        "prediction": prediction
    }

    # Append to Delta table
    spark.createDataFrame([inference_record]).write \
        .mode("append") \
        .saveAsTable("main.monitoring.inference_logs")
```

## Conclusion

Unity Catalog brings enterprise governance to ML assets. Register models, manage features, and control access with a unified approach that spans data and ML lifecycle management.
