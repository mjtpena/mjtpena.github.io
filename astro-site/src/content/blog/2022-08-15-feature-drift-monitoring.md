---
title: "Feature Drift Monitoring for ML Systems"
author: "Michael John Peña"
draft: false
date: 2022-08-15
tags: ["Azure", "Machine Learning", "Feature Drift", "MLOps", "Feature Engineering"]

---

I wrote "Feature Drift Monitoring for ML Systems" to share practical, production-minded guidance on this topic.

## Feature Drift vs Data Drift

- **Data Drift**: Overall input distribution changes
- **Feature Drift**: Individual feature distributions change
- **Root Cause**: Feature drift helps identify which specific features are problematic

## Feature Drift Detector

```python
import numpy as np
import pandas as pd
from scipy import stats
from typing import Dict, List, Tuple
from dataclasses import dataclass

@dataclass
class FeatureDriftResult:
    feature_name: str
    drift_score: float
    p_value: float
    drift_detected: bool
    reference_stats: Dict
    current_stats: Dict
    method: str

class FeatureDriftMonitor:
    """Monitor drift for individual features"""

    def __init__(self, reference_data: pd.DataFrame, drift_threshold: float = 0.1):
        self.reference_data = reference_data
        self.drift_threshold = drift_threshold
        self.feature_stats = self._compute_feature_stats(reference_data)

    def _compute_feature_stats(self, df: pd.DataFrame) -> Dict:
        """Compute statistics for each feature"""
        stats_dict = {}
        for col in df.columns:
            if df[col].dtype in ['int64', 'float64']:
                stats_dict[col] = {
                    'type': 'numerical',
                    'mean': df[col].mean(),
                    'std': df[col].std(),
                    'median': df[col].median(),
                    'q1': df[col].quantile(0.25),
                    'q3': df[col].quantile(0.75),
                    'min': df[col].min(),
                    'max': df[col].max(),
                    'null_rate': df[col].isnull().mean()
                }
            else:
                value_counts = df[col].value_counts(normalize=True)
                stats_dict[col] = {
                    'type': 'categorical',
                    'mode': df[col].mode().iloc[0] if len(df[col].mode()) > 0 else None,
                    'unique_count': df[col].nunique(),
                    'value_distribution': value_counts.to_dict(),
                    'null_rate': df[col].isnull().mean()
                }
        return stats_dict

    def check_feature_drift(self, current_data: pd.DataFrame) -> List[FeatureDriftResult]:
        """Check drift for all features"""
        results = []

        for feature in self.reference_data.columns:
            if feature not in current_data.columns:
                continue

            feature_type = self.feature_stats[feature]['type']

            if feature_type == 'numerical':
                result = self._check_numerical_drift(feature, current_data[feature])
            else:
                result = self._check_categorical_drift(feature, current_data[feature])

            results.append(result)

        return results

    def _check_numerical_drift(self, feature: str, current_data: pd.Series) -> FeatureDriftResult:
        """Check drift for numerical feature"""
        ref_data = self.reference_data[feature].dropna()
        cur_data = current_data.dropna()

        # KS test
        ks_stat, p_value = stats.ks_2samp(ref_data, cur_data)

        # Compute current stats
        current_stats = {
            'mean': cur_data.mean(),
            'std': cur_data.std(),
            'median': cur_data.median(),
            'q1': cur_data.quantile(0.25),
            'q3': cur_data.quantile(0.75),
            'null_rate': current_data.isnull().mean()
        }

        return FeatureDriftResult(
            feature_name=feature,
            drift_score=ks_stat,
            p_value=p_value,
            drift_detected=ks_stat > self.drift_threshold or p_value < 0.05,
            reference_stats=self.feature_stats[feature],
            current_stats=current_stats,
            method='kolmogorov_smirnov'
        )

    def _check_categorical_drift(self, feature: str, current_data: pd.Series) -> FeatureDriftResult:
        """Check drift for categorical feature"""
        ref_dist = self.feature_stats[feature]['value_distribution']
        cur_dist = current_data.value_counts(normalize=True).to_dict()

        # Calculate JS divergence
        all_categories = set(ref_dist.keys()) | set(cur_dist.keys())
        ref_probs = np.array([ref_dist.get(c, 1e-10) for c in all_categories])
        cur_probs = np.array([cur_dist.get(c, 1e-10) for c in all_categories])

        # Normalize
        ref_probs = ref_probs / ref_probs.sum()
        cur_probs = cur_probs / cur_probs.sum()

        # JS divergence
        m = 0.5 * (ref_probs + cur_probs)
        js_div = 0.5 * stats.entropy(ref_probs, m) + 0.5 * stats.entropy(cur_probs, m)

        # Chi-squared test for p-value
        ref_counts = self.reference_data[feature].value_counts()
        cur_counts = current_data.value_counts()

        # Align
        all_cats = set(ref_counts.index) | set(cur_counts.index)
        ref_aligned = np.array([ref_counts.get(c, 0) for c in all_cats])
        cur_aligned = np.array([cur_counts.get(c, 0) for c in all_cats])

        expected = ref_aligned / ref_aligned.sum() * cur_aligned.sum()
        expected = np.where(expected < 1, 1, expected)

        try:
            chi_stat, p_value = stats.chisquare(cur_aligned, expected)
        except:
            p_value = 1.0

        current_stats = {
            'mode': current_data.mode().iloc[0] if len(current_data.mode()) > 0 else None,
            'unique_count': current_data.nunique(),
            'value_distribution': cur_dist,
            'null_rate': current_data.isnull().mean()
        }

        return FeatureDriftResult(
            feature_name=feature,
            drift_score=js_div,
            p_value=p_value,
            drift_detected=js_div > self.drift_threshold or p_value < 0.05,
            reference_stats=self.feature_stats[feature],
            current_stats=current_stats,
            method='jensen_shannon'
        )

    def get_drift_report(self, current_data: pd.DataFrame) -> pd.DataFrame:
        """Generate comprehensive drift report"""
        results = self.check_feature_drift(current_data)

        report_data = []
        for result in results:
            report_data.append({
                'feature': result.feature_name,
                'drift_score': result.drift_score,
                'p_value': result.p_value,
                'drift_detected': result.drift_detected,
                'method': result.method
            })

        return pd.DataFrame(report_data).sort_values('drift_score', ascending=False)
```

