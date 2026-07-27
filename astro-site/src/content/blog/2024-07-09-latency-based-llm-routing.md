---
title: "Latency-Based LLM Routing: Real-Time AI Applications"
author: Michael John Peña
draft: false
date: 2024-07-09
tags:
  - AI
  - LLM
  - Performance
  - Azure
  - Real-Time

---

I wrote "Latency-Based LLM Routing: Real-Time AI Applications" to share practical, production-minded guidance on this topic.

## Understanding LLM Latency

Latency has multiple components:

1. **Network latency**: Request travel time
2. **Queue time**: Waiting for processing
3. **Time to first token (TTFT)**: Initial response delay
4. **Token generation**: Time per output token
5. **Total completion time**: Full response duration

```python
from dataclasses import dataclass
from datetime import datetime
import time

@dataclass
class LatencyMeasurement:
    network_ms: float
    queue_ms: float
    ttft_ms: float
    generation_ms: float
    total_ms: float
    tokens_generated: int

    @property
    def tokens_per_second(self) -> float:
        if self.generation_ms == 0:
            return 0
        return self.tokens_generated / (self.generation_ms / 1000)

class LatencyTracker:
    def __init__(self):
        self.measurements: dict[str, list[LatencyMeasurement]] = {}

    def measure_request(
        self,
        model: str,
        request_func,
        *args, **kwargs
    ) -> tuple[any, LatencyMeasurement]:
        """Measure latency of a model request."""
        start = time.perf_counter()

        # Execute request (assuming it returns response and timing info)
        response, timing = request_func(*args, **kwargs)

        total = (time.perf_counter() - start) * 1000

        measurement = LatencyMeasurement(
            network_ms=timing.get("network", 0),
            queue_ms=timing.get("queue", 0),
            ttft_ms=timing.get("ttft", 0),
            generation_ms=timing.get("generation", 0),
            total_ms=total,
            tokens_generated=timing.get("tokens", 0)
        )

        if model not in self.measurements:
            self.measurements[model] = []
        self.measurements[model].append(measurement)

        return response, measurement

    def get_percentile(self, model: str, percentile: float) -> float:
        """Get latency percentile for a model."""
        if model not in self.measurements:
            return float("inf")

        latencies = sorted([m.total_ms for m in self.measurements[model]])
        index = int(len(latencies) * percentile / 100)
        return latencies[min(index, len(latencies) - 1)]

    def get_average_ttft(self, model: str) -> float:
        """Get average time to first token."""
        if model not in self.measurements:
            return float("inf")

        ttfts = [m.ttft_ms for m in self.measurements[model]]
        return sum(ttfts) / len(ttfts) if ttfts else float("inf")
```

## Latency-Based Router

