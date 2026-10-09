---
title: "Streaming Responses with Azure OpenAI: Real-Time AI Output"
author: Michael John Peña
draft: false
date: 2023-01-22
tags:
  - Azure
  - OpenAI
  - Streaming
  - Performance
  - UX
---

## Why Streaming Matters

Without streaming, users wait for the entire response:
- 500 tokens at ~50 tokens/second = 10 seconds of waiting
- Users see nothing, then everything at once

With streaming:
- First token appears in ~200ms
- Users see progress as it generates
- Perceived performance is much better

## Python Streaming

```python
import openai
from typing import Generator, Optional

def stream_completion(
    prompt: str,
    deployment: str,
    max_tokens: int = 500,
    temperature: float = 0.7
) -> Generator[str, None, None]:
    """Stream completion tokens."""
    response = openai.Completion.create(
        engine=deployment,
        prompt=prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True
    )

    for chunk in response:
        if chunk.choices[0].text:
            yield chunk.choices[0].text

def stream_chat(
    messages: list,
    deployment: str,
    max_tokens: int = 500
) -> Generator[str, None, None]:
    """Stream chat completion tokens."""
    response = openai.ChatCompletion.create(
        engine=deployment,
        messages=messages,
        max_tokens=max_tokens,
        stream=True
    )

    for chunk in response:
        delta = chunk.choices[0].delta
        if hasattr(delta, 'content') and delta.content:
            yield delta.content

# Usage
print("Streaming completion:")
for token in stream_completion("Tell me about Azure:", "gpt35"):
    print(token, end="", flush=True)

print("\n\nStreaming chat:")
messages = [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "What is cloud computing?"}
]
for token in stream_chat(messages, "gpt-35-turbo"):
    print(token, end="", flush=True)
```

## Collecting Streamed Response

```python
from dataclasses import dataclass
from typing import Generator, List, Optional

@dataclass
class StreamedResponse:
    """Complete response from streaming."""
    content: str
    chunks: List[str]
    total_chunks: int
    finish_reason: Optional[str] = None

class StreamCollector:
    """Collect and process streamed responses."""

    def __init__(self):
        self.chunks: List[str] = []
        self.finish_reason: Optional[str] = None

    def collect(
        self,
        stream: Generator[str, None, None],
        on_chunk: Optional[callable] = None
    ) -> StreamedResponse:
        """Collect all chunks from a stream."""
        self.chunks = []

        for chunk in stream:
            self.chunks.append(chunk)
            if on_chunk:
                on_chunk(chunk)

        return StreamedResponse(
            content="".join(self.chunks),
            chunks=self.chunks,
            total_chunks=len(self.chunks),
            finish_reason=self.finish_reason
        )

    def stream_with_callback(
        self,
        messages: list,
        deployment: str,
        on_token: callable,
        on_complete: Optional[callable] = None
    ) -> str:
        """Stream with callbacks for each token."""
        full_response = []

        response = openai.ChatCompletion.create(
            engine=deployment,
            messages=messages,
            stream=True
        )

        for chunk in response:
            delta = chunk.choices[0].delta

            if hasattr(delta, 'content') and delta.content:
                token = delta.content
                full_response.append(token)
                on_token(token)

            if chunk.choices[0].finish_reason:
                self.finish_reason = chunk.choices[0].finish_reason

        complete_text = "".join(full_response)

        if on_complete:
            on_complete(complete_text)

        return complete_text

# Usage with callbacks
collector = StreamCollector()

def print_token(token: str):
    print(token, end="", flush=True)

def on_complete(text: str):
    print(f"\n\nComplete! Total length: {len(text)}")

result = collector.stream_with_callback(
    messages=[{"role": "user", "content": "Explain APIs"}],
    deployment="gpt-35-turbo",
    on_token=print_token,
    on_complete=on_complete
)
```

## Flask Server-Sent Events (SSE)

```python
from flask import Flask, Response, request, stream_with_context
import json

app = Flask(__name__)

@app.route('/chat/stream', methods=['POST'])
def stream_chat_endpoint():
    """Stream chat responses via SSE."""
    data = request.json
    messages = data.get('messages', [])

    def generate():
        try:
            response = openai.ChatCompletion.create(
                engine="gpt-35-turbo",
                messages=messages,
                stream=True
            )

            for chunk in response:
                delta = chunk.choices[0].delta
                if hasattr(delta, 'content') and delta.content:
                    # SSE format
                    yield f"data: {json.dumps({'content': delta.content})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )

# Client-side JavaScript
"""
const eventSource = new EventSource('/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [...] })
});

// Or using fetch with ReadableStream
async function streamChat(messages) {
    const response = await fetch('/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
            const data = line.slice(6);
            if (data === '[DONE]') return;

            const parsed = JSON.parse(data);
            if (parsed.content) {
                document.getElementById('output').textContent += parsed.content;
            }
        }
    }
}
"""
```

