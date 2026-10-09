---
title: "Semantic Caching for LLM Applications: Reducing Costs and Latency"
description: "Unlike exact-match caching, semantic caching uses embeddings to find similar queries even when worded differently."
author: Michael John Peña
draft: false
date: 2025-09-18
tags:
  - LLM
  - Caching
  - Vector Search
  - Performance
  - Cost Optimization
---

## How Semantic Caching Works

Unlike exact-match caching, semantic caching uses embeddings to find similar queries even when worded differently.

```python
from openai import AzureOpenAI
import numpy as np
from typing import Optional, Dict, Tuple
import hashlib
import time

class SemanticCache:
    def __init__(self, client: AzureOpenAI, similarity_threshold: float = 0.92):
        self.client = client
        self.similarity_threshold = similarity_threshold
        self.cache: Dict[str, Dict] = {}  # hash -> {embedding, response, timestamp}
        self.embeddings_matrix: Optional[np.ndarray] = None
        self.hash_index: list = []  # Maps matrix row to cache hash

    def _get_embedding(self, text: str) -> np.ndarray:
        """Generate embedding for text."""
        response = self.client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return np.array(response.data[0].embedding)

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def _find_similar(self, query_embedding: np.ndarray) -> Optional[Tuple[str, float]]:
        """Find most similar cached query."""
        if self.embeddings_matrix is None or len(self.embeddings_matrix) == 0:
            return None

        # Compute similarities with all cached embeddings
        similarities = np.dot(self.embeddings_matrix, query_embedding) / (
            np.linalg.norm(self.embeddings_matrix, axis=1) * np.linalg.norm(query_embedding)
        )

        max_idx = np.argmax(similarities)
        max_similarity = similarities[max_idx]

        if max_similarity >= self.similarity_threshold:
            return self.hash_index[max_idx], max_similarity

        return None

    def get(self, query: str) -> Optional[Dict]:
        """Check cache for semantically similar query."""
        query_embedding = self._get_embedding(query)

        result = self._find_similar(query_embedding)
        if result:
            cache_hash, similarity = result
            cached = self.cache[cache_hash]
            return {
                "response": cached["response"],
                "similarity": similarity,
                "cache_hit": True,
                "original_query": cached.get("query")
            }

        return None

    def set(self, query: str, response: str):
        """Add query-response pair to cache."""
        query_embedding = self._get_embedding(query)
        query_hash = hashlib.md5(query.encode()).hexdigest()

        self.cache[query_hash] = {
            "query": query,
            "embedding": query_embedding,
            "response": response,
            "timestamp": time.time()
        }

        # Update embeddings matrix
        if self.embeddings_matrix is None:
            self.embeddings_matrix = query_embedding.reshape(1, -1)
        else:
            self.embeddings_matrix = np.vstack([self.embeddings_matrix, query_embedding])

        self.hash_index.append(query_hash)


def cached_completion(cache: SemanticCache, client: AzureOpenAI,
                      query: str, system_prompt: str) -> Dict:
    """Get completion with semantic caching."""

    # Check cache first
    cached = cache.get(query)
    if cached:
        return cached

    # Cache miss - call LLM
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ]
    )

    result = response.choices[0].message.content
    cache.set(query, result)

    return {
        "response": result,
        "cache_hit": False,
        "tokens_used": response.usage.total_tokens
    }
```

## Cache Eviction Strategies

Implement TTL-based eviction for time-sensitive content and LRU eviction when cache size exceeds limits.

Semantic caching is especially powerful for customer support bots and FAQ systems where users ask similar questions in different ways. Monitor your cache hit rate to tune the similarity threshold.
