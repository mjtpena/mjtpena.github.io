---
title: "Function Calling Updates: What's New in September 2024"
author: "Michael John Peña"
draft: false
date: 2024-09-18
tags: ["OpenAI", "Function Calling", "AI", "API", "Tools"]

---

I wrote "Function Calling Updates: What's New in September 2024" to share practical, production-minded guidance on this topic.

## Updated Function Calling Syntax

```python
from openai import OpenAI
from typing import List, Optional
import json

client = OpenAI()

# Define tools with the updated schema format
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_products",
            "description": "Search for products in the catalog",
            "strict": True,  # NEW: Enforce parameter schema
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    },
                    "category": {
                        "type": "string",
                        "enum": ["electronics", "clothing", "home", "sports"]
                    },
                    "min_price": {
                        "type": "number",
                        "minimum": 0
                    },
                    "max_price": {
                        "type": "number",
                        "minimum": 0
                    },
                    "in_stock": {
                        "type": "boolean",
                        "default": True
                    }
                },
                "required": ["query"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_product_details",
            "description": "Get detailed information about a specific product",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "string",
                        "description": "The product ID"
                    }
                },
                "required": ["product_id"],
                "additionalProperties": False
            }
        }
    }
]

def chat_with_tools(user_message: str) -> str:
    """Run a conversation with function calling"""

    messages = [
        {"role": "system", "content": "You are a shopping assistant. Use tools to help customers find products."},
        {"role": "user", "content": user_message}
    ]

    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=messages,
        tools=tools,
        tool_choice="auto"
    )

    return response
```

## Handling Tool Calls

```python
def execute_tool(tool_call) -> str:
    """Execute a tool call and return the result"""

    name = tool_call.function.name
    args = json.loads(tool_call.function.arguments)

    if name == "search_products":
        return search_products(**args)
    elif name == "get_product_details":
        return get_product_details(**args)
    else:
        return json.dumps({"error": f"Unknown function: {name}"})

def search_products(query: str, category: str = None,
                   min_price: float = None, max_price: float = None,
                   in_stock: bool = True) -> str:
    """Mock product search"""
    # In reality, this would query your database
    results = [
        {"id": "P001", "name": f"Product matching '{query}'", "price": 99.99},
        {"id": "P002", "name": f"Another {query} item", "price": 149.99}
    ]
    return json.dumps(results)

def get_product_details(product_id: str) -> str:
    """Mock product details"""
    return json.dumps({
        "id": product_id,
        "name": "Sample Product",
        "description": "A great product",
        "price": 99.99,
        "stock": 50
    })

def complete_tool_conversation(user_message: str) -> str:
    """Complete a conversation that may involve multiple tool calls"""

    messages = [
        {"role": "system", "content": "You are a shopping assistant."},
        {"role": "user", "content": user_message}
    ]

    while True:
        response = client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        assistant_message = response.choices[0].message

        # Check if the model wants to call tools
        if assistant_message.tool_calls:
            # Add assistant message with tool calls
            messages.append(assistant_message)

            # Execute each tool call
            for tool_call in assistant_message.tool_calls:
                result = execute_tool(tool_call)

                # Add tool result
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })
        else:
            # No more tool calls - return final response
            return assistant_message.content
```

## Strict Mode for Function Parameters

```python
# Strict mode ensures parameters match the schema exactly
strict_tool = {
    "type": "function",
    "function": {
        "name": "create_event",
        "description": "Create a calendar event",
        "strict": True,  # Model MUST provide valid parameters
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start_time": {
                    "type": "string",
                    "description": "ISO 8601 datetime"
                },
                "end_time": {
                    "type": "string",
                    "description": "ISO 8601 datetime"
                },
                "attendees": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "email": {"type": "string"},
                            "required": {"type": "boolean"}
                        },
                        "required": ["email", "required"],
                        "additionalProperties": False
                    }
                },
                "recurrence": {
                    "type": ["object", "null"],  # Explicitly nullable
                    "properties": {
                        "frequency": {
                            "type": "string",
                            "enum": ["daily", "weekly", "monthly"]
                        },
                        "count": {"type": "integer"}
                    },
                    "required": ["frequency"],
                    "additionalProperties": False
                }
            },
            "required": ["title", "start_time", "end_time", "attendees", "recurrence"],
            "additionalProperties": False
        }
    }
}
```

## Tool Choice Control

```python
def controlled_tool_use(user_message: str, force_tool: str = None):
    """Control which tools the model can use"""

    # Option 1: Let model decide
    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[{"role": "user", "content": user_message}],
        tools=tools,
        tool_choice="auto"  # Model decides if/which tool to use
    )

    # Option 2: Force a specific tool
    if force_tool:
        response = client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=[{"role": "user", "content": user_message}],
            tools=tools,
            tool_choice={"type": "function", "function": {"name": force_tool}}
        )

    # Option 3: Require tool use but let model choose
    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[{"role": "user", "content": user_message}],
        tools=tools,
        tool_choice="required"  # Must use a tool
    )

    # Option 4: Disable tool use
    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[{"role": "user", "content": user_message}],
        tools=tools,
        tool_choice="none"  # Cannot use tools
    )

    return response
```

## Pydantic Integration for Tools

```python
from pydantic import BaseModel, Field
from typing import Literal

class SearchParams(BaseModel):
    query: str = Field(description="Search query")
    category: Literal["electronics", "clothing", "home", "sports"] = Field(
        default=None,
        description="Product category filter"
    )
    min_price: float = Field(default=None, ge=0)
    max_price: float = Field(default=None, ge=0)

def pydantic_to_tool(model: type[BaseModel], name: str, description: str) -> dict:
    """Convert a Pydantic model to a tool definition"""

    schema = model.model_json_schema()

    # Remove Pydantic-specific fields
    schema.pop("title", None)

    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "strict": True,
            "parameters": schema
        }
    }

# Create tool from Pydantic model
search_tool = pydantic_to_tool(
    SearchParams,
    "search_products",
    "Search for products in the catalog"
)

# When handling the call, parse directly to Pydantic
def handle_tool_call(tool_call) -> str:
    if tool_call.function.name == "search_products":
        params = SearchParams.model_validate_json(tool_call.function.arguments)
        # Now params is a validated Pydantic object
        return search_products_impl(params)
```

## Error Handling for Tool Calls

```python
class ToolError(Exception):
    """Error during tool execution"""
    def __init__(self, message: str, recoverable: bool = True):
        self.message = message
        self.recoverable = recoverable
        super().__init__(message)

def safe_tool_execution(tool_call, max_retries: int = 3) -> str:
    """Execute tool with error handling and retries"""

    for attempt in range(max_retries):
        try:
            result = execute_tool(tool_call)
            return result

        except json.JSONDecodeError as e:
            return json.dumps({
                "error": "Invalid tool arguments",
                "details": str(e)
            })

        except ToolError as e:
            if not e.recoverable:
                return json.dumps({
                    "error": e.message,
                    "recoverable": False
                })
            if attempt == max_retries - 1:
                return json.dumps({
                    "error": e.message,
                    "attempts": max_retries
                })

        except Exception as e:
            return json.dumps({
                "error": "Unexpected error",
                "details": str(e)
            })
```

Function calling is the foundation of agentic AI. These patterns help you build reliable, type-safe tool integrations that scale.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
