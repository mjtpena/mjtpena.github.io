---
title: Azure ML AutoML - Automated Machine Learning at Scale
author: Michael John Peña
draft: false
date: 2021-04-22
url: /blog/azure-ml-automl-automated-machine-learning/
tags:
  - Azure
  - Machine Learning
  - AutoML
  - Data Science
  - AI

---

I wrote "2021-04-22-azure-ml-automl-automated-machine-learning" to share practical, production-minded guidance on this topic.

## Understanding AutoML

AutoML automates:
- **Feature engineering** - Automatic featurization
- **Algorithm selection** - Tests multiple algorithms
- **Hyperparameter tuning** - Optimizes model parameters
- **Model ensembling** - Combines top models

## Setting Up Azure ML

```python
from azureml.core import Workspace, Experiment, Dataset
from azureml.train.automl import AutoMLConfig
from azureml.core.compute import ComputeTarget, AmlCompute

# Connect to workspace
ws = Workspace.from_config()

# Create or get compute cluster
compute_name = "automl-cluster"
if compute_name not in ws.compute_targets:
    compute_config = AmlCompute.provisioning_configuration(
        vm_size="STANDARD_DS12_V2",
        min_nodes=0,
        max_nodes=4
    )
    compute_target = ComputeTarget.create(ws, compute_name, compute_config)
    compute_target.wait_for_completion(show_output=True)
else:
    compute_target = ws.compute_targets[compute_name]
```

## Classification with AutoML

### Preparing Data

```python
from azureml.core import Dataset
import pandas as pd

# Load data from registered dataset
dataset = Dataset.get_by_name(ws, 'customer_churn_data')
df = dataset.to_pandas_dataframe()

# Or create from DataFrame
from azureml.data.dataset_factory import TabularDatasetFactory

datastore = ws.get_default_datastore()
df_train.to_csv('train_data.csv', index=False)

# Upload and register
dataset = Dataset.Tabular.from_delimited_files(
    path=(datastore, 'datasets/train_data.csv')
)
dataset = dataset.register(ws, 'customer_churn_training')
```

### Configure AutoML Run

```python
from azureml.train.automl import AutoMLConfig

automl_config = AutoMLConfig(
    task='classification',
    primary_metric='AUC_weighted',
    training_data=dataset,
    label_column_name='churn',
    compute_target=compute_target,

    # Time and iteration settings
    experiment_timeout_hours=2,
    max_concurrent_iterations=4,
    iteration_timeout_minutes=20,

    # Featurization
    featurization='auto',  # or 'off', or FeaturizationConfig object

    # Validation
    n_cross_validations=5,
    # or validation_data=validation_dataset,
    # or validation_size=0.2,

    # Model selection
    enable_early_stopping=True,
    enable_stack_ensemble=True,
    enable_voting_ensemble=True,

    # Explainability
    model_explainability=True,

    # Blocked algorithms
    blocked_models=['XGBoostClassifier'],  # Exclude specific models

    # Allow certain models only
    # allowed_models=['LogisticRegression', 'RandomForest'],

    verbosity=logging.INFO
)
```

### Run the Experiment

```python
from azureml.core import Experiment

experiment = Experiment(ws, 'automl-churn-classification')
run = experiment.submit(automl_config, show_output=True)

# Wait for completion
run.wait_for_completion(show_output=True)

# Get best model
best_run, best_model = run.get_output()
print(f"Best run: {best_run.id}")
print(f"Best model: {best_run.properties['model_name']}")
```

## Regression with AutoML

```python
from azureml.train.automl import AutoMLConfig

automl_regression_config = AutoMLConfig(
    task='regression',
    primary_metric='normalized_root_mean_squared_error',
    training_data=sales_dataset,
    label_column_name='sales_amount',
    compute_target=compute_target,

    experiment_timeout_hours=1.5,
    max_concurrent_iterations=4,

    # Regression-specific settings
    featurization='auto',
    n_cross_validations=5,

    # Enable deep learning
    enable_dnn=True,

    model_explainability=True,
    enable_stack_ensemble=True,
    verbosity=logging.INFO
)

experiment = Experiment(ws, 'automl-sales-regression')
run = experiment.submit(automl_regression_config)
run.wait_for_completion(show_output=True)
```

## Time Series Forecasting

```python
from azureml.train.automl import AutoMLConfig
from azureml.automl.core.forecasting_parameters import ForecastingParameters

forecasting_params = ForecastingParameters(
    time_column_name='date',
    forecast_horizon=30,  # Predict 30 days ahead
    time_series_id_column_names=['store_id', 'product_id'],
    freq='D',  # Daily frequency
    target_lags=[7, 14, 21],  # Include lagged features
    target_rolling_window_size=7,  # Rolling statistics
    seasonality='auto',  # or specific value like 7 for weekly
    use_stl='season_trend'  # STL decomposition
)

automl_forecast_config = AutoMLConfig(
    task='forecasting',
    primary_metric='normalized_root_mean_squared_error',
    training_data=time_series_dataset,
    label_column_name='quantity_sold',
    compute_target=compute_target,

    forecasting_parameters=forecasting_params,

    experiment_timeout_hours=2,
    max_concurrent_iterations=4,
    n_cross_validations=3,

    # Forecasting models
    enable_dnn=True,
    model_explainability=True,
    verbosity=logging.INFO
)

experiment = Experiment(ws, 'automl-demand-forecasting')
run = experiment.submit(automl_forecast_config)
```

## Custom Featurization

