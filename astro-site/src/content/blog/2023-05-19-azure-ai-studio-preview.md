---
title: "Azure AI Studio Preview: The Future of AI Application Development"
description: "Azure AI Studio provides a comprehensive environment for building, testing, and deploying AI applications. Tomorrow, I will cover Prompt Flow in more detail."
author: Michael John Peña
draft: false
date: 2023-05-19
tags:
  - Azure AI Studio
  - Azure OpenAI
  - Prompt Flow
  - AI Development
  - Microsoft
---

## What is Azure AI Studio?

Azure AI Studio is a unified development environment for building generative AI applications. It brings together:

- Model catalog and deployment
- Prompt engineering tools
- Evaluation and testing
- Responsible AI features
- Deployment and monitoring

```
┌─────────────────────────────────────────────────────┐
│                 Azure AI Studio                      │
├─────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐       │
│  │  Model    │  │  Prompt   │  │  Build    │       │
│  │  Catalog  │  │  Flow     │  │  & Test   │       │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘       │
│        │              │              │              │
│        └──────────────┼──────────────┘              │
│                       ▼                             │
│  ┌─────────────────────────────────────────────────┐│
│  │              AI Project                          ││
│  │  - Connections (OpenAI, Search, Storage)        ││
│  │  - Deployments                                   ││
│  │  - Evaluations                                   ││
│  └─────────────────────────────────────────────────┘│
│                       │                             │
│                       ▼                             │
│  ┌─────────────────────────────────────────────────┐│
│  │           Managed Compute & Endpoints           ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Model Catalog

Access and deploy various foundation models:

```python
# Available models in Azure AI Studio Model Catalog
model_catalog = {
    "openai_models": [
        "gpt-4",
        "gpt-4-32k",
        "gpt-35-turbo",
        "gpt-35-turbo-16k",
        "text-embedding-ada-002"
    ],
    "meta_models": [
        "llama-2-7b",
        "llama-2-13b",
        "llama-2-70b"
    ],
    "huggingface_models": [
        "falcon-7b",
        "falcon-40b",
        "mpt-7b"
    ],
    "microsoft_models": [
        "phi-1.5",
        "orca-2"
    ]
}

# Deploy a model from catalog
from azure.ai.ml import MLClient
from azure.ai.ml.entities import ManagedOnlineDeployment, ManagedOnlineEndpoint

ml_client = MLClient.from_config()

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="gpt4-endpoint",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(endpoint)

# Deploy model
deployment = ManagedOnlineDeployment(
    name="gpt4-deployment",
    endpoint_name="gpt4-endpoint",
    model="azureml://registries/azure-openai/models/gpt-4/versions/1",
    instance_type="Standard_DS3_v2",
    instance_count=1
)
ml_client.online_deployments.begin_create_or_update(deployment)
```

## Prompt Flow

Prompt Flow enables visual orchestration of LLM applications:

### Flow Definition (YAML)

```yaml
$schema: https://azuremlschemas.azureedge.net/promptflow/latest/Flow.schema.json
inputs:
  question:
    type: string
    default: "What is Azure AI Studio?"
outputs:
  answer:
    type: string
    reference: ${generate_answer.output}

nodes:
  - name: embed_question
    type: python
    source:
      type: code
      path: embed.py
    inputs:
      text: ${inputs.question}

  - name: search_documents
    type: python
    source:
      type: code
      path: search.py
    inputs:
      query_embedding: ${embed_question.output}
      top_k: 5

  - name: generate_answer
    type: llm
    source:
      type: code
      path: prompt.jinja2
    inputs:
      deployment_name: gpt-4
      context: ${search_documents.output}
      question: ${inputs.question}
    connection: azure_openai_connection
    api: chat
```

### Node Implementation

```python
# embed.py
from promptflow import tool
from azure.ai.openai import AzureOpenAI

@tool
def embed_text(text: str) -> list:
    """Embed text using Azure OpenAI"""
    client = AzureOpenAI(
        api_key="${connection.api_key}",
        api_version="2023-05-15",
        azure_endpoint="${connection.endpoint}"
    )

    response = client.embeddings.create(
        model="text-embedding-ada-002",
        input=text
    )

    return response.data[0].embedding
```

```python
# search.py
from promptflow import tool
from azure.search.documents import SearchClient

