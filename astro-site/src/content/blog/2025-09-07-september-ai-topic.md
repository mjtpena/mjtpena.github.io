---
title: "Responsible AI: Implementing Fairness Metrics in ML Pipelines"
author: Michael John Peña
draft: false
date: 2025-09-07
tags:
  - Responsible AI
  - Fairness
  - ML Ethics
  - Bias Detection
  - Azure ML

---

I wrote "Responsible AI: Implementing Fairness Metrics in ML Pipelines" to share practical, production-minded guidance on this topic.

## Understanding Fairness Metrics

Different fairness definitions apply to different contexts. Demographic parity, equalized odds, and calibration each capture distinct aspects of fairness.

```python
import numpy as np
from sklearn.metrics import confusion_matrix
from typing import Dict, List
from dataclasses import dataclass

@dataclass
class FairnessReport:
    demographic_parity_difference: float
    equalized_odds_difference: float
    calibration_difference: float
    group_metrics: Dict[str, Dict[str, float]]

class FairnessEvaluator:
    def __init__(self, y_true: np.ndarray, y_pred: np.ndarray,
                 sensitive_feature: np.ndarray):
        self.y_true = y_true
        self.y_pred = y_pred
        self.sensitive_feature = sensitive_feature
        self.groups = np.unique(sensitive_feature)

    def demographic_parity(self) -> Dict[str, float]:
        """Calculate selection rate for each group."""
        rates = {}
        for group in self.groups:
            mask = self.sensitive_feature == group
            rates[str(group)] = np.mean(self.y_pred[mask])
        return rates

    def equalized_odds(self) -> Dict[str, Dict[str, float]]:
        """Calculate TPR and FPR for each group."""
        metrics = {}
        for group in self.groups:
            mask = self.sensitive_feature == group
            tn, fp, fn, tp = confusion_matrix(
                self.y_true[mask],
                self.y_pred[mask]
            ).ravel()

            tpr = tp / (tp + fn) if (tp + fn) > 0 else 0
            fpr = fp / (fp + tn) if (fp + tn) > 0 else 0

            metrics[str(group)] = {"tpr": tpr, "fpr": fpr}
        return metrics

    def generate_report(self) -> FairnessReport:
        """Generate comprehensive fairness report."""
        dp = self.demographic_parity()
        eo = self.equalized_odds()

        dp_values = list(dp.values())
        dp_diff = max(dp_values) - min(dp_values)

        tpr_values = [m["tpr"] for m in eo.values()]
        fpr_values = [m["fpr"] for m in eo.values()]
        eo_diff = max(
            max(tpr_values) - min(tpr_values),
            max(fpr_values) - min(fpr_values)
        )

        return FairnessReport(
            demographic_parity_difference=dp_diff,
            equalized_odds_difference=eo_diff,
            calibration_difference=0.0,  # Simplified
            group_metrics={
                "demographic_parity": dp,
                "equalized_odds": eo
            }
        )
```

## Setting Thresholds

The four-fifths rule from employment law suggests selection rates should be within 80% of each other. For equalized odds, differences greater than 0.1 typically warrant investigation.

```python
def check_fairness_thresholds(report: FairnessReport) -> List[str]:
    """Check if fairness metrics exceed acceptable thresholds."""
    warnings = []

    if report.demographic_parity_difference > 0.2:
        warnings.append(f"Demographic parity violation: {report.demographic_parity_difference:.3f}")

    if report.equalized_odds_difference > 0.1:
        warnings.append(f"Equalized odds violation: {report.equalized_odds_difference:.3f}")

    return warnings
```

Integrate fairness evaluation into your CI/CD pipeline to catch bias issues before deployment. Responsible AI is not a one-time check but an ongoing commitment.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
