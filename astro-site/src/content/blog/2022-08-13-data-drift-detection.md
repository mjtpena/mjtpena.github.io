---
title: "Data Drift Detection for ML Models"
author: "Michael John Peña"
draft: false
date: 2022-08-13
tags: ["Azure", "Machine Learning", "Data Drift", "MLOps", "Monitoring"]

---

I wrote "Data Drift Detection for ML Models" to share practical, production-minded guidance on this topic.

## Types of Data Drift

- **Covariate Shift**: Input feature distributions change
- **Prior Probability Shift**: Target distribution changes
- **Concept Drift**: Relationship between features and target changes

## Statistical Methods for Drift Detection

```python
import numpy as np
import pandas as pd
from scipy import stats
from typing import Dict, Tuple
import warnings

class StatisticalDriftDetector:
    """Detect data drift using statistical tests"""

    def __init__(self, reference_data: pd.DataFrame):
        self.reference_data = reference_data
        self.feature_stats = self._compute_stats(reference_data)

    def _compute_stats(self, df: pd.DataFrame) -> Dict:
        """Compute statistics for each feature"""
        stats_dict = {}
        for col in df.columns:
            if df[col].dtype in ['int64', 'float64']:
                stats_dict[col] = {
                    'type': 'numerical',
                    'mean': df[col].mean(),
                    'std': df[col].std(),
                    'min': df[col].min(),
                    'max': df[col].max(),
                    'percentiles': df[col].quantile([0.25, 0.5, 0.75]).tolist()
                }
            else:
                stats_dict[col] = {
                    'type': 'categorical',
                    'value_counts': df[col].value_counts(normalize=True).to_dict()
                }
        return stats_dict

    def kolmogorov_smirnov_test(self, feature: str, production_data: pd.Series) -> Tuple[float, float]:
        """KS test for numerical features"""
        ref_data = self.reference_data[feature].dropna()
        prod_data = production_data.dropna()
        statistic, p_value = stats.ks_2samp(ref_data, prod_data)
        return statistic, p_value

    def chi_squared_test(self, feature: str, production_data: pd.Series) -> Tuple[float, float]:
        """Chi-squared test for categorical features"""
        ref_counts = self.reference_data[feature].value_counts()
        prod_counts = production_data.value_counts()

        # Align categories
        all_cats = set(ref_counts.index) | set(prod_counts.index)
        ref_aligned = np.array([ref_counts.get(c, 0) for c in all_cats])
        prod_aligned = np.array([prod_counts.get(c, 0) for c in all_cats])

        # Normalize to get expected frequencies
        total_ref = ref_aligned.sum()
        total_prod = prod_aligned.sum()
        expected = ref_aligned / total_ref * total_prod

        # Avoid zero expected values
        expected = np.where(expected < 1, 1, expected)

        statistic, p_value = stats.chisquare(prod_aligned, expected)
        return statistic, p_value

    def population_stability_index(self, feature: str, production_data: pd.Series, bins: int = 10) -> float:
        """Calculate PSI for numerical features"""
        ref_data = self.reference_data[feature].dropna()
        prod_data = production_data.dropna()

        # Create bins based on reference data
        _, bin_edges = np.histogram(ref_data, bins=bins)

        # Calculate histograms
        ref_hist, _ = np.histogram(ref_data, bins=bin_edges)
        prod_hist, _ = np.histogram(prod_data, bins=bin_edges)

        # Convert to percentages
        ref_pct = ref_hist / len(ref_data)
        prod_pct = prod_hist / len(prod_data)

        # Avoid log(0)
        ref_pct = np.where(ref_pct == 0, 0.0001, ref_pct)
        prod_pct = np.where(prod_pct == 0, 0.0001, prod_pct)

        # Calculate PSI
        psi = np.sum((prod_pct - ref_pct) * np.log(prod_pct / ref_pct))
        return psi

    def jensen_shannon_divergence(self, feature: str, production_data: pd.Series, bins: int = 10) -> float:
        """Calculate Jensen-Shannon divergence"""
        ref_data = self.reference_data[feature].dropna()
        prod_data = production_data.dropna()

        # Create histograms
        min_val = min(ref_data.min(), prod_data.min())
        max_val = max(ref_data.max(), prod_data.max())
        bin_edges = np.linspace(min_val, max_val, bins + 1)

        ref_hist, _ = np.histogram(ref_data, bins=bin_edges, density=True)
        prod_hist, _ = np.histogram(prod_data, bins=bin_edges, density=True)

        # Normalize
        ref_hist = ref_hist / ref_hist.sum()
        prod_hist = prod_hist / prod_hist.sum()

        # JS divergence
        m = 0.5 * (ref_hist + prod_hist)
        js = 0.5 * stats.entropy(ref_hist, m) + 0.5 * stats.entropy(prod_hist, m)

        return js

    def detect_all_drift(self, production_data: pd.DataFrame, p_threshold: float = 0.05) -> pd.DataFrame:
        """Detect drift for all features"""
        results = []

        for col in self.reference_data.columns:
            if col not in production_data.columns:
                continue

            feature_type = self.feature_stats[col]['type']

            if feature_type == 'numerical':
                ks_stat, ks_p = self.kolmogorov_smirnov_test(col, production_data[col])
                psi = self.population_stability_index(col, production_data[col])
                js = self.jensen_shannon_divergence(col, production_data[col])

                results.append({
                    'feature': col,
                    'type': 'numerical',
                    'ks_statistic': ks_stat,
                    'ks_p_value': ks_p,
                    'psi': psi,
                    'js_divergence': js,
                    'drift_detected': ks_p < p_threshold or psi > 0.2
                })
            else:
                chi_stat, chi_p = self.chi_squared_test(col, production_data[col])

                results.append({
                    'feature': col,
                    'type': 'categorical',
                    'chi_statistic': chi_stat,
                    'chi_p_value': chi_p,
                    'drift_detected': chi_p < p_threshold
                })

        return pd.DataFrame(results)
```