```python
from azureml.automl.core.featurization import FeaturizationConfig

featurization_config = FeaturizationConfig()

# Drop columns
featurization_config.drop_columns(['customer_id', 'row_number'])

# Block specific transformers for columns
featurization_config.add_column_purpose('age', 'Numeric')
featurization_config.add_transformer_params(
    'Imputer', ['age'], {'strategy': 'median'}
)

# Custom transformations
featurization_config.add_transformer_params(
    'HashOneHotEncoder', ['category'], {'number_of_bits': 3}
)

# Block transformers for specific columns
featurization_config.add_blocked_transformers(['LabelEncoder'])

automl_config = AutoMLConfig(
    task='classification',
    primary_metric='AUC_weighted',
    training_data=dataset,
    label_column_name='target',
    featurization=featurization_config,
    compute_target=compute_target
)
```

## Analyzing Results

### View All Runs

```python
from azureml.widgets import RunDetails

# In Jupyter notebook
RunDetails(run).show()

# Programmatically get all child runs
children = list(run.get_children())
for child in children:
    props = child.properties
    print(f"Run ID: {child.id}")
    print(f"Model: {props.get('run_algorithm', 'N/A')}")
    print(f"AUC: {props.get('AUC_weighted', 'N/A')}")
    print("---")
```

### Get Metrics and Artifacts

```python
# Get best run metrics
best_run_metrics = best_run.get_metrics()
for metric_name, metric_value in best_run_metrics.items():
    print(f"{metric_name}: {metric_value}")

# Download artifacts
best_run.download_file('outputs/model.pkl', 'model.pkl')

# Get feature importance
from azureml.train.automl.runtime.automl_explain_utilities import AutoMLExplainerSetupClass

automl_explainer_setup = AutoMLExplainerSetupClass(best_model)
raw_feature_importance = automl_explainer_setup.get_raw_feature_importance()

print("Feature Importance:")
for feature, importance in sorted(raw_feature_importance.items(),
                                   key=lambda x: x[1], reverse=True)[:10]:
    print(f"  {feature}: {importance:.4f}")
```

### Model Explainability

```python
from azureml.interpret import ExplanationClient

# Get explanation
client = ExplanationClient.from_run(best_run)
engineered_explanations = client.download_model_explanation(raw=False)
raw_explanations = client.download_model_explanation(raw=True)

# Feature importance
print("Engineered Feature Importance:")
for feature, importance in zip(
    engineered_explanations.get_feature_importance_dict().keys(),
    engineered_explanations.get_feature_importance_dict().values()
)[:10]:
    print(f"  {feature}: {importance:.4f}")
```

## Deploying the Best Model

### Register Model

```python
from azureml.core import Model

# Register best model
model = best_run.register_model(
    model_name='churn-automl-model',
    model_path='outputs/model.pkl',
    tags={'area': 'customer-analytics', 'type': 'classification'},
    properties={'AUC': best_run_metrics['AUC_weighted']},
    description='Customer churn prediction model trained with AutoML'
)

print(f"Registered model: {model.name}, Version: {model.version}")
```

### Create Inference Configuration

```python
from azureml.core.model import InferenceConfig
from azureml.core.environment import Environment

# Get environment from run
env = best_run.get_environment()

# Or create custom environment
env = Environment.from_conda_specification(
    name='automl-inference-env',
    file_path='conda_env.yml'
)

# Scoring script
scoring_script = """
import json
import pandas as pd
import joblib
from azureml.core.model import Model

def init():
    global model
    model_path = Model.get_model_path('churn-automl-model')
    model = joblib.load(model_path)

def run(raw_data):
    data = pd.DataFrame(json.loads(raw_data)['data'])
    predictions = model.predict(data)
    probabilities = model.predict_proba(data)

    return json.dumps({
        'predictions': predictions.tolist(),
        'probabilities': probabilities.tolist()
    })
"""

# Save scoring script
with open('score.py', 'w') as f:
    f.write(scoring_script)

inference_config = InferenceConfig(
    entry_script='score.py',
    environment=env
)
```

### Deploy to ACI/AKS

```python
from azureml.core.webservice import AciWebservice, AksWebservice

# Deploy to Azure Container Instance (for testing)
aci_config = AciWebservice.deploy_configuration(
    cpu_cores=1,
    memory_gb=1,
    auth_enabled=True,
    enable_app_insights=True
)

service = Model.deploy(
    workspace=ws,
    name='churn-prediction-service',
    models=[model],
    inference_config=inference_config,
    deployment_config=aci_config
)

service.wait_for_deployment(show_output=True)
print(f"Service state: {service.state}")
print(f"Scoring URI: {service.scoring_uri}")
print(f"Swagger URI: {service.swagger_uri}")
```

### Test the Deployment

```python
import requests
import json

# Get keys
keys = service.get_keys()
headers = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {keys[0]}'
}

# Test data
test_data = {
    'data': [
        {'feature1': 1.0, 'feature2': 'A', 'feature3': 100},
        {'feature1': 2.0, 'feature2': 'B', 'feature3': 200}
    ]
}

response = requests.post(
    service.scoring_uri,
    headers=headers,
    data=json.dumps(test_data)
)

print(response.json())
```

## Best Practices

1. **Start with good data** - AutoML can't fix bad data
2. **Set appropriate timeouts** - Balance between exploration and time
3. **Use cross-validation** - More reliable than a single split
4. **Enable explainability** - Understand your models
5. **Review featurization** - Check what transformations were applied
6. **Compare with baseline** - Know if AutoML adds value
7. **Monitor deployed models** - Track performance over time
8. **Version everything** - Data, models, and configurations

## Conclusion

Azure ML AutoML accelerates the machine learning process by automating repetitive tasks while maintaining transparency through explainability features. By understanding the configuration options and following best practices, you can leverage AutoML to quickly build high-quality models for classification, regression, and forecasting tasks.

