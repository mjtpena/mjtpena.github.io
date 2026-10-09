---
title: "Multi-Agent Frameworks: Orchestrating AI Agent Collaboration"
description: "Multi-agent systems unlock sophisticated automation capabilities. Start with simple patterns and evolve complexity as needed."
author: Michael John Peña
draft: false
date: 2024-11-11
tags:
  - Azure
  - AI
  - Multi-Agent
  - AI Agents
  - Orchestration
---

## Multi-Agent Architecture Patterns

### Pattern 1: Sequential Pipeline

```
Agent A → Agent B → Agent C → Result
(Research)  (Analyze)  (Report)
```

```python
from azure.ai.foundry.agents import Agent, Pipeline

class SequentialPipeline:
    """Agents execute in sequence, passing results forward."""

    def __init__(self, agents: list[Agent]):
        self.agents = agents

    async def run(self, initial_input: str) -> dict:
        current_input = initial_input
        results = []

        for agent in self.agents:
            result = await agent.run(current_input)
            results.append({
                "agent": agent.name,
                "input": current_input,
                "output": result.output
            })
            current_input = result.output

        return {
            "final_output": current_input,
            "pipeline_trace": results
        }

# Create specialized agents
research_agent = Agent(
    name="Researcher",
    model="gpt-4o",
    instructions="Research the given topic thoroughly. Output key findings."
)

analysis_agent = Agent(
    name="Analyst",
    model="gpt-4o",
    instructions="Analyze the research findings. Identify patterns and insights."
)

writer_agent = Agent(
    name="Writer",
    model="gpt-4o",
    instructions="Create a professional report from the analysis."
)

pipeline = SequentialPipeline([research_agent, analysis_agent, writer_agent])
result = await pipeline.run("Azure Fabric adoption trends in 2024")
```

### Pattern 2: Parallel Execution

```
         ┌→ Agent A ─┐
Input ───┼→ Agent B ──┼→ Aggregator → Result
         └→ Agent C ─┘
```

```python
import asyncio

class ParallelAgents:
    """Agents execute in parallel, results are aggregated."""

    def __init__(self, agents: list[Agent], aggregator: Agent):
        self.agents = agents
        self.aggregator = aggregator

    async def run(self, task: str) -> str:
        # Run all agents in parallel
        tasks = [agent.run(task) for agent in self.agents]
        results = await asyncio.gather(*tasks)

        # Aggregate results
        combined_input = "\n\n".join([
            f"=== {agent.name} Analysis ===\n{result.output}"
            for agent, result in zip(self.agents, results)
        ])

        aggregation_prompt = f"""Multiple experts have analyzed the following task:
Task: {task}

Expert Analyses:
{combined_input}

Synthesize these perspectives into a comprehensive response."""

        final_result = await self.aggregator.run(aggregation_prompt)
        return final_result.output

# Create parallel experts
technical_agent = Agent(
    name="TechnicalExpert",
    instructions="Analyze from a technical architecture perspective."
)

business_agent = Agent(
    name="BusinessExpert",
    instructions="Analyze from a business value and ROI perspective."
)

security_agent = Agent(
    name="SecurityExpert",
    instructions="Analyze from a security and compliance perspective."
)

synthesizer = Agent(
    name="Synthesizer",
    instructions="Combine multiple expert perspectives into actionable recommendations."
)

parallel_system = ParallelAgents(
    agents=[technical_agent, business_agent, security_agent],
    aggregator=synthesizer
)

result = await parallel_system.run("Should we migrate our data warehouse to Microsoft Fabric?")
```

### Pattern 3: Router-Based Dispatch

```
              ┌→ Agent A (SQL)
Input → Router┼→ Agent B (Python)
              └→ Agent C (Analysis)
```

```python
from azure.ai.foundry.agents import Router, RoutingStrategy

class SemanticRouter:
    """Route tasks to the most appropriate agent."""

    def __init__(self, agents: dict[str, Agent], router_model: str = "gpt-4o"):
        self.agents = agents
        self.router_model = router_model

    async def route(self, task: str) -> str:
        # Use LLM to classify the task
        routing_prompt = f"""Classify this task and select the best agent.

Available agents:
{self._format_agent_descriptions()}

Task: {task}

Respond with just the agent name."""

        classification = await self.client.chat.complete(
            model=self.router_model,
            messages=[{"role": "user", "content": routing_prompt}]
        )

        agent_name = classification.choices[0].message.content.strip()

        if agent_name not in self.agents:
            agent_name = "default"

        return await self.agents[agent_name].run(task)

    def _format_agent_descriptions(self) -> str:
        return "\n".join([
            f"- {name}: {agent.instructions[:100]}..."
            for name, agent in self.agents.items()
        ])

# Create specialized agents
sql_agent = Agent(
    name="SQLExpert",
    instructions="You write and optimize SQL queries for data warehouses."
)

python_agent = Agent(
    name="PythonExpert",
    instructions="You write Python code for data processing and analysis."
)

visualization_agent = Agent(
    name="VisualizationExpert",
    instructions="You create data visualizations and dashboards."
)

router = SemanticRouter({
    "SQLExpert": sql_agent,
    "PythonExpert": python_agent,
    "VisualizationExpert": visualization_agent,
    "default": sql_agent
})

result = await router.route("Write a query to find duplicate customer records")
```

