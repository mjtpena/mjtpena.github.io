---
title: "Scaling AI Systems: From Prototype to Enterprise"
author: Michael John Peña
draft: false
date: 2024-12-07
tags:
  - AI
  - Scaling
  - Architecture
  - Performance
  - Enterprise

---

I wrote "Scaling AI Systems: From Prototype to Enterprise" to share practical, production-minded guidance on this topic.

## The Scaling Journey

```
Prototype (1-10 users)
    ↓ Single deployment, no caching
Pilot (10-100 users)
    ↓ Add caching, basic monitoring
Production (100-1K users)
    ↓ Multiple deployments, load balancing
Scale (1K-10K users)
    ↓ Global distribution, advanced caching
Enterprise (10K+ users)
    ↓ Full platform, optimization at every layer
```

## Pattern 1: Request Queuing and Prioritization

```python
import asyncio
from dataclasses import dataclass
from enum import Enum
from heapq import heappush, heappop

class Priority(Enum):
    CRITICAL = 1  # Customer-facing, real-time
    HIGH = 2      # Important but can wait seconds
    NORMAL = 3    # Standard requests
    LOW = 4       # Background, batch
    BULK = 5      # Lowest priority, batch jobs

@dataclass
class AIRequest:
    id: str
    priority: Priority
    payload: dict
    created_at: float
    deadline: float = None

    def __lt__(self, other):
        # Priority first, then FIFO
        if self.priority.value != other.priority.value:
            return self.priority.value < other.priority.value
        return self.created_at < other.created_at

class PriorityRequestQueue:
    """Priority-based request queue with deadline awareness."""

    def __init__(self, max_concurrent: int = 100):
        self.queue = []
        self.max_concurrent = max_concurrent
        self.active_count = 0
        self.semaphore = asyncio.Semaphore(max_concurrent)

    async def enqueue(self, request: AIRequest):
        # Check if deadline already passed
        if request.deadline and time.time() > request.deadline:
            return {"status": "expired", "request_id": request.id}

        heappush(self.queue, request)
        return {"status": "queued", "position": len(self.queue)}

    async def process_next(self):
        async with self.semaphore:
            if not self.queue:
                return None

            request = heappop(self.queue)

            # Skip expired requests
            if request.deadline and time.time() > request.deadline:
                return {"status": "expired", "request_id": request.id}

            result = await self.execute(request)
            return result

    async def run_processor(self, num_workers: int = 10):
        """Run multiple workers processing the queue."""
        workers = [
            asyncio.create_task(self.worker(i))
            for i in range(num_workers)
        ]
        await asyncio.gather(*workers)

    async def worker(self, worker_id: int):
        while True:
            result = await self.process_next()
            if result:
                await self.publish_result(result)
            else:
                await asyncio.sleep(0.1)
```

## Pattern 2: Multi-Region Deployment

```python
class GlobalAIRouter:
    """Route requests to optimal region."""

    def __init__(self):
        self.regions = {
            "eastus": {
                "endpoint": "https://ai-eastus.openai.azure.com",
                "capacity_tpm": 80000,
                "current_load": 0.3
            },
            "westus": {
                "endpoint": "https://ai-westus.openai.azure.com",
                "capacity_tpm": 80000,
                "current_load": 0.5
            },
            "westeurope": {
                "endpoint": "https://ai-westeurope.openai.azure.com",
                "capacity_tpm": 60000,
                "current_load": 0.4
            },
            "eastasia": {
                "endpoint": "https://ai-eastasia.openai.azure.com",
                "capacity_tpm": 40000,
                "current_load": 0.2
            }
        }

    async def route_request(self, request, user_region: str) -> str:
        # Strategy 1: Prefer user's region if capacity available
        if user_region in self.regions:
            region = self.regions[user_region]
            if region["current_load"] < 0.8:
                return user_region

        # Strategy 2: Find lowest load region
        available = [
            (name, r) for name, r in self.regions.items()
            if r["current_load"] < 0.9
        ]

        if not available:
            raise CapacityException("All regions at capacity")

        # Sort by load, prefer closer regions
        available.sort(key=lambda x: (
            x[1]["current_load"],
            self.region_distance(user_region, x[0])
        ))

        return available[0][0]

    def region_distance(self, from_region: str, to_region: str) -> int:
        # Simplified distance scoring
        distances = {
            ("eastus", "westus"): 1,
            ("eastus", "westeurope"): 2,
            ("eastus", "eastasia"): 3,
            # ... more combinations
        }
        key = tuple(sorted([from_region, to_region]))
        return distances.get(key, 2)
```

## Pattern 3: Intelligent Caching

