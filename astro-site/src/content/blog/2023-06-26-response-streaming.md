---
title: "Response Streaming: Real-Time LLM Output"
author: Michael John Peña
draft: false
date: 2023-06-26
tags:
  - Azure OpenAI
  - Streaming
  - Performance
  - UX
  - Real-Time

---

I wrote "Response Streaming: Real-Time LLM Output" to share practical, production-minded guidance on this topic.

## Why Streaming Matters

```python
streaming_benefits = {
    "perceived_latency": "Users see content immediately instead of waiting",
    "time_to_first_token": "Response starts in ~100ms vs seconds for full response",
    "user_engagement": "Progressive display keeps users engaged",
    "cancelability": "Users can stop generation mid-stream"
}
```

## Basic Streaming

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key="your-key",
    api_version="2023-07-01-preview",
    azure_endpoint="https://your-resource.openai.azure.com"
)

def stream_chat(messages: list, model: str = "gpt-4"):
    """Basic streaming chat"""

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True
    )

    full_response = ""

    for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            full_response += content
            yield content

    return full_response

# Usage
for token in stream_chat([{"role": "user", "content": "Explain quantum computing"}]):
    print(token, end="", flush=True)
```

## Async Streaming

```python
import asyncio
from openai import AsyncAzureOpenAI

async_client = AsyncAzureOpenAI(
    api_key="your-key",
    api_version="2023-07-01-preview",
    azure_endpoint="https://your-resource.openai.azure.com"
)

async def async_stream_chat(messages: list, model: str = "gpt-4"):
    """Async streaming chat"""

    response = await async_client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True
    )

    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content

# Usage with asyncio
async def main():
    async for token in async_stream_chat([{"role": "user", "content": "Hello"}]):
        print(token, end="", flush=True)

asyncio.run(main())
```

## FastAPI Streaming Endpoint

```python
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import json

app = FastAPI()

async def generate_stream(messages: list):
    """Generate streaming response"""

    response = await async_client.chat.completions.create(
        model="gpt-4",
        messages=messages,
        stream=True
    )

    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            # Send as Server-Sent Event
            yield f"data: {json.dumps({'content': content})}\n\n"

    yield "data: [DONE]\n\n"

@app.post("/chat/stream")
async def chat_stream(request: Request):
    """Streaming chat endpoint"""
    data = await request.json()
    messages = data.get("messages", [])

    return StreamingResponse(
        generate_stream(messages),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )
```

## Frontend Consumption

```typescript
// JavaScript/TypeScript client for streaming
async function streamChat(messages: Array<{role: string, content: string}>) {
    const response = await fetch('/chat/stream', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages})
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (reader) {
        const {done, value} = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(data);
                    fullResponse += parsed.content;
                    // Update UI
                    document.getElementById('response').innerText = fullResponse;
                } catch (e) {
                    // Handle parse errors
                }
            }
        }
    }

    return fullResponse;
}
```

## Streaming with Function Calls

```python
async def stream_with_functions(messages: list, functions: list):
    """Stream response that may include function calls"""

    response = await async_client.chat.completions.create(
        model="gpt-4",
        messages=messages,
        functions=functions,
        stream=True
    )

    full_content = ""
    function_call = {"name": "", "arguments": ""}
    current_mode = "content"  # or "function"

    async for chunk in response:
        choice = chunk.choices[0] if chunk.choices else None
        if not choice:
            continue

        delta = choice.delta

        # Check for function call
        if delta.function_call:
            current_mode = "function"
            if delta.function_call.name:
                function_call["name"] = delta.function_call.name
            if delta.function_call.arguments:
                function_call["arguments"] += delta.function_call.arguments

        # Regular content
        elif delta.content:
            current_mode = "content"
            full_content += delta.content
            yield {"type": "content", "content": delta.content}

        # Check finish reason
        if choice.finish_reason == "function_call":
            yield {
                "type": "function_call",
                "name": function_call["name"],
                "arguments": json.loads(function_call["arguments"])
            }
        elif choice.finish_reason == "stop":
            yield {"type": "done", "content": full_content}
```

## Streaming with Progress Tracking

```python
class StreamingResponse:
    """Track streaming progress"""

    def __init__(self):
        self.tokens = []
        self.start_time = None
        self.first_token_time = None
        self.end_time = None

    async def stream(self, messages: list, model: str = "gpt-4"):
        """Stream with metrics"""
        import time

        self.start_time = time.time()

        response = await async_client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                if self.first_token_time is None:
                    self.first_token_time = time.time()

                content = chunk.choices[0].delta.content
                self.tokens.append(content)
                yield content

        self.end_time = time.time()

    def get_metrics(self) -> dict:
        """Get streaming metrics"""
        if not self.start_time:
            return {}

        return {
            "time_to_first_token": self.first_token_time - self.start_time if self.first_token_time else None,
            "total_time": self.end_time - self.start_time if self.end_time else None,
            "token_count": len(self.tokens),
            "tokens_per_second": len(self.tokens) / (self.end_time - self.start_time) if self.end_time else None
        }

# Usage
streamer = StreamingResponse()
async for token in streamer.stream([{"role": "user", "content": "Hello"}]):
    print(token, end="")

print(f"\nMetrics: {streamer.get_metrics()}")
```

## Cancellation Support

```python
import asyncio

class CancellableStream:
    """Support cancelling streaming response"""

    def __init__(self, client):
        self.client = client
        self.cancelled = False

    def cancel(self):
        """Cancel the stream"""
        self.cancelled = True

    async def stream(self, messages: list, model: str = "gpt-4"):
        """Stream with cancellation support"""

        response = await self.client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True
        )

        async for chunk in response:
            if self.cancelled:
                # Clean up and exit
                await response.aclose()
                yield {"type": "cancelled"}
                return

            if chunk.choices and chunk.choices[0].delta.content:
                yield {"type": "content", "content": chunk.choices[0].delta.content}

        yield {"type": "done"}

# Usage
streamer = CancellableStream(async_client)

# In another task/thread
# streamer.cancel()
```

Streaming improves the user experience significantly. Tomorrow, I will cover error handling for AI applications.

## Resources

- [Azure OpenAI Streaming](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/streaming)
- [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
