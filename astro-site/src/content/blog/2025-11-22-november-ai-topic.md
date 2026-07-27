---
title: "Semantic Caching for LLM Applications: Reducing Costs and Latency"
author: Michael John Peña
draft: false
date: 2025-11-22
tags:
  - Caching
  - LLM
  - Performance
  - Cost Optimization
  - Redis

---

I wrote "Semantic Caching for LLM Applications: Reducing Costs and Latency" to share practical, production-minded guidance on this topic.

## Why Semantic Caching

Traditional caching requires exact matches. Users asking "What is Azure?" and "Can you explain Azure?" would generate two separate API calls. Semantic caching recognizes these as equivalent queries.

## Implementing Semantic Cache

Build a cache layer using embeddings and vector similarity:

```python
import redis
import numpy as np
import json
import hashlib
from datetime import timedelta
from openai import AzureOpenAI

class SemanticCache:
    def __init__(
        self,
        redis_client: redis.Redis,
        openai_client: AzureOpenAI,
        similarity_threshold: float = 0.92,
        ttl_hours: int = 24
    ):
        self.redis = redis_client
        self.openai = openai_client
        self.threshold = similarity_threshold
        self.ttl = timedelta(hours=ttl_hours)
        self.embedding_model = "text-embedding-ada-002"

    async def get_embedding(self, text: str) -> list[float]:
        """Generate embedding for text."""
        response = await self.openai.embeddings.create(
            model=self.embedding_model,
            input=text
        )
        return response.data[0].embedding

    def cosine_similarity(self, vec1: list[float], vec2: list[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        a = np.array(vec1)
        b = np.array(vec2)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    async def get(self, query: str, context_hash: str = None) -> dict | None:
        """Retrieve cached response for semantically similar query."""

        query_embedding = await self.get_embedding(query)

        # Build cache key prefix including context
        prefix = f"semantic_cache:{context_hash or 'default'}:*"

        # Scan for potential matches
        best_match = None
        best_similarity = 0

        for key in self.redis.scan_iter(prefix):
            cached_data = json.loads(self.redis.get(key))
            cached_embedding = cached_data["embedding"]

            similarity = self.cosine_similarity(query_embedding, cached_embedding)

            if similarity > self.threshold and similarity > best_similarity:
                best_similarity = similarity
                best_match = cached_data

        if best_match:
            # Record cache hit metrics
            self.record_hit(best_similarity)
            return {
                "response": best_match["response"],
                "cached": True,
                "similarity": best_similarity,
                "original_query": best_match["query"]
            }

        return None

    async def set(
        self,
        query: str,
        response: str,
        context_hash: str = None,
        metadata: dict = None
    ):
        """Cache response with semantic lookup capability."""

        query_embedding = await self.get_embedding(query)

        # Generate unique key
        key_hash = hashlib.sha256(
            f"{query}:{context_hash}".encode()
        ).hexdigest()[:16]

        cache_key = f"semantic_cache:{context_hash or 'default'}:{key_hash}"

        cache_data = {
            "query": query,
            "embedding": query_embedding,
            "response": response,
            "metadata": metadata or {},
            "created_at": datetime.utcnow().isoformat()
        }

        self.redis.setex(
            cache_key,
            self.ttl,
            json.dumps(cache_data)
        )

    async def get_or_generate(
        self,
        query: str,
        generate_fn,
        context_hash: str = None
    ) -> dict:
        """Get cached response or generate new one."""

        # Try cache first
        cached = await self.get(query, context_hash)
        if cached:
            return cached

        # Generate new response
        response = await generate_fn(query)

        # Cache the result
        await self.set(query, response, context_hash)

        return {
            "response": response,
            "cached": False,
            "similarity": 1.0
        }
```

## Usage Pattern

Integrate semantic caching into your LLM service:

```python
class CachedLLMService:
    def __init__(self, cache: SemanticCache, openai_client: AzureOpenAI):
        self.cache = cache
        self.client = openai_client

    async def chat(self, query: str, system_prompt: str = None) -> str:
        """Execute chat with semantic caching."""

        # Hash the system prompt for context-aware caching
        context_hash = hashlib.md5(
            (system_prompt or "").encode()
        ).hexdigest()

        async def generate(q: str) -> str:
            response = await self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": system_prompt or "You are a helpful assistant."},
                    {"role": "user", "content": q}
                ]
            )
            return response.choices[0].message.content

        result = await self.cache.get_or_generate(
            query, generate, context_hash
        )

        return result["response"]
```

Semantic caching typically achieves 30-50% cache hit rates for customer-facing applications, significantly reducing costs while improving response latency for common queries.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
