---
title: "Azure OpenAI REST API: Direct Integration Without SDKs"
author: Michael John Peña
draft: false
date: 2023-01-21
tags:
  - Azure
  - OpenAI
  - REST API
  - Integration
  - HTTP
---

## API Structure

Azure OpenAI REST API follows this pattern:

```
https://{resource-name}.openai.azure.com/openai/deployments/{deployment-name}/{operation}?api-version={api-version}
```

## Authentication

Two authentication methods are available:

```bash
# API Key authentication
curl -X POST "https://your-resource.openai.azure.com/openai/deployments/gpt35/chat/completions?api-version=2023-03-15-preview" \
  -H "Content-Type: application/json" \
  -H "api-key: YOUR_API_KEY" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'

# Azure AD authentication
curl -X POST "https://your-resource.openai.azure.com/openai/deployments/gpt35/chat/completions?api-version=2023-03-15-preview" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

## Completions Endpoint

```python
import requests
import json
from typing import Optional, Dict, Any

class AzureOpenAIRestClient:
    """REST client for Azure OpenAI."""

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        api_version: str = "2023-03-15-preview"
    ):
        self.endpoint = endpoint.rstrip('/')
        self.api_key = api_key
        self.api_version = api_version

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "api-key": self.api_key
        }

    def _build_url(self, deployment: str, operation: str) -> str:
        return f"{self.endpoint}/openai/deployments/{deployment}/{operation}?api-version={self.api_version}"

    def completions(
        self,
        deployment: str,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs
    ) -> Dict[str, Any]:
        """Call the completions endpoint."""
        url = self._build_url(deployment, "completions")

        payload = {
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            **kwargs
        }

        response = requests.post(
            url,
            headers=self._get_headers(),
            json=payload
        )
        response.raise_for_status()

        return response.json()

    def chat_completions(
        self,
        deployment: str,
        messages: list,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs
    ) -> Dict[str, Any]:
        """Call the chat completions endpoint."""
        url = self._build_url(deployment, "chat/completions")

        payload = {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            **kwargs
        }

        response = requests.post(
            url,
            headers=self._get_headers(),
            json=payload
        )
        response.raise_for_status()

        return response.json()

    def embeddings(
        self,
        deployment: str,
        input_text: str
    ) -> Dict[str, Any]:
        """Call the embeddings endpoint."""
        url = self._build_url(deployment, "embeddings")

        payload = {
            "input": input_text
        }

        response = requests.post(
            url,
            headers=self._get_headers(),
            json=payload
        )
        response.raise_for_status()

        return response.json()

# Usage
client = AzureOpenAIRestClient(
    endpoint="https://your-resource.openai.azure.com",
    api_key="your-api-key"
)

# Completion
result = client.completions(
    deployment="text-davinci-003",
    prompt="Explain Azure in one sentence:"
)
print(result["choices"][0]["text"])

# Chat
result = client.chat_completions(
    deployment="gpt-35-turbo",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is Azure?"}
    ]
)
print(result["choices"][0]["message"]["content"])
```

## Streaming Responses

```python
import requests
import json

def stream_chat_completion(
    endpoint: str,
    deployment: str,
    api_key: str,
    messages: list,
    api_version: str = "2023-03-15-preview"
):
    """Stream chat completion responses."""
    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"

    headers = {
        "Content-Type": "application/json",
        "api-key": api_key
    }

    payload = {
        "messages": messages,
        "stream": True
    }

    with requests.post(url, headers=headers, json=payload, stream=True) as response:
        response.raise_for_status()

        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data = line[6:]  # Remove 'data: ' prefix
                    if data == '[DONE]':
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk['choices'][0].get('delta', {})
                        if 'content' in delta:
                            yield delta['content']
                    except json.JSONDecodeError:
                        continue

# Usage
for token in stream_chat_completion(
    endpoint="https://your-resource.openai.azure.com",
    deployment="gpt-35-turbo",
    api_key="your-api-key",
    messages=[{"role": "user", "content": "Tell me a story"}]
):
    print(token, end="", flush=True)
```

## Request/Response Schemas

### Chat Completions Request

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "What is Azure?"
    }
  ],
  "max_tokens": 500,
  "temperature": 0.7,
  "top_p": 1.0,
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "stop": null,
  "stream": false
}
```

### Chat Completions Response

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677858242,
  "model": "gpt-35-turbo",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Azure is Microsoft's cloud computing platform..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 150,
    "total_tokens": 175
  }
}
```

## Error Handling

```python
from dataclasses import dataclass
from typing import Optional
import requests

@dataclass
class APIError:
    """API error information."""
    status_code: int
    error_code: Optional[str]
    message: str
    retry_after: Optional[int] = None

class AzureOpenAIError(Exception):
    """Azure OpenAI API error."""

    def __init__(self, error: APIError):
        self.error = error
        super().__init__(f"{error.status_code}: {error.message}")