```python
from typing import Optional
from enum import Enum

class LatencyPriority(Enum):
    STREAMING = "streaming"      # Optimize for TTFT
    TOTAL = "total"              # Optimize for total time
    THROUGHPUT = "throughput"    # Optimize for tokens/second

@dataclass
class ModelLatencyProfile:
    name: str
    avg_ttft_ms: float
    avg_total_ms: float  # For typical request
    tokens_per_second: float
    p95_total_ms: float

class LatencyRouter:
    def __init__(self, tracker: LatencyTracker):
        self.tracker = tracker
        self.static_profiles = {
            "gpt-4o": ModelLatencyProfile(
                name="gpt-4o",
                avg_ttft_ms=400,
                avg_total_ms=2000,
                tokens_per_second=50,
                p95_total_ms=4000
            ),
            "claude-3.5-sonnet": ModelLatencyProfile(
                name="claude-3.5-sonnet",
                avg_ttft_ms=300,
                avg_total_ms=1500,
                tokens_per_second=60,
                p95_total_ms=3000
            ),
            "gpt-4o-mini": ModelLatencyProfile(
                name="gpt-4o-mini",
                avg_ttft_ms=150,
                avg_total_ms=500,
                tokens_per_second=100,
                p95_total_ms=1000
            ),
            "claude-3-haiku": ModelLatencyProfile(
                name="claude-3-haiku",
                avg_ttft_ms=100,
                avg_total_ms=400,
                tokens_per_second=120,
                p95_total_ms=800
            ),
        }

    def route(
        self,
        max_latency_ms: float,
        priority: LatencyPriority = LatencyPriority.TOTAL,
        min_quality_tier: int = 1,
        expected_tokens: int = 500
    ) -> Optional[str]:
        """Select fastest model meeting latency requirements."""

        quality_tiers = {
            "gpt-4o": 5,
            "claude-3.5-sonnet": 5,
            "gpt-4o-mini": 3,
            "claude-3-haiku": 3,
        }

        candidates = []

        for name, profile in self.static_profiles.items():
            if quality_tiers.get(name, 0) < min_quality_tier:
                continue

            # Estimate latency for this request
            estimated = self._estimate_latency(profile, expected_tokens, priority)

            if estimated <= max_latency_ms:
                candidates.append((name, estimated, profile))

        if not candidates:
            return None

        # Sort by estimated latency
        candidates.sort(key=lambda x: x[1])

        return candidates[0][0]

    def _estimate_latency(
        self,
        profile: ModelLatencyProfile,
        expected_tokens: int,
        priority: LatencyPriority
    ) -> float:
        if priority == LatencyPriority.STREAMING:
            # For streaming, TTFT is most important
            return profile.avg_ttft_ms

        elif priority == LatencyPriority.THROUGHPUT:
            # Estimate based on tokens/second
            generation_time = expected_tokens / profile.tokens_per_second * 1000
            return profile.avg_ttft_ms + generation_time

        else:  # TOTAL
            # Use historical P95 or estimate
            return profile.p95_total_ms

    def route_with_tracking(
        self,
        max_latency_ms: float,
        priority: LatencyPriority = LatencyPriority.TOTAL
    ) -> Optional[str]:
        """Route using actual tracked latency data."""
        candidates = []

        for model in self.static_profiles.keys():
            # Use actual measurements if available
            if model in self.tracker.measurements:
                measured = self.tracker.get_percentile(model, 95)
            else:
                measured = self.static_profiles[model].p95_total_ms

            if measured <= max_latency_ms:
                candidates.append((model, measured))

        if not candidates:
            return None

        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]

# Usage
tracker = LatencyTracker()
router = LatencyRouter(tracker)

# Route for streaming chat (TTFT matters most)
model = router.route(
    max_latency_ms=500,  # First token within 500ms
    priority=LatencyPriority.STREAMING,
    min_quality_tier=3
)
print(f"Streaming chat: {model}")  # claude-3-haiku

# Route for batch processing (total time matters)
model = router.route(
    max_latency_ms=3000,  # Full response within 3s
    priority=LatencyPriority.TOTAL,
    min_quality_tier=5
)
print(f"Batch processing: {model}")  # claude-3.5-sonnet
```

## Streaming for Lower Perceived Latency

Streaming reduces perceived latency even when total time is the same:

```python
import asyncio
from typing import AsyncGenerator

class StreamingRouter:
    def __init__(self, latency_router: LatencyRouter):
        self.latency_router = latency_router

    async def stream_response(
        self,
        prompt: str,
        max_ttft_ms: float
    ) -> AsyncGenerator[str, None]:
        """Stream response with latency-optimized model selection."""

        # Select model optimized for TTFT
        model = self.latency_router.route(
            max_latency_ms=max_ttft_ms,
            priority=LatencyPriority.STREAMING
        )

        if not model:
            yield "Error: No model available within latency constraints"
            return

        # Stream from selected model
        async for chunk in self._stream_from_model(model, prompt):
            yield chunk

    async def _stream_from_model(
        self,
        model: str,
        prompt: str
    ) -> AsyncGenerator[str, None]:
        """Stream chunks from the selected model."""
        # Implementation depends on provider
        if "claude" in model:
            async for chunk in self._stream_anthropic(model, prompt):
                yield chunk
        else:
            async for chunk in self._stream_openai(model, prompt):
                yield chunk

    async def _stream_anthropic(
        self,
        model: str,
        prompt: str
    ) -> AsyncGenerator[str, None]:
        import anthropic

        client = anthropic.Anthropic()

        with client.messages.stream(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        ) as stream:
            for text in stream.text_stream:
                yield text

    async def _stream_openai(
        self,
        model: str,
        prompt: str
    ) -> AsyncGenerator[str, None]:
        from openai import AzureOpenAI

        client = AzureOpenAI()

        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

# Usage in async context
async def chat_handler(user_message: str):
    tracker = LatencyTracker()
    latency_router = LatencyRouter(tracker)
    streaming_router = StreamingRouter(latency_router)

    print("Assistant: ", end="", flush=True)
    async for chunk in streaming_router.stream_response(
        user_message,
        max_ttft_ms=300
    ):
        print(chunk, end="", flush=True)
    print()
```

