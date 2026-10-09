---
title: "Long-Term Agent Memory: Persistent Knowledge Storage"
author: Michael John Peña
draft: false
date: 2024-07-20
tags:
  - AI
  - Agents
  - Memory
  - Vector Database
  - Azure
---

## Long-Term Memory Architecture

```
User Query
    │
    ▼
┌─────────────────┐
│  Query Encoder  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Vector Search  │────▶│  Memory Store   │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Retrieved Memories
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Context + LLM  │
└────────┬────────┘
         │
         ▼
    Response
```

## Basic Implementation with Azure AI Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile
)
from azure.core.credentials import AzureKeyCredential
from langchain_openai import AzureOpenAIEmbeddings
from datetime import datetime
import uuid
import json

class AzureLongTermMemory:
    def __init__(
        self,
        search_endpoint: str,
        search_key: str,
        index_name: str = "agent-memories"
    ):
        self.credential = AzureKeyCredential(search_key)
        self.index_client = SearchIndexClient(search_endpoint, self.credential)
        self.search_client = SearchClient(search_endpoint, index_name, self.credential)
        self.embeddings = AzureOpenAIEmbeddings(azure_deployment="text-embedding-3-small")
        self.index_name = index_name

        self._ensure_index()

    def _ensure_index(self):
        """Create index if it doesn't exist."""
        try:
            self.index_client.get_index(self.index_name)
        except:
            self._create_index()

    def _create_index(self):
        """Create the search index."""
        fields = [
            SearchField(name="id", type=SearchFieldDataType.String, key=True),
            SearchField(name="user_id", type=SearchFieldDataType.String, filterable=True),
            SearchField(name="memory_type", type=SearchFieldDataType.String, filterable=True, facetable=True),
            SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
            SearchField(name="metadata", type=SearchFieldDataType.String),
            SearchField(name="created_at", type=SearchFieldDataType.DateTimeOffset, filterable=True, sortable=True),
            SearchField(name="access_count", type=SearchFieldDataType.Int32),
            SearchField(name="last_accessed", type=SearchFieldDataType.DateTimeOffset, sortable=True),
            SearchField(
                name="embedding",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                vector_search_dimensions=1536,
                vector_search_profile_name="memory-profile"
            ),
        ]

        vector_search = VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="memory-hnsw")],
            profiles=[VectorSearchProfile(name="memory-profile", algorithm_configuration_name="memory-hnsw")]
        )

        index = SearchIndex(name=self.index_name, fields=fields, vector_search=vector_search)
        self.index_client.create_index(index)

    def store(
        self,
        user_id: str,
        content: str,
        memory_type: str,
        metadata: dict = None
    ) -> str:
        """Store a new memory."""
        memory_id = str(uuid.uuid4())
        embedding = self.embeddings.embed_query(content)

        document = {
            "id": memory_id,
            "user_id": user_id,
            "memory_type": memory_type,
            "content": content,
            "metadata": json.dumps(metadata or {}),
            "created_at": datetime.utcnow().isoformat() + "Z",
            "access_count": 0,
            "last_accessed": datetime.utcnow().isoformat() + "Z",
            "embedding": embedding
        }

        self.search_client.upload_documents([document])
        return memory_id

    def recall(
        self,
        user_id: str,
        query: str,
        memory_type: str = None,
        k: int = 5,
        min_relevance: float = 0.7
    ) -> list[dict]:
        """Recall relevant memories."""
        query_embedding = self.embeddings.embed_query(query)

        # Build filter
        filters = [f"user_id eq '{user_id}'"]
        if memory_type:
            filters.append(f"memory_type eq '{memory_type}'")
        filter_str = " and ".join(filters)

        results = self.search_client.search(
            search_text=None,
            vector_queries=[{
                "vector": query_embedding,
                "k_nearest_neighbors": k,
                "fields": "embedding"
            }],
            filter=filter_str,
            select=["id", "content", "memory_type", "metadata", "created_at", "access_count"]
        )

        memories = []
        for result in results:
            if result["@search.score"] >= min_relevance:
                memories.append({
                    "id": result["id"],
                    "content": result["content"],
                    "type": result["memory_type"],
                    "metadata": json.loads(result["metadata"]),
                    "relevance": result["@search.score"],
                    "created_at": result["created_at"]
                })

                # Update access stats
                self._record_access(result["id"])

        return memories

    def _record_access(self, memory_id: str):
        """Record that a memory was accessed."""
        try:
            doc = self.search_client.get_document(memory_id)
            self.search_client.merge_documents([{
                "id": memory_id,
                "access_count": doc.get("access_count", 0) + 1,
                "last_accessed": datetime.utcnow().isoformat() + "Z"
            }])
        except:
            pass

    def forget(self, memory_id: str):
        """Delete a specific memory."""
        self.search_client.delete_documents([{"id": memory_id}])

    def forget_user(self, user_id: str):
        """Delete all memories for a user (GDPR compliance)."""
        # Find all user memories
        results = self.search_client.search(
            search_text="*",
            filter=f"user_id eq '{user_id}'",
            select=["id"]
        )

        ids_to_delete = [{"id": r["id"]} for r in results]
        if ids_to_delete:
            self.search_client.delete_documents(ids_to_delete)
