---
title: "Batching Strategies for LLM Inference"
author: Michael John Peña
draft: false
date: 2023-08-17
tags:
  - Batching
  - Inference
  - Performance
  - LLM

---

I wrote "Batching Strategies for LLM Inference" to share practical, production-minded guidance on this topic.

## Static vs Dynamic Batching

```python
# Static batching: Fixed batch size
def static_batch(requests, batch_size=8):
    for i in range(0, len(requests), batch_size):
        batch = requests[i:i+batch_size]
        yield process_batch(batch)

# Dynamic batching: Adaptive based on request properties
def dynamic_batch(requests, max_tokens=4096):
    batch = []
    batch_tokens = 0

    for req in requests:
        req_tokens = len(tokenizer.encode(req))
        if batch_tokens + req_tokens > max_tokens and batch:
            yield batch
            batch = []
            batch_tokens = 0
        batch.append(req)
        batch_tokens += req_tokens

    if batch:
        yield batch
```

## Continuous Batching Implementation

```python
import threading
import queue
import time

class ContinuousBatcher:
    def __init__(self, model, tokenizer, max_batch=8, timeout_ms=50):
        self.model = model
        self.tokenizer = tokenizer
        self.max_batch = max_batch
        self.timeout = timeout_ms / 1000
        self.request_queue = queue.Queue()
        self.running = True
        self.worker = threading.Thread(target=self._process_loop)
        self.worker.start()

    def _process_loop(self):
        while self.running:
            batch = []
            futures = []
            deadline = time.time() + self.timeout

            while len(batch) < self.max_batch and time.time() < deadline:
                try:
                    req, future = self.request_queue.get(timeout=0.01)
                    batch.append(req)
                    futures.append(future)
                except queue.Empty:
                    continue

            if batch:
                results = self._process_batch(batch)
                for future, result in zip(futures, results):
                    future.set_result(result)

    def _process_batch(self, prompts):
        inputs = self.tokenizer(
            prompts,
            padding=True,
            truncation=True,
            return_tensors="pt"
        )
        outputs = self.model.generate(**inputs, max_new_tokens=100)
        return [self.tokenizer.decode(o, skip_special_tokens=True) for o in outputs]

    def generate(self, prompt):
        future = concurrent.futures.Future()
        self.request_queue.put((prompt, future))
        return future.result(timeout=30)
```

## Sorted Batching for Efficiency

```python
def sorted_batching(requests, batch_size=8):
    """Group similar-length requests to minimize padding."""
    # Sort by input length
    sorted_requests = sorted(
        enumerate(requests),
        key=lambda x: len(tokenizer.encode(x[1]))
    )

    results = [None] * len(requests)

    for i in range(0, len(sorted_requests), batch_size):
        batch_indices = [idx for idx, _ in sorted_requests[i:i+batch_size]]
        batch_prompts = [sorted_requests[j][1] for j in range(i, min(i+batch_size, len(sorted_requests)))]

        # Process batch (less padding waste)
        inputs = tokenizer(batch_prompts, padding=True, return_tensors="pt")
        outputs = model.generate(**inputs, max_new_tokens=100)

        for j, idx in enumerate(batch_indices):
            results[idx] = tokenizer.decode(outputs[j], skip_special_tokens=True)

    return results
```

## Async Batching Server

```python
import asyncio
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Request(BaseModel):
    prompt: str
    max_tokens: int = 100

class AsyncBatcher:
    def __init__(self, model, batch_size=8, max_wait=0.05):
        self.model = model
        self.batch_size = batch_size
        self.max_wait = max_wait
        self.pending = []
        self.lock = asyncio.Lock()

    async def add_request(self, prompt, max_tokens):
        event = asyncio.Event()
        result_holder = {}

        async with self.lock:
            self.pending.append({
                "prompt": prompt,
                "max_tokens": max_tokens,
                "event": event,
                "result": result_holder
            })

            if len(self.pending) >= self.batch_size:
                await self._process_batch()

        # Wait for result or timeout trigger
        await event.wait()
        return result_holder.get("output")

    async def _process_batch(self):
        batch = self.pending[:self.batch_size]
        self.pending = self.pending[self.batch_size:]

        prompts = [r["prompt"] for r in batch]
        outputs = self.model.generate(prompts)

        for req, output in zip(batch, outputs):
            req["result"]["output"] = output
            req["event"].set()

batcher = AsyncBatcher(model)

@app.post("/generate")
async def generate(request: Request):
    result = await batcher.add_request(request.prompt, request.max_tokens)
    return {"generated": result}
```

## Batching for Different Workloads

```python
workload_strategies = {
    "uniform_length": {
        "strategy": "Simple fixed batching",
        "batch_size": "As large as GPU allows",
        "benefit": "Maximum throughput"
    },
    "variable_length": {
        "strategy": "Sorted/bucketed batching",
        "approach": "Group similar lengths",
        "benefit": "Reduced padding overhead"
    },
    "real_time": {
        "strategy": "Continuous batching with timeout",
        "max_wait": "50-100ms",
        "benefit": "Balance latency and throughput"
    },
    "high_throughput": {
        "strategy": "Large batch with async processing",
        "batch_size": "32-64",
        "benefit": "Maximum GPU utilization"
    }
}
```

## Monitoring Batch Performance

```python
class BatchMetrics:
    def __init__(self):
        self.batch_sizes = []
        self.latencies = []
        self.padding_ratios = []

    def record_batch(self, batch_size, latency, actual_tokens, padded_tokens):
        self.batch_sizes.append(batch_size)
        self.latencies.append(latency)
        self.padding_ratios.append(1 - actual_tokens / padded_tokens)

    def report(self):
        return {
            "avg_batch_size": np.mean(self.batch_sizes),
            "avg_latency_ms": np.mean(self.latencies) * 1000,
            "avg_padding_ratio": np.mean(self.padding_ratios),
            "throughput": sum(self.batch_sizes) / sum(self.latencies)
        }
```

Tomorrow we'll explore GPU optimization techniques.

## Resources

- [Continuous Batching Paper](https://arxiv.org/abs/2309.06180)
- [vLLM Batching](https://docs.vllm.ai/en/latest/)
- [Triton Inference Server](https://github.com/triton-inference-server/server)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