## Regional Routing

Deploy across regions to minimize network latency:

```python
from dataclasses import dataclass
from typing import Optional
import random

@dataclass
class RegionalEndpoint:
    region: str
    endpoint: str
    avg_latency_ms: float
    available_models: list[str]
    current_load: float  # 0-1

class RegionalRouter:
    def __init__(self):
        self.endpoints = {
            "us-east": RegionalEndpoint(
                region="us-east",
                endpoint="https://ai-east.azure.com",
                avg_latency_ms=50,
                available_models=["gpt-4o", "gpt-4o-mini"],
                current_load=0.6
            ),
            "us-west": RegionalEndpoint(
                region="us-west",
                endpoint="https://ai-west.azure.com",
                avg_latency_ms=80,
                available_models=["gpt-4o", "gpt-4o-mini"],
                current_load=0.4
            ),
            "eu-west": RegionalEndpoint(
                region="eu-west",
                endpoint="https://ai-eu.azure.com",
                avg_latency_ms=120,
                available_models=["gpt-4o", "claude-3.5-sonnet"],
                current_load=0.3
            ),
        }
        self.user_region_map = {}  # Cache user -> best region

    def route(
        self,
        user_id: str,
        user_location: str,
        required_model: str,
        max_latency_ms: float
    ) -> Optional[tuple[str, str]]:
        """
        Returns (endpoint, region) for the request.
        """
        # Check cache first
        if user_id in self.user_region_map:
            cached = self.user_region_map[user_id]
            endpoint = self.endpoints.get(cached)
            if endpoint and required_model in endpoint.available_models:
                return endpoint.endpoint, cached

        # Find best region
        candidates = []

        for region, endpoint in self.endpoints.items():
            if required_model not in endpoint.available_models:
                continue

            # Estimate total latency
            estimated_latency = self._estimate_latency(endpoint, user_location)

            if estimated_latency <= max_latency_ms:
                candidates.append((region, endpoint, estimated_latency))

        if not candidates:
            return None

        # Sort by latency, considering load
        candidates.sort(key=lambda x: x[2] * (1 + x[1].current_load * 0.5))

        best = candidates[0]
        self.user_region_map[user_id] = best[0]

        return best[1].endpoint, best[0]

    def _estimate_latency(
        self,
        endpoint: RegionalEndpoint,
        user_location: str
    ) -> float:
        # Simplified geo-latency estimation
        region_latencies = {
            ("us", "us-east"): 30,
            ("us", "us-west"): 60,
            ("us", "eu-west"): 100,
            ("eu", "eu-west"): 20,
            ("eu", "us-east"): 90,
            ("eu", "us-west"): 150,
        }

        user_geo = "us" if "us" in user_location.lower() else "eu"
        network_latency = region_latencies.get(
            (user_geo, endpoint.region),
            endpoint.avg_latency_ms
        )

        return network_latency + endpoint.avg_latency_ms

# Usage
regional_router = RegionalRouter()

result = regional_router.route(
    user_id="user123",
    user_location="New York, US",
    required_model="gpt-4o",
    max_latency_ms=200
)

if result:
    endpoint, region = result
    print(f"Route to {region}: {endpoint}")
```

## Load-Aware Routing

Consider current load when routing:

