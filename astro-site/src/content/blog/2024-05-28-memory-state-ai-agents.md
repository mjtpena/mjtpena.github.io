---
title: "Memory and State Management in AI Agents"
author: Michael John Peña
draft: false
date: 2024-05-28
tags:
  - AI Agents
  - Memory
  - State Management
  - RAG
  - Azure
---

AI agents need memory to maintain context across interactions. Today I'm exploring how to implement effective memory systems.

## Types of Agent Memory

```
Memory Types:
├── Working Memory (current conversation)
├── Short-term Memory (recent interactions)
├── Long-term Memory (persistent knowledge)
├── Episodic Memory (specific events)
└── Semantic Memory (facts and concepts)
```

## Working Memory: Conversation Context

```python
from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime

@dataclass
class Message:
    role: str
    content: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    metadata: dict = field(default_factory=dict)

class WorkingMemory:
    """Manages current conversation context."""

    def __init__(self, max_tokens: int = 8000):
        self.messages: List[Message] = []
        self.max_tokens = max_tokens
        self.system_prompt: Optional[str] = None

    def set_system_prompt(self, prompt: str):
        self.system_prompt = prompt

    def add_message(self, role: str, content: str, metadata: dict = None):
        self.messages.append(Message(
            role=role,
            content=content,
            metadata=metadata or {}
        ))
        self._trim_if_needed()

    def get_messages_for_api(self) -> list:
        messages = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})

        for msg in self.messages:
            messages.append({"role": msg.role, "content": msg.content})

        return messages

    def _trim_if_needed(self):
        """Remove oldest messages if over token limit."""
        while self._estimate_tokens() > self.max_tokens and len(self.messages) > 2:
            self.messages.pop(0)

    def _estimate_tokens(self) -> int:
        total = len(self.system_prompt) // 4 if self.system_prompt else 0
        for msg in self.messages:
            total += len(msg.content) // 4
        return total

    def clear(self):
        self.messages = []
```

## Short-term Memory: Recent Context

```python
from collections import deque
import json

class ShortTermMemory:
    """Recent interactions and context."""

    def __init__(self, capacity: int = 100):
        self.interactions = deque(maxlen=capacity)
        self.context_variables = {}

    def record_interaction(
        self,
        user_input: str,
        agent_response: str,
        tools_used: list = None,
        metadata: dict = None
    ):
        self.interactions.append({
            "timestamp": datetime.utcnow().isoformat(),
            "user_input": user_input,
            "agent_response": agent_response,
            "tools_used": tools_used or [],
            "metadata": metadata or {}
        })

    def set_context(self, key: str, value: any):
        self.context_variables[key] = value

    def get_context(self, key: str) -> any:
        return self.context_variables.get(key)

    def get_recent_interactions(self, count: int = 5) -> list:
        return list(self.interactions)[-count:]

    def search_interactions(self, query: str) -> list:
        """Simple keyword search in recent interactions."""
        results = []
        query_lower = query.lower()
        for interaction in self.interactions:
            if (query_lower in interaction["user_input"].lower() or
                query_lower in interaction["agent_response"].lower()):
                results.append(interaction)
        return results

    def summarize_recent(self, client, count: int = 10) -> str:
        """Generate summary of recent interactions."""
        recent = self.get_recent_interactions(count)
        if not recent:
            return "No recent interactions."

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "Summarize these recent interactions in 2-3 sentences."
                },
                {
                    "role": "user",
                    "content": json.dumps(recent)
                }
            ]
        )
        return response.choices[0].message.content
```

## Long-term Memory: Vector Store

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SimpleField, SearchableField,
    VectorSearch, HnswAlgorithmConfiguration,
    VectorSearchProfile, SearchField
)
from azure.core.credentials import AzureKeyCredential
import numpy as np

