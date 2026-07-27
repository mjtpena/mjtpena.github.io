---
title: "Azure Machine Learning Updates at Build 2023"
author: Michael John Peña
draft: false
date: 2023-05-21
tags:
  - Azure ML
  - Machine Learning
  - MLOps
  - Build 2023
  - Microsoft

---

I wrote "Azure Machine Learning Updates at Build 2023" to share practical, production-minded guidance on this topic.

## Key Announcements

Build 2023 brought several Azure ML enhancements:

1. **Managed Feature Store GA**
2. **Model Catalog Expansion**
3. **Responsible AI Dashboard Updates**
4. **MLOps Improvements**
5. **Prompt Flow Integration**

## Managed Feature Store

The Azure ML Managed Feature Store is now generally available:

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import FeatureStore, FeatureStoreEntity, FeatureSet
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-sub",
    resource_group_name="your-rg"
)

# Create feature store
feature_store = FeatureStore(
    name="customer-features",
    location="eastus",
    compute_runtime=ComputeRuntime(spark_runtime_version="3.3")
)
ml_client.feature_stores.begin_create_or_update(feature_store).result()

# Define feature entity
customer_entity = FeatureStoreEntity(
    name="customer",
    version="1",
    index_columns=[{"name": "customer_id", "type": "string"}],
    stage="Development"
)
ml_client.feature_store_entities.begin_create_or_update(
    name="customer-features",
    entity=customer_entity
).result()
```

### Creating Feature Sets

```python
from azure.ai.ml.entities import FeatureSet, FeatureSetSpecification

# Define feature set from transformation code
customer_feature_set = FeatureSet(
    name="customer_transactions",
    version="1",
    entities=[customer_entity],
    specification=FeatureSetSpecification(path="./feature_transformation.py"),
    stage="Development"
)

# Register feature set
ml_client.feature_sets.begin_create_or_update(
    feature_store_name="customer-features",
    featureset=customer_feature_set
).result()
```

```python
# feature_transformation.py
from pyspark.sql import DataFrame
from pyspark.sql.functions import col, sum as spark_sum, count, avg

def transform(df: DataFrame) -> DataFrame:
    """Transform raw transactions into features"""

    features = df.groupBy("customer_id").agg(
        count("transaction_id").alias("transaction_count"),
        spark_sum("amount").alias("total_spend"),
        avg("amount").alias("avg_transaction_value"),
        spark_sum(
            when(col("category") == "electronics", col("amount")).otherwise(0)
        ).alias("electronics_spend")
    )

    return features
```

### Using Features in Training

```python
from azure.ai.ml.entities import FeatureRetrievalSpecification

# Define feature retrieval for training
feature_retrieval = FeatureRetrievalSpecification(
    feature_store_name="customer-features",
    feature_sets=[
        FeatureSetReference(
            name="customer_transactions",
            version="1",
            features=["transaction_count", "total_spend", "avg_transaction_value"]
        ),
        FeatureSetReference(
            name="customer_demographics",
            version="1",
            features=["age_group", "region"]
        )
    ]
)

# Use in training job
training_job = command(
    code="./src",
    command="python train.py --data ${{inputs.training_data}}",
    inputs={
        "training_data": Input(
            type="uri_file",
            path="azureml://datastores/default/paths/training/data.csv"
        )
    },
    feature_retrieval_spec=feature_retrieval,
    environment="AzureML-sklearn-1.0@latest",
    compute="cpu-cluster"
)
```

## Model Catalog

Access foundation models from various providers:

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Model

ml_client = MLClient.from_config()

# Browse available models
models = ml_client.models.list(registry_name="azure-openai")
for model in models:
    print(f"{model.name}: {model.description}")

# Get specific model
llama_model = ml_client.models.get(
    name="llama-2-7b",
    version="1",
    registry_name="huggingface"
)
print(f"Model: {llama_model.name}")
print(f"Tags: {llama_model.tags}")
```

### Deploy Model from Catalog

```python
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="llama-endpoint",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Deploy model from registry
deployment = ManagedOnlineDeployment(
    name="llama-deployment",
    endpoint_name="llama-endpoint",
    model="azureml://registries/huggingface/models/llama-2-7b/versions/1",
    instance_type="Standard_NC24s_v3",  # GPU instance
    instance_count=1,
    environment_variables={
        "MODEL_NAME": "llama-2-7b",
        "MAX_TOKENS": "2048"
    }
)
ml_client.online_deployments.begin_create_or_update(deployment).result()
```

## Responsible AI Dashboard

Enhanced RAI capabilities for model transparency:

