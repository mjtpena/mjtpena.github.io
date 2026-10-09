---
title: "Azure OpenAI November 2024 Updates: What's New for Enterprise AI"
description: "Batch processing can reduce costs by up to 50% for workloads that don't need immediate responses."
author: Michael John Peña
draft: false
date: 2024-11-01
tags:
  - Azure
  - AI
  - Azure OpenAI
  - GPT-4o
  - Enterprise AI
---

## New Model Deployments

Azure OpenAI now supports the latest model versions with improved capabilities:

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-10-01-preview",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
)

# Using the latest GPT-4o version
response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",  # Latest version
    messages=[
        {"role": "system", "content": "You are a helpful data engineering assistant."},
        {"role": "user", "content": "Explain the medallion architecture in data lakehouses."}
    ],
    max_tokens=1000,
    temperature=0.7
)

print(response.choices[0].message.content)
```

## Structured Outputs GA

One of the most requested features is now generally available - structured outputs with JSON schema enforcement:

```python
from pydantic import BaseModel
from typing import List, Optional

class DataQualityReport(BaseModel):
    table_name: str
    total_rows: int
    null_percentage: float
    duplicate_count: int
    recommendations: List[str]
    severity: str

response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",
    messages=[
        {"role": "system", "content": "Analyze data quality and return structured reports."},
        {"role": "user", "content": "Analyze the customer table: 10000 rows, 5% nulls in email, 200 duplicate phone numbers"}
    ],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "data_quality_report",
            "schema": DataQualityReport.model_json_schema()
        }
    }
)

report = DataQualityReport.model_validate_json(response.choices[0].message.content)
print(f"Severity: {report.severity}")
print(f"Recommendations: {report.recommendations}")
```

## Improved Quota Management

Azure OpenAI now provides better quota visibility and management through the API:

```python
from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = CognitiveServicesManagementClient(credential, subscription_id)

# Check deployment quota usage
usages = client.deployments.list_usages(
    resource_group_name="rg-ai-production",
    account_name="aoai-production",
    deployment_name="gpt-4o-deployment"
)

for usage in usages:
    print(f"Metric: {usage.name.value}")
    print(f"Current: {usage.current_value}")
    print(f"Limit: {usage.limit}")
    print(f"Utilization: {(usage.current_value / usage.limit) * 100:.1f}%")
```

## Batch API for Cost Optimization

For non-real-time workloads, the Batch API offers significant cost savings:

```python
import json

# Prepare batch input file
batch_requests = [
    {
        "custom_id": f"request-{i}",
        "method": "POST",
        "url": "/chat/completions",
        "body": {
            "model": "gpt-4o-2024-08-06",
            "messages": [
                {"role": "user", "content": f"Summarize document {i}"}
            ]
        }
    }
    for i in range(1000)
]

# Upload batch file
with open("batch_input.jsonl", "w") as f:
    for request in batch_requests:
        f.write(json.dumps(request) + "\n")

# Submit batch job
batch_file = client.files.create(
    file=open("batch_input.jsonl", "rb"),
    purpose="batch"
)

batch_job = client.batches.create(
    input_file_id=batch_file.id,
    endpoint="/v1/chat/completions",
    completion_window="24h"
)

print(f"Batch job ID: {batch_job.id}")
print(f"Status: {batch_job.status}")
```

Batch processing can reduce costs by up to 50% for workloads that don't need immediate responses.

## Content Filtering Updates

Enhanced content filtering with more granular controls:

```python
# Check content filter results in response
if response.choices[0].finish_reason == "content_filter":
    print("Response was filtered")
    # Access filter annotations
    annotations = response.choices[0].content_filter_results
    print(f"Hate: {annotations.hate.filtered}")
    print(f"Self-harm: {annotations.self_harm.filtered}")
    print(f"Sexual: {annotations.sexual.filtered}")
    print(f"Violence: {annotations.violence.filtered}")
```

## What's Coming at Ignite

Expect major announcements around:
- GPT-4o fine-tuning availability
- New reasoning models (o1 series)
- Azure AI Foundry consolidation
- Agent development frameworks

The Azure AI landscape is evolving rapidly. Stay tuned for our Ignite coverage.

## Resources

- [Azure OpenAI Service Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [What's New in Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new)
- [Pricing Calculator](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)
