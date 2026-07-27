---
title: "Model Evaluation Techniques: Beyond Accuracy Metrics"
author: Michael John Peña
draft: false
date: 2025-10-08
tags:
  - Machine Learning
  - Model Evaluation
  - MLOps
  - Data Science
  - Metrics

---

I wrote "Model Evaluation Techniques: Beyond Accuracy Metrics" to share practical, production-minded guidance on this topic.

## Comprehensive Evaluation Framework

Build an evaluation framework that captures multiple quality dimensions:

```python
from dataclasses import dataclass
from typing import Dict, List
import numpy as np
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix
)

@dataclass
class EvaluationResult:
    metric_name: str
    value: float
    threshold: float
    passed: bool
    details: dict

class ModelEvaluator:
    def __init__(self, model, test_data, test_labels):
        self.model = model
        self.X_test = test_data
        self.y_test = test_labels
        self.predictions = model.predict(test_data)
        self.probabilities = model.predict_proba(test_data) if hasattr(model, 'predict_proba') else None
        self.results: List[EvaluationResult] = []

    def evaluate_classification_metrics(self, thresholds: dict) -> List[EvaluationResult]:
        """Evaluate standard classification metrics."""

        metrics = {
            "accuracy": accuracy_score(self.y_test, self.predictions),
            "precision": precision_score(self.y_test, self.predictions, average='weighted'),
            "recall": recall_score(self.y_test, self.predictions, average='weighted'),
            "f1": f1_score(self.y_test, self.predictions, average='weighted')
        }

        if self.probabilities is not None and len(np.unique(self.y_test)) == 2:
            metrics["auc_roc"] = roc_auc_score(self.y_test, self.probabilities[:, 1])

        for metric_name, value in metrics.items():
            if value is not None:
                threshold = thresholds.get(metric_name, 0.0)
                self.results.append(EvaluationResult(
                    metric_name=metric_name,
                    value=value,
                    threshold=threshold,
                    passed=value >= threshold,
                    details={}
                ))

        return self.results
```

## Evaluating Fairness Across Groups

Test model behavior across demographic groups:

```python
def evaluate_fairness(self, sensitive_feature: np.ndarray, groups: list) -> Dict:
    """Evaluate model fairness across demographic groups."""

    group_metrics = {}

    for group in groups:
        mask = sensitive_feature == group
        if mask.sum() == 0:
            continue

        group_metrics[group] = {
            "accuracy": accuracy_score(self.y_test[mask], self.predictions[mask]),
            "positive_rate": self.predictions[mask].mean(),
            "sample_size": mask.sum()
        }

    accuracies = [m["accuracy"] for m in group_metrics.values()]
    positive_rates = [m["positive_rate"] for m in group_metrics.values()]

    return {
        "group_metrics": group_metrics,
        "accuracy_disparity": max(accuracies) - min(accuracies),
        "demographic_parity_diff": max(positive_rates) - min(positive_rates),
        "fairness_passed": (max(accuracies) - min(accuracies)) < 0.1
    }
```

## Business Impact Evaluation

Always connect model metrics to business outcomes. A model with lower accuracy but better performance on high-value segments may deliver more business value than a higher-accuracy model that underperforms on critical use cases.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
