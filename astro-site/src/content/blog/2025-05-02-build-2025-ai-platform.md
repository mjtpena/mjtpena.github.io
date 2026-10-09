---
title: "Build 2025: Azure AI Platform Deep Dive"
description: "The new orchestration engine supports complex multi-agent workflows with built-in state management."
author: Michael John Peña
draft: false
date: 2025-05-02
tags:
  - Microsoft
  - Build
  - Azure
  - AI
  - Platform
---

## Azure AI Foundry Enhancements

### Multi-Agent Orchestration
The new orchestration engine supports complex multi-agent workflows with built-in state management.

```python
from azure.ai.foundry.orchestration import AgentOrchestrator, Workflow

# Define multi-agent workflow
workflow = Workflow("research-and-analysis")

workflow.add_agent("researcher", Agent(
    model="gpt-4o",
    instructions="Research and gather information"
))

workflow.add_agent("analyst", Agent(
    model="gpt-4o",
    instructions="Analyze information and provide insights"
))

workflow.add_agent("writer", Agent(
    model="gpt-4o",
    instructions="Write clear, concise reports"
))

# Define workflow transitions
workflow.add_transition("researcher", "analyst", condition="research_complete")
workflow.add_transition("analyst", "writer", condition="analysis_complete")

# Execute workflow
orchestrator = AgentOrchestrator(workflow)
result = await orchestrator.run("Analyze market trends for AI in healthcare")
```

### Evaluation Framework
New built-in evaluation capabilities for quality assurance.

```python
from azure.ai.foundry.evaluation import Evaluator, QualityMetrics

evaluator = Evaluator(
    metrics=[
        QualityMetrics.RELEVANCE,
        QualityMetrics.GROUNDEDNESS,
        QualityMetrics.FLUENCY,
        QualityMetrics.COHERENCE
    ]
)

# Evaluate agent responses
results = await evaluator.evaluate(
    agent=my_agent,
    test_cases=test_dataset,
    threshold=0.8
)

print(f"Pass rate: {results.pass_rate}")
print(f"Average scores: {results.average_scores}")
```

### Model Catalog Updates
- GPT-5 preview access for enterprise customers
- Claude 4 integration
- Gemini 2 support
- Expanded Phi-4 capabilities

These updates position Azure AI Foundry as the comprehensive platform for enterprise AI development.
