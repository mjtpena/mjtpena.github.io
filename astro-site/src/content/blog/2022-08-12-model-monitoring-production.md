---
title: "Model Monitoring in Production with Azure ML"
author: "Michael John Peña"
draft: false
date: 2022-08-12
tags: ["Azure", "Machine Learning", "MLOps", "Monitoring", "Production"]

---

I wrote "Model Monitoring in Production with Azure ML" to share practical, production-minded guidance on this topic.

## Why Model Monitoring Matters

Production models can degrade due to:
- Data drift: Input data distribution changes
- Concept drift: Relationship between features and target changes
- Feature drift: Individual feature distributions change
- Prediction drift: Model output distribution changes

## Setting Up Model Monitoring

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    MonitorSchedule,
    MonitorDefinition,
    DataDriftSignal,
    PredictionDriftSignal,
    ServerlessSparkCompute
)
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create monitoring definition
monitor_definition = MonitorDefinition(
    compute=ServerlessSparkCompute(instance_type="Standard_E4s_v3", runtime_version="3.2"),
    monitoring_target={
        "endpoint_deployment_id": "/subscriptions/.../endpoints/my-endpoint/deployments/blue"
    },
    monitoring_signals={
        "data_drift": DataDriftSignal(
            production_data={
                "input_data": {
                    "path": "azureml://datastores/workspaceblobstore/paths/production-data/",
                    "type": "uri_folder"
                }
            },
            reference_data={
                "input_data": {
                    "path": "azureml://datastores/workspaceblobstore/paths/training-data/",
                    "type": "uri_folder"
                }
            },
            features=["feature1", "feature2", "feature3"],
            metric_thresholds={
                "numerical_features": {
                    "jensen_shannon_distance": 0.1,
                    "normalized_wasserstein_distance": 0.1
                },
                "categorical_features": {
                    "pearsons_chi_squared_test": 0.1
                }
            }
        ),
        "prediction_drift": PredictionDriftSignal(
            production_data={
                "input_data": {
                    "path": "azureml://datastores/workspaceblobstore/paths/predictions/",
                    "type": "uri_folder"
                }
            },
            reference_data={
                "input_data": {
                    "path": "azureml://datastores/workspaceblobstore/paths/baseline-predictions/",
                    "type": "uri_folder"
                }
            }
        )
    },
    alert_notification={
        "emails": ["ml-alerts@company.com"]
    }
)

# Create monitoring schedule
monitor_schedule = MonitorSchedule(
    name="production-model-monitor",
    trigger=RecurrenceTrigger(frequency="day", interval=1),
    create_monitor=monitor_definition
)

ml_client.schedules.begin_create_or_update(monitor_schedule).result()
```

## Custom Monitoring with Python

```python
import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass
from typing import Dict, List, Optional

@dataclass
class DriftResult:
    feature: str
    drift_detected: bool
    metric_value: float
    threshold: float
    method: str

class DataDriftDetector:
    def __init__(self, reference_data: pd.DataFrame, threshold: float = 0.1):
        self.reference_data = reference_data
        self.threshold = threshold

    def detect_drift(self, production_data: pd.DataFrame) -> List[DriftResult]:
        """Detect drift for all features"""
        results = []

        for column in self.reference_data.columns:
            if self.reference_data[column].dtype in ['int64', 'float64']:
                result = self._detect_numerical_drift(column, production_data)
            else:
                result = self._detect_categorical_drift(column, production_data)

            results.append(result)

        return results

    def _detect_numerical_drift(self, column: str, production_data: pd.DataFrame) -> DriftResult:
        """Detect drift in numerical features using KS test"""
        ref_values = self.reference_data[column].dropna()
        prod_values = production_data[column].dropna()

        statistic, p_value = stats.ks_2samp(ref_values, prod_values)

        return DriftResult(
            feature=column,
            drift_detected=statistic > self.threshold,
            metric_value=statistic,
            threshold=self.threshold,
            method="kolmogorov_smirnov"
        )

    def _detect_categorical_drift(self, column: str, production_data: pd.DataFrame) -> DriftResult:
        """Detect drift in categorical features using chi-squared test"""
        ref_counts = self.reference_data[column].value_counts()
        prod_counts = production_data[column].value_counts()

        # Align categories
        all_categories = set(ref_counts.index) | set(prod_counts.index)
        ref_aligned = [ref_counts.get(cat, 0) for cat in all_categories]
        prod_aligned = [prod_counts.get(cat, 0) for cat in all_categories]

        # Chi-squared test
        statistic, p_value = stats.chisquare(prod_aligned, ref_aligned)

        return DriftResult(
            feature=column,
            drift_detected=p_value < 0.05,
            metric_value=statistic,
            threshold=0.05,
            method="chi_squared"
        )

# Usage
reference_df = pd.read_csv("training_data.csv")
production_df = pd.read_csv("production_data.csv")

detector = DataDriftDetector(reference_df)
drift_results = detector.detect_drift(production_df)

for result in drift_results:
    status = "DRIFT" if result.drift_detected else "OK"
    print(f"{result.feature}: {status} ({result.method}: {result.metric_value:.4f})")