@tool
def search_documents(query_embedding: list, top_k: int = 5) -> str:
    """Search for relevant documents"""
    search_client = SearchClient(
        endpoint="${search_connection.endpoint}",
        index_name="documents",
        credential="${search_connection.credential}"
    )

    results = search_client.search(
        search_text=None,
        vector_queries=[{
            "vector": query_embedding,
            "k_nearest_neighbors": top_k,
            "fields": "content_vector"
        }],
        select=["title", "content"]
    )

    context = "\n\n".join([
        f"Title: {doc['title']}\nContent: {doc['content']}"
        for doc in results
    ])

    return context
```

```jinja2
{# prompt.jinja2 #}
system:
You are a helpful AI assistant. Answer questions based on the provided context.
If the answer is not in the context, say "I don't have information about that."

Context:
{{context}}

user:
{{question}}
```

### Running Prompt Flow

```python
from promptflow import PFClient

pf = PFClient()

# Run flow locally
result = pf.run(
    flow="./my-flow",
    data="./test-data.jsonl"
)

print(result)

# Deploy flow as endpoint
pf.flows.deploy(
    flow="./my-flow",
    endpoint_name="qa-endpoint",
    deployment_name="qa-v1"
)
```

## Evaluation

Azure AI Studio provides built-in evaluation capabilities:

```python
from promptflow.evals import evaluate
from promptflow.evals.evaluators import (
    RelevanceEvaluator,
    CoherenceEvaluator,
    FluencyEvaluator,
    GroundednessEvaluator,
    SimilarityEvaluator
)

# Define evaluators
evaluators = {
    "relevance": RelevanceEvaluator(model_config),
    "coherence": CoherenceEvaluator(model_config),
    "fluency": FluencyEvaluator(model_config),
    "groundedness": GroundednessEvaluator(model_config)
}

# Run evaluation
results = evaluate(
    data="./test-data.jsonl",
    target=my_flow,
    evaluators=evaluators
)

print(f"Relevance: {results['relevance']:.2f}")
print(f"Coherence: {results['coherence']:.2f}")
print(f"Fluency: {results['fluency']:.2f}")
print(f"Groundedness: {results['groundedness']:.2f}")
```

### Custom Evaluators

```python
from promptflow.evals import Evaluator

class CustomAccuracyEvaluator(Evaluator):
    def __init__(self):
        self.name = "custom_accuracy"

    def __call__(self, question: str, answer: str, ground_truth: str) -> dict:
        # Custom evaluation logic
        is_correct = ground_truth.lower() in answer.lower()

        return {
            "score": 1.0 if is_correct else 0.0,
            "reason": "Answer contains expected information" if is_correct else "Answer missing expected information"
        }

# Use custom evaluator
custom_eval = CustomAccuracyEvaluator()
results = evaluate(
    data="./test-data.jsonl",
    target=my_flow,
    evaluators={"custom_accuracy": custom_eval}
)
```

## Responsible AI

```python
# Content Safety integration
from azure.ai.contentsafety import ContentSafetyClient
from promptflow import tool

@tool
def safe_generate(prompt: str, client: AzureOpenAI, safety_client: ContentSafetyClient):
    """Generate with content safety checks"""

    # Check input
    input_analysis = safety_client.analyze_text({"text": prompt})
    if any(cat.severity > 2 for cat in input_analysis.categories_analysis):
        return {"error": "Input flagged by content safety", "response": None}

    # Generate response
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}]
    )
    output = response.choices[0].message.content

    # Check output
    output_analysis = safety_client.analyze_text({"text": output})
    if any(cat.severity > 2 for cat in output_analysis.categories_analysis):
        return {"error": "Output flagged by content safety", "response": None}

    return {"error": None, "response": output}
```

## Project Setup

```python
from azure.ai.resources import AIProjectClient
from azure.identity import DefaultAzureCredential

# Create AI Project
project_client = AIProjectClient(
    subscription_id="your-subscription",
    resource_group="your-rg",
    project_name="my-ai-project",
    credential=DefaultAzureCredential()
)

# Add connections
project_client.connections.create_or_update(
    name="azure_openai",
    connection_type="AzureOpenAI",
    properties={
        "endpoint": "https://your-openai.openai.azure.com/",
        "api_key": "your-key"
    }
)

project_client.connections.create_or_update(
    name="search",
    connection_type="CognitiveSearch",
    properties={
        "endpoint": "https://your-search.search.windows.net/",
        "api_key": "your-key"
    }
)
```

Azure AI Studio provides a comprehensive environment for building, testing, and deploying AI applications. Tomorrow, I will cover Prompt Flow in more detail.

## Resources

- [Azure AI Studio Documentation](https://learn.microsoft.com/en-us/azure/ai-studio/)
- [Prompt Flow](https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/)
- [Model Catalog](https://learn.microsoft.com/en-us/azure/ai-studio/how-to/model-catalog)
