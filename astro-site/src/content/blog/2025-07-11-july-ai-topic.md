---
title: "Building Multi-Agent Systems with Azure AI Foundry Orchestration"
description: "Azure AI Foundry provides trace visualization showing the complete agent interaction graph, making it easy to debug complex workflows and optimize handoff…"
author: Michael John Peña
draft: false
date: 2025-07-11
tags:
  - Azure AI Foundry
  - Multi-Agent Systems
  - AI Orchestration
  - Python
  - Enterprise AI
---

## Defining Agent Roles

Each agent specializes in a specific domain, with clear handoff protocols:

```python
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import Agent, AgentOrchestrator, HandoffRule

project = AIProjectClient(subscription_id, resource_group, project_name, credential)

# Define specialized agents
research_agent = Agent(
    name="research-agent",
    model="gpt-4o",
    instructions="""You research and gather information.
    When you have comprehensive findings, hand off to the analyst.""",
    tools=[{"type": "web_search"}, {"type": "knowledge_base", "id": "kb-docs"}]
)

analyst_agent = Agent(
    name="analyst-agent",
    model="claude-sonnet-4-20250514",
    instructions="""You analyze research findings and create structured reports.
    When analysis is complete, hand off to the writer.""",
    tools=[{"type": "code_interpreter"}]
)

writer_agent = Agent(
    name="writer-agent",
    model="gpt-4o",
    instructions="""You create polished, user-friendly content from analysis.
    You produce the final deliverable.""",
    tools=[]
)

# Create orchestrator with handoff rules
orchestrator = AgentOrchestrator(
    name="content-pipeline",
    agents=[research_agent, analyst_agent, writer_agent],
    entry_agent="research-agent",
    handoff_rules=[
        HandoffRule(
            from_agent="research-agent",
            to_agent="analyst-agent",
            condition="research_complete"
        ),
        HandoffRule(
            from_agent="analyst-agent",
            to_agent="writer-agent",
            condition="analysis_complete"
        )
    ],
    max_iterations=10,
    timeout_seconds=300
)

pipeline = project.orchestrators.create(orchestrator)
```

## Running the Pipeline

Execute the multi-agent workflow with a single request:

```python
async def process_request(topic: str):
    result = await project.orchestrators.run(
        orchestrator_id=pipeline.id,
        input_message=f"Create a comprehensive report on: {topic}",
        stream=True
    )

    async for event in result:
        print(f"[{event.agent}] {event.message}")

    return result.final_output
```

## Monitoring and Debugging

Azure AI Foundry provides trace visualization showing the complete agent interaction graph, making it easy to debug complex workflows and optimize handoff conditions.
