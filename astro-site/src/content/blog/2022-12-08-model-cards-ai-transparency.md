---
title: "Model Cards: Documenting AI for Transparency and Trust"
author: Michael John Peña
draft: false
date: 2022-12-08
tags:
  - AI
  - Model Cards
  - Transparency
  - Documentation
  - Best Practices

---

I wrote "Model Cards: Documenting AI for Transparency and Trust" to share practical, production-minded guidance on this topic.

## What is a Model Card?

A model card is a documentation framework for machine learning models, inspired by nutrition labels on food. It provides essential information about a model's:

- Intended use and users
- Performance metrics
- Limitations and biases
- Ethical considerations

## Model Card Structure

### Basic Template

```markdown
# Model Card: [Model Name]

## Model Details

**Name:** Customer Churn Predictor v2.3
**Type:** Binary Classification
**Framework:** scikit-learn / XGBoost
**Version:** 2.3.0
**Date:** 2022-12-08
**Owner:** Data Science Team (data-science@company.com)

### Description
This model predicts the probability of customer churn within the next 30 days
based on customer behavior and account attributes.

### Architecture
- Algorithm: XGBoost Classifier
- Features: 45 engineered features
- Output: Probability score (0-1) and binary prediction

## Intended Use

### Primary Use Cases
- Identify at-risk customers for proactive retention campaigns
- Prioritize customer success team outreach
- Trigger automated retention workflows

### Primary Users
- Customer Success Team
- Marketing Automation Systems
- Executive Dashboards

### Out-of-Scope Uses
- Credit decisions
- Insurance underwriting
- Employment decisions
- Any automated decision without human review

## Training Data

### Dataset Description
- **Source:** Internal CRM and transaction database
- **Time Period:** January 2020 - October 2022
- **Size:** 500,000 customer records
- **Label Definition:** Customer who cancelled within 30 days of prediction date

### Preprocessing
- Missing values imputed using median (numeric) and mode (categorical)
- Outliers capped at 99th percentile
- Categorical features one-hot encoded

## Performance

### Overall Metrics
| Metric | Value |
|--------|-------|
| Accuracy | 0.847 |
| Precision | 0.723 |
| Recall | 0.689 |
| F1 Score | 0.706 |
| AUC-ROC | 0.891 |

### Performance by Segment

| Segment | Accuracy | AUC-ROC | Sample Size |
|---------|----------|---------|-------------|
| Enterprise | 0.862 | 0.903 | 45,000 |
| SMB | 0.841 | 0.887 | 180,000 |
| Consumer | 0.839 | 0.882 | 275,000 |

| Tenure | Accuracy | AUC-ROC | Sample Size |
|--------|----------|---------|-------------|
| < 6 months | 0.798 | 0.845 | 85,000 |
| 6-24 months | 0.856 | 0.901 | 220,000 |
| > 24 months | 0.871 | 0.912 | 195,000 |

## Ethical Considerations

### Fairness Evaluation
Model evaluated for disparate impact across:
- Customer tier (no significant disparity)
- Geographic region (see limitations)
- Account age (see limitations)

### Known Biases
- Lower accuracy for customers with < 6 months tenure
- May underperform for customers in newly launched regions

### Mitigation Steps
- Separate model being developed for new customers
- Human review required for customers in new regions

## Limitations

### Technical Limitations
- Requires at least 30 days of customer history
- Performance degrades for customers with very low activity
- Does not account for seasonal patterns in churn

### Deployment Limitations
- Predictions should be refreshed weekly minimum
- Not designed for real-time inference
- Requires feature engineering pipeline to be operational

### Known Failure Modes
- Customers who churn due to external factors (e.g., acquisition)
- Customers with sudden behavior changes
- Bulk enterprise cancellations

## Recommendations

### For Users
- Use predictions as one input to retention decisions, not the sole factor
- Review low-confidence predictions manually
- Consider customer feedback alongside model predictions

### For Operators
- Monitor drift in feature distributions monthly
- Retrain model quarterly or when AUC drops below 0.85
- Maintain fallback rules for system outages

## Updates and Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.3.0 | 2022-12-01 | Added 10 new features, retrained on 2022 data |
| 2.2.0 | 2022-06-01 | Fixed label leakage issue |
| 2.1.0 | 2022-03-01 | Initial production deployment |

## Contact

- **Owner:** Data Science Team
- **Email:** data-science@company.com
- **Issues:** https://github.com/company/churn-model/issues
```

## Generating Model Cards Programmatically

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import date
import json

@dataclass
class PerformanceMetrics:
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    auc_roc: float

@dataclass
class SegmentPerformance:
    segment_name: str
    segment_value: str
    metrics: PerformanceMetrics
    sample_size: int

