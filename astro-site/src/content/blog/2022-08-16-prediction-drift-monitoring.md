---
title: "Prediction Drift Monitoring for ML Models"
description: "Prediction drift monitoring provides early warning of model issues without waiting for ground truth labels."
author: "Michael John Peña"
draft: false
date: 2022-08-16
tags: ["Azure", "Machine Learning", "Prediction Drift", "MLOps", "Monitoring"]
---

## Why Monitor Prediction Drift

- Labels may be delayed or unavailable
- Early indicator of potential issues
- Detect operational changes affecting the model
- Identify distribution shifts in model outputs

## Prediction Drift Detector

```python
import numpy as np
import pandas as pd
from scipy import stats
from typing import Dict, List, Optional
from collections import deque

class PredictionDriftMonitor:
    """Monitor drift in model predictions"""

    def __init__(self, baseline_predictions: np.ndarray, task_type: str = 'classification'):
        self.baseline_predictions = baseline_predictions
        self.task_type = task_type
        self.baseline_stats = self._compute_stats(baseline_predictions)

    def _compute_stats(self, predictions: np.ndarray) -> Dict:
        """Compute prediction statistics"""
        if self.task_type == 'classification':
            if len(predictions.shape) > 1:
                # Probabilities
                return {
                    'mean_proba': predictions.mean(axis=0).tolist(),
                    'std_proba': predictions.std(axis=0).tolist(),
                    'class_distribution': np.argmax(predictions, axis=1),
                    'entropy': self._calculate_entropy(predictions)
                }
            else:
                # Class labels
                unique, counts = np.unique(predictions, return_counts=True)
                return {
                    'class_distribution': dict(zip(unique.tolist(), (counts / len(predictions)).tolist())),
                    'mode': unique[np.argmax(counts)]
                }
        else:
            # Regression
            return {
                'mean': predictions.mean(),
                'std': predictions.std(),
                'median': np.median(predictions),
                'q1': np.percentile(predictions, 25),
                'q3': np.percentile(predictions, 75),
                'min': predictions.min(),
                'max': predictions.max()
            }

    def _calculate_entropy(self, probabilities: np.ndarray) -> float:
        """Calculate average prediction entropy"""
        entropies = -np.sum(probabilities * np.log(probabilities + 1e-10), axis=1)
        return np.mean(entropies)

    def check_drift(self, current_predictions: np.ndarray, threshold: float = 0.1) -> Dict:
        """Check for prediction drift"""
        current_stats = self._compute_stats(current_predictions)

        if self.task_type == 'classification':
            return self._check_classification_drift(current_predictions, current_stats, threshold)
        else:
            return self._check_regression_drift(current_predictions, current_stats, threshold)

    def _check_classification_drift(self, predictions: np.ndarray,
                                     current_stats: Dict, threshold: float) -> Dict:
        """Check drift for classification predictions"""
        if len(predictions.shape) > 1:
            # Compare probability distributions
            baseline_flat = self.baseline_predictions.flatten()
            current_flat = predictions.flatten()
            ks_stat, p_value = stats.ks_2samp(baseline_flat, current_flat)

            # Compare class distributions
            baseline_classes = np.argmax(self.baseline_predictions, axis=1)
            current_classes = np.argmax(predictions, axis=1)

            baseline_dist = np.bincount(baseline_classes, minlength=predictions.shape[1]) / len(baseline_classes)
            current_dist = np.bincount(current_classes, minlength=predictions.shape[1]) / len(current_classes)

            js_div = self._js_divergence(baseline_dist, current_dist)

            # Compare entropy
            baseline_entropy = self.baseline_stats['entropy']
            current_entropy = current_stats['entropy']
            entropy_change = abs(current_entropy - baseline_entropy) / baseline_entropy

            drift_detected = ks_stat > threshold or js_div > threshold or entropy_change > 0.2

            return {
                'drift_detected': drift_detected,
                'ks_statistic': ks_stat,
                'p_value': p_value,
                'js_divergence': js_div,
                'entropy_change': entropy_change,
                'baseline_stats': self.baseline_stats,
                'current_stats': current_stats
            }
        else:
            # Class labels only
            baseline_dist = self.baseline_stats['class_distribution']
            current_unique, current_counts = np.unique(predictions, return_counts=True)
            current_dist = dict(zip(current_unique.tolist(), (current_counts / len(predictions)).tolist()))

            # Chi-squared test
            all_classes = set(baseline_dist.keys()) | set(current_dist.keys())
            baseline_freqs = np.array([baseline_dist.get(c, 0.001) for c in all_classes])
            current_freqs = np.array([current_dist.get(c, 0.001) for c in all_classes])

            chi_stat, p_value = stats.chisquare(current_freqs, baseline_freqs)

            return {
                'drift_detected': p_value < 0.05,
                'chi_statistic': chi_stat,
                'p_value': p_value,
                'baseline_distribution': baseline_dist,
                'current_distribution': current_dist
            }

    def _check_regression_drift(self, predictions: np.ndarray,
                                 current_stats: Dict, threshold: float) -> Dict:
        """Check drift for regression predictions"""
        # KS test
        ks_stat, p_value = stats.ks_2samp(self.baseline_predictions, predictions)

        # PSI
        psi = self._calculate_psi(self.baseline_predictions, predictions)

        # Mean shift
        mean_shift = abs(current_stats['mean'] - self.baseline_stats['mean']) / self.baseline_stats['std']

        drift_detected = ks_stat > threshold or psi > 0.2 or mean_shift > 2

        return {
            'drift_detected': drift_detected,
            'ks_statistic': ks_stat,
            'p_value': p_value,
            'psi': psi,
            'mean_shift_zscore': mean_shift,
            'baseline_stats': self.baseline_stats,
            'current_stats': current_stats
        }

    def _js_divergence(self, p: np.ndarray, q: np.ndarray) -> float:
        """Calculate Jensen-Shannon divergence"""
        p = np.array(p) + 1e-10
        q = np.array(q) + 1e-10
        m = 0.5 * (p + q)
        return 0.5 * stats.entropy(p, m) + 0.5 * stats.entropy(q, m)

    def _calculate_psi(self, expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
        """Calculate Population Stability Index"""
        _, bin_edges = np.histogram(expected, bins=bins)
        expected_hist, _ = np.histogram(expected, bins=bin_edges)
        actual_hist, _ = np.histogram(actual, bins=bin_edges)

        expected_pct = expected_hist / len(expected) + 1e-10
        actual_pct = actual_hist / len(actual) + 1e-10

        psi = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
        return psi


class StreamingPredictionMonitor:
    """Monitor prediction drift in streaming fashion"""

    def __init__(self, baseline_predictions: np.ndarray, window_size: int = 1000):
        self.baseline_monitor = PredictionDriftMonitor(baseline_predictions)
        self.window_size = window_size
        self.prediction_buffer = deque(maxlen=window_size)
        self.drift_history = []

    def add_prediction(self, prediction: np.ndarray):
        """Add a new prediction to the buffer"""
        self.prediction_buffer.append(prediction)

    def check_drift(self, threshold: float = 0.1) -> Optional[Dict]:
        """Check for drift using buffered predictions"""
        if len(self.prediction_buffer) < self.window_size // 2:
            return None

        predictions_array = np.array(list(self.prediction_buffer))
        result = self.baseline_monitor.check_drift(predictions_array, threshold)

        self.drift_history.append({
            'timestamp': datetime.utcnow().isoformat(),
            'buffer_size': len(self.prediction_buffer),
            'result': result
        })

        return result
```

