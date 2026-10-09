---
title: "Tool Use Patterns for AI Agents"
description: "Tools extend what AI agents can do beyond text generation. Today I'm exploring patterns for effective tool use in production agents."
author: Michael John Peña
draft: false
date: 2024-05-25
tags:
  - AI Agents
  - Function Calling
  - Tools
  - Azure OpenAI
  - Patterns
---

Tools extend what AI agents can do beyond text generation. Today I'm exploring patterns for effective tool use in production agents.

## Tool Design Principles

1. **Single responsibility** - One tool, one job
2. **Clear descriptions** - LLMs rely on descriptions
3. **Explicit parameters** - Well-defined inputs
4. **Predictable outputs** - Consistent return formats
5. **Error handling** - Return errors as data

## Basic Tool Definition

```python
from typing import Any
import json

def create_tool_definition(
    name: str,
    description: str,
    parameters: dict,
    required: list = None
) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": parameters,
                "required": required or []
            }
        }
    }

# Database query tool
sql_query_tool = create_tool_definition(
    name="execute_sql",
    description="Execute a read-only SQL query against the analytics database. Returns up to 100 rows.",
    parameters={
        "query": {
            "type": "string",
            "description": "SQL SELECT query to execute"
        },
        "database": {
            "type": "string",
            "enum": ["analytics", "reporting", "logs"],
            "description": "Target database"
        }
    },
    required=["query", "database"]
)

# Web search tool
web_search_tool = create_tool_definition(
    name="search_web",
    description="Search the web for current information. Use for recent events or facts not in training data.",
    parameters={
        "query": {
            "type": "string",
            "description": "Search query"
        },
        "num_results": {
            "type": "integer",
            "description": "Number of results (1-10)",
            "default": 5
        }
    },
    required=["query"]
)
```

## Tool Executor Pattern

```python
from abc import ABC, abstractmethod
from typing import Any, Dict

class Tool(ABC):
    """Base class for tools."""

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        pass

    @property
    @abstractmethod
    def parameters(self) -> dict:
        pass

    @abstractmethod
    async def execute(self, **kwargs) -> Any:
        pass

    def to_openai_format(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.parameters,
                    "required": self._get_required()
                }
            }
        }

    def _get_required(self) -> list:
        return [k for k, v in self.parameters.items() if not v.get("default")]


class ToolExecutor:
    """Registry and executor for tools."""

    def __init__(self):
        self.tools: Dict[str, Tool] = {}

    def register(self, tool: Tool):
        self.tools[tool.name] = tool

    def get_tool_definitions(self) -> list:
        return [tool.to_openai_format() for tool in self.tools.values()]

    async def execute(self, name: str, arguments: str) -> dict:
        tool = self.tools.get(name)
        if not tool:
            return {"error": f"Unknown tool: {name}"}

        try:
            args = json.loads(arguments)
            result = await tool.execute(**args)
            return {"success": True, "result": result}
        except json.JSONDecodeError as e:
            return {"error": f"Invalid arguments: {e}"}
        except Exception as e:
            return {"error": f"Execution failed: {e}"}
```

## Common Tool Implementations

### Database Query Tool

```python
class SQLQueryTool(Tool):
    name = "execute_sql"
    description = "Execute read-only SQL queries against the analytics database"
    parameters = {
        "query": {"type": "string", "description": "SQL SELECT query"},
        "limit": {"type": "integer", "description": "Max rows", "default": 100}
    }

    def __init__(self, connection_string: str):
        self.connection_string = connection_string

    async def execute(self, query: str, limit: int = 100) -> dict:
        # Validate query is read-only
        if not self._is_safe_query(query):
            return {"error": "Only SELECT queries allowed"}

        # Add limit if not present
        if "LIMIT" not in query.upper():
            query = f"{query} LIMIT {limit}"

        async with get_connection(self.connection_string) as conn:
            result = await conn.fetch(query)
            return {
                "columns": list(result[0].keys()) if result else [],
                "rows": [dict(row) for row in result],
                "row_count": len(result)
            }

    def _is_safe_query(self, query: str) -> bool:
        query_upper = query.upper().strip()
        dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE"]
        return query_upper.startswith("SELECT") and not any(d in query_upper for d in dangerous)
```

### HTTP Request Tool

```python
class HTTPRequestTool(Tool):
    name = "http_request"
    description = "Make HTTP requests to external APIs"
    parameters = {
        "method": {"type": "string", "enum": ["GET", "POST"]},
        "url": {"type": "string", "description": "URL to request"},
        "headers": {"type": "object", "description": "Request headers"},
        "body": {"type": "object", "description": "Request body for POST"}
    }

    def __init__(self, allowed_domains: list = None, timeout: int = 30):
        self.allowed_domains = allowed_domains or []
        self.timeout = timeout

    async def execute(
        self,
        method: str,
        url: str,
        headers: dict = None,
        body: dict = None
    ) -> dict:
        # Validate domain
        if self.allowed_domains:
            from urllib.parse import urlparse
            domain = urlparse(url).netloc
            if not any(d in domain for d in self.allowed_domains):
                return {"error": f"Domain not allowed: {domain}"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            if method == "GET":
                response = await client.get(url, headers=headers)
            elif method == "POST":
                response = await client.post(url, headers=headers, json=body)
            else:
                return {"error": f"Unsupported method: {method}"}

            return {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "body": response.text[:10000]  # Limit response size
            }
```

