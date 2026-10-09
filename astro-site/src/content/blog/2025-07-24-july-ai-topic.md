---
title: "Implementing Semantic Caching for LLM Applications"
description: "Use Redis Vector Search for efficient similarity matching at scale. Tune the similarity threshold based on your use case - higher values ensure more precise…"
author: Michael John Peña
draft: false
date: 2025-07-24
tags:
  - Caching
  - LLM
  - Performance
  - Redis
  - Python
---

## Architecture Overview

The semantic cache uses vector similarity to find cached responses:

```python
import redis
import numpy as np
from openai import AzureOpenAI
import json
import hashlib

class SemanticCache:
    def __init__(
        self,
        openai_client: AzureOpenAI,
        redis_client: redis.Redis,
        similarity_threshold: float = 0.95
    ):
        self.llm = openai_client
        self.redis = redis_client
        self.threshold = similarity_threshold
        self.embedding_model = "text-embedding-3-small"

    async def get_embedding(self, text: str) -> list[float]:
        response = await self.llm.embeddings.create(
            model=self.embedding_model,
            input=text
        )
        return response.data[0].embedding

    def cosine_similarity(self, a: list[float], b: list[float]) -> float:
        a, b = np.array(a), np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    async def get_cached_response(self, query: str) -> str | None:
        query_embedding = await self.get_embedding(query)

        # Search cached embeddings
        cached_keys = self.redis.keys("cache:embedding:*")

        for key in cached_keys:
            cached_data = json.loads(self.redis.get(key))
            similarity = self.cosine_similarity(
                query_embedding,
                cached_data["embedding"]
            )

            if similarity >= self.threshold:
                # Update hit count for analytics
                self.redis.hincrby("cache:stats", "hits", 1)
                return cached_data["response"]

        self.redis.hincrby("cache:stats", "misses", 1)
        return None

    async def cache_response(self, query: str, response: str):
        embedding = await self.get_embedding(query)
        cache_key = f"cache:embedding:{hashlib.md5(query.encode()).hexdigest()}"

        self.redis.setex(
            cache_key,
            3600 * 24,  # 24 hour TTL
            json.dumps({
                "query": query,
                "embedding": embedding,
                "response": response
            })
        )
```

## Integration with LLM Calls

Wrap your LLM calls to check cache first:

```python
async def cached_completion(self, query: str, **kwargs) -> str:
    # Check cache
    cached = await self.get_cached_response(query)
    if cached:
        return cached

    # Call LLM
    response = await self.llm.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": query}],
        **kwargs
    )

    result = response.choices[0].message.content

    # Cache for future use
    await self.cache_response(query, result)

    return result
```

## Production Considerations

Use Redis Vector Search for efficient similarity matching at scale. Tune the similarity threshold based on your use case - higher values ensure more precise matches, lower values increase cache hit rates.
