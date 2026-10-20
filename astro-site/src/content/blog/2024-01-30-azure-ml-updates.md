---
title: "Azure ML in Early 2024: What Went GA at Ignite and What to Adopt"
description: "Feature store, serverless compute, prompt flow and the model catalog went GA in Azure ML in November 2023. Here's what to adopt now and what to hold off on."
author: Michael John Peña
draft: false
date: 2024-01-30
tags:
  - Azure Machine Learning
  - MLOps
  - Feature Store
  - Prompt Flow
  - Azure
---

At Ignite in November 2023, Azure Machine Learning moved several of the previews announced at [Build 2023](/blog/2023-05-21-azure-ml-updates-build-2023/) to general availability in one go: the managed feature store, serverless compute for training, prompt flow, and the model catalog. Two months later, the question I care about isn't "what's new". It's which of these belong in a production platform design today, and which are still worth watching from a distance. GA means you get an SLA and support. It doesn't mean every feature fits your team.

## What's GA and what's still preview

Here's the status as of late January 2024, based on the Ignite 2023 announcements:

| Capability | Status (Jan 2024) | My take |
|---|---|---|
| Managed feature store | GA (Nov 2023); online store is preview | Adopt when you have more than one model sharing features |
| Serverless compute for jobs | GA (Nov 2023) | Default for most training jobs |
| Prompt flow | GA (Nov 2023) | Use for LLM apps that need evaluation, not just a chat call |
| Model catalog | GA (Nov 2023) | Good for open models on managed online endpoints |
| Models as a Service (Llama 2 pay-as-you-go APIs) | Public preview | Prototype only |
| Model monitoring | Public preview | Pilot it; GA hasn't been announced yet |

The SDK side has caught up too. `azure-ai-ml` 1.12.x shipped alongside Ignite and 1.13.0 landed on PyPI on 29 January. The feature store client library `azureml-featurestore` reached 1.0.0 on 14 November 2023, which is the clearest signal that its API is now stable enough to build on.

## Managed feature store: worth it, with conditions

I wrote about [feature store concepts](/blog/2021-09-05-feature-stores-concepts/) back in 2021. The argument hasn't changed: once two or more models use the same features, you need one definition, one computation, and point-in-time correct joins. Otherwise the training and serving versions of the same feature drift apart, and the first symptom is a model that scores worse in production than it did in validation.

What Azure ML's [managed feature store](https://learn.microsoft.com/en-us/azure/machine-learning/concept-what-is-managed-feature-store) adds is that it's a special kind of workspace. Feature sets, entities and materialisation jobs are versioned assets with RBAC, and they can be shared across project workspaces. Materialisation runs on serverless Spark, writes to an offline store in ADLS Gen2, and, in preview, to an online store (Azure Cache for Redis) for low-latency lookups.

The model has three parts:

- **Entity**: the join key, for example `customer_id`.
- **Feature set spec**: a YAML file describing the source, the transformation code, the features and the lookback windows. You generate it with the `azureml-featurestore` package.
- **Feature set**: the registered, versioned asset that points at the spec and the entities.

Here's a minimal registration flow. It creates the feature store, an entity and a feature set built from a Parquet source. Run it with `azure-ai-ml` 1.12 or later and `azureml-featurestore` 1.0.x installed.

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    DataColumn,
    DataColumnType,
    FeatureSet,
    FeatureSetSpecification,
    FeatureStore,
    FeatureStoreEntity,
)
from azure.identity import DefaultAzureCredential
from azureml.featurestore import create_feature_set_spec
from azureml.featurestore.contracts import Column, ColumnType, DateTimeOffset, TimestampColumn
from azureml.featurestore.contracts.feature import Feature
from azureml.featurestore.feature_source import ParquetFeatureSource

subscription_id = "<your-subscription-id>"
resource_group = "<your-resource-group>"
feature_store_name = "<your-feature-store-name>"
credential = DefaultAzureCredential()

