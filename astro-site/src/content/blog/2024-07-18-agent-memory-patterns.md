---
title: "Agent Memory Patterns: Beyond Simple Context"
author: Michael John Peña
draft: false
date: 2024-07-18
tags:
  - AI
  - Agents
  - Memory
  - LangChain
  - Architecture
---

## Memory Types Overview

```
+------------------+     +------------------+     +------------------+
|   Short-Term     |     |    Long-Term     |     |    External      |
|    Memory        |     |     Memory       |     |     Memory       |
+------------------+     +------------------+     +------------------+
| - Current context|     | - User prefs     |     | - Vector DBs     |
| - Recent messages|     | - Past decisions |     | - Knowledge bases|
| - Working state  |     | - Learned facts  |     | - Document stores|
+------------------+     +------------------+     +------------------+
```

## Short-Term Memory Implementation

```python
from typing import TypedDict, Annotated
from operator import add
from collections import deque

class ShortTermMemory:
    def __init__(self, max_messages: int = 20, max_tokens: int = 4000):
        self.messages = deque(maxlen=max_messages)
        self.max_tokens = max_tokens
        self.token_count = 0

    def add(self, message: dict):
        """Add message to short-term memory."""
        msg_tokens = self._estimate_tokens(message["content"])

        # Evict old messages if needed
        while self.token_count + msg_tokens > self.max_tokens and self.messages:
            removed = self.messages.popleft()
            self.token_count -= self._estimate_tokens(removed["content"])

        self.messages.append(message)
        self.token_count += msg_tokens

    def get_context(self) -> list[dict]:
        """Get messages for context window."""
        return list(self.messages)

    def get_recent(self, n: int) -> list[dict]:
        """Get n most recent messages."""
        return list(self.messages)[-n:]

    def _estimate_tokens(self, text: str) -> int:
        """Rough token estimate."""
        return len(text.split()) * 1.3

    def summarize_and_compress(self, llm) -> str:
        """Summarize messages to free up space."""
        if len(self.messages) < 5:
            return ""

        messages_text = "\n".join(
            f"{m['role']}: {m['content']}"
            for m in list(self.messages)[:-3]  # Keep last 3
        )

        prompt = f"Summarize this conversation concisely:\n{messages_text}"
        summary = llm.invoke(prompt).content

        # Replace old messages with summary
        recent = list(self.messages)[-3:]
        self.messages.clear()
        self.messages.append({"role": "system", "content": f"Previous context: {summary}"})
        self.messages.extend(recent)

        self.token_count = sum(
            self._estimate_tokens(m["content"]) for m in self.messages
        )

        return summary
```

## Long-Term Memory with Vector Storage

```python
from langchain_openai import AzureOpenAIEmbeddings
from langchain_community.vectorstores import AzureSearch
from datetime import datetime
import hashlib

class LongTermMemory:
    def __init__(self, search_endpoint: str, search_key: str, index_name: str):
        self.embeddings = AzureOpenAIEmbeddings(
            azure_deployment="text-embedding-3-small"
        )

        self.vector_store = AzureSearch(
            azure_search_endpoint=search_endpoint,
            azure_search_key=search_key,
            index_name=index_name,
            embedding_function=self.embeddings.embed_query
        )

    def store(self, content: str, memory_type: str, metadata: dict = None):
        """Store a memory."""
        doc_id = hashlib.md5(f"{content}{datetime.utcnow()}".encode()).hexdigest()

        full_metadata = {
            "memory_type": memory_type,
            "timestamp": datetime.utcnow().isoformat(),
            "id": doc_id,
            **(metadata or {})
        }

        self.vector_store.add_texts(
            texts=[content],
            metadatas=[full_metadata],
            ids=[doc_id]
        )

        return doc_id

    def recall(self, query: str, memory_type: str = None, k: int = 5) -> list[dict]:
        """Recall relevant memories."""
        filter_expr = f"memory_type eq '{memory_type}'" if memory_type else None

        results = self.vector_store.similarity_search_with_score(
            query=query,
            k=k,
            filters=filter_expr
        )

        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
                "relevance": score
            }
            for doc, score in results
        ]

    def forget(self, doc_id: str):
        """Remove a specific memory."""
        self.vector_store.delete([doc_id])

    def decay_old_memories(self, days_threshold: int = 90):
        """Remove memories older than threshold."""
        # Implementation depends on vector store capabilities
        pass

class MemoryTypes:
    FACT = "fact"           # Learned facts
    PREFERENCE = "preference"  # User preferences
    DECISION = "decision"      # Past decisions
    INTERACTION = "interaction"  # Notable interactions
    PROCEDURE = "procedure"    # How to do things
```

