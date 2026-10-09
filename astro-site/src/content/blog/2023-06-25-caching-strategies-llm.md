---
title: "Caching Strategies for LLM Applications"
description: "Effective caching significantly reduces LLM costs and latency. Tomorrow, I will cover response streaming patterns."
author: Michael John Peña
draft: false
date: 2023-06-25
tags:
  - Azure OpenAI
  - Caching
  - Performance
  - Cost Optimization
  - Redis
---

## Caching Challenges with LLMs

```python
caching_challenges = {
    "non_deterministic": "Same input can produce different outputs",
    "semantic_similarity": "Similar prompts might need same response",
    "context_dependence": "Response depends on conversation history",
    "freshness": "Some queries need real-time information"
}
```

## Exact Match Caching

```python
import hashlib
import json
from datetime import datetime, timedelta
import redis

class ExactMatchCache:
    """Cache based on exact prompt match"""

    def __init__(self, redis_url: str, ttl_hours: int = 24):
        self.redis = redis.from_url(redis_url)
        self.ttl = ttl_hours * 3600

    def _generate_key(self, prompt: str, model: str, params: dict) -> str:
        """Generate cache key from request parameters"""
        key_data = {
            "prompt": prompt,
            "model": model,
            "temperature": params.get("temperature", 0.7),
            "max_tokens": params.get("max_tokens")
        }
        key_string = json.dumps(key_data, sort_keys=True)
        return f"llm_cache:{hashlib.sha256(key_string.encode()).hexdigest()}"

    def get(self, prompt: str, model: str, params: dict) -> dict | None:
        """Get cached response"""
        key = self._generate_key(prompt, model, params)
        data = self.redis.get(key)

        if data:
            cached = json.loads(data)
            # Update access time for LRU
            self.redis.expire(key, self.ttl)
            return cached

        return None

    def set(self, prompt: str, model: str, params: dict, response: dict):
        """Cache response"""
        key = self._generate_key(prompt, model, params)
        cache_data = {
            "response": response,
            "cached_at": datetime.utcnow().isoformat(),
            "model": model
        }
        self.redis.setex(key, self.ttl, json.dumps(cache_data))

    def invalidate(self, prompt: str, model: str, params: dict):
        """Remove from cache"""
        key = self._generate_key(prompt, model, params)
        self.redis.delete(key)
```

## Semantic Caching

```python
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

class SemanticCache:
    """Cache based on semantic similarity"""

    def __init__(self, embedding_client, redis_url: str, similarity_threshold: float = 0.95):
        self.embedding_client = embedding_client
        self.redis = redis.from_url(redis_url)
        self.threshold = similarity_threshold
        self.cache_index = "semantic_cache"

    def _get_embedding(self, text: str) -> list:
        """Get embedding for text"""
        response = self.embedding_client.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return response.data[0].embedding

    def get(self, prompt: str) -> dict | None:
        """Find semantically similar cached response"""
        prompt_embedding = self._get_embedding(prompt)

        # Get all cached embeddings (in production, use vector DB)
        cached_keys = self.redis.keys(f"{self.cache_index}:*")

        best_match = None
        best_similarity = 0

        for key in cached_keys:
            data = json.loads(self.redis.get(key))
            cached_embedding = data["embedding"]

            similarity = cosine_similarity(
                [prompt_embedding],
                [cached_embedding]
            )[0][0]

            if similarity > self.threshold and similarity > best_similarity:
                best_similarity = similarity
                best_match = data

        if best_match:
            return {
                "response": best_match["response"],
                "similarity": best_similarity,
                "original_prompt": best_match["prompt"]
            }

        return None

    def set(self, prompt: str, response: dict):
        """Cache with embedding"""
        embedding = self._get_embedding(prompt)
        key = f"{self.cache_index}:{hashlib.md5(prompt.encode()).hexdigest()}"

        cache_data = {
            "prompt": prompt,
            "embedding": embedding,
            "response": response,
            "cached_at": datetime.utcnow().isoformat()
        }

        self.redis.setex(key, 86400, json.dumps(cache_data))  # 24 hour TTL
```

## Conversation-Aware Caching

