---
title: "CI/CD for Machine Learning: Building Reliable ML Pipelines"
author: Michael John Pena
draft: false
date: 2021-12-11
tags:
  - MLOps
  - CI/CD
  - Machine Learning
  - Azure DevOps
  - GitHub Actions

---

I wrote "CI/CD for Machine Learning: Building Reliable ML Pipelines" to share practical, production-minded guidance on this topic.

## The ML CI/CD Pipeline

Unlike traditional software, ML pipelines must validate data, code, and models:

```yaml
# .github/workflows/ml-pipeline.yml
name: ML Pipeline

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'models/**'
      - 'data/**'
  pull_request:
    branches: [main]

jobs:
  data-validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'

      - name: Install dependencies
        run: |
          pip install great-expectations pandas

      - name: Validate data
        run: |
          python scripts/validate_data.py

  code-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'

      - name: Install dependencies
        run: |
          pip install pylint pytest black mypy

      - name: Lint code
        run: |
          black --check src/
          pylint src/ --fail-under=8
          mypy src/

      - name: Run unit tests
        run: |
          pytest tests/unit/ -v --cov=src

  model-training:
    needs: [data-validation, code-quality]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Submit training job
        run: |
          az ml job create \
            --file jobs/train.yml \
            --resource-group ${{ secrets.AZURE_RG }} \
            --workspace-name ${{ secrets.AZURE_ML_WORKSPACE }}

  model-validation:
    needs: model-training
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Download model artifacts
        run: |
          az ml model download \
            --name customer-churn \
            --version latest \
            --download-path ./model

      - name: Run model tests
        run: |
          python scripts/validate_model.py

      - name: Performance benchmarks
        run: |
          python scripts/benchmark_model.py

  model-registration:
    needs: model-validation
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Register model
        run: |
          az ml model create \
            --name customer-churn \
            --path ./model \
            --type mlflow_model \
            --tags "commit=${{ github.sha }}"

  deploy-staging:
    needs: model-registration
    environment: staging
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to staging
        run: |
          az ml online-deployment create \
            --name staging \
            --endpoint customer-churn-endpoint \
            --model azureml:customer-churn@latest

      - name: Run smoke tests
        run: |
          python scripts/smoke_test.py --endpoint staging

  deploy-production:
    needs: deploy-staging
    environment: production
    runs-on: ubuntu-latest
    steps:
      - name: Blue-green deployment
        run: |
          # Deploy new version
          az ml online-deployment create \
            --name blue \
            --endpoint customer-churn-endpoint \
            --model azureml:customer-churn@latest

          # Gradually shift traffic
          az ml online-endpoint update \
            --name customer-churn-endpoint \
            --traffic "blue=10 green=90"

          # Run canary tests
          python scripts/canary_test.py

          # Full traffic switch
          az ml online-endpoint update \
            --name customer-churn-endpoint \
            --traffic "blue=100 green=0"
```

## Data Validation Tests

