---
title: "Azure OpenAI Updates at Build 2023: What Developers Need to Know"
author: Michael John Peña
draft: false
date: 2023-05-16
tags:
  - Azure OpenAI
  - Build 2023
  - GPT-4
  - AI
  - Microsoft

---

I wrote "Azure OpenAI Updates at Build 2023: What Developers Need to Know" to share practical, production-minded guidance on this topic.

## Key Announcements

Build 2023 introduced several major Azure OpenAI enhancements:

1. **GPT-4 General Availability**
2. **Function Calling Preview**
3. **Plugins for ChatGPT**
4. **Azure AI Studio Preview**
5. **Enhanced Content Safety**

## GPT-4 in Azure OpenAI

GPT-4 is now generally available in Azure OpenAI Service:

```python
import openai
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key="your-api-key",
    api_version="2023-05-15",
    azure_endpoint="https://your-resource.openai.azure.com"
)

# GPT-4 completion
response = client.chat.completions.create(
    model="gpt-4",  # or gpt-4-32k for longer context
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain the CAP theorem in distributed systems."}
    ],
    temperature=0.7,
    max_tokens=500
)

print(response.choices[0].message.content)
```

### GPT-4 Model Variants

```python
gpt4_variants = {
    "gpt-4": {
        "context_window": 8192,
        "use_case": "Most tasks, balanced cost/performance",
        "pricing": "Higher than GPT-3.5"
    },
    "gpt-4-32k": {
        "context_window": 32768,
        "use_case": "Long documents, extensive context",
        "pricing": "2x GPT-4 standard"
    }
}
```

## Function Calling (Preview)

Function calling enables structured interactions between GPT models and external tools:

```python
import json

# Define available functions
functions = [
    {
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and state, e.g., San Francisco, CA"
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"]
                }
            },
            "required": ["location"]
        }
    },
    {
        "name": "search_products",
        "description": "Search for products in the catalog",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query for products"
                },
                "category": {
                    "type": "string",
                    "description": "Product category filter"
                },
                "max_price": {
                    "type": "number",
                    "description": "Maximum price filter"
                }
            },
            "required": ["query"]
        }
    }
]

# Call with function definitions
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "What's the weather in Seattle and find me umbrellas under $50?"}
    ],
    functions=functions,
    function_call="auto"
)

# Process function calls
message = response.choices[0].message

if message.function_call:
    function_name = message.function_call.name
    function_args = json.loads(message.function_call.arguments)

    print(f"Function: {function_name}")
    print(f"Arguments: {function_args}")

    # Execute the function
    if function_name == "get_weather":
        weather_result = get_weather(**function_args)
    elif function_name == "search_products":
        products_result = search_products(**function_args)

    # Continue conversation with function result
    follow_up = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "user", "content": "What's the weather in Seattle?"},
            message,
            {
                "role": "function",
                "name": function_name,
                "content": json.dumps(weather_result)
            }
        ]
    )
```

### Building a Function-Calling Agent

```python
class AIAgent:
    def __init__(self, client, functions, system_prompt):
        self.client = client
        self.functions = functions
        self.messages = [{"role": "system", "content": system_prompt}]
        self.function_handlers = {}

    def register_handler(self, function_name, handler):
        self.function_handlers[function_name] = handler

    def chat(self, user_message):
        self.messages.append({"role": "user", "content": user_message})

        while True:
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=self.messages,
                functions=self.functions,
                function_call="auto"
            )

            message = response.choices[0].message
            self.messages.append(message)

            # Check if model wants to call a function
            if message.function_call:
                function_name = message.function_call.name
                function_args = json.loads(message.function_call.arguments)

                # Execute function
                if function_name in self.function_handlers:
                    result = self.function_handlers[function_name](**function_args)
                else:
                    result = {"error": f"Unknown function: {function_name}"}

                # Add function result to messages
                self.messages.append({
                    "role": "function",
                    "name": function_name,
                    "content": json.dumps(result)
                })
            else:
                # No function call, return response
                return message.content

# Usage
agent = AIAgent(client, functions, "You are a helpful shopping assistant.")
agent.register_handler("get_weather", get_weather)
agent.register_handler("search_products", search_products)

response = agent.chat("I need an umbrella for my trip to Seattle next week")
print(response)
```

