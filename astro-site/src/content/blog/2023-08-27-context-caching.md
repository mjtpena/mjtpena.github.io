---
title: "Context Caching for LLM Applications"
author: Michael John Peña
draft: false
date: 2023-08-27
tags:
  - Caching
  - LLM
  - Performance
  - Optimization
---

## Caching Strategies

```python
caching_strategies = {
    "exact_match": "Cache identical prompts",
    "semantic": "Cache similar prompts",
    "prefix": "Cache shared conversation context",
    "embedding": "Cache vector embeddings"
}
```

## Basic Response Caching

```python
import hashlib
import json
from functools import lru_cache
import redis

class ResponseCache:
    def __init__(self, redis_client, ttl=3600):
        self.redis = redis_client
        self.ttl = ttl
        self.stats = {"hits": 0, "misses": 0}

    def _make_key(self, messages, model, params):
        content = json.dumps({
            "messages": messages,
            "model": model,
            "params": params
        }, sort_keys=True)
        return f"llm:{hashlib.sha256(content.encode()).hexdigest()}"

    def get(self, messages, model, params):
        key = self._make_key(messages, model, params)
        cached = self.redis.get(key)
        if cached:
            self.stats["hits"] += 1
            return json.loads(cached)
        self.stats["misses"] += 1
        return None

    def set(self, messages, model, params, response):
        key = self._make_key(messages, model, params)
        self.redis.setex(key, self.ttl, json.dumps(response))

    def hit_rate(self):
        total = self.stats["hits"] + self.stats["misses"]
        return self.stats["hits"] / total if total > 0 else 0
```

## Semantic Caching

```python
from sentence_transformers import SentenceTransformer, util
import numpy as np

class SemanticCache:
    def __init__(self, similarity_threshold=0.95):
        self.model = SentenceTransformer("all-MiniLM-L6-v2")
        self.threshold = similarity_threshold
        self.cache = []  # List of (embedding, prompt, response)

    def get(self, prompt):
        if not self.cache:
            return None

        prompt_embedding = self.model.encode(prompt)
        embeddings = np.array([c[0] for c in self.cache])

        similarities = util.cos_sim(prompt_embedding, embeddings)[0]
        max_sim = similarities.max().item()
        max_idx = similarities.argmax().item()

        if max_sim >= self.threshold:
            return self.cache[max_idx][2]  # Return cached response
        return None

    def set(self, prompt, response):
        embedding = self.model.encode(prompt)
        self.cache.append((embedding, prompt, response))

        # Limit cache size
        if len(self.cache) > 10000:
            self.cache = self.cache[-5000:]
```

## Prefix Caching for Conversations

```python
class ConversationCache:
    """Cache shared conversation prefixes."""

    def __init__(self):
        self.prefix_cache = {}

    def get_prefix_response(self, messages):
        """Check if prefix of conversation is cached."""
        for i in range(len(messages), 0, -1):
            prefix = self._hash_messages(messages[:i])
            if prefix in self.prefix_cache:
                return {
                    "cached_prefix_length": i,
                    "cached_response": self.prefix_cache[prefix]
                }
        return None

    def cache_conversation(self, messages, response):
        """Cache entire conversation and prefixes."""
        full_hash = self._hash_messages(messages)
        self.prefix_cache[full_hash] = response

    def _hash_messages(self, messages):
        content = json.dumps(messages, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()

    def get_continuation_prompt(self, messages, cached_prefix_length):
        """Get only new messages after cached prefix."""
        return messages[cached_prefix_length:]
```

## Embedding Cache

```python
class EmbeddingCache:
    """Cache embeddings to avoid recomputation."""

    def __init__(self, redis_client, ttl=86400):
        self.redis = redis_client
        self.ttl = ttl
        self.model = None

    def get_embedding(self, text, model_name="text-embedding-ada-002"):
        key = f"emb:{model_name}:{hashlib.sha256(text.encode()).hexdigest()}"

        cached = self.redis.get(key)
        if cached:
            return json.loads(cached)

        # Compute embedding
        embedding = self._compute_embedding(text, model_name)
        self.redis.setex(key, self.ttl, json.dumps(embedding))

        return embedding

    def get_embeddings_batch(self, texts, model_name="text-embedding-ada-002"):
        """Batch embedding with caching."""
        results = [None] * len(texts)
        to_compute = []
        to_compute_indices = []

        for i, text in enumerate(texts):
            cached = self.get_embedding(text, model_name)
            if cached:
                results[i] = cached
            else:
                to_compute.append(text)
                to_compute_indices.append(i)

        if to_compute:
            new_embeddings = self._compute_embeddings_batch(to_compute, model_name)
            for i, emb in zip(to_compute_indices, new_embeddings):
                results[i] = emb
                self.redis.setex(
                    f"emb:{model_name}:{hashlib.sha256(to_compute[to_compute_indices.index(i)].encode()).hexdigest()}",
                    self.ttl,
                    json.dumps(emb)
                )

        return results
```

## Multi-Level Caching

```python
class MultiLevelCache:
    """L1 (memory) + L2 (Redis) caching."""

    def __init__(self, redis_client, l1_size=1000, l2_ttl=3600):
        self.l1 = {}
        self.l1_order = []
        self.l1_size = l1_size
        self.l2 = redis_client
        self.l2_ttl = l2_ttl

    def get(self, key):
        # Check L1
        if key in self.l1:
            return self.l1[key]

        # Check L2
        cached = self.l2.get(key)
        if cached:
            value = json.loads(cached)
            self._add_to_l1(key, value)
            return value

        return None

    def set(self, key, value):
        self._add_to_l1(key, value)
        self.l2.setex(key, self.l2_ttl, json.dumps(value))

    def _add_to_l1(self, key, value):
        if key not in self.l1:
            if len(self.l1) >= self.l1_size:
                oldest = self.l1_order.pop(0)
                del self.l1[oldest]
            self.l1_order.append(key)
        self.l1[key] = value
```

## Cache Invalidation

```python
class CacheWithInvalidation:
    def __init__(self, redis_client):
        self.redis = redis_client

    def invalidate_by_prefix(self, prefix):
        """Invalidate all keys with prefix."""
        keys = self.redis.keys(f"{prefix}*")
        if keys:
            self.redis.delete(*keys)

    def invalidate_by_tag(self, tag):
        """Invalidate all entries with tag."""
        tagged_keys = self.redis.smembers(f"tag:{tag}")
        if tagged_keys:
            self.redis.delete(*tagged_keys)
            self.redis.delete(f"tag:{tag}")

    def set_with_tags(self, key, value, tags, ttl=3600):
        self.redis.setex(key, ttl, json.dumps(value))
        for tag in tags:
            self.redis.sadd(f"tag:{tag}", key)
```

Tomorrow we'll explore conversation summarization techniques.

## Resources

- [Redis Caching](https://redis.io/docs/manual/client-side-caching/)
- [Semantic Search](https://www.sbert.net/docs/usage/semantic_textual_similarity.html)
- [LLM Caching Patterns](https://python.langchain.com/docs/modules/memory/)