```python
from azure.ai.ml import Input
from azure.ai.ml.entities import RAIJob

# Create RAI analysis job
rai_job = RAIJob(
    name="model-rai-analysis",
    model=Input(type="mlflow_model", path="azureml:churn-model:1"),
    train_dataset=Input(type="mltable", path="azureml:train-data:1"),
    test_dataset=Input(type="mltable", path="azureml:test-data:1"),
    target_column_name="churn",
    task_type="classification",
    components=[
        "error_analysis",
        "explanation",
        "causal_analysis",
        "counterfactual_analysis"
    ]
)

# Submit job
ml_client.jobs.create_or_update(rai_job)
```

### RAI Insights

```python
from raiwidgets import ResponsibleAIDashboard
from responsibleai import RAIInsights

# Load model and data
model = mlflow.sklearn.load_model("models:/churn-model/1")
train_data = pd.read_csv("train.csv")
test_data = pd.read_csv("test.csv")

# Create RAI insights
rai_insights = RAIInsights(
    model=model,
    train=train_data,
    test=test_data,
    target_column="churn",
    task_type="classification"
)

# Add components
rai_insights.error_analysis.add()
rai_insights.explainer.add()
rai_insights.causal.add(treatment_features=["marketing_spend", "customer_support_calls"])
rai_insights.counterfactual.add(total_CFs=10, desired_class="opposite")

# Compute
rai_insights.compute()

# View dashboard
ResponsibleAIDashboard(rai_insights)
```

## MLOps Improvements

### Model Registry Enhancements

```python
from azure.ai.ml.entities import Model
from azure.ai.ml.constants import AssetTypes

# Register model with lineage
model = Model(
    name="churn-prediction",
    version="2",
    path="outputs/model",
    type=AssetTypes.MLFLOW_MODEL,
    description="Customer churn prediction model",
    tags={
        "algorithm": "xgboost",
        "dataset_version": "v3",
        "accuracy": "0.92"
    },
    properties={
        "training_job": "azureml:training-job-abc123",
        "data_used": "azureml:customer-data:v3"
    }
)

registered_model = ml_client.models.create_or_update(model)
print(f"Registered: {registered_model.name}:{registered_model.version}")
```

### Pipeline Improvements

```python
from azure.ai.ml import dsl, Input, Output
from azure.ai.ml.entities import Pipeline

@dsl.pipeline(
    name="training_pipeline",
    description="End-to-end training pipeline with MLOps best practices"
)
def training_pipeline(
    raw_data: Input,
    model_name: str = "churn-model"
):
    # Data preparation
    prep_step = data_prep_component(
        raw_data=raw_data
    )

    # Feature engineering
    feature_step = feature_engineering_component(
        input_data=prep_step.outputs.processed_data
    )

    # Training with hyperparameter tuning
    train_step = train_component(
        training_data=feature_step.outputs.features
    )

    # Evaluation
    eval_step = evaluate_component(
        model=train_step.outputs.model,
        test_data=feature_step.outputs.test_features
    )

    # Conditional registration
    register_step = register_component(
        model=train_step.outputs.model,
        metrics=eval_step.outputs.metrics,
        model_name=model_name,
        register_condition="accuracy > 0.90"
    )

    return {
        "model": train_step.outputs.model,
        "metrics": eval_step.outputs.metrics
    }

# Build and submit pipeline
pipeline = training_pipeline(
    raw_data=Input(type="uri_file", path="azureml:customer-data:latest")
)
pipeline_job = ml_client.jobs.create_or_update(pipeline)
```

### Deployment Pipelines

```python
from azure.ai.ml.entities import BatchEndpoint, BatchDeployment

# Create batch endpoint
batch_endpoint = BatchEndpoint(
    name="churn-batch-endpoint",
    description="Batch scoring endpoint for churn prediction"
)
ml_client.batch_endpoints.begin_create_or_update(batch_endpoint).result()

# Create batch deployment
batch_deployment = BatchDeployment(
    name="churn-batch-v1",
    endpoint_name="churn-batch-endpoint",
    model="azureml:churn-prediction:2",
    compute="cpu-cluster",
    instance_count=2,
    max_concurrency_per_instance=2,
    mini_batch_size=10,
    output_action="append_row",
    output_file_name="predictions.csv"
)
ml_client.batch_deployments.begin_create_or_update(batch_deployment).result()
```

Azure ML continues to evolve as a comprehensive platform for both traditional ML and GenAI workloads. Tomorrow, I will cover Responsible AI improvements in more detail.

## Resources

- [Azure ML Documentation](https://learn.microsoft.com/en-us/azure/machine-learning/)
- [Feature Store](https://learn.microsoft.com/en-us/azure/machine-learning/concept-feature-store)
- [Model Catalog](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-catalog)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
