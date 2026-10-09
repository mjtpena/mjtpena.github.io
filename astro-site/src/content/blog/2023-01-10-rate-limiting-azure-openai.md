---
title: "Rate Limiting and Throttling with Azure OpenAI Service"
author: Michael John Peña
draft: false
date: 2023-01-10
tags:
  - Azure
  - OpenAI
  - Rate Limiting
  - Performance
  - Architecture
---

## Understanding Azure OpenAI Quotas

Azure OpenAI uses Tokens Per Minute (TPM) as the primary quota metric:

| Model | Default TPM | Max TPM (with increase) |
|-------|-------------|------------------------|
| GPT-3.5-Turbo | 120K | 300K+ |
| Text-Davinci-003 | 120K | 240K |
| Text-Embedding-Ada-002 | 120K | 350K |

```python
from dataclasses import dataclass
from typing import Optional
import time

@dataclass
class QuotaConfig:
    """Configuration for Azure OpenAI quotas."""
    tokens_per_minute: int = 120000
    requests_per_minute: int = 720  # Approximate based on TPM
    model: str = "gpt-35-turbo"

class QuotaTracker:
    """Track quota usage in real-time."""

    def __init__(self, config: QuotaConfig):
        self.config = config
        self.tokens_used_this_minute = 0
        self.requests_this_minute = 0
        self.minute_start = time.time()

    def _reset_if_new_minute(self):
        """Reset counters if a minute has passed."""
        now = time.time()
        if now - self.minute_start >= 60:
            self.tokens_used_this_minute = 0
            self.requests_this_minute = 0
            self.minute_start = now

    def can_make_request(self, estimated_tokens: int) -> tuple[bool, float]:
        """
        Check if request can be made.
        Returns (can_proceed, wait_time_if_not)
        """
        self._reset_if_new_minute()

        # Check token limit
        if self.tokens_used_this_minute + estimated_tokens > self.config.tokens_per_minute:
            wait_time = 60 - (time.time() - self.minute_start)
            return False, wait_time

        # Check request limit
        if self.requests_this_minute >= self.config.requests_per_minute:
            wait_time = 60 - (time.time() - self.minute_start)
            return False, wait_time

        return True, 0

    def record_usage(self, tokens_used: int):
        """Record token usage from a completed request."""
        self._reset_if_new_minute()
        self.tokens_used_this_minute += tokens_used
        self.requests_this_minute += 1

    def get_remaining(self) -> dict:
        """Get remaining quota for this minute."""
        self._reset_if_new_minute()
        return {
            "tokens_remaining": self.config.tokens_per_minute - self.tokens_used_this_minute,
            "requests_remaining": self.config.requests_per_minute - self.requests_this_minute,
            "seconds_until_reset": max(0, 60 - (time.time() - self.minute_start))
        }
```

## Implementing Retry Logic

Handle rate limit errors with exponential backoff:

```python
import openai
import time
import random
from typing import Callable, TypeVar, Any
from functools import wraps

T = TypeVar('T')

class RateLimitError(Exception):
    """Custom rate limit error with retry info."""
    def __init__(self, message: str, retry_after: Optional[float] = None):
        super().__init__(message)
        self.retry_after = retry_after

def with_retry(
    max_retries: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    jitter: bool = True
) -> Callable:
    """Decorator for retry logic with exponential backoff."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            last_exception = None

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)

                except openai.error.RateLimitError as e:
                    last_exception = e

                    if attempt == max_retries:
                        raise

                    # Parse retry-after header if available
                    retry_after = getattr(e, 'retry_after', None)

                    if retry_after:
                        delay = float(retry_after)
                    else:
                        # Calculate exponential backoff
                        delay = min(
                            base_delay * (exponential_base ** attempt),
                            max_delay
                        )

                    # Add jitter
                    if jitter:
                        delay = delay * (0.5 + random.random())

                    print(f"Rate limited. Retrying in {delay:.2f}s (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)

                except openai.error.ServiceUnavailableError as e:
                    last_exception = e

                    if attempt == max_retries:
                        raise

                    delay = base_delay * (exponential_base ** attempt)
                    if jitter:
                        delay = delay * (0.5 + random.random())

                    print(f"Service unavailable. Retrying in {delay:.2f}s")
                    time.sleep(delay)

            raise last_exception

        return wrapper
    return decorator

# Usage
@with_retry(max_retries=5, base_delay=1.0)
def call_openai(prompt: str, deployment: str) -> str:
    """Make OpenAI call with automatic retry."""
    response = openai.Completion.create(
        engine=deployment,
        prompt=prompt,
        max_tokens=500
    )
    return response.choices[0].text
```

