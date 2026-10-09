---
title: "Microsoft Fabric and AI Integration: Complete Guide"
description: "Fabric + AI creates a powerful combination for intelligent analytics. Start with simple enrichments and build toward complex AI-powered workflows."
author: Michael John Peña
draft: false
date: 2025-02-03
tags:
  - Microsoft Fabric
  - AI
  - Azure
  - Data Platform
  - Integration
---

## Integration Architecture

```
                        ┌─────────────────────────────────────┐
                        │         Microsoft Fabric            │
                        │                                     │
┌──────────────┐       │  ┌──────────┐    ┌──────────────┐  │       ┌─────────────────┐
│ Azure AI     │◄──────┼──│ Notebooks│    │ Dataflows    │  │──────►│ Power BI        │
│ Foundry      │       │  └──────────┘    └──────────────┘  │       │ Copilot         │
│              │       │         │              │           │       └─────────────────┘
│ - GPT-4o     │       │         ▼              ▼           │
│ - Embeddings │       │  ┌──────────────────────────────┐  │       ┌─────────────────┐
│ - Agents     │◄──────┼──│       OneLake               │  │──────►│ AI Skills       │
└──────────────┘       │  │   (Lakehouse/Warehouse)      │  │       │ (Custom)        │
                       │  └──────────────────────────────┘  │       └─────────────────┘
                       │                                     │
                       └─────────────────────────────────────┘
```

## Calling Azure OpenAI from Fabric Notebooks

```python
# In a Fabric Spark notebook

from synapse.ml.cognitive import OpenAICompletion
from pyspark.sql import functions as F

# Configure OpenAI
openai_completion = (OpenAICompletion()
    .setSubscriptionKey(openai_key)
    .setDeploymentName("gpt-4o")
    .setCustomServiceName("my-aoai")
    .setPromptCol("prompt")
    .setOutputCol("response")
    .setMaxTokens(500)
)

# Prepare data with prompts
df_with_prompts = df.withColumn(
    "prompt",
    F.concat(
        F.lit("Summarize this customer feedback: "),
        F.col("feedback_text")
    )
)

# Generate summaries at scale
df_with_summaries = openai_completion.transform(df_with_prompts)

# Extract just the response text
df_result = df_with_summaries.withColumn(
    "summary",
    F.col("response.choices")[0]["text"]
)

# Write to lakehouse
df_result.write.mode("overwrite").saveAsTable("lakehouse.feedback_summaries")
```

## Embeddings for Semantic Search

```python
from synapse.ml.cognitive import OpenAIEmbedding

# Configure embedding model
embedding = (OpenAIEmbedding()
    .setSubscriptionKey(openai_key)
    .setDeploymentName("text-embedding-3-large")
    .setCustomServiceName("my-aoai")
    .setTextCol("content")
    .setOutputCol("embedding")
)

# Generate embeddings for documents
df_docs = spark.read.table("lakehouse.documents")
df_with_embeddings = embedding.transform(df_docs)

# Save to Delta table (vectors stored as arrays)
df_with_embeddings.write.mode("overwrite").saveAsTable("lakehouse.document_embeddings")

# Search function
def semantic_search(query: str, top_k: int = 5):
    # Get query embedding
    query_df = spark.createDataFrame([(query,)], ["content"])
    query_embedding = embedding.transform(query_df).collect()[0]["embedding"]

    # Search using cosine similarity (simplified)
    from pyspark.ml.linalg import Vectors
    import numpy as np

    def cosine_similarity(v1, v2):
        return float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2)))

    cosine_udf = F.udf(lambda v: cosine_similarity(query_embedding, v), FloatType())

    results = (df_with_embeddings
        .withColumn("similarity", cosine_udf(F.col("embedding")))
        .orderBy(F.desc("similarity"))
        .limit(top_k))

    return results
```

## AI Skills in Dataflows Gen2