```

## Memory Types and Categorization

```python
class MemoryType:
    # User-specific
    PREFERENCE = "preference"      # User preferences
    FACT = "fact"                  # Facts user told us
    CONTEXT = "context"            # Background context

    # Interaction-based
    DECISION = "decision"          # Past decisions made
    FEEDBACK = "feedback"          # Feedback received
    ERROR = "error"                # Errors encountered

    # Knowledge
    PROCEDURE = "procedure"        # How to do things
    INSIGHT = "insight"            # Discovered insights

class CategorizedMemoryStore:
    def __init__(self, base_store: AzureLongTermMemory):
        self.store = base_store

    def store_preference(self, user_id: str, preference: str, category: str = None):
        """Store a user preference."""
        return self.store.store(
            user_id=user_id,
            content=preference,
            memory_type=MemoryType.PREFERENCE,
            metadata={"category": category}
        )

    def store_fact(self, user_id: str, fact: str, source: str = "user"):
        """Store a fact."""
        return self.store.store(
            user_id=user_id,
            content=fact,
            memory_type=MemoryType.FACT,
            metadata={"source": source}
        )

    def store_decision(self, user_id: str, decision: str, context: str, outcome: str = None):
        """Store a decision made."""
        return self.store.store(
            user_id=user_id,
            content=f"Decision: {decision}. Context: {context}",
            memory_type=MemoryType.DECISION,
            metadata={"outcome": outcome}
        )

    def store_procedure(self, user_id: str, procedure: str, steps: list[str]):
        """Store a procedure."""
        steps_text = "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps))
        return self.store.store(
            user_id=user_id,
            content=f"{procedure}:\n{steps_text}",
            memory_type=MemoryType.PROCEDURE,
            metadata={"step_count": len(steps)}
        )

    def recall_preferences(self, user_id: str, context: str, k: int = 3) -> list[dict]:
        """Recall relevant preferences."""
        return self.store.recall(
            user_id=user_id,
            query=context,
            memory_type=MemoryType.PREFERENCE,
            k=k
        )

    def recall_relevant(self, user_id: str, query: str, k: int = 5) -> list[dict]:
        """Recall all relevant memories."""
        return self.store.recall(
            user_id=user_id,
            query=query,
            k=k
        )
```

## Automatic Memory Extraction

```python
from langchain_openai import AzureChatOpenAI

class MemoryExtractor:
    def __init__(self, memory_store: CategorizedMemoryStore):
        self.store = memory_store
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o-mini")

    def extract_and_store(self, user_id: str, conversation: list[dict]):
        """Extract storable memories from conversation."""
        conversation_text = "\n".join(
            f"{m['role']}: {m['content']}"
            for m in conversation
        )

        prompt = f"""
Analyze this conversation and extract any information worth remembering.

Conversation:
{conversation_text}

Extract and categorize:
1. User preferences (things they like/dislike, how they want things done)
2. Facts about the user (name, role, team, projects)
3. Decisions made (choices and their reasoning)
4. Procedures learned (step-by-step processes)
5. Important insights (discoveries, conclusions)

Return JSON:
{{
  "preferences": ["..."],
  "facts": ["..."],
  "decisions": [{{"decision": "...", "context": "..."}}],
  "procedures": [{{"name": "...", "steps": ["..."]}}],
  "insights": ["..."]
}}

If nothing worth remembering, return empty arrays.
"""

        response = self.llm.invoke(prompt)

        try:
            extracted = json.loads(response.content)
        except:
            return []

        stored = []

        for pref in extracted.get("preferences", []):
            if pref:
                mid = self.store.store_preference(user_id, pref)
                stored.append(("preference", mid))

        for fact in extracted.get("facts", []):
            if fact:
                mid = self.store.store_fact(user_id, fact)
                stored.append(("fact", mid))

        for decision in extracted.get("decisions", []):
            if decision.get("decision"):
                mid = self.store.store_decision(
                    user_id,
                    decision["decision"],
                    decision.get("context", "")
                )
                stored.append(("decision", mid))

        for proc in extracted.get("procedures", []):
            if proc.get("name") and proc.get("steps"):
                mid = self.store.store_procedure(
                    user_id,
                    proc["name"],
                    proc["steps"]
                )
                stored.append(("procedure", mid))

        for insight in extracted.get("insights", []):
            if insight:
                mid = self.store.store(
                    user_id=user_id,
                    content=insight,
                    memory_type=MemoryType.INSIGHT
                )
                stored.append(("insight", mid))

        return stored
