---
title: "Azure AI Model Catalog: Exploring the Latest Model Options"
author: Michael John Peña
draft: false
date: 2024-11-07
tags:
  - Azure
  - AI
  - Model Catalog
  - LLM
  - Open Source

---

I wrote "Azure AI Model Catalog: Exploring the Latest Model Options" to share practical, production-minded guidance on this topic.

## The Model Catalog Landscape

Azure AI Model Catalog now includes:

- **OpenAI Models**: GPT-4o, GPT-4o-mini, o1-preview, o1-mini
- **Microsoft Models**: Phi-3, Phi-3.5, Orca
- **Meta Models**: Llama 3.1 (8B, 70B, 405B)
- **Mistral Models**: Mistral Large, Mistral Small, Mixtral
- **Cohere Models**: Command R, Command R+, Embed
- **And many more...**

## Deploying Models from the Catalog

```python
from azure.ai.foundry import AIFoundryClient
from azure.ai.foundry.models import ModelDeployment

client = AIFoundryClient(...)

# List available models
models = client.models.list(
    filter={
        "task": "chat-completion",
        "provider": ["openai", "meta", "mistral"]
    }
)

for model in models:
    print(f"{model.name}: {model.description}")
    print(f"  Context: {model.context_length}")
    print(f"  Pricing: ${model.pricing.input_per_1m_tokens}/1M input")

# Deploy a model
deployment = client.models.deploy(
    model_name="meta-llama-3.1-70b-instruct",
    deployment_name="llama-70b-prod",
    sku="Standard_NC24ads_A100_v4",
    instance_count=1
)

print(f"Endpoint: {deployment.endpoint}")
```

## Comparing Models for Your Use Case

```python
from azure.ai.foundry.evaluation import ModelComparison
import asyncio

async def compare_models_for_task():
    """Compare multiple models on the same task."""

    comparator = ModelComparison(client)

    test_prompts = [
        "Explain the medallion architecture in data lakes",
        "Write a Python function to calculate moving average",
        "What are the key differences between Delta Lake and Iceberg?",
        "Debug this SQL: SELECT * FORM users WHERE id = 1"
    ]

    models_to_compare = [
        "gpt-4o",
        "gpt-4o-mini",
        "meta-llama-3.1-70b-instruct",
        "mistral-large-2407"
    ]

    results = await comparator.compare(
        models=models_to_compare,
        prompts=test_prompts,
        metrics=["quality", "latency", "cost"],
        runs_per_prompt=3
    )

    # Print comparison table
    print("\n=== Model Comparison Results ===\n")
    print(f"{'Model':<30} {'Quality':<10} {'Latency':<12} {'Cost/1K':<10}")
    print("-" * 62)

    for model, metrics in results.items():
        print(f"{model:<30} {metrics['quality']:.2f}      "
              f"{metrics['latency_ms']:.0f}ms       "
              f"${metrics['cost_per_1k']:.4f}")

    return results

results = asyncio.run(compare_models_for_task())
```

## Model Selection Decision Framework

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class RequirementProfile:
    max_latency_ms: int
    max_cost_per_1k_tokens: float
    min_quality_score: float
    required_context_length: int
    needs_vision: bool = False
    needs_function_calling: bool = False
    data_residency: Optional[str] = None