## Azure AI Studio Preview

Azure AI Studio is a new unified development environment for AI applications:

```python
# Azure AI Studio features
ai_studio_features = {
    "model_catalog": "Browse and deploy foundation models",
    "prompt_flow": "Visual prompt engineering and orchestration",
    "fine_tuning": "Customize models with your data",
    "evaluation": "Test and compare model performance",
    "deployment": "Deploy to managed endpoints",
    "monitoring": "Track model performance and costs"
}

# Prompt Flow example (YAML definition)
prompt_flow_yaml = """
inputs:
  question:
    type: string
outputs:
  answer:
    type: string
    reference: ${generate_response.output}

nodes:
  - name: retrieve_context
    type: python
    source:
      type: code
      path: retrieve.py
    inputs:
      question: ${inputs.question}

  - name: generate_response
    type: llm
    source:
      type: code
      path: prompt.jinja2
    inputs:
      model: gpt-4
      context: ${retrieve_context.output}
      question: ${inputs.question}
"""
```

## Content Safety Enhancements

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import AnalyzeTextOptions

# Initialize Content Safety client
content_safety_client = ContentSafetyClient(
    endpoint="https://your-content-safety.cognitiveservices.azure.com/",
    credential=credential
)

def check_content_safety(text):
    """Check content for harmful categories"""
    request = AnalyzeTextOptions(text=text)
    response = content_safety_client.analyze_text(request)

    results = {
        "hate": response.hate_result.severity,
        "self_harm": response.self_harm_result.severity,
        "sexual": response.sexual_result.severity,
        "violence": response.violence_result.severity
    }

    # Severity levels: 0 (safe) to 6 (severe)
    is_safe = all(severity <= 2 for severity in results.values())

    return {
        "is_safe": is_safe,
        "categories": results
    }

# Integrate with OpenAI calls
def safe_completion(prompt):
    # Check input
    input_safety = check_content_safety(prompt)
    if not input_safety["is_safe"]:
        return {"error": "Input contains potentially harmful content"}

    # Generate response
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}]
    )

    output = response.choices[0].message.content

    # Check output
    output_safety = check_content_safety(output)
    if not output_safety["is_safe"]:
        return {"error": "Generated response flagged by content safety"}

    return {"response": output, "safety": output_safety}
```

## Best Practices for Azure OpenAI

```python
best_practices = {
    "rate_limiting": {
        "description": "Handle rate limits gracefully",
        "code": """
from tenacity import retry, wait_exponential, stop_after_attempt

@retry(wait=wait_exponential(min=1, max=60), stop=stop_after_attempt(5))
def call_openai_with_retry(messages):
    return client.chat.completions.create(model="gpt-4", messages=messages)
        """
    },
    "cost_optimization": {
        "description": "Use appropriate model for task complexity",
        "guidelines": [
            "Use GPT-3.5-Turbo for simple tasks",
            "Reserve GPT-4 for complex reasoning",
            "Set appropriate max_tokens",
            "Cache common responses"
        ]
    },
    "security": {
        "description": "Secure your deployments",
        "guidelines": [
            "Use managed identity for authentication",
            "Enable private endpoints",
            "Implement input validation",
            "Log all API calls for auditing"
        ]
    }
}
```

Azure OpenAI is becoming the enterprise-grade platform for building generative AI applications. Tomorrow, I will cover building plugins for ChatGPT.

## Resources

- [Azure OpenAI Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/)
- [Function Calling Guide](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/function-calling)
- [Azure AI Studio](https://ai.azure.com/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
