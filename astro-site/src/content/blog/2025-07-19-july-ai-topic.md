---
title: "Streaming LLM Responses: Patterns for Real-Time User Experience"
description: "Add a blinking cursor effect while streaming to indicate ongoing generation. Users perceive streaming responses as 3-5x faster than equivalent non-streaming…"
author: Michael John Peña
draft: false
date: 2025-07-19
tags:
  - Streaming
  - LLM
  - User Experience
  - TypeScript
  - React
---

## Server-Side Streaming with Node.js

Configure your API to stream tokens as they arrive:

```typescript
import { OpenAI } from 'openai';
import { Request, Response } from 'express';

const openai = new OpenAI();

export async function streamCompletion(req: Request, res: Response) {
  const { messages, model = 'gpt-4o' } = req.body;

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model,
      messages,
      stream: true,
      max_tokens: 2000,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }

      if (chunk.choices[0]?.finish_reason === 'stop') {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
    }
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    res.end();
  }
}
```

## React Client Implementation

Build a responsive UI that displays streaming content:

```typescript
import { useState, useCallback } from 'react';

interface StreamState {
  content: string;
  isStreaming: boolean;
  error: string | null;
}

export function useStreamingChat() {
  const [state, setState] = useState<StreamState>({
    content: '',
    isStreaming: false,
    error: null,
  });

  const sendMessage = useCallback(async (messages: Message[]) => {
    setState({ content: '', isStreaming: true, error: null });

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const data = JSON.parse(line.slice(6));
          if (data.content) {
            setState(prev => ({
              ...prev,
              content: prev.content + data.content,
            }));
          }
          if (data.done) {
            setState(prev => ({ ...prev, isStreaming: false }));
          }
        }
      }
    } catch (error) {
      setState(prev => ({ ...prev, isStreaming: false, error: error.message }));
    }
  }, []);

  return { ...state, sendMessage };
}
```

## Visual Feedback

Add a blinking cursor effect while streaming to indicate ongoing generation. Users perceive streaming responses as 3-5x faster than equivalent non-streaming responses.
