---
title: "Responsible AI: Implementing Explainability in Production Models"
description: "SHAP (SHapley Additive exPlanations) provides consistent, theoretically grounded feature importance scores."
author: Michael John Peña
draft: false
date: 2025-09-16
tags:
  - Responsible AI
  - Explainability
  - XAI
  - SHAP
  - Model Interpretability
---

## SHAP Values for Feature Attribution

SHAP (SHapley Additive exPlanations) provides consistent, theoretically grounded feature importance scores.

```python
import shap
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from typing import Dict, List
import pandas as pd

class ExplainableModel:
    def __init__(self, model, feature_names: List[str]):
        self.model = model
        self.feature_names = feature_names
        self.explainer = None

    def fit_explainer(self, background_data: np.ndarray):
        """Initialize SHAP explainer with background data."""
        self.explainer = shap.TreeExplainer(self.model, background_data)

    def explain_prediction(self, instance: np.ndarray) -> Dict:
        """Generate explanation for a single prediction."""

        # Get prediction
        prediction = self.model.predict(instance.reshape(1, -1))[0]
        probability = self.model.predict_proba(instance.reshape(1, -1))[0]

        # Calculate SHAP values
        shap_values = self.explainer.shap_values(instance.reshape(1, -1))

        # Handle binary classification
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # Use positive class

        # Create feature importance ranking
        feature_impacts = []
        for i, (name, value, shap_val) in enumerate(
            zip(self.feature_names, instance, shap_values[0])
        ):
            feature_impacts.append({
                "feature": name,
                "value": float(value),
                "impact": float(shap_val),
                "direction": "increases" if shap_val > 0 else "decreases"
            })

        # Sort by absolute impact
        feature_impacts.sort(key=lambda x: abs(x["impact"]), reverse=True)

        return {
            "prediction": int(prediction),
            "probability": float(probability[1]),
            "base_value": float(self.explainer.expected_value[1]
                               if isinstance(self.explainer.expected_value, np.ndarray)
                               else self.explainer.expected_value),
            "top_factors": feature_impacts[:5],
            "full_explanation": feature_impacts
        }

    def generate_natural_language_explanation(self, explanation: Dict) -> str:
        """Convert SHAP explanation to human-readable text."""

        factors = explanation["top_factors"]
        prob = explanation["probability"]

        lines = [f"The model predicts {'positive' if explanation['prediction'] == 1 else 'negative'} "
                 f"with {prob:.1%} confidence."]
        lines.append("\nKey factors influencing this decision:")

        for i, factor in enumerate(factors, 1):
            direction = "increased" if factor["impact"] > 0 else "decreased"
            lines.append(
                f"{i}. {factor['feature']} = {factor['value']:.2f} "
                f"{direction} the likelihood by {abs(factor['impact']):.3f}"
            )

        return "\n".join(lines)
```

## Explanation Caching for Performance

```python
from functools import lru_cache
import hashlib
import json

class ExplanationCache:
    def __init__(self, explainable_model: ExplainableModel):
        self.model = explainable_model
        self.cache = {}

    def get_explanation(self, instance: np.ndarray) -> Dict:
        """Get cached explanation or compute new one."""
        cache_key = hashlib.md5(instance.tobytes()).hexdigest()

        if cache_key not in self.cache:
            self.cache[cache_key] = self.model.explain_prediction(instance)

        return self.cache[cache_key]
```

Explainability builds trust with users and satisfies regulatory requirements. Every production ML system should include explanation capabilities, even if not always surfaced to end users.
