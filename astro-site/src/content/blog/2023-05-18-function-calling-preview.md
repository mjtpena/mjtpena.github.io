---
title: "Mastering Function Calling in Azure OpenAI: A Deep Dive"
description: "Function calling transforms GPT models into powerful agents that can interact with the real world. Tomorrow, I will cover Azure AI Studio in more detail."
author: Michael John Peña
draft: false
date: 2023-05-18
tags:
  - Azure OpenAI
  - Function Calling
  - GPT-4
  - AI
  - API Development
---

## Understanding Function Calling

Function calling enables:
- **Structured Output**: Reliable JSON generation
- **Tool Integration**: Connect AI to external APIs
- **Agent Behavior**: Build autonomous AI agents
- **Data Extraction**: Parse information from text

```python
from openai import AzureOpenAI
import json

client = AzureOpenAI(
    api_key="your-api-key",
    api_version="2023-07-01-preview",
    azure_endpoint="https://your-resource.openai.azure.com"
)

# Basic function calling flow
# 1. Define functions
# 2. Send to model with user message
# 3. Model decides if/which function to call
# 4. Execute function with provided arguments
# 5. Send result back to model
# 6. Model generates final response
```

## Defining Functions

### Basic Function Definition

```python
functions = [
    {
        "name": "get_current_weather",
        "description": "Get the current weather in a given location. Call this when the user asks about weather conditions.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and state, e.g., San Francisco, CA"
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "The temperature unit"
                }
            },
            "required": ["location"]
        }
    }
]
```

### Complex Function Definitions

```python
# E-commerce functions
ecommerce_functions = [
    {
        "name": "search_products",
        "description": "Search for products in the catalog. Use when user wants to find products, browse categories, or needs product recommendations.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query for product name or description"
                },
                "filters": {
                    "type": "object",
                    "description": "Optional filters to narrow results",
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": ["electronics", "clothing", "home", "sports"]
                        },
                        "price_range": {
                            "type": "object",
                            "properties": {
                                "min": {"type": "number"},
                                "max": {"type": "number"}
                            }
                        },
                        "in_stock_only": {"type": "boolean"},
                        "min_rating": {"type": "number", "minimum": 1, "maximum": 5}
                    }
                },
                "sort_by": {
                    "type": "string",
                    "enum": ["relevance", "price_low", "price_high", "rating", "newest"]
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results",
                    "default": 10
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_product_details",
        "description": "Get detailed information about a specific product including specs, reviews, and availability.",
        "parameters": {
            "type": "object",
            "properties": {
                "product_id": {
                    "type": "string",
                    "description": "The unique product identifier"
                },
                "include_reviews": {
                    "type": "boolean",
                    "description": "Whether to include customer reviews",
                    "default": False
                }
            },
            "required": ["product_id"]
        }
    },
    {
        "name": "add_to_cart",
        "description": "Add a product to the user's shopping cart",
        "parameters": {
            "type": "object",
            "properties": {
                "product_id": {"type": "string"},
                "quantity": {"type": "integer", "minimum": 1, "default": 1}
            },
            "required": ["product_id"]
        }
    },
    {
        "name": "check_order_status",
        "description": "Check the status of an existing order",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string"}
            },
            "required": ["order_id"]
        }
    }
]
```

## Implementing the Function Calling Loop

