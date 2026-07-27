---
title: "GPT-4o Speed Improvements: Building Low-Latency Applications"
author: Michael John Peña
draft: false
date: 2024-05-08
tags:
  - AI
  - OpenAI
  - GPT-4o
  - Performance
  - Azure
---

GPT-4o is 2x faster than GPT-4 Turbo. Today I'm exploring how to leverage this speed for responsive applications.

## Latency Comparison

Based on my benchmarks:

| Model | First Token (ms) | Total (500 tokens) |
|-------|------------------|-------------------|
| GPT-4 Turbo | 800-1200 | 8-12s |
| GPT-4o | 200-400 | 4-6s |
| GPT-3.5 Turbo | 150-300 | 2-4s |

GPT-4o gets you GPT-4 intelligence at near GPT-3.5 speeds.

## Streaming for Perceived Speed

```python
import time

def stream_response(prompt: str) -> tuple[str, dict]:
    """Stream response and measure time-to-first-token."""
    start_time = time.time()
    first_token_time = None
    full_response = ""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    for chunk in response:
        if chunk.choices[0].delta.content:
            if first_token_time is None:
                first_token_time = time.time() - start_time

            content = chunk.choices[0].delta.content
            full_response += content
            print(content, end="", flush=True)

    total_time = time.time() - start_time

    return full_response, {
        "first_token_ms": first_token_time * 1000,
        "total_ms": total_time * 1000,
        "tokens": len(full_response) // 4  # Rough estimate
    }

# Usage
response, metrics = stream_response("Explain microservices architecture")
print(f"\n\nFirst token: {metrics['first_token_ms']:.0f}ms")
print(f"Total time: {metrics['total_ms']:.0f}ms")
```

## Parallel Processing

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict

class ParallelProcessor:
    def __init__(self, client, max_workers: int = 10):
        self.client = client
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

    def _single_request(self, prompt: str, request_id: int) -> Dict:
        start = time.time()

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500
        )

        return {
            "id": request_id,
            "response": response.choices[0].message.content,
            "latency_ms": (time.time() - start) * 1000,
            "tokens": response.usage.total_tokens
        }

    async def process_batch(self, prompts: List[str]) -> List[Dict]:
        loop = asyncio.get_event_loop()

        tasks = [
            loop.run_in_executor(
                self.executor,
                self._single_request,
                prompt,
                i
            )
            for i, prompt in enumerate(prompts)
        ]

        results = await asyncio.gather(*tasks)
        return sorted(results, key=lambda x: x["id"])

# Usage
processor = ParallelProcessor(client, max_workers=10)

prompts = [
    "Summarize: " + doc for doc in documents[:10]
]

start = time.time()
results = asyncio.run(processor.process_batch(prompts))
total_time = time.time() - start

print(f"Processed {len(prompts)} requests in {total_time:.2f}s")
print(f"Average latency: {sum(r['latency_ms'] for r in results) / len(results):.0f}ms")
```

## Optimizing for First Token Latency

```python
def optimize_for_speed(prompt: str, context: str = None) -> str:
    """Optimize request for fastest first token."""

    messages = []

    # Shorter system prompt = faster
    messages.append({
        "role": "system",
        "content": "Be concise."
    })

    # Put context in user message if needed
    if context:
        messages.append({
            "role": "user",
            "content": f"Context: {context[:2000]}"  # Limit context
        })
        messages.append({
            "role": "assistant",
            "content": "I understand the context."
        })

    messages.append({
        "role": "user",
        "content": prompt
    })

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        max_tokens=300,  # Limit output
        temperature=0,   # Deterministic = slightly faster
        stream=True
    )

    result = ""
    for chunk in response:
        if chunk.choices[0].delta.content:
            result += chunk.choices[0].delta.content

    return result
```

## Regional Latency Optimization

```python
import statistics

