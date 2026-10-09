---
title: Model Management with Azure ML Model Registry
description: "The Model Registry is the cornerstone of production ML. It provides the governance and traceability needed to confidently deploy and manage models at scale."
author: Michael John Pena
draft: false
date: 2021-09-07
tags:
  - Azure
  - Machine Learning
  - MLOps
  - Model Registry
  - Model Versioning
---

## Why Use a Model Registry?

1. **Version Control**: Track model iterations
2. **Lineage**: Know which data and code produced each model
3. **Governance**: Control who can deploy models
4. **Collaboration**: Share models across teams
5. **Deployment**: Seamless integration with deployment targets

## Registering Models

### From a Training Job

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Model
from azure.ai.ml.constants import AssetTypes
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="myresourcegroup",
    workspace_name="myworkspace"
)

# Get the completed training job
job = ml_client.jobs.get("training-job-name")

# Register model from job output
model = Model(
    path=f"azureml://jobs/{job.name}/outputs/model",
    name="customer-churn-predictor",
    description="Predicts customer churn based on usage patterns",
    type=AssetTypes.MLFLOW_MODEL,
    properties={
        "accuracy": "0.92",
        "framework": "scikit-learn",
        "algorithm": "RandomForest"
    },
    tags={
        "task": "classification",
        "domain": "customer-analytics"
    }
)

registered_model = ml_client.models.create_or_update(model)
print(f"Model registered: {registered_model.name}, version: {registered_model.version}")
```

### From Local Files

```python
from azure.ai.ml.entities import Model
from azure.ai.ml.constants import AssetTypes

# Register from local path
local_model = Model(
    path="./outputs/model",
    name="sentiment-analyzer",
    description="Sentiment analysis model for product reviews",
    type=AssetTypes.CUSTOM_MODEL
)

registered = ml_client.models.create_or_update(local_model)
```

### Registering MLflow Models

```python
import mlflow
from mlflow.tracking import MlflowClient

# During training, log the model
with mlflow.start_run():
    # Train your model
    model = train_model(X_train, y_train)

    # Log model to MLflow
    mlflow.sklearn.log_model(
        model,
        "model",
        registered_model_name="churn-predictor-mlflow"
    )

    # Log metrics
    mlflow.log_metric("accuracy", accuracy)
    mlflow.log_param("n_estimators", 100)
```

## Model Versioning

```python
# List all versions of a model
models = ml_client.models.list(name="customer-churn-predictor")
for m in models:
    print(f"Version: {m.version}, Created: {m.creation_context.created_at}")

# Get specific version
model_v1 = ml_client.models.get(name="customer-churn-predictor", version="1")
model_latest = ml_client.models.get(name="customer-churn-predictor", label="latest")

# Archive old versions
ml_client.models.archive(name="customer-churn-predictor", version="1")
```

## Model Lineage Tracking

```python
# When registering from a job, lineage is automatic
model = ml_client.models.get(name="customer-churn-predictor", version="2")

# View lineage information
print(f"Created by job: {model.job_name}")
print(f"Created at: {model.creation_context.created_at}")
print(f"Created by: {model.creation_context.created_by}")

# View associated run metrics (if MLflow model)
if model.type == AssetTypes.MLFLOW_MODEL:
    mlflow_client = MlflowClient()
    run = mlflow_client.get_run(model.run_id)
    print(f"Metrics: {run.data.metrics}")
    print(f"Parameters: {run.data.params}")
```

## Model Metadata and Documentation

```python
from azure.ai.ml.entities import Model

# Register with comprehensive metadata
model = Model(
    path="azureml://jobs/training-run/outputs/model",
    name="fraud-detector",
    description="""
    Fraud detection model for real-time transaction scoring.

    ## Input Features
    - transaction_amount: float
    - merchant_category: string
    - user_history_score: float
    - time_since_last_transaction: int

    ## Output
    - fraud_probability: float (0-1)
    - fraud_label: bool

    ## Performance
    - AUC-ROC: 0.95
    - Precision@0.5: 0.87
    - Recall@0.5: 0.82
    """,
    type=AssetTypes.MLFLOW_MODEL,
    properties={
        "auc_roc": "0.95",
        "precision": "0.87",
        "recall": "0.82",
        "training_data_version": "v2.1",
        "feature_count": "45"
    },
    tags={
        "use_case": "fraud-detection",
        "team": "risk-analytics",
        "environment": "production-ready",
        "compliance": "pci-dss"
    }
)

ml_client.models.create_or_update(model)
```

## Comparing Model Versions

```python
def compare_model_versions(ml_client, model_name: str, versions: list):
    """Compare metrics across model versions"""
    comparison = []

    for version in versions:
        model = ml_client.models.get(name=model_name, version=version)
        comparison.append({
            "version": version,
            "created": model.creation_context.created_at,
            **model.properties
        })

    import pandas as pd
    df = pd.DataFrame(comparison)
    return df

# Compare versions
comparison = compare_model_versions(
    ml_client,
    "customer-churn-predictor",
    versions=["1", "2", "3"]
)
print(comparison)
```

## Model Download and Export

```python
# Download model to local path
model = ml_client.models.get(name="customer-churn-predictor", version="2")
ml_client.models.download(name=model.name, version=model.version, download_path="./local_model")

# The model files are now available locally
import joblib
loaded_model = joblib.load("./local_model/model/model.pkl")
```

## Model Promotion Workflow

```python
def promote_model(ml_client, model_name: str, version: str, target_stage: str):
    """Promote model through stages: dev -> staging -> production"""
    model = ml_client.models.get(name=model_name, version=version)

    # Update tags to reflect stage
    model.tags["stage"] = target_stage
    model.tags["promoted_at"] = datetime.now().isoformat()

    ml_client.models.create_or_update(model)

    print(f"Model {model_name} v{version} promoted to {target_stage}")

# Promotion workflow
promote_model(ml_client, "fraud-detector", "3", "staging")

# After validation
promote_model(ml_client, "fraud-detector", "3", "production")
```

## Finding Production Models

```python
def get_production_models(ml_client):
    """Find all models tagged for production"""
    all_models = []

    # List all model names
    for model in ml_client.models.list():
        if model.tags.get("stage") == "production":
            all_models.append({
                "name": model.name,
                "version": model.version,
                "promoted_at": model.tags.get("promoted_at")
            })

    return all_models

production_models = get_production_models(ml_client)
for m in production_models:
    print(f"{m['name']} v{m['version']}")
```

## Best Practices

1. **Meaningful Names**: Use descriptive model names reflecting use case
2. **Rich Metadata**: Always include metrics, parameters, and documentation
3. **Consistent Tagging**: Use standard tags for stage, team, and compliance
4. **Version Everything**: Never overwrite; create new versions
5. **Link to Data**: Track which dataset version trained each model
6. **Automate Registration**: Register models automatically from CI/CD

The Model Registry is the cornerstone of production ML. It provides the governance and traceability needed to confidently deploy and manage models at scale.