```python
import hashlib
import numpy as np
from typing import Optional

class SemanticCache:
    """Cache with semantic similarity matching."""

    def __init__(self, similarity_threshold: float = 0.95):
        self.cache = {}  # hash -> response
        self.embeddings = {}  # hash -> embedding
        self.threshold = similarity_threshold
        self.embedding_model = EmbeddingModel()

    async def get(self, query: str) -> Optional[dict]:
        # Exact match first
        query_hash = self.hash_query(query)
        if query_hash in self.cache:
            return {"response": self.cache[query_hash], "cache_type": "exact"}

        # Semantic match
        query_embedding = await self.embedding_model.embed(query)

        best_match = None
        best_similarity = 0

        for cached_hash, cached_embedding in self.embeddings.items():
            similarity = self.cosine_similarity(query_embedding, cached_embedding)
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = cached_hash

        if best_match and best_similarity >= self.threshold:
            return {
                "response": self.cache[best_match],
                "cache_type": "semantic",
                "similarity": best_similarity
            }

        return None

    async def set(self, query: str, response: str, ttl: int = 3600):
        query_hash = self.hash_query(query)
        query_embedding = await self.embedding_model.embed(query)

        self.cache[query_hash] = response
        self.embeddings[query_hash] = query_embedding

        # Set expiration
        asyncio.create_task(self.expire_after(query_hash, ttl))

    def hash_query(self, query: str) -> str:
        return hashlib.md5(query.encode()).hexdigest()

    def cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Cache hit rates we achieved:
# - Exact match: 15-20%
# - Semantic match: Additional 25-35%
# - Total: 40-55% cache hit rate
```

## Pattern 4: Request Batching

```python
class RequestBatcher:
    """Batch multiple requests for efficiency."""

    def __init__(self, max_batch_size: int = 32, max_wait_ms: int = 100):
        self.max_batch_size = max_batch_size
        self.max_wait_ms = max_wait_ms
        self.pending = []
        self.lock = asyncio.Lock()

    async def add_request(self, request: dict) -> asyncio.Future:
        """Add request to batch, return future for result."""
        future = asyncio.Future()

        async with self.lock:
            self.pending.append({"request": request, "future": future})

            if len(self.pending) >= self.max_batch_size:
                # Batch is full, process immediately
                await self.process_batch()
            elif len(self.pending) == 1:
                # First request, schedule batch processing
                asyncio.create_task(self.schedule_batch())

        return future

    async def schedule_batch(self):
        """Wait for more requests or timeout."""
        await asyncio.sleep(self.max_wait_ms / 1000)
        async with self.lock:
            if self.pending:
                await self.process_batch()

    async def process_batch(self):
        """Process all pending requests as a batch."""
        if not self.pending:
            return

        batch = self.pending[:]
        self.pending = []

        # Execute batch request
        requests = [item["request"] for item in batch]
        results = await self.execute_batch(requests)

        # Resolve futures
        for item, result in zip(batch, results):
            item["future"].set_result(result)

    async def execute_batch(self, requests: list) -> list:
        """Execute batch of requests."""
        # For embeddings - native batch support
        if requests[0]["type"] == "embedding":
            response = await self.client.embeddings.create(
                model="text-embedding-3-large",
                input=[r["text"] for r in requests]
            )
            return [e.embedding for e in response.data]

        # For completions - parallel execution
        tasks = [self.execute_single(r) for r in requests]
        return await asyncio.gather(*tasks)
```

## Pattern 5: Model Routing

```python
class ModelRouter:
    """Route to appropriate model based on request."""

    MODELS = {
        "simple": {
            "name": "gpt-4o-mini",
            "cost_per_1k": 0.00015,
            "latency_ms": 200,
            "quality": 0.85
        },
        "standard": {
            "name": "gpt-4o",
            "cost_per_1k": 0.005,
            "latency_ms": 500,
            "quality": 0.95
        },
        "reasoning": {
            "name": "o1-preview",
            "cost_per_1k": 0.015,
            "latency_ms": 2000,
            "quality": 0.98
        }
    }

    async def select_model(self, request: dict) -> str:
        """Select best model for request."""

        # Rule-based selection
        if request.get("require_reasoning"):
            return "reasoning"

        if request.get("max_latency_ms", 1000) < 300:
            return "simple"

        # Complexity-based selection
        complexity = await self.estimate_complexity(request)

        if complexity < 0.3:
            return "simple"
        elif complexity < 0.7:
            return "standard"
        else:
            return "reasoning"

    async def estimate_complexity(self, request: dict) -> float:
        """Estimate request complexity 0-1."""
        factors = []

        # Length factor
        text_length = len(request.get("content", ""))
        factors.append(min(text_length / 5000, 1.0))

        # Keyword factor
        complex_keywords = ["analyze", "compare", "design", "optimize", "debug"]
        keyword_count = sum(1 for kw in complex_keywords if kw in request.get("content", "").lower())
        factors.append(min(keyword_count / 3, 1.0))

        # Context factor
        if request.get("context_length", 0) > 10000:
            factors.append(0.8)
        else:
            factors.append(0.2)

        return sum(factors) / len(factors)
```

## Pattern 6: Horizontal Scaling

```python
# Kubernetes deployment for AI service
"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-service
spec:
  replicas: 5
  selector:
    matchLabels:
      app: ai-service
  template:
    metadata:
      labels:
        app: ai-service
    spec:
      containers:
      - name: ai-service
        image: ai-service:latest
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        env:
        - name: AZURE_OPENAI_ENDPOINT
          valueFrom:
            secretKeyRef:
              name: ai-secrets
              key: endpoint\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
