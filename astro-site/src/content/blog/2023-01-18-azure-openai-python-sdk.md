---
title: "Azure OpenAI Python SDK: A Complete Developer Guide"
description: "The Python SDK for Azure OpenAI (openai package with Azure-specific configuration) is the de facto starting point for Azure OpenAI development—the largest…"
author: Michael John Peña
draft: false
date: 2023-01-18
tags:
  - Azure
  - OpenAI
  - Python
  - SDK
  - Development
---

The Python SDK for Azure OpenAI (`openai` package with Azure-specific configuration) is the de facto starting point for Azure OpenAI development—the largest community of Azure OpenAI practitioners in January 2023 was Python-based, partly because the Azure ML and data science ecosystem runs on Python, and partly because OpenAI's own examples and documentation were Python-first. The Azure-specific configuration: unlike the direct OpenAI API (which uses `openai.api_key`), the Azure OpenAI SDK requires setting `openai.api_type = "azure"`, `openai.api_base = "https://your-resource.openai.azure.com/"`, `openai.api_version = "2023-05-15"` (or the current API version), and `openai.api_key` to the Azure OpenAI resource's API key or an Azure AD token. The deployment name: Azure OpenAI's SDK uses the `engine` parameter (for Completion API) or `model` parameter (for Chat Completion API) to specify the deployment name—the name you gave to the model deployment in the Azure OpenAI Studio, not the underlying model name (e.g., `engine="my-gpt35-deployment"` rather than `engine="text-davinci-003"`). The SDK version compatibility: the `openai` Python package versions before 1.0 (released November 2023) have different configuration patterns from 1.0+; the code in this post uses the pre-1.0 SDK version that was current in January 2023.

## Installation and Setup

```bash
pip install openai
pip install azure-identity  # For Azure AD authentication
```

## Basic Configuration

```python
import openai
import os
from typing import Optional

class AzureOpenAIConfig:
    """Configuration for Azure OpenAI."""

    def __init__(
        self,
        endpoint: Optional[str] = None,
        api_key: Optional[str] = None,
        api_version: str = "2023-03-15-preview"
    ):
        self.endpoint = endpoint or os.getenv("AZURE_OPENAI_ENDPOINT")
        self.api_key = api_key or os.getenv("AZURE_OPENAI_KEY")
        self.api_version = api_version

        if not self.endpoint:
            raise ValueError("Azure OpenAI endpoint not configured")
        if not self.api_key:
            raise ValueError("Azure OpenAI API key not configured")

    def configure_openai(self):
        """Configure the openai library for Azure."""
        openai.api_type = "azure"
        openai.api_base = self.endpoint
        openai.api_version = self.api_version
        openai.api_key = self.api_key

# Usage
config = AzureOpenAIConfig()
config.configure_openai()
```

## Completion Operations

```python
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
import openai

@dataclass
class CompletionResult:
    """Result from a completion request."""
    text: str
    finish_reason: str
    tokens: Dict[str, int]
    model: str

class CompletionService:
    """Service for text completions."""

    def __init__(self, deployment: str):
        self.deployment = deployment

    def complete(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        top_p: float = 1.0,
        stop: Optional[List[str]] = None,
        **kwargs
    ) -> CompletionResult:
        """Generate a text completion."""
        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stop=stop,
            **kwargs
        )

        choice = response.choices[0]
        return CompletionResult(
            text=choice.text.strip(),
            finish_reason=choice.finish_reason,
            tokens={
                "prompt": response.usage.prompt_tokens,
                "completion": response.usage.completion_tokens,
                "total": response.usage.total_tokens
            },
            model=response.model
        )

    def complete_multiple(
        self,
        prompt: str,
        n: int = 3,
        **kwargs
    ) -> List[CompletionResult]:
        """Generate multiple completions."""
        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            n=n,
            **kwargs
        )

        return [
            CompletionResult(
                text=choice.text.strip(),
                finish_reason=choice.finish_reason,
                tokens={
                    "prompt": response.usage.prompt_tokens,
                    "completion": response.usage.completion_tokens // n,
                    "total": response.usage.total_tokens
                },
                model=response.model
            )
            for choice in response.choices
        ]

    def stream_complete(
        self,
        prompt: str,
        **kwargs
    ):
        """Stream completion tokens."""
        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            stream=True,
            **kwargs
        )

        for chunk in response:
            if chunk.choices[0].text:
                yield chunk.choices[0].text

# Usage
service = CompletionService("text-davinci-003")

# Single completion
result = service.complete("Explain cloud computing:")
print(result.text)

# Multiple completions
results = service.complete_multiple(
    "Write a tagline for Azure:",
    n=3,
    max_tokens=50
)
for r in results:
    print(f"- {r.text}")

# Streaming
for token in service.stream_complete("Tell me about Azure:", max_tokens=100):
    print(token, end="", flush=True)
```

## Chat Completion Operations

