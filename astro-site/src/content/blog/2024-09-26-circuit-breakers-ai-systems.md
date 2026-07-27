---
title: "Circuit Breakers for AI Systems: Preventing Cascade Failures"
author: "Michael John Peña"
draft: false
date: 2024-09-26
tags: ["Circuit Breaker", "Resilience", "AI", "Architecture", "Production"]

---

I wrote "Circuit Breakers for AI Systems: Preventing Cascade Failures" to share practical, production-minded guidance on this topic.

## Circuit Breaker Pattern

```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional, Callable, Any
from datetime import datetime, timedelta
import threading
import time

class CircuitState(Enum):
    CLOSED = "closed"       # Normal operation
    OPEN = "open"           # Failing, reject requests
    HALF_OPEN = "half_open" # Testing if service recovered

@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker"""
    failure_threshold: int = 5           # Failures before opening
    success_threshold: int = 3           # Successes to close from half-open
    timeout_seconds: float = 60          # Time before trying half-open
    half_open_max_calls: int = 3         # Max calls in half-open state

@dataclass
class CircuitStats:
    """Statistics for circuit breaker"""
    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    rejected_calls: int = 0
    last_failure_time: Optional[datetime] = None
    state_changes: list = field(default_factory=list)

class CircuitBreaker:
    """Circuit breaker implementation"""

    def __init__(self, name: str, config: CircuitBreakerConfig = None):
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self.state = CircuitState.CLOSED
        self.stats = CircuitStats()
        self.consecutive_failures = 0
        self.consecutive_successes = 0
        self.half_open_calls = 0
        self.last_state_change = datetime.now()
        self._lock = threading.Lock()

    def call(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function through circuit breaker"""

        with self._lock:
            if not self._can_execute():
                self.stats.rejected_calls += 1
                raise CircuitOpenError(f"Circuit {self.name} is open")

            self.stats.total_calls += 1

        try:
            result = func(*args, **kwargs)
            self._record_success()
            return result

        except Exception as e:
            self._record_failure()
            raise

    def _can_execute(self) -> bool:
        """Check if request can be executed"""

        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            # Check if timeout has passed
            elapsed = datetime.now() - self.last_state_change
            if elapsed.total_seconds() >= self.config.timeout_seconds:
                self._transition_to(CircuitState.HALF_OPEN)
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            if self.half_open_calls < self.config.half_open_max_calls:
                self.half_open_calls += 1
                return True
            return False

        return False

    def _record_success(self):
        """Record successful call"""
        with self._lock:
            self.stats.successful_calls += 1
            self.consecutive_failures = 0
            self.consecutive_successes += 1

            if self.state == CircuitState.HALF_OPEN:
                if self.consecutive_successes >= self.config.success_threshold:
                    self._transition_to(CircuitState.CLOSED)

    def _record_failure(self):
        """Record failed call"""
        with self._lock:
            self.stats.failed_calls += 1
            self.stats.last_failure_time = datetime.now()
            self.consecutive_failures += 1
            self.consecutive_successes = 0

            if self.state == CircuitState.CLOSED:
                if self.consecutive_failures >= self.config.failure_threshold:
                    self._transition_to(CircuitState.OPEN)

            elif self.state == CircuitState.HALF_OPEN:
                self._transition_to(CircuitState.OPEN)

    def _transition_to(self, new_state: CircuitState):
        """Transition to a new state"""
        old_state = self.state
        self.state = new_state
        self.last_state_change = datetime.now()
        self.consecutive_failures = 0
        self.consecutive_successes = 0
        self.half_open_calls = 0

        self.stats.state_changes.append({
            "timestamp": datetime.now().isoformat(),
            "from": old_state.value,
            "to": new_state.value
        })

        logger.info(f"Circuit {self.name}: {old_state.value} -> {new_state.value}")

    def get_status(self) -> dict:
        """Get current circuit status"""
        return {
            "name": self.name,
            "state": self.state.value,
            "stats": {
                "total": self.stats.total_calls,
                "successful": self.stats.successful_calls,
                "failed": self.stats.failed_calls,
                "rejected": self.stats.rejected_calls
            },
            "consecutive_failures": self.consecutive_failures,
            "consecutive_successes": self.consecutive_successes,
            "last_failure": self.stats.last_failure_time.isoformat() if self.stats.last_failure_time else None
        }

class CircuitOpenError(Exception):
    """Raised when circuit is open"""
    pass
```

## LLM-Specific Circuit Breaker

```python
class LLMCircuitBreaker:
    """Circuit breaker specifically for LLM APIs"""

    def __init__(self):
        self.breakers = {
            "openai": CircuitBreaker("openai", CircuitBreakerConfig(
                failure_threshold=5,
                timeout_seconds=60
            )),
            "azure": CircuitBreaker("azure", CircuitBreakerConfig(
                failure_threshold=5,
                timeout_seconds=60
            )),
            "anthropic": CircuitBreaker("anthropic", CircuitBreakerConfig(
                failure_threshold=3,
                timeout_seconds=120
            ))
        }

    def call(self, provider: str, func: Callable, *args, **kwargs) -> Any:
        """Call through appropriate circuit breaker"""
        if provider not in self.breakers:
            return func(*args, **kwargs)

        return self.breakers[provider].call(func, *args, **kwargs)

    def get_available_providers(self) -> list:
        """Get list of available providers"""
        return [
            name for name, breaker in self.breakers.items()
            if breaker.state != CircuitState.OPEN
        ]

    def get_all_status(self) -> dict:
        """Get status of all breakers"""
        return {
            name: breaker.get_status()
            for name, breaker in self.breakers.items()
        }

# Usage
llm_breaker = LLMCircuitBreaker()

def call_openai_safe(prompt: str) -> str:
    def _call():
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    try:
        return llm_breaker.call("openai", _call)
    except CircuitOpenError:
        # Try another provider
        available = llm_breaker.get_available_providers()
        if "anthropic" in available:
            return call_anthropic(prompt)
        raise
```

