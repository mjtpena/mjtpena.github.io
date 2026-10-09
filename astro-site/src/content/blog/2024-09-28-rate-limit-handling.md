---
title: "Rate Limit Handling: Maximizing Throughput Within Constraints"
description: "Effective rate limit handling is about working with the API, not against it. Use token buckets, queuing, and adaptive limits to maximize throughput while…"
author: "Michael John Peña"
draft: false
date: 2024-09-28
tags: ["Rate Limiting", "Throughput", "AI", "Performance", "Production"]
---

## Understanding Rate Limits

```python
from dataclasses import dataclass
from typing import Dict, Optional
import time
from collections import deque
import threading

@dataclass
class RateLimitConfig:
    """Rate limit configuration"""
    requests_per_minute: int
    tokens_per_minute: int
    requests_per_day: Optional[int] = None

# OpenAI rate limits by tier (approximate)
RATE_LIMITS = {
    "tier_1": RateLimitConfig(
        requests_per_minute=500,
        tokens_per_minute=30_000,
        requests_per_day=10_000
    ),
    "tier_2": RateLimitConfig(
        requests_per_minute=5_000,
        tokens_per_minute=450_000,
        requests_per_day=None
    ),
    "tier_3": RateLimitConfig(
        requests_per_minute=5_000,
        tokens_per_minute=800_000,
        requests_per_day=None
    ),
    "o1_preview": RateLimitConfig(
        requests_per_minute=20,
        tokens_per_minute=30_000,
        requests_per_day=100
    )
}

class RateLimitTracker:
    """Track and enforce rate limits"""

    def __init__(self, config: RateLimitConfig):
        self.config = config
        self.request_times: deque = deque()
        self.token_counts: deque = deque()
        self.daily_requests = 0
        self.last_reset = time.time()
        self._lock = threading.Lock()

    def can_make_request(self, estimated_tokens: int = 1000) -> tuple[bool, float]:
        """Check if request can be made, return (can_proceed, wait_time)"""

        with self._lock:
            now = time.time()
            minute_ago = now - 60

            # Clean old entries
            while self.request_times and self.request_times[0] < minute_ago:
                self.request_times.popleft()
            while self.token_counts and self.token_counts[0][0] < minute_ago:
                self.token_counts.popleft()

            # Check request rate
            if len(self.request_times) >= self.config.requests_per_minute:
                wait_time = self.request_times[0] - minute_ago
                return False, wait_time

            # Check token rate
            current_tokens = sum(tc[1] for tc in self.token_counts)
            if current_tokens + estimated_tokens > self.config.tokens_per_minute:
                wait_time = self.token_counts[0][0] - minute_ago
                return False, wait_time

            # Check daily limit
            if self.config.requests_per_day:
                self._check_daily_reset()
                if self.daily_requests >= self.config.requests_per_day:
                    return False, self._time_until_daily_reset()

            return True, 0

    def record_request(self, tokens_used: int):
        """Record a completed request"""
        with self._lock:
            now = time.time()
            self.request_times.append(now)
            self.token_counts.append((now, tokens_used))
            self.daily_requests += 1

    def _check_daily_reset(self):
        """Reset daily counter if needed"""
        now = time.time()
        if now - self.last_reset > 86400:  # 24 hours
            self.daily_requests = 0
            self.last_reset = now

    def _time_until_daily_reset(self) -> float:
        """Calculate time until daily reset"""
        return 86400 - (time.time() - self.last_reset)

    def get_usage_stats(self) -> dict:
        """Get current usage statistics"""
        with self._lock:
            now = time.time()
            minute_ago = now - 60

            current_requests = len([t for t in self.request_times if t > minute_ago])
            current_tokens = sum(tc[1] for tc in self.token_counts if tc[0] > minute_ago)

            return {
                "rpm_used": current_requests,
                "rpm_limit": self.config.requests_per_minute,
                "rpm_utilization": current_requests / self.config.requests_per_minute,
                "tpm_used": current_tokens,
                "tpm_limit": self.config.tokens_per_minute,
                "tpm_utilization": current_tokens / self.config.tokens_per_minute,
                "daily_used": self.daily_requests,
                "daily_limit": self.config.requests_per_day
            }
```

