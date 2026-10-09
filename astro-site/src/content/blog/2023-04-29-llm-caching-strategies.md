---
title: "LLM Caching Strategies: Reducing Costs and Latency"
description: "LLM caching strategies are essential for production systems. By combining exact matching, semantic similarity, and intelligent invalidation, you can…"
author: Michael John Pena
draft: false
date: 2023-04-29
tags:
  - AI
  - LLM
  - Caching
  - Performance
  - Cost Optimization
---

## Semantic Cache Implementation

```python
import hashlib
import json
from dataclasses import dataclass
from typing import Optional, List, Dict
from datetime import datetime, timedelta
import numpy as np

@dataclass
class CacheEntry:
    key: str
    prompt: str
    response: str
    embedding: List[float]
    created_at: datetime
    access_count: int
    model: str
    metadata: Dict

class SemanticCache:
    """Cache LLM responses with semantic similarity matching."""

    def __init__(
        self,
        embedding_client,
        similarity_threshold: float = 0.95,
        ttl_hours: int = 24
    ):
        self.embedding_client = embedding_client
        self.similarity_threshold = similarity_threshold
        self.ttl = timedelta(hours=ttl_hours)
        self.cache: Dict[str, CacheEntry] = {}
        self.embeddings_index: List[tuple] = []  # (key, embedding)

    async def get(
        self,
        prompt: str,
        model: str = None
    ) -> Optional[str]:
        """Get cached response for prompt."""

        # Check exact match first
        exact_key = self._compute_key(prompt, model)
        if exact_key in self.cache:
            entry = self.cache[exact_key]
            if self._is_valid(entry):
                entry.access_count += 1
                return entry.response

        # Check semantic similarity
        prompt_embedding = await self._get_embedding(prompt)
        similar = self._find_similar(prompt_embedding, model)

        if similar:
            similar.access_count += 1
            return similar.response

        return None

    async def set(
        self,
        prompt: str,
        response: str,
        model: str = None,
        metadata: Dict = None
    ):
        """Cache a prompt-response pair."""

        key = self._compute_key(prompt, model)
        embedding = await self._get_embedding(prompt)

        entry = CacheEntry(
            key=key,
            prompt=prompt,
            response=response,
            embedding=embedding,
            created_at=datetime.utcnow(),
            access_count=1,
            model=model or "default",
            metadata=metadata or {}
        )

        self.cache[key] = entry
        self.embeddings_index.append((key, embedding))

    def _compute_key(self, prompt: str, model: str) -> str:
        """Compute cache key."""
        content = f"{model}:{prompt}"
        return hashlib.sha256(content.encode()).hexdigest()

    async def _get_embedding(self, text: str) -> List[float]:
        """Get embedding for text."""
        response = await self.embedding_client.create_embeddings(
            input=text,
            model="text-embedding-ada-002"
        )
        return response.data[0].embedding

    def _find_similar(
        self,
        query_embedding: List[float],
        model: str = None
    ) -> Optional[CacheEntry]:
        """Find semantically similar cached entry."""

        if not self.embeddings_index:
            return None

        query_vec = np.array(query_embedding)
        best_match = None
        best_similarity = self.similarity_threshold

        for key, embedding in self.embeddings_index:
            entry = self.cache.get(key)
            if not entry or not self._is_valid(entry):
                continue

            if model and entry.model != model:
                continue

            # Cosine similarity
            cache_vec = np.array(embedding)
            similarity = np.dot(query_vec, cache_vec) / (
                np.linalg.norm(query_vec) * np.linalg.norm(cache_vec)
            )

            if similarity > best_similarity:
                best_similarity = similarity
                best_match = entry

        return best_match

    def _is_valid(self, entry: CacheEntry) -> bool:
        """Check if cache entry is still valid."""
        return datetime.utcnow() - entry.created_at < self.ttl

    def clear_expired(self):
        """Clear expired entries."""
        expired_keys = [
            key for key, entry in self.cache.items()
            if not self._is_valid(entry)
        ]
        for key in expired_keys:
            del self.cache[key]
            self.embeddings_index = [
                (k, e) for k, e in self.embeddings_index if k != key
            ]

    def get_stats(self) -> dict:
        """Get cache statistics."""
        valid_entries = [e for e in self.cache.values() if self._is_valid(e)]
        return {
            "total_entries": len(self.cache),
            "valid_entries": len(valid_entries),
            "total_accesses": sum(e.access_count for e in valid_entries),
            "avg_accesses": np.mean([e.access_count for e in valid_entries]) if valid_entries else 0
        }
```

