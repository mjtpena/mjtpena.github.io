---
title: "Prompt Flow General Availability: Building Production LLM Applications"
description: "Prompt Flow provides the foundation for building production-grade LLM applications. Tomorrow, I will cover Azure Machine Learning updates from Build 2023."
author: Michael John Peña
draft: false
date: 2023-05-20
tags:
  - Prompt Flow
  - Azure ML
  - LLM
  - AI Development
  - MLOps
---

## Why Prompt Flow?

Prompt Flow addresses key challenges in LLM application development:

- **Prompt Engineering**: Iterative prompt development with versioning
- **Orchestration**: Chain multiple LLM calls and tools
- **Evaluation**: Systematic testing of LLM outputs
- **Deployment**: Production-ready endpoints with monitoring

```
┌─────────────────────────────────────────────────────┐
│              LLM Application Lifecycle               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │  Build   │──▶│  Test    │──▶│  Deploy  │        │
│  │  (Flow)  │   │  (Eval)  │   │(Endpoint)│        │
│  └──────────┘   └──────────┘   └──────────┘        │
│       │              │              │               │
│       ▼              ▼              ▼               │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │ Prompt   │   │ Metrics  │   │ Monitor  │        │
│  │ Variants │   │ Compare  │   │ & Scale  │        │
│  └──────────┘   └──────────┘   └──────────┘        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Building a RAG Application

### Project Structure

```
my-rag-flow/
├── flow.dag.yaml         # Flow definition
├── requirements.txt      # Python dependencies
├── embed_query.py        # Embedding node
├── search_index.py       # Search node
├── generate_answer.py    # LLM node
├── chat_prompt.jinja2    # Prompt template
├── connections/
│   └── connection.yaml   # Connection configs
├── data/
│   ├── test.jsonl        # Test dataset
│   └── eval.jsonl        # Evaluation dataset
└── evaluation/
    └── eval_flow.dag.yaml
```

### Flow Definition

```yaml
# flow.dag.yaml
$schema: https://azuremlschemas.azureedge.net/promptflow/latest/Flow.schema.json

environment:
  python_requirements_txt: requirements.txt

inputs:
  chat_history:
    type: list
    default: []
  question:
    type: string

outputs:
  answer:
    type: string
    reference: ${generate_answer.output}
  context:
    type: string
    reference: ${search_index.output}

nodes:
  - name: embed_query
    type: python
    source:
      type: code
      path: embed_query.py
    inputs:
      question: ${inputs.question}
    connection: azure_openai

  - name: search_index
    type: python
    source:
      type: code
      path: search_index.py
    inputs:
      query_embedding: ${embed_query.output}
      top_k: 5
    connection: cognitive_search

  - name: generate_answer
    type: llm
    source:
      type: code
      path: chat_prompt.jinja2
    inputs:
      deployment_name: gpt-4
      temperature: 0.7
      max_tokens: 500
      context: ${search_index.output}
      chat_history: ${inputs.chat_history}
      question: ${inputs.question}
    connection: azure_openai
    api: chat
```

### Node Implementations

```python
# embed_query.py
from promptflow import tool
from promptflow.connections import AzureOpenAIConnection

@tool
def embed_query(question: str, connection: AzureOpenAIConnection) -> list:
    """Generate embedding for the query"""
    from openai import AzureOpenAI

    client = AzureOpenAI(
        api_key=connection.api_key,
        api_version="2023-05-15",
        azure_endpoint=connection.api_base
    )

    response = client.embeddings.create(
        model="text-embedding-ada-002",
        input=question
    )

    return response.data[0].embedding
```

```python
# search_index.py
from promptflow import tool
from promptflow.connections import CognitiveSearchConnection
from azure.search.documents import SearchClient
from azure.core.credentials import AzureKeyCredential

@tool
def search_index(
    query_embedding: list,
    top_k: int,
    connection: CognitiveSearchConnection
) -> str:
    """Search for relevant documents"""

    search_client = SearchClient(
        endpoint=connection.api_base,
        index_name="documents",
        credential=AzureKeyCredential(connection.api_key)
    )

    results = search_client.search(
        search_text=None,
        vector_queries=[{
            "kind": "vector",
            "vector": query_embedding,
            "k_nearest_neighbors": top_k,
            "fields": "embedding"
        }],
        select=["title", "content", "source"]
    )

    documents = []
    for result in results:
        documents.append(
            f"Source: {result['source']}\n"
            f"Title: {result['title']}\n"
            f"Content: {result['content']}"
        )

    return "\n\n---\n\n".join(documents)
