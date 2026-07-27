---
title: "Parallel Function Calling: Execute Multiple Tools Simultaneously"
author: "Michael John Peña"
draft: false
date: 2024-09-19
tags: ["OpenAI", "Function Calling", "Parallel", "Performance", "AI"]

---

I wrote "Parallel Function Calling: Execute Multiple Tools Simultaneously" to share practical, production-minded guidance on this topic.

## Understanding Parallel Calls

```python
from openai import OpenAI
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor

client = OpenAI()

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"}
                },
                "required": ["location"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_time",
            "description": "Get current time in a timezone",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {"type": "string"}
                },
                "required": ["timezone"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_news",
            "description": "Get news headlines for a topic",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "count": {"type": "integer", "default": 5}
                },
                "required": ["topic"]
            }
        }
    }
]

# When you ask about multiple cities, the model can call get_weather multiple times
response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",
    messages=[{
        "role": "user",
        "content": "What's the weather like in Tokyo, London, and New York right now?"
    }],
    tools=tools,
    parallel_tool_calls=True  # Enable parallel calls (default)
)

# The response may contain multiple tool calls
message = response.choices[0].message
print(f"Number of tool calls: {len(message.tool_calls or [])}")

for call in message.tool_calls or []:
    print(f"  - {call.function.name}: {call.function.arguments}")
```

## Executing Parallel Calls

```python
import time
from typing import Dict, Any, List

def get_weather(location: str) -> Dict[str, Any]:
    """Simulate weather API call"""
    time.sleep(0.5)  # Simulate network latency
    return {
        "location": location,
        "temperature": 22,
        "condition": "sunny"
    }

def get_time(timezone: str) -> Dict[str, Any]:
    """Simulate time API call"""
    time.sleep(0.3)
    return {
        "timezone": timezone,
        "time": "14:30"
    }

def get_news(topic: str, count: int = 5) -> Dict[str, Any]:
    """Simulate news API call"""
    time.sleep(0.7)
    return {
        "topic": topic,
        "headlines": [f"News about {topic} #{i}" for i in range(count)]
    }

# Sequential execution (slow)
def execute_sequentially(tool_calls: List) -> List[Dict]:
    """Execute tool calls one by one"""
    results = []
    for call in tool_calls:
        result = execute_single_tool(call)
        results.append({
            "tool_call_id": call.id,
            "result": result
        })
    return results

# Parallel execution (fast)
def execute_in_parallel(tool_calls: List) -> List[Dict]:
    """Execute tool calls in parallel using threads"""

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(execute_single_tool, call): call
            for call in tool_calls
        }

        results = []
        for future in futures:
            call = futures[future]
            result = future.result()
            results.append({
                "tool_call_id": call.id,
                "result": result
            })

    return results

def execute_single_tool(call) -> str:
    """Execute a single tool call"""
    name = call.function.name
    args = json.loads(call.function.arguments)

    tool_map = {
        "get_weather": get_weather,
        "get_time": get_time,
        "get_news": get_news
    }

    if name in tool_map:
        result = tool_map[name](**args)
        return json.dumps(result)
    else:
        return json.dumps({"error": f"Unknown tool: {name}"})
```

## Async Execution Pattern

```python
import asyncio
import aiohttp

async def get_weather_async(location: str) -> Dict[str, Any]:
    """Async weather API call"""
    await asyncio.sleep(0.5)  # Simulate API call
    return {
        "location": location,
        "temperature": 22,
        "condition": "sunny"
    }

async def get_time_async(timezone: str) -> Dict[str, Any]:
    """Async time API call"""
    await asyncio.sleep(0.3)
    return {
        "timezone": timezone,
        "time": "14:30"
    }

async def get_news_async(topic: str, count: int = 5) -> Dict[str, Any]:
    """Async news API call"""
    await asyncio.sleep(0.7)
    return {
        "topic": topic,
        "headlines": [f"News about {topic} #{i}" for i in range(count)]
    }

async def execute_single_tool_async(call) -> Dict:
    """Execute a single tool call asynchronously"""
    name = call.function.name
    args = json.loads(call.function.arguments)

    tool_map = {
        "get_weather": get_weather_async,
        "get_time": get_time_async,
        "get_news": get_news_async
    }

    if name in tool_map:
        result = await tool_map[name](**args)
        return {
            "tool_call_id": call.id,
            "result": json.dumps(result)
        }
    else:
        return {
            "tool_call_id": call.id,
            "result": json.dumps({"error": f"Unknown tool: {name}"})
        }

async def execute_all_parallel(tool_calls: List) -> List[Dict]:
    """Execute all tool calls in parallel"""
    tasks = [execute_single_tool_async(call) for call in tool_calls]
    return await asyncio.gather(*tasks)

# Usage in async context
async def process_with_parallel_tools(user_message: str) -> str:
    """Complete conversation with parallel tool execution"""

    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=messages,
            tools=tools,
            parallel_tool_calls=True
        )

        message = response.choices[0].message

        if message.tool_calls:
            messages.append(message)

            # Execute all tools in parallel
            results = await execute_all_parallel(message.tool_calls)

            # Add all results to messages
            for result in results:
                messages.append({
                    "role": "tool",
                    "tool_call_id": result["tool_call_id"],
                    "content": result["result"]
                })
        else:
            return message.content

# Run async function
# result = asyncio.run(process_with_parallel_tools("Weather in 3 cities?"))
```

