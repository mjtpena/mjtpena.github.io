---
title: "ChatGPT Integration Patterns for Enterprise Applications"
description: "Until then, these patterns will help you build production-ready chat experiences."
author: Michael John Peña
draft: false
date: 2023-01-05
tags:
  - Azure
  - OpenAI
  - ChatGPT
  - AI
  - Architecture
---

## The Chat Paradigm Shift

Traditional GPT-3 interactions are stateless - each request is independent. ChatGPT introduced a conversational paradigm with:

- Multi-turn conversations
- System prompts for behavior control
- Context that builds over the conversation

## Simulating Chat with Completion API

While waiting for the official Chat API, we can simulate conversations:

```python
import openai
from typing import List, Dict
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class Message:
    role: str  # "system", "user", or "assistant"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)

class ConversationManager:
    """Manage multi-turn conversations with GPT-3.5."""

    def __init__(self, deployment: str, system_prompt: str = None):
        self.deployment = deployment
        self.system_prompt = system_prompt or "You are a helpful AI assistant."
        self.messages: List[Message] = []
        self.max_context_tokens = 3000

    def _build_prompt(self) -> str:
        """Build the full prompt from conversation history."""
        prompt_parts = [f"System: {self.system_prompt}\n"]

        for msg in self.messages:
            role_label = "Human" if msg.role == "user" else "Assistant"
            prompt_parts.append(f"{role_label}: {msg.content}\n")

        prompt_parts.append("Assistant:")
        return "\n".join(prompt_parts)

    def _truncate_history(self):
        """Truncate old messages to fit within token limit."""
        import tiktoken
        encoding = tiktoken.encoding_for_model("text-davinci-003")

        while True:
            prompt = self._build_prompt()
            tokens = len(encoding.encode(prompt))

            if tokens <= self.max_context_tokens or len(self.messages) <= 2:
                break

            # Remove oldest non-system message
            self.messages.pop(0)

    def send_message(self, user_message: str) -> str:
        """Send a message and get a response."""
        # Add user message
        self.messages.append(Message(role="user", content=user_message))

        # Truncate if needed
        self._truncate_history()

        # Build prompt and get response
        prompt = self._build_prompt()

        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            max_tokens=500,
            temperature=0.7,
            stop=["Human:", "System:"]
        )

        assistant_message = response.choices[0].text.strip()
        self.messages.append(Message(role="assistant", content=assistant_message))

        return assistant_message

    def reset(self):
        """Clear conversation history."""
        self.messages = []

# Usage
conversation = ConversationManager(
    deployment="gpt35",
    system_prompt="You are a helpful Azure solutions architect. Provide detailed technical guidance."
)

# Multi-turn conversation
response1 = conversation.send_message("What's the best way to store time-series data in Azure?")
print(f"Assistant: {response1}\n")

response2 = conversation.send_message("How would I query that for the last 7 days?")
print(f"Assistant: {response2}\n")

response3 = conversation.send_message("What about cost optimization?")
print(f"Assistant: {response3}")
```

## Session Management Pattern

For web applications, manage sessions properly:

```python
from flask import Flask, session, request, jsonify
import redis
import json
import uuid

app = Flask(__name__)
app.secret_key = "your-secret-key"

# Redis for session storage
redis_client = redis.Redis(host='localhost', port=6379, db=0)

class ChatSession:
    """Persistent chat session with Redis backing."""

    SESSION_TTL = 3600  # 1 hour

    @staticmethod
    def get_or_create_session(session_id: str = None) -> str:
        """Get existing session or create new one."""
        if session_id and redis_client.exists(f"chat:{session_id}"):
            return session_id
        return str(uuid.uuid4())

    @staticmethod
    def save_message(session_id: str, role: str, content: str):
        """Save a message to the session."""
        key = f"chat:{session_id}"
        message = json.dumps({"role": role, "content": content})
        redis_client.rpush(key, message)
        redis_client.expire(key, ChatSession.SESSION_TTL)

    @staticmethod
    def get_messages(session_id: str) -> List[Dict]:
        """Get all messages in a session."""
        key = f"chat:{session_id}"
        messages = redis_client.lrange(key, 0, -1)
        return [json.loads(m) for m in messages]

    @staticmethod
    def delete_session(session_id: str):
        """Delete a session."""
        redis_client.delete(f"chat:{session_id}")

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    session_id = data.get('session_id') or ChatSession.get_or_create_session()
    user_message = data.get('message')

    # Save user message
    ChatSession.save_message(session_id, "user", user_message)

    # Get conversation history
    messages = ChatSession.get_messages(session_id)

    # Build prompt and get response
    conversation = ConversationManager(deployment="gpt35")
    for msg in messages[:-1]:  # Exclude last message (we'll send it)
        conversation.messages.append(Message(role=msg['role'], content=msg['content']))

    response = conversation.send_message(user_message)

    # Save assistant response
    ChatSession.save_message(session_id, "assistant", response)

    return jsonify({
        "session_id": session_id,
        "response": response
    })

@app.route('/chat/history/<session_id>', methods=['GET'])
def get_history(session_id):
    messages = ChatSession.get_messages(session_id)
    return jsonify({"messages": messages})
```

