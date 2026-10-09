---
title: "Building TypeScript AI Applications with Vercel AI SDK"
description: "The SDK supports function calling with automatic TypeScript type inference, making it easy to extend your AI with custom capabilities."
author: Michael John Peña
draft: false
date: 2025-08-21
tags:
  - TypeScript
  - Vercel AI SDK
  - React
  - Streaming
  - Web Development
---

## Setting Up with Azure OpenAI

```typescript
// app/api/chat/route.ts
import { createAzure } from '@ai-sdk/azure';
import { streamText } from 'ai';

const azure = createAzure({
  resourceName: process.env.AZURE_OPENAI_RESOURCE!,
  apiKey: process.env.AZURE_OPENAI_KEY!,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: azure('gpt-4o'),
    messages,
    system: 'You are a helpful assistant.',
  });

  return result.toDataStreamResponse();
}
```

## React Integration with useChat

```typescript
// components/Chat.tsx
'use client';

import { useChat } from 'ai/react';

export function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`p-4 rounded-lg ${
              message.role === 'user' ? 'bg-blue-100 ml-auto' : 'bg-gray-100'
            }`}
          >
            <p className="text-sm font-semibold">
              {message.role === 'user' ? 'You' : 'Assistant'}
            </p>
            <p>{message.content}</p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 pt-4">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask something..."
          className="flex-1 p-2 border rounded"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {isLoading ? 'Thinking...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
```

## Tool Calling

The SDK supports function calling with automatic TypeScript type inference, making it easy to extend your AI with custom capabilities.

The Vercel AI SDK abstracts away streaming complexity, letting you focus on building great user experiences.
