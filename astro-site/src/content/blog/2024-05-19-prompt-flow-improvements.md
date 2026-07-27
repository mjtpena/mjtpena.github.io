---
title: "Prompt Flow Improvements: Building Production AI Pipelines"
author: Michael John Peña
draft: false
date: 2024-05-19
tags:
  - Azure
  - Prompt Flow
  - LLMOps
  - AI Pipeline
  - Azure AI
---

Prompt Flow has evolved significantly since its introduction. Today I'm exploring the latest improvements for building production-ready AI pipelines.

## What is Prompt Flow?

Prompt Flow is a development framework for building LLM-based applications. It provides:

- **Visual flow builder** - DAG-based pipeline design
- **Prompty format** - Portable prompt definitions
- **Local development** - Test without cloud resources
- **Evaluation tools** - Built-in quality assessment
- **Deployment options** - Multiple hosting choices

## Setting Up Prompt Flow

```bash
# Install Prompt Flow
pip install promptflow promptflow-tools

# Install additional providers
pip install promptflow-azure  # Azure integration

# Verify installation
pf --version
```

## Creating Flows

### Standard Flow

```yaml
# flow.dag.yaml
$schema: https://azuremlschemas.azureedge.net/promptflow/latest/Flow.schema.json

inputs:
  question:
    type: string
    default: "What is machine learning?"

outputs:
  answer:
    type: string
    reference: ${generate_answer.output}

nodes:
  - name: retrieve_context
    type: python
    source:
      type: code
      path: retrieve.py
    inputs:
      question: ${inputs.question}

  - name: generate_answer
    type: llm
    source:
      type: code
      path: generate.prompty
    inputs:
      context: ${retrieve_context.output}
      question: ${inputs.question}
```

### Python Node

```python
# retrieve.py
from promptflow import tool
from azure.search.documents import SearchClient
from azure.core.credentials import AzureKeyCredential
import os

@tool
def retrieve_context(question: str) -> str:
    """Retrieve relevant documents from Azure AI Search."""
    client = SearchClient(
        endpoint=os.environ["SEARCH_ENDPOINT"],
        index_name="documents",
        credential=AzureKeyCredential(os.environ["SEARCH_KEY"])
    )

    results = client.search(
        search_text=question,
        top=5,
        select=["content", "title"]
    )

    context_parts = []
    for result in results:
        context_parts.append(f"Title: {result['title']}\n{result['content']}")

    return "\n\n---\n\n".join(context_parts)
```

### Prompty Node

```yaml
# generate.prompty
---
name: Answer Generator
description: Generate answers using retrieved context
model:
  api: chat
  configuration:
    type: azure_openai
    azure_deployment: gpt-4o
    api_version: 2024-05-01-preview
  parameters:
    temperature: 0.7
    max_tokens: 500
    top_p: 0.95
inputs:
  context:
    type: string
    description: Retrieved document context
  question:
    type: string
    description: User's question
outputs:
  answer:
    type: string
---
system:
You are a helpful assistant that answers questions based on provided context.
Only use information from the context. If the answer isn't in the context, say so.

user:
Context:
{{context}}

Question: {{question}}

Provide a clear, concise answer:
```

## Connection Management

```python
from promptflow import PFClient

pf = PFClient()

# Create Azure OpenAI connection
pf.connections.create_or_update(
    name="aoai-connection",
    type="AzureOpenAI",
    api_key="${env:AZURE_OPENAI_KEY}",
    api_base="${env:AZURE_OPENAI_ENDPOINT}",
    api_version="2024-05-01-preview"
)

# Create Azure AI Search connection
pf.connections.create_or_update(
    name="search-connection",
    type="CognitiveSearch",
    api_key="${env:SEARCH_KEY}",
    api_base="${env:SEARCH_ENDPOINT}"
)

# List connections
for conn in pf.connections.list():
    print(f"{conn.name}: {conn.type}")
```

## Running Flows

### Local Execution

```python
from promptflow import PFClient

pf = PFClient()

# Run single input
result = pf.test(
    flow="./rag_flow",
    inputs={"question": "What is Azure AI Studio?"}
)
print(result["answer"])

# Batch run
run = pf.run(
    flow="./rag_flow",
    data="./test_questions.jsonl",
    column_mapping={
        "question": "${data.question}"
    }
)

# Get results
details = pf.get_details(run)
print(details)
```

### Streaming Output

```python
from promptflow import PFClient

pf = PFClient()

# Stream response
for chunk in pf.test(
    flow="./rag_flow",
    inputs={"question": "Explain microservices"},
    stream=True
):
    print(chunk, end="", flush=True)
```

## Evaluation Flows

