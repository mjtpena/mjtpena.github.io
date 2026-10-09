---
title: "Bias Detection and Fairness Metrics for AI Systems"
author: Michael John Peña
draft: false
date: 2023-02-28
tags:
  - AI
  - Fairness
  - Bias Detection
  - Machine Learning
  - Ethics
---

## Understanding Bias in AI

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class BiasType(Enum):
    SELECTION = "selection"         # Biased data collection
    MEASUREMENT = "measurement"     # Biased features or labels
    AGGREGATION = "aggregation"     # Loss of subgroup patterns
    EVALUATION = "evaluation"       # Biased benchmarks
    DEPLOYMENT = "deployment"       # Biased usage context

@dataclass
class BiasSource:
    type: BiasType
    description: str
    detection_method: str
    mitigation_strategy: str

COMMON_BIAS_SOURCES = [
    BiasSource(
        type=BiasType.SELECTION,
        description="Training data doesn't represent all populations",
        detection_method="Compare data distribution with target population",
        mitigation_strategy="Collect more representative data or use resampling"
    ),
    BiasSource(
        type=BiasType.MEASUREMENT,
        description="Labels reflect historical bias",
        detection_method="Audit labeling process and historical outcomes",
        mitigation_strategy="Re-label or use fairness constraints during training"
    ),
    BiasSource(
        type=BiasType.AGGREGATION,
        description="Single model fails different subgroups",
        detection_method="Evaluate metrics by subgroup",
        mitigation_strategy="Use group-specific models or fairness constraints"
    )
]
```

## Fairness Metrics Implementation

```python
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple
from sklearn.metrics import confusion_matrix

class FairnessMetrics:
    """Calculate fairness metrics for ML models."""

    def __init__(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        y_prob: np.ndarray,
        sensitive_feature: np.ndarray
    ):
        self.y_true = y_true
        self.y_pred = y_pred
        self.y_prob = y_prob
        self.sensitive = sensitive_feature
        self.groups = np.unique(sensitive_feature)

    def _get_group_mask(self, group) -> np.ndarray:
        return self.sensitive == group

    def demographic_parity(self) -> Dict:
        """
        Demographic Parity: P(Y_hat=1|A=a) = P(Y_hat=1|A=b)
        All groups should have equal positive prediction rates.
        """
        rates = {}
        for group in self.groups:
            mask = self._get_group_mask(group)
            rates[group] = self.y_pred[mask].mean()

        min_rate = min(rates.values())
        max_rate = max(rates.values())

        return {
            "group_rates": rates,
            "ratio": min_rate / max_rate if max_rate > 0 else 1,
            "difference": max_rate - min_rate,
            "is_fair": (min_rate / max_rate) >= 0.8 if max_rate > 0 else True
        }

    def equalized_odds(self) -> Dict:
        """
        Equalized Odds: TPR and FPR should be equal across groups.
        """
        metrics = {}

        for group in self.groups:
            mask = self._get_group_mask(group)
            y_t = self.y_true[mask]
            y_p = self.y_pred[mask]

            # True Positive Rate
            tpr = y_p[y_t == 1].mean() if (y_t == 1).sum() > 0 else 0

            # False Positive Rate
            fpr = y_p[y_t == 0].mean() if (y_t == 0).sum() > 0 else 0

            metrics[group] = {"tpr": tpr, "fpr": fpr}

        tpr_values = [m["tpr"] for m in metrics.values()]
        fpr_values = [m["fpr"] for m in metrics.values()]

        return {
            "group_metrics": metrics,
            "tpr_ratio": min(tpr_values) / max(tpr_values) if max(tpr_values) > 0 else 1,
            "fpr_ratio": min(fpr_values) / max(fpr_values) if max(fpr_values) > 0 else 1,
            "tpr_difference": max(tpr_values) - min(tpr_values),
            "fpr_difference": max(fpr_values) - min(fpr_values)
        }

    def equal_opportunity(self) -> Dict:
        """
        Equal Opportunity: TPR should be equal across groups.
        Focuses only on positive class.
        """
        tpr_by_group = {}

        for group in self.groups:
            mask = self._get_group_mask(group)
            y_t = self.y_true[mask]
            y_p = self.y_pred[mask]

            # True Positive Rate
            positive_mask = y_t == 1
            if positive_mask.sum() > 0:
                tpr = y_p[positive_mask].mean()
            else:
                tpr = 0

            tpr_by_group[group] = tpr

        min_tpr = min(tpr_by_group.values())
        max_tpr = max(tpr_by_group.values())

        return {
            "tpr_by_group": tpr_by_group,
            "ratio": min_tpr / max_tpr if max_tpr > 0 else 1,
            "difference": max_tpr - min_tpr,
            "is_fair": (min_tpr / max_tpr) >= 0.8 if max_tpr > 0 else True
        }

    def calibration_by_group(self) -> Dict:
        """
        Calibration: P(Y=1|Y_hat=p, A=a) should equal p for all groups.
        """
        calibration = {}

        for group in self.groups:
            mask = self._get_group_mask(group)
            probs = self.y_prob[mask]
            true = self.y_true[mask]

            # Bin probabilities
            bins = np.linspace(0, 1, 11)
            bin_indices = np.digitize(probs, bins)

            bin_stats = []
            for i in range(1, len(bins)):
                bin_mask = bin_indices == i
                if bin_mask.sum() > 0:
                    expected = bins[i-1:i+1].mean()
                    actual = true[bin_mask].mean()
                    bin_stats.append({
                        "expected": expected,
                        "actual": actual,
                        "count": bin_mask.sum()
                    })

            calibration[group] = bin_stats

        return calibration

    def get_all_metrics(self) -> Dict:
        """Get comprehensive fairness metrics."""
        return {
            "demographic_parity": self.demographic_parity(),
            "equalized_odds": self.equalized_odds(),
            "equal_opportunity": self.equal_opportunity()
        }

    def generate_report(self) -> str:
        """Generate human-readable fairness report."""
        metrics = self.get_all_metrics()

        report = "# Fairness Metrics Report\n\n"

        # Demographic Parity
        dp = metrics["demographic_parity"]
        report += "## Demographic Parity\n"
        report += f"- Ratio: {dp['ratio']:.3f} (target: >= 0.8)\n"
        report += f"- Fair: {'Yes' if dp['is_fair'] else 'No'}\n"
        for group, rate in dp["group_rates"].items():
            report += f"- {group}: {rate:.3f}\n"
        report += "\n"

        # Equal Opportunity
        eo = metrics["equal_opportunity"]
        report += "## Equal Opportunity\n"
        report += f"- TPR Ratio: {eo['ratio']:.3f} (target: >= 0.8)\n"
        report += f"- Fair: {'Yes' if eo['is_fair'] else 'No'}\n"
        for group, tpr in eo["tpr_by_group"].items():
            report += f"- {group} TPR: {tpr:.3f}\n"
        report += "\n"

        # Equalized Odds
        eod = metrics["equalized_odds"]
        report += "## Equalized Odds\n"
        report += f"- TPR Ratio: {eod['tpr_ratio']:.3f}\n"
        report += f"- FPR Ratio: {eod['fpr_ratio']:.3f}\n"

        return report
