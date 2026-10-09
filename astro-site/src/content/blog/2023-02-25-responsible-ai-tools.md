---
title: "Responsible AI Tools and Practices for Azure Applications"
author: Michael John Peña
draft: false
date: 2023-02-25
tags:
  - Azure
  - Responsible AI
  - Ethics
  - AI Safety
  - Fairness
---

## Azure Responsible AI Dashboard

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

# Connect to Azure ML
ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create Responsible AI dashboard
from azure.ai.ml.entities import ResponsibleAIComponent

rai_dashboard = ResponsibleAIComponent(
    name="model-analysis",
    version="1",
    type="responsibleai",
    analysis_types=[
        "error_analysis",
        "model_interpretability",
        "fairness",
        "counterfactual"
    ]
)
```

## Fairness Assessment

```python
from fairlearn.metrics import MetricFrame, selection_rate, demographic_parity_difference
from fairlearn.reductions import ExponentiatedGradient, DemographicParity
import pandas as pd
import numpy as np

class FairnessAnalyzer:
    """Analyze and mitigate fairness issues."""

    def __init__(self, sensitive_features: list):
        self.sensitive_features = sensitive_features

    def analyze_fairness(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        sensitive: pd.Series
    ) -> dict:
        """Compute fairness metrics."""
        metric_frame = MetricFrame(
            metrics={
                "accuracy": lambda y_t, y_p: (y_t == y_p).mean(),
                "selection_rate": selection_rate,
                "count": lambda y_t, y_p: len(y_t)
            },
            y_true=y_true,
            y_pred=y_pred,
            sensitive_features=sensitive
        )

        return {
            "by_group": metric_frame.by_group.to_dict(),
            "overall": metric_frame.overall.to_dict(),
            "difference": metric_frame.difference().to_dict(),
            "ratio": metric_frame.ratio().to_dict(),
            "demographic_parity_diff": demographic_parity_difference(
                y_true, y_pred, sensitive_features=sensitive
            )
        }

    def mitigate_bias(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        sensitive_train: pd.Series,
        base_estimator
    ):
        """Train fair model using reductions."""
        mitigator = ExponentiatedGradient(
            estimator=base_estimator,
            constraints=DemographicParity()
        )

        mitigator.fit(X_train, y_train, sensitive_features=sensitive_train)
        return mitigator

# Usage
analyzer = FairnessAnalyzer(sensitive_features=["gender", "age_group"])

fairness_report = analyzer.analyze_fairness(
    y_true=actual_labels,
    y_pred=predicted_labels,
    sensitive=df["gender"]
)

print(f"Demographic Parity Difference: {fairness_report['demographic_parity_diff']:.3f}")
# Value close to 0 indicates fairness
```

## Model Interpretability

```python
from interpret.ext.blackbox import TabularExplainer
from interpret.ext.blackbox import MimicExplainer, LIMEExplainer

class ModelInterpreter:
    """Explain model predictions."""

    def __init__(self, model, X_train: pd.DataFrame, feature_names: list):
        self.model = model
        self.X_train = X_train
        self.feature_names = feature_names

        # Create explainer
        self.explainer = TabularExplainer(
            model,
            X_train,
            features=feature_names
        )

    def explain_global(self) -> dict:
        """Get global feature importance."""
        global_explanation = self.explainer.explain_global(self.X_train)

        return {
            "feature_importance": dict(zip(
                self.feature_names,
                global_explanation.global_importance_values
            )),
            "top_features": global_explanation.get_feature_importance_dict()
        }

    def explain_local(self, instance: pd.DataFrame) -> dict:
        """Explain individual prediction."""
        local_explanation = self.explainer.explain_local(instance)

        return {
            "prediction": self.model.predict(instance)[0],
            "feature_contributions": dict(zip(
                self.feature_names,
                local_explanation.local_importance_values[0]
            ))
        }

    def get_counterfactuals(
        self,
        instance: pd.DataFrame,
        desired_outcome,
        num_counterfactuals: int = 5
    ) -> list:
        """Generate counterfactual explanations."""
        from dice_ml import Dice

        # Create DiCE explainer
        dice_explainer = Dice(
            data=self.X_train,
            model=self.model,
            method="random"
        )

        counterfactuals = dice_explainer.generate_counterfactuals(
            query_instances=instance,
            total_CFs=num_counterfactuals,
            desired_class=desired_outcome
        )

        return counterfactuals.cf_examples_list[0].final_cfs_df.to_dict('records')
```

## Content Safety

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import TextCategory, AnalyzeTextOptions

class ContentModerator:
    """Moderate content for safety."""

    def __init__(self, endpoint: str, key: str):
        self.client = ContentSafetyClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def analyze_text(self, text: str) -> dict:
        """Analyze text for harmful content."""
        request = AnalyzeTextOptions(text=text)
        response = self.client.analyze_text(request)

        results = {
            "hate": response.hate_result.severity if response.hate_result else 0,
            "self_harm": response.self_harm_result.severity if response.self_harm_result else 0,
            "sexual": response.sexual_result.severity if response.sexual_result else 0,
            "violence": response.violence_result.severity if response.violence_result else 0
        }

        results["is_safe"] = all(v < 2 for v in results.values())
        return results

    def moderate_llm_response(
        self,
        prompt: str,
        response: str
    ) -> dict:
        """Moderate both prompt and response."""
        prompt_analysis = self.analyze_text(prompt)
        response_analysis = self.analyze_text(response)

        return {
            "prompt_safe": prompt_analysis["is_safe"],
            "response_safe": response_analysis["is_safe"],
            "prompt_analysis": prompt_analysis,
            "response_analysis": response_analysis,
            "action": "allow" if response_analysis["is_safe"] else "block"
        }

# Usage
moderator = ContentModerator(endpoint, key)

user_input = "How do I improve my code?"
llm_response = "Here are some tips..."

moderation = moderator.moderate_llm_response(user_input, llm_response)
if moderation["action"] == "allow":
    return llm_response
else:
    return "I cannot provide that response."
```