```

```jinja2
{# chat_prompt.jinja2 #}
system:
You are a helpful AI assistant that answers questions based on the provided context.

Instructions:
- Only use information from the provided context
- If the answer is not in the context, say "I don't have information about that"
- Cite sources when possible
- Be concise but thorough

Context:
{{context}}

{% for message in chat_history %}
{{message.role}}:
{{message.content}}
{% endfor %}

user:
{{question}}
```

## Running Flows Locally

```python
from promptflow import PFClient

pf = PFClient()

# Test single input
result = pf.test(
    flow="./my-rag-flow",
    inputs={
        "question": "What is Azure AI Studio?",
        "chat_history": []
    }
)
print(result["answer"])

# Run batch
run = pf.run(
    flow="./my-rag-flow",
    data="./data/test.jsonl",
    name="test-run-001"
)

# Get results
details = pf.get_details(run)
print(details)
```

## Evaluation Flow

```yaml
# evaluation/eval_flow.dag.yaml
$schema: https://azuremlschemas.azureedge.net/promptflow/latest/Flow.schema.json

inputs:
  question:
    type: string
  answer:
    type: string
  context:
    type: string
  ground_truth:
    type: string

outputs:
  relevance_score:
    type: string
    reference: ${relevance_eval.output}
  groundedness_score:
    type: string
    reference: ${groundedness_eval.output}

nodes:
  - name: relevance_eval
    type: llm
    source:
      type: code
      path: relevance_prompt.jinja2
    inputs:
      deployment_name: gpt-4
      question: ${inputs.question}
      answer: ${inputs.answer}
    connection: azure_openai
    api: chat

  - name: groundedness_eval
    type: llm
    source:
      type: code
      path: groundedness_prompt.jinja2
    inputs:
      deployment_name: gpt-4
      context: ${inputs.context}
      answer: ${inputs.answer}
    connection: azure_openai
    api: chat
```

```jinja2
{# relevance_prompt.jinja2 #}
system:
You are an AI assistant that evaluates the relevance of an answer to a question.
Score the answer from 1-5 where:
1 = Completely irrelevant
2 = Mostly irrelevant
3 = Partially relevant
4 = Mostly relevant
5 = Highly relevant

Output only the numeric score.

user:
Question: {{question}}
Answer: {{answer}}

Score:
```

## Running Evaluations

```python
# Run evaluation
eval_run = pf.run(
    flow="./evaluation/eval_flow",
    data="./data/eval.jsonl",
    run=run,  # Reference the main flow run
    column_mapping={
        "question": "${data.question}",
        "answer": "${run.outputs.answer}",
        "context": "${run.outputs.context}",
        "ground_truth": "${data.ground_truth}"
    },
    name="eval-run-001"
)

# Analyze metrics
metrics = pf.get_metrics(eval_run)
print(f"Average Relevance: {metrics['relevance_score']:.2f}")
print(f"Average Groundedness: {metrics['groundedness_score']:.2f}")
```

## Deployment

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model
)
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-sub",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="rag-endpoint",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Register flow as model
model = Model(
    path="./my-rag-flow",
    name="rag-model",
    type="promptflow"
)
ml_client.models.create_or_update(model)

# Create deployment
deployment = ManagedOnlineDeployment(
    name="rag-deployment",
    endpoint_name="rag-endpoint",
    model=model,
    instance_type="Standard_DS3_v2",
    instance_count=1
)
ml_client.online_deployments.begin_create_or_update(deployment).result()

# Set traffic
endpoint.traffic = {"rag-deployment": 100}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()
```

## Calling Deployed Flow

```python
import urllib.request
import json

def call_rag_endpoint(question: str, chat_history: list = None):
    url = "https://rag-endpoint.eastus.inference.ml.azure.com/score"

    data = {
        "question": question,
        "chat_history": chat_history or []
    }

    body = json.dumps(data).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    req = urllib.request.Request(url, body, headers)

    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read())

    return result

# Usage
response = call_rag_endpoint("What is Azure AI Studio?")
print(response["answer"])
```

Prompt Flow provides the foundation for building production-grade LLM applications. Tomorrow, I will cover Azure Machine Learning updates from Build 2023.

## Resources

- [Prompt Flow Documentation](https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/)
- [Prompt Flow SDK](https://microsoft.github.io/promptflow/)
- [GitHub Repository](https://github.com/microsoft/promptflow)
