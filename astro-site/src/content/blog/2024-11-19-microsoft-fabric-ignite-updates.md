---
title: "Microsoft Fabric at Ignite 2024: What's New for Data Professionals"
description: "The Fabric platform continues to mature into a comprehensive, AI-native analytics solution."
author: Michael John Peña
draft: false
date: 2024-11-19
tags:
  - Azure
  - Microsoft Fabric
  - Data Engineering
  - Ignite 2024
  - Analytics
---

## Major Announcements

### 1. Fabric AI Skills

AI Skills enable natural language interaction with your data:

```python
# AI Skills are configured through the Fabric portal and accessed via REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

workspace_id = "your-workspace-id"
ai_skill_id = "your-ai-skill-id"

# Query an AI Skill via REST API
query_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/aiskills/{ai_skill_id}/query"

query_payload = {
    "question": "What were our top products last quarter by region?"
}

response = requests.post(query_url, headers=headers, json=query_payload)
result = response.json()

print(result.get("answer"))
print(result.get("sqlQuery"))
print(result.get("data"))

# Note: AI Skills are created and configured in the Fabric portal UI,
# including data source connections, instructions, and allowed operations.
```

### 2. Analytics Agents

Pre-built agents for common analytics tasks:

```python
# Analytics capabilities in Fabric using Semantic Link and PySpark
import sempy.fabric as fabric
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.getOrCreate()

# Explore a dataset using PySpark
df = spark.read.format("delta").load("Tables/gold/sales_fact")

# Generate summary statistics
print("Dataset Summary:")
df.describe().show()

# Key metrics
metrics = df.agg(
    F.count("*").alias("row_count"),
    F.countDistinct("customer_id").alias("unique_customers"),
    F.sum("revenue").alias("total_revenue"),
    F.avg("revenue").alias("avg_revenue")
).collect()[0]

print(f"Total rows: {metrics['row_count']}")
print(f"Unique customers: {metrics['unique_customers']}")
print(f"Total revenue: ${metrics['total_revenue']:,.2f}")

# Simple anomaly detection using statistics
daily_revenue = spark.read.format("delta").load("Tables/gold/daily_revenue")

stats = daily_revenue.agg(
    F.avg("revenue").alias("mean"),
    F.stddev("revenue").alias("stddev")
).collect()[0]

mean_val, stddev_val = stats["mean"], stats["stddev"]
threshold = 2.5  # Z-score threshold

anomalies = daily_revenue.filter(
    F.abs(F.col("revenue") - mean_val) > (threshold * stddev_val)
).orderBy(F.desc("date"))

print("Detected anomalies:")
anomalies.show()
```

### 3. OneLake AI Workloads

Run AI workloads directly on OneLake data:

```python
# Access OneLake data and create embeddings using Azure OpenAI
from azure.identity import DefaultAzureCredential
from openai import AzureOpenAI
from pyspark.sql import SparkSession
import json

spark = SparkSession.builder.getOrCreate()

# Read documents from OneLake Files
docs_df = spark.read.text("Files/documents/*.txt")
documents = [row.value for row in docs_df.collect()]

# Create embeddings using Azure OpenAI
credential = DefaultAzureCredential()
token = credential.get_token("https://cognitiveservices.azure.com/.default").token

client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com",
    api_version="2024-02-01",
    azure_ad_token=token
)

embeddings = []
for i, doc in enumerate(documents):
    response = client.embeddings.create(
        model="text-embedding-3-large",
        input=doc
    )
    embeddings.append({
        "id": i,
        "text": doc,
        "embedding": response.data[0].embedding
    })

# Save embeddings to OneLake as JSON
embeddings_df = spark.createDataFrame(embeddings)
embeddings_df.write.mode("overwrite").json("Files/embeddings/")

print(f"Processed {len(embeddings)} documents")

# For vector search, use Azure AI Search or store in a vector-capable database
# integrated with Fabric (e.g., Azure Cosmos DB with vector search)
```

### 4. Fabric and Copilot Studio Integration

Build Copilot experiences connected to Fabric:

```python
# Copilot Studio integration is configured through the Power Platform portal
# For programmatic access to Fabric data from custom copilots, use REST APIs

from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

workspace_id = "your-workspace-id"

# List available artifacts that can be connected to Copilot Studio
artifacts_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items"
response = requests.get(artifacts_url, headers=headers)
items = response.json().get("value", [])

# Filter for lakehouses and semantic models
for item in items:
    if item["type"] in ["Lakehouse", "SemanticModel"]:
        print(f"Available for Copilot: {item['displayName']} ({item['type']})")

# Note: Copilot Studio configuration is done in the Power Platform portal:
# 1. Create a new copilot in Copilot Studio
# 2. Add a Fabric connector as a data source
# 3. Configure the lakehouse and semantic model connections
# 4. Define topics and conversation flows
# 5. Deploy to Teams or other channels

# For custom integrations, use Semantic Link to query data
import sempy.fabric as fabric

# Query semantic model for copilot responses
df = fabric.evaluate_dax(
    dataset="SalesModel",
    dax_string="EVALUATE SUMMARIZE(Sales, Sales[Region], 'Total', SUM(Sales[Amount]))"
)
```