## Working Memory for Complex Tasks

```python
from typing import Any, Optional
from dataclasses import dataclass, field

@dataclass
class WorkingMemorySlot:
    name: str
    content: Any
    priority: int = 5
    created_at: datetime = field(default_factory=datetime.utcnow)
    accessed_at: datetime = field(default_factory=datetime.utcnow)
    access_count: int = 0

class WorkingMemory:
    def __init__(self, max_slots: int = 10):
        self.slots: dict[str, WorkingMemorySlot] = {}
        self.max_slots = max_slots

    def store(self, name: str, content: Any, priority: int = 5):
        """Store content in working memory."""
        if len(self.slots) >= self.max_slots and name not in self.slots:
            self._evict_lowest_priority()

        self.slots[name] = WorkingMemorySlot(
            name=name,
            content=content,
            priority=priority
        )

    def retrieve(self, name: str) -> Optional[Any]:
        """Retrieve content from working memory."""
        if name in self.slots:
            slot = self.slots[name]
            slot.accessed_at = datetime.utcnow()
            slot.access_count += 1
            return slot.content
        return None

    def update(self, name: str, content: Any):
        """Update existing slot."""
        if name in self.slots:
            self.slots[name].content = content
            self.slots[name].accessed_at = datetime.utcnow()

    def remove(self, name: str):
        """Remove a slot."""
        if name in self.slots:
            del self.slots[name]

    def get_active_context(self) -> dict[str, Any]:
        """Get all working memory as context."""
        return {
            name: slot.content
            for name, slot in self.slots.items()
        }

    def _evict_lowest_priority(self):
        """Evict the lowest priority, least recently accessed slot."""
        if not self.slots:
            return

        # Score: lower is more evictable
        def eviction_score(slot: WorkingMemorySlot) -> float:
            recency = (datetime.utcnow() - slot.accessed_at).total_seconds()
            return slot.priority * 1000 - recency + slot.access_count * 100

        lowest = min(self.slots.values(), key=eviction_score)
        del self.slots[lowest.name]

# Usage in agent
class AgentWithWorkingMemory:
    def __init__(self):
        self.working_memory = WorkingMemory(max_slots=10)

    def process_task(self, task: str):
        # Store task context
        self.working_memory.store("current_task", task, priority=10)

        # Store intermediate results
        step1_result = self.execute_step1(task)
        self.working_memory.store("step1_result", step1_result, priority=7)

        # Retrieve previous results for next step
        prev_result = self.working_memory.retrieve("step1_result")
        step2_result = self.execute_step2(prev_result)

        # Update with final result
        self.working_memory.store("final_result", step2_result, priority=8)

        return step2_result
```

## Memory Integration Pattern

