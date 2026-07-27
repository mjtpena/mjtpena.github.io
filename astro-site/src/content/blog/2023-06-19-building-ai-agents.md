---
title: "Building AI Agents: From Chatbots to Autonomous Assistants"
author: Michael John Peña
draft: false
date: 2023-06-19
tags:
  - AI Agents
  - Azure OpenAI
  - LLM
  - Automation
  - Architecture
---

Function calling, released last week with the 0613 model versions, gives AI agents a proper foundation — and I've been rebuilding some agent prototypes to take advantage of it. The core agent loop is: the model reasons about which tool to call, you execute the tool and return the result, the model synthesises a response or decides to call another tool. What makes an agent work well isn't just the reasoning model — it's the quality of the tool definitions, the specificity of the system prompt about when and how to use each tool, and the error handling when tools fail. I've been working through ReAct (Reason + Act), Plan-and-Execute, and multi-agent patterns this week and the architectures feel much more tractable now that function calling removes the brittle text-parsing layer from the loop.

## Agent Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AI Agent                           │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              Perception Layer                    ││
│  │  - User input parsing                            ││
│  │  - Context understanding                         ││
│  │  - Intent recognition                            ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────▼───────────────────────────┐│
│  │              Reasoning Layer                     ││
│  │  - Task decomposition                            ││
│  │  - Planning                                      ││
│  │  - Decision making                               ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────▼───────────────────────────┐│
│  │              Action Layer                        ││
│  │  - Tool selection                                ││
│  │  - Function execution                            ││
│  │  - Result processing                             ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────▼───────────────────────────┐│
│  │              Memory Layer                        ││
│  │  - Conversation history                          ││
│  │  - Knowledge retrieval                           ││
│  │  - Learning from interactions                    ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## ReAct Pattern (Reasoning + Acting)

```python
class ReActAgent:
    """Agent that reasons about actions before taking them"""

    def __init__(self, client, tools):
        self.client = client
        self.tools = tools
        self.max_steps = 10

    def run(self, task: str) -> str:
        """Execute task using ReAct pattern"""

        system_prompt = """You are an AI assistant that solves problems step by step.

For each step, you should:
1. THOUGHT: Think about what you need to do next
2. ACTION: Choose an action to take (or FINISH if done)
3. OBSERVATION: See the result of your action

Available actions:
{tools}

Always follow this format:
THOUGHT: [your reasoning]
ACTION: [tool_name](arguments)
or
THOUGHT: [your reasoning]
ACTION: FINISH(final_answer)
"""

        tools_desc = "\n".join([
            f"- {name}: {tool['description']}"
            for name, tool in self.tools.items()
        ])

        messages = [
            {"role": "system", "content": system_prompt.format(tools=tools_desc)},
            {"role": "user", "content": f"Task: {task}"}
        ]

        for step in range(self.max_steps):
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=messages,
                temperature=0
            )

            assistant_response = response.choices[0].message.content
            messages.append({"role": "assistant", "content": assistant_response})

            # Parse response
            if "ACTION: FINISH" in assistant_response:
                # Extract final answer
                final_answer = self.extract_finish(assistant_response)
                return final_answer

            # Execute action
            action = self.parse_action(assistant_response)
            if action:
                result = self.execute_action(action["tool"], action["args"])
                observation = f"OBSERVATION: {result}"
                messages.append({"role": "user", "content": observation})
            else:
                messages.append({"role": "user", "content": "OBSERVATION: Could not parse action. Please try again."})

        return "Agent reached maximum steps without completing the task."

    def parse_action(self, response: str) -> dict:
        """Parse action from response"""
        import re
        match = re.search(r'ACTION:\s*(\w+)\((.*?)\)', response)
        if match:
            return {
                "tool": match.group(1),
                "args": match.group(2)
            }
        return None

    def execute_action(self, tool_name: str, args: str) -> str:
        """Execute the specified tool"""
        if tool_name not in self.tools:
            return f"Unknown tool: {tool_name}"

        try:
            return self.tools[tool_name]["function"](args)
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"

    def extract_finish(self, response: str) -> str:
        """Extract final answer from FINISH action"""
        import re
        match = re.search(r'FINISH\((.*?)\)', response, re.DOTALL)
        return match.group(1) if match else response
```

## Plan-and-Execute Pattern

