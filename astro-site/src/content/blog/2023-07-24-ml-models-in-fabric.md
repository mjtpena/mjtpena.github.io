---
title: "ML Models in Fabric: Training, Registry, and Deployment"
author: Michael John Peña
draft: false
date: 2023-07-24
tags:
  - Microsoft Fabric
  - Machine Learning
  - Model Registry
  - MLOps

---

I wrote "ML Models in Fabric: Training, Registry, and Deployment" to share practical, production-minded guidance on this topic.

## Model Lifecycle in Fabric

```python
# ML model lifecycle stages
model_lifecycle = {
    "development": {
        "activities": ["Feature engineering", "Model training", "Evaluation"],
        "tools": "Notebooks, MLflow experiments"
    },
    "registration": {
        "activities": ["Version model", "Add metadata", "Document"],
        "tools": "MLflow Model Registry"
    },
    "staging": {
        "activities": ["Validation testing", "A/B testing", "Performance checks"],
        "tools": "Staging environment"
    },
    "production": {
        "activities": ["Deploy", "Monitor", "Serve predictions"],
        "tools": "Production deployment"
    },
    "retirement": {
        "activities": ["Archive", "Replace with new version"],
        "tools": "Model registry transitions"
    }
}
```

## Training Different Model Types

### Classification Models

```python
import mlflow
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score

with mlflow.start_run(run_name="gradient_boosting_classifier"):
    # Model parameters
    params = {
        "n_estimators": 100,
        "learning_rate": 0.1,
        "max_depth": 5,
        "subsample": 0.8
    }
    mlflow.log_params(params)

    # Train model
    model = GradientBoostingClassifier(**params, random_state=42)
    model.fit(X_train, y_train)

    # Predictions
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    # Metrics
    accuracy = (y_pred == y_test).mean()
    roc_auc = roc_auc_score(y_test, y_prob)

    mlflow.log_metrics({
        "accuracy": accuracy,
        "roc_auc": roc_auc
    })

    # Log confusion matrix
    cm = confusion_matrix(y_test, y_pred)
    fig, ax = plt.subplots()
    ax.matshow(cm, cmap='Blues')
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, cm[i, j], ha='center', va='center')
    plt.xlabel('Predicted')
    plt.ylabel('Actual')
    mlflow.log_figure(fig, "confusion_matrix.png")

    # Log model with signature
    from mlflow.models import infer_signature
    signature = infer_signature(X_train, y_pred)
    mlflow.sklearn.log_model(model, "model", signature=signature)
```

### Regression Models

```python
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

with mlflow.start_run(run_name="random_forest_regressor"):
    params = {
        "n_estimators": 200,
        "max_depth": 15,
        "min_samples_split": 5
    }
    mlflow.log_params(params)

    model = RandomForestRegressor(**params, random_state=42)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)

    # Regression metrics
    metrics = {
        "rmse": mean_squared_error(y_test, y_pred, squared=False),
        "mae": mean_absolute_error(y_test, y_pred),
        "r2": r2_score(y_test, y_pred)
    }
    mlflow.log_metrics(metrics)

    # Actual vs Predicted plot
    fig, ax = plt.subplots()
    ax.scatter(y_test, y_pred, alpha=0.5)
    ax.plot([y_test.min(), y_test.max()], [y_test.min(), y_test.max()], 'r--')
    ax.set_xlabel('Actual')
    ax.set_ylabel('Predicted')
    ax.set_title('Actual vs Predicted')
    mlflow.log_figure(fig, "actual_vs_predicted.png")

    mlflow.sklearn.log_model(model, "model")
```

### Time Series Models

```python
from sklearn.linear_model import LinearRegression
import numpy as np

# Create lag features for time series
def create_lag_features(data, target_col, lag_periods=[1, 7, 30]):
    df = data.copy()
    for lag in lag_periods:
        df[f'{target_col}_lag_{lag}'] = df[target_col].shift(lag)
    return df.dropna()

# Prepare time series data
ts_data = create_lag_features(sales_df, 'daily_sales', [1, 7, 14, 30])
feature_cols = [c for c in ts_data.columns if 'lag' in c]

X = ts_data[feature_cols]
y = ts_data['daily_sales']

with mlflow.start_run(run_name="time_series_model"):
    model = LinearRegression()
    model.fit(X, y)

    y_pred = model.predict(X)

    metrics = {
        "rmse": np.sqrt(mean_squared_error(y, y_pred)),
        "mape": np.mean(np.abs((y - y_pred) / y)) * 100
    }
    mlflow.log_metrics(metrics)

    mlflow.sklearn.log_model(model, "model")
```

## Model Registry Operations

### Registering Models

