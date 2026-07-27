---
title: "Azure OpenAI Enterprise Patterns: Lessons from Production Deployments"
author: "Michael John Peña"
draft: false
date: 2023-11-01
tags: ["Azure", "OpenAI", "Enterprise", "Architecture", "Best Practices"]

---

I wrote "Azure OpenAI Enterprise Patterns: Lessons from Production Deployments" to share practical, production-minded guidance on this topic.

After months of working with Azure OpenAI in enterprise environments, the patterns that separate solid deployments from problematic ones have become clear — and they're almost never about model capability. Quota limits throttle applications that share a single deployment across teams without consumption monitoring. Missing retry and fallback logic causes hard failures on transient API errors during peak traffic. No per-request cost tracking means the monthly bill comes as a surprise rather than a projection. The infrastructure problems are solvable and well-understood; the organisational problems — getting teams to agree on shared services vs. per-team deployments, establishing consumption governance before it becomes a budget crisis — are where enterprise deployments actually earn their complexity.

## Architecture Patterns for Enterprise

### Multi-Region Deployment

```python
from dataclasses import dataclass
from typing import List, Optional
import random

@dataclass
class AzureOpenAIEndpoint:
    region: str
    endpoint: str
    deployment_name: str
    priority: int
    healthy: bool = True
    current_load: float = 0.0

class MultiRegionClient:
    def __init__(self, endpoints: List[AzureOpenAIEndpoint]):
        self.endpoints = sorted(endpoints, key=lambda x: x.priority)
        self.failover_count = {}

    def get_best_endpoint(self) -> AzureOpenAIEndpoint:
        """Get the best available endpoint based on health and load."""
        healthy_endpoints = [e for e in self.endpoints if e.healthy]

        if not healthy_endpoints:
            raise Exception("No healthy endpoints available")

        # Prefer lower priority (primary) endpoints with low load
        for endpoint in healthy_endpoints:
            if endpoint.current_load < 0.8:  # 80% threshold
                return endpoint

        # All endpoints loaded, use least loaded
        return min(healthy_endpoints, key=lambda x: x.current_load)

    def mark_unhealthy(self, endpoint: AzureOpenAIEndpoint):
        """Mark an endpoint as unhealthy for failover."""
        endpoint.healthy = False
        self.failover_count[endpoint.region] = \
            self.failover_count.get(endpoint.region, 0) + 1

    def health_check(self) -> dict:
        """Return health status of all endpoints."""
        return {
            e.region: {
                "healthy": e.healthy,
                "load": e.current_load,
                "failovers": self.failover_count.get(e.region, 0)
            }
            for e in self.endpoints
        }

# Configure multi-region setup
endpoints = [
    AzureOpenAIEndpoint(
        region="eastus",
        endpoint="https://myoai-eastus.openai.azure.com",
        deployment_name="gpt-4",
        priority=1
    ),
    AzureOpenAIEndpoint(
        region="westeurope",
        endpoint="https://myoai-westeurope.openai.azure.com",
        deployment_name="gpt-4",
        priority=2
    ),
    AzureOpenAIEndpoint(
        region="eastasia",
        endpoint="https://myoai-eastasia.openai.azure.com",
        deployment_name="gpt-4",
        priority=3
    )
]

client = MultiRegionClient(endpoints)
```

### Request Queue with Backpressure