```python
from collections import defaultdict
import threading
import time

class LoadAwareRouter:
    def __init__(self):
        self.current_requests = defaultdict(int)
        self.max_concurrent = {
            "gpt-4o": 50,
            "claude-3.5-sonnet": 50,
            "gpt-4o-mini": 200,
            "claude-3-haiku": 200,
        }
        self.lock = threading.Lock()
        self.latency_router = LatencyRouter(LatencyTracker())

    def route(
        self,
        max_latency_ms: float,
        priority: LatencyPriority = LatencyPriority.TOTAL
    ) -> Optional[str]:
        """Route considering both latency and current load."""

        with self.lock:
            candidates = []

            for model in self.max_concurrent.keys():
                # Check if model has capacity
                load_ratio = self.current_requests[model] / self.max_concurrent[model]
                if load_ratio >= 0.95:  # 95% capacity threshold
                    continue

                # Estimate latency including queue time
                profile = self.latency_router.static_profiles.get(model)
                if not profile:
                    continue

                # Add estimated queue delay based on load
                queue_delay = load_ratio * 500  # Up to 500ms at high load
                estimated = profile.avg_total_ms + queue_delay

                if estimated <= max_latency_ms:
                    candidates.append((model, estimated, load_ratio))

            if not candidates:
                return None

            # Prefer lower load when latencies are similar
            candidates.sort(key=lambda x: (x[1], x[2]))
            return candidates[0][0]

    def acquire(self, model: str) -> bool:
        """Acquire a slot for a model request."""
        with self.lock:
            if self.current_requests[model] >= self.max_concurrent[model]:
                return False
            self.current_requests[model] += 1
            return True

    def release(self, model: str):
        """Release a slot after request completion."""
        with self.lock:
            self.current_requests[model] = max(0, self.current_requests[model] - 1)

    def execute_with_tracking(
        self,
        model: str,
        request_func,
        *args, **kwargs
    ):
        """Execute request with load tracking."""
        if not self.acquire(model):
            raise Exception(f"Model {model} at capacity")

        try:
            return request_func(*args, **kwargs)
        finally:
            self.release(model)

# Usage
load_router = LoadAwareRouter()

model = load_router.route(max_latency_ms=1000)
if model:
    response = load_router.execute_with_tracking(
        model,
        lambda: "make_api_call()"
    )
```

## Timeout and Retry Strategies

Handle latency failures gracefully:

```python
import asyncio
from typing import Optional

class TimeoutRouter:
    def __init__(self, latency_router: LatencyRouter):
        self.latency_router = latency_router
        self.fallback_chain = ["gpt-4o-mini", "claude-3-haiku"]

    async def execute_with_timeout(
        self,
        prompt: str,
        timeout_ms: float,
        model: str = None
    ) -> tuple[str, str, bool]:
        """
        Execute with timeout, falling back to faster models if needed.
        Returns (response, model_used, timed_out)
        """
        if model is None:
            model = self.latency_router.route(
                max_latency_ms=timeout_ms,
                priority=LatencyPriority.TOTAL
            )

        try:
            response = await asyncio.wait_for(
                self._async_complete(model, prompt),
                timeout=timeout_ms / 1000
            )
            return response, model, False

        except asyncio.TimeoutError:
            # Try fallback models
            for fallback in self.fallback_chain:
                if fallback == model:
                    continue
                try:
                    response = await asyncio.wait_for(
                        self._async_complete(fallback, prompt),
                        timeout=timeout_ms / 1000
                    )
                    return response, fallback, True
                except asyncio.TimeoutError:
                    continue

            raise TimeoutError(f"All models timed out for prompt")

    async def _async_complete(self, model: str, prompt: str) -> str:
        # Actual implementation would call the model API
        await asyncio.sleep(0.5)  # Simulate API call
        return f"Response from {model}"

# Usage
async def main():
    tracker = LatencyTracker()
    latency_router = LatencyRouter(tracker)
    timeout_router = TimeoutRouter(latency_router)

    response, model, timed_out = await timeout_router.execute_with_timeout(
        prompt="Explain quantum computing briefly",
        timeout_ms=2000
    )

    if timed_out:
        print(f"Timed out, used fallback: {model}")
    else:
        print(f"Completed with: {model}")
```

## Best Practices

1. **Measure actual latency**: Don't rely only on documentation
2. **Use streaming**: Reduces perceived latency significantly
3. **Deploy regionally**: Network latency adds up
4. **Monitor queue depth**: Load affects latency
5. **Have fast fallbacks**: Always have a quick option

## Conclusion

Latency-based routing is essential for real-time AI applications. Users expect responsive experiences, and the right routing strategy delivers that while still meeting quality requirements.

Measure, stream, and always have a fast fallback ready.

