---
title: "Model Monitoring in Production: Detecting Drift Before It's Too Late"
author: Michael John Pena
draft: false
date: 2021-12-10
tags:
  - Machine Learning
  - MLOps
  - Monitoring
  - Data Drift
  - Model Performance

---

I wrote "Model Monitoring in Production: Detecting Drift Before It's Too Late" to share practical, production-minded guidance on this topic.

## Types of Drift

Understanding what can go wrong:

1. **Data Drift**: Input data distribution changes
2. **Concept Drift**: Relationship between inputs and outputs changes
3. **Label Drift**: Target variable distribution changes
4. **Feature Drift**: Individual feature distributions shift

## Implementing Data Drift Detection

```python
import numpy as np
from scipy import stats
from typing import Dict, List, Tuple
import pandas as pd

class DriftDetector:
    """Detect distribution drift between reference and current data"""

    def __init__(self, reference_data: pd.DataFrame, feature_columns: List[str]):
        self.reference = reference_data
        self.features = feature_columns
        self.reference_stats = self._compute_stats(reference_data)

    def _compute_stats(self, df: pd.DataFrame) -> Dict:
        stats = {}
        for col in self.features:
            if df[col].dtype in ['int64', 'float64']:
                stats[col] = {
                    'mean': df[col].mean(),
                    'std': df[col].std(),
                    'min': df[col].min(),
                    'max': df[col].max(),
                    'percentiles': df[col].quantile([0.25, 0.5, 0.75]).to_dict()
                }
            else:
                stats[col] = {
                    'value_counts': df[col].value_counts(normalize=True).to_dict()
                }
        return stats

    def detect_drift(self, current_data: pd.DataFrame,
                     threshold: float = 0.05) -> Dict[str, Dict]:
        """Detect drift using statistical tests"""
        results = {}

        for col in self.features:
            if current_data[col].dtype in ['int64', 'float64']:
                # Kolmogorov-Smirnov test for numeric features
                statistic, p_value = stats.ks_2samp(
                    self.reference[col].dropna(),
                    current_data[col].dropna()
                )
                drift_detected = p_value < threshold

                # Population Stability Index
                psi = self._calculate_psi(
                    self.reference[col],
                    current_data[col]
                )

                results[col] = {
                    'test': 'ks_2samp',
                    'statistic': statistic,
                    'p_value': p_value,
                    'psi': psi,
                    'drift_detected': drift_detected or psi > 0.2
                }
            else:
                # Chi-square test for categorical features
                chi2, p_value = self._chi_square_test(
                    self.reference[col],
                    current_data[col]
                )
                results[col] = {
                    'test': 'chi_square',
                    'statistic': chi2,
                    'p_value': p_value,
                    'drift_detected': p_value < threshold
                }

        return results

    def _calculate_psi(self, reference: pd.Series, current: pd.Series,
                       bins: int = 10) -> float:
        """Calculate Population Stability Index"""
        # Create bins from reference data
        _, bin_edges = np.histogram(reference.dropna(), bins=bins)

        # Calculate proportions
        ref_counts, _ = np.histogram(reference.dropna(), bins=bin_edges)
        cur_counts, _ = np.histogram(current.dropna(), bins=bin_edges)

        ref_props = ref_counts / len(reference.dropna())
        cur_props = cur_counts / len(current.dropna())

        # Avoid division by zero
        ref_props = np.where(ref_props == 0, 0.0001, ref_props)
        cur_props = np.where(cur_props == 0, 0.0001, cur_props)

        psi = np.sum((cur_props - ref_props) * np.log(cur_props / ref_props))
        return psi

    def _chi_square_test(self, reference: pd.Series,
                         current: pd.Series) -> Tuple[float, float]:
        """Chi-square test for categorical variables"""
        ref_counts = reference.value_counts()
        cur_counts = current.value_counts()

        # Align categories
        all_categories = set(ref_counts.index) | set(cur_counts.index)
        ref_aligned = pd.Series([ref_counts.get(c, 0) for c in all_categories])
        cur_aligned = pd.Series([cur_counts.get(c, 0) for c in all_categories])

        # Normalize
        ref_expected = ref_aligned / ref_aligned.sum() * cur_aligned.sum()

        chi2, p_value = stats.chisquare(cur_aligned, ref_expected)
        return chi2, p_value
```

## Model Performance Monitoring

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import json

@dataclass
class PredictionLog:
    timestamp: datetime
    model_version: str
    features: dict
    prediction: float
    prediction_probability: Optional[float]
    actual: Optional[float] = None  # Filled when ground truth arrives