```python
import asyncio
from collections import deque
from datetime import datetime, timedelta
import logging

class RateLimitedQueue:
    def __init__(
        self,
        requests_per_minute: int,
        tokens_per_minute: int,
        max_queue_size: int = 1000
    ):
        self.rpm_limit = requests_per_minute
        self.tpm_limit = tokens_per_minute
        self.max_queue_size = max_queue_size

        self.request_times = deque()
        self.token_counts = deque()
        self.queue = asyncio.Queue(maxsize=max_queue_size)

        self.logger = logging.getLogger(__name__)

    def _clean_old_entries(self):
        """Remove entries older than 1 minute."""
        cutoff = datetime.now() - timedelta(minutes=1)

        while self.request_times and self.request_times[0] < cutoff:
            self.request_times.popleft()

        while self.token_counts and self.token_counts[0][0] < cutoff:
            self.token_counts.popleft()

    def can_process(self, estimated_tokens: int) -> bool:
        """Check if we can process a request without hitting limits."""
        self._clean_old_entries()

        # Check RPM
        if len(self.request_times) >= self.rpm_limit:
            return False

        # Check TPM
        current_tokens = sum(t[1] for t in self.token_counts)
        if current_tokens + estimated_tokens > self.tpm_limit:
            return False

        return True

    def record_request(self, tokens_used: int):
        """Record a completed request."""
        now = datetime.now()
        self.request_times.append(now)
        self.token_counts.append((now, tokens_used))

    async def enqueue(self, request: dict, timeout: float = 30.0) -> bool:
        """Add request to queue with timeout."""
        try:
            await asyncio.wait_for(
                self.queue.put(request),
                timeout=timeout
            )
            return True
        except asyncio.TimeoutError:
            self.logger.warning("Queue full, request rejected")
            return False

    def get_queue_stats(self) -> dict:
        """Get current queue statistics."""
        self._clean_old_entries()
        return {
            "queue_size": self.queue.qsize(),
            "queue_capacity": self.max_queue_size,
            "requests_last_minute": len(self.request_times),
            "tokens_last_minute": sum(t[1] for t in self.token_counts),
            "rpm_remaining": self.rpm_limit - len(self.request_times),
            "tpm_remaining": self.tpm_limit - sum(t[1] for t in self.token_counts)
        }
```

## Caching Strategies

### Semantic Cache for Similar Queries

```python
import hashlib
import json
from typing import Optional, Tuple
import numpy as np

class SemanticCache:
    def __init__(
        self,
        embedding_client,
        similarity_threshold: float = 0.95,
        max_cache_size: int = 10000
    ):
        self.embedding_client = embedding_client
        self.threshold = similarity_threshold
        self.max_size = max_cache_size

        self.cache = {}  # hash -> (embedding, response, hit_count)
        self.embeddings_matrix = None
        self.hash_index = []

    def _get_embedding(self, text: str) -> np.ndarray:
        """Get embedding for text."""
        response = self.embedding_client.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return np.array(response.data[0].embedding)

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def get(self, query: str) -> Optional[Tuple[str, float]]:
        """Try to get a cached response for a semantically similar query."""
        if not self.cache:
            return None

        query_embedding = self._get_embedding(query)

        # Find most similar cached query
        best_similarity = 0
        best_hash = None

        for cached_hash, (cached_embedding, _, _) in self.cache.items():
            similarity = self._cosine_similarity(query_embedding, cached_embedding)
            if similarity > best_similarity:
                best_similarity = similarity
                best_hash = cached_hash

        if best_similarity >= self.threshold and best_hash:
            embedding, response, hit_count = self.cache[best_hash]
            self.cache[best_hash] = (embedding, response, hit_count + 1)
            return response, best_similarity

        return None

    def set(self, query: str, response: str):
        """Cache a query-response pair."""
        query_hash = hashlib.sha256(query.encode()).hexdigest()[:16]
        embedding = self._get_embedding(query)

        # Evict if at capacity (remove least hit entries)
        if len(self.cache) >= self.max_size:
            min_hits_hash = min(self.cache.keys(),
                               key=lambda h: self.cache[h][2])
            del self.cache[min_hits_hash]

        self.cache[query_hash] = (embedding, response, 1)

    def get_stats(self) -> dict:
        """Get cache statistics."""
        if not self.cache:
            return {"size": 0, "total_hits": 0}

        total_hits = sum(entry[2] for entry in self.cache.values())
        return {
            "size": len(self.cache),
            "total_hits": total_hits,
            "avg_hits_per_entry": total_hits / len(self.cache)
        }

# Usage
cache = SemanticCache(openai_client, similarity_threshold=0.92)

# Check cache before calling API
cached = cache.get(user_query)
if cached:
    response, similarity = cached
    print(f"Cache hit with {similarity:.2%} similarity")
else:
    response = call_openai_api(user_query)
    cache.set(user_query, response)
```

