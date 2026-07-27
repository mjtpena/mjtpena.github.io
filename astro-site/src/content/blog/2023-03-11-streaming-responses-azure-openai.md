---
title: "Streaming Responses with Azure OpenAI"
author: Michael John Pena
draft: false
date: 2023-03-11
tags:
  - Azure
  - OpenAI
  - AI
  - Streaming
  - UX

---

I wrote "Streaming Responses with Azure OpenAI" to share practical, production-minded guidance on this topic.

## Why Streaming?

- **Perceived latency**: Users see responses immediately
- **Time to first token**: ~100ms vs 3-10 seconds for full response
- **Better UX**: Users can start reading immediately
- **Cancel capability**: Stop generation mid-stream if off-track

## Basic Streaming with Azure OpenAI

```python
import openai

openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_version = "2023-03-15-preview"
openai.api_key = "your-api-key"

def stream_completion(prompt: str):
    """Stream a completion response."""
    response = openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    for chunk in response:
        if chunk.choices[0].delta.get("content"):
            yield chunk.choices[0].delta.content

# Usage
for text in stream_completion("Explain Azure Data Factory"):
    print(text, end="", flush=True)
```

## Streaming with FastAPI

Build a streaming API endpoint:

```python
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
import openai
import json
import asyncio

app = FastAPI()

async def generate_stream(prompt: str):
    """Generate streaming response."""
    response = await openai.ChatCompletion.acreate(
        engine="gpt-35-turbo",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    async for chunk in response:
        if chunk.choices[0].delta.get("content"):
            content = chunk.choices[0].delta.content
            yield f"data: {json.dumps({'content': content})}\n\n"

    yield "data: [DONE]\n\n"

@app.post("/api/chat/stream")
async def chat_stream(request: Request):
    """Server-Sent Events endpoint for streaming."""
    body = await request.json()
    prompt = body.get("prompt", "")

    return EventSourceResponse(
        generate_stream(prompt),
        media_type="text/event-stream"
    )

# Alternative using StreamingResponse
@app.post("/api/chat/stream-raw")
async def chat_stream_raw(request: Request):
    """Raw streaming response."""
    body = await request.json()
    prompt = body.get("prompt", "")

    async def stream():
        response = await openai.ChatCompletion.acreate(
            engine="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )

        async for chunk in response:
            if chunk.choices[0].delta.get("content"):
                yield chunk.choices[0].delta.content

    return StreamingResponse(stream(), media_type="text/plain")
```

## Frontend Integration (JavaScript)

```javascript
// Using EventSource (Server-Sent Events)
async function streamChat(prompt, onChunk, onComplete) {
    const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            onComplete();
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                    onComplete();
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    onChunk(parsed.content);
                } catch (e) {
                    console.error('Parse error:', e);
                }
            }
        }
    }
}

// Usage
const outputElement = document.getElementById('output');
outputElement.textContent = '';

streamChat(
    'What is Azure Synapse Analytics?',
    (chunk) => {
        outputElement.textContent += chunk;
    },
    () => {
        console.log('Stream complete');
    }
);
```

## React Component

```jsx
import { useState, useCallback } from 'react';

function StreamingChat() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);

    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        if (!input.trim() || isStreaming) return;

        const userMessage = { role: 'user', content: input };
        setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '' }]);
        setInput('');
        setIsStreaming(true);

        try {
            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: input })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const lines = text.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(6));
                            setMessages(prev => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                updated[lastIdx] = {
                                    ...updated[lastIdx],
                                    content: updated[lastIdx].content + data.content
                                };
                                return updated;
                            });
                        } catch (e) {}
                    }
                }
            }
        } catch (error) {
            console.error('Stream error:', error);
        } finally {
            setIsStreaming(false);
        }
    }, [input, isStreaming]);

    return (
        <div className="chat-container">
            <div className="messages">
                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.role}`}>
                        {msg.content}
                        {isStreaming && i === messages.length - 1 && (
                            <span className="cursor">|</span>
                        )}
                    </div>
                ))}
            </div>
            <form onSubmit={handleSubmit}>
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about Azure..."
                    disabled={isStreaming}
                />
                <button type="submit" disabled={isStreaming}>
                    {isStreaming ? 'Generating...' : 'Send'}
                </button>
            </form>
        </div>
    );
}

export default StreamingChat;
```

## Streaming with LangChain

```python
from langchain.chat_models import AzureChatOpenAI
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler
from langchain.callbacks.base import BaseCallbackHandler
from typing import Any

class CustomStreamHandler(BaseCallbackHandler):
    """Custom handler for streaming tokens."""

    def __init__(self, on_token):
        self.on_token = on_token

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        self.on_token(token)

