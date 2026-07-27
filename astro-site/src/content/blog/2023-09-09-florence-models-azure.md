---
title: "Azure AI Model Catalog: Exploring Foundation Models"
author: Michael John Peña
draft: false
date: 2023-09-09
description: "Explore Azure's growing catalog of foundation models and how to leverage them for various AI applications."
tags:
  - Azure
  - AI
  - Foundation Models
  - Machine Learning
  - Model Catalog
---

The Azure ML model catalogue, announced at Build 2023, is becoming the place where I start when a client needs a foundation model on Azure that isn't GPT-4 or GPT-3.5. The catalogue aggregates models from Hugging Face, Meta (Llama 2), and other providers with one-click deployment to Azure ML managed endpoints — licence acceptance, model download, and endpoint provisioning handled through the UI or SDK. In September 2023, the catalogue includes Llama 2 variants (7B, 13B, 70B and their Chat-tuned versions), Falcon models, BLOOM, and a growing list of specialised models for code, multilingual text, and computer vision. The practical value for enterprise: you get a governed, audit-trailed path to deploy open-source models without managing the Hub authentication and model storage yourself. The models run on Azure infrastructure, so your data governance and network policies apply.

## Introduction

Azure's AI Model Catalog is expanding with various foundation models that serve different use cases. This post explores the available models and how to effectively leverage them in your applications.

## Understanding Foundation Models

Foundation models are large AI models trained on broad data that can be adapted to many downstream tasks. Azure provides access to several categories:

1. **Large Language Models (LLMs)**: GPT-4, GPT-3.5 Turbo
2. **Embedding Models**: text-embedding-ada-002
3. **Vision Models**: Azure AI Vision, Custom Vision
4. **Speech Models**: Azure Speech Services

## Azure OpenAI Models

### Current Model Availability

```python
import os
import openai

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")
openai.api_version = "2023-07-01-preview"
openai.api_key = os.getenv("AZURE_OPENAI_KEY")

# Available models (as of September 2023)
AVAILABLE_MODELS = {
    "gpt-4": {
        "type": "chat",
        "context_window": 8192,
        "strengths": ["Complex reasoning", "Code generation", "Analysis"]
    },
    "gpt-4-32k": {
        "type": "chat",
        "context_window": 32768,
        "strengths": ["Long documents", "Extended conversations"]
    },
    "gpt-35-turbo": {
        "type": "chat",
        "context_window": 4096,
        "strengths": ["Fast responses", "Cost effective", "General tasks"]
    },
    "text-embedding-ada-002": {
        "type": "embedding",
        "dimensions": 1536,
        "strengths": ["Semantic search", "Similarity", "Clustering"]
    }
}

def get_model_info(model_name: str) -> dict:
    """Get information about a model."""
    return AVAILABLE_MODELS.get(model_name, {"error": "Model not found"})
```

### Model Selection Strategy

```python
from enum import Enum
from dataclasses import dataclass
from typing import Optional

class TaskComplexity(Enum):
    SIMPLE = "simple"
    MODERATE = "moderate"
    COMPLEX = "complex"

class TaskType(Enum):
    CHAT = "chat"
    SUMMARIZATION = "summarization"
    CODE_GENERATION = "code_generation"
    ANALYSIS = "analysis"
    EMBEDDING = "embedding"
    CLASSIFICATION = "classification"

@dataclass
class ModelRecommendation:
    model: str
    reason: str
    estimated_cost: str
    context_limit: int

class ModelSelector:
    def recommend(
        self,
        task_type: TaskType,
        complexity: TaskComplexity,
        input_length: int = 0
    ) -> ModelRecommendation:
        """Recommend the best model for a task."""

        # For embeddings, always use ada-002
        if task_type == TaskType.EMBEDDING:
            return ModelRecommendation(
                model="text-embedding-ada-002",
                reason="Only embedding model available",
                estimated_cost="$0.0001/1K tokens",
                context_limit=8191
            )

        # For simple tasks, use GPT-3.5
        if complexity == TaskComplexity.SIMPLE:
            return ModelRecommendation(
                model="gpt-35-turbo",
                reason="Cost-effective for simple tasks",
                estimated_cost="$0.002/1K tokens",
                context_limit=4096
            )

        # For long inputs, consider 32k model
        if input_length > 6000:
            return ModelRecommendation(
                model="gpt-4-32k",
                reason="Extended context window needed",
                estimated_cost="$0.06/1K tokens",
                context_limit=32768
            )

        # For complex tasks, use GPT-4
        if complexity == TaskComplexity.COMPLEX:
            return ModelRecommendation(
                model="gpt-4",
                reason="Best reasoning capabilities",
                estimated_cost="$0.03/1K tokens",
                context_limit=8192
            )

        # Default to GPT-3.5 for moderate tasks
        return ModelRecommendation(
            model="gpt-35-turbo",
            reason="Good balance of capability and cost",
            estimated_cost="$0.002/1K tokens",
            context_limit=4096
        )

# Usage
selector = ModelSelector()

# Simple classification task
rec = selector.recommend(TaskType.CLASSIFICATION, TaskComplexity.SIMPLE)
print(f"Recommended: {rec.model} - {rec.reason}")

# Complex code analysis
rec = selector.recommend(TaskType.CODE_GENERATION, TaskComplexity.COMPLEX)
print(f"Recommended: {rec.model} - {rec.reason}")

# Long document processing
rec = selector.recommend(TaskType.SUMMARIZATION, TaskComplexity.MODERATE, input_length=10000)
print(f"Recommended: {rec.model} - {rec.reason}")
```

