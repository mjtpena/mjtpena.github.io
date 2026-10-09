---
title: "MLflow Model Registry: Versioning and Deploying ML Models"
author: Michael John Peña
draft: false
date: 2022-03-18
tags:
  - Azure
  - Databricks
  - MLflow
  - Model Registry
  - MLOps
---

## Model Registry Concepts

The registry organizes models with:
- **Registered Models**: Named model artifacts
- **Model Versions**: Specific iterations of a model
- **Stages**: Lifecycle states (None, Staging, Production, Archived)
- **Aliases**: Named references to specific versions

## Registering Models

### From an MLflow Run

```python
import mlflow
from mlflow.tracking import MlflowClient

# Log and register in one step
with mlflow.start_run() as run:
    model = train_model(X_train, y_train)

    mlflow.sklearn.log_model(
        model,
        "model",
        registered_model_name="customer-churn-classifier"
    )

# Or register after training
model_uri = f"runs:/{run.info.run_id}/model"
model_details = mlflow.register_model(model_uri, "customer-churn-classifier")

print(f"Registered version: {model_details.version}")
```

### Using the Client API

```python
client = MlflowClient()

# Create a registered model
client.create_registered_model(
    name="fraud-detector",
    description="Real-time fraud detection model for transactions",
    tags={"team": "fraud-prevention", "domain": "risk"}
)

# Register a version
client.create_model_version(
    name="fraud-detector",
    source="runs:/abc123/model",
    run_id="abc123",
    description="XGBoost model with 95% recall"
)
```

## Managing Model Versions

```python
# Get model version details
version = client.get_model_version("customer-churn-classifier", "3")
print(f"Version: {version.version}")
print(f"Stage: {version.current_stage}")
print(f"Created: {version.creation_timestamp}")
print(f"Run ID: {version.run_id}")

# Update version description
client.update_model_version(
    name="customer-churn-classifier",
    version="3",
    description="Improved model with new features. AUC: 0.92"
)

# Add tags
client.set_model_version_tag(
    name="customer-churn-classifier",
    version="3",
    key="validation_status",
    value="passed"
)
```

## Stage Transitions

```python
# Move model through stages
def promote_model(model_name, version, target_stage):
    """Promote model version to a stage"""

    # Validate before promotion
    if target_stage == "Production":
        validation_result = validate_model(model_name, version)
        if not validation_result["passed"]:
            raise ValueError(f"Validation failed: {validation_result['errors']}")

    # Transition stage
    client.transition_model_version_stage(
        name=model_name,
        version=version,
        stage=target_stage,
        archive_existing_versions=True  # Archive current production model
    )

    # Log the transition
    client.set_model_version_tag(
        name=model_name,
        version=version,
        key=f"promoted_to_{target_stage.lower()}",
        value=datetime.now().isoformat()
    )

    print(f"Model {model_name} v{version} promoted to {target_stage}")

# Promotion workflow
promote_model("customer-churn-classifier", "3", "Staging")
# After validation...
promote_model("customer-churn-classifier", "3", "Production")
```

## Using Model Aliases

```python
# Aliases provide named references (new in MLflow 2.0+)
client.set_registered_model_alias(
    name="customer-churn-classifier",
    alias="champion",
    version="3"
)

# Load model by alias
model = mlflow.sklearn.load_model("models:/customer-churn-classifier@champion")

# Update alias to point to new version (instant switch)
client.set_registered_model_alias(
    name="customer-churn-classifier",
    alias="champion",
    version="4"
)

# Useful aliases
# @champion - Current production model
# @challenger - Model being validated
# @rollback - Previous known-good version
```

## Model Validation

```python
def validate_model(model_name, version):
    """Validate model before production deployment"""

    model = mlflow.sklearn.load_model(f"models:/{model_name}/{version}")
    validation_data = load_validation_data()

    results = {
        "passed": True,
        "errors": [],
        "metrics": {}
    }

    # 1. Performance validation
    predictions = model.predict(validation_data["X"])
    metrics = calculate_metrics(validation_data["y"], predictions)
    results["metrics"] = metrics

    if metrics["auc"] < 0.85:
        results["errors"].append(f"AUC too low: {metrics['auc']}")
        results["passed"] = False

    # 2. Prediction latency validation
    import time
    latencies = []
    for _ in range(100):
        start = time.time()
        model.predict(validation_data["X"][:10])
        latencies.append(time.time() - start)

    avg_latency = sum(latencies) / len(latencies)
    results["metrics"]["avg_latency_ms"] = avg_latency * 1000

    if avg_latency > 0.1:  # 100ms threshold
        results["errors"].append(f"Latency too high: {avg_latency*1000:.2f}ms")
        results["passed"] = False

    # 3. Prediction distribution validation
    pred_mean = predictions.mean()
    if abs(pred_mean - 0.15) > 0.05:  # Expected ~15% churn rate
        results["errors"].append(f"Unusual prediction distribution: mean={pred_mean}")
        results["passed"] = False

    return results

# Validation workflow
validation_result = validate_model("customer-churn-classifier", "4")
if validation_result["passed"]:
    promote_model("customer-churn-classifier", "4", "Production")
else:
    print(f"Validation failed: {validation_result['errors']}")
```

## Automated CI/CD Integration

