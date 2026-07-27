---
title: "Responsible AI: Implementing Fairness and Transparency in ML Models"
author: Michael John Peña
draft: false
date: 2025-10-18
tags:
  - Responsible AI
  - Fairness
  - ML Ethics
  - Transparency
  - Azure Machine Learning

---

I wrote "Responsible AI: Implementing Fairness and Transparency in ML Models" to share practical, production-minded guidance on this topic.

## Assessing Model Fairness

Use Fairlearn to evaluate model fairness across sensitive groups:

```python
from fairlearn.metrics import MetricFrame, selection_rate, demographic_parity_difference
from sklearn.metrics import accuracy_score, precision_score, recall_score
import pandas as pd
import numpy as np

class FairnessAssessor:
    def __init__(self, y_true, y_pred, sensitive_features):
        self.y_true = y_true
        self.y_pred = y_pred
        self.sensitive_features = sensitive_features

    def compute_metrics(self) -> pd.DataFrame:
        """Compute fairness metrics across sensitive groups."""

        metrics = {
            "accuracy": accuracy_score,
            "precision": lambda y_t, y_p: precision_score(y_t, y_p, zero_division=0),
            "recall": lambda y_t, y_p: recall_score(y_t, y_p, zero_division=0),
            "selection_rate": selection_rate
        }

        metric_frame = MetricFrame(
            metrics=metrics,
            y_true=self.y_true,
            y_pred=self.y_pred,
            sensitive_features=self.sensitive_features
        )

        return metric_frame.by_group

    def compute_disparity(self) -> dict:
        """Compute disparity metrics."""

        dpd = demographic_parity_difference(
            self.y_true,
            self.y_pred,
            sensitive_features=self.sensitive_features
        )

        metric_frame = MetricFrame(
            metrics={"accuracy": accuracy_score},
            y_true=self.y_true,
            y_pred=self.y_pred,
            sensitive_features=self.sensitive_features
        )

        return {
            "demographic_parity_difference": dpd,
            "accuracy_difference": metric_frame.difference()["accuracy"],
            "accuracy_ratio": metric_frame.ratio()["accuracy"]
        }
```

## Mitigating Bias

Apply bias mitigation techniques during training:

```python
from fairlearn.reductions import ExponentiatedGradient, DemographicParity
from sklearn.linear_model import LogisticRegression

class FairModelTrainer:
    def __init__(self, base_estimator=None):
        self.base_estimator = base_estimator or LogisticRegression(max_iter=1000)

    def train_fair_model(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        sensitive_features: np.ndarray,
        constraint_type: str = "demographic_parity"
    ):
        """Train a model with fairness constraints."""

        constraints = {
            "demographic_parity": DemographicParity(),
            "equalized_odds": EqualizedOdds()
        }

        constraint = constraints.get(constraint_type, DemographicParity())

        mitigator = ExponentiatedGradient(
            estimator=self.base_estimator,
            constraints=constraint
        )

        mitigator.fit(X_train, y_train, sensitive_features=sensitive_features)

        return mitigator

    def compare_models(self, X_test, y_test, sensitive_features, fair_model, unfair_model) -> dict:
        """Compare fair and unfair model performance."""

        assessor_fair = FairnessAssessor(y_test, fair_model.predict(X_test), sensitive_features)
        assessor_unfair = FairnessAssessor(y_test, unfair_model.predict(X_test), sensitive_features)

        return {
            "fair_model_disparity": assessor_fair.compute_disparity(),
            "unfair_model_disparity": assessor_unfair.compute_disparity()
        }
```

## Model Cards and Documentation

Create comprehensive model documentation including intended use cases, limitations, fairness assessments, and performance across demographic groups to ensure transparency for stakeholders.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
