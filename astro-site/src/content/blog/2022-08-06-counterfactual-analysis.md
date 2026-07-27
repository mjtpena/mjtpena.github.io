---
title: "Counterfactual Analysis for ML Model Understanding"
author: "Michael John Peña"
draft: false
date: 2022-08-06
tags: ["Azure", "Machine Learning", "Counterfactuals", "Explainability", "AI"]

---

I wrote "Counterfactual Analysis for ML Model Understanding" to share practical, production-minded guidance on this topic.

## Understanding Counterfactuals

Counterfactual explanations show:
- Minimal changes needed to flip a prediction
- Which features are most influential for a specific instance
- Actionable paths to desired outcomes

## Setting Up Counterfactual Analysis

```python
from dice_ml import Data, Model, Dice
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

# Load data
df = pd.read_csv("loan_data.csv")
X = df.drop("approved", axis=1)
y = df["approved"]

# Train model
model = RandomForestClassifier(n_estimators=100)
model.fit(X, y)

# Configure DiCE
data_dice = Data(
    dataframe=df,
    continuous_features=["income", "loan_amount", "credit_score", "debt_ratio"],
    outcome_name="approved"
)

model_dice = Model(model=model, backend="sklearn")

dice = Dice(data_dice, model_dice, method="random")
```

## Generating Counterfactuals

```python
# Select a denied loan application
denied_apps = X[model.predict(X) == 0]
sample = denied_apps.iloc[[0]]

print("Original Application (DENIED):")
print(sample)

# Generate counterfactuals
counterfactuals = dice.generate_counterfactuals(
    sample,
    total_CFs=5,
    desired_class="opposite"
)

# Display results
print("\nCounterfactual Explanations (would be APPROVED):")
counterfactuals.visualize_as_dataframe()
```

## Feature Constraints

```python
# Define feature constraints
# Some features cannot be changed (e.g., age cannot decrease)
dice_with_constraints = Dice(
    data_dice,
    model_dice,
    method="genetic"
)

# Generate with constraints
constrained_cfs = dice_with_constraints.generate_counterfactuals(
    sample,
    total_CFs=5,
    desired_class="opposite",
    features_to_vary=["income", "credit_score", "debt_ratio"],  # Can't change loan_amount after application
    permitted_range={
        "credit_score": [sample["credit_score"].values[0], 850],  # Can only increase
        "debt_ratio": [0, sample["debt_ratio"].values[0]]  # Can only decrease
    }
)

print("\nActionable Counterfactuals:")
constrained_cfs.visualize_as_dataframe()
```

## Diverse Counterfactuals

```python
# Generate diverse counterfactuals
diverse_cfs = dice.generate_counterfactuals(
    sample,
    total_CFs=5,
    desired_class="opposite",
    diversity_weight=1.0,  # Higher = more diverse
    proximity_weight=0.5   # Lower = allow bigger changes
)

# Analyze diversity
cf_df = diverse_cfs.cf_examples_list[0].final_cfs_df

print("Diversity of Counterfactuals:")
for col in X.columns:
    unique_values = cf_df[col].nunique()
    print(f"  {col}: {unique_values} unique values")
```

## Counterfactual Quality Metrics

```python
class CounterfactualEvaluator:
    def __init__(self, original, counterfactuals, feature_ranges):
        self.original = original
        self.counterfactuals = counterfactuals
        self.feature_ranges = feature_ranges

    def sparsity(self, cf):
        """Count number of features changed"""
        changes = (cf != self.original.values[0]).sum()
        return changes

    def proximity(self, cf):
        """Measure distance from original"""
        distances = []
        for i, col in enumerate(self.original.columns):
            range_size = self.feature_ranges[col][1] - self.feature_ranges[col][0]
            normalized_dist = abs(cf[i] - self.original[col].values[0]) / range_size
            distances.append(normalized_dist)
        return sum(distances) / len(distances)

    def plausibility(self, cf, training_data):
        """Check if CF is within training data distribution"""
        from scipy.spatial.distance import cdist
        distances = cdist([cf], training_data.values, metric='euclidean')
        return distances.min()

    def evaluate_all(self, training_data):
        """Evaluate all counterfactuals"""
        results = []
        for i, cf in enumerate(self.counterfactuals.values):
            results.append({
                'cf_index': i,
                'sparsity': self.sparsity(cf),
                'proximity': self.proximity(cf),
                'plausibility': self.plausibility(cf, training_data)
            })
        return pd.DataFrame(results)

# Evaluate counterfactuals
evaluator = CounterfactualEvaluator(
    sample,
    cf_df[X.columns],
    feature_ranges={col: (X[col].min(), X[col].max()) for col in X.columns}
)

quality_metrics = evaluator.evaluate_all(X)
print("\nCounterfactual Quality Metrics:")
print(quality_metrics)
```

## Integration with RAI Dashboard

```python
from responsibleai import RAIInsights

# Create RAI insights with counterfactuals
rai_insights = RAIInsights(
    model=model,
    train=df.drop("approved", axis=1)[:800],
    test=df.drop("approved", axis=1)[800:],
    target_column="approved",
    task_type="classification"
)

# Add counterfactual component
rai_insights.counterfactual.add(
    total_CFs=10,
    desired_class="opposite",
    features_to_vary=["income", "credit_score", "debt_ratio"],
    permitted_range={
        "credit_score": [0, 850],
        "debt_ratio": [0, 1]
    }
)

# Compute
rai_insights.compute()

# Launch dashboard
from raiwidgets import ResponsibleAIDashboard
ResponsibleAIDashboard(rai_insights)
```

## Customer-Facing Explanations

```python
def generate_customer_explanation(original, counterfactual, feature_descriptions):
    """Generate human-readable explanation for customers"""
    changes = []

    for col in original.columns:
        orig_val = original[col].values[0]
        cf_val = counterfactual[col]

        if orig_val != cf_val:
            description = feature_descriptions.get(col, col)
            if isinstance(orig_val, (int, float)):
                change_type = "increase" if cf_val > orig_val else "decrease"
                changes.append(f"- {change_type.capitalize()} your {description} from {orig_val:.2f} to {cf_val:.2f}")
            else:
                changes.append(f"- Change your {description} from '{orig_val}' to '{cf_val}'")

    explanation = "Your application was not approved. Here's what you could do to potentially get approved:\n\n"
    explanation += "\n".join(changes)
    explanation += "\n\nNote: These are suggestions based on our model. Actual approval depends on many factors."

    return explanation

# Feature descriptions for customers
feature_descriptions = {
    "income": "annual income",
    "credit_score": "credit score",
    "debt_ratio": "debt-to-income ratio",
    "loan_amount": "requested loan amount"
}

# Generate explanation
best_cf = cf_df.iloc[0]
explanation = generate_customer_explanation(sample, best_cf, feature_descriptions)
print(explanation)
```

Counterfactual analysis makes ML models more interpretable and provides actionable guidance for users.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
