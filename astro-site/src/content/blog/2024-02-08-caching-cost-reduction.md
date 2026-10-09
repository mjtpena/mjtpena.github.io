---
title: "Caching Strategies for LLM Cost Reduction"
author: Michael John Peña
draft: false
date: 2024-02-08
tags:
  - Caching
  - Cost Reduction
  - LLM
  - Redis
  - Performance
---

## Exact Match Caching

```python
import hashlib
import redis
import json

class ExactMatchCache:
    def __init__(self, redis_client: redis.Redis, ttl_hours: int = 24):
        self.redis = redis_client
        self.ttl = ttl_hours * 3600

    def _hash_prompt(self, prompt: str) -> str:
        return hashlib.sha256(prompt.encode()).hexdigest()

    def get(self, prompt: str) -> str | None:
        key = f"llm:exact:{self._hash_prompt(prompt)}"
        cached = self.redis.get(key)
        return json.loads(cached) if cached else None

    def set(self, prompt: str, response: str):
        key = f"llm:exact:{self._hash_prompt(prompt)}"
        self.redis.setex(key, self.ttl, json.dumps(response))

    def get_or_call(self, prompt: str, llm_func) -> tuple[str, bool]:
        cached = self.get(prompt)
        if cached:
            return cached, True  # Cache hit
        response = llm_func(prompt)
        self.set(prompt, response)
        return response, False  # Cache miss
```

## Semantic Caching

```python
import numpy as np
from typing import Optional

class SemanticCache:
    def __init__(self, embedding_func, similarity_threshold: float = 0.95):
        self.embed = embedding_func
        self.threshold = similarity_threshold
        self.cache: list[dict] = []

    def _cosine_similarity(self, a: np.array, b: np.array) -> float:
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def get(self, prompt: str) -> Optional[str]:
        query_embedding = self.embed(prompt)

        for entry in self.cache:
            similarity = self._cosine_similarity(query_embedding, entry["embedding"])
            if similarity >= self.threshold:
                return entry["response"]
        return None

    def set(self, prompt: str, response: str):
        embedding = self.embed(prompt)
        self.cache.append({
            "prompt": prompt,
            "embedding": embedding,
            "response": response
        })

# Similar prompts return cached responses
# "How do I reset my password?" ≈ "How can I change my password?"
```

## Hybrid Caching Strategy

```python
class HybridCache:
    def __init__(self, exact_cache: ExactMatchCache, semantic_cache: SemanticCache):
        self.exact = exact_cache
        self.semantic = semantic_cache

    def get(self, prompt: str) -> tuple[str | None, str]:
        # Try exact match first (faster)
        exact_result = self.exact.get(prompt)
        if exact_result:
            return exact_result, "exact"

        # Try semantic match
        semantic_result = self.semantic.get(prompt)
        if semantic_result:
            return semantic_result, "semantic"

        return None, "miss"

    def set(self, prompt: str, response: str):
        self.exact.set(prompt, response)
        self.semantic.set(prompt, response)
```

## Cache Analytics

```python
class CacheAnalytics:
    def __init__(self):
        self.hits = {"exact": 0, "semantic": 0}
        self.misses = 0

    def record(self, cache_type: str):
        if cache_type == "miss":
            self.misses += 1
        else:
            self.hits[cache_type] += 1

    def get_stats(self) -> dict:
        total = sum(self.hits.values()) + self.misses
        return {
            "hit_rate": sum(self.hits.values()) / total if total > 0 else 0,
            "exact_hits": self.hits["exact"],
            "semantic_hits": self.hits["semantic"],
            "misses": self.misses,
            "estimated_savings_percent": sum(self.hits.values()) / total * 100 if total > 0 else 0
        }
```

## Best Practices

1. **Start with exact match** - Simple and effective
2. **Add semantic caching** - For variable phrasing
3. **Set appropriate TTL** - Balance freshness and savings
4. **Monitor hit rates** - Optimize threshold based on data
5. **Cache selectively** - Not all responses should be cached

## Conclusion

Caching is the fastest path to LLM cost reduction. Implement exact match caching first, then add semantic caching for additional savings.
