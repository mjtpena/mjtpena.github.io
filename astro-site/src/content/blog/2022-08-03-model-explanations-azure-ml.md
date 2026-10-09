---
title: "Model Explanations in Azure Machine Learning"
description: "Model explanations build trust in AI systems and help identify areas for improvement."
author: "Michael John Peña"
draft: false
date: 2022-08-03
tags: ["Azure", "Machine Learning", "Explainability", "Interpretability", "AI"]
---

## Types of Explanations

- **Global explanations**: Overall feature importance across the dataset
- **Local explanations**: Feature contributions for individual predictions
- **Class explanations**: Feature importance for each class in classification

## Setting Up Explainers

```python
from interpret.ext.blackbox import TabularExplainer, MimicExplainer
from interpret.ext.glassbox import LinearExplainableModel
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

# Prepare data
df = pd.read_csv("customer_data.csv")
X = df.drop("churn", axis=1)
y = df["churn"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# Train model
model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)

# Create explainer
explainer = TabularExplainer(
    model,
    X_train,
    features=X_train.columns.tolist(),
    classes=["No Churn", "Churn"]
)
```

## Global Explanations

```python
# Generate global explanations
global_explanation = explainer.explain_global(X_test)

# Get feature importance
feature_importance = global_explanation.get_feature_importance_dict()

# Sort by importance
sorted_features = sorted(
    feature_importance.items(),
    key=lambda x: abs(x[1]),
    reverse=True
)

print("Global Feature Importance:")
for feature, importance in sorted_features[:10]:
    print(f"  {feature}: {importance:.4f}")

# Visualize
import matplotlib.pyplot as plt

features = [f[0] for f in sorted_features[:10]]
importance_values = [f[1] for f in sorted_features[:10]]

plt.figure(figsize=(10, 6))
plt.barh(features, importance_values)
plt.xlabel("Importance")
plt.title("Global Feature Importance")
plt.tight_layout()
plt.savefig("global_importance.png")
```

## Local Explanations

```python
# Explain individual predictions
local_explanation = explainer.explain_local(X_test.iloc[[0]])

# Get local feature importance
local_importance = local_explanation.get_ranked_local_values()
local_names = local_explanation.get_ranked_local_names()

print("\nLocal Explanation for Sample 0:")
print(f"Prediction: {model.predict(X_test.iloc[[0]])[0]}")
print(f"Probability: {model.predict_proba(X_test.iloc[[0]])[0]}")

for name, value in zip(local_names[0][:10], local_importance[0][:10]):
    print(f"  {name}: {value:.4f}")
```

## SHAP Explanations

```python
import shap

# Create SHAP explainer
shap_explainer = shap.TreeExplainer(model)
shap_values = shap_explainer.shap_values(X_test)

# Summary plot
shap.summary_plot(shap_values[1], X_test, show=False)
plt.savefig("shap_summary.png")

# Force plot for single prediction
shap.force_plot(
    shap_explainer.expected_value[1],
    shap_values[1][0],
    X_test.iloc[0],
    matplotlib=True,
    show=False
)
plt.savefig("shap_force.png")

# Dependence plot for specific feature
shap.dependence_plot("contract_months", shap_values[1], X_test, show=False)
plt.savefig("shap_dependence.png")
```

## Integrating with Azure ML

```python
from azureml.interpret import ExplanationClient
from azureml.core import Workspace, Experiment, Run

# Get current run
run = Run.get_context()

# Upload explanations to Azure ML
client = ExplanationClient.from_run(run)

# Upload global explanation
client.upload_model_explanation(
    global_explanation,
    comment="Global feature importance for churn model"
)

# Upload local explanations
client.upload_model_explanation(
    local_explanation,
    comment="Local explanations for test set"
)
```

## Explanation in MLflow

```python
import mlflow

with mlflow.start_run():
    # Log model
    mlflow.sklearn.log_model(model, "model")

    # Log feature importance as artifact
    importance_df = pd.DataFrame({
        "feature": sorted_features[:10][0],
        "importance": sorted_features[:10][1]
    })
    importance_df.to_csv("feature_importance.csv", index=False)
    mlflow.log_artifact("feature_importance.csv")

    # Log SHAP values
    np.save("shap_values.npy", shap_values[1])
    mlflow.log_artifact("shap_values.npy")

    # Log visualization
    mlflow.log_artifact("shap_summary.png")
```

## Creating Custom Explainers

```python
from interpret.ext.blackbox import MimicExplainer

# Use mimic explainer with interpretable surrogate
mimic_explainer = MimicExplainer(
    model,
    X_train,
    LinearExplainableModel,
    augment_data=True,
    max_num_of_augmentations=10,
    features=X_train.columns.tolist(),
    classes=["No Churn", "Churn"]
)

# Generate explanations
mimic_explanation = mimic_explainer.explain_global(X_test)

# Compare with original model explanations
print("\nComparison of Explainers:")
print("TabularExplainer top 5:", sorted_features[:5])
print("MimicExplainer top 5:", mimic_explanation.get_feature_importance_dict())
```

## Explanation API for Deployment

```python
from flask import Flask, request, jsonify
import joblib

app = Flask(__name__)

# Load model and explainer
model = joblib.load("model.pkl")
explainer = joblib.load("explainer.pkl")

@app.route("/predict", methods=["POST"])
def predict():
    data = request.json
    df = pd.DataFrame([data])

    # Get prediction
    prediction = model.predict(df)[0]
    probability = model.predict_proba(df)[0].tolist()

    # Get explanation
    local_explanation = explainer.explain_local(df)
    feature_contributions = dict(zip(
        local_explanation.get_ranked_local_names()[0][:5],
        local_explanation.get_ranked_local_values()[0][:5]
    ))

    return jsonify({
        "prediction": int(prediction),
        "probability": probability,
        "explanation": {
            "top_contributing_features": feature_contributions
        }
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

Model explanations build trust in AI systems and help identify areas for improvement.