```python
# GitHub Actions / Azure DevOps integration
import requests
import os

def trigger_model_deployment(model_name, version, environment):
    """Trigger deployment pipeline"""

    # Azure DevOps
    pipeline_url = f"https://dev.azure.com/{org}/{project}/_apis/pipelines/{pipeline_id}/runs"

    payload = {
        "templateParameters": {
            "model_name": model_name,
            "model_version": version,
            "environment": environment
        }
    }

    response = requests.post(
        pipeline_url,
        headers={
            "Authorization": f"Basic {os.environ['ADO_PAT']}",
            "Content-Type": "application/json"
        },
        json=payload
    )

    return response.json()

# Webhook handler for model registry events
from flask import Flask, request

app = Flask(__name__)

@app.route('/model-webhook', methods=['POST'])
def handle_model_event():
    event = request.json

    if event['event_type'] == 'MODEL_VERSION_TRANSITIONED_STAGE':
        model_name = event['model_name']
        version = event['version']
        new_stage = event['to_stage']

        if new_stage == 'Production':
            trigger_model_deployment(model_name, version, 'production')

    return {'status': 'ok'}
```

## Comparing Model Versions

```python
def compare_models(model_name, versions):
    """Compare metrics across model versions"""

    comparison = []

    for version in versions:
        # Get version details
        mv = client.get_model_version(model_name, version)
        run = client.get_run(mv.run_id)

        comparison.append({
            "version": version,
            "stage": mv.current_stage,
            "created": mv.creation_timestamp,
            "metrics": run.data.metrics,
            "params": run.data.params
        })

    # Create comparison DataFrame
    comparison_df = pd.DataFrame(comparison)
    return comparison_df

# Compare versions
comparison = compare_models("customer-churn-classifier", ["1", "2", "3", "4"])
print(comparison[["version", "stage", "metrics.auc", "metrics.f1"]])
```

## Model Lineage

```python
def get_model_lineage(model_name, version):
    """Get complete lineage for a model version"""

    mv = client.get_model_version(model_name, version)
    run = client.get_run(mv.run_id)

    lineage = {
        "model_name": model_name,
        "version": version,
        "run_id": mv.run_id,
        "experiment_id": run.info.experiment_id,
        "artifact_uri": run.info.artifact_uri,
        "source_code": run.data.tags.get("mlflow.source.name"),
        "git_commit": run.data.tags.get("mlflow.source.git.commit"),
        "training_data": [],
        "features": []
    }

    # Get input datasets (if logged)
    inputs = run.inputs.dataset_inputs if hasattr(run.inputs, 'dataset_inputs') else []
    for input_dataset in inputs:
        lineage["training_data"].append({
            "name": input_dataset.dataset.name,
            "digest": input_dataset.dataset.digest
        })

    # Get feature store features (if applicable)
    feature_spec = run.data.tags.get("sparkml.features")
    if feature_spec:
        lineage["features"] = feature_spec.split(",")

    return lineage

lineage = get_model_lineage("customer-churn-classifier", "3")
print(json.dumps(lineage, indent=2))
```

## Model Documentation

```python
# Add comprehensive documentation
client.update_registered_model(
    name="customer-churn-classifier",
    description="""
    # Customer Churn Prediction Model

    ## Purpose
    Predicts probability of customer churning within the next 30 days.

    ## Input Features
    - total_orders: Total number of orders placed
    - lifetime_value: Total customer spend
    - days_since_last_order: Days since most recent order
    - avg_order_value: Average order amount

    ## Output
    Probability between 0 and 1 indicating churn likelihood.

    ## Performance
    - AUC: 0.92
    - Precision@0.5: 0.85
    - Recall@0.5: 0.78

    ## Owner
    Data Science Team (ds-team@company.com)

    ## SLA
    - Latency: <100ms p99
    - Availability: 99.9%
    """
)
```

## Cleanup and Archiving

```python
def cleanup_old_versions(model_name, keep_versions=5):
    """Archive old model versions, keeping recent ones"""

    # Get all versions
    versions = client.search_model_versions(f"name='{model_name}'")

    # Sort by creation time
    versions = sorted(versions, key=lambda v: v.creation_timestamp, reverse=True)

    # Keep recent versions and production
    for version in versions[keep_versions:]:
        if version.current_stage not in ['Production', 'Staging']:
            client.transition_model_version_stage(
                name=model_name,
                version=version.version,
                stage="Archived"
            )
            print(f"Archived {model_name} v{version.version}")

def delete_archived_versions(model_name, older_than_days=90):
    """Delete archived versions older than threshold"""

    cutoff = datetime.now() - timedelta(days=older_than_days)

    versions = client.search_model_versions(
        f"name='{model_name}' and current_stage='Archived'"
    )

    for version in versions:
        created = datetime.fromtimestamp(version.creation_timestamp / 1000)
        if created < cutoff:
            client.delete_model_version(model_name, version.version)
            print(f"Deleted {model_name} v{version.version}")
```

## Best Practices

### Naming Conventions

```python
# Use clear, descriptive names
good_names = [
    "customer-churn-classifier",
    "product-recommendation-collaborative",
    "fraud-detection-realtime",
    "demand-forecasting-daily"
]

# Avoid generic names
bad_names = [
    "model1",
    "test_model",
    "my-model"
]
```

### Version Metadata

```python
# Always include important metadata
client.set_model_version_tag(model_name, version, "training_data_date", "2022-03-15")
client.set_model_version_tag(model_name, version, "training_data_rows", "1000000")
client.set_model_version_tag(model_name, version, "feature_version", "v2")
client.set_model_version_tag(model_name, version, "code_version", git_commit_hash)
```

## Conclusion

The MLflow Model Registry is essential for production ML:
- Version control for models
- Stage-based deployment workflows
- Complete lineage and documentation
- Integration with CI/CD pipelines

Combined with Databricks' Model Serving and Feature Store, it provides a complete MLOps platform.

## Resources

- [MLflow Model Registry Docs](https://mlflow.org/docs/latest/model-registry.html)
- [Databricks Model Registry](https://docs.databricks.com/mlflow/model-registry.html)
- [Model Registry Webhooks](https://docs.databricks.com/mlflow/model-registry-webhooks.html)
