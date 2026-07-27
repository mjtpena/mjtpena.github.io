---
title: "Memory Management for LLM Applications"
author: Michael John Peña
draft: false
date: 2023-08-29
tags:
  - Memory
  - LLM
  - Architecture
  - Chatbots

---

I wrote "Memory Management for LLM Applications" to share practical, production-minded guidance on this topic.

## Memory Types

```python
memory_types = {
    "buffer": "Store recent N messages",
    "summary": "Summarize conversation history",
    "entity": "Track mentioned entities",
    "knowledge_graph": "Build relationship graph",
    "vector": "Store and retrieve relevant memories"
}
```

## Buffer Memory

```python
class BufferMemory:
    def __init__(self, max_messages=10):
        self.max_messages = max_messages
        self.messages = []

    def add(self, role, content):
        self.messages.append({"role": role, "content": content})
        if len(self.messages) > self.max_messages:
            self.messages = self.messages[-self.max_messages:]

    def get_messages(self):
        return self.messages.copy()

    def clear(self):
        self.messages = []


class TokenBufferMemory:
    def __init__(self, max_tokens=2000):
        self.max_tokens = max_tokens
        self.messages = []

    def add(self, role, content):
        self.messages.append({"role": role, "content": content})
        self._trim_to_fit()

    def _trim_to_fit(self):
        while self._count_tokens() > self.max_tokens and len(self.messages) > 1:
            self.messages.pop(0)

    def _count_tokens(self):
        return sum(len(m["content"].split()) * 1.3 for m in self.messages)
```

## Entity Memory

```python
import spacy

class EntityMemory:
    def __init__(self):
        self.nlp = spacy.load("en_core_web_sm")
        self.entities = {}  # entity -> {type, mentions, context}

    def extract_and_store(self, text, message_id):
        doc = self.nlp(text)

        for ent in doc.ents:
            if ent.text not in self.entities:
                self.entities[ent.text] = {
                    "type": ent.label_,
                    "mentions": [],
                    "context": []
                }

            self.entities[ent.text]["mentions"].append(message_id)
            self.entities[ent.text]["context"].append(ent.sent.text)

    def get_entity_context(self, entity_name):
        return self.entities.get(entity_name, None)

    def get_relevant_entities(self, text):
        """Get entities mentioned in text that we know about."""
        doc = self.nlp(text)
        relevant = []
        for ent in doc.ents:
            if ent.text in self.entities:
                relevant.append({
                    "entity": ent.text,
                    "info": self.entities[ent.text]
                })
        return relevant

    def format_for_context(self):
        """Format entity memory for LLM context."""
        lines = ["Known entities:"]
        for entity, info in self.entities.items():
            lines.append(f"- {entity} ({info['type']}): {info['context'][-1]}")
        return "\n".join(lines)
```

## Vector Memory

```python
from sentence_transformers import SentenceTransformer
import numpy as np

class VectorMemory:
    def __init__(self, embedding_model="all-MiniLM-L6-v2"):
        self.model = SentenceTransformer(embedding_model)
        self.memories = []  # List of (embedding, text, metadata)

    def add(self, text, metadata=None):
        embedding = self.model.encode(text)
        self.memories.append({
            "embedding": embedding,
            "text": text,
            "metadata": metadata or {}
        })

    def search(self, query, top_k=5):
        if not self.memories:
            return []

        query_embedding = self.model.encode(query)
        embeddings = np.array([m["embedding"] for m in self.memories])

        # Compute similarities
        similarities = np.dot(embeddings, query_embedding) / (
            np.linalg.norm(embeddings, axis=1) * np.linalg.norm(query_embedding)
        )

        # Get top-k
        top_indices = np.argsort(similarities)[-top_k:][::-1]

        return [
            {
                "text": self.memories[i]["text"],
                "metadata": self.memories[i]["metadata"],
                "similarity": similarities[i]
            }
            for i in top_indices
        ]

    def get_relevant_context(self, query, max_tokens=1000):
        results = self.search(query, top_k=10)

        context = []
        tokens = 0
        for result in results:
            text_tokens = len(result["text"].split()) * 1.3
            if tokens + text_tokens <= max_tokens:
                context.append(result["text"])
                tokens += text_tokens

        return "\n\n".join(context)
```

## Combined Memory System

```python
class MemorySystem:
    def __init__(self, client):
        self.client = client
        self.buffer = TokenBufferMemory(max_tokens=1000)
        self.entities = EntityMemory()
        self.vector = VectorMemory()
        self.summary = ""

    def add_exchange(self, user_message, assistant_message):
        # Add to buffer
        self.buffer.add("user", user_message)
        self.buffer.add("assistant", assistant_message)

        # Extract entities
        self.entities.extract_and_store(user_message, len(self.buffer.messages))
        self.entities.extract_and_store(assistant_message, len(self.buffer.messages))

        # Add to vector memory
        self.vector.add(user_message, {"role": "user"})
        self.vector.add(assistant_message, {"role": "assistant"})

    def get_context(self, current_query):
        context_parts = []

        # Add summary if exists
        if self.summary:
            context_parts.append(f"Summary: {self.summary}")

        # Add relevant entities
        relevant_entities = self.entities.get_relevant_entities(current_query)
        if relevant_entities:
            context_parts.append(self.entities.format_for_context())

        # Add relevant vector memories
        relevant_memories = self.vector.get_relevant_context(current_query, max_tokens=500)
        if relevant_memories:
            context_parts.append(f"Relevant context:\n{relevant_memories}")

        return "\n\n".join(context_parts)

    def get_messages_for_llm(self, current_query):
        messages = []

        # System message with context
        context = self.get_context(current_query)
        if context:
            messages.append({"role": "system", "content": context})

        # Recent messages
        messages.extend(self.buffer.get_messages())

        return messages
```

## Persistent Memory

```python
import json
import redis

class PersistentMemory:
    def __init__(self, redis_client, session_id):
        self.redis = redis_client
        self.session_id = session_id
        self.memory = MemorySystem(None)
        self._load()

    def _load(self):
        data = self.redis.get(f"memory:{self.session_id}")
        if data:
            state = json.loads(data)
            self.memory.summary = state.get("summary", "")
            self.memory.buffer.messages = state.get("buffer", [])

    def save(self):
        state = {
            "summary": self.memory.summary,
            "buffer": self.memory.buffer.messages
        }
        self.redis.setex(
            f"memory:{self.session_id}",
            86400,  # 24 hour TTL
            json.dumps(state)
        )

    def add_and_save(self, user_message, assistant_message):
        self.memory.add_exchange(user_message, assistant_message)
        self.save()
```

Tomorrow we'll explore LangChain updates and new features.

## Resources

- [LangChain Memory](https://python.langchain.com/docs/modules/memory/)
- [Vector Stores](https://python.langchain.com/docs/modules/data_connection/vectorstores/)
- [Conversational Memory Patterns](https://arxiv.org/abs/2304.03442)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
