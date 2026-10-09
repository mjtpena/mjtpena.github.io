---
title: "Building AI Agents: From Chatbots to Autonomous Systems"
description: "AI agents represent the next evolution of AI systems. By combining planning, tool use, and memory, they can autonomously accomplish complex goals while…"
author: Michael John Pena
draft: false
date: 2023-04-30
tags:
  - AI
  - Agents
  - LLM
  - Automation
  - Python
---

## Agent Architecture

```python
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Callable
from enum import Enum
import json

class AgentState(Enum):
    IDLE = "idle"
    THINKING = "thinking"
    ACTING = "acting"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class Action:
    tool: str
    parameters: Dict[str, Any]
    reasoning: str

@dataclass
class Observation:
    action: Action
    result: Any
    success: bool
    error: Optional[str] = None

@dataclass
class AgentMemory:
    goal: str
    plan: List[str]
    actions_taken: List[Action]
    observations: List[Observation]
    current_state: AgentState

class AIAgent:
    """Autonomous AI agent with planning and tool use."""

    def __init__(
        self,
        llm_client,
        tools: Dict[str, Callable],
        max_iterations: int = 10
    ):
        self.llm = llm_client
        self.tools = tools
        self.max_iterations = max_iterations
        self.memory = None

    async def run(self, goal: str) -> dict:
        """Run agent to accomplish goal."""

        # Initialize memory
        self.memory = AgentMemory(
            goal=goal,
            plan=[],
            actions_taken=[],
            observations=[],
            current_state=AgentState.THINKING
        )

        # Create initial plan
        self.memory.plan = await self._create_plan(goal)

        # Execute loop
        iteration = 0
        while iteration < self.max_iterations:
            iteration += 1

            # Think: Decide next action
            self.memory.current_state = AgentState.THINKING
            action = await self._decide_action()

            if action is None:
                # Goal completed
                self.memory.current_state = AgentState.COMPLETED
                break

            # Act: Execute action
            self.memory.current_state = AgentState.ACTING
            observation = await self._execute_action(action)

            # Record
            self.memory.actions_taken.append(action)
            self.memory.observations.append(observation)

            # Check if failed critically
            if not observation.success and self._is_critical_failure(observation):
                self.memory.current_state = AgentState.FAILED
                break

            # Reflect and potentially replan
            should_replan = await self._should_replan(observation)
            if should_replan:
                self.memory.plan = await self._create_plan(goal)

        return self._generate_result()

    async def _create_plan(self, goal: str) -> List[str]:
        """Create plan to accomplish goal."""

        tools_description = "\n".join([
            f"- {name}: {tool.__doc__ or 'No description'}"
            for name, tool in self.tools.items()
        ])

        context = self._get_context()

        prompt = f"""Create a step-by-step plan to accomplish this goal.

Goal: {goal}

Available Tools:
{tools_description}

{f'Previous Context: {context}' if context else ''}

Create a numbered plan with specific, actionable steps.
Each step should correspond to a single tool use.
Return as JSON array of strings."""

        response = await self.llm.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        return json.loads(response.content)

    async def _decide_action(self) -> Optional[Action]:
        """Decide next action based on current state."""

        tools_description = json.dumps({
            name: {
                "description": tool.__doc__ or "No description",
                "parameters": self._get_tool_parameters(tool)
            }
            for name, tool in self.tools.items()
        }, indent=2)

        context = self._get_context()

        prompt = f"""Decide the next action to take.

Goal: {self.memory.goal}

Plan:
{json.dumps(self.memory.plan, indent=2)}

Previous Actions and Results:
{context}

Available Tools:
{tools_description}

If the goal is accomplished, return: {{"done": true, "summary": "..."}}

Otherwise, return the next action:
{{
    "tool": "tool_name",
    "parameters": {{"param1": "value1"}},
    "reasoning": "Why this action"
}}"""

        response = await self.llm.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        result = json.loads(response.content)

        if result.get("done"):
            return None

        return Action(
            tool=result["tool"],
            parameters=result["parameters"],
            reasoning=result["reasoning"]
        )

    async def _execute_action(self, action: Action) -> Observation:
        """Execute an action using a tool."""

        tool = self.tools.get(action.tool)
        if not tool:
            return Observation(
                action=action,
                result=None,
                success=False,
                error=f"Tool '{action.tool}' not found"
            )

        try:
            result = await tool(**action.parameters)
            return Observation(
                action=action,
                result=result,
                success=True
            )
        except Exception as e:
            return Observation(
                action=action,
                result=None,
                success=False,
                error=str(e)
            )

    def _get_context(self) -> str:
        """Get context from memory."""
        if not self.memory.observations:
            return ""

        context_parts = []
        for obs in self.memory.observations[-5:]:
            context_parts.append(
                f"Action: {obs.action.tool}({obs.action.parameters})\n"
                f"Result: {'Success' if obs.success else f'Failed: {obs.error}'}\n"
                f"Output: {str(obs.result)[:500]}"
            )
        return "\n\n".join(context_parts)

    def _get_tool_parameters(self, tool: Callable) -> dict:
        """Extract tool parameters from signature."""
        import inspect
        sig = inspect.signature(tool)
        return {
            name: str(param.annotation) if param.annotation != inspect.Parameter.empty else "any"
            for name, param in sig.parameters.items()
        }

    async def _should_replan(self, observation: Observation) -> bool:
        """Determine if replanning is needed."""
        if observation.success:
            return False

        prompt = f"""Should we replan based on this failed action?

Original Plan:
{json.dumps(self.memory.plan, indent=2)}

Failed Action: {observation.action.tool}({observation.action.parameters})
Error: {observation.error}

Return JSON: {{"should_replan": true/false, "reason": "..."}}"""

        response = await self.llm.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        result = json.loads(response.content)
        return result.get("should_replan", False)

    def _is_critical_failure(self, observation: Observation) -> bool:
        """Check if failure is critical."""
        critical_errors = ["unauthorized", "forbidden", "quota exceeded"]
        error_lower = (observation.error or "").lower()
        return any(err in error_lower for err in critical_errors)

    def _generate_result(self) -> dict:
        """Generate final result."""
        return {
            "goal": self.memory.goal,
            "state": self.memory.current_state.value,
            "actions_taken": len(self.memory.actions_taken),
            "final_observations": [
                {
                    "action": obs.action.tool,
                    "success": obs.success,
                    "result": str(obs.result)[:200] if obs.result else None
                }
                for obs in self.memory.observations[-3:]
            ]
        }
```

