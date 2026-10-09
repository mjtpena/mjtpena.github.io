---
title: "Agent Reliability Patterns: Building Robust AI Systems"
description: "Building reliable agents requires investment in error handling, recovery mechanisms, and observability. These patterns form the foundation for production AI…"
author: "Michael John Peña"
draft: false
date: 2024-09-21
tags: ["AI Agents", "Reliability", "Best Practices", "Architecture", "Production"]
---

## The Reliability Stack

```python
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Callable
from enum import Enum
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AgentState(Enum):
    IDLE = "idle"
    RUNNING = "running"
    WAITING_FOR_TOOL = "waiting_for_tool"
    ERROR = "error"
    COMPLETED = "completed"

@dataclass
class AgentConfig:
    """Configuration for agent reliability"""
    max_iterations: int = 10
    max_tool_retries: int = 3
    timeout_seconds: float = 300
    max_tokens_per_turn: int = 4096
    enable_checkpoints: bool = True
    enable_rollback: bool = True

@dataclass
class AgentCheckpoint:
    """Checkpoint for agent state recovery"""
    iteration: int
    messages: List[Dict]
    tool_results: Dict[str, Any]
    timestamp: float = field(default_factory=time.time)

class ReliableAgent:
    """Agent with built-in reliability patterns"""

    def __init__(self, config: AgentConfig = None):
        self.config = config or AgentConfig()
        self.state = AgentState.IDLE
        self.checkpoints: List[AgentCheckpoint] = []
        self.metrics: Dict[str, Any] = {
            "iterations": 0,
            "tool_calls": 0,
            "errors": 0,
            "retries": 0
        }

    def run(self, task: str) -> str:
        """Run the agent with full reliability handling"""

        self.state = AgentState.RUNNING
        start_time = time.time()
        messages = [{"role": "user", "content": task}]

        try:
            for iteration in range(self.config.max_iterations):
                # Check timeout
                if time.time() - start_time > self.config.timeout_seconds:
                    raise TimeoutError("Agent exceeded time limit")

                self.metrics["iterations"] = iteration + 1

                # Create checkpoint before each iteration
                if self.config.enable_checkpoints:
                    self._create_checkpoint(iteration, messages)

                # Execute iteration
                result = self._execute_iteration(messages)

                if result["done"]:
                    self.state = AgentState.COMPLETED
                    return result["response"]

                messages = result["messages"]

            # Max iterations reached
            logger.warning("Agent reached max iterations")
            return self._graceful_completion(messages)

        except Exception as e:
            self.state = AgentState.ERROR
            self.metrics["errors"] += 1
            logger.error(f"Agent error: {e}")

            # Attempt recovery
            if self.config.enable_rollback and self.checkpoints:
                return self._recover_from_checkpoint()

            raise

    def _execute_iteration(self, messages: List[Dict]) -> Dict:
        """Execute a single iteration with error handling"""

        response = self._call_llm(messages)
        message = response.choices[0].message

        if message.tool_calls:
            self.state = AgentState.WAITING_FOR_TOOL
            messages.append(message)

            for tool_call in message.tool_calls:
                result = self._execute_tool_with_retry(tool_call)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })

            self.state = AgentState.RUNNING
            return {"done": False, "messages": messages}

        else:
            return {"done": True, "response": message.content}

    def _execute_tool_with_retry(self, tool_call) -> str:
        """Execute tool with retries"""

        for attempt in range(self.config.max_tool_retries):
            try:
                self.metrics["tool_calls"] += 1
                return self._execute_tool(tool_call)

            except Exception as e:
                self.metrics["retries"] += 1
                logger.warning(f"Tool execution failed (attempt {attempt + 1}): {e}")

                if attempt == self.config.max_tool_retries - 1:
                    return json.dumps({"error": str(e), "attempts": attempt + 1})

                time.sleep(2 ** attempt)  # Exponential backoff

    def _create_checkpoint(self, iteration: int, messages: List[Dict]):
        """Create a checkpoint for recovery"""
        checkpoint = AgentCheckpoint(
            iteration=iteration,
            messages=messages.copy(),
            tool_results={}
        )
        self.checkpoints.append(checkpoint)

        # Keep only last 5 checkpoints
        if len(self.checkpoints) > 5:
            self.checkpoints.pop(0)

    def _recover_from_checkpoint(self) -> str:
        """Recover from the last good checkpoint"""
        if not self.checkpoints:
            raise RuntimeError("No checkpoints available for recovery")

        checkpoint = self.checkpoints[-1]
        logger.info(f"Recovering from checkpoint at iteration {checkpoint.iteration}")

        # Resume from checkpoint
        messages = checkpoint.messages
        messages.append({
            "role": "system",
            "content": "Previous execution encountered an error. Please continue or provide a partial result."
        })

        return self._graceful_completion(messages)

    def _graceful_completion(self, messages: List[Dict]) -> str:
        """Gracefully complete when normal completion isn't possible"""

        messages.append({
            "role": "user",
            "content": "Please provide the best answer you can with the information gathered so far."
        })

        response = self._call_llm(messages, tools=None)
        return response.choices[0].message.content
```