# 1. Create the feature store (a workspace of kind "featurestore")
rg_client = MLClient(credential, subscription_id, resource_group)
rg_client.feature_stores.begin_create(
    FeatureStore(name=feature_store_name, location="australiaeast")
).result()

fs_client = MLClient(credential, subscription_id, resource_group, feature_store_name)

# 2. Register the entity (the join key)
fs_client.feature_store_entities.begin_create_or_update(
    FeatureStoreEntity(
        name="customer",
        version="1",
        index_columns=[DataColumn(name="customer_id", type=DataColumnType.STRING)],
    )
).result()

# 3. Generate the feature set spec and write it to a local folder.
# No transformation: the source already contains these aggregated columns.
# Add feature_transformation=TransformationCode(...) to compute rolling
# aggregates with a Spark transformer instead.
spec = create_feature_set_spec(
    source=ParquetFeatureSource(
        path="abfss://<container>@<storage-account>.dfs.core.windows.net/customer_daily/*.parquet",
        timestamp_column=TimestampColumn(name="snapshot_ts"),
    ),
    index_columns=[Column(name="customer_id", type=ColumnType.STRING)],
    features=[
        Feature(name="total_purchases_30d", type=ColumnType.DOUBLE),
        Feature(name="days_since_last_purchase", type=ColumnType.INTEGER),
    ],
    source_lookback=DateTimeOffset(days=30),
    temporal_join_lookback=DateTimeOffset(days=2),
)
spec.dump("./featuresets/customer_activity/spec", overwrite=True)

# 4. Register the feature set against the spec and entity
fs_client.feature_sets.begin_create_or_update(
    FeatureSet(
        name="customer_activity",
        version="1",
        entities=["azureml:customer:1"],
        specification=FeatureSetSpecification(path="./featuresets/customer_activity/spec"),
        description="30-day purchase activity per customer",
    )
).result()
```

That's registration only. To use the feature set for training or scoring, you also need to configure an offline store, grant the materialisation identity access, and set a materialisation schedule. The feature store tutorials in the docs walk through those steps, and they're where most of the setup effort sits.

**When not to use it:** if you have one model, one team, and your features already live in well-modelled tables in a lakehouse, a feature store adds a workspace, a managed identity, Spark materialisation costs and another asset lifecycle to manage. If you're on Databricks, use its feature store instead: it sits next to your Delta tables and Unity Catalog lineage, while Azure ML's version gives you RBAC-scoped sharing across Azure ML workspaces and materialisation you don't schedule yourself. Pick the one that lives where your training jobs run, because running two feature stores across two platforms is the worst outcome. The transformation code has to be PySpark, so teams that work only in pandas will feel the friction, and the online store is still preview, so don't build a low-latency serving path on it yet.

## Serverless compute: make it the default

Until it went GA in November, most production training jobs ran on a compute cluster that someone had created, sized, given a VNet, and set a minimum node count on (ideally zero, so idle nodes don't bill). [Serverless compute](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-use-serverless-compute) removes that step. Leave out `compute` on a job, specify an instance type, and Azure ML provisions and tears down the nodes for you.

```python
from azure.ai.ml import MLClient, command
from azure.ai.ml.entities import JobResourceConfiguration, QueueSettings, UserIdentityConfiguration
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    DefaultAzureCredential(),
    "<your-subscription-id>",
    "<your-resource-group>",
    "<your-workspace-name>",
)

job = command(
    code="./src",
    command="python train.py --learning-rate 0.01",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    identity=UserIdentityConfiguration(),
    display_name="churn-train-serverless",
    experiment_name="churn",
)
# No compute target: the job runs on serverless compute
job.resources = JobResourceConfiguration(instance_type="Standard_E4s_v3", instance_count=1)
job.queue_settings = QueueSettings(job_tier="standard")