## Window-Based Drift Detection

```python
class WindowDriftDetector:
    """Detect drift using sliding windows"""

    def __init__(self, window_size: int = 1000, step_size: int = 100):
        self.window_size = window_size
        self.step_size = step_size
        self.baseline_window = None

    def set_baseline(self, data: np.ndarray):
        """Set baseline window"""
        self.baseline_window = data[-self.window_size:]

    def detect_drift_adwin(self, data: np.ndarray) -> Dict:
        """ADWIN-style drift detection"""
        results = []

        for i in range(0, len(data) - self.window_size, self.step_size):
            current_window = data[i:i + self.window_size]

            # Compare with baseline
            stat, p_value = stats.ks_2samp(self.baseline_window, current_window)

            results.append({
                'window_start': i,
                'window_end': i + self.window_size,
                'ks_statistic': stat,
                'p_value': p_value,
                'drift_detected': p_value < 0.05
            })

            # Update baseline if no drift (adaptive)
            if p_value >= 0.05:
                self.baseline_window = current_window

        return pd.DataFrame(results)

    def detect_drift_cusum(self, data: np.ndarray, threshold: float = 5.0) -> Dict:
        """CUSUM (Cumulative Sum) drift detection"""
        if self.baseline_window is None:
            raise ValueError("Baseline not set")

        baseline_mean = np.mean(self.baseline_window)
        baseline_std = np.std(self.baseline_window)

        # Normalize data
        normalized = (data - baseline_mean) / baseline_std

        # Calculate CUSUM
        cusum_pos = np.zeros(len(normalized))
        cusum_neg = np.zeros(len(normalized))

        for i in range(1, len(normalized)):
            cusum_pos[i] = max(0, cusum_pos[i-1] + normalized[i] - 0.5)
            cusum_neg[i] = max(0, cusum_neg[i-1] - normalized[i] - 0.5)

        drift_points = np.where((cusum_pos > threshold) | (cusum_neg > threshold))[0]

        return {
            'cusum_positive': cusum_pos,
            'cusum_negative': cusum_neg,
            'drift_points': drift_points.tolist(),
            'drift_detected': len(drift_points) > 0
        }
```

