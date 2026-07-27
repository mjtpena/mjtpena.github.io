---
title: "Efficient Inference Patterns: Maximizing AI Throughput"
author: Michael John Peña
draft: false
date: 2025-04-12
tags:
  - AI
  - Inference
  - Performance
  - Optimization
  - Throughput

---

I wrote "Efficient Inference Patterns: Maximizing AI Throughput" to share practical, production-minded guidance on this topic.

## Inference Optimization Patterns

```python
# efficient_inference.py - Patterns for high-throughput inference

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, TypeVar
import numpy as np

T = TypeVar('T')

class BatchingInference:
    """Dynamic batching for efficient inference."""

    def __init__(self, model, max_batch_size: int = 32, max_wait_ms: int = 50):
        self.model = model
        self.max_batch_size = max_batch_size
        self.max_wait_ms = max_wait_ms
        self.queue = asyncio.Queue()
        self.running = False

    async def start(self):
        """Start the batching loop."""
        self.running = True
        asyncio.create_task(self._batch_loop())

    async def predict(self, input_data) -> any:
        """Submit request and wait for result."""
        future = asyncio.Future()
        await self.queue.put((input_data, future))
        return await future

    async def _batch_loop(self):
        """Process requests in batches."""
        while self.running:
            batch = []
            futures = []

            # Collect requests up to batch size or timeout
            try:
                item = await asyncio.wait_for(
                    self.queue.get(),
                    timeout=self.max_wait_ms / 1000
                )
                batch.append(item[0])
                futures.append(item[1])
            except asyncio.TimeoutError:
                continue

            # Collect more items without waiting
            while len(batch) < self.max_batch_size:
                try:
                    item = self.queue.get_nowait()
                    batch.append(item[0])
                    futures.append(item[1])
                except asyncio.QueueEmpty:
                    break

            # Process batch
            if batch:
                results = await self._process_batch(batch)
                for future, result in zip(futures, results):
                    future.set_result(result)

    async def _process_batch(self, batch: List) -> List:
        """Process a batch of inputs."""
        return self.model.predict_batch(batch)


class ContinuousBatching:
    """Continuous batching for LLM inference."""

    def __init__(self, model, max_concurrent: int = 8):
        self.model = model
        self.max_concurrent = max_concurrent
        self.active_requests = {}

    async def generate(self, prompt: str, max_tokens: int) -> str:
        """Generate with continuous batching."""
        request_id = self._create_request(prompt, max_tokens)

        while not self._is_complete(request_id):
            # Wait for next token batch
            await self._step()

        return self._get_result(request_id)

    async def _step(self):
        """Process one step for all active requests."""
        if not self.active_requests:
            return

        # Batch all active sequences
        inputs = self._prepare_batch()
        outputs = self.model.forward(inputs)

        # Update each request
        for request_id, output in zip(self.active_requests.keys(), outputs):
            self._update_request(request_id, output)


class KVCacheManager:
    """Manage KV cache for efficient inference."""

    def __init__(self, max_cache_size_gb: float = 8.0):
        self.max_size = max_cache_size_gb * 1e9
        self.cache = {}
        self.access_times = {}

    def get_or_create(self, sequence_id: str, layer: int) -> np.ndarray:
        """Get cached KV or create new."""
        key = (sequence_id, layer)
        self.access_times[key] = asyncio.get_event_loop().time()

        if key in self.cache:
            return self.cache[key]

        # Evict if necessary
        self._evict_if_needed()

        # Create new cache entry
        self.cache[key] = self._allocate_cache()
        return self.cache[key]

    def _evict_if_needed(self):
        """Evict least recently used entries."""
        while self._current_size() > self.max_size * 0.9:
            oldest = min(self.access_times, key=self.access_times.get)
            del self.cache[oldest]
            del self.access_times[oldest]
```

Efficient inference patterns can improve throughput by 5-10x while reducing costs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
