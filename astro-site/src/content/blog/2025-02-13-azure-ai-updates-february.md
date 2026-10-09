---
title: "Azure AI Updates: What's New in February 2025"
description: "Stay current with Azure AI updates to leverage the latest capabilities for your data and AI applications."
author: Michael John Peña
draft: false
date: 2025-02-13
tags:
  - Azure
  - AI
  - Azure OpenAI
  - Updates
  - What's New
---

## Azure OpenAI Service Updates

### New Model Deployments

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2025-02-01",  # New API version
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

# GPT-4o improvements
response = client.chat.completions.create(
    model="gpt-4o-2025-02",  # February 2025 snapshot
    messages=[{"role": "user", "content": "Analyze this data..."}],
    # New parameters
    reasoning_effort="medium",  # Control reasoning depth
    response_format={"type": "json_schema", "schema": my_schema}  # Structured output
)

# o3-mini now available
response = client.chat.completions.create(
    model="o3-mini",  # Smaller reasoning model
    messages=[{"role": "user", "content": "Solve this problem..."}],
    max_completion_tokens=4000
)
```

### Improved Batch API

```python
from openai import AzureOpenAI

client = AzureOpenAI(...)

# New batch API with better monitoring
batch = client.batches.create(
    input_file_id="file-abc123",
    endpoint="/v1/chat/completions",
    completion_window="24h",
    metadata={
        "project": "customer_analysis",
        "owner": "data_team"
    }
)

# Check status with detailed progress
status = client.batches.retrieve(batch.id)
print(f"Completed: {status.request_counts.completed}/{status.request_counts.total}")
print(f"Failed: {status.request_counts.failed}")
print(f"Estimated completion: {status.estimated_completion_time}")
```

## Azure AI Foundry Enhancements

### New Agent Capabilities

```python
from azure.ai.foundry.agents import Agent, Tool, AgentRuntime

# Enhanced tool calling
agent = Agent(
    name="DataAnalyst",
    model="gpt-4o",
    instructions="You are a data analyst...",
    tools=[
        Tool.from_function(query_database),
        Tool.from_function(create_visualization),
        # New: Code execution tool
        Tool.code_interpreter(
            languages=["python", "sql"],
            timeout_seconds=30
        ),
        # New: File operations
        Tool.file_operations(
            allowed_operations=["read", "write"],
            sandbox_path="/workspace"
        )
    ],
    # New: Memory configuration
    memory_config={
        "type": "conversation",
        "max_tokens": 10000,
        "persistence": "session"
    }
)

# Run with streaming
async for event in agent.stream("Analyze sales trends"):
    if event.type == "tool_call":
        print(f"Calling: {event.tool_name}")
    elif event.type == "message":
        print(event.content, end="")
```

### Improved Evaluation

```python
from azure.ai.foundry.evaluation import Evaluator, MetricSet

evaluator = Evaluator(client)

# New built-in metrics
results = evaluator.evaluate(
    model="gpt-4o",
    test_cases=test_data,
    metrics=MetricSet.RAG_QUALITY,  # Pre-defined metric set
    custom_metrics=[
        {
            "name": "domain_accuracy",
            "prompt": "Is the response technically accurate? Score 1-5.",
            "threshold": 4.0
        }
    ],
    # New: Comparative evaluation
    compare_to="gpt-4o-2024-11"  # Compare against previous version
)

print(f"New model: {results.new_model_score}")
print(f"Baseline: {results.baseline_score}")
print(f"Improvement: {results.relative_improvement}%")
```

## Azure AI Search Updates

### Enhanced Vector Search

```python
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    ScalarQuantizationCompression  # New
)

# New: Quantized vectors for cost savings
index = SearchIndex(
    name="documents",
    fields=[
        SearchField(name="content_vector", type="Collection(Edm.Single)",
                   vector_search_dimensions=1536,
                   vector_search_profile_name="my-profile")
    ],
    vector_search=VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
        profiles=[...],
        # New: Vector compression
        compressions=[
            ScalarQuantizationCompression(
                name="sq-compression",
                quantized_data_type="int8",  # 4x storage savings
                rescoring_method="original_vectors"
            )
        ]
    )
)
```

### Semantic Ranker Improvements

```python
# New semantic configuration options
from azure.search.documents.models import QueryType, QueryCaptionType

results = client.search(
    search_text="data lakehouse architecture",
    query_type=QueryType.SEMANTIC,
    semantic_configuration_name="default",
    # New: Improved caption extraction
    query_caption=QueryCaptionType.EXTRACTIVE,
    query_caption_highlight_enabled=True,
    # New: Answer extraction
    query_answer="extractive",
    query_answer_count=3,
    # New: Personalization
    scoring_profile="user_preferences",
    scoring_parameters=["userSegment-enterprise"]
)

for result in results:
    print(f"Answer: {result.get('@search.answers', [])}")
    print(f"Captions: {result.get('@search.captions', [])}")
```

## Microsoft Fabric AI Updates

### Copilot for All SKUs

```python
# Copilot now available on all Fabric SKUs (was F64+ only)

# In Fabric notebooks
# %copilot
# "Create a pipeline to load data from Azure SQL to lakehouse"

# Generates complete code with:
# - Connection setup
# - Schema inference
# - Incremental load logic
# - Error handling
```

### Real-Time Intelligence GA Features

```kusto
// New KQL functions for AI
.create-or-alter function AnalyzeWithAI(text: string) {
    // Built-in AI analysis
    let result = ai_analyze(text, "sentiment,entities,summary");
    print Sentiment=result.sentiment, Entities=result.entities, Summary=result.summary
}

// Use in queries
events
| extend analysis = AnalyzeWithAI(description)
| where analysis.Sentiment == "negative"
```

## Azure Machine Learning Updates

### Managed Feature Store GA

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import FeatureStore, FeatureSet

ml_client = MLClient(...)

# Create feature store
feature_store = FeatureStore(
    name="customer-features",
    # New: Built-in monitoring
    monitoring={
        "drift_detection": True,
        "alert_threshold": 0.1
    }
)

# Register feature set
feature_set = FeatureSet(
    name="customer_behavior",
    entities=["customer_id"],
    features=[
        {"name": "total_purchases", "type": "float"},
        {"name": "avg_order_value", "type": "float"},
        {"name": "days_since_last_purchase", "type": "int"}
    ],
    # New: Automatic refresh
    refresh_schedule="0 */4 * * *",  # Every 4 hours
    source={
        "type": "spark_sql",
        "query": "SELECT ... FROM lakehouse.gold_customers"
    }
)
```

## What to Prepare For

1. **Test new API versions**: Update your code for 2025-02-01 API
2. **Evaluate new models**: o3-mini may suit some workloads better
3. **Consider vector compression**: Significant cost savings possible
4. **Enable new monitoring**: Better observability for AI workloads
5. **Update SDKs**: New features require latest SDK versions

Stay current with Azure AI updates to leverage the latest capabilities for your data and AI applications.