## Bulkhead Pattern with Circuit Breakers

```python
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from queue import Queue
import threading

class Bulkhead:
    """Isolate failures using bulkheads"""

    def __init__(self, name: str, max_concurrent: int, queue_size: int = 100):
        self.name = name
        self.max_concurrent = max_concurrent
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent)
        self.queue = Queue(maxsize=queue_size)
        self.active_calls = 0
        self._lock = threading.Lock()

    def submit(self, func: Callable, *args, timeout: float = 30, **kwargs) -> Any:
        """Submit work to the bulkhead"""

        with self._lock:
            if self.active_calls >= self.max_concurrent:
                if self.queue.full():
                    raise BulkheadFullError(f"Bulkhead {self.name} is full")
                # Wait for slot
            self.active_calls += 1

        try:
            future = self.executor.submit(func, *args, **kwargs)
            return future.result(timeout=timeout)
        except TimeoutError:
            raise BulkheadTimeoutError(f"Call timed out in bulkhead {self.name}")
        finally:
            with self._lock:
                self.active_calls -= 1

class BulkheadFullError(Exception):
    pass

class BulkheadTimeoutError(Exception):
    pass

class IsolatedLLMService:
    """LLM service with circuit breakers and bulkheads"""

    def __init__(self):
        # Separate bulkheads for different operations
        self.bulkheads = {
            "chat": Bulkhead("chat", max_concurrent=10),
            "embeddings": Bulkhead("embeddings", max_concurrent=20),
            "tools": Bulkhead("tools", max_concurrent=5)
        }

        # Circuit breakers
        self.breakers = {
            "chat": CircuitBreaker("chat"),
            "embeddings": CircuitBreaker("embeddings"),
            "tools": CircuitBreaker("tools")
        }

    def chat(self, prompt: str) -> str:
        """Chat with isolated resources"""

        def _chat():
            return client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}]
            ).choices[0].message.content

        # First through circuit breaker, then bulkhead
        return self.bulkheads["chat"].submit(
            lambda: self.breakers["chat"].call(_chat),
            timeout=30
        )

    def embed(self, texts: list) -> list:
        """Get embeddings with isolated resources"""

        def _embed():
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=texts
            )
            return [d.embedding for d in response.data]

        return self.bulkheads["embeddings"].submit(
            lambda: self.breakers["embeddings"].call(_embed),
            timeout=10
        )
```

## Health Check Integration

```python
class CircuitBreakerHealthCheck:
    """Health check based on circuit breaker status"""

    def __init__(self, breakers: dict[str, CircuitBreaker]):
        self.breakers = breakers

    def is_healthy(self) -> bool:
        """Check if system is healthy"""
        open_circuits = [
            name for name, b in self.breakers.items()
            if b.state == CircuitState.OPEN
        ]

        # Unhealthy if more than half circuits are open
        return len(open_circuits) < len(self.breakers) / 2

    def get_health_status(self) -> dict:
        """Get detailed health status"""
        circuit_status = {}
        for name, breaker in self.breakers.items():
            status = breaker.get_status()
            circuit_status[name] = {
                "state": status["state"],
                "healthy": status["state"] != "open",
                "failure_rate": self._calculate_failure_rate(status)
            }

        overall_healthy = self.is_healthy()

        return {
            "healthy": overall_healthy,
            "circuits": circuit_status,
            "summary": f"{sum(1 for c in circuit_status.values() if c['healthy'])}/{len(circuit_status)} circuits healthy"
        }

    def _calculate_failure_rate(self, status: dict) -> float:
        total = status["stats"]["total"]
        if total == 0:
            return 0.0
        return status["stats"]["failed"] / total

# FastAPI health endpoint
from fastapi import FastAPI, Response

app = FastAPI()
health_check = CircuitBreakerHealthCheck(llm_breaker.breakers)

@app.get("/health")
def health_endpoint():
    status = health_check.get_health_status()

    if status["healthy"]:
        return status
    else:
        return Response(
            content=json.dumps(status),
            status_code=503,
            media_type="application/json"
        )
```

## Adaptive Circuit Breaker

```python
class AdaptiveCircuitBreaker(CircuitBreaker):
    """Circuit breaker that adapts thresholds based on load"""

    def __init__(self, name: str):
        super().__init__(name)
        self.request_rate = 0
        self.rate_samples = []

    def _record_request(self):
        """Track request rate"""
        now = time.time()
        self.rate_samples.append(now)

        # Keep only last minute
        cutoff = now - 60
        self.rate_samples = [t for t in self.rate_samples if t > cutoff]
        self.request_rate = len(self.rate_samples)

        # Adapt thresholds based on load
        self._adapt_thresholds()

    def _adapt_thresholds(self):
        """Adapt thresholds based on current load"""

        if self.request_rate > 100:
            # High load - be more aggressive with circuit breaking
            self.config.failure_threshold = 3
            self.config.timeout_seconds = 30
        elif self.request_rate > 50:
            # Medium load
            self.config.failure_threshold = 5
            self.config.timeout_seconds = 45
        else:
            # Low load - be more tolerant
            self.config.failure_threshold = 10
            self.config.timeout_seconds = 60
```

Circuit breakers are essential for AI systems that depend on external APIs. They prevent resource exhaustion, protect downstream services, and enable graceful degradation when things go wrong.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