### Pattern 4: Hierarchical Teams

```
        Supervisor
       /    |    \
   Lead A  Lead B  Lead C
   /   \     |      |
  A1   A2    B1    C1
```

```python
class AgentTeam:
    """Hierarchical team with supervisor and workers."""

    def __init__(
        self,
        supervisor: Agent,
        workers: dict[str, Agent],
        max_delegation_depth: int = 2
    ):
        self.supervisor = supervisor
        self.workers = workers
        self.max_depth = max_delegation_depth

    async def run(self, task: str, depth: int = 0) -> dict:
        if depth >= self.max_depth:
            # Direct execution at max depth
            return await self.supervisor.run(task)

        # Supervisor decides how to handle
        planning_prompt = f"""You are a team supervisor. Decide how to handle this task.

Available team members:
{self._format_workers()}

Task: {task}

Options:
1. Handle it yourself
2. Delegate to a team member
3. Break into subtasks for multiple team members

Respond in JSON:
{{"action": "self|delegate|split", "assignments": [{{"worker": "name", "subtask": "description"}}]}}"""

        decision = await self.supervisor.run(planning_prompt)
        plan = json.loads(decision.output)

        if plan["action"] == "self":
            return await self.supervisor.run(task)

        elif plan["action"] == "delegate":
            assignment = plan["assignments"][0]
            worker = self.workers[assignment["worker"]]
            return await worker.run(assignment["subtask"])

        else:  # split
            results = []
            for assignment in plan["assignments"]:
                worker = self.workers[assignment["worker"]]
                result = await worker.run(assignment["subtask"])
                results.append({
                    "worker": assignment["worker"],
                    "task": assignment["subtask"],
                    "result": result.output
                })

            # Supervisor synthesizes
            synthesis_prompt = f"""Original task: {task}

Subtask results:
{json.dumps(results, indent=2)}

Synthesize into a final response."""

            return await self.supervisor.run(synthesis_prompt)
```

## Building a Data Engineering Multi-Agent System

```python
class DataEngineeringTeam:
    """Complete data engineering multi-agent system."""

    def __init__(self):
        self.schema_agent = Agent(
            name="SchemaAnalyst",
            model="gpt-4o",
            instructions="Analyze database schemas and data models.",
            tools=[SchemaInspectorTool()]
        )

        self.query_agent = Agent(
            name="QueryWriter",
            model="gpt-4o",
            instructions="Write optimized SQL queries.",
            tools=[SQLExecutorTool()]
        )

        self.pipeline_agent = Agent(
            name="PipelineDesigner",
            model="gpt-4o",
            instructions="Design data pipelines and ETL processes."
        )

        self.quality_agent = Agent(
            name="QualityAnalyst",
            model="gpt-4o",
            instructions="Assess data quality and suggest improvements.",
            tools=[DataProfilingTool()]
        )

        self.coordinator = Agent(
            name="Coordinator",
            model="gpt-4o",
            instructions="""You coordinate a data engineering team.
            Delegate tasks appropriately and synthesize results."""
        )

    async def handle_request(self, request: str) -> str:
        # Coordinator decides approach
        plan = await self.coordinator.run(f"Plan approach for: {request}")

        # Execute based on plan
        if "schema" in plan.output.lower():
            schema_result = await self.schema_agent.run(request)

        if "query" in plan.output.lower():
            query_result = await self.query_agent.run(request)

        if "pipeline" in plan.output.lower():
            pipeline_result = await self.pipeline_agent.run(request)

        if "quality" in plan.output.lower():
            quality_result = await self.quality_agent.run(request)

        # Coordinator synthesizes
        synthesis = await self.coordinator.run(
            f"Synthesize team results for: {request}"
        )

        return synthesis.output

# Usage
team = DataEngineeringTeam()
result = await team.handle_request(
    "Design a customer 360 data pipeline with quality checks"
)
```

## Handling Inter-Agent Communication

```python
from dataclasses import dataclass
from typing import Any
from collections import deque

@dataclass
class Message:
    sender: str
    recipient: str
    content: Any
    message_type: str  # "request", "response", "broadcast"

class MessageBus:
    """Central communication hub for agents."""

    def __init__(self):
        self.queues: dict[str, deque] = {}
        self.handlers: dict[str, callable] = {}

    def register(self, agent_name: str, handler: callable):
        self.queues[agent_name] = deque()
        self.handlers[agent_name] = handler

    async def send(self, message: Message):
        if message.recipient == "broadcast":
            for queue in self.queues.values():
                queue.append(message)
        else:
            self.queues[message.recipient].append(message)

    async def process(self, agent_name: str):
        while self.queues[agent_name]:
            message = self.queues[agent_name].popleft()
            response = await self.handlers[agent_name](message)
            if response:
                await self.send(response)

# Usage
bus = MessageBus()
bus.register("QueryAgent", query_agent_handler)
bus.register("SchemaAgent", schema_agent_handler)

await bus.send(Message(
    sender="Coordinator",
    recipient="QueryAgent",
    content="Write a customer segmentation query",
    message_type="request"
))
```

Multi-agent systems unlock sophisticated automation capabilities. Start with simple patterns and evolve complexity as needed.

## Resources

- [Multi-Agent Patterns](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/multi-agent)
- [AutoGen Framework](https://github.com/microsoft/autogen)
- [Agent Communication Protocols](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/communication)