```

## Memory-Augmented Agent

```python
class MemoryAugmentedAgent:
    def __init__(
        self,
        memory: CategorizedMemoryStore,
        extractor: MemoryExtractor
    ):
        self.memory = memory
        self.extractor = extractor
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")
        self.conversation = []

    def chat(self, user_id: str, message: str) -> str:
        # Add user message
        self.conversation.append({"role": "user", "content": message})

        # Recall relevant memories
        memories = self.memory.recall_relevant(user_id, message, k=5)

        # Build context with memories
        system_prompt = self._build_system_prompt(memories)

        # Generate response
        messages = [
            {"role": "system", "content": system_prompt},
            *self.conversation
        ]

        response = self.llm.invoke(messages)
        assistant_message = response.content

        # Add to conversation
        self.conversation.append({"role": "assistant", "content": assistant_message})

        # Periodically extract memories (every 5 turns)
        if len(self.conversation) % 10 == 0:
            self.extractor.extract_and_store(user_id, self.conversation[-10:])

        return assistant_message

    def _build_system_prompt(self, memories: list[dict]) -> str:
        base_prompt = "You are a helpful assistant with memory of past interactions."

        if not memories:
            return base_prompt

        memory_text = "\n".join(
            f"- [{m['type']}] {m['content']}"
            for m in memories
        )

        return f"""{base_prompt}

Relevant memories from past interactions:
{memory_text}

Use these memories to provide personalized, contextual responses.
Reference past information naturally when relevant."""

    def end_session(self, user_id: str):
        """End session and extract final memories."""
        if len(self.conversation) > 2:
            self.extractor.extract_and_store(user_id, self.conversation)
        self.conversation = []
```

## Memory Maintenance

```python
class MemoryMaintainer:
    def __init__(self, memory_store: AzureLongTermMemory):
        self.store = memory_store

    def cleanup_old_memories(self, user_id: str, days_threshold: int = 180):
        """Remove memories older than threshold that haven't been accessed."""
        from datetime import timedelta

        cutoff = datetime.utcnow() - timedelta(days=days_threshold)

        # Find old, unused memories
        results = self.store.search_client.search(
            search_text="*",
            filter=f"user_id eq '{user_id}' and last_accessed lt {cutoff.isoformat()}Z and access_count lt 3",
            select=["id"]
        )

        ids_to_delete = [{"id": r["id"]} for r in results]
        if ids_to_delete:
            self.store.search_client.delete_documents(ids_to_delete)

        return len(ids_to_delete)

    def deduplicate_memories(self, user_id: str, similarity_threshold: float = 0.95):
        """Remove near-duplicate memories."""
        # Get all user memories
        results = list(self.store.search_client.search(
            search_text="*",
            filter=f"user_id eq '{user_id}'",
            select=["id", "content", "embedding", "access_count"]
        ))

        if len(results) < 2:
            return 0

        # Find duplicates
        to_delete = set()

        for i, mem1 in enumerate(results):
            if mem1["id"] in to_delete:
                continue

            for mem2 in results[i+1:]:
                if mem2["id"] in to_delete:
                    continue

                similarity = self._cosine_similarity(
                    mem1["embedding"],
                    mem2["embedding"]
                )

                if similarity >= similarity_threshold:
                    # Keep the one with more accesses
                    if mem1.get("access_count", 0) >= mem2.get("access_count", 0):
                        to_delete.add(mem2["id"])
                    else:
                        to_delete.add(mem1["id"])

        if to_delete:
            self.store.search_client.delete_documents([{"id": id} for id in to_delete])

        return len(to_delete)

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        import numpy as np
        a, b = np.array(a), np.array(b)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
```

## Best Practices

1. **Categorize memories**: Different types need different handling
2. **Extract automatically**: Don't rely on explicit save commands
3. **Maintain regularly**: Clean up and deduplicate
4. **Respect privacy**: Implement deletion capabilities
5. **Monitor quality**: Track which memories are actually useful

## Conclusion

Long-term memory is what makes agents truly intelligent assistants. They remember your preferences, learn from past interactions, and apply accumulated knowledge.

Implement memory extraction early, maintain it regularly, and always respect user privacy. The investment pays off in dramatically better user experiences.