def handle_response(response: requests.Response) -> dict:
    """Handle API response with error handling."""
    if response.status_code == 200:
        return response.json()

    # Parse error response
    try:
        error_data = response.json()
        error_message = error_data.get("error", {}).get("message", "Unknown error")
        error_code = error_data.get("error", {}).get("code")
    except:
        error_message = response.text
        error_code = None

    # Get retry-after header for rate limits
    retry_after = None
    if response.status_code == 429:
        retry_after = int(response.headers.get("Retry-After", 60))

    error = APIError(
        status_code=response.status_code,
        error_code=error_code,
        message=error_message,
        retry_after=retry_after
    )

    raise AzureOpenAIError(error)

class RobustRestClient(AzureOpenAIRestClient):
    """REST client with error handling and retry."""

    def __init__(self, *args, max_retries: int = 3, **kwargs):
        super().__init__(*args, **kwargs)
        self.max_retries = max_retries

    def _request_with_retry(
        self,
        method: str,
        url: str,
        **kwargs
    ) -> dict:
        """Make request with retry logic."""
        import time

        last_error = None

        for attempt in range(self.max_retries):
            try:
                response = requests.request(
                    method,
                    url,
                    headers=self._get_headers(),
                    **kwargs
                )
                return handle_response(response)

            except AzureOpenAIError as e:
                last_error = e

                # Retry on rate limit or server errors
                if e.error.status_code in (429, 500, 502, 503, 504):
                    wait_time = e.error.retry_after or (2 ** attempt)
                    print(f"Retrying in {wait_time}s (attempt {attempt + 1})")
                    time.sleep(wait_time)
                else:
                    raise

        raise last_error

    def chat_completions(self, deployment: str, messages: list, **kwargs) -> dict:
        url = self._build_url(deployment, "chat/completions")
        return self._request_with_retry("POST", url, json={"messages": messages, **kwargs})
```

## Language-Agnostic Examples

### cURL

```bash
# Chat completion
curl -X POST "https://your-resource.openai.azure.com/openai/deployments/gpt35/chat/completions?api-version=2023-03-15-preview" \
  -H "Content-Type: application/json" \
  -H "api-key: YOUR_KEY" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100
  }'
```

### JavaScript/Node.js

```javascript
async function chatCompletion(messages) {
  const response = await fetch(
    `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt35/chat/completions?api-version=2023-03-15-preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.AZURE_OPENAI_KEY
      },
      body: JSON.stringify({
        messages: messages,
        max_tokens: 500
      })
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

// Streaming with fetch
async function* streamChatCompletion(messages) {
  const response = await fetch(
    `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt35/chat/completions?api-version=2023-03-15-preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.AZURE_OPENAI_KEY
      },
      body: JSON.stringify({
        messages: messages,
        stream: true
      })
    }
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices[0]?.delta?.content;
        if (content) yield content;
      } catch (e) {
        continue;
      }
    }
  }
}
```

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
)

type ChatMessage struct {
    Role    string `json:"role"`
    Content string `json:"content"`
}

type ChatRequest struct {
    Messages  []ChatMessage `json:"messages"`
    MaxTokens int           `json:"max_tokens,omitempty"`
}

type ChatResponse struct {
    Choices []struct {
        Message ChatMessage `json:"message"`
    } `json:"choices"`
}

func chatCompletion(messages []ChatMessage) (*ChatResponse, error) {
    endpoint := os.Getenv("AZURE_OPENAI_ENDPOINT")
    apiKey := os.Getenv("AZURE_OPENAI_KEY")

    url := fmt.Sprintf("%s/openai/deployments/gpt35/chat/completions?api-version=2023-03-15-preview", endpoint)

    reqBody, _ := json.Marshal(ChatRequest{
        Messages:  messages,
        MaxTokens: 500,
    })

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(reqBody))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("api-key", apiKey)

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)

    var result ChatResponse
    json.Unmarshal(body, &result)

    return &result, nil
}
```

## API Versioning

Always specify the API version:

```python
API_VERSIONS = {
    "2022-12-01": "Initial GA version",
    "2023-03-15-preview": "Chat completions, function calling preview",
    "2023-05-15": "Stable chat completions",
    "2023-06-01-preview": "Enhanced features"
}

# Use the latest stable version for production
PRODUCTION_API_VERSION = "2023-05-15"
PREVIEW_API_VERSION = "2023-06-01-preview"
```

## Best Practices

1. **Always handle errors**: Check status codes and parse error messages
2. **Implement retry logic**: For rate limits and transient failures
3. **Use streaming**: For better UX on long responses
4. **Set timeouts**: Prevent hanging requests
5. **Track usage**: Monitor token consumption from response
6. **Version your API calls**: Pin to specific API versions

## Resources

- [Azure OpenAI REST API Reference](https://learn.microsoft.com/azure/cognitive-services/openai/reference)
- [API Versions](https://learn.microsoft.com/azure/cognitive-services/openai/reference#api-specs)
- [Authentication](https://learn.microsoft.com/azure/cognitive-services/openai/reference#authentication)
