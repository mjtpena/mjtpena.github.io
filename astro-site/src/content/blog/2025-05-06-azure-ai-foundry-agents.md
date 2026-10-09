---
title: "Azure AI Foundry Agents: Building Production AI Agents"
description: "Azure AI Foundry simplifies the path from agent prototype to production deployment."
author: Michael John Peña
draft: false
date: 2025-05-06
tags:
  - Azure
  - AI Foundry
  - Agents
  - Production
  - Enterprise
---

## AI Foundry Agent Development

```python
from azure.ai.foundry import AIFoundryClient
from azure.ai.foundry.agents import Agent, Tool, Memory
from azure.identity import DefaultAzureCredential

# Initialize client
client = AIFoundryClient(
    endpoint="https://myworkspace.api.azureml.ms",
    credential=DefaultAzureCredential()
)

# Define tools
@Tool.function
async def search_documents(query: str, top_k: int = 5) -> list:
    """Search internal documents for relevant information."""
    results = await document_service.search(query, top_k)
    return [{"title": r.title, "content": r.content} for r in results]

@Tool.function
async def query_database(sql: str) -> dict:
    """Execute SQL query against the analytics database."""
    return await database_service.execute(sql)

@Tool.function
async def create_ticket(title: str, description: str, priority: str) -> dict:
    """Create a support ticket in the ticketing system."""
    return await ticket_service.create(title, description, priority)

# Create agent
agent = client.agents.create(
    name="CustomerServiceAgent",
    model="gpt-4o",
    instructions="""You are a customer service agent.
    Help customers with their inquiries by:
    1. Searching documentation for answers
    2. Looking up their account information
    3. Creating support tickets when needed
    Always be helpful and professional.""",
    tools=[search_documents, query_database, create_ticket],
    memory=Memory(
        type="conversation",
        window_size=20
    )
)

# Run agent
async def handle_customer_query(customer_id: str, query: str):
    thread = client.threads.create()

    # Add context
    thread.add_message(
        role="system",
        content=f"Customer ID: {customer_id}"
    )

    # Add customer query
    thread.add_message(
        role="user",
        content=query
    )

    # Run agent
    run = await client.runs.create(
        thread_id=thread.id,
        agent_id=agent.id
    )

    # Wait for completion
    result = await client.runs.wait(run.id)

    return result.messages[-1].content
```

## Agent Deployment

```python
# Deploy agent as endpoint
deployment = client.deployments.create(
    agent_id=agent.id,
    name="customer-service-prod",
    compute={
        "instance_type": "Standard_DS3_v2",
        "instance_count": 2
    },
    scaling={
        "min_replicas": 1,
        "max_replicas": 10,
        "target_utilization": 70
    }
)

# Get endpoint URL
endpoint_url = deployment.scoring_uri
```

Azure AI Foundry simplifies the path from agent prototype to production deployment.
