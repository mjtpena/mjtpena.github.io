---
title: "Timeout Management in AI Applications: Balancing Speed and Completeness"
description: "Timeout management in AI applications requires balancing responsiveness with allowing complex operations to complete. Use adaptive timeouts, deadline…"
author: "Michael John Peña"
draft: false
date: 2024-09-27
tags: ["Timeout", "Performance", "AI", "Reliability", "Production"]
---

## Timeout Strategy

```python
from dataclasses import dataclass
from typing import Optional, Callable, Any
import signal
import asyncio
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import time

@dataclass
class TimeoutConfig:
    """Configuration for timeouts"""
    default_timeout: float = 30.0
    max_timeout: float = 300.0
    connect_timeout: float = 10.0
    read_timeout: float = 60.0
    adaptive: bool = True

class TimeoutManager:
    """Manage timeouts for AI operations"""

    def __init__(self, config: TimeoutConfig = None):
        self.config = config or TimeoutConfig()
        self.historical_latencies: list = []
        self.executor = ThreadPoolExecutor(max_workers=20)

    def execute_with_timeout(self, func: Callable, timeout: float = None,
                            *args, **kwargs) -> Any:
        """Execute function with timeout"""

        effective_timeout = self._get_effective_timeout(timeout)

        future = self.executor.submit(func, *args, **kwargs)

        try:
            result = future.result(timeout=effective_timeout)
            self._record_latency(time.time() - future._start_time if hasattr(future, '_start_time') else 0)
            return result

        except FuturesTimeoutError:
            future.cancel()
            raise TimeoutError(f"Operation timed out after {effective_timeout}s")

    async def execute_async_with_timeout(self, coro, timeout: float = None):
        """Execute async operation with timeout"""

        effective_timeout = self._get_effective_timeout(timeout)

        try:
            return await asyncio.wait_for(coro, timeout=effective_timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"Async operation timed out after {effective_timeout}s")

    def _get_effective_timeout(self, requested: Optional[float]) -> float:
        """Calculate effective timeout"""

        if requested is not None:
            return min(requested, self.config.max_timeout)

        if self.config.adaptive and self.historical_latencies:
            # Use p95 latency + buffer
            import statistics
            p95 = statistics.quantiles(self.historical_latencies, n=20)[18]  # ~95th percentile
            adaptive_timeout = p95 * 2  # Double the p95
            return min(adaptive_timeout, self.config.max_timeout)

        return self.config.default_timeout

    def _record_latency(self, latency: float):
        """Record latency for adaptive timeouts"""
        self.historical_latencies.append(latency)
        # Keep last 100 samples
        if len(self.historical_latencies) > 100:
            self.historical_latencies.pop(0)
```

## Operation-Specific Timeouts

```python
class LLMTimeoutPolicy:
    """Timeout policies for different LLM operations"""

    POLICIES = {
        "chat_simple": {
            "timeout": 15,
            "description": "Simple chat completion"
        },
        "chat_complex": {
            "timeout": 60,
            "description": "Complex reasoning task"
        },
        "chat_with_tools": {
            "timeout": 90,
            "description": "Chat with tool execution"
        },
        "embeddings": {
            "timeout": 10,
            "description": "Generate embeddings"
        },
        "image_generation": {
            "timeout": 120,
            "description": "Generate images"
        },
        "vision_analysis": {
            "timeout": 30,
            "description": "Analyze images"
        },
        "o1_reasoning": {
            "timeout": 180,
            "description": "o1 extended reasoning"
        }
    }

    @classmethod
    def get_timeout(cls, operation: str) -> float:
        """Get timeout for operation type"""
        if operation in cls.POLICIES:
            return cls.POLICIES[operation]["timeout"]
        return 30  # Default

    @classmethod
    def estimate_timeout(cls, prompt_length: int, max_tokens: int,
                        has_tools: bool, model: str) -> float:
        """Estimate appropriate timeout based on request parameters"""

        base_timeout = 10

        # Adjust for model
        if model.startswith("o1"):
            base_timeout = 60  # o1 needs more time for reasoning
        elif "gpt-4" in model:
            base_timeout = 15

        # Adjust for prompt length (rough estimate: 4 chars per token)
        prompt_tokens = prompt_length / 4
        token_timeout = (prompt_tokens + max_tokens) / 100  # ~100 tokens/second

        # Adjust for tools
        if has_tools:
            base_timeout += 20

        return min(base_timeout + token_timeout, 300)

# Usage
def call_with_smart_timeout(prompt: str, model: str = "gpt-4o",
                           tools: list = None) -> str:
    timeout = LLMTimeoutPolicy.estimate_timeout(
        prompt_length=len(prompt),
        max_tokens=4096,
        has_tools=bool(tools),
        model=model
    )

    timeout_mgr = TimeoutManager()

    def _call():
        return client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            tools=tools
        ).choices[0].message.content

    return timeout_mgr.execute_with_timeout(_call, timeout=timeout)
```

## Partial Results on Timeout