```

## Prediction Monitoring

```python
class PredictionMonitor:
    def __init__(self, baseline_predictions: np.ndarray):
        self.baseline_predictions = baseline_predictions
        self.baseline_distribution = self._compute_distribution(baseline_predictions)

    def _compute_distribution(self, predictions: np.ndarray) -> Dict:
        """Compute prediction distribution statistics"""
        return {
            "mean": np.mean(predictions),
            "std": np.std(predictions),
            "min": np.min(predictions),
            "max": np.max(predictions),
            "percentiles": {
                "p25": np.percentile(predictions, 25),
                "p50": np.percentile(predictions, 50),
                "p75": np.percentile(predictions, 75)
            }
        }

    def check_prediction_drift(self, current_predictions: np.ndarray, threshold: float = 0.1) -> Dict:
        """Check for prediction drift"""
        current_distribution = self._compute_distribution(current_predictions)

        # KS test
        ks_stat, p_value = stats.ks_2samp(self.baseline_predictions, current_predictions)

        # Calculate PSI
        psi = self._calculate_psi(self.baseline_predictions, current_predictions)

        return {
            "ks_statistic": ks_stat,
            "ks_p_value": p_value,
            "psi": psi,
            "drift_detected": ks_stat > threshold or psi > 0.2,
            "baseline_stats": self.baseline_distribution,
            "current_stats": current_distribution
        }

    def _calculate_psi(self, expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
        """Calculate Population Stability Index"""
        expected_hist, bin_edges = np.histogram(expected, bins=bins)
        actual_hist, _ = np.histogram(actual, bins=bin_edges)

        expected_pct = expected_hist / len(expected)
        actual_pct = actual_hist / len(actual)

        # Avoid division by zero
        expected_pct = np.where(expected_pct == 0, 0.0001, expected_pct)
        actual_pct = np.where(actual_pct == 0, 0.0001, actual_pct)

        psi = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
        return psi

# Usage
baseline_preds = np.array([0.3, 0.5, 0.7, 0.4, 0.6])
current_preds = np.array([0.5, 0.6, 0.8, 0.5, 0.7])

monitor = PredictionMonitor(baseline_preds)
drift_result = monitor.check_prediction_drift(current_preds)
print(f"Drift detected: {drift_result['drift_detected']}")
print(f"PSI: {drift_result['psi']:.4f}")
```

## Performance Monitoring

```python
class ModelPerformanceMonitor:
    def __init__(self, baseline_metrics: Dict):
        self.baseline_metrics = baseline_metrics
        self.alerts = []

    def evaluate(self, y_true: np.ndarray, y_pred: np.ndarray) -> Dict:
        """Evaluate model performance"""
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

        current_metrics = {
            "accuracy": accuracy_score(y_true, y_pred),
            "precision": precision_score(y_true, y_pred, average='weighted'),
            "recall": recall_score(y_true, y_pred, average='weighted'),
            "f1": f1_score(y_true, y_pred, average='weighted')
        }

        # Compare with baseline
        degradations = {}
        for metric, current_value in current_metrics.items():
            baseline_value = self.baseline_metrics.get(metric, current_value)
            degradation = (baseline_value - current_value) / baseline_value * 100

            if degradation > 5:  # 5% degradation threshold
                degradations[metric] = {
                    "baseline": baseline_value,
                    "current": current_value,
                    "degradation_pct": degradation
                }

        return {
            "current_metrics": current_metrics,
            "degradations": degradations,
            "alert": len(degradations) > 0
        }

# Usage
baseline = {"accuracy": 0.92, "precision": 0.90, "recall": 0.88, "f1": 0.89}
perf_monitor = ModelPerformanceMonitor(baseline)

# When ground truth becomes available
result = perf_monitor.evaluate(y_true, y_pred)
if result["alert"]:
    print("ALERT: Performance degradation detected!")
    for metric, details in result["degradations"].items():
        print(f"  {metric}: {details['current']:.3f} (was {details['baseline']:.3f})")
```

## Alerting Integration

```python
from azure.communication.email import EmailClient

class MonitoringAlertManager:
    def __init__(self, email_connection_string, sender_email):
        self.email_client = EmailClient.from_connection_string(email_connection_string)
        self.sender_email = sender_email

    def send_drift_alert(self, drift_results: List[DriftResult], recipients: List[str]):
        """Send alert for detected drift"""
        drifted_features = [r for r in drift_results if r.drift_detected]

        if not drifted_features:
            return

        subject = f"[ML Alert] Data Drift Detected - {len(drifted_features)} features"
        body = self._format_drift_alert(drifted_features)

        self._send_email(recipients, subject, body)

    def _format_drift_alert(self, drifted_features: List[DriftResult]) -> str:
        """Format drift alert email body"""
        lines = ["Data drift has been detected in the following features:\n"]

        for result in drifted_features:
            lines.append(f"- {result.feature}:")
            lines.append(f"    Method: {result.method}")
            lines.append(f"    Metric: {result.metric_value:.4f}")
            lines.append(f"    Threshold: {result.threshold}")

        lines.append("\nPlease investigate and consider retraining the model.")
        return "\n".join(lines)

    def _send_email(self, recipients, subject, body):
        """Send email via Azure Communication Services"""
        message = {
            "senderAddress": self.sender_email,
            "recipients": {
                "to": [{"address": r} for r in recipients]
            },
            "content": {
                "subject": subject,
                "plainText": body
            }
        }
        self.email_client.begin_send(message)
```

Comprehensive monitoring ensures your ML models maintain their performance and reliability in production.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
