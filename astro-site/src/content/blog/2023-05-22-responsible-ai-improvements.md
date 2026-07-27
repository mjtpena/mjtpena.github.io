---
title: "Responsible AI Improvements in Azure: Building Trustworthy AI Systems"
author: Michael John Peña
draft: false
date: 2023-05-22
tags:
  - Responsible AI
  - Azure AI
  - Ethics
  - ML Fairness
  - Content Safety

---

I wrote "Responsible AI Improvements in Azure: Building Trustworthy AI Systems" to share practical, production-minded guidance on this topic.

## Responsible AI Framework

Azure implements responsible AI across multiple dimensions:

```
┌─────────────────────────────────────────────────────┐
│              Responsible AI Pillars                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Fairness │  │Reliability│  │ Privacy  │          │
│  │          │  │ & Safety  │  │& Security│          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │Inclusive-│  │Transpar- │  │Account-  │          │
│  │  ness    │  │  ency    │  │ ability  │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Fairness Assessment

### Using Fairlearn with Azure ML

```python
from fairlearn.metrics import MetricFrame
from fairlearn.reductions import ExponentiatedGradient, DemographicParity
from sklearn.metrics import accuracy_score, precision_score, recall_score
import pandas as pd

# Load data with sensitive features
data = pd.read_csv("customer_data.csv")
X = data.drop(["churn", "gender", "age_group"], axis=1)
y = data["churn"]
sensitive_features = data[["gender", "age_group"]]

# Train base model
from sklearn.ensemble import GradientBoostingClassifier
base_model = GradientBoostingClassifier()
base_model.fit(X_train, y_train)

# Assess fairness
y_pred = base_model.predict(X_test)

metric_frame = MetricFrame(
    metrics={
        "accuracy": accuracy_score,
        "precision": precision_score,
        "recall": recall_score
    },
    y_true=y_test,
    y_pred=y_pred,
    sensitive_features=sensitive_features_test
)

print("Overall metrics:")
print(metric_frame.overall)

print("\nMetrics by group:")
print(metric_frame.by_group)

print("\nGroup disparity:")
print(metric_frame.difference())
```

### Mitigating Unfairness

```python
from fairlearn.reductions import ExponentiatedGradient, DemographicParity

# Define fairness constraint
constraint = DemographicParity()

# Create fair model
fair_model = ExponentiatedGradient(
    base_model,
    constraints=constraint,
    eps=0.01  # Allowed disparity
)

# Train with fairness constraint
fair_model.fit(
    X_train,
    y_train,
    sensitive_features=sensitive_features_train
)

# Evaluate fair model
y_pred_fair = fair_model.predict(X_test)

fair_metric_frame = MetricFrame(
    metrics={"accuracy": accuracy_score},
    y_true=y_test,
    y_pred=y_pred_fair,
    sensitive_features=sensitive_features_test
)

print("Fair model metrics by group:")
print(fair_metric_frame.by_group)
print(f"Disparity: {fair_metric_frame.difference()}")
```

## Interpretability with InterpretML

```python
from interpret.glassbox import ExplainableBoostingClassifier
from interpret import show

# Train interpretable model
ebm = ExplainableBoostingClassifier(
    feature_names=feature_names,
    interactions=10
)
ebm.fit(X_train, y_train)

# Global explanations
global_explanation = ebm.explain_global()
show(global_explanation)

# Local explanations
local_explanation = ebm.explain_local(X_test[:5], y_test[:5])
show(local_explanation)
```

### SHAP Explanations

```python
import shap

# For any model
explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X_test)

# Summary plot
shap.summary_plot(shap_values, X_test, feature_names=feature_names)

# Force plot for single prediction
shap.force_plot(
    explainer.expected_value,
    shap_values[0],
    X_test.iloc[0],
    feature_names=feature_names
)

