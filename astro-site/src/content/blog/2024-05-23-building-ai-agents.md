---
title: "Building AI Agents: From Simple to Sophisticated"
author: Michael John Peña
draft: false
date: 2024-05-23
tags:
  - AI Agents
  - Azure AI
  - LangChain
  - Autonomous AI
  - Architecture
---

AI agents are systems that can take actions autonomously to achieve goals. Today I'm exploring how to build agents from simple tool-using assistants to complex autonomous systems.

## Agent Architecture Levels

```
Level 1: Tool-Augmented LLM
└── LLM + function calling

Level 2: ReAct Agent
└── Reasoning + Acting loop

Level 3: Planning Agent
└── Task decomposition + execution

Level 4: Multi-Agent System
└── Specialized agents collaborating

Level 5: Autonomous Agent
└── Self-directed goal pursuit
```

## Level 1: Tool-Augmented LLM

```python
from openai import AzureOpenAI
import json

client = AzureOpenAI(
    api_version="2024-05-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"]
)

# Define tools
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": "Search internal documents",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_sql",
            "description": "Execute SQL query on analytics database",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "SQL query"}
                },
                "required": ["query"]
            }
        }
    }
]

def tool_augmented_chat(user_message: str) -> str:
    messages = [
        {"role": "system", "content": "You help users with data analysis. Use tools when needed."},
        {"role": "user", "content": user_message}
    ]

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice="auto"
    )

    # Handle tool calls
    while response.choices[0].message.tool_calls:
        tool_calls = response.choices[0].message.tool_calls
        messages.append(response.choices[0].message)

        for tool_call in tool_calls:
            result = execute_tool(tool_call.function.name, tool_call.function.arguments)
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result)
            })

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=tools
        )

    return response.choices[0].message.content

def execute_tool(name: str, arguments: str) -> dict:
    args = json.loads(arguments)
    if name == "search_documents":
        return search_documents(args["query"])
    elif name == "run_sql":
        return run_sql(args["query"])
    return {"error": "Unknown tool"}
```

## Level 2: ReAct Agent

```python
class ReActAgent:
    """Reasoning and Acting agent pattern."""

    def __init__(self, client, tools: list):
        self.client = client
        self.tools = {t["function"]["name"]: t for t in tools}
        self.max_iterations = 10

    def run(self, goal: str) -> str:
        system_prompt = """You are an AI agent that solves problems step by step.
For each step:
1. Thought: Reason about what to do next
2. Action: Choose a tool and parameters
3. Observation: Review the result
4. Repeat until you have the answer

When you have the final answer, respond with:
Final Answer: [your answer]
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Goal: {goal}"}
        ]

        for i in range(self.max_iterations):
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=list(self.tools.values()),
                tool_choice="auto"
            )

            assistant_message = response.choices[0].message
            messages.append(assistant_message)

            # Check for final answer
            if assistant_message.content and "Final Answer:" in assistant_message.content:
                return assistant_message.content.split("Final Answer:")[-1].strip()

            # Execute tool calls
            if assistant_message.tool_calls:
                for tool_call in assistant_message.tool_calls:
                    result = self._execute_tool(
                        tool_call.function.name,
                        tool_call.function.arguments
                    )
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result)
                    })

        return "Max iterations reached without final answer"

    def _execute_tool(self, name: str, arguments: str) -> dict:
        # Tool execution logic
        pass
```

## Level 3: Planning Agent

```python
class PlanningAgent:
    """Agent that creates and executes plans."""

    def __init__(self, client, tools: list):
        self.client = client
        self.tools = tools

    def solve(self, goal: str) -> str:
        # Step 1: Create a plan
        plan = self._create_plan(goal)
        print(f"Plan created with {len(plan)} steps")

        # Step 2: Execute plan
        results = []
        for i, step in enumerate(plan):
            print(f"Executing step {i+1}: {step['description']}")
            result = self._execute_step(step, results)
            results.append(result)

        # Step 3: Synthesize results
        return self._synthesize(goal, plan, results)

    def _create_plan(self, goal: str) -> list:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """Create a step-by-step plan to achieve the goal.
Return JSON array of steps:
[
    {"step": 1, "description": "...", "tool": "tool_name", "depends_on": []},
    {"step": 2, "description": "...", "tool": "tool_name", "depends_on": [1]}
]"""
                },
                {"role": "user", "content": f"Goal: {goal}\n\nAvailable tools: {self._tool_descriptions()}"}
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)["steps"]

    def _execute_step(self, step: dict, previous_results: list) -> dict:
        # Get context from dependent steps
        context = ""
        for dep in step.get("depends_on", []):
            context += f"\nResult from step {dep}: {previous_results[dep-1]}"

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"Execute this step: {step['description']}\nContext: {context}"
                }
            ],
            tools=[t for t in self.tools if t["function"]["name"] == step.get("tool")],
            tool_choice="auto"
        )

        # Execute any tool calls and return result
        return self._handle_response(response)

    def _synthesize(self, goal: str, plan: list, results: list) -> str:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Synthesize the results to answer the original goal."
                },
                {
                    "role": "user",
                    "content": f"Goal: {goal}\n\nPlan and results:\n{json.dumps(list(zip(plan, results)), indent=2)}"
                }
            ]
        )
        return response.choices[0].message.content
```