## Idempotency and Deduplication

```python
import hashlib
from typing import Set

class IdempotentToolExecutor:
    """Ensure tool calls are idempotent"""

    def __init__(self):
        self.executed_calls: Set[str] = set()
        self.results_cache: Dict[str, str] = {}

    def execute(self, tool_call) -> str:
        """Execute tool call with idempotency"""

        # Create idempotency key
        key = self._create_key(tool_call)

        # Check if already executed
        if key in self.executed_calls:
            logger.info(f"Returning cached result for {tool_call.function.name}")
            return self.results_cache[key]

        # Execute and cache
        result = self._do_execute(tool_call)
        self.executed_calls.add(key)
        self.results_cache[key] = result

        return result

    def _create_key(self, tool_call) -> str:
        """Create a unique key for this tool call"""
        data = f"{tool_call.function.name}:{tool_call.function.arguments}"
        return hashlib.sha256(data.encode()).hexdigest()

    def _do_execute(self, tool_call) -> str:
        """Actually execute the tool"""
        # Implementation here
        pass

    def clear_cache(self):
        """Clear the idempotency cache (use carefully)"""
        self.executed_calls.clear()
        self.results_cache.clear()
```

## Health Monitoring

```python
from datetime import datetime, timedelta
from collections import deque

class AgentHealthMonitor:
    """Monitor agent health and performance"""

    def __init__(self, window_size: int = 100):
        self.window_size = window_size
        self.latencies: deque = deque(maxlen=window_size)
        self.errors: deque = deque(maxlen=window_size)
        self.successes: deque = deque(maxlen=window_size)

    def record_success(self, latency_ms: float):
        """Record a successful operation"""
        self.latencies.append(latency_ms)
        self.successes.append(datetime.now())

    def record_error(self, error_type: str):
        """Record an error"""
        self.errors.append((datetime.now(), error_type))

    def get_health_status(self) -> Dict[str, Any]:
        """Get current health status"""

        now = datetime.now()
        recent_window = timedelta(minutes=5)

        # Calculate metrics
        recent_errors = [e for e in self.errors if now - e[0] < recent_window]
        recent_successes = [s for s in self.successes if now - s < recent_window]

        total_recent = len(recent_errors) + len(recent_successes)
        error_rate = len(recent_errors) / total_recent if total_recent > 0 else 0

        avg_latency = sum(self.latencies) / len(self.latencies) if self.latencies else 0
        p99_latency = sorted(self.latencies)[int(len(self.latencies) * 0.99)] if self.latencies else 0

        # Determine health status
        if error_rate > 0.5:
            status = "critical"
        elif error_rate > 0.1:
            status = "degraded"
        elif avg_latency > 5000:
            status = "slow"
        else:
            status = "healthy"

        return {
            "status": status,
            "error_rate": error_rate,
            "avg_latency_ms": avg_latency,
            "p99_latency_ms": p99_latency,
            "recent_errors": len(recent_errors),
            "recent_successes": len(recent_successes)
        }

    def should_circuit_break(self) -> bool:
        """Determine if circuit breaker should activate"""
        health = self.get_health_status()
        return health["status"] == "critical"
```

## Structured Logging

```python
import json
from contextlib import contextmanager

class AgentLogger:
    """Structured logging for agents"""

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.session_id = None
        self.logger = logging.getLogger(f"agent.{agent_id}")

    @contextmanager
    def session(self, task: str):
        """Context manager for logging a session"""
        import uuid
        self.session_id = str(uuid.uuid4())

        self.log_event("session_start", {"task": task})

        try:
            yield
            self.log_event("session_complete", {"status": "success"})
        except Exception as e:
            self.log_event("session_error", {
                "status": "error",
                "error_type": type(e).__name__,
                "error_message": str(e)
            })
            raise
        finally:
            self.session_id = None

    def log_event(self, event_type: str, data: Dict[str, Any]):
        """Log a structured event"""
        event = {
            "timestamp": datetime.now().isoformat(),
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "event_type": event_type,
            **data
        }
        self.logger.info(json.dumps(event))

    def log_tool_call(self, tool_name: str, args: Dict, result: str, duration_ms: float):
        """Log a tool call"""
        self.log_event("tool_call", {
            "tool_name": tool_name,
            "arguments": args,
            "result_length": len(result),
            "duration_ms": duration_ms
        })

    def log_llm_call(self, model: str, tokens: int, duration_ms: float):
        """Log an LLM call"""
        self.log_event("llm_call", {
            "model": model,
            "total_tokens": tokens,
            "duration_ms": duration_ms
        })

# Usage
agent_logger = AgentLogger("shopping-assistant")

with agent_logger.session("Find a laptop under $1000"):
    # Agent execution here
    pass
```

Building reliable agents requires investment in error handling, recovery mechanisms, and observability. These patterns form the foundation for production AI systems.