## Client-Side Rate Limiting

Implement proactive rate limiting to avoid hitting Azure limits:

```python
import asyncio
from collections import deque
from datetime import datetime, timedelta
import threading

class TokenBucket:
    """Token bucket rate limiter."""

    def __init__(self, rate: float, capacity: float):
        """
        Args:
            rate: Tokens added per second
            capacity: Maximum tokens in bucket
        """
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.time()
        self.lock = threading.Lock()

    def _refill(self):
        """Refill tokens based on elapsed time."""
        now = time.time()
        elapsed = now - self.last_update
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last_update = now

    def acquire(self, tokens: int = 1, blocking: bool = True) -> bool:
        """
        Acquire tokens from the bucket.

        Args:
            tokens: Number of tokens to acquire
            blocking: If True, wait for tokens; if False, return immediately

        Returns:
            True if tokens acquired, False if not (non-blocking only)
        """
        with self.lock:
            self._refill()

            if self.tokens >= tokens:
                self.tokens -= tokens
                return True

            if not blocking:
                return False

            # Calculate wait time
            needed = tokens - self.tokens
            wait_time = needed / self.rate

        # Wait outside the lock
        time.sleep(wait_time)

        # Try again
        with self.lock:
            self._refill()
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False

    def get_wait_time(self, tokens: int) -> float:
        """Get estimated wait time for acquiring tokens."""
        with self.lock:
            self._refill()
            if self.tokens >= tokens:
                return 0
            needed = tokens - self.tokens
            return needed / self.rate

class RateLimitedOpenAIClient:
    """OpenAI client with client-side rate limiting."""

    def __init__(
        self,
        deployment: str,
        tokens_per_minute: int = 120000,
        requests_per_minute: int = 720
    ):
        self.deployment = deployment

        # Token bucket for TPM (tokens per second = TPM / 60)
        self.token_bucket = TokenBucket(
            rate=tokens_per_minute / 60,
            capacity=tokens_per_minute / 60 * 10  # 10 second burst
        )

        # Token bucket for RPM
        self.request_bucket = TokenBucket(
            rate=requests_per_minute / 60,
            capacity=requests_per_minute / 60 * 10
        )

    def estimate_tokens(self, prompt: str, max_tokens: int) -> int:
        """Estimate total tokens for a request."""
        # Rough estimation: 1 token ≈ 4 characters
        prompt_tokens = len(prompt) // 4
        return prompt_tokens + max_tokens

    @with_retry(max_retries=3)
    def complete(self, prompt: str, max_tokens: int = 500, **kwargs) -> dict:
        """Make rate-limited completion request."""

        estimated_tokens = self.estimate_tokens(prompt, max_tokens)

        # Acquire from both buckets
        self.request_bucket.acquire(1)
        self.token_bucket.acquire(estimated_tokens)

        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            max_tokens=max_tokens,
            **kwargs
        )

        # Return actual usage
        actual_tokens = response.usage.total_tokens

        return {
            "text": response.choices[0].text.strip(),
            "tokens_used": actual_tokens,
            "estimated_tokens": estimated_tokens
        }

    def get_status(self) -> dict:
        """Get current rate limiter status."""
        return {
            "token_bucket_available": self.token_bucket.tokens,
            "request_bucket_available": self.request_bucket.tokens,
            "token_wait_time": self.token_bucket.get_wait_time(1000),
            "request_wait_time": self.request_bucket.get_wait_time(1)
        }
```

## Request Queuing

For high-throughput applications, implement a request queue:

```python
import asyncio
from asyncio import Queue, PriorityQueue
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable
import uuid

@dataclass(order=True)
class PrioritizedRequest:
    priority: int
    request_id: str = field(compare=False)
    prompt: str = field(compare=False)
    callback: Callable[[str], Awaitable[None]] = field(compare=False)
    max_tokens: int = field(compare=False, default=500)

class AsyncRequestQueue:
    """Async request queue with priority support."""

    def __init__(
        self,
        client: RateLimitedOpenAIClient,
        max_concurrent: int = 10,
        queue_size: int = 1000
    ):
        self.client = client
        self.queue: PriorityQueue = PriorityQueue(maxsize=queue_size)
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.running = False

    async def enqueue(
        self,
        prompt: str,
        callback: Callable[[str], Awaitable[None]],
        priority: int = 5,  # 1 = highest, 10 = lowest
        max_tokens: int = 500
    ) -> str:
        """Add request to queue."""
        request_id = str(uuid.uuid4())

        request = PrioritizedRequest(
            priority=priority,
            request_id=request_id,
            prompt=prompt,
            callback=callback,
            max_tokens=max_tokens
        )

        await self.queue.put(request)
        return request_id

    async def _process_request(self, request: PrioritizedRequest):
        """Process a single request."""
        async with self.semaphore:
            try:
                # Run sync client in thread pool
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: self.client.complete(
                        request.prompt,
                        max_tokens=request.max_tokens
                    )
                )

                await request.callback(result["text"])

            except Exception as e:
                await request.callback(f"Error: {str(e)}")

    async def start(self):
        """Start processing queue."""
        self.running = True

        while self.running:
            try:
                request = await asyncio.wait_for(
                    self.queue.get(),
                    timeout=1.0
                )

                # Process in background
                asyncio.create_task(self._process_request(request))

            except asyncio.TimeoutError:
                continue

    def stop(self):
        """Stop processing queue."""
        self.running = False

    def get_queue_size(self) -> int:
        """Get current queue size."""
        return self.queue.qsize()

# Usage
async def example_usage():
    client = RateLimitedOpenAIClient(
        deployment="gpt35",
        tokens_per_minute=120000
    )

    queue = AsyncRequestQueue(client, max_concurrent=10)

    # Start queue processor
    processor_task = asyncio.create_task(queue.start())

    # Define callback
    async def handle_response(response: str):
        print(f"Got response: {response[:100]}...")

    # Enqueue requests
    for i in range(100):
        await queue.enqueue(
            prompt=f"Question {i}: What is cloud computing?",
            callback=handle_response,
            priority=5 if i % 10 != 0 else 1  # Every 10th request is high priority
        )

    # Wait for queue to empty
    while queue.get_queue_size() > 0:
        await asyncio.sleep(1)
        print(f"Queue size: {queue.get_queue_size()}")

    queue.stop()
    await processor_task
```

## Monitoring and Alerting

Track rate limiting events for monitoring:

```python
from prometheus_client import Counter, Gauge, Histogram
import logging

# Prometheus metrics
rate_limit_hits = Counter(
    'openai_rate_limit_hits_total',
    'Total rate limit hits',
    ['deployment']
)

request_latency = Histogram(
    'openai_request_latency_seconds',
    'Request latency in seconds',
    ['deployment']
)

queue_size = Gauge(
    'openai_queue_size',
    'Current request queue size',
    ['deployment']
)

tokens_used = Counter(
    'openai_tokens_used_total',
    'Total tokens used',
    ['deployment', 'type']
)

class MetricsCollector:
    """Collect and export rate limiting metrics."""

    def __init__(self, deployment: str):
        self.deployment = deployment
        self.logger = logging.getLogger("openai_metrics")

    def record_request(self, latency: float, token_count: int, token_type: str):
        """Record a completed request."""
        request_latency.labels(deployment=self.deployment).observe(latency)
        tokens_used.labels(
            deployment=self.deployment,
            type=token_type
        ).inc(token_count)

    def record_rate_limit(self):
        """Record a rate limit hit."""
        rate_limit_hits.labels(deployment=self.deployment).inc()
        self.logger.warning(f"Rate limit hit for {self.deployment}")

    def update_queue_size(self, size: int):
        """Update queue size metric."""
        queue_size.labels(deployment=self.deployment).set(size)
```

## Best Practices

1. **Implement client-side rate limiting**: Don't rely only on server-side limits
2. **Use exponential backoff**: With jitter to avoid thundering herd
3. **Queue requests**: For batch processing and priority handling
4. **Monitor usage**: Track tokens, requests, and rate limit events
5. **Request quota increases**: If you need higher limits
6. **Estimate tokens**: Before requests to manage quota proactively

## Resources

- [Azure OpenAI Quotas and Limits](https://learn.microsoft.com/azure/cognitive-services/openai/quotas-limits)
- [Request Quota Increase](https://learn.microsoft.com/azure/cognitive-services/openai/how-to/quota)
- [Rate Limiting Best Practices](https://learn.microsoft.com/azure/architecture/patterns/rate-limiting-pattern)