@dataclass
class ModelCard:
    # Model Details
    name: str
    version: str
    model_type: str
    framework: str
    owner: str
    description: str
    date_created: date = field(default_factory=date.today)

    # Intended Use
    primary_uses: List[str] = field(default_factory=list)
    primary_users: List[str] = field(default_factory=list)
    out_of_scope_uses: List[str] = field(default_factory=list)

    # Training Data
    data_source: str = ""
    data_timeframe: str = ""
    data_size: int = 0
    preprocessing_steps: List[str] = field(default_factory=list)

    # Performance
    overall_metrics: Optional[PerformanceMetrics] = None
    segment_performance: List[SegmentPerformance] = field(default_factory=list)

    # Ethics
    fairness_evaluation: str = ""
    known_biases: List[str] = field(default_factory=list)
    mitigation_steps: List[str] = field(default_factory=list)

    # Limitations
    technical_limitations: List[str] = field(default_factory=list)
    deployment_limitations: List[str] = field(default_factory=list)
    failure_modes: List[str] = field(default_factory=list)

    # Recommendations
    user_recommendations: List[str] = field(default_factory=list)
    operator_recommendations: List[str] = field(default_factory=list)

    def to_markdown(self) -> str:
        """Generate markdown model card."""
        md = f"""# Model Card: {self.name}

## Model Details

**Name:** {self.name}
**Version:** {self.version}
**Type:** {self.model_type}
**Framework:** {self.framework}
**Date:** {self.date_created}
**Owner:** {self.owner}

### Description
{self.description}

## Intended Use

### Primary Use Cases
{self._list_to_md(self.primary_uses)}

### Primary Users
{self._list_to_md(self.primary_users)}

### Out-of-Scope Uses
{self._list_to_md(self.out_of_scope_uses)}

## Training Data

- **Source:** {self.data_source}
- **Time Period:** {self.data_timeframe}
- **Size:** {self.data_size:,} records

### Preprocessing
{self._list_to_md(self.preprocessing_steps)}

## Performance

### Overall Metrics
{self._metrics_table(self.overall_metrics)}

### Performance by Segment
{self._segment_table(self.segment_performance)}

## Ethical Considerations

### Fairness Evaluation
{self.fairness_evaluation}

### Known Biases
{self._list_to_md(self.known_biases)}

### Mitigation Steps
{self._list_to_md(self.mitigation_steps)}

## Limitations

### Technical Limitations
{self._list_to_md(self.technical_limitations)}

### Deployment Limitations
{self._list_to_md(self.deployment_limitations)}

### Known Failure Modes
{self._list_to_md(self.failure_modes)}

## Recommendations

### For Users
{self._list_to_md(self.user_recommendations)}

### For Operators
{self._list_to_md(self.operator_recommendations)}
"""
        return md

    def _list_to_md(self, items: List[str]) -> str:
        return "\n".join(f"- {item}" for item in items)

    def _metrics_table(self, metrics: PerformanceMetrics) -> str:
        if not metrics:
            return "No metrics available"
        return f"""| Metric | Value |
|--------|-------|
| Accuracy | {metrics.accuracy:.3f} |
| Precision | {metrics.precision:.3f} |
| Recall | {metrics.recall:.3f} |
| F1 Score | {metrics.f1_score:.3f} |
| AUC-ROC | {metrics.auc_roc:.3f} |"""

    def _segment_table(self, segments: List[SegmentPerformance]) -> str:
        if not segments:
            return "No segment analysis available"

        rows = ["| Segment | Value | Accuracy | AUC-ROC | Sample Size |",
                "|---------|-------|----------|---------|-------------|"]

        for seg in segments:
            rows.append(f"| {seg.segment_name} | {seg.segment_value} | "
                       f"{seg.metrics.accuracy:.3f} | {seg.metrics.auc_roc:.3f} | "
                       f"{seg.sample_size:,} |")

        return "\n".join(rows)

    def to_json(self) -> str:
        """Export model card as JSON."""
        return json.dumps(self.__dict__, default=str, indent=2)


# Usage example
def create_model_card_from_training(model, X_test, y_test, metadata: dict) -> ModelCard:
    """Create a model card from trained model and test data."""
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1] if hasattr(model, 'predict_proba') else y_pred

    metrics = PerformanceMetrics(
        accuracy=accuracy_score(y_test, y_pred),
        precision=precision_score(y_test, y_pred),
        recall=recall_score(y_test, y_pred),
        f1_score=f1_score(y_test, y_pred),
        auc_roc=roc_auc_score(y_test, y_prob)
    )

    card = ModelCard(
        name=metadata['name'],
        version=metadata['version'],
        model_type=metadata['type'],
        framework=type(model).__name__,
        owner=metadata['owner'],
        description=metadata['description'],
        overall_metrics=metrics,
        **metadata.get('additional_info', {})
    )

    return card
```

## Integrating Model Cards with Azure ML

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Model

def register_model_with_card(
    ml_client: MLClient,
    model_path: str,
    model_card: ModelCard
) -> Model:
    """Register model in Azure ML with model card as metadata."""

    model = Model(
        path=model_path,
        name=model_card.name,
        version=model_card.version,
        description=model_card.description,
        tags={
            "model_type": model_card.model_type,
            "framework": model_card.framework,
            "owner": model_card.owner,
            "auc_roc": str(model_card.overall_metrics.auc_roc)
        },
        properties={
            "model_card_json": model_card.to_json()
        }
    )

    registered = ml_client.models.create_or_update(model)

    # Also save model card as artifact
    with open(f"{model_path}/model_card.md", "w") as f:
        f.write(model_card.to_markdown())

    return registered
```

## Conclusion

Model cards are essential for responsible AI deployment. They provide transparency, enable informed decisions about model use, and facilitate regulatory compliance. Make model card creation part of your standard ML workflow - your future self and your users will thank you.

## Resources

- [Model Cards for Model Reporting (Paper)](https://arxiv.org/abs/1810.03993)
- [Google Model Cards](https://modelcards.withgoogle.com/)
- [Hugging Face Model Cards](https://huggingface.co/docs/hub/model-cards)