```python
# Register from run
run_id = "abc123..."
model_uri = f"runs:/{run_id}/model"

# Register with mlflow
model_version = mlflow.register_model(
    model_uri=model_uri,
    name="sales_forecast_model",
    tags={
        "task": "regression",
        "framework": "sklearn"
    }
)

print(f"Model registered: version {model_version.version}")
```

### Managing Model Versions

```python
from mlflow.tracking import MlflowClient

client = MlflowClient()

# List all versions of a model
model_name = "sales_forecast_model"
versions = client.search_model_versions(f"name='{model_name}'")

for v in versions:
    print(f"Version: {v.version}, Stage: {v.current_stage}, Run ID: {v.run_id}")

# Add description to version
client.update_model_version(
    name=model_name,
    version=1,
    description="Initial production model trained on 2023 Q1 data"
)

# Add tags
client.set_model_version_tag(
    name=model_name,
    version=1,
    key="validation_dataset",
    value="2023_q2_holdout"
)
```

### Stage Transitions

```python
# Transition model to staging
client.transition_model_version_stage(
    name=model_name,
    version=2,
    stage="Staging"
)

# After validation, promote to production
client.transition_model_version_stage(
    name=model_name,
    version=2,
    stage="Production",
    archive_existing_versions=True  # Archives current production
)

# Archive old versions
client.transition_model_version_stage(
    name=model_name,
    version=1,
    stage="Archived"
)
```

## Loading and Using Models

```python
import mlflow.pyfunc

# Load by version
model_v1 = mlflow.pyfunc.load_model(f"models:/{model_name}/1")

# Load by stage
production_model = mlflow.pyfunc.load_model(f"models:/{model_name}/Production")
staging_model = mlflow.pyfunc.load_model(f"models:/{model_name}/Staging")

# Make predictions
predictions = production_model.predict(new_data)
```

## Model Comparison

```python
# Compare multiple models in same experiment
experiment_name = "customer_churn_experiment"

# Get all runs
experiment = mlflow.get_experiment_by_name(experiment_name)
runs = mlflow.search_runs(experiment_ids=[experiment.experiment_id])

# Create comparison DataFrame
comparison = runs[['run_id', 'params.n_estimators', 'params.max_depth',
                   'metrics.accuracy', 'metrics.f1_score']].copy()
comparison = comparison.sort_values('metrics.f1_score', ascending=False)

print(comparison.head(10))

# Visualize comparison
fig, ax = plt.subplots(figsize=(10, 6))
comparison.plot(kind='scatter', x='metrics.accuracy', y='metrics.f1_score', ax=ax)
plt.title('Model Comparison: Accuracy vs F1 Score')
plt.show()
```

## Custom Model Flavors

```python
# Create custom model wrapper
class CustomModelWrapper(mlflow.pyfunc.PythonModel):
    def __init__(self, model, preprocessor):
        self.model = model
        self.preprocessor = preprocessor

    def predict(self, context, model_input):
        # Apply preprocessing
        processed = self.preprocessor.transform(model_input)
        # Make prediction
        return self.model.predict(processed)

# Log custom model
with mlflow.start_run():
    wrapped_model = CustomModelWrapper(trained_model, fitted_preprocessor)

    mlflow.pyfunc.log_model(
        artifact_path="custom_model",
        python_model=wrapped_model,
        conda_env={
            "dependencies": [
                "python=3.9",
                "scikit-learn=1.0",
                "pandas=1.4"
            ]
        }
    )
```

## Model Documentation

```python
# Document model with model card
model_card = """
# Sales Forecast Model

## Description
Random Forest model for daily sales prediction.

## Intended Use
- Forecast next 30 days of sales
- Input: Historical sales, promotions, seasonality features
- Output: Predicted daily sales amount

## Training Data
- Source: Lakehouse sales_history table
- Period: 2020-01-01 to 2023-06-30
- Samples: 1,278 days

## Performance Metrics
- RMSE: 1,234.56
- MAE: 987.65
- R2: 0.89

## Limitations
- Trained on single store data
- May not generalize to new store openings
- Requires retraining quarterly

## Ethical Considerations
- No personal data used in training
- Predictions should inform, not replace, human judgment
"""

# Log as artifact
with open("/tmp/model_card.md", "w") as f:
    f.write(model_card)

mlflow.log_artifact("/tmp/model_card.md")
```

Tomorrow we'll explore MLflow integration in Fabric.

## Resources

- [Model Management in Fabric](https://learn.microsoft.com/en-us/fabric/data-science/model-management)
- [MLflow Model Registry](https://mlflow.org/docs/latest/model-registry.html)
- [Model Deployment Guide](https://learn.microsoft.com/en-us/fabric/data-science/model-scoring)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