## Visualization

```python
import matplotlib.pyplot as plt

def visualize_prediction_drift(baseline_preds, current_preds, drift_result, task_type='classification'):
    """Visualize prediction drift"""
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))

    if task_type == 'classification' and len(baseline_preds.shape) > 1:
        # Probability distributions for each class
        n_classes = baseline_preds.shape[1]

        for i in range(min(n_classes, 4)):
            ax = axes[i // 2, i % 2] if n_classes > 1 else axes[0, 0]
            ax.hist(baseline_preds[:, i], bins=50, alpha=0.5, label='Baseline', density=True)
            ax.hist(current_preds[:, i], bins=50, alpha=0.5, label='Current', density=True)
            ax.set_title(f'Class {i} Probability')
            ax.legend()
    else:
        # Regression or class labels
        axes[0, 0].hist(baseline_preds, bins=50, alpha=0.5, label='Baseline', density=True)
        axes[0, 0].hist(current_preds, bins=50, alpha=0.5, label='Current', density=True)
        axes[0, 0].set_title('Prediction Distribution')
        axes[0, 0].legend()

        # Q-Q plot
        baseline_sorted = np.sort(baseline_preds.flatten())
        current_sorted = np.sort(current_preds.flatten())
        min_len = min(len(baseline_sorted), len(current_sorted))
        axes[0, 1].scatter(
            baseline_sorted[::len(baseline_sorted)//min_len][:min_len],
            current_sorted[::len(current_sorted)//min_len][:min_len],
            alpha=0.5
        )
        axes[0, 1].plot([baseline_sorted.min(), baseline_sorted.max()],
                        [baseline_sorted.min(), baseline_sorted.max()], 'r--')
        axes[0, 1].set_xlabel('Baseline Quantiles')
        axes[0, 1].set_ylabel('Current Quantiles')
        axes[0, 1].set_title('Q-Q Plot')

        # Statistics comparison
        stats_text = "Drift Analysis:\n\n"
        stats_text += f"KS Statistic: {drift_result.get('ks_statistic', 'N/A'):.4f}\n"
        stats_text += f"P-Value: {drift_result.get('p_value', 'N/A'):.4f}\n"
        stats_text += f"PSI: {drift_result.get('psi', 'N/A'):.4f}\n"
        stats_text += f"Drift Detected: {drift_result.get('drift_detected', 'N/A')}\n"

        axes[1, 0].text(0.1, 0.5, stats_text, fontsize=12, verticalalignment='center',
                        family='monospace', transform=axes[1, 0].transAxes)
        axes[1, 0].axis('off')
        axes[1, 0].set_title('Statistics')

        # Time series of predictions (if available)
        axes[1, 1].plot(range(len(baseline_preds)), baseline_preds, alpha=0.5, label='Baseline')
        axes[1, 1].plot(range(len(current_preds)), current_preds, alpha=0.5, label='Current')
        axes[1, 1].legend()
        axes[1, 1].set_title('Prediction Time Series')

    plt.tight_layout()
    return fig
```

