---
title: "Streaming Inference Patterns: Processing Data as It Flows"
description: "Streaming inference brings AI insights to real-time data. Design for throughput, latency, and reliability from the start."
author: Michael John Peña
draft: false
date: 2025-02-20
tags:
  - AI
  - Streaming
  - Data Engineering
  - Real-Time
  - Azure
---

## Streaming Inference Architecture

```
Data Sources              Stream Processing              Consumers
     │                          │                            │
     ▼                          ▼                            ▼
┌──────────┐              ┌───────────────┐            ┌──────────┐
│ Kafka    │─────────────►│ Stream App    │───────────►│ Alerts   │
│ Event Hub│              │ w/ AI Models  │            │ Dashboard│
│ IoT Hub  │              │               │            │ Database │
└──────────┘              └───────────────┘            └──────────┘
                                │
                          ┌─────┴─────┐
                          │ Model     │
                          │ Registry  │
                          └───────────┘
```

## Basic Streaming Inference

```python
from azure.eventhub.aio import EventHubConsumerClient, EventHubProducerClient
import asyncio
import json

class StreamingInference:
    def __init__(
        self,
        consumer_conn: str,
        producer_conn: str,
        model
    ):
        self.consumer = EventHubConsumerClient.from_connection_string(
            consumer_conn,
            consumer_group="ai-processing",
            eventhub_name="input-events"
        )
        self.producer = EventHubProducerClient.from_connection_string(
            producer_conn,
            eventhub_name="ai-results"
        )
        self.model = model
        self.batch_size = 32
        self.batch_timeout = 0.1  # 100ms

    async def process_stream(self):
        """Process events from stream with AI inference."""

        batch = []
        batch_start = asyncio.get_event_loop().time()

        async def on_event(partition_context, event):
            nonlocal batch, batch_start

            # Add to batch
            batch.append({
                "partition": partition_context.partition_id,
                "data": json.loads(event.body_as_str()),
                "event": event
            })

            # Check if batch is ready
            elapsed = asyncio.get_event_loop().time() - batch_start

            if len(batch) >= self.batch_size or elapsed >= self.batch_timeout:
                await self._process_batch(batch, partition_context)
                batch = []
                batch_start = asyncio.get_event_loop().time()

        await self.consumer.receive(
            on_event=on_event,
            starting_position="-1"
        )

    async def _process_batch(self, batch: list, context):
        """Process a batch of events."""

        # Extract data for inference
        inputs = [item["data"] for item in batch]

        # Batch inference
        predictions = await self.model.predict_batch(inputs)

        # Create output events
        output_events = []
        for item, pred in zip(batch, predictions):
            output_events.append({
                "input": item["data"],
                "prediction": pred,
                "timestamp": datetime.utcnow().isoformat()
            })

        # Send results
        async with self.producer:
            event_batch = await self.producer.create_batch()
            for result in output_events:
                event_batch.add(EventData(json.dumps(result)))
            await self.producer.send_batch(event_batch)

        # Checkpoint
        await context.update_checkpoint()
```

## Micro-Batching for Efficiency

```python
class MicroBatchInference:
    """Accumulate events into micro-batches for efficient inference."""

    def __init__(self, model, batch_config: dict):
        self.model = model
        self.max_batch_size = batch_config.get("max_size", 64)
        self.max_wait_ms = batch_config.get("max_wait_ms", 100)
        self.pending = []
        self.pending_futures = []
        self.lock = asyncio.Lock()
        self._processor_task = None

    async def infer(self, input_data: dict) -> dict:
        """Submit input and wait for result."""
        future = asyncio.Future()

        async with self.lock:
            self.pending.append(input_data)
            self.pending_futures.append(future)

            # Start processor if not running
            if self._processor_task is None:
                self._processor_task = asyncio.create_task(self._batch_processor())

        return await future

    async def _batch_processor(self):
        """Process batches as they become ready."""
        while True:
            await asyncio.sleep(self.max_wait_ms / 1000)

            async with self.lock:
                if not self.pending:
                    self._processor_task = None
                    return

                # Take up to max_batch_size
                batch_size = min(len(self.pending), self.max_batch_size)
                batch = self.pending[:batch_size]
                futures = self.pending_futures[:batch_size]

                self.pending = self.pending[batch_size:]
                self.pending_futures = self.pending_futures[batch_size:]

            # Process batch
            try:
                results = await self.model.predict_batch(batch)
                for future, result in zip(futures, results):
                    future.set_result(result)
            except Exception as e:
                for future in futures:
                    future.set_exception(e)
```

## Windowed Aggregation with AI