## Error Handling and Resilience

### Comprehensive Retry Logic

```python
import time
from functools import wraps
from typing import Callable, Type, Tuple
import random

class RetryConfig:
    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        exponential_base: float = 2.0,
        jitter: bool = True
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter

def retry_with_backoff(
    config: RetryConfig,
    retryable_exceptions: Tuple[Type[Exception], ...] = (Exception,)
):
    """Decorator for retry with exponential backoff."""
    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None

            for attempt in range(config.max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e

                    if attempt == config.max_retries:
                        raise

                    # Calculate delay with exponential backoff
                    delay = min(
                        config.base_delay * (config.exponential_base ** attempt),
                        config.max_delay
                    )

                    # Add jitter to prevent thundering herd
                    if config.jitter:
                        delay = delay * (0.5 + random.random())

                    print(f"Attempt {attempt + 1} failed: {e}. Retrying in {delay:.2f}s")
                    time.sleep(delay)

            raise last_exception
        return wrapper
    return decorator

# Usage
retry_config = RetryConfig(max_retries=3, base_delay=2.0)

@retry_with_backoff(retry_config, retryable_exceptions=(RateLimitError, APIError))
def call_openai(prompt: str) -> str:
    return client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}]
    ).choices[0].message.content
```

## Monitoring and Observability

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List
import statistics

@dataclass
class RequestMetrics:
    timestamp: datetime
    latency_ms: float
    input_tokens: int
    output_tokens: int
    model: str
    success: bool
    error_type: str = None

class OpenAIMetricsCollector:
    def __init__(self):
        self.metrics: List[RequestMetrics] = []
        self.window_size = 1000  # Keep last 1000 requests

    def record(self, metrics: RequestMetrics):
        """Record a request's metrics."""
        self.metrics.append(metrics)
        if len(self.metrics) > self.window_size:
            self.metrics.pop(0)

    def get_summary(self, last_n: int = 100) -> dict:
        """Get summary statistics for recent requests."""
        recent = self.metrics[-last_n:]
        if not recent:
            return {}

        successful = [m for m in recent if m.success]
        failed = [m for m in recent if not m.success]

        latencies = [m.latency_ms for m in successful]

        return {
            "total_requests": len(recent),
            "success_rate": len(successful) / len(recent) * 100,
            "avg_latency_ms": statistics.mean(latencies) if latencies else 0,
            "p50_latency_ms": statistics.median(latencies) if latencies else 0,
            "p95_latency_ms": sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) > 20 else 0,
            "total_input_tokens": sum(m.input_tokens for m in recent),
            "total_output_tokens": sum(m.output_tokens for m in recent),
            "error_breakdown": self._count_errors(failed)
        }

    def _count_errors(self, failed: List[RequestMetrics]) -> Dict[str, int]:
        """Count errors by type."""
        errors = {}
        for m in failed:
            errors[m.error_type] = errors.get(m.error_type, 0) + 1
        return errors

# Usage
collector = OpenAIMetricsCollector()

# After each request
collector.record(RequestMetrics(
    timestamp=datetime.now(),
    latency_ms=234.5,
    input_tokens=150,
    output_tokens=89,
    model="gpt-4",
    success=True
))

# Get dashboard metrics
summary = collector.get_summary(last_n=100)
print(f"Success rate: {summary['success_rate']:.1f}%")
print(f"P95 latency: {summary['p95_latency_ms']:.0f}ms")
```

## Conclusion

Enterprise deployments of Azure OpenAI require careful attention to architecture, resilience, and observability. The patterns shared here come from real-world experience dealing with rate limits, failures, and scale challenges. Start with solid foundations, and your AI applications will be ready for production demands.