```python
# Dataflow Gen2 with AI enrichment
# In Power Query M

let
    Source = Lakehouse.Contents("lakehouse")[Data]{[Schema="dbo",Item="customers"]}[Data],

    // Call Azure AI for sentiment analysis
    AddSentiment = Table.AddColumn(Source, "Sentiment", each
        let
            response = Web.Contents(
                "https://my-aoai.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions",
                [
                    Headers = [
                        #"Content-Type" = "application/json",
                        #"api-key" = openai_key
                    ],
                    Content = Json.FromValue([
                        messages = {
                            [role = "user", content = "Rate sentiment as positive/neutral/negative: " & [feedback]]
                        }
                    ])
                ]
            ),
            json = Json.Document(response)
        in
            json[choices]{0}[message][content]
    ),

    // Type the new column
    TypedSentiment = Table.TransformColumnTypes(AddSentiment, {{"Sentiment", type text}})
in
    TypedSentiment
```

## Fabric Real-Time Intelligence with AI

```kusto
// In KQL Database - Anomaly detection with AI assistance

// Store embeddings in KQL
.create table document_vectors (
    doc_id: string,
    content: string,
    embedding: dynamic,
    timestamp: datetime
)

// Vector search function
.create-or-alter function VectorSearch(query_embedding: dynamic, top_k: int = 5) {
    document_vectors
    | extend similarity = series_cosine_similarity(embedding, query_embedding)
    | top top_k by similarity desc
    | project doc_id, content, similarity
}

// Anomaly detection with ML
.create-or-alter function DetectAnomalies(metric_name: string, lookback: timespan = 24h) {
    metrics_table
    | where name == metric_name and timestamp > ago(lookback)
    | make-series value = avg(value) on timestamp step 1m
    | extend anomalies = series_decompose_anomalies(value)
    | mv-expand timestamp, value, anomalies
    | where anomalies != 0
    | project timestamp, value, anomaly_score = anomalies
}
```

## Copilot Integration Patterns

### Custom Copilot Skills

```python
# Custom data quality skill using PySpark and Azure OpenAI

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from openai import AzureOpenAI
import json

spark = SparkSession.builder.getOrCreate()

# Azure OpenAI client
aoai_client = AzureOpenAI(
    azure_endpoint="https://your-aoai.openai.azure.com/",
    api_version="2024-02-01"
)

def run_quality_checks(df) -> dict:
    """Run data quality checks on a DataFrame."""
    total_rows = df.count()
    null_counts = {col: df.filter(F.col(col).isNull()).count() for col in df.columns}
    duplicate_count = total_rows - df.dropDuplicates().count()

    issues = []
    for col, null_count in null_counts.items():
        if null_count > 0:
            issues.append(f"Column '{col}' has {null_count} null values ({null_count/total_rows*100:.1f}%)")

    if duplicate_count > 0:
        issues.append(f"Table has {duplicate_count} duplicate rows")

    score = 100 - (len(issues) * 10)  # Simple scoring
    return {"score": max(score, 0), "issues": issues, "total_rows": total_rows}

def generate_recommendations(report: dict) -> list:
    """Generate AI-powered recommendations for data quality issues."""
    response = aoai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": f"Given this data quality report, suggest improvements as a JSON array of strings: {json.dumps(report)}"
        }]
    )
    try:
        return json.loads(response.choices[0].message.content)
    except json.JSONDecodeError:
        return [response.choices[0].message.content]

def data_quality_check(table_name: str) -> dict:
    """Check data quality for a table and provide recommendations."""
    df = spark.read.table(f"lakehouse.{table_name}")

    # Run quality checks
    quality_report = run_quality_checks(df)

    # Generate AI recommendations
    recommendations = generate_recommendations(quality_report)

    return {
        "message": f"Data quality check complete for {table_name}",
        "quality_score": quality_report["score"],
        "issues": quality_report["issues"],
        "recommendations": recommendations
    }

# Use the skill
result = data_quality_check("gold_customer_360")
print(f"Quality Score: {result['quality_score']}")
print(f"Issues: {result['issues']}")
print(f"Recommendations: {result['recommendations']}")
```

### Semantic Model AI Queries

