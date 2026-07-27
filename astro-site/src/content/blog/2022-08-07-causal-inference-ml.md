---
title: "Causal Inference in Machine Learning with Azure ML"
author: "Michael John Peña"
draft: false
date: 2022-08-07
tags: ["Azure", "Machine Learning", "Causal Inference", "Statistics", "AI"]

---

I wrote "Causal Inference in Machine Learning with Azure ML" to share practical, production-minded guidance on this topic.

## Correlation vs Causation

Traditional ML finds correlations; causal inference identifies actual causal effects. This helps answer questions like:
- "Would increasing marketing spend cause more sales?"
- "Does this treatment actually improve patient outcomes?"

## Setting Up Causal Analysis

```python
from econml.dml import CausalForestDML
from econml.cate_interpreter import SingleTreeCateInterpreter
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier

# Load data
df = pd.read_csv("marketing_data.csv")

# Define variables
Y = df["sales"]  # Outcome
T = df["marketing_spend"]  # Treatment
X = df[["customer_segment", "region", "season", "previous_purchases"]]  # Features
W = df[["competitor_activity", "economic_index"]]  # Confounders

# Create causal forest model
causal_model = CausalForestDML(
    model_y=RandomForestRegressor(n_estimators=100),
    model_t=RandomForestRegressor(n_estimators=100),
    discrete_treatment=False,
    n_estimators=100,
    random_state=42
)

# Fit the model
causal_model.fit(Y, T, X=X, W=W)
```

## Estimating Treatment Effects

```python
# Average Treatment Effect (ATE)
ate = causal_model.ate(X)
print(f"Average Treatment Effect: {ate:.4f}")
print(f"Interpretation: Each $1 increase in marketing spend causes ${ate:.2f} increase in sales on average")

# Conditional Average Treatment Effect (CATE)
cate = causal_model.effect(X)
print(f"\nCATE Range: {cate.min():.4f} to {cate.max():.4f}")

# Effect for specific customer segment
segment_effect = causal_model.effect(X[X["customer_segment"] == "premium"])
print(f"Effect for premium customers: {segment_effect.mean():.4f}")

# Confidence intervals
effect_lb, effect_ub = causal_model.effect_interval(X, alpha=0.05)
print(f"95% CI: [{effect_lb.mean():.4f}, {effect_ub.mean():.4f}]")
```

## Interpreting Causal Effects

```python
# Create interpretable model of treatment effects
interpreter = SingleTreeCateInterpreter(
    include_model_uncertainty=True,
    max_depth=3
)

interpreter.interpret(causal_model, X)

# Visualize the tree
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(20, 10))
interpreter.plot(feature_names=X.columns, ax=ax)
plt.savefig("causal_tree.png")

# Get treatment effect summary by segment
def summarize_effects_by_segment(model, X, segment_col):
    """Summarize treatment effects by segment"""
    results = []
    for segment in X[segment_col].unique():
        mask = X[segment_col] == segment
        X_segment = X[mask]
        effect = model.effect(X_segment)
        lb, ub = model.effect_interval(X_segment, alpha=0.05)

        results.append({
            'segment': segment,
            'count': mask.sum(),
            'mean_effect': effect.mean(),
            'std_effect': effect.std(),
            'ci_lower': lb.mean(),
            'ci_upper': ub.mean()
        })

    return pd.DataFrame(results).sort_values('mean_effect', ascending=False)

segment_summary = summarize_effects_by_segment(causal_model, X, "customer_segment")
print("\nTreatment Effect by Customer Segment:")
print(segment_summary)
```

## Double Machine Learning

```python
from econml.dml import LinearDML, NonParamDML

# Linear DML for interpretable coefficients
linear_dml = LinearDML(
    model_y=RandomForestRegressor(n_estimators=100),
    model_t=RandomForestRegressor(n_estimators=100),
    discrete_treatment=False
)

linear_dml.fit(Y, T, X=X, W=W)

# Get coefficient interpretation
print("\nLinear DML Coefficients:")
for feature, coef in zip(X.columns, linear_dml.coef_):
    print(f"  {feature}: {coef:.4f}")

print(f"\nIntercept (base treatment effect): {linear_dml.intercept_:.4f}")
```

## Policy Learning

```python
from econml.policy import PolicyTree

# Learn optimal treatment policy
policy_tree = PolicyTree(
    max_depth=3,
    min_impurity_decrease=0.01
)

# Fit policy based on estimated treatment effects
policy_tree.fit(X, causal_model.effect(X))

# Get recommended treatment for new customers
new_customers = pd.DataFrame({
    'customer_segment': ['premium', 'standard', 'budget'],
    'region': ['east', 'west', 'central'],
    'season': ['summer', 'summer', 'summer'],
    'previous_purchases': [10, 5, 2]
})

recommendations = policy_tree.predict(new_customers)
print("\nTreatment Recommendations:")
for i, (idx, row) in enumerate(new_customers.iterrows()):
    print(f"  {row['customer_segment']} customer: {'Treat' if recommendations[i] else 'Do not treat'}")
```

## Integration with RAI Dashboard

```python
from responsibleai import RAIInsights

# Create RAI insights with causal analysis
rai_insights = RAIInsights(
    model=prediction_model,
    train=train_df,
    test=test_df,
    target_column="sales",
    task_type="regression"
)

# Add causal component
rai_insights.causal.add(
    treatment_features=["marketing_spend"],
    heterogeneity_features=["customer_segment", "region"],
    nuisance_model="automl",
    alpha=0.05
)

# Compute
rai_insights.compute()

# Get causal insights
causal_data = rai_insights.causal.get_data()

# Policy recommendations
policies = causal_data[0]["policy_tree"]
global_effect = causal_data[0]["global_effect"]

print(f"Global Treatment Effect: {global_effect}")
```

## A/B Testing Integration

```python
class CausalABTester:
    def __init__(self, treatment_col, outcome_col):
        self.treatment_col = treatment_col
        self.outcome_col = outcome_col

    def analyze_experiment(self, df, covariates=None):
        """Analyze A/B test with causal adjustment"""
        Y = df[self.outcome_col]
        T = df[self.treatment_col]

        if covariates is None:
            # Simple difference in means
            treatment_mean = Y[T == 1].mean()
            control_mean = Y[T == 0].mean()
            ate = treatment_mean - control_mean
            return {
                'method': 'difference_in_means',
                'ate': ate,
                'treatment_mean': treatment_mean,
                'control_mean': control_mean
            }

        # Use causal forest for heterogeneous effects
        X = df[covariates]
        W = None  # Could add confounders if observational

        model = CausalForestDML(
            model_y=RandomForestRegressor(n_estimators=50),
            model_t=RandomForestClassifier(n_estimators=50),
            discrete_treatment=True
        )

        model.fit(Y, T, X=X)

        return {
            'method': 'causal_forest',
            'ate': model.ate(X),
            'cate': model.effect(X),
            'model': model
        }

# Usage
tester = CausalABTester('treatment_group', 'conversion')
results = tester.analyze_experiment(
    ab_test_data,
    covariates=['age', 'device_type', 'previous_visits']
)
print(f"A/B Test ATE: {results['ate']:.4f}")
```

Causal inference enables data-driven decision making by understanding the true impact of interventions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