```python
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Generator
from datetime import datetime

@dataclass
class ChatMessage:
    """A chat message."""
    role: str
    content: str
    name: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, str]:
        """Convert to API format."""
        d = {"role": self.role, "content": self.content}
        if self.name:
            d["name"] = self.name
        return d

@dataclass
class ChatResult:
    """Result from a chat completion."""
    message: ChatMessage
    finish_reason: str
    tokens: Dict[str, int]
    model: str

class ChatService:
    """Service for chat completions."""

    def __init__(self, deployment: str):
        self.deployment = deployment

    def chat(
        self,
        messages: List[ChatMessage],
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs
    ) -> ChatResult:
        """Send chat messages and get response."""
        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[m.to_dict() for m in messages],
            max_tokens=max_tokens,
            temperature=temperature,
            **kwargs
        )

        choice = response.choices[0]
        return ChatResult(
            message=ChatMessage(
                role=choice.message.role,
                content=choice.message.content
            ),
            finish_reason=choice.finish_reason,
            tokens={
                "prompt": response.usage.prompt_tokens,
                "completion": response.usage.completion_tokens,
                "total": response.usage.total_tokens
            },
            model=response.model
        )

    def stream_chat(
        self,
        messages: List[ChatMessage],
        **kwargs
    ) -> Generator[str, None, None]:
        """Stream chat response tokens."""
        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[m.to_dict() for m in messages],
            stream=True,
            **kwargs
        )

        for chunk in response:
            delta = chunk.choices[0].delta
            if hasattr(delta, 'content') and delta.content:
                yield delta.content

class Conversation:
    """Manage a multi-turn conversation."""

    def __init__(
        self,
        chat_service: ChatService,
        system_prompt: Optional[str] = None
    ):
        self.chat_service = chat_service
        self.messages: List[ChatMessage] = []

        if system_prompt:
            self.messages.append(ChatMessage(
                role="system",
                content=system_prompt
            ))

    def send(
        self,
        user_message: str,
        **kwargs
    ) -> str:
        """Send a message and get response."""
        self.messages.append(ChatMessage(
            role="user",
            content=user_message
        ))

        result = self.chat_service.chat(self.messages, **kwargs)

        self.messages.append(result.message)
        return result.message.content

    def stream_send(
        self,
        user_message: str,
        **kwargs
    ) -> Generator[str, None, None]:
        """Send message and stream response."""
        self.messages.append(ChatMessage(
            role="user",
            content=user_message
        ))

        full_response = ""
        for token in self.chat_service.stream_chat(self.messages, **kwargs):
            full_response += token
            yield token

        # Add complete response to history
        self.messages.append(ChatMessage(
            role="assistant",
            content=full_response
        ))

    def clear(self):
        """Clear conversation history (keep system prompt)."""
        system_messages = [m for m in self.messages if m.role == "system"]
        self.messages = system_messages

    def get_history(self) -> List[Dict[str, str]]:
        """Get conversation history."""
        return [m.to_dict() for m in self.messages]

# Usage
chat_service = ChatService("gpt-35-turbo")

# Single chat
messages = [
    ChatMessage(role="system", content="You are a helpful Azure expert."),
    ChatMessage(role="user", content="What is Azure Functions?")
]
result = chat_service.chat(messages)
print(result.message.content)

# Conversation
conversation = Conversation(
    chat_service,
    system_prompt="You are a helpful Azure architect."
)

response1 = conversation.send("What database should I use for high-throughput writes?")
print(f"Bot: {response1}")

response2 = conversation.send("How do I set that up?")
print(f"Bot: {response2}")
```

## Embeddings

```python
from typing import List
import numpy as np

@dataclass
class EmbeddingResult:
    """Result from embedding request."""
    embedding: List[float]
    tokens: int
    model: str

class EmbeddingService:
    """Service for text embeddings."""

    def __init__(self, deployment: str = "text-embedding-ada-002"):
        self.deployment = deployment

    def embed(self, text: str) -> EmbeddingResult:
        """Get embedding for text."""
        response = openai.Embedding.create(
            engine=self.deployment,
            input=text
        )

        return EmbeddingResult(
            embedding=response.data[0].embedding,
            tokens=response.usage.total_tokens,
            model=response.model
        )

    def embed_batch(self, texts: List[str]) -> List[EmbeddingResult]:
        """Get embeddings for multiple texts."""
        response = openai.Embedding.create(
            engine=self.deployment,
            input=texts
        )

        return [
            EmbeddingResult(
                embedding=item.embedding,
                tokens=response.usage.total_tokens // len(texts),
                model=response.model
            )
            for item in response.data
        ]

    @staticmethod
    def cosine_similarity(a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity between embeddings."""
        a = np.array(a)
        b = np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def find_most_similar(
        self,
        query: str,
        documents: List[str],
        top_k: int = 5
    ) -> List[tuple]:
        """Find most similar documents to query."""
        query_embedding = self.embed(query).embedding
        doc_embeddings = self.embed_batch(documents)

        similarities = [
            (doc, self.cosine_similarity(query_embedding, emb.embedding))
            for doc, emb in zip(documents, doc_embeddings)
        ]

        return sorted(similarities, key=lambda x: x[1], reverse=True)[:top_k]

# Usage
embedding_service = EmbeddingService()

# Single embedding
result = embedding_service.embed("Azure is a cloud platform")
print(f"Embedding dimensions: {len(result.embedding)}")

# Find similar
documents = [
    "Azure provides cloud computing services",
    "Python is a programming language",
    "Microsoft Azure offers IaaS and PaaS",
    "Machine learning on the cloud"
]

similar = embedding_service.find_most_similar(
    "What is Azure cloud?",
    documents
)
for doc, score in similar:
    print(f"{score:.3f}: {doc}")
```