```python
# scripts/validate_data.py
import great_expectations as ge
from great_expectations.checkpoint import SimpleCheckpoint
import sys

def validate_training_data():
    context = ge.get_context()

    # Load data
    batch_request = {
        "datasource_name": "training_data",
        "data_connector_name": "default",
        "data_asset_name": "customer_features",
    }

    # Run validation
    checkpoint = SimpleCheckpoint(
        name="training_data_checkpoint",
        data_context=context,
        validations=[
            {
                "batch_request": batch_request,
                "expectation_suite_name": "customer_features_suite"
            }
        ]
    )

    result = checkpoint.run()

    if not result.success:
        print("Data validation failed!")
        print(result.to_json_dict())
        sys.exit(1)

    print("Data validation passed!")

def define_expectations():
    """Define data quality expectations"""
    context = ge.get_context()

    suite = context.create_expectation_suite("customer_features_suite")

    expectations = [
        # Completeness
        {"expectation_type": "expect_column_values_to_not_be_null",
         "kwargs": {"column": "customer_id"}},
        {"expectation_type": "expect_column_values_to_not_be_null",
         "kwargs": {"column": "total_purchases", "mostly": 0.99}},

        # Uniqueness
        {"expectation_type": "expect_column_values_to_be_unique",
         "kwargs": {"column": "customer_id"}},

        # Range checks
        {"expectation_type": "expect_column_values_to_be_between",
         "kwargs": {"column": "age", "min_value": 18, "max_value": 120}},
        {"expectation_type": "expect_column_values_to_be_between",
         "kwargs": {"column": "purchase_frequency", "min_value": 0}},

        # Categorical values
        {"expectation_type": "expect_column_values_to_be_in_set",
         "kwargs": {"column": "segment", "value_set": ["premium", "standard", "basic"]}},

        # Distribution checks
        {"expectation_type": "expect_column_mean_to_be_between",
         "kwargs": {"column": "lifetime_value", "min_value": 100, "max_value": 10000}},
    ]

    for exp in expectations:
        suite.add_expectation(
            ge.core.ExpectationConfiguration(**exp)
        )

    context.save_expectation_suite(suite)

if __name__ == "__main__":
    validate_training_data()
```

## Model Validation Tests

```python
# scripts/validate_model.py
import mlflow
import pandas as pd
import numpy as np
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
import json
import sys

class ModelValidator:
    def __init__(self, model_path: str, test_data_path: str):
        self.model = mlflow.pyfunc.load_model(model_path)
        self.test_data = pd.read_parquet(test_data_path)

    def validate_performance(self, thresholds: dict) -> bool:
        """Validate model meets performance thresholds"""
        X_test = self.test_data.drop(columns=['target'])
        y_test = self.test_data['target']

        y_pred = self.model.predict(X_test)
        y_prob = self.model.predict_proba(X_test)[:, 1] if hasattr(self.model, 'predict_proba') else None

        metrics = {
            'accuracy': accuracy_score(y_test, y_pred),
            'precision': precision_score(y_test, y_pred),
            'recall': recall_score(y_test, y_pred),
            'f1': f1_score(y_test, y_pred),
        }

        if y_prob is not None:
            metrics['auc_roc'] = roc_auc_score(y_test, y_prob)

        print("Model Performance Metrics:")
        for metric, value in metrics.items():
            threshold = thresholds.get(metric, 0)
            status = "PASS" if value >= threshold else "FAIL"
            print(f"  {metric}: {value:.4f} (threshold: {threshold}) [{status}]")

        return all(
            metrics.get(m, 0) >= t
            for m, t in thresholds.items()
        )

    def validate_inference_time(self, max_latency_ms: float) -> bool:
        """Validate model inference latency"""
        import time

        sample = self.test_data.drop(columns=['target']).iloc[:100]
        latencies = []

        for _ in range(10):
            start = time.perf_counter()
            self.model.predict(sample)
            latency = (time.perf_counter() - start) * 1000 / len(sample)
            latencies.append(latency)

        avg_latency = np.mean(latencies)
        p99_latency = np.percentile(latencies, 99)

        print(f"Inference Latency: avg={avg_latency:.2f}ms, p99={p99_latency:.2f}ms")

        return p99_latency < max_latency_ms

    def validate_fairness(self, sensitive_feature: str, threshold: float = 0.1) -> bool:
        """Validate model fairness across groups"""
        from fairlearn.metrics import demographic_parity_difference

        X_test = self.test_data.drop(columns=['target'])
        y_test = self.test_data['target']
        sensitive = self.test_data[sensitive_feature]

        y_pred = self.model.predict(X_test)

        dp_diff = demographic_parity_difference(
            y_test, y_pred, sensitive_features=sensitive
        )

        print(f"Demographic Parity Difference: {dp_diff:.4f} (threshold: {threshold})")

        return abs(dp_diff) < threshold

    def validate_robustness(self, noise_level: float = 0.1) -> bool:
        """Validate model robustness to input noise"""
        X_test = self.test_data.drop(columns=['target'])
        y_test = self.test_data['target']

        # Original predictions
        y_pred_original = self.model.predict(X_test)
        original_accuracy = accuracy_score(y_test, y_pred_original)

        # Add noise to numeric features
        X_noisy = X_test.copy()
        numeric_cols = X_noisy.select_dtypes(include=[np.number]).columns

        for col in numeric_cols:
            noise = np.random.normal(0, noise_level * X_noisy[col].std(), len(X_noisy))
            X_noisy[col] = X_noisy[col] + noise

        # Predictions on noisy data
        y_pred_noisy = self.model.predict(X_noisy)
        noisy_accuracy = accuracy_score(y_test, y_pred_noisy)

        degradation = original_accuracy - noisy_accuracy
        print(f"Robustness: original={original_accuracy:.4f}, noisy={noisy_accuracy:.4f}, degradation={degradation:.4f}")

        return degradation < 0.05  # Less than 5% degradation

if __name__ == "__main__":
    validator = ModelValidator(
        model_path="./model",
        test_data_path="./data/test.parquet"
    )

    thresholds = {
        'accuracy': 0.85,
        'precision': 0.80,
        'recall': 0.75,
        'auc_roc': 0.85
    }

    results = {
        'performance': validator.validate_performance(thresholds),
        'latency': validator.validate_inference_time(max_latency_ms=50),
        'fairness': validator.validate_fairness('gender'),
        'robustness': validator.validate_robustness()
    }

    if not all(results.values()):
        print("\nModel validation FAILED")
        print(f"Results: {results}")
        sys.exit(1)

    print("\nModel validation PASSED")
```

