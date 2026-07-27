---
title: "Prompt Caching Strategies: Reducing Latency and Cost"
author: Michael John Peña
draft: false
date: 2025-03-17
tags:
  - AI
  - Caching
  - Optimization
  - Performance
  - Cost

---

I wrote "Prompt Caching Strategies: Reducing Latency and Cost" to share practical, production-minded guidance on this topic.

## Prompt Caching Implementation

```python
from azure.ai.openai import AzureOpenAI
import hashlib
import redis
from typing import Optional
import json

class PromptCache:
    def __init__(self, redis_client: redis.Redis, ttl_seconds: int = 3600):
        self.redis = redis_client
        self.ttl = ttl_seconds

    def _cache_key(self, messages: list, model: str, temperature: float) -> str:
        """Generate deterministic cache key."""
        content = json.dumps({
            "messages": messages,
            "model": model,
            "temperature": temperature
        }, sort_keys=True)
        return f"prompt:{hashlib.sha256(content.encode()).hexdigest()}"

    async def get_or_compute(
        self,
        openai_client: AzureOpenAI,
        messages: list,
        model: str = "gpt-4o",
        temperature: float = 0
    ) -> str:
        """Get cached response or compute new one."""
        # Only cache deterministic requests
        if temperature > 0:
            return await self._compute(openai_client, messages, model, temperature)

        key = self._cache_key(messages, model, temperature)
        cached = self.redis.get(key)

        if cached:
            return json.loads(cached)

        response = await self._compute(openai_client, messages, model, temperature)
        self.redis.setex(key, self.ttl, json.dumps(response))
        return response

    async def _compute(self, client, messages, model, temperature) -> str:
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature
        )
        return response.choices[0].message.content


class SemanticCache:
    """Cache based on semantic similarity, not exact match."""

    def __init__(self, openai_client: AzureOpenAI, similarity_threshold: float = 0.95):
        self.openai = openai_client
        self.threshold = similarity_threshold
        self.cache = []  # (embedding, query, response)

    async def get_embedding(self, text: str) -> list:
        response = await self.openai.embeddings.create(
            input=text,
            model="text-embedding-3-small"
        )
        return response.data[0].embedding

    async def get_or_compute(self, query: str, compute_fn) -> str:
        """Find semantically similar cached query or compute."""
        query_embedding = await self.get_embedding(query)

        for cached_emb, cached_query, cached_response in self.cache:
            similarity = self.cosine_similarity(query_embedding, cached_emb)
            if similarity >= self.threshold:
                return cached_response

        response = await compute_fn(query)
        self.cache.append((query_embedding, query, response))
        return response

    def cosine_similarity(self, a: list, b: list) -> float:
        import numpy as np
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
```

Smart caching can reduce AI costs by 30-50% for applications with repetitive queries.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
