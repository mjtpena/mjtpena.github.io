---
title: "AI Drift Detection: Monitoring Model Performance Over Time"
description: "Proactive drift detection prevents silent AI performance degradation."
author: Michael John Peña
draft: false
date: 2025-05-21
tags:
  - AI
  - Drift Detection
  - Monitoring
  - MLOps
  - Performance
---

## Drift Detection Implementation

```python
from dataclasses import dataclass
from typing import Dict, List
import numpy as np
from scipy import stats

@dataclass
class DriftAlert:
    drift_type: str
    severity: str
    metric: str
    baseline_value: float
    current_value: float
    p_value: float

class DriftDetector:
    def __init__(self, baseline_window_days: int = 30, detection_window_days: int = 1):
        self.baseline_window = baseline_window_days
        self.detection_window = detection_window_days
        self.baselines = {}

    def establish_baseline(self, metric_name: str, values: List[float]):
        """Establish baseline distribution for metric."""
        self.baselines[metric_name] = {
            "mean": np.mean(values),
            "std": np.std(values),
            "distribution": values,
            "percentiles": {
                "p5": np.percentile(values, 5),
                "p25": np.percentile(values, 25),
                "p50": np.percentile(values, 50),
                "p75": np.percentile(values, 75),
                "p95": np.percentile(values, 95)
            }
        }

    def detect_drift(self, metric_name: str, current_values: List[float]) -> DriftAlert:
        """Detect drift from baseline."""
        if metric_name not in self.baselines:
            return None

        baseline = self.baselines[metric_name]

        # Statistical tests
        # 1. Kolmogorov-Smirnov test for distribution shift
        ks_stat, ks_pvalue = stats.ks_2samp(baseline["distribution"], current_values)

        # 2. T-test for mean shift
        t_stat, t_pvalue = stats.ttest_ind(baseline["distribution"], current_values)

        # 3. Levene's test for variance change
        lev_stat, lev_pvalue = stats.levene(baseline["distribution"], current_values)

        # Determine drift type and severity
        drift_detected = False
        drift_type = None
        severity = None

        if ks_pvalue < 0.01:
            drift_detected = True
            drift_type = "distribution_shift"
            severity = "high" if ks_stat > 0.3 else "medium"

        elif t_pvalue < 0.05:
            drift_detected = True
            drift_type = "mean_shift"
            current_mean = np.mean(current_values)
            if abs(current_mean - baseline["mean"]) > 2 * baseline["std"]:
                severity = "high"
            else:
                severity = "medium"

        elif lev_pvalue < 0.05:
            drift_detected = True
            drift_type = "variance_change"
            severity = "low"

        if drift_detected:
            return DriftAlert(
                drift_type=drift_type,
                severity=severity,
                metric=metric_name,
                baseline_value=baseline["mean"],
                current_value=np.mean(current_values),
                p_value=min(ks_pvalue, t_pvalue, lev_pvalue)
            )

        return None

    def detect_concept_drift(self, predictions: List, actuals: List) -> Dict:
        """Detect concept drift through prediction accuracy changes."""
        # Calculate rolling accuracy
        window_size = 100
        accuracies = []

        for i in range(0, len(predictions) - window_size, window_size // 2):
            window_preds = predictions[i:i + window_size]
            window_actual = actuals[i:i + window_size]
            accuracy = sum(p == a for p, a in zip(window_preds, window_actual)) / window_size
            accuracies.append(accuracy)

        # Detect trend
        if len(accuracies) >= 5:
            trend = np.polyfit(range(len(accuracies)), accuracies, 1)[0]
            if trend < -0.01:  # Declining accuracy
                return {
                    "drift_detected": True,
                    "type": "concept_drift",
                    "trend": trend,
                    "recommendation": "Consider retraining or updating the model"
                }

        return {"drift_detected": False}
```

Proactive drift detection prevents silent AI performance degradation.
