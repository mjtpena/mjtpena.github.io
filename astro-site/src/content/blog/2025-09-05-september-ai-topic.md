---
title: "Building AI Agents with Tool Use: A Practical Architecture"
author: Michael John Peña
draft: false
date: 2025-09-05
tags:
  - AI Agents
  - Tool Use
  - Function Calling
  - Architecture
  - LLM

---

I wrote "Building AI Agents with Tool Use: A Practical Architecture" to share practical, production-minded guidance on this topic.

## The Agent Loop

At its core, an AI agent follows a simple loop: observe, think, act, repeat.

```python
from openai import AzureOpenAI
from typing import Callable
import json

class AIAgent:
    def __init__(self, client: AzureOpenAI, tools: dict[str, Callable]):
        self.client = client
        self.tools = tools
        self.tool_definitions = self._build_tool_definitions()
        self.conversation_history = []

    def _build_tool_definitions(self) -> list:
        """Convert tool functions to OpenAI function definitions."""
        definitions = []
        for name, func in self.tools.items():
            definitions.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": func.__doc__,
                    "parameters": getattr(func, 'parameters', {"type": "object", "properties": {}})
                }
            })
        return definitions

    def run(self, user_message: str, max_iterations: int = 10) -> str:
        """Execute the agent loop until completion or max iterations."""
        self.conversation_history.append({"role": "user", "content": user_message})

        for _ in range(max_iterations):
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=self.conversation_history,
                tools=self.tool_definitions,
                tool_choice="auto"
            )

            message = response.choices[0].message
            self.conversation_history.append(message)

            # Check if model wants to use tools
            if message.tool_calls:
                for tool_call in message.tool_calls:
                    result = self._execute_tool(tool_call)
                    self.conversation_history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result)
                    })
            else:
                # No tool calls means we have a final response
                return message.content

        return "Max iterations reached without completion"

    def _execute_tool(self, tool_call) -> dict:
        """Execute a tool and return the result."""
        func = self.tools.get(tool_call.function.name)
        if not func:
            return {"error": f"Unknown tool: {tool_call.function.name}"}

        try:
            args = json.loads(tool_call.function.arguments)
            result = func(**args)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
```

## Defining Tools

Tools should be focused, well-documented, and handle errors gracefully.

```python
def search_database(query: str, limit: int = 10) -> list:
    """Search the product database for items matching the query.
    Returns a list of matching products with their details."""
    # Implementation here
    pass

search_database.parameters = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Search terms"},
        "limit": {"type": "integer", "description": "Max results to return"}
    },
    "required": ["query"]
}
```

## Key Design Principles

Keep tools atomic and composable. Let the LLM orchestrate multiple simple tools rather than building complex mega-tools. This approach is more flexible and easier to debug.

Always implement proper error handling and timeouts. Agents can get stuck in loops, so iteration limits are essential safeguards.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