class LongTermMemory:
    """Persistent semantic memory using vector search."""

    def __init__(
        self,
        endpoint: str,
        key: str,
        index_name: str,
        embedding_client
    ):
        self.search_client = SearchClient(
            endpoint=endpoint,
            index_name=index_name,
            credential=AzureKeyCredential(key)
        )
        self.index_client = SearchIndexClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )
        self.embedding_client = embedding_client
        self.index_name = index_name

        self._ensure_index_exists()

    def _ensure_index_exists(self):
        """Create index if it doesn't exist."""
        try:
            self.index_client.get_index(self.index_name)
        except:
            index = SearchIndex(
                name=self.index_name,
                fields=[
                    SimpleField(name="id", type="Edm.String", key=True),
                    SearchableField(name="content", type="Edm.String"),
                    SimpleField(name="category", type="Edm.String", filterable=True),
                    SimpleField(name="timestamp", type="Edm.DateTimeOffset"),
                    SimpleField(name="user_id", type="Edm.String", filterable=True),
                    SearchField(
                        name="embedding",
                        type="Collection(Edm.Single)",
                        vector_search_dimensions=1536,
                        vector_search_profile_name="default"
                    )
                ],
                vector_search=VectorSearch(
                    algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
                    profiles=[VectorSearchProfile(
                        name="default",
                        algorithm_configuration_name="hnsw"
                    )]
                )
            )
            self.index_client.create_index(index)

    async def store(
        self,
        content: str,
        category: str,
        user_id: str,
        metadata: dict = None
    ):
        """Store a memory with embedding."""
        embedding = await self._get_embedding(content)

        document = {
            "id": f"{user_id}_{datetime.utcnow().timestamp()}",
            "content": content,
            "category": category,
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "embedding": embedding,
            **(metadata or {})
        }

        self.search_client.upload_documents([document])

    async def recall(
        self,
        query: str,
        user_id: str = None,
        category: str = None,
        top_k: int = 5
    ) -> list:
        """Retrieve relevant memories."""
        query_embedding = await self._get_embedding(query)

        filter_str = None
        filters = []
        if user_id:
            filters.append(f"user_id eq '{user_id}'")
        if category:
            filters.append(f"category eq '{category}'")
        if filters:
            filter_str = " and ".join(filters)

        results = self.search_client.search(
            search_text=None,
            vector_queries=[{
                "vector": query_embedding,
                "k": top_k,
                "fields": "embedding"
            }],
            filter=filter_str,
            select=["id", "content", "category", "timestamp"]
        )

        return [
            {
                "content": r["content"],
                "category": r["category"],
                "timestamp": r["timestamp"],
                "score": r["@search.score"]
            }
            for r in results
        ]

    async def _get_embedding(self, text: str) -> list:
        response = self.embedding_client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding
```

## Episodic Memory: Specific Events

```python
@dataclass
class Episode:
    id: str
    summary: str
    timestamp: datetime
    participants: list
    actions: list
    outcome: str
    emotional_context: Optional[str] = None
    importance: float = 0.5

class EpisodicMemory:
    """Memory of specific events and experiences."""

    def __init__(self, storage, embedding_client):
        self.storage = storage
        self.embedding_client = embedding_client

    async def record_episode(
        self,
        conversation: list,
        user_id: str,
        client
    ) -> Episode:
        """Record a conversation as an episode."""
        # Generate episode summary
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": """Summarize this conversation as an episode.
Return JSON:
{
    "summary": "Brief description",
    "actions": ["action1", "action2"],
    "outcome": "What was achieved",
    "importance": 0.0-1.0
}"""
                },
                {
                    "role": "user",
                    "content": json.dumps(conversation)
                }
            ],
            response_format={"type": "json_object"}
        )

        episode_data = json.loads(response.choices[0].message.content)

        episode = Episode(
            id=f"ep_{datetime.utcnow().timestamp()}",
            summary=episode_data["summary"],
            timestamp=datetime.utcnow(),
            participants=[user_id],
            actions=episode_data["actions"],
            outcome=episode_data["outcome"],
            importance=episode_data["importance"]
        )

        # Store episode
        await self.storage.store(
            content=episode.summary,
            category="episode",
            user_id=user_id,
            metadata={
                "actions": json.dumps(episode.actions),
                "outcome": episode.outcome,
                "importance": episode.importance
            }
        )

        return episode

    async def recall_similar_episodes(
        self,
        situation: str,
        user_id: str,
        top_k: int = 3
    ) -> list:
        """Find similar past episodes."""
        return await self.storage.recall(
            query=situation,
            user_id=user_id,
            category="episode",
            top_k=top_k
        )
```

## Memory-Enabled Agent

```python
class MemoryEnabledAgent:
    """Agent with comprehensive memory capabilities."""

    def __init__(
        self,
        client,
        working_memory: WorkingMemory,
        short_term: ShortTermMemory,
        long_term: LongTermMemory,
        episodic: EpisodicMemory
    ):
        self.client = client
        self.working = working_memory
        self.short_term = short_term
        self.long_term = long_term
        self.episodic = episodic

    async def process_message(self, user_id: str, message: str) -> str:
        # Retrieve relevant long-term memories
        relevant_memories = await self.long_term.recall(
            query=message,
            user_id=user_id,
            top_k=3
        )

        # Retrieve similar episodes
        similar_episodes = await self.episodic.recall_similar_episodes(
            situation=message,
            user_id=user_id,
            top_k=2
        )

        # Get recent context
        recent_summary = self.short_term.summarize_recent(self.client, 5)

        # Build enhanced system prompt
        memory_context = self._build_memory_context(
            relevant_memories,
            similar_episodes,
            recent_summary
        )

        self.working.set_system_prompt(f"""You are a helpful assistant with memory.

