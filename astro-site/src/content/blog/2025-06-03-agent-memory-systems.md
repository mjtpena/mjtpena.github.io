---
title: "Agent Memory Systems: Building Persistent AI Memory"
author: Michael John Peña
draft: false
date: 2025-06-03
tags:
  - AI
  - Agents
  - Memory
  - Persistence
  - Architecture

---

I wrote "Agent Memory Systems: Building Persistent AI Memory" to share practical, production-minded guidance on this topic.

## Agent Memory Implementation

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from datetime import datetime
import numpy as np

@dataclass
class MemoryEntry:
    content: str
    embedding: List[float]
    timestamp: datetime
    importance: float
    access_count: int = 0
    last_accessed: datetime = None
    metadata: Dict = None

class AgentMemory:
    def __init__(self, embedding_model, vector_store):
        self.embedding_model = embedding_model
        self.vector_store = vector_store
        self.working_memory: List[MemoryEntry] = []
        self.working_memory_limit = 10

    async def store(self, content: str, importance: float = 0.5, metadata: Dict = None):
        """Store new memory."""
        embedding = await self.embedding_model.embed(content)

        entry = MemoryEntry(
            content=content,
            embedding=embedding,
            timestamp=datetime.now(),
            importance=importance,
            metadata=metadata or {}
        )

        # Store in long-term memory
        await self.vector_store.upsert(entry)

        # Update working memory
        self.update_working_memory(entry)

    async def recall(self, query: str, top_k: int = 5) -> List[MemoryEntry]:
        """Recall relevant memories."""
        query_embedding = await self.embedding_model.embed(query)

        # Search long-term memory
        results = await self.vector_store.search(
            query_embedding,
            top_k=top_k * 2  # Get more for recency filtering
        )

        # Apply recency weighting
        scored_results = []
        for entry in results:
            recency_score = self.calculate_recency_score(entry.timestamp)
            combined_score = (
                entry.similarity * 0.6 +
                entry.importance * 0.2 +
                recency_score * 0.2
            )
            scored_results.append((entry, combined_score))

        # Sort and return top k
        scored_results.sort(key=lambda x: x[1], reverse=True)
        memories = [entry for entry, _ in scored_results[:top_k]]

        # Update access patterns
        for memory in memories:
            await self.update_access(memory)

        return memories

    def update_working_memory(self, entry: MemoryEntry):
        """Update working memory with new entry."""
        self.working_memory.append(entry)

        # Maintain limit
        if len(self.working_memory) > self.working_memory_limit:
            # Remove least important/oldest
            self.working_memory.sort(
                key=lambda x: x.importance * self.calculate_recency_score(x.timestamp),
                reverse=True
            )
            self.working_memory = self.working_memory[:self.working_memory_limit]

    async def consolidate(self):
        """Consolidate and summarize memories."""
        # Get related memories
        clusters = await self.cluster_memories()

        for cluster in clusters:
            if len(cluster) >= 3:
                # Summarize cluster
                summary = await self.summarize_cluster(cluster)

                # Store summary as new memory with high importance
                await self.store(
                    summary,
                    importance=0.8,
                    metadata={"type": "consolidated", "source_count": len(cluster)}
                )

    def calculate_recency_score(self, timestamp: datetime) -> float:
        """Calculate recency score (exponential decay)."""
        age_hours = (datetime.now() - timestamp).total_seconds() / 3600
        return np.exp(-age_hours / 168)  # 1-week half-life
```

Sophisticated memory systems enable agents to learn and improve over time.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