```python
class PartialResultHandler:
    """Handle partial results when operations timeout"""

    def __init__(self):
        self.partial_results = {}

    async def execute_with_partial_results(self, func: Callable, timeout: float,
                                          result_callback: Callable = None) -> dict:
        """Execute and capture partial results on timeout"""

        partial_content = []
        completed = False

        async def capture_streaming():
            nonlocal completed
            async for chunk in func():
                content = chunk.choices[0].delta.content
                if content:
                    partial_content.append(content)
                    if result_callback:
                        result_callback(content)
            completed = True

        try:
            await asyncio.wait_for(capture_streaming(), timeout=timeout)
            return {
                "success": True,
                "complete": True,
                "content": "".join(partial_content)
            }

        except asyncio.TimeoutError:
            return {
                "success": True,
                "complete": False,
                "content": "".join(partial_content),
                "message": "Response was truncated due to timeout"
            }

# Usage with OpenAI streaming
async def chat_with_partial_results(prompt: str, timeout: float = 30) -> dict:

    async def stream_chat():
        async for chunk in await client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            stream=True
        ):
            yield chunk

    handler = PartialResultHandler()
    return await handler.execute_with_partial_results(stream_chat, timeout)
```

## Deadline Propagation

```python
from contextvars import ContextVar
from datetime import datetime, timedelta

# Context variable for deadline
deadline_context: ContextVar[Optional[datetime]] = ContextVar('deadline', default=None)

class DeadlinePropagator:
    """Propagate deadlines through call chains"""

    @staticmethod
    def set_deadline(timeout_seconds: float):
        """Set deadline for current context"""
        deadline = datetime.now() + timedelta(seconds=timeout_seconds)
        deadline_context.set(deadline)

    @staticmethod
    def get_remaining_timeout() -> Optional[float]:
        """Get remaining time until deadline"""
        deadline = deadline_context.get()
        if deadline is None:
            return None

        remaining = (deadline - datetime.now()).total_seconds()
        return max(0, remaining)

    @staticmethod
    def check_deadline():
        """Raise if deadline exceeded"""
        remaining = DeadlinePropagator.get_remaining_timeout()
        if remaining is not None and remaining <= 0:
            raise TimeoutError("Deadline exceeded")

class deadline_scope:
    """Context manager for deadline propagation"""

    def __init__(self, timeout_seconds: float):
        self.timeout = timeout_seconds
        self.token = None

    def __enter__(self):
        deadline = datetime.now() + timedelta(seconds=self.timeout)
        self.token = deadline_context.set(deadline)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        deadline_context.reset(self.token)
        return False

# Usage
def multi_step_operation(prompt: str):
    """Operation with multiple steps sharing a deadline"""

    with deadline_scope(60):  # 60 second deadline for entire operation

        # Step 1: Embed the prompt
        remaining = DeadlinePropagator.get_remaining_timeout()
        embeddings = get_embeddings(prompt, timeout=remaining)

        DeadlinePropagator.check_deadline()

        # Step 2: Search similar
        remaining = DeadlinePropagator.get_remaining_timeout()
        similar = search_similar(embeddings, timeout=remaining)

        DeadlinePropagator.check_deadline()

        # Step 3: Generate response
        remaining = DeadlinePropagator.get_remaining_timeout()
        response = generate_response(prompt, similar, timeout=remaining)

        return response
```

## Timeout Monitoring

```python
class TimeoutMonitor:
    """Monitor and analyze timeout patterns"""

    def __init__(self):
        self.timeout_events = []
        self.success_latencies = []

    def record_timeout(self, operation: str, configured_timeout: float,
                      actual_duration: float):
        """Record a timeout event"""
        self.timeout_events.append({
            "timestamp": datetime.now().isoformat(),
            "operation": operation,
            "configured_timeout": configured_timeout,
            "actual_duration": actual_duration
        })

    def record_success(self, operation: str, latency: float):
        """Record successful operation"""
        self.success_latencies.append({
            "timestamp": datetime.now().isoformat(),
            "operation": operation,
            "latency": latency
        })

    def analyze(self) -> dict:
        """Analyze timeout patterns"""

        if not self.timeout_events:
            return {"timeouts": 0, "message": "No timeouts recorded"}

        # Group by operation
        by_operation = {}
        for event in self.timeout_events:
            op = event["operation"]
            if op not in by_operation:
                by_operation[op] = []
            by_operation[op].append(event)

        analysis = {
            "total_timeouts": len(self.timeout_events),
            "by_operation": {},
            "recommendations": []
        }

        for op, events in by_operation.items():
            configured = events[0]["configured_timeout"]
            avg_duration = sum(e["actual_duration"] for e in events) / len(events)

            analysis["by_operation"][op] = {
                "count": len(events),
                "configured_timeout": configured,
                "avg_actual_duration": avg_duration
            }

            # Generate recommendation
            if avg_duration > configured * 1.5:
                analysis["recommendations"].append(
                    f"Consider increasing timeout for '{op}' from {configured}s to {avg_duration * 1.2:.1f}s"
                )

        return analysis
```

Timeout management in AI applications requires balancing responsiveness with allowing complex operations to complete. Use adaptive timeouts, deadline propagation, and monitoring to find the right balance for your use case.
