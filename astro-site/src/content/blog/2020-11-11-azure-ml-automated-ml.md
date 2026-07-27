---
title: "Azure Automated ML: Machine Learning for Everyone"
author: Michael John Peña
draft: false
date: 2020-11-11
tags:
  - Azure
  - Machine Learning
  - AutoML
  - AI
---

"We have data and we want machine learning." I get this conversation often, and most of the time the team doesn't need a data scientist on day one—they need to find out if the problem is even tractable. AutoML is the right first move. Point it at a dataset, give it a target column, and it sweeps algorithms and hyperparameters for you. If AutoML can't get traction, a PhD probably won't either.

## AutoML Capabilities

- Classification
- Regression
- Time series forecasting
- Computer vision
- NLP (text classification, NER)

## SDK Setup

```python
from azureml.core import Workspace, Experiment, Dataset
from azureml.train.automl import AutoMLConfig

ws = Workspace.from_config()
experiment = Experiment(ws, "automl-classification")
```

## Classification Example

```python
from azureml.train.automl import AutoMLConfig

# Load data
dataset = Dataset.get_by_name(ws, "customer-churn")
train_data, test_data = dataset.random_split(0.8)

# Configure AutoML
automl_config = AutoMLConfig(
    task="classification",
    primary_metric="AUC_weighted",
    training_data=train_data,
    label_column_name="churned",
    validation_data=test_data,
    compute_target="cpu-cluster",
    experiment_timeout_hours=1,
    max_concurrent_iterations=4,
    iterations=20,
    n_cross_validations=5,
    enable_early_stopping=True,
    featurization="auto",
    blocked_models=["XGBoostClassifier"],  # Exclude specific models
    allowed_models=["LightGBM", "RandomForest", "LogisticRegression"]
)

# Run experiment
run = experiment.submit(automl_config, show_output=True)
run.wait_for_completion()
```

## Get Best Model

```python
# Get best run and model
best_run, fitted_model = run.get_output()

print(f"Best algorithm: {best_run.properties['predicted_algorithm']}")
print(f"Best metric: {best_run.properties['score']}")

# View all runs
for run_item in run.get_children():
    metrics = run_item.get_metrics()
    print(f"{run_item.properties['predicted_algorithm']}: {metrics['AUC_weighted']:.4f}")
```

## Featurization

AutoML automatically handles:
- Missing values imputation
- Categorical encoding
- Feature scaling
- Text vectorization
- Date/time features

```python
# Custom featurization
featurization_config = FeaturizationConfig()
featurization_config.add_transformer_params(
    "imputer",
    ["Age"],
    {"strategy": "median"}
)
featurization_config.add_drop_columns(["ID", "Name"])

automl_config = AutoMLConfig(
    ...
    featurization=featurization_config
)
```

## Time Series Forecasting

```python
automl_config = AutoMLConfig(
    task="forecasting",
    primary_metric="normalized_root_mean_squared_error",
    training_data=train_data,
    label_column_name="sales",
    time_column_name="date",
    forecast_horizon=14,
    target_lags=[7, 14],
    target_rolling_window_size=7,
    freq="D"
)
```

## Model Explainability

```python
from azureml.interpret import ExplanationClient

# Get explanations
client = ExplanationClient.from_run(best_run)
explanation = client.download_model_explanation()

# Feature importance
feature_importance = explanation.get_feature_importance_dict()
for feature, importance in sorted(feature_importance.items(), key=lambda x: -x[1])[:10]:
    print(f"{feature}: {importance:.4f}")
```

## Register and Deploy

```python
# Register model
model = run.register_model(
    model_name="customer-churn-model",
    description="AutoML trained churn predictor"
)

# Deploy to ACI
from azureml.core.webservice import AciWebservice

deployment_config = AciWebservice.deploy_configuration(
    cpu_cores=1,
    memory_gb=1
)

service = Model.deploy(
    ws,
    "churn-predictor",
    [model],
    deployment_config=deployment_config
)
service.wait_for_deployment(show_output=True)
```

## Predictions

```python
import requests
import json

scoring_uri = service.scoring_uri
headers = {"Content-Type": "application/json"}

test_sample = {
    "data": [
        {"age": 35, "tenure": 24, "monthly_charges": 65.5}
    ]
}

response = requests.post(scoring_uri, json=test_sample, headers=headers)
prediction = json.loads(response.text)
print(f"Prediction: {prediction['result'][0]}")
```

AutoML: from data to deployed model in hours, not months.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
