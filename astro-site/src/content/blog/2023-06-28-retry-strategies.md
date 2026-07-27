---
title: "Retry Strategies for AI Applications"
author: Michael John Peña
draft: false
date: 2023-06-28
tags:
  - Azure OpenAI
  - Retry
  - Resilience
  - Patterns
  - Production
---

Azure OpenAI rate limits in mid-2023 are set per deployment per region, and hitting them is a normal operating condition rather than an exceptional one for high-traffic applications. The API returns a 429 with a `Retry-After` header that tells you exactly how long to wait — and honoring that header is the most reliable retry strategy for rate limit errors. Beyond that, exponential backoff with jitter (random delay added to prevent thundering herd) is the standard pattern for 503 and 500 errors. I use the `tenacity` library in Python for this: it supports maximum attempt counts, wait strategies, retry predicates based on exception type, and logging of retry events without much boilerplate. The key discipline is separating transient errors (retry) from permanent errors (fail fast) — indiscriminate retrying on content policy violations or malformed requests just wastes quota and delays the caller.

## Retry Strategy Types

```python
from enum import Enum
from abc import ABC, abstractmethod
import random
import time

class RetryStrategy(ABC):
    @abstractmethod
    def get_delay(self, attempt: int) -> float:
        pass

class ConstantRetry(RetryStrategy):
    def __init__(self, delay: float = 1.0):
        self.delay = delay

    def get_delay(self, attempt: int) -> float:
        return self.delay

class LinearRetry(RetryStrategy):
    def __init__(self, initial_delay: float = 1.0, increment: float = 1.0):
        self.initial = initial_delay
        self.increment = increment

    def get_delay(self, attempt: int) -> float:
        return self.initial + (attempt * self.increment)

class ExponentialRetry(RetryStrategy):
    def __init__(self, base_delay: float = 1.0, multiplier: float = 2.0, max_delay: float = 60.0):
        self.base = base_delay
        self.multiplier = multiplier
        self.max_delay = max_delay

    def get_delay(self, attempt: int) -> float:
        delay = self.base * (self.multiplier ** attempt)
        return min(delay, self.max_delay)

class ExponentialWithJitter(ExponentialRetry):
    def __init__(self, base_delay: float = 1.0, multiplier: float = 2.0, max_delay: float = 60.0, jitter_range: float = 0.5):
        super().__init__(base_delay, multiplier, max_delay)
        self.jitter_range = jitter_range

    def get_delay(self, attempt: int) -> float:
        base_delay = super().get_delay(attempt)
        jitter = base_delay * self.jitter_range * random.random()
        return base_delay + jitter
```

## Configurable Retry Handler

```python
from dataclasses import dataclass
from typing import Callable, List, Type
import asyncio

@dataclass
class RetryConfig:
    max_attempts: int = 3
    strategy: RetryStrategy = None
    retryable_exceptions: List[Type[Exception]] = None
    on_retry: Callable = None
    on_failure: Callable = None

    def __post_init__(self):
        if self.strategy is None:
            self.strategy = ExponentialWithJitter()
        if self.retryable_exceptions is None:
            self.retryable_exceptions = [Exception]

class RetryHandler:
    def __init__(self, config: RetryConfig):
        self.config = config

    async def execute(self, func: Callable, *args, **kwargs):
        last_exception = None

        for attempt in range(self.config.max_attempts):
            try:
                return await func(*args, **kwargs)
            except tuple(self.config.retryable_exceptions) as e:
                last_exception = e

                if attempt < self.config.max_attempts - 1:
                    delay = self.config.strategy.get_delay(attempt)

                    if self.config.on_retry:
                        self.config.on_retry(attempt, e, delay)

                    await asyncio.sleep(delay)
                else:
                    if self.config.on_failure:
                        self.config.on_failure(e)

        raise last_exception
```

## Context-Aware Retry