```yaml
# eval_flow.dag.yaml
$schema: https://azuremlschemas.azureedge.net/promptflow/latest/Flow.schema.json

inputs:
  question:
    type: string
  ground_truth:
    type: string
  prediction:
    type: string

outputs:
  score:
    type: object
    reference: ${aggregate.output}

nodes:
  - name: relevance_score
    type: llm
    source:
      type: code
      path: relevance.prompty
    inputs:
      question: ${inputs.question}
      answer: ${inputs.prediction}

  - name: groundedness_score
    type: llm
    source:
      type: code
      path: groundedness.prompty
    inputs:
      answer: ${inputs.prediction}
      context: ${inputs.ground_truth}

  - name: aggregate
    type: python
    source:
      type: code
      path: aggregate.py
    inputs:
      relevance: ${relevance_score.output}
      groundedness: ${groundedness_score.output}
```

```python
# aggregate.py
from promptflow import tool

@tool
def aggregate(relevance: str, groundedness: str) -> dict:
    """Aggregate evaluation scores."""
    def parse_score(text: str) -> float:
        try:
            return float(text.strip())
        except:
            return 0.0

    return {
        "relevance": parse_score(relevance),
        "groundedness": parse_score(groundedness),
        "overall": (parse_score(relevance) + parse_score(groundedness)) / 2
    }
```

## Variant Testing

Test different prompt versions:

```yaml
# flow.dag.yaml with variants
nodes:
  - name: generate_answer
    type: llm
    source:
      type: code
      path: generate.prompty
    inputs:
      context: ${retrieve_context.output}
      question: ${inputs.question}
    variants:
      variant_0:
        source:
          path: generate_v1.prompty
      variant_1:
        source:
          path: generate_v2.prompty
        parameters:
          temperature: 0.5
```

```python
# Compare variants
from promptflow import PFClient

pf = PFClient()

# Run with different variants
run_v0 = pf.run(
    flow="./rag_flow",
    data="./test_data.jsonl",
    variant="${generate_answer.variant_0}"
)

run_v1 = pf.run(
    flow="./rag_flow",
    data="./test_data.jsonl",
    variant="${generate_answer.variant_1}"
)

# Compare results
comparison = pf.compare_runs([run_v0, run_v1])
print(comparison)
```

## Deployment

### Deploy to Azure

```python
from promptflow.azure import PFClient as AzurePFClient

azure_pf = AzurePFClient(
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create deployment
deployment = azure_pf.flows.deploy(
    flow="./rag_flow",
    deployment_name="rag-deployment",
    endpoint_name="rag-endpoint",
    instance_type="Standard_DS3_v2",
    instance_count=1
)

print(f"Endpoint: {deployment.endpoint_url}")
```

### Deploy as Docker

```bash
# Build Docker image
pf flow build --source ./rag_flow --output ./docker_build --format docker

# Build and run
cd docker_build
docker build -t rag-flow:latest .
docker run -p 8080:8080 -e AZURE_OPENAI_KEY=$AZURE_OPENAI_KEY rag-flow:latest
```

### Deploy as Python Package

```bash
# Build package
pf flow build --source ./rag_flow --output ./package_build --format python

# Install and use
cd package_build
pip install -e .

# Use in code
from rag_flow import FlowExecutor

executor = FlowExecutor()
result = executor.run(question="What is AI?")
```

## Monitoring in Production

```python
# Enable telemetry
from promptflow.tracing import start_trace

start_trace(
    collection="my-rag-app",
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)

# Traces are automatically collected
result = pf.test(
    flow="./rag_flow",
    inputs={"question": "What is Azure?"}
)

# Custom spans
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

with tracer.start_as_current_span("custom_operation"):
    # Your code here
    pass
```

## Best Practices

### 1. Modular Design

```
flows/
├── rag_flow/
│   ├── flow.dag.yaml
│   ├── retrieve.py
│   ├── generate.prompty
│   └── requirements.txt
├── eval_flow/
│   ├── flow.dag.yaml
│   └── evaluators/
└── shared/
    └── tools/
```

### 2. Environment Management

```yaml
# requirements.txt
promptflow>=1.5.0
promptflow-tools>=1.0.0
azure-search-documents>=11.4.0
openai>=1.0.0
```

### 3. Testing Strategy

```python
# test_flow.py
import pytest
from promptflow import PFClient

pf = PFClient()

def test_retrieve_returns_content():
    result = pf.test(
        flow="./rag_flow",
        inputs={"question": "What is Azure?"},
        node="retrieve_context"
    )
    assert result is not None
    assert len(result) > 0

def test_end_to_end():
    result = pf.test(
        flow="./rag_flow",
        inputs={"question": "What is Azure AI Studio?"}
    )
    assert "Azure" in result["answer"]
```

## What's Next

Tomorrow I'll cover evaluation improvements in Azure AI Studio.

## Resources

- [Prompt Flow Documentation](https://microsoft.github.io/promptflow/)
- [Prompty Specification](https://prompty.ai/)
- [Azure AI Studio](https://ai.azure.com/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
