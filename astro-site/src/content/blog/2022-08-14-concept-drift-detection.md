---
title: "Concept Drift Detection in Machine Learning"
author: "Michael John Peña"
draft: false
date: 2022-08-14
tags: ["Azure", "Machine Learning", "Concept Drift", "MLOps", "Monitoring"]

---

I wrote "Concept Drift Detection in Machine Learning" to share practical, production-minded guidance on this topic.

## Understanding Concept Drift Types

- **Sudden Drift**: Abrupt change in the concept
- **Gradual Drift**: Slow transition between concepts
- **Incremental Drift**: Continuous small changes
- **Recurring Drift**: Concepts that reappear periodically

## Detection Methods

```python
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import accuracy_score, log_loss
from collections import deque

class ConceptDriftDetector:
    """Detect concept drift using model performance monitoring"""

    def __init__(self, model, baseline_performance: float, window_size: int = 500):
        self.model = model
        self.baseline_performance = baseline_performance
        self.window_size = window_size
        self.performance_window = deque(maxlen=window_size)

    def update(self, X, y_true) -> dict:
        """Update with new data and check for drift"""
        y_pred = self.model.predict(X)

        # Calculate performance for this batch
        batch_performance = accuracy_score(y_true, y_pred)
        self.performance_window.append(batch_performance)

        # Check for drift when we have enough data
        if len(self.performance_window) >= self.window_size // 2:
            return self._check_drift()

        return {"drift_detected": False, "status": "collecting_data"}

    def _check_drift(self) -> dict:
        """Check for concept drift using performance degradation"""
        window_performance = np.mean(list(self.performance_window))
        degradation = (self.baseline_performance - window_performance) / self.baseline_performance

        # Statistical test for performance drop
        performances = list(self.performance_window)
        t_stat, p_value = stats.ttest_1samp(performances, self.baseline_performance)

        drift_detected = degradation > 0.05 and p_value < 0.05

        return {
            "drift_detected": drift_detected,
            "baseline_performance": self.baseline_performance,
            "current_performance": window_performance,
            "degradation_pct": degradation * 100,
            "p_value": p_value
        }


class PageHinkleyTest:
    """Page-Hinkley test for concept drift detection"""

    def __init__(self, min_instances: int = 30, delta: float = 0.005, threshold: float = 50):
        self.min_instances = min_instances
        self.delta = delta
        self.threshold = threshold
        self.reset()

    def reset(self):
        """Reset the detector"""
        self.n = 0
        self.sum = 0.0
        self.x_mean = 0.0
        self.p_h_sum = 0.0
        self.p_h_min = float('inf')

    def update(self, value: float) -> dict:
        """Update with new value and check for drift"""
        self.n += 1

        # Update mean
        self.x_mean = self.x_mean + (value - self.x_mean) / self.n

        # Update cumulative sum
        self.sum += value - self.x_mean - self.delta

        # Update Page-Hinkley values
        self.p_h_sum = self.sum
        self.p_h_min = min(self.p_h_min, self.p_h_sum)

        # Check for drift
        p_h_value = self.p_h_sum - self.p_h_min
        drift_detected = self.n >= self.min_instances and p_h_value > self.threshold

        return {
            "drift_detected": drift_detected,
            "p_h_value": p_h_value,
            "threshold": self.threshold,
            "n_samples": self.n
        }


class DDM:
    """Drift Detection Method (DDM)"""

    def __init__(self, min_instances: int = 30, warning_level: float = 2.0, drift_level: float = 3.0):
        self.min_instances = min_instances
        self.warning_level = warning_level
        self.drift_level = drift_level
        self.reset()

    def reset(self):
        """Reset the detector"""
        self.n = 0
        self.p = 0.0  # Error rate
        self.s = 0.0  # Standard deviation
        self.p_min = float('inf')
        self.s_min = float('inf')

    def update(self, prediction_correct: bool) -> dict:
        """Update with prediction result"""
        self.n += 1

        # Update error rate
        if prediction_correct:
            error = 0
        else:
            error = 1

        self.p = self.p + (error - self.p) / self.n
        self.s = np.sqrt(self.p * (1 - self.p) / self.n)

        # Update minimums
        if self.p + self.s < self.p_min + self.s_min:
            self.p_min = self.p
            self.s_min = self.s

        # Check thresholds
        if self.n < self.min_instances:
            return {"status": "collecting", "drift_detected": False, "warning": False}

        drift_threshold = self.p_min + self.drift_level * self.s_min
        warning_threshold = self.p_min + self.warning_level * self.s_min

        drift_detected = self.p + self.s > drift_threshold
        warning = self.p + self.s > warning_threshold and not drift_detected

        if drift_detected:
            self.reset()

        return {
            "drift_detected": drift_detected,
            "warning": warning,
            "error_rate": self.p,
            "threshold": drift_threshold,
            "n_samples": self.n
        }
```

## ADWIN Algorithm