```python
class ConversationCache:
    """Cache that considers conversation context"""

    def __init__(self, redis_url: str):
        self.redis = redis.from_url(redis_url)

    def _context_hash(self, messages: list, depth: int = 3) -> str:
        """Hash recent conversation context"""
        recent = messages[-depth:] if len(messages) > depth else messages
        context_str = json.dumps([m["content"][:100] for m in recent])
        return hashlib.md5(context_str.encode()).hexdigest()

    def get(self, prompt: str, context: list) -> dict | None:
        """Get cached response considering context"""
        context_hash = self._context_hash(context)
        key = f"conv_cache:{context_hash}:{hashlib.md5(prompt.encode()).hexdigest()}"
        data = self.redis.get(key)
        return json.loads(data) if data else None

    def set(self, prompt: str, context: list, response: dict, ttl: int = 3600):
        """Cache with context awareness"""
        context_hash = self._context_hash(context)
        key = f"conv_cache:{context_hash}:{hashlib.md5(prompt.encode()).hexdigest()}"
        self.redis.setex(key, ttl, json.dumps(response))
```

## Tiered Caching

```python
class TieredCache:
    """Multi-tier caching strategy"""

    def __init__(self, embedding_client, redis_url: str):
        self.exact_cache = ExactMatchCache(redis_url)
        self.semantic_cache = SemanticCache(embedding_client, redis_url)
        self.stats = {"exact_hits": 0, "semantic_hits": 0, "misses": 0}

    def get(self, prompt: str, model: str, params: dict) -> dict | None:
        """Try caches in order of speed"""

        # Tier 1: Exact match (fastest)
        exact = self.exact_cache.get(prompt, model, params)
        if exact:
            self.stats["exact_hits"] += 1
            return {"source": "exact", **exact}

        # Tier 2: Semantic match (slower but broader)
        semantic = self.semantic_cache.get(prompt)
        if semantic:
            self.stats["semantic_hits"] += 1
            return {"source": "semantic", **semantic}

        self.stats["misses"] += 1
        return None

    def set(self, prompt: str, model: str, params: dict, response: dict):
        """Store in all applicable caches"""
        # Always store in exact cache
        self.exact_cache.set(prompt, model, params, response)

        # Store in semantic cache for broader matching
        self.semantic_cache.set(prompt, response)

    def get_stats(self) -> dict:
        total = sum(self.stats.values())
        return {
            **self.stats,
            "hit_rate": (self.stats["exact_hits"] + self.stats["semantic_hits"]) / total if total else 0
        }
```

## Cache-Aware LLM Client

```python
class CachedLLMClient:
    """LLM client with integrated caching"""

    def __init__(self, client, cache: TieredCache):
        self.client = client
        self.cache = cache

    def chat(
        self,
        messages: list,
        model: str = "gpt-4",
        use_cache: bool = True,
        cache_ttl: int = 3600,
        **kwargs
    ) -> dict:
        """Chat with caching"""

        prompt = messages[-1]["content"] if messages else ""

        # Check cache
        if use_cache:
            cached = self.cache.get(prompt, model, kwargs)
            if cached:
                return {
                    "response": cached["response"],
                    "cached": True,
                    "cache_source": cached.get("source"),
                    "cost": 0
                }

        # Make API call
        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            **kwargs
        )

        result = response.choices[0].message.content

        # Cache response
        if use_cache:
            self.cache.set(prompt, model, kwargs, {"content": result})

        return {
            "response": result,
            "cached": False,
            "tokens": {
                "input": response.usage.prompt_tokens,
                "output": response.usage.completion_tokens
            }
        }
```

## Cache Warming

```python
class CacheWarmer:
    """Pre-populate cache with common queries"""

    def __init__(self, client, cache):
        self.client = client
        self.cache = cache

    def warm_from_logs(self, query_logs: list, top_n: int = 100):
        """Warm cache from historical queries"""
        from collections import Counter

        # Find most common queries
        query_counts = Counter(log["query"] for log in query_logs)
        common_queries = [q for q, _ in query_counts.most_common(top_n)]

        for query in common_queries:
            # Check if already cached
            if not self.cache.get(query, "gpt-4", {}):
                # Generate and cache
                response = self.client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": query}]
                )
                self.cache.set(query, "gpt-4", {}, {"content": response.choices[0].message.content})

    def warm_faq(self, faqs: list):
        """Pre-cache FAQ responses"""
        for faq in faqs:
            self.cache.set(
                faq["question"],
                "gpt-4",
                {},
                {"content": faq["answer"]}
            )
```

Effective caching significantly reduces LLM costs and latency. Tomorrow, I will cover response streaming patterns.

## Resources

- [Redis Caching](https://redis.io/docs/manual/patterns/)
- [Semantic Caching](https://python.langchain.com/docs/integrations/cache/)
