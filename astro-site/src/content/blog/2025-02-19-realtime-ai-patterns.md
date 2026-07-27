---
title: "Real-Time AI Patterns: Building Low-Latency Intelligent Systems"
author: Michael John Peña
draft: false
date: 2025-02-19
tags:
  - AI
  - Real-Time
  - Streaming
  - Architecture
  - Azure

---

I wrote "Real-Time AI Patterns: Building Low-Latency Intelligent Systems" to share practical, production-minded guidance on this topic.

## Real-Time AI Architecture Patterns

```
Pattern 1: Stream Processing
Event → Filter → Enrich → AI Inference → Action
                    ↓
              [Feature Store]

Pattern 2: Request-Response with Caching
Request → Cache Check → [Hit: Return] / [Miss: AI → Cache → Return]

Pattern 3: Speculative Processing
Input → Fast Model → Return Quick Result
          ↓
      Background: Slow Model → Update if Different

Pattern 4: Edge-Cloud Hybrid
Input → Edge AI (fast, simple) → [Complex: Cloud AI]
```

## Low-Latency Inference Service

```python
from fastapi import FastAPI, BackgroundTasks
import asyncio
from typing import Optional
import time

app = FastAPI()

class RealtimeAIService:
    def __init__(self):
        self.fast_model = load_model("fast")  # Small, quick model
        self.full_model = load_model("full")  # Large, accurate model
        self.cache = LRUCache(maxsize=10000)
        self.metrics = MetricsCollector()

    async def infer(
        self,
        input_data: dict,
        max_latency_ms: int = 100,
        background_tasks: BackgroundTasks = None
    ) -> dict:
        """Inference with latency budget."""
        start = time.time()

        # Check cache
        cache_key = self._cache_key(input_data)
        cached = self.cache.get(cache_key)
        if cached:
            self.metrics.record("cache_hit")
            return cached

        # Fast inference
        fast_result = await self._fast_inference(input_data)

        elapsed_ms = (time.time() - start) * 1000
        remaining_budget = max_latency_ms - elapsed_ms

        if remaining_budget > 50:
            # Time for enhanced inference
            try:
                full_result = await asyncio.wait_for(
                    self._full_inference(input_data),
                    timeout=remaining_budget / 1000
                )
                self.cache.set(cache_key, full_result)
                return full_result
            except asyncio.TimeoutError:
                pass

        # Return fast result, optionally enhance in background
        if background_tasks:
            background_tasks.add_task(
                self._background_enhance, input_data, cache_key
            )

        return fast_result

    async def _fast_inference(self, input_data: dict) -> dict:
        """Quick inference with small model."""
        return await self.fast_model.predict(input_data)

    async def _full_inference(self, input_data: dict) -> dict:
        """Full inference with large model."""
        return await self.full_model.predict(input_data)

    async def _background_enhance(self, input_data: dict, cache_key: str):
        """Enhance result in background for future requests."""
        result = await self._full_inference(input_data)
        self.cache.set(cache_key, result)

service = RealtimeAIService()

@app.post("/predict")
async def predict(
    input_data: dict,
    background_tasks: BackgroundTasks,
    max_latency_ms: int = 100
):
    return await service.infer(input_data, max_latency_ms, background_tasks)
```

## Streaming AI Responses

```python
from fastapi.responses import StreamingResponse
import json

class StreamingAI:
    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def stream_response(self, prompt: str):
        """Stream AI response token by token."""

        async with self.ai_client.chat.stream_async(
            deployment="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        ) as stream:
            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

    async def stream_with_tools(self, prompt: str, tools: list):
        """Stream response with tool calls."""

        events = []

        async with self.ai_client.chat.stream_async(
            deployment="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            tools=tools
        ) as stream:
            async for chunk in stream:
                delta = chunk.choices[0].delta

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        events.append({
                            "type": "tool_call",
                            "tool": tc.function.name,
                            "args": tc.function.arguments
                        })
                        yield f"data: {json.dumps(events[-1])}\n\n"

                if delta.content:
                    events.append({
                        "type": "content",
                        "content": delta.content
                    })
                    yield f"data: {json.dumps(events[-1])}\n\n"

@app.get("/stream")
async def stream_endpoint(prompt: str):
    streaming_ai = StreamingAI(ai_client)
    return StreamingResponse(
        streaming_ai.stream_response(prompt),
        media_type="text/event-stream"
    )
```