## Tool System

```python
class ToolRegistry:
    """Registry for agent tools."""

    def __init__(self):
        self.tools: Dict[str, Callable] = {}
        self.tool_metadata: Dict[str, dict] = {}

    def register(
        self,
        name: str = None,
        description: str = None,
        parameters: dict = None
    ):
        """Decorator to register a tool."""
        def decorator(func):
            tool_name = name or func.__name__

            self.tools[tool_name] = func
            self.tool_metadata[tool_name] = {
                "name": tool_name,
                "description": description or func.__doc__ or "No description",
                "parameters": parameters or self._infer_parameters(func)
            }
            return func
        return decorator

    def _infer_parameters(self, func: Callable) -> dict:
        """Infer parameters from function signature."""
        import inspect
        sig = inspect.signature(func)

        params = {}
        for name, param in sig.parameters.items():
            param_info = {"required": param.default == inspect.Parameter.empty}

            if param.annotation != inspect.Parameter.empty:
                param_info["type"] = str(param.annotation)

            params[name] = param_info

        return params

    def get_tools_for_llm(self) -> str:
        """Get tool descriptions for LLM context."""
        descriptions = []
        for name, meta in self.tool_metadata.items():
            params_str = ", ".join([
                f"{p}: {info.get('type', 'any')}"
                for p, info in meta["parameters"].items()
            ])
            descriptions.append(
                f"- {name}({params_str}): {meta['description']}"
            )
        return "\n".join(descriptions)

# Create registry
tools = ToolRegistry()

@tools.register(
    description="Search the web for information",
    parameters={"query": {"type": "string", "required": True}}
)
async def web_search(query: str) -> dict:
    """Search the web and return results."""
    # Implementation
    return {"results": [...]}

@tools.register(
    description="Read content from a URL",
    parameters={"url": {"type": "string", "required": True}}
)
async def read_url(url: str) -> str:
    """Fetch and read content from URL."""
    # Implementation
    return "Page content..."

@tools.register(
    description="Execute Python code",
    parameters={"code": {"type": "string", "required": True}}
)
async def execute_code(code: str) -> dict:
    """Execute Python code in sandbox."""
    # Implementation with safety checks
    return {"output": "...", "error": None}

@tools.register(
    description="Send an email",
    parameters={
        "to": {"type": "string", "required": True},
        "subject": {"type": "string", "required": True},
        "body": {"type": "string", "required": True}
    }
)
async def send_email(to: str, subject: str, body: str) -> dict:
    """Send email to recipient."""
    # Implementation
    return {"sent": True, "message_id": "..."}
```