## Feature Importance-Weighted Drift

```python
class ImportanceWeightedDriftMonitor(FeatureDriftMonitor):
    """Weight drift detection by feature importance"""

    def __init__(self, reference_data: pd.DataFrame, feature_importance: Dict[str, float],
                 drift_threshold: float = 0.1):
        super().__init__(reference_data, drift_threshold)
        self.feature_importance = feature_importance

    def get_weighted_drift_score(self, current_data: pd.DataFrame) -> float:
        """Calculate importance-weighted drift score"""
        results = self.check_feature_drift(current_data)

        weighted_sum = 0.0
        total_importance = 0.0

        for result in results:
            importance = self.feature_importance.get(result.feature_name, 0.0)
            weighted_sum += result.drift_score * importance
            total_importance += importance

        if total_importance == 0:
            return 0.0

        return weighted_sum / total_importance

    def get_critical_drifts(self, current_data: pd.DataFrame,
                            importance_threshold: float = 0.05) -> List[FeatureDriftResult]:
        """Get drift results for important features"""
        results = self.check_feature_drift(current_data)

        critical_results = []
        for result in results:
            importance = self.feature_importance.get(result.feature_name, 0.0)
            if result.drift_detected and importance >= importance_threshold:
                critical_results.append(result)

        return sorted(critical_results,
                      key=lambda x: self.feature_importance.get(x.feature_name, 0),
                      reverse=True)

# Usage
from sklearn.ensemble import RandomForestClassifier

# Get feature importance from model
model = RandomForestClassifier()
model.fit(X_train, y_train)
importance_dict = dict(zip(X_train.columns, model.feature_importances_))

# Create weighted monitor
weighted_monitor = ImportanceWeightedDriftMonitor(
    reference_data=X_train,
    feature_importance=importance_dict
)

# Check drift
weighted_score = weighted_monitor.get_weighted_drift_score(X_production)
critical_drifts = weighted_monitor.get_critical_drifts(X_production)

print(f"Weighted drift score: {weighted_score:.4f}")
print(f"Critical drifts: {len(critical_drifts)}")
```