## Streaming Responses

For better UX, stream responses as they're generated:

```python
import openai
from typing import Generator

def stream_completion(prompt: str, deployment: str) -> Generator[str, None, None]:
    """Stream completion tokens as they're generated."""
    response = openai.Completion.create(
        engine=deployment,
        prompt=prompt,
        max_tokens=500,
        temperature=0.7,
        stream=True
    )

    for chunk in response:
        if chunk.choices[0].text:
            yield chunk.choices[0].text

# Flask SSE endpoint
from flask import Response

@app.route('/chat/stream', methods=['POST'])
def chat_stream():
    data = request.json
    prompt = data.get('prompt')

    def generate():
        for token in stream_completion(prompt, "gpt35"):
            yield f"data: {json.dumps({'token': token})}\n\n"
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype='text/event-stream')
```

## Frontend Integration

Here's a React component for the chat interface:

```typescript
import React, { useState, useEffect, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ChatComponent: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          message: input
        })
      });

      const data = await response.json();
      setSessionId(data.session_id);

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong>
            <p>{msg.content}</p>
          </div>
        ))}
        {isLoading && <div className="loading">Thinking...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type your message..."
        />
        <button onClick={sendMessage} disabled={isLoading}>
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatComponent;
```

## System Prompts for Different Use Cases

System prompts shape the assistant's behavior:

```python
SYSTEM_PROMPTS = {
    "customer_support": """You are a customer support agent for Contoso Ltd.
- Be helpful, empathetic, and professional
- If you don't know something, say so and offer to escalate
- Never make promises about refunds or compensation without checking
- Keep responses concise but complete""",

    "code_reviewer": """You are a senior software engineer reviewing code.
- Focus on bugs, security issues, and performance problems
- Suggest improvements with code examples
- Be constructive, not critical
- Explain the 'why' behind your suggestions""",

    "data_analyst": """You are a data analyst assistant.
- Help users understand their data and write queries
- Suggest appropriate visualizations
- Explain statistical concepts in simple terms
- Always consider data privacy and security"""
}

def create_specialized_assistant(specialty: str) -> ConversationManager:
    """Create a conversation manager with specialized system prompt."""
    system_prompt = SYSTEM_PROMPTS.get(specialty, SYSTEM_PROMPTS["customer_support"])
    return ConversationManager(deployment="gpt35", system_prompt=system_prompt)
```

## Best Practices

1. **Manage Context Window**: Keep conversation history within token limits
2. **Persist Sessions**: Use Redis or similar for session persistence
3. **Stream Responses**: Improve perceived performance with streaming
4. **Rate Limit**: Implement per-user rate limiting
5. **Log Everything**: Track conversations for improvement and compliance

## What's Coming

Microsoft has announced that the official Chat Completion API (like ChatGPT uses) is coming to Azure OpenAI Service. This will provide:

- Native multi-turn support
- Better context management
- Improved instruction following

Until then, these patterns will help you build production-ready chat experiences.

## Resources

- [Azure OpenAI Service](https://azure.microsoft.com/services/cognitive-services/openai-service/)
- [Prompt Engineering Guide](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/prompt-engineering)
- [Rate Limits and Quotas](https://learn.microsoft.com/azure/cognitive-services/openai/quotas-limits)