## Token Bucket Algorithm

```python
class TokenBucket:
    """Token bucket rate limiter"""

    def __init__(self, capacity: int, refill_rate: float):
        """
        capacity: Maximum tokens in bucket
        refill_rate: Tokens added per second
        """
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens = capacity
        self.last_refill = time.time()
        self._lock = threading.Lock()

    def acquire(self, tokens: int = 1, blocking: bool = True) -> bool:
        """
        Acquire tokens from bucket
        Returns True if acquired, False if not (when non-blocking)
        """
        while True:
            with self._lock:
                self._refill()

                if self.tokens >= tokens:
                    self.tokens -= tokens
                    return True

                if not blocking:
                    return False

                # Calculate wait time
                tokens_needed = tokens - self.tokens
                wait_time = tokens_needed / self.refill_rate

            time.sleep(min(wait_time, 1.0))  # Wait in small increments

    def _refill(self):
        """Refill tokens based on elapsed time"""
        now = time.time()
        elapsed = now - self.last_refill
        new_tokens = elapsed * self.refill_rate
        self.tokens = min(self.capacity, self.tokens + new_tokens)
        self.last_refill = now

# Dual token bucket for requests and tokens
class DualTokenBucket:
    """Separate buckets for request rate and token rate"""

    def __init__(self, rpm: int, tpm: int):
        # Requests per second = rpm / 60
        self.request_bucket = TokenBucket(rpm, rpm / 60)
        # Tokens per second = tpm / 60
        self.token_bucket = TokenBucket(tpm, tpm / 60)

    def acquire(self, estimated_tokens: int = 1000) -> bool:
        """Acquire from both buckets"""
        # First check if we can get request slot
        if not self.request_bucket.acquire(1, blocking=True):
            return False

        # Then acquire token budget
        return self.token_bucket.acquire(estimated_tokens, blocking=True)

# Usage
rate_limiter = DualTokenBucket(rpm=500, tpm=30_000)

def rate_limited_call(prompt: str) -> str:
    # Estimate tokens
    estimated_tokens = len(prompt) // 4 + 1000  # rough estimate

    # Wait for rate limit
    rate_limiter.acquire(estimated_tokens)

    # Make the call
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content
```

## Adaptive Rate Limiting

```python
class AdaptiveRateLimiter:
    """Adjust rate limiting based on actual API responses"""

    def __init__(self, initial_rpm: int, initial_tpm: int):
        self.rpm = initial_rpm
        self.tpm = initial_tpm
        self.rate_limit_hits = 0
        self.successful_requests = 0

    def adjust_from_headers(self, headers: dict):
        """Adjust limits based on API response headers"""

        # OpenAI includes rate limit info in headers
        if 'x-ratelimit-limit-requests' in headers:
            self.rpm = int(headers['x-ratelimit-limit-requests'])

        if 'x-ratelimit-limit-tokens' in headers:
            self.tpm = int(headers['x-ratelimit-limit-tokens'])

        # Track remaining
        remaining_requests = headers.get('x-ratelimit-remaining-requests')
        remaining_tokens = headers.get('x-ratelimit-remaining-tokens')

        return {
            "rpm_limit": self.rpm,
            "tpm_limit": self.tpm,
            "remaining_requests": remaining_requests,
            "remaining_tokens": remaining_tokens
        }

    def record_rate_limit(self, retry_after: float):
        """Record when we hit a rate limit"""
        self.rate_limit_hits += 1

        # Reduce our assumed limits
        if self.rate_limit_hits > 3:
            self.rpm = int(self.rpm * 0.8)
            self.tpm = int(self.tpm * 0.8)
            self.rate_limit_hits = 0
            logger.warning(f"Reducing rate limits to RPM={self.rpm}, TPM={self.tpm}")

    def record_success(self):
        """Record successful request"""
        self.successful_requests += 1

        # Gradually increase if we've been successful
        if self.successful_requests > 100:
            self.rpm = int(self.rpm * 1.1)
            self.tpm = int(self.tpm * 1.1)
            self.successful_requests = 0
            logger.info(f"Increasing rate limits to RPM={self.rpm}, TPM={self.tpm}")
```