```python
class ContextAwareRetry:
    """Retry with context about the operation"""

    def __init__(self):
        self.attempt_history = []

    async def execute_with_context(
        self,
        func: Callable,
        context: dict,
        config: RetryConfig
    ):
        operation_id = context.get("operation_id", str(uuid.uuid4()))

        for attempt in range(config.max_attempts):
            attempt_context = {
                "operation_id": operation_id,
                "attempt": attempt + 1,
                "max_attempts": config.max_attempts,
                "started_at": datetime.utcnow().isoformat()
            }

            try:
                result = await func()
                self._record_attempt(attempt_context, success=True)
                return result

            except Exception as e:
                attempt_context["error"] = str(e)
                attempt_context["error_type"] = type(e).__name__

                # Determine if retryable based on error type
                if not self._is_retryable(e, config):
                    self._record_attempt(attempt_context, success=False)
                    raise

                if attempt < config.max_attempts - 1:
                    delay = self._calculate_adaptive_delay(e, attempt, config)
                    attempt_context["retry_delay"] = delay
                    self._record_attempt(attempt_context, success=False)
                    await asyncio.sleep(delay)
                else:
                    self._record_attempt(attempt_context, success=False)
                    raise

    def _is_retryable(self, error: Exception, config: RetryConfig) -> bool:
        """Determine if error is retryable"""
        # Check explicit exception types
        if isinstance(error, tuple(config.retryable_exceptions)):
            return True

        # Check error message patterns
        error_msg = str(error).lower()
        retryable_patterns = ["rate limit", "timeout", "connection", "503", "429"]
        return any(pattern in error_msg for pattern in retryable_patterns)

    def _calculate_adaptive_delay(self, error: Exception, attempt: int, config: RetryConfig) -> float:
        """Calculate delay based on error type"""
        base_delay = config.strategy.get_delay(attempt)

        # Check for retry-after header
        if hasattr(error, 'retry_after'):
            return max(error.retry_after, base_delay)

        # Rate limit - longer delay
        if "rate limit" in str(error).lower():
            return base_delay * 2

        return base_delay

    def _record_attempt(self, context: dict, success: bool):
        context["success"] = success
        context["completed_at"] = datetime.utcnow().isoformat()
        self.attempt_history.append(context)
```

## Circuit Breaker Integration

```python
from datetime import datetime, timedelta
from enum import Enum

class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if recovered

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        half_open_max_calls: int = 3
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = timedelta(seconds=recovery_timeout)
        self.half_open_max_calls = half_open_max_calls

        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_failure_time = None
        self.half_open_calls = 0

    def can_execute(self) -> bool:
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            if datetime.utcnow() - self.last_failure_time > self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                self.half_open_calls = 0
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            return self.half_open_calls < self.half_open_max_calls

        return False

    def record_success(self):
        if self.state == CircuitState.HALF_OPEN:
            self.half_open_calls += 1
            if self.half_open_calls >= self.half_open_max_calls:
                self.state = CircuitState.CLOSED
                self.failure_count = 0
        elif self.state == CircuitState.CLOSED:
            self.failure_count = 0

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = datetime.utcnow()

        if self.state == CircuitState.HALF_OPEN:
            self.state = CircuitState.OPEN
        elif self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN

class RetryWithCircuitBreaker:
    def __init__(self, circuit_breaker: CircuitBreaker, retry_config: RetryConfig):
        self.circuit = circuit_breaker
        self.retry_handler = RetryHandler(retry_config)

    async def execute(self, func: Callable, *args, **kwargs):
        if not self.circuit.can_execute():
            raise Exception("Circuit breaker is open")

        try:
            result = await self.retry_handler.execute(func, *args, **kwargs)
            self.circuit.record_success()
            return result
        except Exception as e:
            self.circuit.record_failure()
            raise
```

## Usage Example

```python
# Configure retry for OpenAI calls
retry_config = RetryConfig(
    max_attempts=3,
    strategy=ExponentialWithJitter(base_delay=1.0, multiplier=2.0, max_delay=30.0),
    retryable_exceptions=[RateLimitError, APITimeoutError, APIConnectionError],
    on_retry=lambda attempt, error, delay: logger.warning(
        f"Retry {attempt + 1}: {error}. Waiting {delay:.2f}s"
    )
)

circuit_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=60)
resilient_executor = RetryWithCircuitBreaker(circuit_breaker, retry_config)

async def call_openai(messages: list):
    async def _call():
        return await client.chat.completions.create(
            model="gpt-4",
            messages=messages
        )

    return await resilient_executor.execute(_call)
```

Proper retry strategies make AI applications reliable under various failure conditions. Tomorrow, I will cover fallback patterns.

## Resources

- [Retry Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/retry)
- [Circuit Breaker Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
