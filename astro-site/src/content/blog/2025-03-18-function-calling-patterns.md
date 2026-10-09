---
title: "Function Calling Patterns: Building Reliable AI Tools"
description: "Well-designed function calling creates powerful AI applications that interact safely with real systems."
author: Michael John Peña
draft: false
date: 2025-03-18
tags:
  - AI
  - Function Calling
  - Tools
  - Patterns
  - Best Practices
---

## Function Calling Best Practices

```python
from azure.ai.openai import AzureOpenAI
from pydantic import BaseModel, Field
from typing import Callable, Any
import json

class ToolDefinition(BaseModel):
    """Schema for tool definitions."""
    name: str
    description: str
    parameters: dict
    function: Callable

class FunctionCallingAgent:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.tools: dict[str, ToolDefinition] = {}

    def register_tool(self, name: str, description: str, parameters: dict, function: Callable):
        """Register a tool with validation."""
        self.tools[name] = ToolDefinition(
            name=name,
            description=description,
            parameters=parameters,
            function=function
        )

    def get_tool_schemas(self) -> list:
        """Get OpenAI-compatible tool schemas."""
        return [{
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters
            }
        } for tool in self.tools.values()]

    async def execute_tool(self, name: str, arguments: dict) -> Any:
        """Execute tool with error handling."""
        if name not in self.tools:
            return {"error": f"Unknown tool: {name}"}

        tool = self.tools[name]
        try:
            # Validate arguments against schema
            self.validate_arguments(arguments, tool.parameters)
            result = await tool.function(**arguments)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def run(self, messages: list) -> str:
        """Run agent with automatic tool execution."""
        while True:
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=self.get_tool_schemas(),
                tool_choice="auto"
            )

            message = response.choices[0].message

            if not message.tool_calls:
                return message.content

            # Execute all tool calls
            messages.append(message)
            for tool_call in message.tool_calls:
                result = await self.execute_tool(
                    tool_call.function.name,
                    json.loads(tool_call.function.arguments)
                )
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })

# Example tool registration
agent.register_tool(
    name="query_database",
    description="Execute SQL query and return results",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "SQL query to execute"}
        },
        "required": ["query"]
    },
    function=execute_sql
)
```

Well-designed function calling creates powerful AI applications that interact safely with real systems.
