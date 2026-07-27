---
title: "Circuit Breakers for AI Applications: Preventing Cascade Failures"
author: Michael John Peña
draft: false
date: 2023-06-30
tags:
  - Azure OpenAI
  - Circuit Breaker
  - Resilience
  - Architecture
  - Production

---

I wrote "Circuit Breakers for AI Applications: Preventing Cascade Failures" to share practical, production-minded guidance on this topic.

## Circuit Breaker Pattern

```
┌─────────────────────────────────────────────────────┐
│              Circuit Breaker States                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│      ┌────────────┐                                 │
│      │   CLOSED   │ ◀─────────────────┐            │
│      │  (Normal)  │                   │            │
│      └─────┬──────┘                   │            │
│            │                          │            │
│      failures >= threshold      successes >= threshold
│            │                          │            │
│            ▼                          │            │
│      ┌────────────┐           ┌───────┴──────┐    │
│      │    OPEN    │ ────────▶ │  HALF-OPEN   │    │
│      │  (Failing) │  timeout  │  (Testing)   │    │
│      └────────────┘           └──────────────┘    │
│            │                          │            │
│            │                    failure            │
│            └──────────────────────────┘            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Advanced Circuit Breaker

```python
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Callable, Optional
import asyncio
import threading

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

@dataclass
class CircuitBreakerConfig:
    failure_threshold: int = 5
    success_threshold: int = 3
    timeout_seconds: int = 60
    half_open_max_calls: int = 3
    failure_rate_threshold: float = 0.5
    minimum_calls: int = 10
    slow_call_threshold_ms: int = 5000
    slow_call_rate_threshold: float = 0.5

@dataclass
class CircuitMetrics:
    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    slow_calls: int = 0
    last_failure_time: Optional[datetime] = None
    consecutive_failures: int = 0
    consecutive_successes: int = 0

class AdvancedCircuitBreaker:
    def __init__(self, name: str, config: CircuitBreakerConfig = None):
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self.state = CircuitState.CLOSED
        self.metrics = CircuitMetrics()
        self.lock = threading.Lock()
        self.state_change_callbacks: list[Callable] = []
        self.half_open_calls = 0

    def can_execute(self) -> bool:
        with self.lock:
            if self.state == CircuitState.CLOSED:
                return True

            if self.state == CircuitState.OPEN:
                if self._should_attempt_reset():
                    self._transition_to(CircuitState.HALF_OPEN)
                    return True
                return False

            if self.state == CircuitState.HALF_OPEN:
                return self.half_open_calls < self.config.half_open_max_calls

            return False

    def record_success(self, duration_ms: int):
        with self.lock:
            self.metrics.total_calls += 1
            self.metrics.successful_calls += 1
            self.metrics.consecutive_successes += 1
            self.metrics.consecutive_failures = 0

            if duration_ms > self.config.slow_call_threshold_ms:
                self.metrics.slow_calls += 1

            if self.state == CircuitState.HALF_OPEN:
                self.half_open_calls += 1
                if self.metrics.consecutive_successes >= self.config.success_threshold:
                    self._transition_to(CircuitState.CLOSED)

    def record_failure(self, error: Exception = None):
        with self.lock:
            self.metrics.total_calls += 1
            self.metrics.failed_calls += 1
            self.metrics.consecutive_failures += 1
            self.metrics.consecutive_successes = 0
            self.metrics.last_failure_time = datetime.utcnow()

            if self.state == CircuitState.HALF_OPEN:
                self._transition_to(CircuitState.OPEN)
            elif self.state == CircuitState.CLOSED:
                if self._should_open():
                    self._transition_to(CircuitState.OPEN)

    def _should_open(self) -> bool:
        # Check consecutive failures
        if self.metrics.consecutive_failures >= self.config.failure_threshold:
            return True

        # Check failure rate
        if self.metrics.total_calls >= self.config.minimum_calls:
            failure_rate = self.metrics.failed_calls / self.metrics.total_calls
            if failure_rate >= self.config.failure_rate_threshold:
                return True

            # Check slow call rate
            slow_rate = self.metrics.slow_calls / self.metrics.total_calls
            if slow_rate >= self.config.slow_call_rate_threshold:
                return True

        return False

    def _should_attempt_reset(self) -> bool:
        if self.metrics.last_failure_time is None:
            return True
        elapsed = datetime.utcnow() - self.metrics.last_failure_time
        return elapsed >= timedelta(seconds=self.config.timeout_seconds)

    def _transition_to(self, new_state: CircuitState):
        old_state = self.state
        self.state = new_state

        if new_state == CircuitState.HALF_OPEN:
            self.half_open_calls = 0
            self.metrics.consecutive_successes = 0

        if new_state == CircuitState.CLOSED:
            self._reset_metrics()

        for callback in self.state_change_callbacks:
            callback(self.name, old_state, new_state)

    def _reset_metrics(self):
        self.metrics = CircuitMetrics()

    def on_state_change(self, callback: Callable):
        self.state_change_callbacks.append(callback)

    def get_status(self) -> dict:
        return {
            "name": self.name,
            "state": self.state.value,
            "metrics": {
                "total_calls": self.metrics.total_calls,
                "successful_calls": self.metrics.successful_calls,
                "failed_calls": self.metrics.failed_calls,
                "failure_rate": self.metrics.failed_calls / max(self.metrics.total_calls, 1),
                "consecutive_failures": self.metrics.consecutive_failures
            }
        }