```python
class WindowedAIAggregation:
    """Apply AI to windowed aggregates of streaming data."""

    def __init__(self, window_duration_seconds: int, ai_model):
        self.window_duration = window_duration_seconds
        self.ai_model = ai_model
        self.windows = {}  # window_key -> accumulated data

    async def process_event(self, event: dict):
        """Process event and update windows."""

        entity_id = event.get("entity_id")
        timestamp = event.get("timestamp")

        # Determine window
        window_start = self._get_window_start(timestamp)
        window_key = f"{entity_id}:{window_start}"

        # Update window
        if window_key not in self.windows:
            self.windows[window_key] = {
                "entity_id": entity_id,
                "window_start": window_start,
                "events": [],
                "aggregates": {"count": 0, "sum": 0}
            }

        window = self.windows[window_key]
        window["events"].append(event)
        window["aggregates"]["count"] += 1
        window["aggregates"]["sum"] += event.get("value", 0)

        # Check for window completion
        await self._check_window_completion(window_key)

    async def _check_window_completion(self, window_key: str):
        """Check if window is complete and process."""

        window = self.windows[window_key]
        window_end = window["window_start"] + self.window_duration

        if time.time() >= window_end:
            # Window complete - apply AI
            result = await self._analyze_window(window)

            # Emit result
            await self._emit_result(window, result)

            # Clean up
            del self.windows[window_key]

    async def _analyze_window(self, window: dict) -> dict:
        """Apply AI analysis to window data."""

        # Prepare features from window
        features = {
            "event_count": window["aggregates"]["count"],
            "total_value": window["aggregates"]["sum"],
            "avg_value": window["aggregates"]["sum"] / max(window["aggregates"]["count"], 1),
            "event_sequence": [e.get("type") for e in window["events"]]
        }

        # AI inference
        prediction = await self.ai_model.predict(features)

        return prediction
```

## Model Hot-Swapping

```python
class HotSwappableModel:
    """Model that can be updated without stopping the stream."""

    def __init__(self, model_registry, model_name: str):
        self.registry = model_registry
        self.model_name = model_name
        self.current_model = None
        self.current_version = None
        self._lock = asyncio.Lock()

    async def load_latest(self):
        """Load the latest model version."""
        async with self._lock:
            latest_version = await self.registry.get_latest_version(self.model_name)

            if latest_version != self.current_version:
                new_model = await self.registry.load_model(
                    self.model_name, latest_version
                )

                # Atomic swap
                old_model = self.current_model
                self.current_model = new_model
                self.current_version = latest_version

                # Clean up old model
                if old_model:
                    del old_model

                print(f"Model updated to version {latest_version}")

    async def predict(self, input_data) -> dict:
        """Predict with current model."""
        if self.current_model is None:
            await self.load_latest()

        return await self.current_model.predict(input_data)

    async def start_auto_refresh(self, interval_seconds: int = 300):
        """Periodically check for model updates."""
        while True:
            await asyncio.sleep(interval_seconds)
            await self.load_latest()
```

## Backpressure Handling

```python
class BackpressureManager:
    """Handle backpressure in streaming AI pipeline."""

    def __init__(
        self,
        max_queue_size: int = 1000,
        high_watermark: float = 0.8,
        low_watermark: float = 0.5
    ):
        self.max_queue_size = max_queue_size
        self.high_watermark = high_watermark
        self.low_watermark = low_watermark
        self.queue = asyncio.Queue(maxsize=max_queue_size)
        self.throttled = False

    async def enqueue(self, item: dict) -> bool:
        """Enqueue item with backpressure awareness."""

        queue_fill = self.queue.qsize() / self.max_queue_size

        if queue_fill >= self.high_watermark:
            self.throttled = True
            # Options: drop, sample, or wait
            if self._should_drop(item):
                return False
            # Or wait with timeout
            try:
                await asyncio.wait_for(
                    self.queue.put(item),
                    timeout=1.0
                )
            except asyncio.TimeoutError:
                return False

        elif queue_fill <= self.low_watermark:
            self.throttled = False

        await self.queue.put(item)
        return True

    def _should_drop(self, item: dict) -> bool:
        """Decide if item should be dropped under pressure."""
        # Priority-based: drop low-priority items
        priority = item.get("priority", "normal")
        if priority == "low" and self.throttled:
            return True
        return False

    async def dequeue(self) -> dict:
        """Get item from queue."""
        return await self.queue.get()
```

## Best Practices

1. **Batch for efficiency**: Micro-batch for GPU utilization
2. **Handle backpressure**: Don't drop important events
3. **Enable hot-swapping**: Update models without downtime
4. **Monitor lag**: Track processing latency and queue depth
5. **Checkpoint properly**: Enable exactly-once semantics
6. **Test with load**: Verify performance under realistic conditions

Streaming inference brings AI insights to real-time data. Design for throughput, latency, and reliability from the start.