## Visualization

```python
import matplotlib.pyplot as plt

def visualize_drift(reference_data, production_data, feature_name, drift_result):
    """Visualize drift for a feature"""
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))

    # Distribution comparison
    axes[0].hist(reference_data, bins=30, alpha=0.5, label='Reference', density=True)
    axes[0].hist(production_data, bins=30, alpha=0.5, label='Production', density=True)
    axes[0].legend()
    axes[0].set_title(f'{feature_name} Distribution')

    # Q-Q plot
    ref_sorted = np.sort(reference_data)
    prod_sorted = np.sort(production_data)
    # Interpolate to same length
    interp_prod = np.interp(
        np.linspace(0, 1, len(ref_sorted)),
        np.linspace(0, 1, len(prod_sorted)),
        prod_sorted
    )
    axes[1].scatter(ref_sorted, interp_prod, alpha=0.5)
    axes[1].plot([ref_sorted.min(), ref_sorted.max()],
                 [ref_sorted.min(), ref_sorted.max()], 'r--')
    axes[1].set_xlabel('Reference Quantiles')
    axes[1].set_ylabel('Production Quantiles')
    axes[1].set_title('Q-Q Plot')

    # Statistics
    stats_text = f"KS Statistic: {drift_result.get('ks_statistic', 'N/A'):.4f}\n"
    stats_text += f"P-Value: {drift_result.get('ks_p_value', 'N/A'):.4f}\n"
    stats_text += f"PSI: {drift_result.get('psi', 'N/A'):.4f}\n"
    stats_text += f"Drift: {'Yes' if drift_result.get('drift_detected') else 'No'}"
    axes[2].text(0.5, 0.5, stats_text, ha='center', va='center',
                 fontsize=12, transform=axes[2].transAxes)
    axes[2].axis('off')
    axes[2].set_title('Drift Statistics')

    plt.tight_layout()
    return fig

# Usage
detector = StatisticalDriftDetector(reference_df)
drift_results = detector.detect_all_drift(production_df)

for _, row in drift_results.iterrows():
    if row['drift_detected']:
        fig = visualize_drift(
            reference_df[row['feature']].dropna(),
            production_df[row['feature']].dropna(),
            row['feature'],
            row.to_dict()
        )
        fig.savefig(f"drift_{row['feature']}.png")
```

## Automated Drift Monitoring Pipeline

```python
from datetime import datetime, timedelta
import schedule
import time

class DriftMonitoringPipeline:
    def __init__(self, reference_data, data_source, alert_callback):
        self.detector = StatisticalDriftDetector(reference_data)
        self.data_source = data_source
        self.alert_callback = alert_callback
        self.drift_history = []

    def run_detection(self):
        """Run drift detection on recent data"""
        # Get recent production data
        production_data = self.data_source.get_recent_data(hours=24)

        if len(production_data) < 100:
            print("Insufficient data for drift detection")
            return

        # Detect drift
        results = self.detector.detect_all_drift(production_data)
        drifted_features = results[results['drift_detected']]

        # Log results
        self.drift_history.append({
            'timestamp': datetime.utcnow().isoformat(),
            'total_features': len(results),
            'drifted_features': len(drifted_features),
            'details': results.to_dict('records')
        })

        # Alert if drift detected
        if len(drifted_features) > 0:
            self.alert_callback(drifted_features)

        return results

    def start(self, interval_hours: int = 6):
        """Start scheduled monitoring"""
        schedule.every(interval_hours).hours.do(self.run_detection)

        while True:
            schedule.run_pending()
            time.sleep(60)

# Usage
def send_alert(drifted_features):
    print(f"ALERT: Drift detected in {len(drifted_features)} features!")
    print(drifted_features[['feature', 'drift_detected']].to_string())

pipeline = DriftMonitoringPipeline(
    reference_data=training_df,
    data_source=production_data_source,
    alert_callback=send_alert
)

# Run once
results = pipeline.run_detection()
print(f"Drift detected in {len(results[results['drift_detected']])} features")
```

Early drift detection enables proactive model maintenance and prevents silent failures in production.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