### File Operations Tool

```python
class FileOperationsTool(Tool):
    name = "file_operations"
    description = "Read, write, and list files in the workspace"
    parameters = {
        "operation": {"type": "string", "enum": ["read", "write", "list"]},
        "path": {"type": "string", "description": "File or directory path"},
        "content": {"type": "string", "description": "Content to write (for write operation)"}
    }

    def __init__(self, workspace_root: str):
        self.workspace_root = Path(workspace_root)

    async def execute(
        self,
        operation: str,
        path: str,
        content: str = None
    ) -> dict:
        full_path = self.workspace_root / path

        # Security: ensure path is within workspace
        try:
            full_path.resolve().relative_to(self.workspace_root.resolve())
        except ValueError:
            return {"error": "Path outside workspace"}

        if operation == "read":
            if not full_path.exists():
                return {"error": "File not found"}
            return {"content": full_path.read_text()[:50000]}

        elif operation == "write":
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content)
            return {"success": True, "path": str(path)}

        elif operation == "list":
            if not full_path.exists():
                return {"error": "Directory not found"}
            files = [str(f.relative_to(self.workspace_root)) for f in full_path.iterdir()]
            return {"files": files}
```

## Tool Selection Strategies

### Automatic Selection

```python
async def chat_with_auto_tools(
    client,
    messages: list,
    tools: list
) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice="auto"  # Let model decide
    )

    return response
```

### Required Tool

```python
async def chat_with_required_tool(
    client,
    messages: list,
    tools: list,
    required_tool: str
) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice={"type": "function", "function": {"name": required_tool}}
    )

    return response
```

### No Tools

```python
async def chat_without_tools(
    client,
    messages: list,
    tools: list
) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice="none"  # Don't use tools
    )

    return response
```

## Parallel Tool Execution

```python
async def execute_tools_parallel(
    executor: ToolExecutor,
    tool_calls: list
) -> list:
    """Execute multiple tool calls in parallel."""
    tasks = [
        executor.execute(call.function.name, call.function.arguments)
        for call in tool_calls
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    return [
        {
            "tool_call_id": call.id,
            "output": json.dumps(result) if not isinstance(result, Exception) else json.dumps({"error": str(result)})
        }
        for call, result in zip(tool_calls, results)
    ]
```

## Tool Validation

```python
from pydantic import BaseModel, validator
from typing import Optional

class SQLQueryParams(BaseModel):
    query: str
    database: str
    limit: Optional[int] = 100

    @validator("query")
    def validate_query(cls, v):
        if not v.strip().upper().startswith("SELECT"):
            raise ValueError("Only SELECT queries allowed")
        return v

    @validator("database")
    def validate_database(cls, v):
        allowed = ["analytics", "reporting", "logs"]
        if v not in allowed:
            raise ValueError(f"Database must be one of: {allowed}")
        return v

class ValidatedSQLTool(Tool):
    async def execute(self, **kwargs) -> dict:
        try:
            params = SQLQueryParams(**kwargs)
            # Execute validated query
            return await self._run_query(params)
        except ValueError as e:
            return {"error": str(e)}
```

## Tool Observability

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

class InstrumentedToolExecutor(ToolExecutor):
    async def execute(self, name: str, arguments: str) -> dict:
        with tracer.start_as_current_span(f"tool.{name}") as span:
            span.set_attribute("tool.name", name)
            span.set_attribute("tool.arguments", arguments[:500])

            start_time = time.time()
            result = await super().execute(name, arguments)
            duration = time.time() - start_time

            span.set_attribute("tool.duration_ms", duration * 1000)
            span.set_attribute("tool.success", "error" not in result)

            if "error" in result:
                span.set_attribute("tool.error", result["error"])

            return result
```

## Best Practices

1. **Validate all inputs** - Never trust LLM-generated parameters
2. **Limit capabilities** - Principle of least privilege
3. **Timeout everything** - Prevent hanging operations
4. **Log tool usage** - Essential for debugging
5. **Return structured errors** - Help the LLM recover

## What's Next

Tomorrow I'll cover code execution in AI agents.

## Resources

- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Azure OpenAI Tools](https://learn.microsoft.com/azure/ai-services/openai/how-to/function-calling)
- [LangChain Tools](https://python.langchain.com/docs/modules/tools/)