```

## Circuit Breaker Decorator

```python
import functools
import time

def circuit_breaker(breaker: AdvancedCircuitBreaker):
    """Decorator to apply circuit breaker to async functions"""

    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            if not breaker.can_execute():
                raise CircuitOpenException(
                    f"Circuit breaker '{breaker.name}' is open"
                )

            start_time = time.time()
            try:
                result = await func(*args, **kwargs)
                duration_ms = (time.time() - start_time) * 1000
                breaker.record_success(int(duration_ms))
                return result
            except Exception as e:
                breaker.record_failure(e)
                raise

        return wrapper
    return decorator

class CircuitOpenException(Exception):
    pass

# Usage
openai_breaker = AdvancedCircuitBreaker(
    "openai",
    CircuitBreakerConfig(
        failure_threshold=3,
        timeout_seconds=30,
        slow_call_threshold_ms=10000
    )
)

@circuit_breaker(openai_breaker)
async def call_openai(messages: list):
    return await client.chat.completions.create(
        model="gpt-4",
        messages=messages
    )
```

## Multi-Service Circuit Breaker Registry

```python
class CircuitBreakerRegistry:
    """Manage circuit breakers for multiple services"""

    def __init__(self):
        self.breakers: dict[str, AdvancedCircuitBreaker] = {}
        self.global_callbacks: list[Callable] = []

    def register(self, name: str, config: CircuitBreakerConfig = None) -> AdvancedCircuitBreaker:
        breaker = AdvancedCircuitBreaker(name, config)
        for callback in self.global_callbacks:
            breaker.on_state_change(callback)
        self.breakers[name] = breaker
        return breaker

    def get(self, name: str) -> Optional[AdvancedCircuitBreaker]:
        return self.breakers.get(name)

    def on_any_state_change(self, callback: Callable):
        self.global_callbacks.append(callback)
        for breaker in self.breakers.values():
            breaker.on_state_change(callback)

    def get_all_status(self) -> dict:
        return {
            name: breaker.get_status()
            for name, breaker in self.breakers.items()
        }

    def get_health(self) -> dict:
        statuses = self.get_all_status()
        total = len(statuses)
        healthy = sum(1 for s in statuses.values() if s["state"] == "closed")
        return {
            "healthy_services": healthy,
            "total_services": total,
            "health_percentage": (healthy / total * 100) if total else 100,
            "services": statuses
        }

# Usage
registry = CircuitBreakerRegistry()

# Register breakers for different AI services
registry.register("openai-gpt4", CircuitBreakerConfig(failure_threshold=3))
registry.register("openai-gpt35", CircuitBreakerConfig(failure_threshold=5))
registry.register("embedding-service", CircuitBreakerConfig(failure_threshold=10))

# Global monitoring
registry.on_any_state_change(
    lambda name, old, new: logger.warning(f"Circuit {name}: {old.value} -> {new.value}")
)
```

## Integration with Fallback

```python
class ResilientAIClient:
    def __init__(self, registry: CircuitBreakerRegistry):
        self.registry = registry
        self.primary_breaker = registry.get("openai-gpt4")
        self.fallback_breaker = registry.get("openai-gpt35")

    async def chat(self, messages: list) -> dict:
        # Try primary with circuit breaker
        if self.primary_breaker.can_execute():
            try:
                start = time.time()
                response = await self._call_gpt4(messages)
                self.primary_breaker.record_success(int((time.time() - start) * 1000))
                return {"response": response, "model": "gpt-4"}
            except Exception as e:
                self.primary_breaker.record_failure(e)

        # Fallback with its own circuit breaker
        if self.fallback_breaker.can_execute():
            try:
                start = time.time()
                response = await self._call_gpt35(messages)
                self.fallback_breaker.record_success(int((time.time() - start) * 1000))
                return {"response": response, "model": "gpt-35-turbo", "fallback": True}
            except Exception as e:
                self.fallback_breaker.record_failure(e)

        # Both circuits open
        raise CircuitOpenException("All AI services unavailable")
```

## Summary: June 2023

This concludes our June 2023 series on Azure, Data, and AI topics. We covered:

- Microsoft Fabric deep dives (Lakehouse, Delta Lake, OneLake)
- Power BI Direct Lake and Semantic Models
- Fabric DevOps (Git, Deployment Pipelines, Monitoring)
- Fabric Security (Roles, Permissions, RLS)
- AI Agent patterns (Function calling, Tool use)
- Production AI patterns (Streaming, Caching, Error handling)
- Resilience patterns (Retry, Fallback, Circuit Breaker)

Building resilient AI applications requires thoughtful architecture and proper error handling. The patterns covered this month provide a foundation for production-ready AI systems.

## Resources

- [Circuit Breaker Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Resilience4j](https://resilience4j.readme.io/)
- [Azure Architecture Center](https://docs.microsoft.com/en-us/azure/architecture/)