## Multi-Tier Cache Architecture

```python
class MultiTierCache:
    """Multi-tier caching with different strategies per tier."""

    def __init__(self, config: dict):
        self.config = config
        self._init_tiers()

    def _init_tiers(self):
        """Initialize cache tiers."""
        # Tier 1: In-memory exact match (fastest)
        self.l1_cache: Dict[str, dict] = {}
        self.l1_max_size = self.config.get("l1_max_size", 1000)

        # Tier 2: Redis semantic cache (fast, shared)
        import redis
        self.redis = redis.Redis(
            host=self.config.get("redis_host", "localhost"),
            port=self.config.get("redis_port", 6379)
        )

        # Tier 3: Vector database (comprehensive)
        self.vector_db = self.config.get("vector_db_client")

    async def get(self, prompt: str, model: str = None) -> Optional[dict]:
        """Get from cache, checking all tiers."""

        key = self._compute_key(prompt, model)

        # L1: Memory
        if key in self.l1_cache:
            return self.l1_cache[key]

        # L2: Redis
        redis_result = self.redis.get(f"llm_cache:{key}")
        if redis_result:
            result = json.loads(redis_result)
            self._promote_to_l1(key, result)
            return result

        # L3: Vector DB semantic search
        embedding = await self._get_embedding(prompt)
        similar = await self._search_vector_db(embedding, model)

        if similar:
            self._promote_to_l1(key, similar)
            self._promote_to_l2(key, similar)
            return similar

        return None

    async def set(
        self,
        prompt: str,
        response: str,
        model: str = None,
        ttl_seconds: int = 86400
    ):
        """Set value in all cache tiers."""

        key = self._compute_key(prompt, model)
        embedding = await self._get_embedding(prompt)

        value = {
            "prompt": prompt,
            "response": response,
            "model": model,
            "embedding": embedding,
            "created_at": datetime.utcnow().isoformat()
        }

        # L1
        self._set_l1(key, value)

        # L2
        self.redis.setex(
            f"llm_cache:{key}",
            ttl_seconds,
            json.dumps(value, default=str)
        )

        # L3
        await self._store_vector_db(key, value)

    def _compute_key(self, prompt: str, model: str) -> str:
        """Compute cache key."""
        content = f"{model}:{prompt}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def _promote_to_l1(self, key: str, value: dict):
        """Promote entry to L1 cache."""
        if len(self.l1_cache) >= self.l1_max_size:
            # Evict oldest
            oldest_key = min(
                self.l1_cache.keys(),
                key=lambda k: self.l1_cache[k].get("accessed_at", "")
            )
            del self.l1_cache[oldest_key]

        value["accessed_at"] = datetime.utcnow().isoformat()
        self.l1_cache[key] = value

    def _promote_to_l2(self, key: str, value: dict):
        """Promote entry to L2 cache."""
        self.redis.setex(
            f"llm_cache:{key}",
            86400,  # 24 hours
            json.dumps(value, default=str)
        )

    def _set_l1(self, key: str, value: dict):
        """Set L1 cache with eviction."""
        if len(self.l1_cache) >= self.l1_max_size:
            # LRU eviction
            oldest_key = min(
                self.l1_cache.keys(),
                key=lambda k: self.l1_cache[k].get("accessed_at", "")
            )
            del self.l1_cache[oldest_key]

        value["accessed_at"] = datetime.utcnow().isoformat()
        self.l1_cache[key] = value

    async def _search_vector_db(
        self,
        embedding: List[float],
        model: str = None,
        threshold: float = 0.95
    ) -> Optional[dict]:
        """Search vector DB for similar prompts."""
        if not self.vector_db:
            return None

        results = await self.vector_db.search(
            vector=embedding,
            top_k=1,
            filter={"model": model} if model else None
        )

        if results and results[0].score >= threshold:
            return results[0].metadata

        return None

    async def _store_vector_db(self, key: str, value: dict):
        """Store in vector DB."""
        if not self.vector_db:
            return

        await self.vector_db.upsert(
            id=key,
            vector=value["embedding"],
            metadata={
                "prompt": value["prompt"],
                "response": value["response"],
                "model": value["model"],
                "created_at": value["created_at"]
            }
        )
```