```

## Bias Mitigation Techniques

```python
from sklearn.base import BaseEstimator, TransformerMixin

class BiasmitigationPreprocessor(BaseEstimator, TransformerMixin):
    """Preprocessing techniques for bias mitigation."""

    def __init__(self, method: str = "reweighting"):
        self.method = method
        self.weights = None

    def fit(self, X, y, sensitive):
        """Fit the preprocessor."""
        if self.method == "reweighting":
            self._fit_reweighting(y, sensitive)
        return self

    def _fit_reweighting(self, y, sensitive):
        """Calculate reweighting factors."""
        # Calculate expected probability under fairness
        p_favorable = y.mean()

        self.weights = {}
        for group in np.unique(sensitive):
            group_mask = sensitive == group
            p_group = group_mask.mean()

            for label in [0, 1]:
                label_mask = y == label
                combined_mask = group_mask & label_mask

                p_joint_expected = p_group * (p_favorable if label == 1 else 1 - p_favorable)
                p_joint_observed = combined_mask.mean()

                if p_joint_observed > 0:
                    weight = p_joint_expected / p_joint_observed
                else:
                    weight = 1.0

                self.weights[(group, label)] = weight

    def transform(self, X, y=None, sensitive=None):
        """Transform returns sample weights."""
        if sensitive is None or y is None:
            return X

        sample_weights = np.ones(len(X))
        for i in range(len(X)):
            key = (sensitive[i], y[i])
            sample_weights[i] = self.weights.get(key, 1.0)

        return X, sample_weights

class InProcessingMitigation:
    """In-processing bias mitigation during training."""

    def __init__(self, lambda_fairness: float = 1.0):
        self.lambda_fairness = lambda_fairness

    def fairness_loss(
        self,
        y_pred: np.ndarray,
        sensitive: np.ndarray
    ) -> float:
        """Calculate fairness penalty term."""
        groups = np.unique(sensitive)
        group_rates = []

        for group in groups:
            mask = sensitive == group
            group_rates.append(y_pred[mask].mean())

        # Demographic parity penalty
        max_diff = max(group_rates) - min(group_rates)
        return self.lambda_fairness * max_diff

    def combined_loss(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        sensitive: np.ndarray,
        base_loss_fn
    ) -> float:
        """Combined loss with fairness penalty."""
        base_loss = base_loss_fn(y_true, y_pred)
        fairness_penalty = self.fairness_loss(y_pred, sensitive)
        return base_loss + fairness_penalty

