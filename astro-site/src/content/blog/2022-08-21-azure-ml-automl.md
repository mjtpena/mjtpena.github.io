---
title: "Automated Machine Learning with Azure ML AutoML"
author: "Michael John Peña"
draft: false
date: 2022-08-21
tags: ["Azure", "Machine Learning", "AutoML", "Automation", "Model Selection"]

---

I wrote "Automated Machine Learning with Azure ML AutoML" to share practical, production-minded guidance on this topic.

## AutoML Classification

```python
from azure.ai.ml import MLClient, Input, automl
from azure.ai.ml.automl import ClassificationPrimaryMetrics
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Configure AutoML classification
classification_job = automl.classification(
    compute="cpu-cluster",
    experiment_name="automl-classification",
    training_data=Input(path="azureml://datastores/workspaceblobstore/paths/train.csv"),
    target_column_name="target",
    primary_metric=ClassificationPrimaryMetrics.ACCURACY,
    n_cross_validations=5,

    # Limits
    timeout_minutes=60,
    trial_timeout_minutes=20,
    max_trials=50,
    max_concurrent_trials=4,

    # Enable all featurization
    enable_early_termination=True,
    featurization="auto"
)

# Set allowed models
classification_job.set_training(
    allowed_training_algorithms=[
        "LightGBM",
        "XGBoostClassifier",
        "RandomForest",
        "LogisticRegression"
    ]
)

# Submit job
returned_job = ml_client.jobs.create_or_update(classification_job)
print(f"AutoML job submitted: {returned_job.name}")
```

## AutoML Regression

```python
from azure.ai.ml.automl import RegressionPrimaryMetrics

# Configure AutoML regression
regression_job = automl.regression(
    compute="cpu-cluster",
    experiment_name="automl-regression",
    training_data=Input(path="azureml://datastores/workspaceblobstore/paths/housing.csv"),
    target_column_name="price",
    primary_metric=RegressionPrimaryMetrics.NORMALIZED_ROOT_MEAN_SQUARED_ERROR,
    n_cross_validations=5,

    timeout_minutes=120,
    trial_timeout_minutes=30,
    max_trials=100,
    max_concurrent_trials=4
)

# Enable deep learning
regression_job.set_training(
    enable_dnn_training=True,
    enable_onnx_compatible_models=True
)

returned_job = ml_client.jobs.create_or_update(regression_job)
```

## AutoML Forecasting

```python
from azure.ai.ml.automl import ForecastingPrimaryMetrics

# Configure AutoML forecasting
forecasting_job = automl.forecasting(
    compute="cpu-cluster",
    experiment_name="automl-forecasting",
    training_data=Input(path="azureml://datastores/workspaceblobstore/paths/sales.csv"),
    target_column_name="sales",
    primary_metric=ForecastingPrimaryMetrics.NORMALIZED_ROOT_MEAN_SQUARED_ERROR,
    n_cross_validations=3,

    # Forecasting-specific settings
    forecasting_settings=automl.ForecastingSettings(
        time_column_name="date",
        forecast_horizon=30,
        frequency="D",
        target_lags=[1, 7, 14],
        target_rolling_window_size=7,
        time_series_id_column_names=["store_id", "product_id"]
    ),

    timeout_minutes=180,
    max_trials=50
)

# Enable specific algorithms for time series
forecasting_job.set_training(
    allowed_training_algorithms=[
        "Prophet",
        "AutoArima",
        "ExponentialSmoothing",
        "TCNForecaster"
    ]
)

returned_job = ml_client.jobs.create_or_update(forecasting_job)
```

## Featurization Settings

```python
from azure.ai.ml.automl import ColumnTransformer

# Custom featurization
classification_job = automl.classification(
    # ... basic settings
)

# Configure column transformers
classification_job.set_featurization(
    mode="custom",
    transformer_params={
        "imputer": [
            ColumnTransformer(
                fields=["age", "income"],
                parameters={"strategy": "median"}
            )
        ],
        "hash_one_hot_encoder": [
            ColumnTransformer(
                fields=["city", "state"],
                parameters={"number_of_bits": 10}
            )
        ]
    },
    blocked_transformers=["LabelEncoder"],  # Don't use label encoding
    column_name_and_types={
        "age": "Numeric",
        "income": "Numeric",
        "category": "Categorical",
        "date_joined": "DateTime"
    }
)
```

## Analyzing AutoML Results

```python
# Get job results
automl_job = ml_client.jobs.get(returned_job.name)

# Get all child runs
child_runs = ml_client.jobs.list(parent_job_name=automl_job.name)

results = []
for run in child_runs:
    if run.status == "Completed":
        results.append({
            "algorithm": run.properties.get("run_algorithm"),
            "accuracy": run.properties.get("accuracy"),
            "f1_score": run.properties.get("f1_score_weighted"),
            "duration": run.properties.get("duration")
        })

results_df = pd.DataFrame(results).sort_values("accuracy", ascending=False)
print("Top Models:")
print(results_df.head(10))
```

## Get Best Model

```python
# Get best model from AutoML
best_run_id = automl_job.properties.get("best_child_run_id")
best_run = ml_client.jobs.get(best_run_id)

print(f"Best model: {best_run.properties.get('run_algorithm')}")
print(f"Accuracy: {best_run.properties.get('accuracy')}")

# Download best model
ml_client.jobs.download(
    name=best_run_id,
    output_name="best_model",
    download_path="./outputs"
)

# Register best model
from azure.ai.ml.entities import Model

model = Model(
    path="./outputs/best_model",
    name="automl-best-model",
    description=f"Best model from AutoML run {automl_job.name}",
    type="mlflow_model"
)

ml_client.models.create_or_update(model)
```

## Model Explanations

```python
# Enable model explanations
classification_job = automl.classification(
    # ... settings
)

classification_job.set_training(
    enable_model_explainability=True
)

# After job completes, get explanations
from azure.ai.ml.entities import Model

# Download explanation artifacts
ml_client.jobs.download(
    name=best_run_id,
    output_name="explanations",
    download_path="./explanations"
)

# Load and analyze
import json

with open("./explanations/global_importance.json") as f:
    importance = json.load(f)

for feature, imp in sorted(importance.items(), key=lambda x: -x[1])[:10]:
    print(f"{feature}: {imp:.4f}")
```

## AutoML in Pipelines

```python
from azure.ai.ml import dsl

@dsl.pipeline(
    name="automl_pipeline",
    compute="cpu-cluster"
)
def automl_training_pipeline(training_data: Input, test_data: Input):
    # AutoML training step
    automl_step = automl.classification(
        training_data=training_data,
        target_column_name="target",
        primary_metric="accuracy",
        timeout_minutes=60
    )

    # Evaluation step
    eval_step = evaluate_model(
        model=automl_step.outputs.best_model,
        test_data=test_data
    )

    return {
        "model": automl_step.outputs.best_model,
        "metrics": eval_step.outputs.metrics
    }

# Submit pipeline
pipeline_job = ml_client.jobs.create_or_update(
    automl_training_pipeline(
        training_data=Input(path="azureml://datastores/workspaceblobstore/paths/train.csv"),
        test_data=Input(path="azureml://datastores/workspaceblobstore/paths/test.csv")
    ),
    experiment_name="automl-pipeline"
)
```

AutoML accelerates model development while maintaining production-quality results.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