## Cache-Aware LLM Client

```python
class CachedLLMClient:
    """LLM client with built-in caching."""

    def __init__(
        self,
        llm_client,
        cache: SemanticCache,
        cache_config: dict = None
    ):
        self.llm = llm_client
        self.cache = cache
        self.config = cache_config or {}

        # Metrics
        self.hits = 0
        self.misses = 0
        self.total_tokens_saved = 0

    async def chat_completion(
        self,
        messages: List[dict],
        model: str = "gpt-4",
        temperature: float = 0.7,
        use_cache: bool = True,
        cache_ttl: int = None
    ) -> dict:
        """Execute chat completion with caching."""

        # Only cache deterministic requests
        if temperature > 0.3 or not use_cache:
            return await self._call_llm(messages, model, temperature)

        # Build cache key from messages
        prompt = self._messages_to_prompt(messages)

        # Check cache
        cached = await self.cache.get(prompt, model)
        if cached:
            self.hits += 1
            return {
                "content": cached,
                "cached": True,
                "model": model
            }

        # Call LLM
        self.misses += 1
        response = await self._call_llm(messages, model, temperature)

        # Cache response
        await self.cache.set(
            prompt,
            response["content"],
            model,
            {"temperature": temperature, "tokens": response.get("tokens", 0)}
        )

        self.total_tokens_saved += response.get("tokens", 0)

        return response

    def _messages_to_prompt(self, messages: List[dict]) -> str:
        """Convert messages to cacheable prompt string."""
        return json.dumps(messages, sort_keys=True)

    async def _call_llm(
        self,
        messages: List[dict],
        model: str,
        temperature: float
    ) -> dict:
        """Call underlying LLM."""
        response = await self.llm.chat_completion(
            model=model,
            messages=messages,
            temperature=temperature
        )
        return {
            "content": response.content,
            "cached": False,
            "model": model,
            "tokens": response.usage.total_tokens if hasattr(response, "usage") else 0
        }

    def get_metrics(self) -> dict:
        """Get cache metrics."""
        total = self.hits + self.misses
        return {
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": self.hits / total if total > 0 else 0,
            "tokens_saved": self.total_tokens_saved,
            "estimated_cost_saved": self.total_tokens_saved * 0.00003  # Approximate
        }

    def reset_metrics(self):
        """Reset metrics counters."""
        self.hits = 0
        self.misses = 0
        self.total_tokens_saved = 0
```

## Intelligent Cache Invalidation

