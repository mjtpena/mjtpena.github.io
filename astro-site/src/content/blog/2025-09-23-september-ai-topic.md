---
title: "AI Agent Memory: Implementing Long-Term Context"
description: "Long-term memory transforms one-shot interactions into ongoing relationships. Users feel understood when the AI remembers their preferences, past issues…"
author: Michael John Peña
draft: false
date: 2025-09-23
tags:
  - AI Agents
  - Memory
  - Vector Database
  - Context Management
  - LLM
---

## Memory Architecture

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Optional
from enum import Enum
import hashlib

class MemoryType(Enum):
    CONVERSATION = "conversation"
    FACT = "fact"
    PREFERENCE = "preference"
    TASK = "task"

@dataclass
class Memory:
    id: str
    memory_type: MemoryType
    content: str
    embedding: List[float]
    metadata: Dict
    importance: float  # 0-1 score for relevance
    created_at: datetime
    last_accessed: datetime
    access_count: int = 0

class AgentMemory:
    def __init__(self, embedding_client, vector_store):
        self.embedding_client = embedding_client
        self.vector_store = vector_store
        self.working_memory: List[Memory] = []  # Current session
        self.memory_limit = 10  # Max items in working memory

    def _create_embedding(self, text: str) -> List[float]:
        """Generate embedding for memory content."""
        response = self.embedding_client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding

    def store(self, content: str, memory_type: MemoryType,
              metadata: Dict = None, importance: float = 0.5) -> str:
        """Store a new memory."""

        memory_id = hashlib.md5(f"{content}{datetime.now()}".encode()).hexdigest()[:12]
        embedding = self._create_embedding(content)

        memory = Memory(
            id=memory_id,
            memory_type=memory_type,
            content=content,
            embedding=embedding,
            metadata=metadata or {},
            importance=importance,
            created_at=datetime.now(),
            last_accessed=datetime.now()
        )

        # Store in vector database
        self.vector_store.upsert(
            id=memory_id,
            vector=embedding,
            metadata={
                "content": content,
                "type": memory_type.value,
                "importance": importance,
                **memory.metadata
            }
        )

        # Add to working memory
        self._add_to_working_memory(memory)

        return memory_id

    def recall(self, query: str, limit: int = 5,
               memory_types: List[MemoryType] = None) -> List[Memory]:
        """Recall relevant memories for a query."""

        query_embedding = self._create_embedding(query)

        # Build filter
        filter_dict = {}
        if memory_types:
            filter_dict["type"] = {"$in": [t.value for t in memory_types]}

        # Search vector store
        results = self.vector_store.query(
            vector=query_embedding,
            top_k=limit,
            filter=filter_dict
        )

        memories = []
        for result in results:
            memory = Memory(
                id=result.id,
                memory_type=MemoryType(result.metadata["type"]),
                content=result.metadata["content"],
                embedding=result.vector,
                metadata=result.metadata,
                importance=result.metadata.get("importance", 0.5),
                created_at=datetime.fromisoformat(result.metadata.get("created_at", datetime.now().isoformat())),
                last_accessed=datetime.now()
            )
            memories.append(memory)

        return memories

    def _add_to_working_memory(self, memory: Memory):
        """Manage working memory with importance-based eviction."""
        self.working_memory.append(memory)

        if len(self.working_memory) > self.memory_limit:
            # Evict least important memory
            self.working_memory.sort(key=lambda m: m.importance, reverse=True)
            self.working_memory = self.working_memory[:self.memory_limit]

    def get_context_for_prompt(self, query: str) -> str:
        """Build context string from relevant memories for LLM prompt."""
        memories = self.recall(query, limit=5)

        context_parts = ["Relevant context from previous interactions:"]
        for mem in memories:
            context_parts.append(f"- [{mem.memory_type.value}] {mem.content}")

        return "\n".join(context_parts)
```

Long-term memory transforms one-shot interactions into ongoing relationships. Users feel understood when the AI remembers their preferences, past issues, and communication style.
