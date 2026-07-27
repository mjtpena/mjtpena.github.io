---
title: "Semantic Caching: Intelligent Response Reuse for LLMs"
author: Michael John Peña
draft: false
date: 2024-02-10
tags:
  - Semantic Caching
  - LLM
  - Embeddings
  - Cost Optimization
  - Vector Search

---

I wrote "Semantic Caching: Intelligent Response Reuse for LLMs" to share practical, production-minded guidance on this topic.

## How It Works

```
Query: "How do I reset my password?"
→ Embed → [0.12, 0.45, ...]
→ Search cache → Find similar: "How can I change my password?" (similarity: 0.96)
→ Return cached response
```

## Implementation

```python
import numpy as np
from dataclasses import dataclass

@dataclass
class CacheEntry:
    query: str
    embedding: np.array
    response: str
    created_at: datetime
    hits: int = 0

class SemanticCache:
    def __init__(
        self,
        embedding_func,
        similarity_threshold: float = 0.92,
        max_entries: int = 10000
    ):
        self.embed = embedding_func
        self.threshold = similarity_threshold
        self.max_entries = max_entries
        self.entries: list[CacheEntry] = []

    def _cosine_similarity(self, a: np.array, b: np.array) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    def search(self, query: str) -> tuple[str | None, float]:
        """Search for semantically similar cached response."""
        query_embedding = self.embed(query)

        best_match = None
        best_similarity = 0.0

        for entry in self.entries:
            similarity = self._cosine_similarity(query_embedding, entry.embedding)
            if similarity > best_similarity and similarity >= self.threshold:
                best_similarity = similarity
                best_match = entry

        if best_match:
            best_match.hits += 1
            return best_match.response, best_similarity

        return None, 0.0

    def add(self, query: str, response: str):
        """Add new entry to cache."""
        embedding = self.embed(query)

        # Evict if at capacity (LRU-like based on hits)
        if len(self.entries) >= self.max_entries:
            self.entries.sort(key=lambda e: e.hits)
            self.entries.pop(0)

        self.entries.append(CacheEntry(
            query=query,
            embedding=embedding,
            response=response,
            created_at=datetime.utcnow()
        ))
```

## Vector Database Backed Cache

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

class VectorDBSemanticCache:
    def __init__(self, search_client: SearchClient, embedding_func, threshold: float = 0.92):
        self.search = search_client
        self.embed = embedding_func
        self.threshold = threshold

    def get(self, query: str) -> str | None:
        query_vector = self.embed(query)

        results = self.search.search(
            search_text="",
            vector_queries=[
                VectorizedQuery(
                    vector=query_vector,
                    k_nearest_neighbors=1,
                    fields="query_vector"
                )
            ],
            select=["response", "query"]
        )

        for result in results:
            if result["@search.score"] >= self.threshold:
                return result["response"]

        return None

    def set(self, query: str, response: str):
        doc = {
            "id": str(uuid.uuid4()),
            "query": query,
            "query_vector": self.embed(query),
            "response": response,
            "created": datetime.utcnow().isoformat()
        }
        self.search.upload_documents([doc])
```

## Threshold Tuning

```python
def evaluate_threshold(cache: SemanticCache, test_pairs: list[dict]) -> dict:
    """Evaluate cache effectiveness at different thresholds."""

    results = {}

    for threshold in [0.85, 0.90, 0.92, 0.95, 0.98]:
        cache.threshold = threshold
        correct = 0
        total = len(test_pairs)

        for pair in test_pairs:
            cached, _ = cache.search(pair["query"])
            if cached and is_acceptable_response(cached, pair["expected"]):
                correct += 1

        results[threshold] = {
            "accuracy": correct / total,
            "threshold": threshold
        }

    return results
```

## Best Practices

1. **Start conservative** - Higher threshold (0.95+) for critical applications
2. **Tune with data** - Evaluate on your actual query patterns
3. **Monitor quality** - Track when semantic matches are wrong
4. **Use vector DB** - Scale beyond memory limits
5. **Combine with exact** - Check exact match before semantic

## Conclusion

Semantic caching increases hit rates by 20-50% over exact matching. Balance threshold between hit rate and accuracy for your use case.