## Embedding Models for Semantic Search

### Building a Semantic Search System

```python
import numpy as np
from typing import List, Tuple

class SemanticSearchEngine:
    def __init__(self, deployment_name: str = "text-embedding-ada-002"):
        self.deployment = deployment_name
        self.documents = []
        self.embeddings = []

    def get_embedding(self, text: str) -> np.ndarray:
        """Get embedding for text."""
        response = openai.Embedding.create(
            engine=self.deployment,
            input=text
        )
        return np.array(response['data'][0]['embedding'])

    def add_documents(self, documents: List[str]):
        """Add documents to the search index."""
        for doc in documents:
            embedding = self.get_embedding(doc)
            self.documents.append(doc)
            self.embeddings.append(embedding)

    def search(self, query: str, top_k: int = 5) -> List[Tuple[str, float]]:
        """Search for similar documents."""
        query_embedding = self.get_embedding(query)

        # Calculate cosine similarities
        similarities = []
        for i, doc_embedding in enumerate(self.embeddings):
            similarity = np.dot(query_embedding, doc_embedding) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(doc_embedding)
            )
            similarities.append((self.documents[i], similarity))

        # Sort by similarity
        similarities.sort(key=lambda x: x[1], reverse=True)
        return similarities[:top_k]

    def save_index(self, path: str):
        """Save the search index."""
        import json
        data = {
            "documents": self.documents,
            "embeddings": [e.tolist() for e in self.embeddings]
        }
        with open(path, 'w') as f:
            json.dump(data, f)

    def load_index(self, path: str):
        """Load the search index."""
        import json
        with open(path, 'r') as f:
            data = json.load(f)
        self.documents = data["documents"]
        self.embeddings = [np.array(e) for e in data["embeddings"]]

# Usage
search_engine = SemanticSearchEngine()

# Add documents
search_engine.add_documents([
    "Azure Functions is a serverless compute service",
    "Azure Kubernetes Service manages containerized applications",
    "Azure Cosmos DB is a globally distributed database",
    "Azure Machine Learning enables ML model training and deployment"
])

# Search
results = search_engine.search("How do I run containers in Azure?")
for doc, score in results[:3]:
    print(f"Score: {score:.3f} - {doc[:60]}...")
```

## Azure Machine Learning Model Catalog

### Deploying Models from the Catalog

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

class ModelCatalogClient:
    def __init__(self, subscription_id: str, resource_group: str, workspace_name: str):
        self.client = MLClient(
            credential=DefaultAzureCredential(),
            subscription_id=subscription_id,
            resource_group_name=resource_group,
            workspace_name=workspace_name
        )

    def list_available_models(self, task_type: str = None) -> list:
        """List models available in the catalog."""
        models = self.client.models.list()

        model_list = []
        for model in models:
            model_info = {
                "name": model.name,
                "version": model.version,
                "description": model.description
            }
            model_list.append(model_info)

        return model_list

    def get_model_details(self, model_name: str, version: str = None) -> dict:
        """Get detailed information about a model."""
        model = self.client.models.get(model_name, version=version)

        return {
            "name": model.name,
            "version": model.version,
            "description": model.description,
            "properties": model.properties,
            "tags": model.tags
        }

# Usage example (requires Azure ML workspace)
# client = ModelCatalogClient(
#     subscription_id="your-subscription",
#     resource_group="your-rg",
#     workspace_name="your-workspace"
# )
# models = client.list_available_models()
```

## Best Practices for Model Selection

### Cost-Performance Trade-offs

```python
from dataclasses import dataclass
from typing import Dict

@dataclass
class CostEstimate:
    input_tokens: int
    output_tokens: int
    model: str
    total_cost: float

class CostCalculator:
    # Approximate pricing per 1K tokens (check Azure pricing for current rates)
    PRICING = {
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-4-32k": {"input": 0.06, "output": 0.12},
        "gpt-35-turbo": {"input": 0.002, "output": 0.002},
        "text-embedding-ada-002": {"input": 0.0001, "output": 0}
    }

    def estimate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> CostEstimate:
        """Estimate the cost of an API call."""
        if model not in self.PRICING:
            raise ValueError(f"Unknown model: {model}")

        pricing = self.PRICING[model]
        input_cost = (input_tokens / 1000) * pricing["input"]
        output_cost = (output_tokens / 1000) * pricing["output"]
        total = input_cost + output_cost

        return CostEstimate(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model,
            total_cost=total
        )

    def compare_models(
        self,
        input_tokens: int,
        output_tokens: int
    ) -> Dict[str, CostEstimate]:
        """Compare costs across models."""
        comparisons = {}
        for model in self.PRICING:
            if self.PRICING[model]["output"] > 0 or model.startswith("text-embedding"):
                comparisons[model] = self.estimate_cost(
                    model, input_tokens, output_tokens
                )
        return comparisons

# Usage
calculator = CostCalculator()

# Compare costs for a typical request
comparisons = calculator.compare_models(1000, 500)
for model, estimate in comparisons.items():
    print(f"{model}: ${estimate.total_cost:.4f}")
```

## Conclusion

Azure's model catalog continues to grow, offering diverse options for different AI tasks. Choosing the right model involves balancing capability, cost, and specific task requirements. As new models become available, the landscape will continue to evolve, offering more specialized and capable options for enterprise AI applications.

## Resources

- [Azure OpenAI Service Models](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/models)
- [Azure Machine Learning Model Catalog](https://learn.microsoft.com/azure/machine-learning/concept-model-catalog)
- [Azure AI Services Overview](https://azure.microsoft.com/products/cognitive-services/)
- [Model Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/)