## Integration with Model Serving

```python
class MonitoredModelEndpoint:
    """Model endpoint with prediction monitoring"""

    def __init__(self, model, baseline_predictions: np.ndarray, alert_threshold: float = 0.1):
        self.model = model
        self.monitor = StreamingPredictionMonitor(baseline_predictions)
        self.alert_threshold = alert_threshold

    def predict(self, X) -> Dict:
        """Make prediction and monitor drift"""
        prediction = self.model.predict_proba(X) if hasattr(self.model, 'predict_proba') else self.model.predict(X)

        # Add to monitor
        for pred in prediction:
            self.monitor.add_prediction(pred)

        # Check drift periodically
        drift_result = None
        if len(self.monitor.prediction_buffer) % 100 == 0:
            drift_result = self.monitor.check_drift(self.alert_threshold)
            if drift_result and drift_result['drift_detected']:
                self._handle_drift_alert(drift_result)

        return {
            'predictions': prediction.tolist(),
            'drift_check': drift_result
        }

    def _handle_drift_alert(self, drift_result: Dict):
        """Handle drift detection alert"""
        print(f"ALERT: Prediction drift detected!")
        print(f"  KS Statistic: {drift_result.get('ks_statistic', 'N/A'):.4f}")
        # Send to monitoring system, Slack, etc.
```

Prediction drift monitoring provides early warning of model issues without waiting for ground truth labels.
