---
title: "Fairness Assessment for Machine Learning Models"
description: "Fairness assessment ensures your ML models treat all groups equitably and comply with ethical standards."
author: "Michael John Peña"
draft: false
date: 2022-08-04
tags: ["Azure", "Machine Learning", "Fairness", "Ethics", "AI Bias"]
---

## Understanding Fairness Metrics

Key fairness metrics include:
- **Demographic Parity**: Equal positive prediction rates across groups
- **Equalized Odds**: Equal true positive and false positive rates
- **Equal Opportunity**: Equal true positive rates
- **Predictive Parity**: Equal precision across groups

## Setting Up Fairness Analysis

```python
from fairlearn.metrics import (
    MetricFrame,
    selection_rate,
    demographic_parity_difference,
    demographic_parity_ratio,
    equalized_odds_difference
)
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
import pandas as pd
import numpy as np

# Load data with sensitive features
df = pd.read_csv("lending_data.csv")
X = df.drop(["approved", "gender", "race"], axis=1)
y = df["approved"]
sensitive_features = df[["gender", "race"]]

# Get predictions
y_pred = model.predict(X)

# Create MetricFrame
metrics = {
    "accuracy": accuracy_score,
    "precision": precision_score,
    "recall": recall_score,
    "selection_rate": selection_rate
}

metric_frame = MetricFrame(
    metrics=metrics,
    y_true=y,
    y_pred=y_pred,
    sensitive_features=sensitive_features["gender"]
)

# View results
print("Metrics by Gender:")
print(metric_frame.by_group)

print("\nDifferences:")
print(metric_frame.difference(method="between_groups"))
```

## Visualizing Fairness

```python
import matplotlib.pyplot as plt
from fairlearn.metrics import plot_model_comparison

# Compare metrics across groups
fig, axes = plt.subplots(2, 2, figsize=(12, 10))

# Selection rate by gender
metric_frame.by_group["selection_rate"].plot(
    kind="bar", ax=axes[0, 0], title="Selection Rate by Gender"
)

# Accuracy by gender
metric_frame.by_group["accuracy"].plot(
    kind="bar", ax=axes[0, 1], title="Accuracy by Gender"
)

# For race
metric_frame_race = MetricFrame(
    metrics=metrics,
    y_true=y,
    y_pred=y_pred,
    sensitive_features=sensitive_features["race"]
)

metric_frame_race.by_group["selection_rate"].plot(
    kind="bar", ax=axes[1, 0], title="Selection Rate by Race"
)

metric_frame_race.by_group["accuracy"].plot(
    kind="bar", ax=axes[1, 1], title="Accuracy by Race"
)

plt.tight_layout()
plt.savefig("fairness_analysis.png")
```

## Fairness Constraints in Training

```python
from fairlearn.reductions import (
    ExponentiatedGradient,
    DemographicParity,
    EqualizedOdds
)
from sklearn.linear_model import LogisticRegression

# Base estimator
base_estimator = LogisticRegression(max_iter=1000)

# Apply demographic parity constraint
mitigator = ExponentiatedGradient(
    estimator=base_estimator,
    constraints=DemographicParity()
)

# Train with fairness constraint
mitigator.fit(X, y, sensitive_features=sensitive_features["gender"])

# Get predictions from mitigated model
y_pred_mitigated = mitigator.predict(X)

# Compare metrics
print("Original Model:")
print(f"  Accuracy: {accuracy_score(y, y_pred):.3f}")
print(f"  Demographic Parity Difference: {demographic_parity_difference(y, y_pred, sensitive_features=sensitive_features['gender']):.3f}")

print("\nMitigated Model:")
print(f"  Accuracy: {accuracy_score(y, y_pred_mitigated):.3f}")
print(f"  Demographic Parity Difference: {demographic_parity_difference(y, y_pred_mitigated, sensitive_features=sensitive_features['gender']):.3f}")
```

## Post-Processing Mitigation

```python
from fairlearn.postprocessing import ThresholdOptimizer

# Create threshold optimizer
postprocess = ThresholdOptimizer(
    estimator=model,
    constraints="equalized_odds",
    objective="balanced_accuracy_score",
    prefit=True
)

# Fit the post-processor
postprocess.fit(X, y, sensitive_features=sensitive_features["gender"])

# Get fair predictions
y_pred_fair = postprocess.predict(X, sensitive_features=sensitive_features["gender"])

# Compare
print("\nPost-processed Model:")
print(f"  Accuracy: {accuracy_score(y, y_pred_fair):.3f}")
print(f"  Equalized Odds Difference: {equalized_odds_difference(y, y_pred_fair, sensitive_features=sensitive_features['gender']):.3f}")
```

## Fairness Dashboard in Azure ML

```python
from raiwidgets import FairnessDashboard

# Launch fairness dashboard
FairnessDashboard(
    sensitive_features=sensitive_features,
    y_true=y,
    y_pred={"Original": y_pred, "Mitigated": y_pred_mitigated}
)
```

## Integration with Azure ML Pipeline

```python
from azure.ai.ml import dsl, Input, Output
from azure.ai.ml.entities import Environment

@dsl.pipeline(
    compute="cpu-cluster",
    description="Fairness Assessment Pipeline"
)
def fairness_pipeline(
    input_data: Input,
    model: Input
):
    # Assessment step
    fairness_assessment = assess_fairness(
        data=input_data,
        model=model,
        sensitive_features=["gender", "race"],
        metrics=["selection_rate", "accuracy", "recall"]
    )

    # Mitigation step
    mitigated_model = mitigate_bias(
        model=model,
        data=input_data,
        sensitive_features=["gender"],
        constraint="demographic_parity"
    )

    return {
        "fairness_report": fairness_assessment.outputs.report,
        "mitigated_model": mitigated_model.outputs.model
    }
```

## Fairness Monitoring in Production

```python
import logging
from datetime import datetime

class FairnessMonitor:
    def __init__(self, model, sensitive_features, thresholds):
        self.model = model
        self.sensitive_features = sensitive_features
        self.thresholds = thresholds
        self.history = []

    def assess(self, X, y_true, sensitive_data):
        """Assess fairness on new data"""
        y_pred = self.model.predict(X)

        results = {}
        for feature in self.sensitive_features:
            metric_frame = MetricFrame(
                metrics={"selection_rate": selection_rate},
                y_true=y_true,
                y_pred=y_pred,
                sensitive_features=sensitive_data[feature]
            )

            disparity = metric_frame.difference(method="between_groups")["selection_rate"]
            results[feature] = {
                "disparity": disparity,
                "threshold_exceeded": disparity > self.thresholds.get(feature, 0.1)
            }

            if results[feature]["threshold_exceeded"]:
                logging.warning(
                    f"Fairness threshold exceeded for {feature}: {disparity:.3f}"
                )

        self.history.append({
            "timestamp": datetime.utcnow().isoformat(),
            "results": results
        })

        return results

    def get_trend(self, feature, days=30):
        """Get fairness trend over time"""
        recent = [h for h in self.history
                  if (datetime.utcnow() - datetime.fromisoformat(h["timestamp"])).days <= days]
        return [h["results"][feature]["disparity"] for h in recent]
```

Fairness assessment ensures your ML models treat all groups equitably and comply with ethical standards.