## Visualization

```python
import matplotlib.pyplot as plt
import seaborn as sns

def visualize_feature_drift(monitor: FeatureDriftMonitor,
                            current_data: pd.DataFrame,
                            top_n: int = 10):
    """Visualize feature drift"""
    report = monitor.get_drift_report(current_data)
    top_features = report.head(top_n)

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    # Drift scores bar chart
    colors = ['red' if d else 'green' for d in top_features['drift_detected']]
    axes[0, 0].barh(top_features['feature'], top_features['drift_score'], color=colors)
    axes[0, 0].set_xlabel('Drift Score')
    axes[0, 0].set_title('Feature Drift Scores')
    axes[0, 0].axvline(x=monitor.drift_threshold, color='black', linestyle='--', label='Threshold')
    axes[0, 0].legend()

    # P-values
    axes[0, 1].barh(top_features['feature'], -np.log10(top_features['p_value']))
    axes[0, 1].set_xlabel('-log10(p-value)')
    axes[0, 1].set_title('Statistical Significance')
    axes[0, 1].axvline(x=-np.log10(0.05), color='red', linestyle='--', label='p=0.05')
    axes[0, 1].legend()

    # Distribution comparison for top drifted feature
    top_feature = top_features.iloc[0]['feature']
    ref_data = monitor.reference_data[top_feature].dropna()
    cur_data = current_data[top_feature].dropna()

    axes[1, 0].hist(ref_data, bins=30, alpha=0.5, label='Reference', density=True)
    axes[1, 0].hist(cur_data, bins=30, alpha=0.5, label='Current', density=True)
    axes[1, 0].set_title(f'Distribution: {top_feature}')
    axes[1, 0].legend()

    # Summary statistics
    drifted_count = top_features['drift_detected'].sum()
    summary_text = f"Total features: {len(report)}\n"
    summary_text += f"Features with drift: {drifted_count}\n"
    summary_text += f"Drift rate: {drifted_count/len(report)*100:.1f}%\n\n"
    summary_text += "Top drifted features:\n"
    for _, row in top_features[top_features['drift_detected']].head(5).iterrows():
        summary_text += f"  - {row['feature']}: {row['drift_score']:.4f}\n"

    axes[1, 1].text(0.1, 0.5, summary_text, fontsize=10, verticalalignment='center',
                    family='monospace', transform=axes[1, 1].transAxes)
    axes[1, 1].axis('off')
    axes[1, 1].set_title('Summary')

    plt.tight_layout()
    return fig

# Usage
fig = visualize_feature_drift(monitor, X_production)
fig.savefig("feature_drift_report.png")
```

## Alerting System

```python
class FeatureDriftAlertManager:
    """Manage alerts for feature drift"""

    def __init__(self, monitor: FeatureDriftMonitor, alert_config: Dict):
        self.monitor = monitor
        self.config = alert_config
        self.alert_history = []

    def check_and_alert(self, current_data: pd.DataFrame) -> List[Dict]:
        """Check for drift and generate alerts"""
        results = self.monitor.check_feature_drift(current_data)
        alerts = []

        for result in results:
            if result.drift_detected:
                severity = self._determine_severity(result)

                if severity >= self.config.get('min_severity', 'warning'):
                    alert = {
                        'timestamp': datetime.utcnow().isoformat(),
                        'feature': result.feature_name,
                        'drift_score': result.drift_score,
                        'severity': severity,
                        'message': self._generate_message(result)
                    }
                    alerts.append(alert)
                    self.alert_history.append(alert)

        return alerts

    def _determine_severity(self, result: FeatureDriftResult) -> str:
        """Determine alert severity"""
        if result.drift_score > 0.3:
            return 'critical'
        elif result.drift_score > 0.2:
            return 'high'
        elif result.drift_score > 0.1:
            return 'warning'
        return 'info'

    def _generate_message(self, result: FeatureDriftResult) -> str:
        """Generate alert message"""
        return (f"Feature drift detected in '{result.feature_name}'. "
                f"Drift score: {result.drift_score:.4f}, "
                f"Method: {result.method}")
```

Feature-level drift monitoring enables targeted investigation and remediation of model issues.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
