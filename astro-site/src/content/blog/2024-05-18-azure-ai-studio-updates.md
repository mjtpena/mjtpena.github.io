---
title: "Azure AI Studio Updates at Build 2024"
author: Michael John Peña
draft: false
date: 2024-05-18
tags:
  - Azure
  - AI Studio
  - Azure AI
  - Microsoft Build
  - MLOps
---

## What's New in Azure AI Studio

### 1. Unified Experience

Azure AI Studio now provides a single pane of glass for:
- Model catalog browsing
- Prompt engineering
- Fine-tuning
- Evaluation
- Deployment
- Monitoring

### 2. Model Catalog Expansion

```
Available Models:
├── OpenAI (GPT-4o, GPT-4, GPT-3.5)
├── Microsoft (Phi-3 family)
├── Meta (Llama 3)
├── Mistral (Mistral, Mixtral)
├── Cohere (Command R+)
└── Stability AI (SDXL)
```

## Getting Started with AI Studio

### Project Setup

```python
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

# Connect to AI Studio project
credential = DefaultAzureCredential()
client = AIProjectClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="your-resource-group",
    project_name="your-ai-project"
)

# List available models
models = client.models.list()
for model in models:
    print(f"{model.name}: {model.version}")
```

### Model Deployment

```python
from azure.ai.projects.models import ModelDeployment

# Deploy a model
deployment = client.deployments.create(
    name="gpt4o-production",
    model="gpt-4o",
    sku="Standard",
    capacity=10  # TPM in thousands
)

print(f"Deployment created: {deployment.name}")
print(f"Endpoint: {deployment.endpoint}")
```

## Prompt Flow Updates

### Visual Flow Builder

```yaml
# prompt_flow.yaml
$schema: https://azuremlschemas.azureedge.net/promptflow/latest/Flow.schema.json
inputs:
  query:
    type: string
    description: User question
  context:
    type: string
    description: Retrieved documents

nodes:
  - name: search
    type: python
    source:
      type: code
      path: search.py
    inputs:
      query: ${inputs.query}

  - name: generate
    type: llm
    source:
      type: code
      path: generate.prompty
    inputs:
      context: ${search.output}
      query: ${inputs.query}

outputs:
  answer:
    type: string
    reference: ${generate.output}
```

### Prompty Files

```yaml
# generate.prompty
```