```python
from langchain_openai import AzureChatOpenAI
from typing import TypedDict, Optional

class IntegratedMemoryState(TypedDict):
    user_id: str
    input: str
    short_term_context: list[dict]
    long_term_memories: list[dict]
    working_context: dict
    response: str

class IntegratedMemoryAgent:
    def __init__(
        self,
        short_term: ShortTermMemory,
        long_term: LongTermMemory,
        working: WorkingMemory,
        llm: AzureChatOpenAI
    ):
        self.short_term = short_term
        self.long_term = long_term
        self.working = working
        self.llm = llm

    def process(self, user_id: str, user_input: str) -> str:
        # 1. Add to short-term memory
        self.short_term.add({"role": "user", "content": user_input})

        # 2. Recall relevant long-term memories
        long_term_memories = self.long_term.recall(
            query=user_input,
            k=3
        )

        # 3. Get working memory context
        working_context = self.working.get_active_context()

        # 4. Build prompt with all memory types
        prompt = self._build_prompt(
            user_input=user_input,
            short_term=self.short_term.get_context(),
            long_term=long_term_memories,
            working=working_context
        )

        # 5. Generate response
        response = self.llm.invoke(prompt).content

        # 6. Update memories
        self.short_term.add({"role": "assistant", "content": response})

        # 7. Check if anything should be stored long-term
        self._maybe_store_long_term(user_input, response)

        return response

    def _build_prompt(
        self,
        user_input: str,
        short_term: list[dict],
        long_term: list[dict],
        working: dict
    ) -> str:
        parts = []

        # Long-term memories as context
        if long_term:
            memories_text = "\n".join(
                f"- {m['content']}" for m in long_term
            )
            parts.append(f"Relevant past knowledge:\n{memories_text}")

        # Working memory context
        if working:
            working_text = "\n".join(
                f"- {k}: {v}" for k, v in working.items()
            )
            parts.append(f"Current working context:\n{working_text}")

        # Conversation history
        if short_term:
            history_text = "\n".join(
                f"{m['role']}: {m['content']}" for m in short_term[-5:]
            )
            parts.append(f"Recent conversation:\n{history_text}")

        parts.append(f"User: {user_input}")
        parts.append("Assistant:")

        return "\n\n".join(parts)

    def _maybe_store_long_term(self, user_input: str, response: str):
        """Decide if this interaction should be stored long-term."""
        # Store preferences
        if any(word in user_input.lower() for word in ["prefer", "like", "always", "never"]):
            self.long_term.store(
                content=f"User expressed preference: {user_input}",
                memory_type=MemoryTypes.PREFERENCE
            )

        # Store learned facts
        if "remember" in user_input.lower():
            self.long_term.store(
                content=f"User asked to remember: {user_input}",
                memory_type=MemoryTypes.FACT
            )
```

## Memory Consolidation

Periodically consolidate memories for efficiency:

```python
class MemoryConsolidator:
    def __init__(self, long_term: LongTermMemory, llm: AzureChatOpenAI):
        self.long_term = long_term
        self.llm = llm

    def consolidate_user_memories(self, user_id: str):
        """Consolidate a user's memories."""
        # Get all user memories
        all_memories = self.long_term.recall(
            query="*",
            k=100,
            memory_type=None
        )

        # Group by type
        by_type = {}
        for memory in all_memories:
            mtype = memory["metadata"].get("memory_type", "unknown")
            if mtype not in by_type:
                by_type[mtype] = []
            by_type[mtype].append(memory)

        # Consolidate each type
        for mtype, memories in by_type.items():
            if len(memories) > 10:
                self._consolidate_group(mtype, memories)

    def _consolidate_group(self, memory_type: str, memories: list[dict]):
        """Consolidate a group of similar memories."""
        contents = [m["content"] for m in memories]

        prompt = f"""
        Consolidate these {memory_type} memories into a smaller set of key facts.
        Remove duplicates and combine related items.

        Memories:
        {chr(10).join(f'- {c}' for c in contents)}

        Return consolidated memories, one per line.
        """

        response = self.llm.invoke(prompt)
        consolidated = response.content.strip().split("\n")

        # Remove old memories
        for memory in memories:
            self.long_term.forget(memory["metadata"]["id"])

        # Store consolidated
        for item in consolidated:
            if item.strip():
                self.long_term.store(
                    content=item.strip(),
                    memory_type=memory_type,
                    metadata={"consolidated": True}
                )
```

## Best Practices

1. **Layer your memory**: Different types for different purposes
2. **Manage capacity**: Always have eviction strategies
3. **Consolidate regularly**: Prevent memory bloat
4. **Make retrieval smart**: Use semantic search, not just recency
5. **Handle privacy**: Clear memories when appropriate

## Conclusion

Effective memory management transforms agents from stateless responders into knowledgeable assistants. The key is combining short-term context, long-term knowledge, and working memory appropriately for each task.

Start simple with conversation history, add long-term storage as needed, and implement consolidation to keep things efficient.