def select_best_model(requirements: RequirementProfile) -> str:
    """Select the best model based on requirements."""

    MODEL_PROFILES = {
        "gpt-4o": {
            "latency_ms": 800,
            "cost_per_1k": 0.005,
            "quality": 0.95,
            "context_length": 128000,
            "vision": True,
            "function_calling": True,
            "regions": ["all"]
        },
        "gpt-4o-mini": {
            "latency_ms": 400,
            "cost_per_1k": 0.00015,
            "quality": 0.85,
            "context_length": 128000,
            "vision": True,
            "function_calling": True,
            "regions": ["all"]
        },
        "meta-llama-3.1-70b-instruct": {
            "latency_ms": 600,
            "cost_per_1k": 0.002,
            "quality": 0.88,
            "context_length": 128000,
            "vision": False,
            "function_calling": True,
            "regions": ["us", "eu"]
        },
        "mistral-large-2407": {
            "latency_ms": 500,
            "cost_per_1k": 0.003,
            "quality": 0.87,
            "context_length": 32000,
            "vision": False,
            "function_calling": True,
            "regions": ["us", "eu"]
        },
        "phi-3-medium-128k": {
            "latency_ms": 200,
            "cost_per_1k": 0.0001,
            "quality": 0.75,
            "context_length": 128000,
            "vision": False,
            "function_calling": False,
            "regions": ["all"]
        }
    }

    candidates = []

    for model, profile in MODEL_PROFILES.items():
        # Check hard requirements
        if profile["latency_ms"] > requirements.max_latency_ms:
            continue
        if profile["cost_per_1k"] > requirements.max_cost_per_1k_tokens:
            continue
        if profile["quality"] < requirements.min_quality_score:
            continue
        if profile["context_length"] < requirements.required_context_length:
            continue
        if requirements.needs_vision and not profile["vision"]:
            continue
        if requirements.needs_function_calling and not profile["function_calling"]:
            continue
        if requirements.data_residency and requirements.data_residency not in profile["regions"]:
            continue

        candidates.append((model, profile))

    if not candidates:
        raise ValueError("No model meets all requirements")

    # Sort by quality-to-cost ratio
    candidates.sort(key=lambda x: x[1]["quality"] / x[1]["cost_per_1k"], reverse=True)

    return candidates[0][0]

# Usage
requirements = RequirementProfile(
    max_latency_ms=1000,
    max_cost_per_1k_tokens=0.01,
    min_quality_score=0.80,
    required_context_length=32000,
    needs_function_calling=True,
    data_residency="eu"
)

best_model = select_best_model(requirements)
print(f"Recommended model: {best_model}")
```

## Using Open Source Models

```python
# Deploy Llama 3.1 70B
llama_deployment = client.models.deploy(
    model_name="meta-llama-3.1-70b-instruct",
    deployment_name="llama-70b-chat",
    sku="Standard_NC24ads_A100_v4"
)

# Use the same API as OpenAI models
response = client.chat.complete(
    model="llama-70b-chat",  # Your deployment name
    messages=[
        {"role": "system", "content": "You are a helpful data engineering assistant."},
        {"role": "user", "content": "Explain Apache Spark's catalyst optimizer."}
    ],
    max_tokens=1000
)

print(response.choices[0].message.content)
```

## Model-Specific Optimizations

```python
class ModelOptimizer:
    """Optimize prompts and settings for different models."""

    MODEL_CONFIGS = {
        "gpt-4o": {
            "system_prompt_style": "detailed",
            "optimal_temperature": 0.7,
            "supports_json_mode": True
        },
        "meta-llama-3.1-70b-instruct": {
            "system_prompt_style": "concise",
            "optimal_temperature": 0.6,
            "supports_json_mode": False,
            "prompt_template": "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n{system}<|eot_id|><|start_header_id|>user<|end_header_id|>\n{user}<|eot_id|><|start_header_id|>assistant<|end_header_id|>"
        },
        "mistral-large-2407": {
            "system_prompt_style": "balanced",
            "optimal_temperature": 0.7,
            "supports_json_mode": True
        }
    }

    def optimize_request(self, model: str, messages: list, **kwargs) -> dict:
        config = self.MODEL_CONFIGS.get(model, {})

        optimized = {
            "model": model,
            "messages": messages,
            "temperature": config.get("optimal_temperature", 0.7),
            **kwargs
        }

        # Apply model-specific formatting
        if "prompt_template" in config:
            optimized["messages"] = self.format_for_model(
                messages, config["prompt_template"]
            )

        return optimized

optimizer = ModelOptimizer()
request = optimizer.optimize_request(
    model="meta-llama-3.1-70b-instruct",
    messages=[
        {"role": "system", "content": "You are a SQL expert."},
        {"role": "user", "content": "Optimize this query..."}
    ]
)
```

The Model Catalog gives you flexibility to choose the right model for each use case while maintaining a consistent API. Experiment with different models to find the best balance of quality, cost, and latency for your applications.

## Resources

- [Azure AI Model Catalog](https://learn.microsoft.com/en-us/azure/ai-studio/how-to/model-catalog)
- [Model Benchmarks](https://learn.microsoft.com/en-us/azure/ai-studio/concepts/model-benchmarks)
- [Deployment Guide](https://learn.microsoft.com/en-us/azure/ai-studio/how-to/deploy-models)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
