---
title: "Agentic AI Capabilities: From Chatbots to Autonomous Agents"
author: "Michael John Peña"
draft: false
date: 2024-10-02
tags: ["AI Agents", "Agentic AI", "Automation", "LLM", "Architecture"]

---

I wrote "Agentic AI Capabilities: From Chatbots to Autonomous Agents" to share practical, production-minded guidance on this topic.

## What Makes AI "Agentic"?

```python
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum

class AgentCapability(Enum):
    REASONING = "reasoning"          # Think through problems
    PLANNING = "planning"            # Break down goals into steps
    MEMORY = "memory"                # Remember past interactions
    TOOL_USE = "tool_use"            # Use external tools
    SELF_REFLECTION = "reflection"   # Evaluate own outputs
    LEARNING = "learning"            # Adapt from experience
    COLLABORATION = "collaboration"  # Work with other agents

@dataclass
class AgentAction:
    """Represents an action an agent can take"""
    type: str
    parameters: Dict[str, Any]
    reasoning: str
    confidence: float

class AgenticAI(ABC):
    """Base class for agentic AI systems"""

    def __init__(self, capabilities: List[AgentCapability]):
        self.capabilities = capabilities
        self.memory = []
        self.goals = []

    @abstractmethod
    def perceive(self, environment: Dict) -> Dict:
        """Perceive the current state of the environment"""
        pass

    @abstractmethod
    def plan(self, goal: str) -> List[AgentAction]:
        """Create a plan to achieve a goal"""
        pass

    @abstractmethod
    def act(self, action: AgentAction) -> Dict:
        """Execute an action"""
        pass

    @abstractmethod
    def reflect(self, action: AgentAction, result: Dict) -> None:
        """Reflect on action results"""
        pass
```

## The Planning Loop

```python
from openai import OpenAI
import json

client = OpenAI()

class PlanningAgent:
    """Agent with planning capabilities"""

    def __init__(self):
        self.plan_history = []

    def create_plan(self, goal: str, context: str = "") -> List[Dict]:
        """Create a multi-step plan for a goal"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """You are a planning agent. Create detailed action plans.
                    Return a JSON array of steps, each with:
                    - step_number: int
                    - action: string describing the action
                    - dependencies: list of step numbers this depends on
                    - success_criteria: how to know if step succeeded
                    - fallback: what to do if step fails"""
                },
                {
                    "role": "user",
                    "content": f"Goal: {goal}\n\nContext: {context}"
                }
            ],
            response_format={"type": "json_object"}
        )

        plan = json.loads(response.choices[0].message.content)
        self.plan_history.append({"goal": goal, "plan": plan})
        return plan.get("steps", [])

    def replan(self, original_goal: str, failed_step: Dict,
               error: str) -> List[Dict]:
        """Create a new plan when one fails"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """You are a planning agent. A previous plan failed.
                    Analyze the failure and create an alternative plan."""
                },
                {
                    "role": "user",
                    "content": f"""
                    Original goal: {original_goal}
                    Failed step: {json.dumps(failed_step)}
                    Error: {error}

                    Create a new plan that avoids this failure.
                    """
                }
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content).get("steps", [])
```

## Tool-Using Agent

```python
class ToolUsingAgent:
    """Agent that can select and use tools"""

    def __init__(self, tools: List[Dict]):
        self.tools = tools
        self.tool_usage_history = []

    def select_tool(self, task: str, available_tools: List[Dict] = None) -> Dict:
        """Select the best tool for a task"""

        tools_to_consider = available_tools or self.tools

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """Analyze the task and select the best tool.
                    Return JSON with:
                    - selected_tool: name of the tool
                    - reasoning: why this tool is best
                    - parameters: suggested parameters for the tool"""
                },
                {
                    "role": "user",
                    "content": f"""
                    Task: {task}

                    Available tools:
                    {json.dumps(tools_to_consider, indent=2)}
                    """
                }
            ],
            response_format={"type": "json_object"}
        )

        selection = json.loads(response.choices[0].message.content)
        self.tool_usage_history.append({"task": task, "selection": selection})
        return selection

    def compose_tools(self, complex_task: str) -> List[Dict]:
        """Compose multiple tools for a complex task"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """Break down the task into steps, each using a tool.
                    Return JSON with array of tool calls in sequence."""
                },
                {
                    "role": "user",
                    "content": f"""
                    Task: {complex_task}

                    Available tools:
                    {json.dumps(self.tools, indent=2)}
                    """
                }
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content).get("tool_sequence", [])
```

