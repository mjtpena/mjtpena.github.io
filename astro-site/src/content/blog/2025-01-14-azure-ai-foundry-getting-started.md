---
title: "Azure AI Foundry: Getting Started Guide for Data Professionals"
author: Michael John Peña
draft: false
date: 2025-01-14
tags:
  - Azure
  - AI
  - Azure AI Foundry
  - LLM
  - Enterprise AI

---

I wrote "Azure AI Foundry: Getting Started Guide for Data Professionals" to share practical, production-minded guidance on this topic.

## What is Azure AI Foundry?

Azure AI Foundry brings together:
- Model deployment and management
- Prompt engineering tools
- Evaluation frameworks
- Agent development
- Enterprise security and compliance

## Setting Up Your First Project

### Create an AI Foundry Project

```python
from azure.ai.foundry import AIFoundryClient
from azure.identity import DefaultAzureCredential

# Initialize client
credential = DefaultAzureCredential()
client = AIFoundryClient(
    subscription_id="your-subscription-id",
    resource_group="your-resource-group",
    credential=credential
)

# Create a new project
project = client.projects.create(
    name="data-analytics-ai",
    description="AI capabilities for data analytics workflows",
    location="eastus"
)

print(f"Project created: {project.id}")
```

### Deploy a Model

```python
from azure.ai.foundry.models import ModelDeployment

# Deploy GPT-4o
deployment = client.deployments.create(
    project=project.name,
    name="gpt-4o-main",
    model="gpt-4o",
    sku="Standard",
    capacity=10  # Tokens per minute (in thousands)
)

# Deploy an embedding model
embedding_deployment = client.deployments.create(
    project=project.name,
    name="embeddings",
    model="text-embedding-3-large",
    sku="Standard",
    capacity=50
)

print(f"Deployments ready: {deployment.endpoint}")
```

## Using the SDK

### Chat Completions

```python
from azure.ai.foundry import AIFoundryClient
from azure.identity import DefaultAzureCredential

client = AIFoundryClient(
    project="data-analytics-ai",
    credential=DefaultAzureCredential()
)

# Simple chat completion
response = client.chat.complete(
    deployment="gpt-4o-main",
    messages=[
        {"role": "system", "content": "You are a data analytics expert."},
        {"role": "user", "content": "Explain the difference between data lake and data warehouse."}
    ],
    temperature=0.7,
    max_tokens=500
)

print(response.choices[0].message.content)
```

### Streaming Responses

```python
# Stream for long responses
stream = client.chat.complete(
    deployment="gpt-4o-main",
    messages=[
        {"role": "user", "content": "Write a comprehensive guide to data modeling best practices."}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Embeddings for RAG

```python
# Generate embeddings
embeddings = client.embeddings.create(
    deployment="embeddings",
    input=[
        "Microsoft Fabric is a unified analytics platform.",
        "Azure Synapse provides big data analytics.",
        "Power BI enables business intelligence."
    ]
)

for i, embedding in enumerate(embeddings.data):
    print(f"Text {i}: {len(embedding.embedding)} dimensions")

# Use with vector search
import numpy as np

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

query_embedding = client.embeddings.create(
    deployment="embeddings",
    input=["What is Fabric?"]
).data[0].embedding

# Find most similar document
similarities = [
    cosine_similarity(query_embedding, doc.embedding)
    for doc in embeddings.data
]
most_similar = np.argmax(similarities)
print(f"Most relevant document: {most_similar}")
```

## Building a Data Assistant

### Define Tools for Data Operations

```python
from azure.ai.foundry.tools import Tool

# Define tools the AI can use
tools = [
    Tool(
        name="query_warehouse",
        description="Execute a SQL query against the data warehouse",
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The SQL query to execute"
                }
            },
            "required": ["query"]
        }
    ),
    Tool(
        name="get_table_schema",
        description="Get the schema of a database table",
        parameters={
            "type": "object",
            "properties": {
                "table_name": {
                    "type": "string",
                    "description": "Name of the table"
                }
            },
            "required": ["table_name"]
        }
    ),
    Tool(
        name="create_visualization",
        description="Create a chart from data",
        parameters={
            "type": "object",
            "properties": {
                "chart_type": {"type": "string", "enum": ["bar", "line", "pie", "scatter"]},
                "data": {"type": "string", "description": "JSON data for the chart"},
                "title": {"type": "string"}
            },
            "required": ["chart_type", "data"]
        }
    )
]

