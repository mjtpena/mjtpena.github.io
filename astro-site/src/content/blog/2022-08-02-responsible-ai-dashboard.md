---
title: "Building Responsible AI with Azure ML's RAI Dashboard"
author: "Michael John Peña"
draft: false
date: 2022-08-02
tags: ["Azure", "Machine Learning", "Responsible AI", "Ethics", "ML Interpretability"]

---

I wrote "Building Responsible AI with Azure ML's RAI Dashboard" to share practical, production-minded guidance on this topic.

## Understanding the RAI Dashboard

The dashboard includes:
- Error Analysis
- Model Explanations
- Fairness Assessment
- Counterfactual Analysis
- Causal Inference

## Setting Up RAI Dashboard

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Model
from azure.identity import DefaultAzureCredential
from raiwidgets import ResponsibleAIDashboard
from responsibleai import RAIInsights

# Load your trained model and data
import joblib
import pandas as pd

model = joblib.load("model.pkl")
train_data = pd.read_csv("train.csv")
test_data = pd.read_csv("test.csv")

# Define target and features
target_column = "churn"
features = [col for col in train_data.columns if col != target_column]

# Create RAI Insights
rai_insights = RAIInsights(
    model=model,
    train=train_data,
    test=test_data,
    target_column=target_column,
    task_type="classification"
)
```

## Adding Error Analysis

```python
# Add error analysis component
rai_insights.error_analysis.add()

# Compute insights
rai_insights.compute()

# View error tree
error_tree = rai_insights.error_analysis.get_data()
print("Error tree nodes:", len(error_tree))
```

## Model Explanations

```python
# Add explainer
rai_insights.explainer.add()

# Compute explanations
rai_insights.compute()

# Get global feature importance
global_importance = rai_insights.explainer.get_global_importance()
for feature, importance in sorted(global_importance.items(), key=lambda x: -x[1])[:10]:
    print(f"{feature}: {importance:.4f}")
```

## Fairness Assessment

```python
# Add fairness analysis
rai_insights.fairness.add(
    sensitive_features=["gender", "age_group"]
)

# Compute fairness metrics
rai_insights.compute()

# Get fairness metrics
fairness_metrics = rai_insights.fairness.get_data()

# Check for disparities
for sensitive_feature in ["gender", "age_group"]:
    print(f"\nFairness metrics for {sensitive_feature}:")
    for metric_name, values in fairness_metrics[sensitive_feature].items():
        print(f"  {metric_name}: {values}")
```

## Creating RAI Dashboard in Azure ML

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment
)

# Register model with RAI components
from azure.ai.ml.entities import Model

model_for_rai = Model(
    path="./model",
    name="churn-model-rai",
    description="Model with RAI dashboard"
)

ml_client.models.create_or_update(model_for_rai)

# Create RAI insights job
from azure.ai.ml import dsl, Input, Output

@dsl.pipeline(
    compute="cpu-cluster",
    description="RAI Dashboard Pipeline"
)
def rai_pipeline(
    target_column_name: str,
    train_data: Input,
    test_data: Input,
    model: Input
):
    from azure.ai.ml.rai import (
        RAIInsightsPipelineComponent,
        ErrorAnalysisComponent,
        ExplanationComponent,
        FairnessComponent,
        CounterfactualComponent,
        CausalComponent
    )

    # Create RAI insights
    rai_constructor = RAIInsightsPipelineComponent(
        task_type="classification",
        model=model,
        train_dataset=train_data,
        test_dataset=test_data,
        target_column_name=target_column_name
    )

    # Add components
    error_analysis = ErrorAnalysisComponent(
        rai_insights=rai_constructor.outputs.rai_insights
    )

    explanations = ExplanationComponent(
        rai_insights=rai_constructor.outputs.rai_insights
    )

    fairness = FairnessComponent(
        rai_insights=rai_constructor.outputs.rai_insights,
        sensitive_features=["gender", "age"]
    )

    return {
        "dashboard": rai_constructor.outputs.rai_insights
    }

# Submit pipeline
pipeline_job = ml_client.jobs.create_or_update(
    rai_pipeline(
        target_column_name="churn",
        train_data=Input(path="azureml:train-data:1"),
        test_data=Input(path="azureml:test-data:1"),
        model=Input(path="azureml:churn-model:1")
    )
)
```

## Interpreting the Dashboard

```python
# Launch interactive dashboard
ResponsibleAIDashboard(rai_insights)

# Or save for sharing
rai_insights.save("./rai_insights_output")

# Load saved insights
loaded_insights = RAIInsights.load("./rai_insights_output")
```

## Best Practices for Responsible AI

```python
class ResponsibleMLPipeline:
    def __init__(self, model, train_data, test_data, target_column):
        self.model = model
        self.train_data = train_data
        self.test_data = test_data
        self.target_column = target_column
        self.rai_insights = None

    def run_full_assessment(self, sensitive_features=None):
        """Run complete RAI assessment"""
        self.rai_insights = RAIInsights(
            model=self.model,
            train=self.train_data,
            test=self.test_data,
            target_column=self.target_column,
            task_type="classification"
        )

        # Add all components
        self.rai_insights.error_analysis.add()
        self.rai_insights.explainer.add()

        if sensitive_features:
            self.rai_insights.fairness.add(sensitive_features=sensitive_features)

        self.rai_insights.counterfactual.add(
            total_CFs=10,
            desired_class="opposite"
        )

        # Compute all insights
        self.rai_insights.compute()

        return self.generate_report()

    def generate_report(self):
        """Generate RAI report"""
        report = {
            "model_performance": self._get_performance_metrics(),
            "error_analysis": self._get_error_summary(),
            "feature_importance": self._get_top_features(),
            "fairness": self._get_fairness_summary(),
            "recommendations": self._get_recommendations()
        }
        return report

    def _get_recommendations(self):
        """Generate actionable recommendations"""
        recommendations = []

        # Check for high error cohorts
        error_data = self.rai_insights.error_analysis.get_data()
        # Add recommendations based on findings

        return recommendations
```

The RAI Dashboard enables you to build and deploy ML models that are fair, interpretable, and reliable.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