# Dependence plot
shap.dependence_plot("total_spend", shap_values, X_test)
```

## Azure Content Safety API

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import (
    AnalyzeTextOptions,
    AnalyzeImageOptions,
    TextCategory
)
from azure.core.credentials import AzureKeyCredential

# Initialize client
client = ContentSafetyClient(
    endpoint="https://your-content-safety.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

def analyze_text_safety(text: str) -> dict:
    """Analyze text for harmful content"""
    request = AnalyzeTextOptions(text=text)
    response = client.analyze_text(request)

    results = {
        "hate": {
            "severity": response.hate_result.severity,
            "filtered": response.hate_result.severity >= 4
        },
        "self_harm": {
            "severity": response.self_harm_result.severity,
            "filtered": response.self_harm_result.severity >= 4
        },
        "sexual": {
            "severity": response.sexual_result.severity,
            "filtered": response.sexual_result.severity >= 4
        },
        "violence": {
            "severity": response.violence_result.severity,
            "filtered": response.violence_result.severity >= 4
        }
    }

    results["overall_safe"] = not any(r["filtered"] for r in results.values())

    return results

# Example usage
text = "Your sample text here"
safety_result = analyze_text_safety(text)

if safety_result["overall_safe"]:
    print("Content is safe")
else:
    flagged = [k for k, v in safety_result.items() if isinstance(v, dict) and v.get("filtered")]
    print(f"Content flagged for: {flagged}")
```

### Image Content Safety

```python
def analyze_image_safety(image_path: str) -> dict:
    """Analyze image for harmful content"""
    with open(image_path, "rb") as f:
        image_data = f.read()

    request = AnalyzeImageOptions(
        image={"content": image_data}
    )
    response = client.analyze_image(request)

    return {
        "hate": response.hate_result.severity,
        "self_harm": response.self_harm_result.severity,
        "sexual": response.sexual_result.severity,
        "violence": response.violence_result.severity
    }
```

## RAI Dashboard in Azure ML

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import RAIInsights

ml_client = MLClient.from_config()

# Create RAI insights configuration
rai_config = RAIInsights(
    model=model,
    train=train_data,
    test=test_data,
    target_column="churn",
    task_type="classification",
    components={
        "error_analysis": {
            "enabled": True,
            "max_depth": 4
        },
        "explanation": {
            "enabled": True,
            "top_k": 10
        },
        "causal": {
            "enabled": True,
            "treatment_features": ["marketing_calls", "discount_offered"]
        },
        "counterfactual": {
            "enabled": True,
            "total_CFs": 10
        }
    }
)

# Run RAI analysis
rai_job = ml_client.jobs.create_or_update(
    name="rai-analysis-job",
    type="command",
    command="python run_rai_analysis.py",
    environment="AzureML-responsibleai@latest",
    compute="cpu-cluster"
)
```

## Implementing Guardrails for LLMs

```python
class SafeAIAssistant:
    def __init__(self, openai_client, content_safety_client):
        self.openai = openai_client
        self.safety = content_safety_client
        self.blocked_topics = ["harmful_activities", "illegal_content"]

    def process_input(self, user_input: str) -> dict:
        """Check user input for safety"""
        safety_result = analyze_text_safety(user_input)

        if not safety_result["overall_safe"]:
            return {
                "blocked": True,
                "reason": "Input contains potentially harmful content",
                "categories": [k for k, v in safety_result.items()
                              if isinstance(v, dict) and v.get("filtered")]
            }

        return {"blocked": False}

    def process_output(self, response: str) -> dict:
        """Check AI output for safety"""
        safety_result = analyze_text_safety(response)

        if not safety_result["overall_safe"]:
            return {
                "blocked": True,
                "fallback_response": "I cannot provide that information."
            }

        return {"blocked": False, "response": response}

    def chat(self, user_message: str) -> str:
        """Safe chat interaction"""
        # Check input
        input_check = self.process_input(user_message)
        if input_check["blocked"]:
            return "I'm unable to respond to that type of request."

        # Generate response
        response = self.openai.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_message}
            ]
        )
        ai_response = response.choices[0].message.content

        # Check output
        output_check = self.process_output(ai_response)
        if output_check["blocked"]:
            return output_check["fallback_response"]

        return output_check["response"]

    @property
    def system_prompt(self):
        return """You are a helpful AI assistant. Follow these guidelines:
        - Provide accurate, helpful information
        - Decline requests for harmful content
        - Be respectful and inclusive
        - Acknowledge limitations and uncertainties
        - Protect user privacy"""
```

Responsible AI is not optional - it is essential for building AI systems that users and organizations can trust. Tomorrow, I will cover the Azure Content Safety API in more detail.

## Resources

- [Responsible AI Overview](https://learn.microsoft.com/en-us/azure/machine-learning/concept-responsible-ai)
- [Fairlearn Documentation](https://fairlearn.org/)
- [Content Safety API](https://learn.microsoft.com/en-us/azure/cognitive-services/content-safety/)