## Memory-Augmented Agent

```python
from datetime import datetime
from typing import Optional

class MemorySystem:
    """Memory system for agents"""

    def __init__(self):
        self.short_term: List[Dict] = []
        self.long_term: List[Dict] = []
        self.episodic: List[Dict] = []  # Specific experiences

    def remember(self, content: str, memory_type: str = "short_term",
                 importance: float = 0.5):
        """Store a memory"""

        memory = {
            "content": content,
            "timestamp": datetime.now().isoformat(),
            "importance": importance,
            "access_count": 0
        }

        if memory_type == "short_term":
            self.short_term.append(memory)
            # Consolidate to long-term if important
            if importance > 0.7:
                self.long_term.append(memory)
        elif memory_type == "episodic":
            self.episodic.append(memory)

    def recall(self, query: str, k: int = 5) -> List[Dict]:
        """Recall relevant memories"""

        # Combine all memories
        all_memories = self.short_term + self.long_term + self.episodic

        # Use embedding similarity for recall
        query_embedding = self._get_embedding(query)
        scored_memories = []

        for memory in all_memories:
            memory_embedding = self._get_embedding(memory["content"])
            similarity = self._cosine_similarity(query_embedding, memory_embedding)
            scored_memories.append((memory, similarity))

        # Sort by similarity and return top k
        scored_memories.sort(key=lambda x: x[1], reverse=True)
        return [m[0] for m in scored_memories[:k]]

    def _get_embedding(self, text: str) -> List[float]:
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        import numpy as np
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

class MemoryAgent:
    """Agent with memory capabilities"""

    def __init__(self):
        self.memory = MemorySystem()

    def process_with_memory(self, query: str) -> str:
        """Process query using relevant memories"""

        # Recall relevant memories
        memories = self.memory.recall(query)
        memory_context = "\n".join([m["content"] for m in memories])

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are an agent with memory.
                    Relevant memories:
                    {memory_context}

                    Use these memories to inform your response."""
                },
                {"role": "user", "content": query}
            ]
        )

        answer = response.choices[0].message.content

        # Remember this interaction
        self.memory.remember(
            f"User asked: {query}\nI responded: {answer[:200]}...",
            memory_type="episodic",
            importance=0.5
        )

        return answer
```

## Self-Reflecting Agent

```python
class SelfReflectingAgent:
    """Agent that can evaluate and improve its own outputs"""

    def generate_with_reflection(self, task: str, max_iterations: int = 3) -> str:
        """Generate output with self-reflection loop"""

        current_output = self._initial_generation(task)

        for i in range(max_iterations):
            # Reflect on output
            critique = self._reflect(task, current_output)

            # Check if good enough
            if critique["score"] >= 0.9:
                break

            # Improve based on critique
            current_output = self._improve(task, current_output, critique)

        return current_output

    def _initial_generation(self, task: str) -> str:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": task}]
        )
        return response.choices[0].message.content

    def _reflect(self, task: str, output: str) -> Dict:
        """Critique the current output"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """Evaluate this output for the given task.
                    Return JSON with:
                    - score: 0-1 quality score
                    - strengths: list of strengths
                    - weaknesses: list of weaknesses
                    - suggestions: specific improvements"""
                },
                {
                    "role": "user",
                    "content": f"Task: {task}\n\nOutput: {output}"
                }
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    def _improve(self, task: str, output: str, critique: Dict) -> str:
        """Improve output based on critique"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Improve the output based on the critique provided."
                },
                {
                    "role": "user",
                    "content": f"""
                    Original task: {task}
                    Current output: {output}
                    Critique: {json.dumps(critique)}

                    Provide an improved version addressing the weaknesses.
                    """
                }
            ]
        )

        return response.choices[0].message.content
```

Agentic capabilities transform AI from a question-answering system into an autonomous problem-solver. The key is combining planning, tools, memory, and reflection into a coherent system.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
