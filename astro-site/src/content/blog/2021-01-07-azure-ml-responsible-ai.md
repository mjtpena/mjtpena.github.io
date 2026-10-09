---
title: "Azure ML Responsible AI: Build Trustworthy Models"
description: "\"The model said no, and I can't tell why\" is the conversation that derails most ML deployments. Responsible AI in Azure ML is a set of tools designed to…"
author: Michael John Peña
draft: false
date: 2021-01-07
tags:
  - Azure
  - Machine Learning
  - Responsible AI
  - Ethics
---

"The model said no, and I can't tell why" is the conversation that derails most ML deployments. Responsible AI in Azure ML is a set of tools designed to stop that happening: interpretability via InterpretML, fairness via Fairlearn, error analysis dashboards, and counterfactual analysis to probe the boundary between yes and no. None of it is academic—I've used the fairness dashboard to flag a credit-decisioning model that quietly behaved differently across postcodes. Worth running before deployment, not after.

## Responsible AI Dashboard

Components:
- **Error Analysis**: Identify failure patterns
- **Model Interpretability**: Explain predictions
- **Fairness**: Detect and mitigate bias
- **Counterfactuals**: What-if analysis
- **Causal Inference**: Understand causality

## Enable Responsible AI

```python
from azureml.core import Workspace, Experiment
from raiwidgets import ResponsibleAIDashboard
from responsibleai import RAIInsights

# Create RAI insights
rai_insights = RAIInsights(model, train_data, test_data, target_column, task_type='classification')

# Add components
rai_insights.explainer.add()
rai_insights.error_analysis.add()
rai_insights.counterfactual.add(total_CFs=10)
rai_insights.causal.add(treatment_features=['age', 'income'])

# Compute insights
rai_insights.compute()

# View dashboard
ResponsibleAIDashboard(rai_insights)
```

## Model Interpretability

```python
from interpret.ext.blackbox import TabularExplainer

# Create explainer
explainer = TabularExplainer(model, X_train, features=feature_names)

# Global explanations
global_explanation = explainer.explain_global(X_test)
print("Global feature importance:")
for feature, importance in zip(global_explanation.get_ranked_global_names(),
                                global_explanation.get_ranked_global_values()):
    print(f"  {feature}: {importance:.4f}")

# Local explanation (single prediction)
local_explanation = explainer.explain_local(X_test[0:1])
print("\nLocal explanation:")
for feature, value in zip(local_explanation.get_ranked_local_names()[0],
                          local_explanation.get_ranked_local_values()[0]):
    print(f"  {feature}: {value:.4f}")
```

## Fairness Assessment

```python
from fairlearn.metrics import MetricFrame
from fairlearn.metrics import selection_rate, demographic_parity_difference

# Define sensitive features
sensitive_features = X_test['gender']

# Calculate metrics by group
metric_frame = MetricFrame(
    metrics={
        'accuracy': accuracy_score,
        'selection_rate': selection_rate,
        'precision': precision_score,
        'recall': recall_score
    },
    y_true=y_test,
    y_pred=predictions,
    sensitive_features=sensitive_features
)

print("Metrics by group:")
print(metric_frame.by_group)

print(f"\nDemographic parity difference: {metric_frame.difference()['selection_rate']:.4f}")
```

## Bias Mitigation

```python
from fairlearn.reductions import ExponentiatedGradient, DemographicParity

# Mitigate bias using Exponentiated Gradient
mitigator = ExponentiatedGradient(model, DemographicParity())
mitigator.fit(X_train, y_train, sensitive_features=train_sensitive_features)

# Predict with mitigated model
fair_predictions = mitigator.predict(X_test)

# Compare metrics
print("Original model disparity:", demographic_parity_difference(y_test, predictions, sensitive_features))
print("Mitigated model disparity:", demographic_parity_difference(y_test, fair_predictions, sensitive_features))
```

## Error Analysis

```python
from erroranalysis import ErrorAnalysisDashboard

# Create error analysis dashboard
ErrorAnalysisDashboard(
    explanation=global_explanation,
    model=model,
    dataset=X_test,
    true_y=y_test,
    features=feature_names
)

# Programmatic error analysis
from erroranalysis import ErrorAnalysisManager

manager = ErrorAnalysisManager(model, X_test, y_test)
report = manager.compute_error_analysis()

print("Error tree:")
for node in report.tree:
    print(f"  Condition: {node.condition}, Error rate: {node.error_rate:.2%}")
```

## Counterfactual Analysis

```python
from dice_ml import Dice

# Create DiCE model
d = Dice(data_interface, model_interface)

# Generate counterfactuals
cf = d.generate_counterfactuals(
    query_instances,
    total_CFs=5,
    desired_class="opposite"
)

# Show what changes would flip the prediction
cf.visualize_as_dataframe()
```

## Register RAI Dashboard

```python
# Upload to Azure ML
rai_insights.save("./rai_insights")

run = experiment.start_logging()
run.upload_folder("rai_insights", "./rai_insights")
run.complete()

# View in Azure ML Studio
print(f"View dashboard: {run.get_portal_url()}")
```

## Best Practices

1. Assess fairness across sensitive groups
2. Explain model decisions
3. Analyze error patterns
4. Test edge cases
5. Document model behavior

Responsible AI: building ML systems we can trust.