```python
class ADWIN:
    """Adaptive Windowing for drift detection"""

    def __init__(self, delta: float = 0.002, max_buckets: int = 5):
        self.delta = delta
        self.max_buckets = max_buckets
        self.reset()

    def reset(self):
        """Reset the detector"""
        self.bucket_sizes = []
        self.bucket_totals = []
        self.total = 0.0
        self.variance = 0.0
        self.width = 0

    def update(self, value: float) -> dict:
        """Add new value and check for drift"""
        self._add_element(value)
        drift_detected = self._detect_change()

        return {
            "drift_detected": drift_detected,
            "window_size": self.width,
            "mean": self.total / self.width if self.width > 0 else 0
        }

    def _add_element(self, value: float):
        """Add element to window"""
        self.width += 1
        self.total += value

        # Add to buckets (simplified ADWIN)
        self.bucket_sizes.append(1)
        self.bucket_totals.append(value)

        # Merge buckets if needed
        self._compress_buckets()

    def _compress_buckets(self):
        """Compress buckets to maintain logarithmic space"""
        i = 0
        while i < len(self.bucket_sizes) - 1:
            if self.bucket_sizes[i] == self.bucket_sizes[i + 1]:
                # Merge buckets
                self.bucket_sizes[i] *= 2
                self.bucket_totals[i] += self.bucket_totals[i + 1]
                del self.bucket_sizes[i + 1]
                del self.bucket_totals[i + 1]
            else:
                i += 1

    def _detect_change(self) -> bool:
        """Detect if there's a significant change in the window"""
        if self.width < 10:
            return False

        # Compare first and second half means
        half = self.width // 2
        first_half_total = sum(self.bucket_totals[:half])
        second_half_total = sum(self.bucket_totals[half:])

        mean_diff = abs(first_half_total / half - second_half_total / (self.width - half))

        # Simplified threshold
        threshold = np.sqrt(np.log(2 / self.delta) / (2 * half))

        if mean_diff > threshold:
            # Remove old elements
            self.bucket_sizes = self.bucket_sizes[half:]
            self.bucket_totals = self.bucket_totals[half:]
            self.width = self.width - half
            self.total = sum(self.bucket_totals)
            return True

        return False
```

## Combining Multiple Detectors

```python
class EnsembleDriftDetector:
    """Ensemble of multiple drift detection methods"""

    def __init__(self, model, baseline_performance: float):
        self.performance_detector = ConceptDriftDetector(model, baseline_performance)
        self.ph_detector = PageHinkleyTest()
        self.ddm_detector = DDM()
        self.adwin_detector = ADWIN()

    def update(self, X, y_true, y_pred) -> dict:
        """Update all detectors and return consensus"""
        # Performance-based detection
        perf_result = self.performance_detector.update(X, y_true)

        # Error-based detection
        errors = (y_pred != y_true).astype(float)
        error_rate = np.mean(errors)

        ph_result = self.ph_detector.update(error_rate)
        adwin_result = self.adwin_detector.update(error_rate)

        # Per-prediction detection
        ddm_results = [self.ddm_detector.update(pred == true)
                       for pred, true in zip(y_pred, y_true)]
        ddm_drift = any(r['drift_detected'] for r in ddm_results)

        # Voting
        votes = [
            perf_result['drift_detected'],
            ph_result['drift_detected'],
            adwin_result['drift_detected'],
            ddm_drift
        ]

        drift_detected = sum(votes) >= 2  # Majority voting

        return {
            "drift_detected": drift_detected,
            "votes": sum(votes),
            "details": {
                "performance": perf_result,
                "page_hinkley": ph_result,
                "adwin": adwin_result,
                "ddm": ddm_drift
            }
        }
```

## Visualization

```python
import matplotlib.pyplot as plt

def visualize_concept_drift(timestamps, error_rates, drift_points, title="Concept Drift Detection"):
    """Visualize error rate and detected drift points"""
    fig, ax = plt.subplots(figsize=(12, 5))

    ax.plot(timestamps, error_rates, label='Error Rate', color='blue')

    # Mark drift points
    for drift_time in drift_points:
        ax.axvline(x=drift_time, color='red', linestyle='--', alpha=0.7, label='Drift Detected')

    ax.set_xlabel('Time')
    ax.set_ylabel('Error Rate')
    ax.set_title(title)
    ax.legend()

    plt.tight_layout()
    return fig

# Simulated usage
timestamps = list(range(1000))
error_rates = np.concatenate([
    np.random.normal(0.1, 0.02, 400),  # Normal period
    np.random.normal(0.25, 0.03, 300),  # Drift period
    np.random.normal(0.12, 0.02, 300)   # Recovery
])
drift_points = [400, 700]

fig = visualize_concept_drift(timestamps, error_rates, drift_points)
plt.savefig("concept_drift.png")
```

Detecting concept drift enables timely model retraining to maintain prediction accuracy over time.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