## FastAPI Streaming

```python
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
import asyncio

app = FastAPI()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    max_tokens: int = 500

@app.post("/chat/stream")
async def stream_chat(request: ChatRequest):
    """Stream chat responses."""

    async def generate():
        response = openai.ChatCompletion.create(
            engine="gpt-35-turbo",
            messages=[m.dict() for m in request.messages],
            max_tokens=request.max_tokens,
            stream=True
        )

        for chunk in response:
            delta = chunk.choices[0].delta
            if hasattr(delta, 'content') and delta.content:
                yield f"data: {json.dumps({'content': delta.content})}\n\n"
                await asyncio.sleep(0)  # Allow other tasks to run

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )

# Async version with httpx
import httpx

async def async_stream_chat(messages: list) -> AsyncGenerator[str, None]:
    """Async streaming with httpx."""
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{ENDPOINT}/openai/deployments/gpt35/chat/completions",
            headers={"api-key": API_KEY, "Content-Type": "application/json"},
            params={"api-version": "2023-03-15-preview"},
            json={"messages": messages, "stream": True}
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    content = chunk["choices"][0].get("delta", {}).get("content")
                    if content:
                        yield content
```

## .NET Streaming

```csharp
using Azure.AI.OpenAI;

public class StreamingChatService
{
    private readonly OpenAIClient _client;
    private readonly string _deployment;

    public StreamingChatService(OpenAIClient client, string deployment)
    {
        _client = client;
        _deployment = deployment;
    }

    public async IAsyncEnumerable<string> StreamChatAsync(
        IEnumerable<ChatMessage> messages,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var options = new ChatCompletionsOptions();
        foreach (var message in messages)
        {
            options.Messages.Add(message);
        }

        await foreach (var streaming in
            _client.GetChatCompletionsStreamingAsync(_deployment, options, cancellationToken))
        {
            await foreach (var choice in streaming.GetChoicesStreaming(cancellationToken))
            {
                await foreach (var message in choice.GetMessageStreaming(cancellationToken))
                {
                    if (!string.IsNullOrEmpty(message.Content))
                    {
                        yield return message.Content;
                    }
                }
            }
        }
    }
}

// ASP.NET Core Controller
[ApiController]
[Route("api/[controller]")]
public class ChatController : ControllerBase
{
    private readonly StreamingChatService _chatService;

    [HttpPost("stream")]
    public async Task StreamChat([FromBody] ChatRequest request)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.Add("Cache-Control", "no-cache");

        var messages = new[]
        {
            new ChatMessage(ChatRole.System, request.SystemPrompt ?? "You are helpful."),
            new ChatMessage(ChatRole.User, request.Message)
        };

        await foreach (var token in _chatService.StreamChatAsync(messages))
        {
            await Response.WriteAsync($"data: {JsonSerializer.Serialize(new { content = token })}\n\n");
            await Response.Body.FlushAsync();
        }

        await Response.WriteAsync("data: [DONE]\n\n");
    }
}
```

## React Frontend

```typescript
import React, { useState, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ChatComponent: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const streamMessage = useCallback(async (userMessage: string) => {
    setIsStreaming(true);

    // Add user message
    const newMessages = [...messages, { role: 'user' as const, content: userMessage }];
    setMessages(newMessages);

    // Add empty assistant message that we'll stream into
    setMessages([...newMessages, { role: 'assistant' as const, content: '' }]);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              setMessages(prev => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: updated[lastIdx].content + parsed.content
                };
                return updated;
              });
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
    } finally {
      setIsStreaming(false);
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      streamMessage(input.trim());
      setInput('');
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <strong>{msg.role}:</strong>
            <p>{msg.content}{isStreaming && idx === messages.length - 1 && '|'}</p>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={isStreaming}
          placeholder="Type a message..."
        />
        <button type="submit" disabled={isStreaming}>
          {isStreaming ? 'Streaming...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

export default ChatComponent;
```

## Best Practices

1. **Handle connection drops**: Implement reconnection logic
2. **Show typing indicator**: Display cursor or animation while streaming
3. **Buffer for display**: Small buffer can smooth output
4. **Track completion**: Know when stream is done
5. **Error handling**: Gracefully handle mid-stream errors
6. **Cancel support**: Allow users to stop generation

## Resources

- [OpenAI Streaming Guide](https://platform.openai.com/docs/api-reference/streaming)
- [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [Azure OpenAI Python SDK](https://github.com/openai/openai-python)