## Error Handling

```python
from functools import wraps
import time
import openai

class OpenAIError(Exception):
    """Base exception for OpenAI errors."""
    pass

class RateLimitError(OpenAIError):
    """Rate limit exceeded."""
    pass

class ContentFilterError(OpenAIError):
    """Content filtered."""
    pass

def handle_openai_errors(func):
    """Decorator to handle OpenAI errors."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except openai.error.RateLimitError as e:
            raise RateLimitError(f"Rate limit exceeded: {e}")
        except openai.error.InvalidRequestError as e:
            if "content_filter" in str(e).lower():
                raise ContentFilterError(f"Content filtered: {e}")
            raise OpenAIError(f"Invalid request: {e}")
        except openai.error.AuthenticationError as e:
            raise OpenAIError(f"Authentication failed: {e}")
        except openai.error.ServiceUnavailableError as e:
            raise OpenAIError(f"Service unavailable: {e}")
        except openai.error.APIError as e:
            raise OpenAIError(f"API error: {e}")
    return wrapper

def with_retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0
):
    """Decorator for retry logic."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except (RateLimitError, openai.error.RateLimitError) as e:
                    last_error = e
                    if attempt < max_retries:
                        delay = min(base_delay * (2 ** attempt), max_delay)
                        time.sleep(delay)
                except Exception as e:
                    raise

            raise last_error

        return wrapper
    return decorator

# Usage
class RobustChatService(ChatService):
    """Chat service with error handling."""

    @with_retry(max_retries=3)
    @handle_openai_errors
    def chat(self, messages: List[ChatMessage], **kwargs) -> ChatResult:
        return super().chat(messages, **kwargs)
```

## Async Support

```python
import asyncio
import aiohttp
from typing import AsyncGenerator

class AsyncOpenAIClient:
    """Async client for Azure OpenAI."""

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        api_version: str = "2023-03-15-preview"
    ):
        self.endpoint = endpoint
        self.api_key = api_key
        self.api_version = api_version

    async def chat_completion(
        self,
        deployment: str,
        messages: List[Dict[str, str]],
        **kwargs
    ) -> Dict:
        """Async chat completion."""
        url = f"{self.endpoint}/openai/deployments/{deployment}/chat/completions"

        headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json"
        }

        params = {"api-version": self.api_version}

        body = {
            "messages": messages,
            **kwargs
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                params=params,
                json=body
            ) as response:
                response.raise_for_status()
                return await response.json()

    async def stream_chat_completion(
        self,
        deployment: str,
        messages: List[Dict[str, str]],
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion tokens."""
        url = f"{self.endpoint}/openai/deployments/{deployment}/chat/completions"

        headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json"
        }

        params = {"api-version": self.api_version}

        body = {
            "messages": messages,
            "stream": True,
            **kwargs
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                params=params,
                json=body
            ) as response:
                async for line in response.content:
                    line = line.decode('utf-8').strip()
                    if line.startswith('data: ') and line != 'data: [DONE]':
                        import json
                        data = json.loads(line[6:])
                        delta = data['choices'][0].get('delta', {})
                        if 'content' in delta:
                            yield delta['content']

# Usage
async def main():
    client = AsyncOpenAIClient(
        endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        api_key=os.getenv("AZURE_OPENAI_KEY")
    )

    # Concurrent requests
    messages = [{"role": "user", "content": "Hello!"}]
    tasks = [
        client.chat_completion("gpt-35-turbo", messages)
        for _ in range(3)
    ]
    results = await asyncio.gather(*tasks)

    # Streaming
    async for token in client.stream_chat_completion(
        "gpt-35-turbo",
        messages
    ):
        print(token, end="", flush=True)

# asyncio.run(main())
```

## Best Practices

1. **Use environment variables** for credentials
2. **Implement retry logic** for rate limits
3. **Handle errors gracefully** with specific exceptions
4. **Use streaming** for better UX on long responses
5. **Track token usage** for cost management
6. **Use async** for high-throughput applications

## Resources

- [OpenAI Python Library](https://github.com/openai/openai-python)
- [Azure OpenAI SDK Samples](https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/openai)
- [API Reference](https://learn.microsoft.com/azure/cognitive-services/openai/reference)