## Transparency Documentation

```python
from dataclasses import dataclass, field
from typing import List, Dict
from datetime import datetime

@dataclass
class ModelCard:
    """Documentation for AI model transparency."""

    name: str
    version: str
    description: str

    # Model details
    model_type: str
    architecture: str
    training_data_description: str

    # Intended use
    intended_use_cases: List[str]
    out_of_scope_uses: List[str]

    # Performance
    metrics: Dict[str, float]
    evaluation_data: str

    # Fairness
    fairness_metrics: Dict[str, float] = field(default_factory=dict)
    sensitive_attributes_tested: List[str] = field(default_factory=list)

    # Limitations
    known_limitations: List[str] = field(default_factory=list)
    failure_cases: List[str] = field(default_factory=list)

    # Maintenance
    maintainers: List[str] = field(default_factory=list)
    last_updated: datetime = field(default_factory=datetime.now)
    update_frequency: str = ""

    def to_markdown(self) -> str:
        """Generate markdown documentation."""
        md = f"""# Model Card: {self.name}

**Version:** {self.version}
**Last Updated:** {self.last_updated.strftime('%Y-%m-%d')}

## Description
{self.description}

## Model Details
- **Type:** {self.model_type}
- **Architecture:** {self.architecture}
- **Training Data:** {self.training_data_description}

## Intended Use
### Primary Use Cases
{chr(10).join(f'- {use}' for use in self.intended_use_cases)}

### Out of Scope
{chr(10).join(f'- {use}' for use in self.out_of_scope_uses)}

## Performance Metrics
{chr(10).join(f'- **{k}:** {v:.4f}' for k, v in self.metrics.items())}

## Fairness Analysis
### Metrics
{chr(10).join(f'- **{k}:** {v:.4f}' for k, v in self.fairness_metrics.items())}

### Sensitive Attributes Tested
{chr(10).join(f'- {attr}' for attr in self.sensitive_attributes_tested)}

## Known Limitations
{chr(10).join(f'- {lim}' for lim in self.known_limitations)}

## Maintainers
{chr(10).join(f'- {m}' for m in self.maintainers)}
"""
        return md

# Create model card
card = ModelCard(
    name="Customer Churn Predictor",
    version="2.0.0",
    description="Predicts customer churn probability for subscription services",
    model_type="Classification",
    architecture="Gradient Boosting",
    training_data_description="6 months of customer data, 100K records",
    intended_use_cases=[
        "Identify at-risk customers for retention campaigns",
        "Prioritize customer success outreach"
    ],
    out_of_scope_uses=[
        "Automated service termination decisions",
        "Pricing discrimination"
    ],
    metrics={"accuracy": 0.87, "auc": 0.92, "f1": 0.84},
    fairness_metrics={"demographic_parity_diff": 0.02, "equalized_odds_diff": 0.03},
    sensitive_attributes_tested=["age_group", "region", "account_type"],
    known_limitations=[
        "Performance degrades for customers with < 30 days history",
        "May not generalize to new product lines"
    ],
    maintainers=["ml-team@company.com"]
)

print(card.to_markdown())
```

## Responsible AI Checklist

```python
RESPONSIBLE_AI_CHECKLIST = {
    "fairness": [
        "Tested model on protected attributes",
        "Measured demographic parity",
        "Implemented bias mitigation if needed",
        "Documented fairness limitations"
    ],
    "reliability": [
        "Tested on edge cases",
        "Implemented input validation",
        "Set up monitoring and alerts",
        "Have rollback procedures"
    ],
    "privacy": [
        "Minimized data collection",
        "Implemented data encryption",
        "Have data retention policies",
        "Support data deletion requests"
    ],
    "transparency": [
        "Created model card",
        "Documented limitations",
        "Explained AI usage to users",
        "Provided interpretability"
    ],
    "safety": [
        "Implemented content filtering",
        "Human oversight for high-stakes decisions",
        "Emergency shutoff procedures",
        "Incident response plan"
    ],
    "accountability": [
        "Assigned ownership",
        "Audit logging in place",
        "Regular review schedule",
        "Feedback mechanism for users"
    ]
}
```

## Best Practices

1. **Start with fairness**: Measure before deploying
2. **Document everything**: Model cards are essential
3. **Monitor continuously**: Fairness can drift
4. **Include humans**: Keep humans in the loop
5. **Plan for incidents**: Have response procedures

## Resources

- [Microsoft Responsible AI](https://www.microsoft.com/ai/responsible-ai)
- [Fairlearn Documentation](https://fairlearn.org/)
- [Azure Content Safety](https://azure.microsoft.com/products/cognitive-services/content-safety/)