class PostProcessingMitigation:
    """Post-processing techniques for bias mitigation."""

    def __init__(self):
        self.thresholds = {}

    def calibrate_thresholds(
        self,
        y_prob: np.ndarray,
        y_true: np.ndarray,
        sensitive: np.ndarray,
        target_rate: float = None
    ):
        """Find group-specific thresholds for equal positive rates."""
        if target_rate is None:
            # Use overall positive rate as target
            target_rate = y_true.mean()

        for group in np.unique(sensitive):
            mask = sensitive == group
            probs = y_prob[mask]

            # Find threshold that achieves target rate
            sorted_probs = np.sort(probs)[::-1]
            target_count = int(target_rate * len(probs))
            threshold = sorted_probs[min(target_count, len(sorted_probs) - 1)]

            self.thresholds[group] = threshold

    def apply_thresholds(
        self,
        y_prob: np.ndarray,
        sensitive: np.ndarray
    ) -> np.ndarray:
        """Apply group-specific thresholds."""
        y_pred = np.zeros(len(y_prob))

        for group, threshold in self.thresholds.items():
            mask = sensitive == group
            y_pred[mask] = (y_prob[mask] >= threshold).astype(int)

        return y_pred
```

## Fairness Dashboard

```python
class FairnessDashboard:
    """Dashboard for fairness monitoring."""

    def __init__(self):
        self.history = []

    def log_evaluation(
        self,
        model_id: str,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        y_prob: np.ndarray,
        sensitive: np.ndarray
    ):
        """Log a fairness evaluation."""
        metrics = FairnessMetrics(y_true, y_pred, y_prob, sensitive)
        all_metrics = metrics.get_all_metrics()

        self.history.append({
            "timestamp": datetime.now().isoformat(),
            "model_id": model_id,
            "metrics": all_metrics
        })

    def check_fairness_alerts(self, thresholds: Dict = None) -> List[Dict]:
        """Check for fairness violations."""
        thresholds = thresholds or {
            "demographic_parity_ratio": 0.8,
            "equal_opportunity_ratio": 0.8
        }

        alerts = []
        if not self.history:
            return alerts

        latest = self.history[-1]["metrics"]

        if latest["demographic_parity"]["ratio"] < thresholds["demographic_parity_ratio"]:
            alerts.append({
                "type": "demographic_parity",
                "severity": "high",
                "value": latest["demographic_parity"]["ratio"],
                "threshold": thresholds["demographic_parity_ratio"]
            })

        if latest["equal_opportunity"]["ratio"] < thresholds["equal_opportunity_ratio"]:
            alerts.append({
                "type": "equal_opportunity",
                "severity": "high",
                "value": latest["equal_opportunity"]["ratio"],
                "threshold": thresholds["equal_opportunity_ratio"]
            })

        return alerts

    def get_trend(self, metric: str, lookback: int = 10) -> List[float]:
        """Get metric trend over time."""
        values = []
        for entry in self.history[-lookback:]:
            if metric == "demographic_parity":
                values.append(entry["metrics"]["demographic_parity"]["ratio"])
            elif metric == "equal_opportunity":
                values.append(entry["metrics"]["equal_opportunity"]["ratio"])
        return values
```

## Integration Example

```python
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier

def train_fair_model(X, y, sensitive, mitigation="reweighting"):
    """Train model with fairness mitigation."""

    # Split data
    X_train, X_test, y_train, y_test, s_train, s_test = train_test_split(
        X, y, sensitive, test_size=0.2, random_state=42
    )

    if mitigation == "reweighting":
        # Pre-processing mitigation
        preprocessor = BiasmitigationPreprocessor(method="reweighting")
        preprocessor.fit(X_train, y_train, s_train)
        X_train, sample_weights = preprocessor.transform(X_train, y_train, s_train)

        model = RandomForestClassifier(random_state=42)
        model.fit(X_train, y_train, sample_weight=sample_weights)

    elif mitigation == "threshold_adjustment":
        # Post-processing mitigation
        model = RandomForestClassifier(random_state=42)
        model.fit(X_train, y_train)

        y_prob_train = model.predict_proba(X_train)[:, 1]

        post_processor = PostProcessingMitigation()
        post_processor.calibrate_thresholds(y_prob_train, y_train, s_train)

        y_prob_test = model.predict_proba(X_test)[:, 1]
        y_pred = post_processor.apply_thresholds(y_prob_test, s_test)

    else:
        model = RandomForestClassifier(random_state=42)
        model.fit(X_train, y_train)

    # Evaluate fairness
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    fairness_metrics = FairnessMetrics(y_test, y_pred, y_prob, s_test)
    report = fairness_metrics.generate_report()

    return model, report
```

## Best Practices

1. **Measure multiple metrics**: No single metric captures all fairness
2. **Choose appropriate metrics**: Based on your use case
3. **Consider trade-offs**: Fairness vs accuracy
4. **Monitor continuously**: Bias can emerge over time
5. **Document decisions**: Explain fairness choices
6. **Involve stakeholders**: In defining fairness criteria

## Resources

- [Fairlearn Library](https://fairlearn.org/)
- [AI Fairness 360](https://aif360.mybluemix.net/)
- [Google ML Fairness](https://developers.google.com/machine-learning/fairness-overview)