```python
class FunctionCallingAgent:
    def __init__(self, client, model, functions, system_prompt):
        self.client = client
        self.model = model
        self.functions = functions
        self.function_handlers = {}
        self.messages = [{"role": "system", "content": system_prompt}]

    def register_function(self, name, handler):
        """Register a function handler"""
        self.function_handlers[name] = handler

    def execute_function(self, name, arguments):
        """Execute a registered function"""
        if name not in self.function_handlers:
            return {"error": f"Function {name} not found"}

        try:
            result = self.function_handlers[name](**arguments)
            return result
        except Exception as e:
            return {"error": str(e)}

    def chat(self, user_message, max_function_calls=5):
        """Process user message with function calling"""
        self.messages.append({"role": "user", "content": user_message})

        function_call_count = 0

        while function_call_count < max_function_calls:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                functions=self.functions,
                function_call="auto"
            )

            message = response.choices[0].message

            # Check finish reason
            finish_reason = response.choices[0].finish_reason

            if finish_reason == "stop":
                # Model finished, return response
                self.messages.append(message)
                return message.content

            elif finish_reason == "function_call":
                # Model wants to call a function
                self.messages.append(message)

                function_name = message.function_call.name
                function_args = json.loads(message.function_call.arguments)

                print(f"Calling function: {function_name}")
                print(f"Arguments: {function_args}")

                # Execute function
                result = self.execute_function(function_name, function_args)

                # Add result to messages
                self.messages.append({
                    "role": "function",
                    "name": function_name,
                    "content": json.dumps(result)
                })

                function_call_count += 1

        return "Maximum function calls reached. Please try again with a simpler request."

# Usage example
agent = FunctionCallingAgent(
    client=client,
    model="gpt-4",
    functions=ecommerce_functions,
    system_prompt="""You are a helpful e-commerce assistant. Help users find products,
    check orders, and answer questions about our catalog. Always be helpful and provide
    relevant product recommendations."""
)

# Register function handlers
def search_products(query, filters=None, sort_by="relevance", limit=10):
    # Actual implementation would query a database
    return {
        "products": [
            {"id": "p1", "name": "Wireless Headphones", "price": 149.99},
            {"id": "p2", "name": "Bluetooth Speaker", "price": 79.99}
        ],
        "total": 2
    }

def get_product_details(product_id, include_reviews=False):
    return {
        "id": product_id,
        "name": "Wireless Headphones",
        "description": "Premium noise-canceling headphones",
        "price": 149.99,
        "in_stock": True,
        "reviews": [{"rating": 5, "text": "Great sound!"}] if include_reviews else None
    }

agent.register_function("search_products", search_products)
agent.register_function("get_product_details", get_product_details)

# Chat
response = agent.chat("I'm looking for wireless headphones under $200")
print(response)
```

## Parallel Function Calls

GPT-4 can request multiple function calls in parallel:

```python
def handle_parallel_functions(response):
    """Handle multiple function calls in one response"""
    message = response.choices[0].message

    if hasattr(message, 'tool_calls') and message.tool_calls:
        results = []

        for tool_call in message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)

            # Execute function
            result = execute_function(function_name, function_args)

            results.append({
                "tool_call_id": tool_call.id,
                "role": "tool",
                "name": function_name,
                "content": json.dumps(result)
            })

        return results

    return None
```

## Forcing Specific Functions

```python
# Force the model to call a specific function
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    functions=functions,
    function_call={"name": "search_products"}  # Force this specific function
)

# Disable function calling for a specific request
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    functions=functions,
    function_call="none"  # Don't call any functions
)
```

## Error Handling

```python
def robust_function_execution(function_name, arguments, handlers):
    """Execute function with comprehensive error handling"""

    # Validate function exists
    if function_name not in handlers:
        return {
            "success": False,
            "error": f"Unknown function: {function_name}",
            "error_type": "function_not_found"
        }

    try:
        result = handlers[function_name](**arguments)
        return {
            "success": True,
            "result": result
        }
    except TypeError as e:
        return {
            "success": False,
            "error": f"Invalid arguments: {str(e)}",
            "error_type": "invalid_arguments"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Function execution failed: {str(e)}",
            "error_type": "execution_error"
        }

def chat_with_error_handling(user_message):
    """Chat with graceful error handling"""
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": user_message}
    ]

    try:
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            functions=functions
        )
    except openai.RateLimitError:
        return "I'm currently experiencing high demand. Please try again in a moment."
    except openai.APIError as e:
        return f"An API error occurred. Please try again."

    message = response.choices[0].message

    if message.function_call:
        function_name = message.function_call.name

        try:
            arguments = json.loads(message.function_call.arguments)
        except json.JSONDecodeError:
            # Handle malformed JSON from model
            return "I had trouble processing that request. Could you rephrase?"

        result = robust_function_execution(function_name, arguments, handlers)

        if not result["success"]:
            # Provide error context back to model
            messages.append({
                "role": "function",
                "name": function_name,
                "content": json.dumps(result)
            })

            # Let model handle the error gracefully
            follow_up = client.chat.completions.create(
                model="gpt-4",
                messages=messages
            )
            return follow_up.choices[0].message.content

    return message.content
```

Function calling transforms GPT models into powerful agents that can interact with the real world. Tomorrow, I will cover Azure AI Studio in more detail.

## Resources

- [Function Calling Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/function-calling)
- [OpenAI Cookbook](https://github.com/openai/openai-cookbook)
- [Best Practices Guide](https://platform.openai.com/docs/guides/gpt-best-practices)
