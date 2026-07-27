---
title: "Mistral Large on Azure: Getting Started Guide"
author: "Michael John Peña"
draft: false
date: 2024-03-06
tags: ["Azure", "Mistral", "AI", "LLM", "Machine Learning"]

---

I wrote "Mistral Large on Azure: Getting Started Guide" to share practical, production-minded guidance on this topic.

Mistral Large is now available on Azure AI, bringing one of Europe's most capable AI models to the Azure ecosystem. This guide covers deployment, usage, and best practices.

## Why Mistral Large?

Mistral Large offers:
- **Strong multilingual support**: Excellent in European languages
- **32K context window**: Process longer documents
- **Cost-effective**: Competitive pricing for enterprise workloads
- **Function calling**: Native tool use capabilities

## Deployment Options

### Option 1: Serverless API (Recommended for Getting Started)

```bash
# Using Azure CLI
az ml serverless-endpoint create \
    --name mistral-large-endpoint \
    --model-id azureml://registries/azureml-mistral/models/Mistral-large/versions/1 \
    --resource-group your-rg \
    --workspace-name your-workspace
```

### Option 2: Managed Compute

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment
)
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-sub-id",
    resource_group="your-rg",
    workspace_name="your-workspace"
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="mistral-large-managed",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Create deployment
deployment = ManagedOnlineDeployment(
    name="mistral-deployment",
    endpoint_name="mistral-large-managed",
    model="azureml://registries/azureml-mistral/models/Mistral-large/versions/1",
    instance_type="Standard_NC24ads_A100_v4",
    instance_count=1
)
ml_client.online_deployments.begin_create_or_update(deployment).result()
```

## Using the API

### Basic Completion

```python
import requests

endpoint_url = "https://your-endpoint.inference.ai.azure.com"
api_key = "your-api-key"

def chat_with_mistral(messages: list, max_tokens: int = 1024) -> str:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    payload = {
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7
    }

    response = requests.post(
        f"{endpoint_url}/v1/chat/completions",
        headers=headers,
        json=payload
    )

    return response.json()["choices"][0]["message"]["content"]

# Example usage
response = chat_with_mistral([
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Explain cloud computing in French."}
])
print(response)
```

### Function Calling

```python
def mistral_function_call(messages: list, tools: list):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    payload = {
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": 1024
    }

    response = requests.post(
        f"{endpoint_url}/v1/chat/completions",
        headers=headers,
        json=payload
    )

    return response.json()

# Define tools
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather in a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "The city name"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"]
                    }
                },
                "required": ["city"]
            }
        }
    }
]

messages = [
    {"role": "user", "content": "What's the weather like in Paris?"}
]

result = mistral_function_call(messages, tools)
print(result)
```

## Streaming Responses

```python
import requests
import json

def stream_mistral_response(messages: list):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    payload = {
        "messages": messages,
        "max_tokens": 1024,
        "stream": True
    }

    with requests.post(
        f"{endpoint_url}/v1/chat/completions",
        headers=headers,
        json=payload,
        stream=True
    ) as response:
        for line in response.iter_lines():
            if line:
                line_text = line.decode('utf-8')
                if line_text.startswith('data: '):
                    data = line_text[6:]
                    if data != '[DONE]':
                        chunk = json.loads(data)
                        content = chunk['choices'][0]['delta'].get('content', '')
                        if content:
                            print(content, end='', flush=True)

# Usage
stream_mistral_response([
    {"role": "user", "content": "Write a poem about Azure cloud."}
])
```

## Integration with LangChain

```python
from langchain_community.chat_models import AzureMLChatOnlineEndpoint
from langchain.schema import HumanMessage, SystemMessage

chat = AzureMLChatOnlineEndpoint(
    endpoint_url="https://your-endpoint.inference.ai.azure.com/v1/chat/completions",
    endpoint_api_key="your-api-key"
)

messages = [
    SystemMessage(content="You are a technical writer."),
    HumanMessage(content="Write documentation for a REST API.")
]

response = chat(messages)
print(response.content)
```

## Cost Comparison

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Mistral Large | $4.00 | $12.00 |
| GPT-4 Turbo | $10.00 | $30.00 |
| Claude 3 Sonnet | $3.00 | $15.00 |

## Best Practices

1. **Use for multilingual tasks**: Mistral excels at European languages
2. **Leverage function calling**: Great for agentic applications
3. **Monitor latency**: Track p99 latency for production
4. **Set up alerts**: Use Azure Monitor for anomaly detection

## Conclusion

Mistral Large on Azure provides a powerful, cost-effective option for enterprise AI workloads. The serverless deployment option makes it easy to get started without infrastructure management.