### 5. Eventstream Enhancements

Enhanced real-time streaming capabilities:

```python
# Eventstreams are configured via Fabric portal or REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

workspace_id = "your-workspace-id"
base_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"

# Create an eventstream item
eventstream_payload = {
    "displayName": "RealTimeAnalytics",
    "type": "Eventstream",
    "description": "Real-time analytics with Event Hubs source"
}

response = requests.post(f"{base_url}/items", headers=headers, json=eventstream_payload)
eventstream = response.json()
print(f"Created Eventstream: {eventstream.get('id')}")

# Note: Eventstream configuration (sources, processors, destinations) is done
# through the Fabric portal UI or by updating the eventstream definition.
#
# Key capabilities available in the portal:
# - Source connectors: Event Hubs, Kafka, Custom endpoints
# - Processors: Filter, Aggregate, Transform, AI enrichment
# - Destinations: Lakehouse, KQL Database, Reflex triggers
#
# For AI enrichment in streaming, you can use Spark Structured Streaming:

from pyspark.sql import SparkSession
from pyspark.sql.functions import udf, col
from pyspark.sql.types import StringType

spark = SparkSession.builder.getOrCreate()

# Read from Event Hubs using Spark Structured Streaming
eh_conf = {
    "eventhubs.connectionString": "<connection-string>"
}

stream_df = spark.readStream \
    .format("eventhubs") \
    .options(**eh_conf) \
    .load()

# Write enriched events to Lakehouse Delta table
query = stream_df \
    .writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/events") \
    .toTable("enriched_events")
```

### 6. Real-Time AI Dashboards

Build AI-powered real-time dashboards:

```python
# Real-Time dashboards in Fabric use KQL queries and are configured via portal
# For programmatic dashboard creation, use the Fabric REST API

from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

workspace_id = "your-workspace-id"
base_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"

# Create a Real-Time Dashboard item
dashboard_payload = {
    "displayName": "Operations Command Center",
    "type": "Dashboard",
    "description": "Real-time operations monitoring"
}

response = requests.post(f"{base_url}/items", headers=headers, json=dashboard_payload)
dashboard = response.json()
print(f"Created Dashboard: {dashboard.get('id')}")

# Real-time visualizations are powered by KQL queries
# Example KQL queries for dashboard tiles:

# Current status summary
kql_summary = """
operational_metrics
| where timestamp > ago(5m)
| summarize
    avg_latency = avg(latency_ms),
    error_rate = countif(status == 'error') * 100.0 / count(),
    requests_per_sec = count() / 300.0
| project avg_latency, error_rate, requests_per_sec
"""

# Active anomalies
kql_anomalies = """
detected_anomalies
| where timestamp > ago(1h)
| where severity in ('high', 'critical')
| project timestamp, metric_name, actual_value, expected_value, severity
| order by timestamp desc
"""

# For AI-powered summaries, use Azure OpenAI with query results
from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com",
    api_version="2024-02-01",
    azure_ad_token=token
)

# Generate AI summary from metrics
# (metrics would come from KQL query results)
```

## Migration and Upgrade Path

For existing Fabric users:

```python
# Workspace administration via Fabric REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

workspace_id = "your-workspace-id"

# List all items in workspace
items_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items"
response = requests.get(items_url, headers=headers)
items = response.json().get("value", [])

# Inventory of workspace assets
item_counts = {}
for item in items:
    item_type = item["type"]
    item_counts[item_type] = item_counts.get(item_type, 0) + 1

print("Workspace asset inventory:")
for item_type, count in item_counts.items():
    print(f"  {item_type}: {count}")

# Check workspace capacity and settings
workspace_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"
response = requests.get(workspace_url, headers=headers)
workspace = response.json()

print(f"\nWorkspace: {workspace.get('displayName')}")
print(f"Capacity: {workspace.get('capacityId')}")

# Note: Feature enablement and migrations are typically managed through:
# - Fabric Admin Portal (admin.fabric.microsoft.com)
# - Tenant settings in the Admin portal
# - Capacity settings for specific workloads
#
# For programmatic tenant administration, use the Admin REST APIs:
# https://learn.microsoft.com/en-us/rest/api/fabric/admin
```

## What This Means for Data Teams

1. **Natural language becomes the interface** - AI Skills make data accessible to more users
2. **Real-time AI is native** - No more separate infrastructure for streaming AI
3. **Copilot integration is seamless** - Build conversational experiences on your data
4. **Analytics agents automate routine tasks** - Focus on insights, not data wrangling

The Fabric platform continues to mature into a comprehensive, AI-native analytics solution.

## Resources

- [Fabric Ignite Announcements](https://blog.fabric.microsoft.com/ignite-2024)
- [AI Skills Documentation](https://learn.microsoft.com/en-us/fabric/ai-skills)
- [Real-Time Intelligence](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/)
