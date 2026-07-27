---
title: "Multi-Agent Systems: Orchestrating Specialized AI Agents"
author: Michael John Peña
draft: false
date: 2025-09-14
tags:
  - AI Agents
  - Multi-Agent
  - Orchestration
  - Architecture
  - LLM

---

I wrote "Multi-Agent Systems: Orchestrating Specialized AI Agents" to share practical, production-minded guidance on this topic.

## The Orchestrator Pattern

```python
from dataclasses import dataclass
from typing import Dict, List, Callable
from enum import Enum
import asyncio

class AgentRole(Enum):
    RESEARCHER = "researcher"
    ANALYST = "analyst"
    WRITER = "writer"
    REVIEWER = "reviewer"

@dataclass
class AgentMessage:
    sender: AgentRole
    content: str
    metadata: Dict = None

@dataclass
class Agent:
    role: AgentRole
    system_prompt: str
    capabilities: List[str]

class MultiAgentOrchestrator:
    def __init__(self, client, agents: Dict[AgentRole, Agent]):
        self.client = client
        self.agents = agents
        self.conversation_history: List[AgentMessage] = []

    async def delegate_task(self, role: AgentRole, task: str,
                           context: List[AgentMessage] = None) -> AgentMessage:
        """Delegate a task to a specific agent."""
        agent = self.agents[role]

        messages = [{"role": "system", "content": agent.system_prompt}]

        # Include relevant context from other agents
        if context:
            context_text = "\n".join([
                f"[{msg.sender.value}]: {msg.content}"
                for msg in context
            ])
            messages.append({
                "role": "user",
                "content": f"Previous context:\n{context_text}\n\nYour task: {task}"
            })
        else:
            messages.append({"role": "user", "content": task})

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )

        result = AgentMessage(
            sender=role,
            content=response.choices[0].message.content
        )
        self.conversation_history.append(result)
        return result

    async def execute_workflow(self, task: str) -> str:
        """Execute a multi-agent workflow for complex tasks."""

        # Step 1: Research phase
        research = await self.delegate_task(
            AgentRole.RESEARCHER,
            f"Research the following topic and gather key facts: {task}"
        )

        # Step 2: Analysis phase
        analysis = await self.delegate_task(
            AgentRole.ANALYST,
            "Analyze the research findings and identify key insights.",
            context=[research]
        )

        # Step 3: Writing phase
        draft = await self.delegate_task(
            AgentRole.WRITER,
            "Write a comprehensive response based on the research and analysis.",
            context=[research, analysis]
        )

        # Step 4: Review phase
        final = await self.delegate_task(
            AgentRole.REVIEWER,
            "Review and improve the draft. Ensure accuracy and clarity.",
            context=[research, analysis, draft]
        )

        return final.content
```

## Defining Specialized Agents

```python
agents = {
    AgentRole.RESEARCHER: Agent(
        role=AgentRole.RESEARCHER,
        system_prompt="""You are a research specialist. Your job is to:
- Gather comprehensive information on topics
- Identify primary sources and key facts
- Note any uncertainties or conflicting information
Be thorough but concise.""",
        capabilities=["web_search", "document_retrieval"]
    ),
    AgentRole.ANALYST: Agent(
        role=AgentRole.ANALYST,
        system_prompt="""You are a data analyst. Your job is to:
- Synthesize information from multiple sources
- Identify patterns and insights
- Quantify findings where possible
Focus on actionable insights.""",
        capabilities=["data_analysis", "statistical_reasoning"]
    ),
    AgentRole.WRITER: Agent(
        role=AgentRole.WRITER,
        system_prompt="""You are a professional writer. Your job is to:
- Create clear, engaging content
- Structure information logically
- Adapt tone to the audience
Write for clarity and impact.""",
        capabilities=["content_creation", "editing"]
    )
}
```

Multi-agent architectures shine for tasks requiring diverse expertise: research reports, code reviews, complex analysis, and creative projects. The key is clear role boundaries and effective context passing between agents.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