Relevant knowledge from past interactions:
{memory_context}

Use this context to provide personalized, informed responses.""")

        # Add user message
        self.working.add_message("user", message)

        # Generate response
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=self.working.get_messages_for_api()
        )

        assistant_response = response.choices[0].message.content
        self.working.add_message("assistant", assistant_response)

        # Record interaction
        self.short_term.record_interaction(
            user_input=message,
            agent_response=assistant_response
        )

        # Store important information in long-term memory
        await self._maybe_store_memory(user_id, message, assistant_response)

        return assistant_response

    def _build_memory_context(
        self,
        memories: list,
        episodes: list,
        recent_summary: str
    ) -> str:
        parts = []

        if memories:
            parts.append("Relevant memories:")
            for m in memories:
                parts.append(f"- {m['content']}")

        if episodes:
            parts.append("\nSimilar past situations:")
            for e in episodes:
                parts.append(f"- {e['content']} (Outcome: {e.get('outcome', 'unknown')})")

        if recent_summary:
            parts.append(f"\nRecent context: {recent_summary}")

        return "\n".join(parts)

    async def _maybe_store_memory(
        self,
        user_id: str,
        user_input: str,
        response: str
    ):
        """Store important information in long-term memory."""
        # Determine if this interaction contains important information
        check_response = self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": """Determine if this interaction contains important information worth remembering.
Return JSON: {"should_remember": true/false, "summary": "...", "category": "fact/preference/task/other"}"""
                },
                {
                    "role": "user",
                    "content": f"User: {user_input}\nAssistant: {response}"
                }
            ],
            response_format={"type": "json_object"}
        )

        result = json.loads(check_response.choices[0].message.content)

        if result["should_remember"]:
            await self.long_term.store(
                content=result["summary"],
                category=result["category"],
                user_id=user_id
            )
```

## Memory Persistence with Redis

```python
import redis
import json

class RedisMemoryStore:
    """Persist memory state in Redis."""

    def __init__(self, redis_url: str):
        self.redis = redis.from_url(redis_url)

    def save_working_memory(self, session_id: str, memory: WorkingMemory):
        data = {
            "system_prompt": memory.system_prompt,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat()
                }
                for m in memory.messages
            ]
        }
        self.redis.setex(
            f"memory:working:{session_id}",
            3600 * 24,  # 24 hour expiry
            json.dumps(data)
        )

    def load_working_memory(self, session_id: str) -> WorkingMemory:
        data = self.redis.get(f"memory:working:{session_id}")
        if not data:
            return WorkingMemory()

        parsed = json.loads(data)
        memory = WorkingMemory()
        memory.system_prompt = parsed.get("system_prompt")

        for msg in parsed.get("messages", []):
            memory.messages.append(Message(
                role=msg["role"],
                content=msg["content"],
                timestamp=datetime.fromisoformat(msg["timestamp"])
            ))

        return memory
```

## Best Practices

1. **Separate memory types** - Different purposes, different storage
2. **Limit context** - Don't overwhelm with too much memory
3. **Relevance filtering** - Only include relevant memories
4. **Regular cleanup** - Expire old, unimportant memories
5. **User control** - Let users manage their memory

## What's Next

Tomorrow I'll cover multi-agent architectures.

## Resources

- [Azure AI Search](https://learn.microsoft.com/azure/search/)
- [Redis Documentation](https://redis.io/docs/)
- [Memory in AI Agents](https://www.pinecone.io/learn/memory-in-ai/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
