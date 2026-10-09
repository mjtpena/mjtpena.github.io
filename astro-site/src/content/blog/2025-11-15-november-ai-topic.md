---
title: "Ignite 2025 Day 1: Azure AI Foundry and New Model Capabilities"
description: "The Azure AI Foundry represents Microsoft's vision for enterprise AI development - a unified platform that handles the complexity of model selection…"
author: Michael John Peña
draft: false
date: 2025-11-15
tags:
  - Ignite 2025
  - Azure AI
  - Azure AI Foundry
  - GPT-4 Turbo
  - Announcements
---

## Azure AI Foundry

Azure AI Foundry consolidates Azure AI Studio, model catalog, and deployment tools into a cohesive experience. Key features announced include:

```python
from azure.ai.foundry import FoundryClient
from azure.identity import DefaultAzureCredential

# New unified client for Azure AI Foundry
client = FoundryClient(
    subscription_id="your-subscription",
    resource_group="your-rg",
    credential=DefaultAzureCredential()
)

# Browse available models
models = client.models.list(
    capabilities=["chat", "embeddings"],
    providers=["openai", "meta", "mistral"]
)

for model in models:
    print(f"{model.name}: {model.description}")
    print(f"  Capabilities: {model.capabilities}")
    print(f"  Pricing: ${model.pricing.per_1k_tokens}")

# Deploy a model with one call
deployment = client.deployments.create(
    name="production-chat",
    model="gpt-4-turbo-2025-11",
    sku="Standard",
    capacity=100,  # TPM in thousands
    content_filter="default",
    network_config={
        "private_endpoint": True,
        "vnet_id": "/subscriptions/.../virtualNetworks/ai-vnet"
    }
)

# Integrated prompt management
prompt_version = client.prompts.create(
    name="customer-support",
    template="""You are a helpful customer support agent for {company_name}.

Context: {context}

Question: {question}

Provide a helpful response.""",
    variables=["company_name", "context", "question"],
    metadata={"author": "ai-team", "use_case": "support-bot"}
)
```

## New Model Capabilities

GPT-4 Turbo received significant updates:

- **128K context window** with improved long-context performance
- **Enhanced reasoning** for complex multi-step problems
- **Improved function calling** with parallel execution support
- **Better structured output** with JSON schema enforcement

```python
# New structured output capability
from azure.ai.openai import AzureOpenAI
from pydantic import BaseModel

class OrderAnalysis(BaseModel):
    order_id: str
    status: str
    issues: list[str]
    recommended_actions: list[str]
    priority: str

response = client.chat.completions.create(
    model="gpt-4-turbo-2025-11",
    messages=[
        {"role": "system", "content": "Analyze customer orders and identify issues."},
        {"role": "user", "content": order_details}
    ],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "order_analysis",
            "schema": OrderAnalysis.model_json_schema()
        }
    }
)

analysis = OrderAnalysis.model_validate_json(
    response.choices[0].message.content
)
```

## Responsible AI Enhancements

New content safety features include:

- **Groundedness detection**: Verify responses against provided context
- **Custom categories**: Define organization-specific content filters
- **Automated red teaming**: Built-in adversarial testing tools

The Azure AI Foundry represents Microsoft's vision for enterprise AI development - a unified platform that handles the complexity of model selection, deployment, and governance while maintaining flexibility for custom implementations.
