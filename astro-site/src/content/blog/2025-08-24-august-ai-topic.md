---
title: "Function Calling Patterns in Azure OpenAI"
description: "Functions are defined as JSON schemas that describe parameters and their types. Well-designed function schemas and clear descriptions ensure the model calls…"
author: Michael John Peña
draft: false
date: 2025-08-24
tags:
  - Azure OpenAI
  - Function Calling
  - Tool Use
  - API Design
  - Python
---

## Defining Functions

Functions are defined as JSON schemas that describe parameters and their types.

```python
from openai import AzureOpenAI
import json

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-08-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City name, e.g., 'Seattle, WA'"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature unit"
                    }
                },
                "required": ["location"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_products",
            "description": "Search product catalog",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search terms"},
                    "category": {"type": "string", "description": "Product category"},
                    "max_price": {"type": "number", "description": "Maximum price filter"}
                },
                "required": ["query"]
            }
        }
    }
]
```

## Handling Function Calls

```python
def process_with_functions(user_message: str):
    messages = [{"role": "user", "content": user_message}]

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice="auto"
    )

    message = response.choices[0].message

    if message.tool_calls:
        # Process each function call
        for tool_call in message.tool_calls:
            function_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            # Execute the function
            result = execute_function(function_name, arguments)

            # Add results to conversation
            messages.append(message)
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result)
            })

        # Get final response with function results
        final_response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        return final_response.choices[0].message.content

    return message.content
```

Well-designed function schemas and clear descriptions ensure the model calls the right functions with correct parameters.