returned_job = ml_client.jobs.create_or_update(job)
print(returned_job.studio_url)
```

I'd make this the default for experimentation and scheduled retraining. You pay only while the job runs, it draws on the same VM quota as your clusters, and there's no idle cluster to forget about. Workspaces with managed network isolation can also run serverless jobs without a custom VNet setup.

Serverless jobs can use spot VMs too: set `QueueSettings(job_tier="spot")`.

**When to keep dedicated clusters:** if you rely on reserved capacity pinned to a cluster, need nodes that stay warm across a burst of short jobs, or have a platform team that enforces SKUs per cluster through Azure Policy. Serverless also makes it a little harder to see which team spent what, so add tags to jobs from day one.

## Prompt flow: GA, but know what you're signing up for

[Prompt flow](https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/overview-what-is-prompt-flow) is now GA in Azure ML, and the open-source `promptflow` package reached 1.0 in November 2023. A flow is a DAG of LLM, prompt and Python nodes defined in `flow.dag.yaml`. You can author it in VS Code, run it locally with the `pf` CLI, then push it to the workspace for bulk runs, evaluation flows and deployment to a managed online endpoint.

The value isn't the visual editor. It's the evaluation loop. You can run a flow against a few hundred test questions, score groundedness and relevance with an evaluation flow, and compare variants of a prompt side by side. That's the step most retrieval-augmented generation (RAG) prototypes skip, and it's why they disappoint in production.

What I'd watch:

- **Two homes for the same thing.** Prompt flow also appears in Azure AI Studio, which is still in [public preview](/blog/2023-11-18-azure-ai-studio-updates/). If you're building a new generative AI app on Azure OpenAI, decide now which hub your team will standardise on. Today, Azure ML is the GA option.
- **The SDK moves fast.** `promptflow` went from 1.0 to 1.4 between November and January. Pin versions in your flow's `requirements.txt` and in CI.
- **Not every LLM app needs it.** If your app is a single chat completion call with a system prompt, a flow is overhead. Prompt flow earns its place when there's retrieval, branching or tool calls to evaluate.

## Model catalog and Models as a Service

The [model catalog](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-use-foundation-models) is GA. It's where you browse curated open models (Llama 2, Falcon, Hugging Face models and others) and deploy them to managed online endpoints on your own GPU quota. I covered the catalog in more detail in [a November post](/blog/2023-11-19-azure-model-catalog/).

The bigger change is Models as a Service, announced at Ignite in public preview. It offers Llama 2 as pay-as-you-go inference and fine-tuning APIs billed per token, so you don't need GPU quota. That changes the cost model for open models, but it's preview, region-limited and billed through the Azure Marketplace, so I'd keep it to prototypes for now. For production, either self-host on a managed online endpoint or use Azure OpenAI. Self-hosting wins when you need an open model, strict data residency in a region Azure OpenAI doesn't serve, or private network isolation, and when traffic is steady enough that a GPU instance billed per hour costs less than the same volume billed per token. It loses when you can't get GPU quota or your traffic is spiky, because you pay for the node whether it's busy or not.

## Model monitoring: still preview, but pilot it

[Model monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring) for data drift, prediction drift, data quality and feature attribution drift is still in public preview, and GA hasn't been announced yet. It reads production inference data collected from managed online endpoints and compares it with a baseline, usually your training data. I'd set it up on one non-critical endpoint now so the baseline and alert thresholds are tuned by the time it's GA. Don't put an on-call rotation on top of it yet.

## How I'd sequence adoption

If I were updating an Azure ML platform design this quarter, this is the order I'd follow:

1. **Switch training to serverless compute** unless one of the dedicated-cluster reasons applies. It's low risk, easy to reverse and removes a whole category of idle-cost incidents.
2. **Standardise LLM work on prompt flow in Azure ML**, with evaluation flows as a release gate rather than an afterthought.
3. **Introduce the managed feature store only where features are shared**, starting with one entity and one feature set. Prove materialisation costs and the lookback settings before migrating anything else.
4. **Keep Models as a Service and model monitoring in the sandbox** until they reach GA, but get hands-on now so the move to production is a configuration change rather than a learning curve.

The common thread is that most of these features remove infrastructure you used to build yourself. My rule: adopt a feature only when it deletes infrastructure or code you currently own; otherwise wait for the next release cycle.
