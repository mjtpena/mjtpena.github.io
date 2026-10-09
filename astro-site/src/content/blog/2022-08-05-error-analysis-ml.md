---
title: "Error Analysis for Machine Learning Models"
description: "Error analysis reveals the weaknesses in your model and guides targeted improvements."
author: "Michael John Peña"
draft: false
date: 2022-08-05
tags: ["Azure", "Machine Learning", "Error Analysis", "Model Debugging", "AI"]
---

## Understanding Error Analysis

Error analysis identifies:
- Cohorts with high error rates
- Root causes of model failures
- Patterns in misclassifications
- Data quality issues

## Setting Up Error Analysis

```python
from raiwidgets import ErrorAnalysisDashboard
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
import pandas as pd

# Load and prepare data
df = pd.read_csv("customer_data.csv")
X = df.drop("churn", axis=1)
y = df["churn"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# Train model
model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)

# Launch Error Analysis Dashboard
ErrorAnalysisDashboard(
    global_explanation=None,
    model=model,
    dataset=X_test,
    true_y=y_test,
    categorical_features=["contract_type", "payment_method"],
    features=X_test.columns.tolist()
)
```

## Error Tree Analysis

```python
from erroranalysis import ModelAnalyzer
from erroranalysis._internal.constants import ModelTask

# Create analyzer
analyzer = ModelAnalyzer(
    model=model,
    dataset=X_test,
    true_y=y_test,
    feature_names=X_test.columns.tolist(),
    categorical_features=["contract_type", "payment_method"],
    model_task=ModelTask.CLASSIFICATION
)

# Build error tree
tree = analyzer.compute_error_tree(
    max_depth=4,
    num_leaves=31,
    min_child_samples=20
)

# Analyze tree nodes
def print_tree(node, depth=0):
    """Print error tree structure"""
    indent = "  " * depth
    if node.is_leaf:
        print(f"{indent}Leaf: {node.error_rate:.2%} error, {node.size} samples")
    else:
        print(f"{indent}Split on {node.feature} at {node.threshold}")
        print_tree(node.left, depth + 1)
        print_tree(node.right, depth + 1)

print_tree(tree.root)
```

## Identifying Error Cohorts

```python
import numpy as np
from sklearn.metrics import classification_report

class ErrorCohortAnalyzer:
    def __init__(self, model, X, y):
        self.model = model
        self.X = X
        self.y = y
        self.predictions = model.predict(X)
        self.errors = self.predictions != y

    def find_high_error_cohorts(self, features, bins=10):
        """Find cohorts with high error rates"""
        cohorts = []

        for feature in features:
            if self.X[feature].dtype in ['object', 'category']:
                # Categorical feature
                for value in self.X[feature].unique():
                    mask = self.X[feature] == value
                    error_rate = self.errors[mask].mean()
                    size = mask.sum()
                    cohorts.append({
                        'feature': feature,
                        'condition': f"{feature} == {value}",
                        'error_rate': error_rate,
                        'size': size,
                        'mask': mask
                    })
            else:
                # Numerical feature - bin it
                percentiles = np.percentile(self.X[feature], np.linspace(0, 100, bins + 1))
                for i in range(len(percentiles) - 1):
                    low, high = percentiles[i], percentiles[i + 1]
                    mask = (self.X[feature] >= low) & (self.X[feature] < high)
                    if mask.sum() > 0:
                        error_rate = self.errors[mask].mean()
                        cohorts.append({
                            'feature': feature,
                            'condition': f"{feature} in [{low:.2f}, {high:.2f})",
                            'error_rate': error_rate,
                            'size': mask.sum(),
                            'mask': mask
                        })

        # Sort by error rate
        cohorts.sort(key=lambda x: x['error_rate'], reverse=True)
        return cohorts

    def analyze_cohort(self, mask):
        """Detailed analysis of a specific cohort"""
        y_true = self.y[mask]
        y_pred = self.predictions[mask]

        return {
            'size': mask.sum(),
            'error_rate': (y_pred != y_true).mean(),
            'report': classification_report(y_true, y_pred, output_dict=True)
        }

# Usage
analyzer = ErrorCohortAnalyzer(model, X_test, y_test)
high_error_cohorts = analyzer.find_high_error_cohorts(X_test.columns)

print("Top 5 High-Error Cohorts:")
for cohort in high_error_cohorts[:5]:
    print(f"  {cohort['condition']}: {cohort['error_rate']:.2%} error ({cohort['size']} samples)")
```