class RegionalOptimizer:
    REGIONS = [
        "https://eastus.api.cognitive.microsoft.com",
        "https://westus.api.cognitive.microsoft.com",
        "https://westeurope.api.cognitive.microsoft.com",
    ]

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.latencies = {region: [] for region in self.REGIONS}

    async def benchmark_regions(self, test_prompt: str = "Hello") -> Dict:
        results = {}

        for region in self.REGIONS:
            client = AzureOpenAI(
                api_version="2024-05-01-preview",
                azure_endpoint=region,
                api_key=self.api_key
            )

            latencies = []
            for _ in range(3):
                start = time.time()
                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": test_prompt}],
                    max_tokens=10
                )
                latencies.append((time.time() - start) * 1000)

            results[region] = {
                "avg_ms": statistics.mean(latencies),
                "min_ms": min(latencies),
                "max_ms": max(latencies)
            }

        return results

    def get_fastest_region(self, results: Dict) -> str:
        return min(results, key=lambda r: results[r]["avg_ms"])
```

## Client-Side Optimizations

### Connection Pooling

```python
import httpx

# Configure client with connection pooling
http_client = httpx.Client(
    limits=httpx.Limits(
        max_keepalive_connections=20,
        max_connections=100,
        keepalive_expiry=30.0
    ),
    timeout=httpx.Timeout(60.0, connect=10.0)
)

client = AzureOpenAI(
    api_version="2024-05-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"],
    http_client=http_client
)
```

### Retry with Backoff

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10)
)
def resilient_completion(messages: list) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages
    )
    return response.choices[0].message.content
```

## Real-Time Application Pattern

```python
from fastapi import FastAPI, WebSocket
from fastapi.responses import StreamingResponse
import asyncio

app = FastAPI()

@app.websocket("/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()

    while True:
        # Receive user message
        data = await websocket.receive_text()

        # Stream response back
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": data}],
            stream=True
        )

        for chunk in response:
            if chunk.choices[0].delta.content:
                await websocket.send_text(chunk.choices[0].delta.content)

        # Signal end of response
        await websocket.send_text("[END]")

@app.get("/stream")
async def stream_endpoint(prompt: str):
    async def generate():
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )

        for chunk in response:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    return StreamingResponse(generate(), media_type="text/plain")
```

## Benchmarking Framework

```python
import statistics
from dataclasses import dataclass
from typing import List

@dataclass
class BenchmarkResult:
    model: str
    prompt_tokens: int
    completion_tokens: int
    first_token_ms: float
    total_ms: float
    tokens_per_second: float

class ModelBenchmark:
    def __init__(self, client):
        self.client = client
        self.results: List[BenchmarkResult] = []

    def run_benchmark(self, prompt: str, model: str, iterations: int = 5) -> dict:
        results = []

        for _ in range(iterations):
            start = time.time()
            first_token = None
            tokens = 0

            response = self.client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                stream=True
            )

            for chunk in response:
                if chunk.choices[0].delta.content:
                    if first_token is None:
                        first_token = time.time() - start
                    tokens += 1

            total = time.time() - start

            results.append(BenchmarkResult(
                model=model,
                prompt_tokens=len(prompt) // 4,
                completion_tokens=tokens,
                first_token_ms=first_token * 1000,
                total_ms=total * 1000,
                tokens_per_second=tokens / total
            ))

        return {
            "model": model,
            "iterations": iterations,
            "avg_first_token_ms": statistics.mean(r.first_token_ms for r in results),
            "avg_total_ms": statistics.mean(r.total_ms for r in results),
            "avg_tokens_per_second": statistics.mean(r.tokens_per_second for r in results),
            "p95_total_ms": sorted([r.total_ms for r in results])[int(iterations * 0.95)]
        }

# Usage
benchmark = ModelBenchmark(client)
gpt4o_results = benchmark.run_benchmark(
    "Explain the concept of eventual consistency in distributed systems.",
    "gpt-4o"
)
print(f"GPT-4o avg first token: {gpt4o_results['avg_first_token_ms']:.0f}ms")
```

## Summary

| Optimization | Impact |
|-------------|--------|
| Streaming | Better perceived latency |
| Parallel processing | Higher throughput |
| Regional selection | 20-50% latency reduction |
| Connection pooling | 10-20% improvement |
| Shorter prompts | Faster processing |

## What's Next

Tomorrow I'll cover Microsoft Copilot+ PCs and their AI capabilities.

## Resources

- [Azure OpenAI Performance](https://learn.microsoft.com/azure/ai-services/openai/concepts/performance)
- [Streaming Guide](https://platform.openai.com/docs/guides/streaming)
- [Rate Limits](https://platform.openai.com/docs/guides/rate-limits)