## ReAct Pattern Agent

```python
class ReActAgent:
    """Agent using ReAct (Reasoning + Acting) pattern."""

    def __init__(self, llm_client, tools: Dict[str, Callable]):
        self.llm = llm_client
        self.tools = tools

    async def run(self, task: str, max_steps: int = 10) -> dict:
        """Run ReAct loop."""

        scratchpad = []

        for step in range(max_steps):
            # Generate thought and action
            thought, action = await self._think_and_act(task, scratchpad)

            scratchpad.append(f"Thought: {thought}")

            if action["type"] == "finish":
                return {
                    "success": True,
                    "answer": action["answer"],
                    "reasoning": scratchpad
                }

            scratchpad.append(f"Action: {action['tool']}[{action['input']}]")

            # Execute action
            observation = await self._execute(action)
            scratchpad.append(f"Observation: {observation}")

        return {
            "success": False,
            "error": "Max steps reached",
            "reasoning": scratchpad
        }

    async def _think_and_act(
        self,
        task: str,
        scratchpad: List[str]
    ) -> tuple:
        """Generate thought and action."""

        scratchpad_text = "\n".join(scratchpad) if scratchpad else "None yet"

        prompt = f"""You are an AI assistant that solves tasks by thinking step-by-step and taking actions.

Task: {task}

Available Actions:
- search[query]: Search for information
- lookup[term]: Look up a specific term
- calculate[expression]: Calculate a mathematical expression
- finish[answer]: Return the final answer

Previous Steps:
{scratchpad_text}

Based on the task and previous steps, provide your next thought and action.
Format:
Thought: [Your reasoning about what to do next]
Action: [action_name][input]

If you have the final answer, use: Action: finish[your answer]"""

        response = await self.llm.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        # Parse response
        lines = response.content.strip().split("\n")
        thought = ""
        action = {"type": None, "tool": None, "input": None}

        for line in lines:
            if line.startswith("Thought:"):
                thought = line[8:].strip()
            elif line.startswith("Action:"):
                action_text = line[7:].strip()
                # Parse action[input] format
                if "[" in action_text and "]" in action_text:
                    tool = action_text[:action_text.index("[")]
                    input_text = action_text[action_text.index("[")+1:-1]
                    action = {
                        "type": "finish" if tool == "finish" else "tool",
                        "tool": tool,
                        "input": input_text,
                        "answer": input_text if tool == "finish" else None
                    }

        return thought, action

    async def _execute(self, action: dict) -> str:
        """Execute action and return observation."""
        tool = self.tools.get(action["tool"])
        if not tool:
            return f"Error: Unknown tool '{action['tool']}'"

        try:
            result = await tool(action["input"])
            return str(result)
        except Exception as e:
            return f"Error: {str(e)}"
```