class ModelMonitor:
    """Monitor model performance over time"""

    def __init__(self, model_name: str, performance_threshold: float = 0.8):
        self.model_name = model_name
        self.threshold = performance_threshold
        self.predictions: List[PredictionLog] = []

    def log_prediction(self, log: PredictionLog):
        self.predictions.append(log)
        self._check_alerts(log)

    def update_ground_truth(self, prediction_id: str, actual: float):
        """Update prediction with ground truth when available"""
        # Find and update prediction
        for pred in self.predictions:
            if pred.prediction_id == prediction_id:
                pred.actual = actual
                break

    def calculate_metrics(self, window_hours: int = 24) -> Dict:
        """Calculate performance metrics for recent predictions"""
        cutoff = datetime.utcnow() - timedelta(hours=window_hours)
        recent = [p for p in self.predictions
                  if p.timestamp > cutoff and p.actual is not None]

        if not recent:
            return {"status": "insufficient_data"}

        actuals = [p.actual for p in recent]
        predictions = [p.prediction for p in recent]

        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

        metrics = {
            "window_hours": window_hours,
            "sample_size": len(recent),
            "accuracy": accuracy_score(actuals, predictions),
            "precision": precision_score(actuals, predictions, average='weighted'),
            "recall": recall_score(actuals, predictions, average='weighted'),
            "f1": f1_score(actuals, predictions, average='weighted'),
            "timestamp": datetime.utcnow().isoformat()
        }

        # Check for degradation
        metrics["alert"] = metrics["accuracy"] < self.threshold

        return metrics

    def _check_alerts(self, log: PredictionLog):
        """Check for anomalous predictions"""
        # Low confidence predictions
        if log.prediction_probability and log.prediction_probability < 0.6:
            self._send_alert(
                "low_confidence",
                f"Low confidence prediction: {log.prediction_probability:.2f}"
            )

        # Feature out of range
        for feature, value in log.features.items():
            if self._is_out_of_range(feature, value):
                self._send_alert(
                    "feature_anomaly",
                    f"Feature {feature} out of expected range: {value}"
                )
```

## Azure ML Model Monitoring Integration

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    MonitoringTarget,
    MonitorDefinition,
    MonitorSchedule,
    DataDriftSignal,
    PredictionDriftSignal,
    DataQualitySignal
)
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-sub",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Define monitoring target
monitoring_target = MonitoringTarget(
    ml_task="classification",
    endpoint_deployment_id="azureml:customer-churn-endpoint:default"
)

# Define monitoring signals
data_drift_signal = DataDriftSignal(
    reference_data={
        "input_data": {"type": "uri_folder", "path": "azureml:reference-data:1"}
    },
    features={
        "include_all": True
    },
    metric_thresholds={
        "numerical_features": {
            "jensen_shannon_distance": 0.1
        },
        "categorical_features": {
            "pearsons_chi_squared_test": 0.05
        }
    }
)

prediction_drift_signal = PredictionDriftSignal(
    reference_data={
        "input_data": {"type": "uri_folder", "path": "azureml:reference-predictions:1"}
    },
    metric_thresholds={
        "normalized_wasserstein_distance": 0.1
    }
)

# Create monitor definition
monitor_definition = MonitorDefinition(
    compute="azureml:monitoring-compute",
    monitoring_target=monitoring_target,
    monitoring_signals={
        "data_drift": data_drift_signal,
        "prediction_drift": prediction_drift_signal
    },
    alert_notification_emails=["team@company.com"]
)

# Create scheduled monitor
monitor_schedule = MonitorSchedule(
    name="customer-churn-monitor",
    trigger={"type": "recurrence", "frequency": "day", "interval": 1},
    create_monitor=monitor_definition
)

ml_client.schedules.begin_create_or_update(monitor_schedule)
```

## Alerting Pipeline

```python
from azure.functions import func
import azure.functions as func
from azure.communication.email import EmailClient
import json

def send_drift_alert(context: func.Context, drift_results: dict):
    """Send alert when drift is detected"""

    drifted_features = [
        f for f, result in drift_results.items()
        if result.get('drift_detected', False)
    ]

    if not drifted_features:
        return

    # Format alert
    alert = {
        "severity": "high" if len(drifted_features) > 3 else "medium",
        "model_name": context.function_name,
        "timestamp": datetime.utcnow().isoformat(),
        "drifted_features": drifted_features,
        "details": {f: drift_results[f] for f in drifted_features},
        "recommended_action": "Review feature distributions and consider model retraining"
    }

    # Send to monitoring system
    send_to_application_insights(alert)

    # Send email for high severity
    if alert["severity"] == "high":
        email_client = EmailClient.from_connection_string(
            os.environ["COMMUNICATION_CONNECTION_STRING"]
        )

        message = {
            "senderAddress": "ml-alerts@company.com",
            "recipients": {
                "to": [{"address": "ml-team@company.com"}]
            },
            "content": {
                "subject": f"[ALERT] Data Drift Detected - {context.function_name}",
                "plainText": json.dumps(alert, indent=2)
            }
        }

        email_client.begin_send(message)
```

## Key Monitoring Metrics

| Metric | Purpose | Alert Threshold |
|--------|---------|-----------------|
| PSI (Population Stability Index) | Data distribution shift | > 0.2 |
| KL Divergence | Distribution comparison | > 0.1 |
| Accuracy Degradation | Model performance | > 5% drop |
| Prediction Latency | Operational health | > 200ms p99 |
| Prediction Volume | Usage patterns | > 3 std dev |

## Lessons from 2021

1. **Monitor Before You Need It**: Set up monitoring at deployment, not after issues
2. **Ground Truth Delays**: Plan for delayed labels
3. **Feature-Level Monitoring**: Aggregate metrics hide individual feature drift
4. **Automated Retraining**: Connect monitoring to retraining pipelines

Model monitoring in 2021 became non-negotiable for production ML. The tools improved, but the discipline of continuous monitoring is what separates production ML from experiments.

## Resources

- [Azure ML Model Monitoring](https://docs.microsoft.com/en-us/azure/machine-learning/how-to-monitor-datasets)
- [Evidently AI](https://evidentlyai.com/)
- [WhyLabs](https://whylabs.ai/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