# Implement tool functions
def execute_tool(tool_name: str, arguments: dict):
    if tool_name == "query_warehouse":
        # Execute against your warehouse
        return execute_sql(arguments["query"])
    elif tool_name == "get_table_schema":
        return get_schema(arguments["table_name"])
    elif tool_name == "create_visualization":
        return create_chart(arguments)
```

### Tool-Using Conversation

```python
# Start conversation with tools
messages = [
    {"role": "system", "content": """You are a data analyst assistant.
    Use the available tools to help users analyze data.
    Always explain what you're doing."""},
    {"role": "user", "content": "What are the top 5 products by sales last month?"}
]

response = client.chat.complete(
    deployment="gpt-4o-main",
    messages=messages,
    tools=[t.to_dict() for t in tools],
    tool_choice="auto"
)

# Process tool calls
while response.choices[0].finish_reason == "tool_calls":
    tool_calls = response.choices[0].message.tool_calls

    # Add assistant message with tool calls
    messages.append(response.choices[0].message.to_dict())

    # Execute each tool and add results
    for tool_call in tool_calls:
        result = execute_tool(tool_call.function.name, tool_call.function.arguments)
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": str(result)
        })

    # Continue conversation
    response = client.chat.complete(
        deployment="gpt-4o-main",
        messages=messages,
        tools=[t.to_dict() for t in tools]
    )

print(response.choices[0].message.content)
```

## Evaluation Framework

```python
from azure.ai.foundry.evaluation import Evaluator, Dataset

# Create evaluation dataset
eval_dataset = Dataset(
    name="data_assistant_eval",
    examples=[
        {
            "input": "What is a data lakehouse?",
            "expected": "A data lakehouse combines data lake and warehouse features...",
            "context": "Data architecture documentation"
        },
        {
            "input": "How do I optimize a slow query?",
            "expected": "To optimize a slow query: 1. Check execution plan...",
            "context": "Query optimization guide"
        }
    ]
)

# Run evaluation
evaluator = Evaluator(client)

results = evaluator.evaluate(
    deployment="gpt-4o-main",
    dataset=eval_dataset,
    metrics=["relevance", "coherence", "groundedness", "fluency"],
    system_prompt="You are a data analytics expert."
)

print(f"Relevance: {results.metrics['relevance']:.2f}")
print(f"Coherence: {results.metrics['coherence']:.2f}")
print(f"Groundedness: {results.metrics['groundedness']:.2f}")
print(f"Fluency: {results.metrics['fluency']:.2f}")
```

## Prompt Management

```python
from azure.ai.foundry.prompts import PromptTemplate, PromptLibrary

# Create reusable prompts
sql_generator = PromptTemplate(
    name="sql_generator",
    template="""Given the following table schemas:
{{schemas}}

Generate a SQL query to answer: {{question}}

Requirements:
- Use standard SQL syntax
- Include appropriate JOINs if needed
- Add comments explaining the query
- Return only the SQL, no explanations

SQL Query:""",
    variables=["schemas", "question"]
)

# Save to library
library = PromptLibrary(project="data-analytics-ai")
library.save(sql_generator)

# Use the prompt
response = client.chat.complete(
    deployment="gpt-4o-main",
    messages=[
        {"role": "user", "content": sql_generator.render(
            schemas=table_schemas,
            question="What are the top customers by revenue?"
        )}
    ]
)
```

## Best Practices

1. **Start with evaluation**: Define success metrics before building
2. **Use system prompts**: Guide model behavior consistently
3. **Implement guardrails**: Validate inputs and outputs
4. **Monitor costs**: Track token usage and optimize
5. **Version prompts**: Treat prompts as code

Azure AI Foundry provides the foundation for enterprise AI applications. Start with simple use cases, measure results, and expand from there.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
