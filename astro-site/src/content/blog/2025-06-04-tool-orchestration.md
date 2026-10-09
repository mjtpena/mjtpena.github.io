---
title: "Tool Orchestration: Managing Complex Tool Interactions"
description: "Robust tool orchestration enables complex, reliable AI workflows."
author: Michael John Peña
draft: false
date: 2025-06-04
tags:
  - AI
  - Tools
  - Orchestration
  - Agents
  - Integration
---

## Tool Orchestration Framework

```python
from dataclasses import dataclass
from typing import Dict, List, Callable, Any
from enum import Enum

class ToolStatus(Enum):
    AVAILABLE = "available"
    BUSY = "busy"
    ERROR = "error"
    RATE_LIMITED = "rate_limited"

@dataclass
class Tool:
    name: str
    description: str
    function: Callable
    schema: Dict
    rate_limit: int = None
    timeout_seconds: int = 30

class ToolOrchestrator:
    def __init__(self):
        self.tools: Dict[str, Tool] = {}
        self.tool_status: Dict[str, ToolStatus] = {}
        self.execution_history: List[Dict] = []

    def register_tool(self, tool: Tool):
        """Register tool for orchestration."""
        self.tools[tool.name] = tool
        self.tool_status[tool.name] = ToolStatus.AVAILABLE

    async def execute_tool(self, name: str, arguments: Dict) -> Dict:
        """Execute tool with error handling and tracking."""
        tool = self.tools.get(name)
        if not tool:
            return {"error": f"Tool '{name}' not found"}

        # Check availability
        if self.tool_status[name] != ToolStatus.AVAILABLE:
            return {"error": f"Tool '{name}' is {self.tool_status[name].value}"}

        try:
            self.tool_status[name] = ToolStatus.BUSY

            # Execute with timeout
            result = await asyncio.wait_for(
                tool.function(**arguments),
                timeout=tool.timeout_seconds
            )

            # Track execution
            self.execution_history.append({
                "tool": name,
                "arguments": arguments,
                "result": result,
                "status": "success",
                "timestamp": datetime.now()
            })

            return {"success": True, "result": result}

        except asyncio.TimeoutError:
            return {"error": f"Tool '{name}' timed out"}
        except Exception as e:
            self.tool_status[name] = ToolStatus.ERROR
            return {"error": str(e)}
        finally:
            self.tool_status[name] = ToolStatus.AVAILABLE

    async def execute_chain(self, chain: List[Dict]) -> Dict:
        """Execute chain of tool calls."""
        context = {}

        for step in chain:
            tool_name = step["tool"]
            arguments = self.resolve_arguments(step["arguments"], context)

            result = await self.execute_tool(tool_name, arguments)

            if not result.get("success"):
                return {"error": f"Chain failed at {tool_name}", "details": result}

            context[step.get("output_key", tool_name)] = result["result"]

        return {"success": True, "results": context}

    async def execute_parallel(self, calls: List[Dict]) -> List[Dict]:
        """Execute multiple tool calls in parallel."""
        tasks = [
            self.execute_tool(call["tool"], call["arguments"])
            for call in calls
        ]

        return await asyncio.gather(*tasks)

    def resolve_arguments(self, arguments: Dict, context: Dict) -> Dict:
        """Resolve argument references from context."""
        resolved = {}
        for key, value in arguments.items():
            if isinstance(value, str) and value.startswith("$"):
                ref = value[1:]
                resolved[key] = context.get(ref)
            else:
                resolved[key] = value
        return resolved

    def get_tool_recommendations(self, task: str) -> List[str]:
        """Recommend tools for a task."""
        recommendations = []
        for name, tool in self.tools.items():
            if self.is_tool_relevant(tool, task):
                recommendations.append(name)
        return recommendations
```

Robust tool orchestration enables complex, reliable AI workflows.