## Handling Dependencies Between Calls

```python
class ToolOrchestrator:
    """
    Orchestrate tool calls with dependency management
    """

    def __init__(self):
        self.results_cache: Dict[str, Any] = {}

    async def execute_with_dependencies(self, tool_calls: List) -> List[Dict]:
        """
        Execute tools, handling dependencies between them
        """
        # Group by dependencies
        independent_calls = []
        dependent_calls = []

        for call in tool_calls:
            args = json.loads(call.function.arguments)

            # Check if any argument references another tool's result
            if self._has_dependency(args):
                dependent_calls.append(call)
            else:
                independent_calls.append(call)

        # Execute independent calls first
        results = await execute_all_parallel(independent_calls)

        # Store results for dependent calls
        for result in results:
            self.results_cache[result["tool_call_id"]] = json.loads(result["result"])

        # Execute dependent calls with resolved references
        if dependent_calls:
            resolved_calls = [self._resolve_dependencies(call) for call in dependent_calls]
            dependent_results = await execute_all_parallel(resolved_calls)
            results.extend(dependent_results)

        return results

    def _has_dependency(self, args: Dict) -> bool:
        """Check if arguments reference other tool results"""
        for value in args.values():
            if isinstance(value, str) and value.startswith("$ref:"):
                return True
        return False

    def _resolve_dependencies(self, call):
        """Resolve references in tool call arguments"""
        args = json.loads(call.function.arguments)

        for key, value in args.items():
            if isinstance(value, str) and value.startswith("$ref:"):
                ref_id = value[5:]  # Remove "$ref:" prefix
                if ref_id in self.results_cache:
                    args[key] = self.results_cache[ref_id]

        # Create a new call with resolved arguments
        call.function.arguments = json.dumps(args)
        return call
```

## Performance Comparison

```python
import time

async def benchmark_execution_strategies(tool_calls: List):
    """Compare sequential vs parallel execution"""

    # Sequential
    start = time.time()
    sequential_results = execute_sequentially(tool_calls)
    sequential_time = time.time() - start

    # Parallel (threads)
    start = time.time()
    parallel_results = execute_in_parallel(tool_calls)
    parallel_time = time.time() - start

    # Parallel (async)
    start = time.time()
    async_results = await execute_all_parallel(tool_calls)
    async_time = time.time() - start

    print(f"Sequential: {sequential_time:.2f}s")
    print(f"Parallel (threads): {parallel_time:.2f}s")
    print(f"Parallel (async): {async_time:.2f}s")
    print(f"Speedup: {sequential_time / async_time:.1f}x")

# Example with 5 tools each taking 0.5s:
# Sequential: 2.5s
# Parallel: ~0.5s
# Speedup: 5x
```

## Disabling Parallel Calls

```python
# Sometimes you need sequential execution
response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",
    messages=[{"role": "user", "content": "..."}],
    tools=tools,
    parallel_tool_calls=False  # Force sequential
)

# Use cases for disabling parallel:
# - Tools have side effects that must be ordered
# - Rate-limited APIs
# - Tools depend on each other's results
# - Debugging tool execution order
```

Parallel function calling dramatically improves response times when multiple independent operations are needed. Use it wisely to build faster, more responsive AI applications.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