```python
class PlanExecuteAgent:
    """Agent that creates a plan then executes it"""

    def __init__(self, client, tools):
        self.client = client
        self.tools = tools

    def create_plan(self, task: str) -> list:
        """Create a plan for the task"""

        planning_prompt = f"""Create a step-by-step plan to accomplish this task:

Task: {task}

Available tools:
{self._format_tools()}

Return a JSON array of steps, each with:
- step_number: int
- description: what this step accomplishes
- tool: which tool to use (or "none" for reasoning)
- inputs: what inputs are needed

Example:
[
  {{"step_number": 1, "description": "Search for...", "tool": "search", "inputs": "query"}},
  {{"step_number": 2, "description": "Process...", "tool": "none", "inputs": "step 1 result"}}
]
"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": planning_prompt}],
            temperature=0
        )

        plan_text = response.choices[0].message.content
        return json.loads(plan_text)

    def execute_plan(self, plan: list, task: str) -> str:
        """Execute the plan step by step"""

        results = {}
        messages = [
            {"role": "system", "content": "You are executing a plan step by step."},
            {"role": "user", "content": f"Original task: {task}"}
        ]

        for step in plan:
            step_num = step["step_number"]
            tool_name = step.get("tool")

            if tool_name and tool_name != "none":
                # Execute tool
                tool_input = self._resolve_inputs(step["inputs"], results)
                result = self.tools[tool_name]["function"](tool_input)
                results[f"step_{step_num}"] = result
                messages.append({
                    "role": "assistant",
                    "content": f"Step {step_num}: {step['description']}\nResult: {result}"
                })
            else:
                # Reasoning step
                reasoning_prompt = f"""
Step {step_num}: {step['description']}
Previous results: {json.dumps(results)}
What is the conclusion for this step?
"""
                response = self.client.chat.completions.create(
                    model="gpt-4",
                    messages=messages + [{"role": "user", "content": reasoning_prompt}],
                    temperature=0
                )
                result = response.choices[0].message.content
                results[f"step_{step_num}"] = result

        # Generate final answer
        final_prompt = f"""
Task: {task}
Execution results: {json.dumps(results, indent=2)}

Based on these results, provide the final answer.
"""
        final_response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": final_prompt}],
            temperature=0
        )

        return final_response.choices[0].message.content

    def run(self, task: str) -> str:
        """Create plan and execute"""
        print("Creating plan...")
        plan = self.create_plan(task)
        print(f"Plan created with {len(plan)} steps")

        print("Executing plan...")
        result = self.execute_plan(plan, task)

        return result

    def _format_tools(self) -> str:
        return "\n".join([
            f"- {name}: {tool['description']}"
            for name, tool in self.tools.items()
        ])

    def _resolve_inputs(self, inputs: str, results: dict) -> str:
        """Resolve references to previous step results"""
        for key, value in results.items():
            inputs = inputs.replace(f"${{{key}}}", str(value))
        return inputs
```

## Memory-Augmented Agent

```python
class MemoryAugmentedAgent:
    """Agent with short-term and long-term memory"""

    def __init__(self, client, vector_store):
        self.client = client
        self.vector_store = vector_store
        self.short_term_memory = []  # Recent conversation
        self.working_memory = {}  # Current task context

    def add_to_long_term_memory(self, content: str, metadata: dict = None):
        """Store information in vector database"""
        embedding = self._get_embedding(content)
        self.vector_store.add(
            content=content,
            embedding=embedding,
            metadata=metadata or {}
        )

    def recall_from_memory(self, query: str, k: int = 5) -> list:
        """Retrieve relevant memories"""
        query_embedding = self._get_embedding(query)
        results = self.vector_store.search(query_embedding, k=k)
        return results

    def chat(self, user_message: str) -> str:
        """Chat with memory retrieval"""

        # Add to short-term memory
        self.short_term_memory.append({
            "role": "user",
            "content": user_message,
            "timestamp": datetime.now().isoformat()
        })

        # Retrieve relevant long-term memories
        memories = self.recall_from_memory(user_message)
        memory_context = "\n".join([m["content"] for m in memories])

        # Prepare context
        system_prompt = f"""You are a helpful assistant with memory of past interactions.

Relevant memories from past conversations:
{memory_context}

Recent conversation:
{self._format_short_term_memory()}

Use your memories to provide personalized, contextual responses.
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7
        )

        assistant_response = response.choices[0].message.content

        # Add response to short-term memory
        self.short_term_memory.append({
            "role": "assistant",
            "content": assistant_response,
            "timestamp": datetime.now().isoformat()
        })

        # Optionally save to long-term memory
        self._consider_long_term_storage(user_message, assistant_response)

        return assistant_response

    def _format_short_term_memory(self) -> str:
        """Format recent conversation for context"""
        recent = self.short_term_memory[-10:]  # Last 10 messages
        return "\n".join([
            f"{m['role']}: {m['content']}"
            for m in recent
        ])

    def _consider_long_term_storage(self, user_msg: str, assistant_msg: str):
        """Decide if interaction should be stored long-term"""
        # Store if contains facts, preferences, or important info
        importance_prompt = f"""
Evaluate if this exchange contains information worth remembering long-term
(user preferences, facts about user, important decisions, etc.)

User: {user_msg}
Assistant: {assistant_msg}

Return JSON: {{"store": true/false, "summary": "brief summary if storing"}}
"""
        # ... evaluate and store if needed

    def _get_embedding(self, text: str) -> list:
        response = self.client.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return response.data[0].embedding
```

## Best Practices

```python
agent_best_practices = {
    "design": [
        "Start simple, add complexity as needed",
        "Define clear boundaries for agent capabilities",
        "Implement graceful degradation",
        "Always have human escalation path"
    ],
    "safety": [
        "Validate all tool inputs",
        "Limit tool permissions to minimum needed",
        "Log all actions for auditing",
        "Implement rate limiting"
    ],
    "reliability": [
        "Handle API errors gracefully",
        "Implement retry with backoff",
        "Set maximum iteration limits",
        "Validate outputs before returning"
    ],
    "user_experience": [
        "Provide progress updates for long tasks",
        "Explain reasoning when appropriate",
        "Ask for clarification when uncertain",
        "Summarize actions taken"
    ]
}
```

Building effective AI agents requires careful architecture. Tomorrow, I will cover tool use patterns in more depth.

## Resources

- [ReAct Paper](https://arxiv.org/abs/2210.03629)
- [LangChain Agents](https://python.langchain.com/docs/modules/agents/)
- [OpenAI Assistants API](https://platform.openai.com/docs/assistants/overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
