---
title: "Advanced Agent Patterns: Complex Multi-Agent Systems"
description: "Choose the right execution pattern based on task complexity and agent capabilities."
author: Michael John Peña
draft: false
date: 2025-06-02
tags:
  - AI
  - Agents
  - Patterns
  - Multi-Agent
  - Architecture
---

## Advanced Agent Architectures

```python
from typing import List, Dict, Protocol
from dataclasses import dataclass
import asyncio

class Agent(Protocol):
    async def process(self, task: Dict) -> Dict: ...
    async def collaborate(self, agents: List['Agent'], context: Dict) -> Dict: ...

@dataclass
class AgentMessage:
    sender: str
    recipient: str
    content: Dict
    message_type: str  # "request", "response", "broadcast"

class AgentOrchestrator:
    def __init__(self):
        self.agents: Dict[str, Agent] = {}
        self.message_queue = asyncio.Queue()

    def register_agent(self, name: str, agent: Agent):
        self.agents[name] = agent

    async def hierarchical_execution(self, task: Dict) -> Dict:
        """Execute with manager-worker hierarchy."""
        # Manager analyzes and delegates
        manager = self.agents["manager"]
        plan = await manager.process({"action": "plan", "task": task})

        # Workers execute subtasks
        results = []
        for subtask in plan["subtasks"]:
            worker = self.agents[subtask["assigned_to"]]
            result = await worker.process(subtask)
            results.append(result)

        # Manager synthesizes results
        final = await manager.process({
            "action": "synthesize",
            "results": results
        })

        return final

    async def collaborative_execution(self, task: Dict) -> Dict:
        """Execute with peer collaboration."""
        # All agents work together
        agents = list(self.agents.values())

        # Round-robin discussion
        context = {"task": task, "contributions": []}

        for round in range(3):  # 3 rounds of discussion
            for agent in agents:
                contribution = await agent.collaborate(agents, context)
                context["contributions"].append(contribution)

        # Consensus building
        return await self.build_consensus(context)

    async def pipeline_execution(self, task: Dict) -> Dict:
        """Execute as sequential pipeline."""
        pipeline = ["researcher", "analyst", "writer", "reviewer"]

        current_output = task
        for stage in pipeline:
            agent = self.agents[stage]
            current_output = await agent.process(current_output)

        return current_output

    async def parallel_execution(self, task: Dict) -> Dict:
        """Execute agents in parallel with merge."""
        tasks = [
            agent.process(task)
            for agent in self.agents.values()
        ]

        results = await asyncio.gather(*tasks)

        # Merge results
        return await self.merge_results(results)
```

Choose the right execution pattern based on task complexity and agent capabilities.