def create_streaming_chat(on_token):
    """Create a streaming chat model."""
    return AzureChatOpenAI(
        deployment_name="gpt-35-turbo",
        openai_api_version="2023-03-15-preview",
        streaming=True,
        callbacks=[CustomStreamHandler(on_token)]
    )

# Usage
tokens = []
chat = create_streaming_chat(lambda t: tokens.append(t))
response = chat.predict("Explain Azure Event Hubs")

print(f"Collected {len(tokens)} tokens")
```

## Handling Errors and Cancellation

```python
import asyncio
from dataclasses import dataclass
from typing import Optional, AsyncIterator

@dataclass
class StreamState:
    is_cancelled: bool = False
    error: Optional[str] = None

async def stream_with_cancellation(
    prompt: str,
    state: StreamState
) -> AsyncIterator[str]:
    """Stream with cancellation support."""
    try:
        response = await openai.ChatCompletion.acreate(
            engine="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )

        async for chunk in response:
            if state.is_cancelled:
                break

            if chunk.choices[0].delta.get("content"):
                yield chunk.choices[0].delta.content

    except openai.error.APIError as e:
        state.error = f"API Error: {e}"
        yield f"\n[Error: {e}]"

    except asyncio.CancelledError:
        state.is_cancelled = True
        yield "\n[Cancelled]"

# FastAPI endpoint with cancellation
@app.post("/api/chat/stream-cancelable")
async def chat_stream_cancelable(request: Request):
    body = await request.json()
    prompt = body.get("prompt", "")

    state = StreamState()

    async def generate():
        async for token in stream_with_cancellation(prompt, state):
            if await request.is_disconnected():
                state.is_cancelled = True
                break
            yield f"data: {json.dumps({'content': token})}\n\n"

        yield "data: [DONE]\n\n"

    return EventSourceResponse(generate())
```

## Buffering for Word-by-Word Display

```python
class WordBuffer:
    """Buffer tokens to emit complete words."""

    def __init__(self):
        self.buffer = ""

    def add(self, token: str) -> list[str]:
        """Add token and return complete words."""
        self.buffer += token
        words = []

        # Find word boundaries
        while " " in self.buffer or "\n" in self.buffer:
            # Find first boundary
            space_idx = self.buffer.find(" ")
            newline_idx = self.buffer.find("\n")

            if space_idx == -1:
                idx = newline_idx
            elif newline_idx == -1:
                idx = space_idx
            else:
                idx = min(space_idx, newline_idx)

            word = self.buffer[:idx + 1]
            self.buffer = self.buffer[idx + 1:]
            words.append(word)

        return words

    def flush(self) -> str:
        """Flush remaining buffer."""
        remaining = self.buffer
        self.buffer = ""
        return remaining

async def stream_words(prompt: str):
    """Stream complete words instead of tokens."""
    buffer = WordBuffer()

    response = await openai.ChatCompletion.acreate(
        engine="gpt-35-turbo",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    async for chunk in response:
        if chunk.choices[0].delta.get("content"):
            token = chunk.choices[0].delta.content
            words = buffer.add(token)
            for word in words:
                yield word

    # Flush remaining
    remaining = buffer.flush()
    if remaining:
        yield remaining
```

## Performance Metrics

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

@dataclass
class StreamMetrics:
    start_time: datetime = field(default_factory=datetime.utcnow)
    first_token_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    token_count: int = 0
    total_characters: int = 0

    @property
    def time_to_first_token(self) -> Optional[float]:
        if self.first_token_time:
            return (self.first_token_time - self.start_time).total_seconds()
        return None

    @property
    def total_time(self) -> Optional[float]:
        if self.end_time:
            return (self.end_time - self.start_time).total_seconds()
        return None

    @property
    def tokens_per_second(self) -> Optional[float]:
        if self.total_time and self.total_time > 0:
            return self.token_count / self.total_time
        return None

async def stream_with_metrics(prompt: str) -> tuple[str, StreamMetrics]:
    """Stream response with performance metrics."""
    metrics = StreamMetrics()
    content = ""

    response = await openai.ChatCompletion.acreate(
        engine="gpt-35-turbo",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    async for chunk in response:
        if chunk.choices[0].delta.get("content"):
            token = chunk.choices[0].delta.content

            if metrics.first_token_time is None:
                metrics.first_token_time = datetime.utcnow()

            metrics.token_count += 1
            metrics.total_characters += len(token)
            content += token

    metrics.end_time = datetime.utcnow()

    return content, metrics

# Usage
content, metrics = await stream_with_metrics("What is Azure?")
print(f"Time to first token: {metrics.time_to_first_token:.2f}s")
print(f"Total time: {metrics.total_time:.2f}s")
print(f"Tokens/second: {metrics.tokens_per_second:.1f}")
```

Streaming transforms AI applications from feeling sluggish to feeling responsive. The implementation adds complexity, but the UX improvement is substantial. Start with basic streaming and add features like cancellation and metrics as needed.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