## Event-Driven Real-Time AI

```python
from azure.eventhub.aio import EventHubConsumerClient
from azure.eventhub import EventData

class RealtimeEventProcessor:
    def __init__(self, eventhub_conn: str, ai_service: RealtimeAIService):
        self.consumer = EventHubConsumerClient.from_connection_string(
            eventhub_conn,
            consumer_group="$Default",
            eventhub_name="events"
        )
        self.ai_service = ai_service
        self.output_queue = asyncio.Queue()

    async def process_events(self):
        """Process events with AI in real-time."""

        async def on_event(partition_context, event):
            # Parse event
            data = json.loads(event.body_as_str())

            # AI inference with tight latency
            result = await self.ai_service.infer(
                data,
                max_latency_ms=50  # Very tight budget
            )

            # Handle result
            await self._handle_result(data, result)

            # Checkpoint
            await partition_context.update_checkpoint(event)

        await self.consumer.receive(
            on_event=on_event,
            starting_position="-1"
        )

    async def _handle_result(self, input_data: dict, result: dict):
        """Handle AI result - alert, store, or forward."""

        if result.get("anomaly_score", 0) > 0.8:
            await self._send_alert(input_data, result)

        await self.output_queue.put(result)
```

## Real-Time Feature Computation

```python
class RealtimeFeatureService:
    """Compute features for AI inference in real-time."""

    def __init__(self, feature_store):
        self.feature_store = feature_store
        self.window_aggregates = {}  # In-memory windowed aggregates

    async def get_features(
        self,
        entity_id: str,
        event: dict
    ) -> dict:
        """Get features combining historical and real-time."""

        # Historical features from store
        historical = await self.feature_store.get_features(
            entity_id,
            feature_names=["avg_transaction_30d", "max_transaction_30d"]
        )

        # Real-time window features
        window_key = f"{entity_id}_1h"
        window = self.window_aggregates.get(window_key, {
            "count": 0,
            "sum": 0,
            "max": 0
        })

        # Update window with new event
        window["count"] += 1
        window["sum"] += event.get("amount", 0)
        window["max"] = max(window["max"], event.get("amount", 0))
        self.window_aggregates[window_key] = window

        # Combine features
        return {
            **historical,
            "transactions_1h": window["count"],
            "total_amount_1h": window["sum"],
            "max_amount_1h": window["max"],
            "current_amount": event.get("amount", 0)
        }

    async def cleanup_windows(self):
        """Periodically clean up old windows."""
        while True:
            await asyncio.sleep(60)
            # Remove windows older than 1 hour
            # Implementation depends on your windowing strategy
```

## Latency Monitoring

```python
from prometheus_client import Histogram, Counter
import functools
import time

latency_histogram = Histogram(
    'ai_inference_latency_seconds',
    'AI inference latency',
    buckets=[.01, .025, .05, .075, .1, .25, .5, 1.0]
)

inference_counter = Counter(
    'ai_inference_total',
    'Total AI inferences',
    ['model', 'cache_hit']
)

def track_latency(func):
    """Decorator to track inference latency."""

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        start = time.time()
        try:
            result = await func(*args, **kwargs)
            return result
        finally:
            elapsed = time.time() - start
            latency_histogram.observe(elapsed)

    return wrapper

class MonitoredAIService:
    @track_latency
    async def infer(self, input_data: dict) -> dict:
        # Check cache
        cache_hit = self.cache.get(self._key(input_data)) is not None

        inference_counter.labels(
            model="gpt-4o-mini",
            cache_hit=str(cache_hit)
        ).inc()

        # ... inference logic
```

## Best Practices

1. **Set latency budgets**: Define SLAs for each use case
2. **Use tiered models**: Fast model first, upgrade if time allows
3. **Stream responses**: Start delivering value immediately
4. **Cache aggressively**: Similar requests benefit from caching
5. **Pre-compute features**: Don't compute features during inference
6. **Monitor percentiles**: P99 latency matters more than average

Real-time AI requires discipline around latency. Design for the worst case and optimize for the common case.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