## Azure ML Pipeline Definition

```yaml
# jobs/train.yml
$schema: https://azuremlschemas.azureedge.net/latest/pipelineJob.schema.json
type: pipeline
display_name: customer_churn_training_pipeline

settings:
  default_compute: azureml:gpu-cluster
  continue_on_step_failure: false

inputs:
  training_data:
    type: uri_folder
    path: azureml:customer_features@latest

outputs:
  model:
    type: mlflow_model
  evaluation_results:
    type: uri_folder

jobs:
  preprocess:
    type: command
    component: azureml:preprocess@latest
    inputs:
      raw_data: ${{parent.inputs.training_data}}
    outputs:
      processed_data:
        type: uri_folder

  train:
    type: command
    component: azureml:train_xgboost@latest
    inputs:
      training_data: ${{parent.jobs.preprocess.outputs.processed_data}}
    outputs:
      model:
        type: mlflow_model
    compute: azureml:gpu-cluster

  evaluate:
    type: command
    component: azureml:evaluate_model@latest
    inputs:
      model: ${{parent.jobs.train.outputs.model}}
      test_data: ${{parent.jobs.preprocess.outputs.processed_data}}
    outputs:
      evaluation_results: ${{parent.outputs.evaluation_results}}

  register:
    type: command
    component: azureml:register_model@latest
    inputs:
      model: ${{parent.jobs.train.outputs.model}}
      evaluation_results: ${{parent.jobs.evaluate.outputs.evaluation_results}}
    outputs:
      registered_model:
        type: mlflow_model
```

## Key Principles for ML CI/CD

1. **Version Everything**: Data, code, models, and configurations
2. **Automate Testing**: Unit tests, integration tests, and model validation
3. **Gate Deployments**: Performance thresholds before promotion
4. **Enable Rollback**: Always have a path back to the previous version

ML CI/CD in 2021 became essential for production systems. The tooling caught up with the need, and now there's no excuse for manual deployments.

## Resources

- [Azure ML Pipelines](https://docs.microsoft.com/en-us/azure/machine-learning/concept-ml-pipelines)
- [MLOps Guide](https://ml-ops.org/)
- [GitHub Actions for ML](https://github.blog/2020-06-17-using-github-actions-for-mlops-data-science/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