```python
# Query Power BI semantic model with natural language using Semantic Link + Azure OpenAI

import sempy.fabric as fabric
from openai import AzureOpenAI

# Azure OpenAI client for natural language to DAX translation
aoai_client = AzureOpenAI(
    azure_endpoint="https://your-aoai.openai.azure.com/",
    api_version="2024-02-01"
)

def query_semantic_model_with_nl(workspace: str, dataset: str, question: str) -> dict:
    """Query a Power BI semantic model using natural language."""

    # Get model metadata using Semantic Link
    tables = fabric.list_tables(dataset=dataset, workspace=workspace)
    measures = fabric.list_measures(dataset=dataset, workspace=workspace)

    # Generate DAX using Azure OpenAI
    response = aoai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": f"""Generate a DAX query for the following semantic model.
            Tables: {tables['Name'].tolist()}
            Measures: {measures[['Name', 'Expression']].to_dict('records')}
            Return only the DAX query, no explanations."""
        }, {
            "role": "user",
            "content": question
        }]
    )

    dax_query = response.choices[0].message.content.strip()

    # Execute DAX query using Semantic Link
    results = fabric.evaluate_dax(
        dataset=dataset,
        dax_string=dax_query,
        workspace=workspace
    )

    return {
        "dax_query": dax_query,
        "data": results.to_dict()
    }

# Natural language query
result = query_semantic_model_with_nl(
    workspace="Sales",
    dataset="SalesModel",
    question="What were the top 5 products by revenue last quarter?"
)

print(result["dax_query"])  # Shows the generated DAX
print(result["data"])       # The actual results
```

## End-to-End AI Pipeline in Fabric

```python
# Complete AI pipeline using Fabric notebooks

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

# 1. Read raw data from lakehouse
raw_df = spark.read.table("lakehouse.raw_customer_feedback")

# 2. Generate embeddings
embedding_transformer = OpenAIEmbedding()...
df_with_embeddings = embedding_transformer.transform(raw_df)

# 3. Classify feedback
classifier = OpenAICompletion()...
df_classified = classifier.transform(df_with_embeddings)

# 4. Generate insights with AI
insights_generator = OpenAICompletion()
    .setSystemPrompt("You are a customer insights analyst...")
    ...

# Process in batches for summary insights
summaries = []
for category in df_classified.select("category").distinct().collect():
    category_data = df_classified.filter(F.col("category") == category.category)
    summary = insights_generator.transform(
        category_data.select(
            F.concat_ws("\n", F.collect_list("feedback")).alias("prompt")
        )
    )
    summaries.append(summary)

# 5. Write results to gold layer
df_classified.write.mode("overwrite").saveAsTable("lakehouse.gold_feedback_classified")
spark.createDataFrame(summaries).write.mode("overwrite").saveAsTable("lakehouse.gold_feedback_insights")

# 6. Refresh Power BI dataset via REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://analysis.windows.net/powerbi/api/.default").token
pbi_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Get workspace and dataset IDs
workspace_name = "Analytics"
dataset_name = "CustomerInsights"

# List workspaces to get ID
ws_response = requests.get(
    "https://api.powerbi.com/v1.0/myorg/groups",
    headers=pbi_headers
)
workspace_id = next(w["id"] for w in ws_response.json()["value"] if w["name"] == workspace_name)

# List datasets to get ID
ds_response = requests.get(
    f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/datasets",
    headers=pbi_headers
)
dataset_id = next(d["id"] for d in ds_response.json()["value"] if d["name"] == dataset_name)

# Trigger refresh
refresh_response = requests.post(
    f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/datasets/{dataset_id}/refreshes",
    headers=pbi_headers
)
print(f"Refresh triggered: {refresh_response.status_code}")
```

## Best Practices

1. **Use Fabric's built-in connectors**: Leverage SynapseML for OpenAI integration
2. **Cache embeddings**: Store vectors in Delta tables for reuse
3. **Batch processing**: Group AI calls for efficiency
4. **Monitor costs**: Track AI token usage in Fabric
5. **Security**: Use managed identity for AI service authentication

Fabric + AI creates a powerful combination for intelligent analytics. Start with simple enrichments and build toward complex AI-powered workflows.
