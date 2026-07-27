---
title: "Rate Limit Management for AI APIs"
author: Michael John Peña
draft: false
date: 2023-08-23
tags:
  - Rate Limiting
  - API Management
  - Azure OpenAI
  - Architecture

---

I wrote "Rate Limit Management for AI APIs" to share practical, production-minded guidance on this topic.

## Rate Limiting Patterns

```python
from functools import wraps
import time

# Token bucket algorithm
class TokenBucket:
    def __init__(self, capacity, refill_rate):
        self.capacity = capacity
        self.tokens = capacity
        self.refill_rate = refill_rate
        self.last_refill = time.time()

    def consume(self, tokens=1):
        self._refill()
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False

    def _refill(self):
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now

# Decorator for rate limiting
def rate_limited(bucket):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            while not bucket.consume():
                time.sleep(0.1)
            return func(*args, **kwargs)
        return wrapper
    return decorator
```

## Exponential Backoff with Jitter

```python
import random

class ExponentialBackoff:
    def __init__(self, base_delay=1, max_delay=60, max_retries=5):
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.max_retries = max_retries

    def calculate_delay(self, attempt):
        # Exponential backoff
        delay = self.base_delay * (2 ** attempt)
        # Cap at max delay
        delay = min(delay, self.max_delay)
        # Add jitter (0.5 to 1.5 multiplier)
        jitter = random.uniform(0.5, 1.5)
        return delay * jitter

    def execute_with_retry(self, func, *args, **kwargs):
        last_error = None
        for attempt in range(self.max_retries):
            try:
                return func(*args, **kwargs)
            except RateLimitError as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    delay = self.calculate_delay(attempt)
                    print(f"Rate limited. Retrying in {delay:.2f}s")
                    time.sleep(delay)
        raise last_error
```

## Multi-Deployment Load Balancing

```python
import random

class LoadBalancer:
    def __init__(self, deployments):
        """
        deployments: list of dicts with 'endpoint', 'key', 'weight'
        """
        self.deployments = deployments
        self.health_status = {d['endpoint']: True for d in deployments}

    def get_deployment(self):
        healthy = [d for d in self.deployments if self.health_status[d['endpoint']]]
        if not healthy:
            # Reset health if all unhealthy
            self.health_status = {d['endpoint']: True for d in self.deployments}
            healthy = self.deployments

        # Weighted random selection
        total_weight = sum(d['weight'] for d in healthy)
        r = random.uniform(0, total_weight)
        cumulative = 0
        for d in healthy:
            cumulative += d['weight']
            if r <= cumulative:
                return d
        return healthy[-1]

    def mark_unhealthy(self, endpoint, duration=60):
        self.health_status[endpoint] = False
        # Auto-recover after duration
        threading.Timer(duration, lambda: self.mark_healthy(endpoint)).start()

    def mark_healthy(self, endpoint):
        self.health_status[endpoint] = True

# Usage
balancer = LoadBalancer([
    {"endpoint": "https://east-us.openai.azure.com", "key": "key1", "weight": 2},
    {"endpoint": "https://west-us.openai.azure.com", "key": "key2", "weight": 1},
])

deployment = balancer.get_deployment()
client = AzureOpenAI(azure_endpoint=deployment['endpoint'], api_key=deployment['key'])
```

## Request Queue with Priority

```python
import heapq
from dataclasses import dataclass, field
from typing import Any

@dataclass(order=True)
class PrioritizedRequest:
    priority: int
    timestamp: float = field(compare=False)
    request: Any = field(compare=False)
    future: Any = field(compare=False)

class PriorityQueue:
    def __init__(self, rate_limiter):
        self.heap = []
        self.rate_limiter = rate_limiter

    async def submit(self, request, priority=5):
        future = asyncio.Future()
        item = PrioritizedRequest(priority, time.time(), request, future)
        heapq.heappush(self.heap, item)
        return await future

    async def process(self):
        while True:
            if self.heap and self.rate_limiter.consume():
                item = heapq.heappop(self.heap)
                try:
                    result = await self._execute(item.request)
                    item.future.set_result(result)
                except Exception as e:
                    item.future.set_exception(e)
            await asyncio.sleep(0.01)
```

## Circuit Breaker Pattern

```python
from enum import Enum

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=30):
        self.state = CircuitState.CLOSED
        self.failures = 0
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.last_failure_time = None

    def call(self, func, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
            else:
                raise Exception("Circuit is open")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except RateLimitError:
            self._on_failure()
            raise

    def _on_success(self):
        self.failures = 0
        self.state = CircuitState.CLOSED

    def _on_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = CircuitState.OPEN
```

## Monitoring Rate Limits

```python
class RateLimitMonitor:
    def __init__(self):
        self.metrics = {
            "requests": 0,
            "rate_limited": 0,
            "retries": 0,
            "failures": 0
        }

    def record_request(self):
        self.metrics["requests"] += 1

    def record_rate_limit(self):
        self.metrics["rate_limited"] += 1

    def record_retry(self):
        self.metrics["retries"] += 1

    def record_failure(self):
        self.metrics["failures"] += 1

    def get_stats(self):
        total = self.metrics["requests"]
        return {
            **self.metrics,
            "rate_limit_pct": self.metrics["rate_limited"] / total * 100 if total else 0,
            "retry_pct": self.metrics["retries"] / total * 100 if total else 0
        }
```

Tomorrow we'll explore token estimation techniques.

## Resources

- [Rate Limiting Patterns](https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern)
- [Circuit Breaker Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Azure OpenAI Best Practices](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/quota)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