## Request Queue with Rate Limiting

```python
import asyncio
from typing import List, Callable
from dataclasses import dataclass, field
from queue import PriorityQueue
import heapq

@dataclass(order=True)
class PrioritizedRequest:
    """Request with priority for queue ordering"""
    priority: int
    request_id: str = field(compare=False)
    func: Callable = field(compare=False)
    args: tuple = field(compare=False)
    kwargs: dict = field(compare=False)

class RateLimitedQueue:
    """Queue that processes requests within rate limits"""

    def __init__(self, rpm: int, tpm: int):
        self.rate_limiter = DualTokenBucket(rpm, tpm)
        self.queue: List = []
        self.results: Dict[str, Any] = {}
        self.running = False
        self._lock = threading.Lock()

    def submit(self, func: Callable, priority: int = 5,
               estimated_tokens: int = 1000, *args, **kwargs) -> str:
        """Submit request to queue"""
        import uuid
        request_id = str(uuid.uuid4())

        request = PrioritizedRequest(
            priority=priority,
            request_id=request_id,
            func=func,
            args=args,
            kwargs={**kwargs, "_estimated_tokens": estimated_tokens}
        )

        with self._lock:
            heapq.heappush(self.queue, request)

        return request_id

    def get_result(self, request_id: str, timeout: float = 60) -> Any:
        """Get result for a submitted request"""
        start = time.time()
        while time.time() - start < timeout:
            if request_id in self.results:
                return self.results.pop(request_id)
            time.sleep(0.1)
        raise TimeoutError(f"Request {request_id} timed out")

    def start_processing(self):
        """Start background processing"""
        self.running = True
        threading.Thread(target=self._process_loop, daemon=True).start()

    def _process_loop(self):
        """Process requests from queue"""
        while self.running:
            with self._lock:
                if not self.queue:
                    time.sleep(0.1)
                    continue

                request = heapq.heappop(self.queue)

            estimated_tokens = request.kwargs.pop("_estimated_tokens", 1000)

            # Wait for rate limit
            self.rate_limiter.acquire(estimated_tokens)

            # Execute
            try:
                result = request.func(*request.args, **request.kwargs)
                self.results[request.request_id] = {"success": True, "result": result}
            except Exception as e:
                self.results[request.request_id] = {"success": False, "error": str(e)}

# Usage
queue = RateLimitedQueue(rpm=500, tpm=30_000)
queue.start_processing()

# Submit multiple requests
request_ids = []
for prompt in prompts:
    req_id = queue.submit(
        lambda p=prompt: call_openai(p),
        priority=5,
        estimated_tokens=2000
    )
    request_ids.append(req_id)

# Collect results
results = [queue.get_result(rid) for rid in request_ids]
```

## Rate Limit Error Handling

```python
from openai import RateLimitError

def handle_rate_limit_error(error: RateLimitError) -> float:
    """Extract wait time from rate limit error"""

    # Check for retry-after header
    retry_after = error.response.headers.get('retry-after')
    if retry_after:
        return float(retry_after)

    # Check error message for hints
    message = str(error)
    if "Please retry after" in message:
        # Parse time from message
        import re
        match = re.search(r'(\d+)\s*seconds?', message)
        if match:
            return float(match.group(1))

    # Default backoff
    return 60

def call_with_rate_limit_handling(func: Callable, max_retries: int = 5) -> Any:
    """Call function with rate limit handling"""

    for attempt in range(max_retries):
        try:
            return func()

        except RateLimitError as e:
            if attempt == max_retries - 1:
                raise

            wait_time = handle_rate_limit_error(e)
            logger.warning(f"Rate limited. Waiting {wait_time}s before retry...")
            time.sleep(wait_time)

    raise RuntimeError("Max retries exceeded")
```

Effective rate limit handling is about working with the API, not against it. Use token buckets, queuing, and adaptive limits to maximize throughput while maintaining reliability.