## Agent with Memory

```python
class MemoryAgent:
    """Agent with long-term and short-term memory."""

    def __init__(self, llm_client, embedding_client, tools: Dict[str, Callable]):
        self.llm = llm_client
        self.embedding_client = embedding_client
        self.tools = tools

        # Memory systems
        self.short_term: List[dict] = []  # Recent interactions
        self.long_term: List[dict] = []   # Important memories
        self.episodic: List[dict] = []    # Past task completions

    async def run(self, task: str) -> dict:
        """Run agent with memory context."""

        # Retrieve relevant memories
        relevant_memories = await self._retrieve_memories(task)

        # Add task to short-term
        self.short_term.append({
            "type": "task",
            "content": task,
            "timestamp": datetime.utcnow().isoformat()
        })

        # Run with memory context
        result = await self._execute_with_memory(task, relevant_memories)

        # Store experience
        await self._store_experience(task, result)

        return result

    async def _retrieve_memories(self, query: str) -> List[dict]:
        """Retrieve relevant memories."""

        # Get query embedding
        query_embedding = await self._get_embedding(query)

        # Search long-term memories
        relevant = []

        for memory in self.long_term:
            if "embedding" in memory:
                similarity = self._cosine_similarity(
                    query_embedding,
                    memory["embedding"]
                )
                if similarity > 0.7:
                    relevant.append({
                        **memory,
                        "relevance": similarity
                    })

        # Sort by relevance
        relevant.sort(key=lambda x: x["relevance"], reverse=True)

        # Include recent short-term
        recent = self.short_term[-5:]

        return relevant[:5] + recent

    async def _execute_with_memory(
        self,
        task: str,
        memories: List[dict]
    ) -> dict:
        """Execute task with memory context."""

        memory_context = "\n".join([
            f"- {m['type']}: {m['content']}"
            for m in memories
        ])

        prompt = f"""Complete this task using the available context and tools.

Task: {task}

Relevant Memories:
{memory_context if memory_context else "No relevant memories"}

Think step by step and use tools as needed."""

        # Execute agent loop
        agent = AIAgent(self.llm, self.tools)
        return await agent.run(task)

    async def _store_experience(self, task: str, result: dict):
        """Store task experience in memory."""

        experience = {
            "type": "experience",
            "task": task,
            "result": result["state"],
            "actions": result.get("actions_taken", 0),
            "timestamp": datetime.utcnow().isoformat()
        }

        # Add embedding for retrieval
        experience["embedding"] = await self._get_embedding(
            f"{task} -> {result['state']}"
        )

        # Determine if important enough for long-term
        if result["state"] == "completed":
            self.episodic.append(experience)

            # Summarize for long-term if pattern emerges
            similar_count = sum(
                1 for e in self.episodic
                if self._cosine_similarity(
                    experience["embedding"],
                    e.get("embedding", [])
                ) > 0.8
            )

            if similar_count >= 3:
                summary = await self._summarize_experiences(task)
                self.long_term.append({
                    "type": "learned_pattern",
                    "content": summary,
                    "embedding": experience["embedding"],
                    "timestamp": datetime.utcnow().isoformat()
                })

    async def _summarize_experiences(self, task: str) -> str:
        """Summarize similar experiences."""
        prompt = f"""Summarize what you've learned from completing similar tasks to: {task}

Create a concise lesson learned that would help with future similar tasks."""

        response = await self.llm.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        return response.content

# Usage
agent = MemoryAgent(llm_client, embedding_client, tools.tools)

# First task - agent learns
result1 = await agent.run("Research the latest AI developments and summarize")

# Later task - agent uses memories
result2 = await agent.run("Find recent breakthroughs in language models")
```

AI agents represent the next evolution of AI systems. By combining planning, tool use, and memory, they can autonomously accomplish complex goals while adapting to new situations.
