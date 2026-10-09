---
title: "Azure Machine Learning Updates: January 2024 New Features"
description: "Azure ML's new feature store and Prompt Flow integration changed how I structure ML pipelines in early 2024. Below are the updates that matter operationally…"
author: Michael John Peña
draft: false
date: 2024-01-30
tags:
  - Azure Machine Learning
  - MLOps
  - Model Deployment
  - Azure
  - Machine Learning
---

Azure ML's new feature store and Prompt Flow integration changed how I structure ML pipelines in early 2024. Below are the updates that matter operationally and examples of how I used them.

## Key Updates

### 1. Managed Feature Store GA

Feature stores enable feature reuse across ML projects:

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import FeatureStore, FeatureSet

# Create feature store
feature_store = FeatureStore(
    name="my-feature-store",
    description="Centralized feature repository"
)
ml_client.feature_stores.begin_create_or_update(feature_store).result()

# Define feature set
feature_set = FeatureSet(
    name="customer-features",
    version="1",
    entities=["customer_id"],
    source={
        "type": "parquet",
        "path": "azureml://datastores/features/paths/customer_features/"
    },
    features=[
        {"name": "total_purchases", "type": "float"},
        {"name": "days_since_last_purchase", "type": "int"},
        {"name": "customer_segment", "type": "string"}
    ]
)

ml_client.feature_sets.begin_create_or_update(feature_set).result()
```

### 2. Prompt Flow Integration

Build LLM applications directly in Azure ML:

```yaml
# flow.dag.yaml
inputs:
  question:
    type: string
    default: "What is Azure ML?"

outputs:
  answer:
    type: string
    reference: ${llm_response.output}

nodes:
  - name: retrieve_context
    type: python
    source:
      type: code
      path: retrieve.py
    inputs:
      query: ${inputs.question}

  - name: llm_response
    type: llm
    source:
      type: code
      path: llm_call.py
    inputs:
      context: ${retrieve_context.output}
      question: ${inputs.question}
    connection: azure_openai_connection
    api: chat
```

### 3. Model Catalog Enhancements

Access and deploy foundation models:

```python
from azure.ai.ml import MLClient

# List available models
models = ml_client.models.list(registry_name="azureml")

for model in models:
    if "llama" in model.name.lower():
        print(f"{model.name}: {model.description}")

# Deploy from catalog
deployment = ml_client.online_deployments.begin_create_or_update(
    deployment=ManagedOnlineDeployment(
        name="llama2-deployment",
        endpoint_name="llama2-endpoint",
        model="azureml://registries/azureml/models/Llama-2-7b/versions/1",
        instance_type="Standard_NC24ads_A100_v4",
        instance_count=1
    )
).result()
```

### 4. Managed Endpoints Improvements

```python
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment
)

# Create endpoint with autoscaling
endpoint = ManagedOnlineEndpoint(
    name="my-endpoint",
    auth_mode="key"
)

deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="my-endpoint",
    model=registered_model,
    instance_type="Standard_DS3_v2",
    instance_count=1,
    scale_settings={
        "scale_type": "target_utilization",
        "min_instances": 1,
        "max_instances": 5,
        "target_utilization_percentage": 70,
        "polling_interval": "PT1M",
        "cooldown_period": "PT5M"
    }
)
```

## MLOps Pipeline

```python
from azure.ai.ml import dsl, Input, Output
from azure.ai.ml.entities import Pipeline

@dsl.pipeline(
    name="training-pipeline",
    description="End-to-end ML training pipeline"
)
def create_training_pipeline(
    training_data: Input,
    test_data: Input
):
    # Data preparation
    prep_job = data_prep_component(
        input_data=training_data
    )

    # Feature engineering
    feature_job = feature_engineering_component(
        input_data=prep_job.outputs.output_data
    )

    # Training
    train_job = training_component(
        training_data=feature_job.outputs.features,
        epochs=10,
        learning_rate=0.001
    )

    # Evaluation
    eval_job = evaluation_component(
        model=train_job.outputs.model,
        test_data=test_data
    )

    # Register if metrics pass
    register_job = model_registration_component(
        model=train_job.outputs.model,
        metrics=eval_job.outputs.metrics,
        min_accuracy=0.85
    )

    return {
        "model": register_job.outputs.registered_model,
        "metrics": eval_job.outputs.metrics
    }

# Create and submit pipeline
pipeline = create_training_pipeline(
    training_data=Input(type="uri_folder", path="azureml://datastores/data/paths/train/"),
    test_data=Input(type="uri_folder", path="azureml://datastores/data/paths/test/")
)

ml_client.jobs.create_or_update(pipeline)
```

## Responsible AI Integration

```python
from azure.ai.ml.entities import (
    ResponsibleAIInsights,
    ResponsibleAIComponentConfig
)

# Add RAI dashboard to pipeline
rai_config = ResponsibleAIComponentConfig(
    components=[
        "ErrorAnalysis",
        "Explanations",
        "Fairness",
        "Counterfactuals"
    ],
    target_column="label",
    sensitive_features=["gender", "age_group"]
)

rai_job = ResponsibleAIInsights(
    name="model-rai-analysis",
    model=trained_model,
    test_data=test_data,
    components=rai_config
)
```

## Best Practices

1. **Use feature stores** for feature reuse and consistency
2. **Implement MLOps pipelines** for reproducibility
3. **Enable autoscaling** for production endpoints
4. **Add RAI dashboards** for model transparency
5. **Version everything** - data, models, and code

## Conclusion

Azure ML's 2024 updates focus on simplifying the end-to-end ML lifecycle. Feature stores, prompt flow integration, and improved model catalog make it easier to build and deploy ML solutions at scale.