## Confusion Matrix Analysis

```python
from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay
import matplotlib.pyplot as plt

def analyze_confusion_by_cohort(model, X, y, feature, value):
    """Analyze confusion matrix for a specific cohort"""
    mask = X[feature] == value if X[feature].dtype == 'object' else X[feature] >= value

    y_true = y[mask]
    y_pred = model.predict(X[mask])

    cm = confusion_matrix(y_true, y_pred)

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    # Overall confusion matrix
    ConfusionMatrixDisplay.from_predictions(y, model.predict(X), ax=axes[0])
    axes[0].set_title("Overall")

    # Cohort confusion matrix
    ConfusionMatrixDisplay.from_predictions(y_true, y_pred, ax=axes[1])
    axes[1].set_title(f"Cohort: {feature} = {value}")

    plt.tight_layout()
    plt.savefig("confusion_comparison.png")

analyze_confusion_by_cohort(model, X_test, y_test, "contract_type", "month-to-month")
```

## Error Pattern Detection

```python
class ErrorPatternDetector:
    def __init__(self, model, X, y):
        self.model = model
        self.X = X
        self.y = y
        self.predictions = model.predict(X)
        self.probabilities = model.predict_proba(X)

    def find_confident_errors(self, threshold=0.9):
        """Find high-confidence incorrect predictions"""
        errors = self.predictions != self.y
        max_probs = np.max(self.probabilities, axis=1)
        confident_errors = errors & (max_probs >= threshold)

        error_indices = np.where(confident_errors)[0]

        return pd.DataFrame({
            'index': error_indices,
            'true_label': self.y.iloc[error_indices].values,
            'predicted': self.predictions[error_indices],
            'confidence': max_probs[error_indices]
        }).sort_values('confidence', ascending=False)

    def find_boundary_errors(self, threshold=0.55):
        """Find errors near decision boundary"""
        errors = self.predictions != self.y
        max_probs = np.max(self.probabilities, axis=1)
        boundary_errors = errors & (max_probs <= threshold)

        error_indices = np.where(boundary_errors)[0]

        return pd.DataFrame({
            'index': error_indices,
            'true_label': self.y.iloc[error_indices].values,
            'predicted': self.predictions[error_indices],
            'confidence': max_probs[error_indices]
        })

# Usage
detector = ErrorPatternDetector(model, X_test, y_test)

confident_errors = detector.find_confident_errors(threshold=0.9)
print(f"Found {len(confident_errors)} high-confidence errors")

boundary_errors = detector.find_boundary_errors(threshold=0.55)
print(f"Found {len(boundary_errors)} boundary errors")
```

## Actionable Insights

```python
def generate_error_report(analyzer):
    """Generate actionable error analysis report"""
    report = []

    # Find worst cohorts
    cohorts = analyzer.find_high_error_cohorts(X_test.columns)

    report.append("## High-Error Cohorts\n")
    for cohort in cohorts[:5]:
        if cohort['error_rate'] > 0.3:  # 30% error threshold
            report.append(f"- **{cohort['condition']}**: {cohort['error_rate']:.1%} error rate")
            report.append(f"  - Recommendation: Collect more training data for this segment")

    # Add model improvement suggestions
    report.append("\n## Recommendations\n")
    report.append("1. Review feature engineering for high-error cohorts")
    report.append("2. Consider separate models for distinct data segments")
    report.append("3. Investigate data quality issues in error-prone regions")

    return "\n".join(report)

print(generate_error_report(analyzer))
```

Error analysis reveals the weaknesses in your model and guides targeted improvements.
