---
title: "Enhanced Function Calling in GPT-4 Turbo"
description: "Parallel function calling in GPT-4 Turbo is the DevDay improvement to function calling that changes what's architecturally practical with AI agents.…"
author: "Michael John Peña"
draft: false
date: 2023-11-09
tags: ["OpenAI", "Function Calling", "API", "GPT-4", "Tools"]
---

Parallel function calling in GPT-4 Turbo is the DevDay improvement to function calling that changes what's architecturally practical with AI agents. Previously, a model could call one function per response turn — so a task requiring three independent data lookups required three back-and-forth exchanges with the model. With parallel function calling (`gpt-4-1106-preview`), the model can return multiple function calls in a single response, each with their own arguments, and the application executes them concurrently before returning all results in the next turn. The impact: multi-step agent workflows run significantly faster because independent actions don't have to be serialised through the model. The requirement: the function calls must be genuinely independent.

## Parallel Function Calling

The model can now request multiple function calls simultaneously:

```python
from openai import OpenAI
import json

client = OpenAI()

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
                },
                "required": ["location"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_price",
            "description": "Get current stock price",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Stock ticker symbol"}
                },
                "required": ["symbol"]
            }
        }
    }
]

response = client.chat.completions.create(
    model="gpt-4-1106-preview",
    messages=[
        {"role": "user", "content": "What's the weather in Tokyo and the current price of AAPL and MSFT?"}
    ],
    tools=tools,
    tool_choice="auto"
)

# Handle multiple parallel function calls
if response.choices[0].message.tool_calls:
    for tool_call in response.choices[0].message.tool_calls:
        print(f"Function: {tool_call.function.name}")
        print(f"Arguments: {tool_call.function.arguments}")
        print("---")
```

## Building a Complete Function Calling System

```python
from typing import Callable, Dict, Any
import json

class FunctionRegistry:
    def __init__(self):
        self.functions: Dict[str, Callable] = {}
        self.schemas: list = []

    def register(self, schema: dict):
        """Decorator to register a function with its schema."""
        def decorator(func: Callable):
            name = schema["function"]["name"]
            self.functions[name] = func
            self.schemas.append(schema)
            return func
        return decorator

    def execute(self, name: str, arguments: str) -> str:
        """Execute a registered function."""
        if name not in self.functions:
            return json.dumps({"error": f"Unknown function: {name}"})

        try:
            args = json.loads(arguments)
            result = self.functions[name](**args)
            return json.dumps(result)
        except Exception as e:
            return json.dumps({"error": str(e)})

# Create registry and register functions
registry = FunctionRegistry()

@registry.register({
    "type": "function",
    "function": {
        "name": "search_database",
        "description": "Search the product database",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "category": {"type": "string"},
                "max_results": {"type": "integer", "default": 10}
            },
            "required": ["query"]
        }
    }
})
def search_database(query: str, category: str = None, max_results: int = 10) -> dict:
    # Simulated database search
    return {
        "results": [
            {"id": 1, "name": f"Product matching '{query}'", "price": 29.99},
            {"id": 2, "name": f"Another {query} item", "price": 49.99}
        ][:max_results],
        "total": 2
    }

@registry.register({
    "type": "function",
    "function": {
        "name": "create_order",
        "description": "Create a new order",
        "parameters": {
            "type": "object",
            "properties": {
                "product_id": {"type": "integer"},
                "quantity": {"type": "integer"},
                "customer_email": {"type": "string", "format": "email"}
            },
            "required": ["product_id", "quantity", "customer_email"]
        }
    }
})
def create_order(product_id: int, quantity: int, customer_email: str) -> dict:
    return {
        "order_id": "ORD-12345",
        "status": "confirmed",
        "product_id": product_id,
        "quantity": quantity,
        "email_sent_to": customer_email
    }

@registry.register({
    "type": "function",
    "function": {
        "name": "get_order_status",
        "description": "Get the status of an order",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string"}
            },
            "required": ["order_id"]
        }
    }
})
def get_order_status(order_id: str) -> dict:
    return {
        "order_id": order_id,
        "status": "shipped",
        "tracking_number": "1Z999AA10123456784",
        "estimated_delivery": "2023-11-15"
    }
```

## Conversation Loop with Function Calling

```python
def run_conversation(user_message: str, registry: FunctionRegistry) -> str:
    """Run a complete conversation with function calling."""
    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.chat.completions.create(
            model="gpt-4-1106-preview",
            messages=messages,
            tools=registry.schemas,
            tool_choice="auto"
        )

        assistant_message = response.choices[0].message
        messages.append(assistant_message)

        # Check if we need to call functions
        if not assistant_message.tool_calls:
            return assistant_message.content

        # Execute all function calls in parallel (in real app, use asyncio)
        for tool_call in assistant_message.tool_calls:
            function_name = tool_call.function.name
            function_args = tool_call.function.arguments

            print(f"Calling {function_name} with {function_args}")

            result = registry.execute(function_name, function_args)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result
            })

# Example usage
result = run_conversation(
    "Search for laptops and then create an order for product ID 1, quantity 2, for customer@example.com",
    registry
)
print(result)
```

## Forcing Specific Function Calls

```python
# Force a specific function to be called
response = client.chat.completions.create(
    model="gpt-4-1106-preview",
    messages=[{"role": "user", "content": "I want to know about laptops"}],
    tools=registry.schemas,
    tool_choice={"type": "function", "function": {"name": "search_database"}}
)

# Disable function calling for a specific request
response = client.chat.completions.create(
    model="gpt-4-1106-preview",
    messages=[{"role": "user", "content": "What's your opinion on laptops?"}],
    tools=registry.schemas,
    tool_choice="none"  # Don't call any functions
)
```

## Error Handling Best Practices

```python
def robust_function_execution(name: str, arguments: str) -> str:
    """Execute function with comprehensive error handling."""
    try:
        args = json.loads(arguments)
    except json.JSONDecodeError as e:
        return json.dumps({
            "error": "Invalid JSON arguments",
            "details": str(e)
        })

    if name not in registry.functions:
        return json.dumps({
            "error": "Function not found",
            "available_functions": list(registry.functions.keys())
        })

    try:
        result = registry.functions[name](**args)
        return json.dumps({"success": True, "data": result})
    except TypeError as e:
        return json.dumps({
            "error": "Invalid arguments",
            "details": str(e)
        })
    except Exception as e:
        return json.dumps({
            "error": "Function execution failed",
            "type": type(e).__name__,
            "details": str(e)
        })
```

## Conclusion

Enhanced function calling in GPT-4 Turbo makes it easier to build powerful AI agents that can interact with external systems. Parallel calls improve efficiency, while better accuracy reduces errors. Tomorrow, we'll dive into Microsoft Fabric GA - the biggest announcement from Ignite 2023!