```python
class CacheInvalidationManager:
    """Manage cache invalidation strategies."""

    def __init__(self, cache: SemanticCache):
        self.cache = cache
        self.invalidation_rules = []

    def add_rule(
        self,
        name: str,
        condition: callable,
        action: str = "invalidate"  # invalidate, refresh, expire
    ):
        """Add invalidation rule."""
        self.invalidation_rules.append({
            "name": name,
            "condition": condition,
            "action": action
        })

    async def evaluate_rules(self, context: dict):
        """Evaluate all rules and take actions."""
        for rule in self.invalidation_rules:
            if rule["condition"](context):
                if rule["action"] == "invalidate":
                    await self._invalidate_by_context(context)
                elif rule["action"] == "refresh":
                    await self._refresh_by_context(context)
                elif rule["action"] == "expire":
                    await self._expire_by_context(context)

    async def _invalidate_by_context(self, context: dict):
        """Invalidate cache entries matching context."""
        keys_to_remove = []

        for key, entry in self.cache.cache.items():
            if self._matches_context(entry, context):
                keys_to_remove.append(key)

        for key in keys_to_remove:
            del self.cache.cache[key]

    def _matches_context(self, entry: CacheEntry, context: dict) -> bool:
        """Check if entry matches context for invalidation."""
        for key, value in context.items():
            if key == "model" and entry.model != value:
                continue
            if key == "older_than":
                if datetime.utcnow() - entry.created_at < value:
                    return False
            if key == "prompt_contains":
                if value.lower() not in entry.prompt.lower():
                    return False
        return True

    async def invalidate_by_pattern(self, pattern: str):
        """Invalidate entries matching pattern."""
        import re

        keys_to_remove = [
            key for key, entry in self.cache.cache.items()
            if re.search(pattern, entry.prompt)
        ]

        for key in keys_to_remove:
            del self.cache.cache[key]

        return len(keys_to_remove)

    async def invalidate_by_topic(self, topic: str, threshold: float = 0.8):
        """Invalidate entries semantically related to topic."""
        topic_embedding = await self.cache._get_embedding(topic)

        keys_to_remove = []

        for key, entry in self.cache.cache.items():
            entry_embedding = np.array(entry.embedding)
            topic_vec = np.array(topic_embedding)

            similarity = np.dot(entry_embedding, topic_vec) / (
                np.linalg.norm(entry_embedding) * np.linalg.norm(topic_vec)
            )

            if similarity >= threshold:
                keys_to_remove.append(key)

        for key in keys_to_remove:
            del self.cache.cache[key]

        return len(keys_to_remove)

# Usage
invalidation = CacheInvalidationManager(cache)

# Add rules
invalidation.add_rule(
    "stale_data",
    condition=lambda ctx: ctx.get("data_updated", False),
    action="invalidate"
)

invalidation.add_rule(
    "model_updated",
    condition=lambda ctx: ctx.get("model_version_changed", False),
    action="invalidate"
)

# Evaluate on events
await invalidation.evaluate_rules({"data_updated": True})
```

## Caching for Streaming Responses

```python
class StreamingCache:
    """Cache streaming LLM responses."""

    def __init__(self, base_cache: SemanticCache):
        self.cache = base_cache
        self.partial_responses: Dict[str, List[str]] = {}

    async def get_stream(
        self,
        prompt: str,
        model: str = None
    ):
        """Get cached response as stream."""
        cached = await self.cache.get(prompt, model)

        if cached:
            # Yield cached response in chunks
            words = cached.split()
            for i in range(0, len(words), 5):
                chunk = " ".join(words[i:i+5])
                yield {"content": chunk, "cached": True}
                await asyncio.sleep(0.05)  # Simulate streaming
        else:
            yield None  # Indicate cache miss

    async def stream_and_cache(
        self,
        llm_stream,
        prompt: str,
        model: str = None
    ):
        """Stream response while caching."""
        key = self.cache._compute_key(prompt, model)
        self.partial_responses[key] = []

        async for chunk in llm_stream:
            self.partial_responses[key].append(chunk["content"])
            yield chunk

        # Cache complete response
        complete_response = "".join(self.partial_responses[key])
        await self.cache.set(prompt, complete_response, model)
        del self.partial_responses[key]

# Usage
streaming_cache = StreamingCache(semantic_cache)

# Check cache first
async for chunk in streaming_cache.get_stream(prompt, model):
    if chunk is None:
        # Cache miss, stream from LLM and cache
        llm_stream = llm_client.stream_completion(prompt)
        async for chunk in streaming_cache.stream_and_cache(llm_stream, prompt, model):
            print(chunk["content"], end="", flush=True)
    else:
        print(chunk["content"], end="", flush=True)
```

LLM caching strategies are essential for production systems. By combining exact matching, semantic similarity, and intelligent invalidation, you can dramatically reduce costs while maintaining response quality.