## Level 4: Multi-Agent System

```python
from dataclasses import dataclass
from typing import Optional
from enum import Enum

class AgentRole(Enum):
    RESEARCHER = "researcher"
    ANALYST = "analyst"
    WRITER = "writer"
    REVIEWER = "reviewer"

@dataclass
class AgentMessage:
    from_agent: AgentRole
    to_agent: Optional[AgentRole]
    content: str
    artifacts: Optional[dict] = None

class MultiAgentSystem:
    """Coordinated multi-agent system."""

    def __init__(self, client):
        self.client = client
        self.agents = self._create_agents()
        self.message_queue = []

    def _create_agents(self) -> dict:
        return {
            AgentRole.RESEARCHER: {
                "instructions": "You research topics and gather information.",
                "tools": ["search_web", "search_docs"]
            },
            AgentRole.ANALYST: {
                "instructions": "You analyze data and find patterns.",
                "tools": ["run_sql", "create_chart"]
            },
            AgentRole.WRITER: {
                "instructions": "You write clear, professional content.",
                "tools": ["format_document"]
            },
            AgentRole.REVIEWER: {
                "instructions": "You review content for accuracy and quality.",
                "tools": ["fact_check"]
            }
        }

    async def execute_workflow(self, task: str) -> str:
        # Coordinator determines workflow
        workflow = await self._plan_workflow(task)

        results = {}
        for step in workflow:
            agent_role = AgentRole(step["agent"])
            result = await self._run_agent(
                agent_role,
                step["task"],
                {k: results[k] for k in step.get("inputs", [])}
            )
            results[step["id"]] = result

        return results.get("final", "")

    async def _plan_workflow(self, task: str) -> list:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""Plan a workflow for this task using available agents: {[a.value for a in AgentRole]}.
Return JSON:
{{
    "steps": [
        {{"id": "step1", "agent": "researcher", "task": "...", "inputs": []}},
        {{"id": "step2", "agent": "analyst", "task": "...", "inputs": ["step1"]}},
        {{"id": "final", "agent": "writer", "task": "...", "inputs": ["step2"]}}
    ]
}}"""
                },
                {"role": "user", "content": task}
            ],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)["steps"]

    async def _run_agent(self, role: AgentRole, task: str, inputs: dict) -> str:
        agent_config = self.agents[role]

        messages = [
            {"role": "system", "content": agent_config["instructions"]},
            {
                "role": "user",
                "content": f"Task: {task}\n\nInputs: {json.dumps(inputs)}"
            }
        ]

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )

        return response.choices[0].message.content
```

## Level 5: Autonomous Agent

```python
class AutonomousAgent:
    """Self-directed agent with goals and reflection."""

    def __init__(self, client, name: str, goals: list):
        self.client = client
        self.name = name
        self.goals = goals
        self.memory = []
        self.task_queue = []

    async def run(self, max_iterations: int = 50):
        for i in range(max_iterations):
            # Reflect on progress
            reflection = await self._reflect()

            if reflection["goals_complete"]:
                print(f"All goals achieved after {i} iterations")
                return self._get_final_output()

            # Plan next action
            action = await self._plan_next_action(reflection)

            # Execute action
            result = await self._execute_action(action)

            # Store in memory
            self.memory.append({
                "iteration": i,
                "reflection": reflection,
                "action": action,
                "result": result
            })

            # Check for blockers
            if await self._is_blocked(result):
                await self._handle_blocker(result)

    async def _reflect(self) -> dict:
        recent_memory = self.memory[-10:] if len(self.memory) > 10 else self.memory

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""Reflect on progress toward goals: {self.goals}

Return JSON:
{{
    "goals_complete": false,
    "progress": {{"goal_1": 0.5, "goal_2": 0.2}},
    "blockers": [],
    "next_priority": "goal_1"
}}"""
                },
                {
                    "role": "user",
                    "content": f"Recent activity: {json.dumps(recent_memory)}"
                }
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def _plan_next_action(self, reflection: dict) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """Plan the next action to make progress.
Return JSON:
{
    "action": "action_name",
    "parameters": {},
    "reasoning": "why this action"
}"""
                },
                {
                    "role": "user",
                    "content": f"Reflection: {json.dumps(reflection)}\nGoals: {self.goals}"
                }
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)
```

## Best Practices

1. **Start simple** - Begin with Level 1, add complexity as needed
2. **Clear boundaries** - Define what agents can and cannot do
3. **Human in the loop** - Critical decisions should involve humans
4. **Logging everything** - Essential for debugging and auditing
5. **Fail safely** - Agents should fail gracefully

## What's Next

Tomorrow I'll cover agent orchestration patterns in more depth.

## Resources

- [ReAct Paper](https://arxiv.org/abs/2210.03629)
- [LangChain Agents](https://python.langchain.com/docs/modules/agents/)
- [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
