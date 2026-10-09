---
title: "Building Production AI Assistants: Architecture and Design Patterns"
description: "Over the past year I've been part of several assistant projects that failed at scale not because the model was lacking, but because architecture and…"
author: Michael John Peña
draft: false
date: 2024-01-04
tags:
  - AI Assistants
  - Architecture
  - Azure OpenAI
  - System Design
  - Enterprise AI
---

Over the past year I've been part of several assistant projects that failed at scale not because the model was lacking, but because architecture and orchestration were weak. This post distills the architecture decisions and design patterns that actually matter when you need reliability.

## Architecture Overview

A production AI assistant system has several key components:

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                           │
│  (Web App, Mobile App, Teams Bot, Slack Bot, API)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway Layer                        │
│  (Authentication, Rate Limiting, Request Validation)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Orchestration Layer                        │
│  (Conversation Manager, Context Assembly, Tool Routing)     │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   LLM Layer     │ │  Knowledge Base │ │  Tool Layer     │
│  (GPT-4, etc.)  │ │  (RAG, Search)  │ │  (APIs, DBs)    │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Core Components

### Conversation Manager

```python
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
import json

@dataclass
class Message:
    role: str  # user, assistant, system, tool
    content: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    metadata: dict = field(default_factory=dict)

@dataclass
class Conversation:
    id: str
    user_id: str
    messages: list[Message] = field(default_factory=list)
    context: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

class ConversationManager:
    def __init__(self, storage, max_history: int = 50):
        self.storage = storage
        self.max_history = max_history

    async def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        """Retrieve a conversation from storage."""
        data = await self.storage.get(f"conv:{conversation_id}")
        if data:
            return Conversation(**json.loads(data))
        return None

    async def create_conversation(self, user_id: str, system_prompt: str) -> Conversation:
        """Create a new conversation with system prompt."""
        import uuid

        conv = Conversation(
            id=str(uuid.uuid4()),
            user_id=user_id,
            messages=[Message(role="system", content=system_prompt)]
        )

        await self._save(conv)
        return conv

    async def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        metadata: dict = None
    ) -> Conversation:
        """Add a message to the conversation."""
        conv = await self.get_conversation(conversation_id)
        if not conv:
            raise ValueError(f"Conversation not found: {conversation_id}")

        message = Message(
            role=role,
            content=content,
            metadata=metadata or {}
        )

        conv.messages.append(message)
        conv.updated_at = datetime.utcnow()

        # Trim history if needed (keep system message)
        if len(conv.messages) > self.max_history:
            conv.messages = [conv.messages[0]] + conv.messages[-(self.max_history-1):]

        await self._save(conv)
        return conv

    async def _save(self, conv: Conversation):
        """Save conversation to storage."""
        await self.storage.set(
            f"conv:{conv.id}",
            json.dumps(conv.__dict__, default=str),
            ex=86400 * 7  # 7 day expiry
        )

    def to_api_messages(self, conv: Conversation) -> list[dict]:
        """Convert conversation to API format."""
        return [
            {"role": m.role, "content": m.content}
            for m in conv.messages
        ]
```

### Context Assembly

Building the right context is crucial for quality responses:

```python
from abc import ABC, abstractmethod

class ContextProvider(ABC):
    @abstractmethod
    async def get_context(self, query: str, user_id: str) -> str:
        """Retrieve relevant context for the query."""
        pass

class RAGContextProvider(ContextProvider):
    def __init__(self, search_client, embedding_client, top_k: int = 5):
        self.search = search_client
        self.embeddings = embedding_client
        self.top_k = top_k

    async def get_context(self, query: str, user_id: str) -> str:
        """Retrieve relevant documents using RAG."""

        # Get query embedding
        embedding = await self.embeddings.embed(query)

        # Search for relevant documents
        results = await self.search.hybrid_search(
            query=query,
            vector=embedding,
            filter=f"user_id eq '{user_id}' or public eq true",
            top=self.top_k
        )

        if not results:
            return ""

        # Format context
        context_parts = []
        for i, doc in enumerate(results, 1):
            context_parts.append(f"[Source {i}]: {doc['content']}")

        return "\n\n".join(context_parts)

class UserContextProvider(ContextProvider):
    def __init__(self, user_service):
        self.user_service = user_service

    async def get_context(self, query: str, user_id: str) -> str:
        """Get user-specific context."""

        user = await self.user_service.get_user(user_id)

        return f"""User Context:
- Name: {user.name}
- Role: {user.role}
- Department: {user.department}
- Preferences: {json.dumps(user.preferences)}"""

class CompositeContextProvider(ContextProvider):
    def __init__(self, providers: list[ContextProvider]):
        self.providers = providers

    async def get_context(self, query: str, user_id: str) -> str:
        """Combine context from multiple providers."""

        contexts = await asyncio.gather(*[
            p.get_context(query, user_id)
            for p in self.providers
        ])

        return "\n\n---\n\n".join(c for c in contexts if c)
```

### Tool Routing

Enable assistants to take actions:

```python
from typing import Callable, Any
import inspect

class ToolRegistry:
    def __init__(self):
        self.tools: dict[str, Callable] = {}
        self.schemas: dict[str, dict] = {}

    def register(self, name: str = None, description: str = ""):
        """Decorator to register a tool function."""

        def decorator(func: Callable):
            tool_name = name or func.__name__

            # Generate schema from function signature
            sig = inspect.signature(func)
            parameters = {
                "type": "object",
                "properties": {},
                "required": []
            }

            for param_name, param in sig.parameters.items():
                if param_name == "self":
                    continue

                param_type = "string"
                if param.annotation == int:
                    param_type = "integer"
                elif param.annotation == float:
                    param_type = "number"
                elif param.annotation == bool:
                    param_type = "boolean"

                parameters["properties"][param_name] = {
                    "type": param_type,
                    "description": f"Parameter: {param_name}"
                }

                if param.default == inspect.Parameter.empty:
                    parameters["required"].append(param_name)

            self.tools[tool_name] = func
            self.schemas[tool_name] = {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": description or func.__doc__ or "",
                    "parameters": parameters
                }
            }

            return func

        return decorator

    def get_tool_definitions(self) -> list[dict]:
        """Get OpenAI-format tool definitions."""
        return list(self.schemas.values())

    async def execute(self, name: str, arguments: dict) -> Any:
        """Execute a registered tool."""
        if name not in self.tools:
            raise ValueError(f"Unknown tool: {name}")

        func = self.tools[name]

        if asyncio.iscoroutinefunction(func):
            return await func(**arguments)
        return func(**arguments)

# Usage
tools = ToolRegistry()

@tools.register(description="Search the knowledge base for relevant information")
async def search_knowledge(query: str, max_results: int = 5) -> dict:
    """Search knowledge base."""
    results = await knowledge_base.search(query, limit=max_results)
    return {"results": results}

@tools.register(description="Create a support ticket")
async def create_ticket(title: str, description: str, priority: str = "medium") -> dict:
    """Create support ticket."""
    ticket = await ticket_service.create(
        title=title,
        description=description,
        priority=priority
    )
    return {"ticket_id": ticket.id, "status": "created"}

@tools.register(description="Get current user's information")
async def get_user_info() -> dict:
    """Get user info from context."""
    # User ID would come from request context
    return {"name": "John", "role": "Developer"}
```

### Orchestration Layer

Tie everything together:

```python
class AssistantOrchestrator:
    def __init__(
        self,
        llm_client,
        conversation_manager: ConversationManager,
        context_provider: ContextProvider,
        tool_registry: ToolRegistry,
        system_prompt: str
    ):
        self.llm = llm_client
        self.conversations = conversation_manager
        self.context = context_provider
        self.tools = tool_registry
        self.system_prompt = system_prompt

    async def process_message(
        self,
        user_id: str,
        conversation_id: Optional[str],
        message: str
    ) -> tuple[str, str]:
        """Process a user message and return response."""

        # Get or create conversation
        if conversation_id:
            conv = await self.conversations.get_conversation(conversation_id)
        else:
            conv = await self.conversations.create_conversation(
                user_id=user_id,
                system_prompt=self.system_prompt
            )

        # Add user message
        await self.conversations.add_message(conv.id, "user", message)

        # Get relevant context
        context = await self.context.get_context(message, user_id)

        # Build messages for API
        messages = self.conversations.to_api_messages(conv)

        # Inject context into last user message
        if context:
            messages[-1]["content"] = f"""Context:
{context}

User Query: {message}"""

        # Call LLM with tools
        response = await self._call_with_tools(messages)

        # Save assistant response
        await self.conversations.add_message(conv.id, "assistant", response)

        return response, conv.id

    async def _call_with_tools(self, messages: list[dict], max_iterations: int = 5) -> str:
        """Call LLM and handle any tool calls."""

        for _ in range(max_iterations):
            response = await self.llm.chat.completions.create(
                model="gpt-4-turbo",
                messages=messages,
                tools=self.tools.get_tool_definitions(),
                tool_choice="auto"
            )

            message = response.choices[0].message

            if not message.tool_calls:
                return message.content

            # Execute tool calls
            messages.append({
                "role": "assistant",
                "content": message.content,
                "tool_calls": [tc.model_dump() for tc in message.tool_calls]
            })

            for tool_call in message.tool_calls:
                result = await self.tools.execute(
                    tool_call.function.name,
                    json.loads(tool_call.function.arguments)
                )

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })

        return "I apologize, but I wasn't able to complete the request."
```

## API Layer

```python
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel

app = FastAPI()

class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    conversation_id: str

@app.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    user_id: str = Depends(get_current_user),
    orchestrator: AssistantOrchestrator = Depends(get_orchestrator)
):
    """Process a chat message."""

    try:
        response, conversation_id = await orchestrator.process_message(
            user_id=user_id,
            conversation_id=request.conversation_id,
            message=request.message
        )

        return ChatResponse(
            response=response,
            conversation_id=conversation_id
        )

    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail="Failed to process message")
```

## Key Design Principles

1. **Separation of concerns** - Each component has a single responsibility
2. **Async-first** - All I/O operations are async for scalability
3. **Stateless orchestration** - State lives in storage, not memory
4. **Tool abstraction** - Easy to add new capabilities
5. **Context composition** - Multiple sources of context combine cleanly

## Conclusion

Production AI assistants require thoughtful architecture beyond simple API wrappers. Focus on conversation management, context assembly, and clean tool abstractions. These patterns scale from simple chatbots to complex enterprise assistants.
