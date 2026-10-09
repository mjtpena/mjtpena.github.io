---
title: "Agent Observability: Monitoring AI Systems in Production"
description: "Observability transforms AI agents from black boxes into understandable systems. Combine metrics, logs, and traces to gain complete visibility into agent…"
author: "Michael John Peña"
draft: false
date: 2024-10-11
tags: ["Observability", "AI Agents", "Monitoring", "Production", "DevOps"]
---

## The Three Pillars for AI

```python
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from datetime import datetime
import time

# 1. Metrics - What happened
@dataclass
class AgentMetrics:
    """Core metrics for agent observability"""
    # Throughput
    requests_total: int = 0
    requests_succeeded: int = 0
    requests_failed: int = 0

    # Latency
    latency_samples: List[float] = field(default_factory=list)

    # Token usage
    tokens_input: int = 0
    tokens_output: int = 0

    # Tool usage
    tool_calls_total: int = 0
    tool_calls_by_name: Dict[str, int] = field(default_factory=dict)

    # Errors
    errors_by_type: Dict[str, int] = field(default_factory=dict)

    def record_request(self, success: bool, latency_ms: float,
                      input_tokens: int, output_tokens: int):
        self.requests_total += 1
        if success:
            self.requests_succeeded += 1
        else:
            self.requests_failed += 1

        self.latency_samples.append(latency_ms)
        self.tokens_input += input_tokens
        self.tokens_output += output_tokens

    def record_tool_call(self, tool_name: str):
        self.tool_calls_total += 1
        self.tool_calls_by_name[tool_name] = self.tool_calls_by_name.get(tool_name, 0) + 1

    def record_error(self, error_type: str):
        self.errors_by_type[error_type] = self.errors_by_type.get(error_type, 0) + 1

    def get_summary(self) -> Dict:
        latencies = self.latency_samples[-1000:]  # Last 1000 samples
        return {
            "success_rate": self.requests_succeeded / max(1, self.requests_total),
            "avg_latency_ms": sum(latencies) / len(latencies) if latencies else 0,
            "p99_latency_ms": sorted(latencies)[int(len(latencies) * 0.99)] if latencies else 0,
            "total_tokens": self.tokens_input + self.tokens_output,
            "tool_calls": self.tool_calls_total,
            "error_rate": sum(self.errors_by_type.values()) / max(1, self.requests_total)
        }

# 2. Logs - What was said
@dataclass
class AgentLogEntry:
    """Structured log entry for agents"""
    timestamp: str
    level: str
    agent_id: str
    session_id: str
    message: str
    context: Dict[str, Any] = field(default_factory=dict)

# 3. Traces - What path was taken
@dataclass
class Span:
    """A span in a distributed trace"""
    trace_id: str
    span_id: str
    parent_span_id: Optional[str]
    operation_name: str
    start_time: float
    end_time: Optional[float] = None
    status: str = "running"
    attributes: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict] = field(default_factory=list)

    def end(self, status: str = "ok"):
        self.end_time = time.time()
        self.status = status

    def add_event(self, name: str, attributes: Dict = None):
        self.events.append({
            "timestamp": time.time(),
            "name": name,
            "attributes": attributes or {}
        })

    @property
    def duration_ms(self) -> float:
        if self.end_time:
            return (self.end_time - self.start_time) * 1000
        return 0
```

## Observability Platform Integration

```python
from contextlib import contextmanager
import uuid
import threading

class ObservabilityPlatform:
    """Unified observability for AI agents"""

    def __init__(self):
        self.metrics = AgentMetrics()
        self.logs: List[AgentLogEntry] = []
        self.traces: Dict[str, List[Span]] = {}
        self._current_trace = threading.local()

    @contextmanager
    def trace(self, operation_name: str, attributes: Dict = None):
        """Create a trace span"""
        trace_id = getattr(self._current_trace, 'trace_id', None)
        parent_span_id = getattr(self._current_trace, 'span_id', None)

        if not trace_id:
            trace_id = str(uuid.uuid4())
            self._current_trace.trace_id = trace_id
            self.traces[trace_id] = []

        span = Span(
            trace_id=trace_id,
            span_id=str(uuid.uuid4()),
            parent_span_id=parent_span_id,
            operation_name=operation_name,
            start_time=time.time(),
            attributes=attributes or {}
        )

        self.traces[trace_id].append(span)
        old_span_id = getattr(self._current_trace, 'span_id', None)
        self._current_trace.span_id = span.span_id

        try:
            yield span
            span.end("ok")
        except Exception as e:
            span.end("error")
            span.add_event("exception", {"type": type(e).__name__, "message": str(e)})
            raise
        finally:
            self._current_trace.span_id = old_span_id

    def log(self, level: str, message: str, agent_id: str = "",
            session_id: str = "", **context):
        """Log a structured message"""
        entry = AgentLogEntry(
            timestamp=datetime.utcnow().isoformat(),
            level=level,
            agent_id=agent_id,
            session_id=session_id,
            message=message,
            context=context
        )
        self.logs.append(entry)

    def record_llm_call(self, model: str, input_tokens: int,
                       output_tokens: int, latency_ms: float,
                       success: bool):
        """Record an LLM call"""
        self.metrics.record_request(success, latency_ms, input_tokens, output_tokens)

        # Also add to current span
        if hasattr(self._current_trace, 'span_id'):
            trace_id = self._current_trace.trace_id
            for span in self.traces.get(trace_id, []):
                if span.span_id == self._current_trace.span_id:
                    span.add_event("llm_call", {
                        "model": model,
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "latency_ms": latency_ms
                    })

    def get_trace(self, trace_id: str) -> List[Dict]:
        """Get a complete trace"""
        spans = self.traces.get(trace_id, [])
        return [
            {
                "span_id": s.span_id,
                "parent_span_id": s.parent_span_id,
                "operation": s.operation_name,
                "duration_ms": s.duration_ms,
                "status": s.status,
                "events": s.events
            }
            for s in spans
        ]

# Global instance
observability = ObservabilityPlatform()
```

## Instrumented Agent

```python
class InstrumentedAgent:
    """Agent with full observability instrumentation"""

    def __init__(self, agent_id: str, obs: ObservabilityPlatform):
        self.agent_id = agent_id
        self.obs = obs
        self.session_id = str(uuid.uuid4())

    async def process_request(self, user_input: str) -> str:
        """Process a request with full instrumentation"""

        with self.obs.trace("process_request", {"input_length": len(user_input)}) as span:
            self.obs.log("info", "Starting request processing",
                        agent_id=self.agent_id, session_id=self.session_id,
                        input_preview=user_input[:100])

            try:
                # Planning phase
                with self.obs.trace("planning") as plan_span:
                    plan = await self._create_plan(user_input)
                    plan_span.attributes["steps"] = len(plan)

                # Execution phase
                with self.obs.trace("execution") as exec_span:
                    result = await self._execute_plan(plan)
                    exec_span.attributes["tools_used"] = len(result.get("tools", []))

                # Response generation
                with self.obs.trace("response_generation"):
                    response = await self._generate_response(result)

                self.obs.log("info", "Request completed successfully",
                            agent_id=self.agent_id, session_id=self.session_id,
                            response_length=len(response))

                return response

            except Exception as e:
                self.obs.log("error", f"Request failed: {str(e)}",
                            agent_id=self.agent_id, session_id=self.session_id,
                            error_type=type(e).__name__)
                self.obs.metrics.record_error(type(e).__name__)
                raise

    async def _create_plan(self, user_input: str) -> List[Dict]:
        """Create execution plan"""
        start = time.time()

        response = await call_llm("Create a plan for: " + user_input)

        self.obs.record_llm_call(
            model="gpt-4o",
            input_tokens=len(user_input) // 4,
            output_tokens=len(response) // 4,
            latency_ms=(time.time() - start) * 1000,
            success=True
        )

        return parse_plan(response)

    async def _execute_plan(self, plan: List[Dict]) -> Dict:
        """Execute the plan"""
        results = []

        for step in plan:
            with self.obs.trace(f"step_{step['name']}") as step_span:
                if step.get("tool"):
                    self.obs.metrics.record_tool_call(step["tool"])
                    step_span.add_event("tool_call", {"tool": step["tool"]})

                result = await execute_step(step)
                results.append(result)

        return {"results": results, "tools": [s.get("tool") for s in plan if s.get("tool")]}

    async def _generate_response(self, execution_result: Dict) -> str:
        """Generate final response"""
        start = time.time()

        response = await call_llm(f"Generate response from: {execution_result}")

        self.obs.record_llm_call(
            model="gpt-4o",
            input_tokens=100,
            output_tokens=len(response) // 4,
            latency_ms=(time.time() - start) * 1000,
            success=True
        )

        return response
```

## Dashboard Metrics

```python
class AgentDashboard:
    """Dashboard data for agent monitoring"""

    def __init__(self, obs: ObservabilityPlatform):
        self.obs = obs

    def get_overview(self) -> Dict:
        """Get dashboard overview data"""
        metrics = self.obs.metrics

        return {
            "health": self._calculate_health(metrics),
            "throughput": {
                "requests_per_minute": self._calculate_rpm(),
                "tokens_per_minute": self._calculate_tpm()
            },
            "latency": {
                "avg_ms": metrics.get_summary()["avg_latency_ms"],
                "p99_ms": metrics.get_summary()["p99_latency_ms"]
            },
            "errors": {
                "rate": metrics.get_summary()["error_rate"],
                "by_type": metrics.errors_by_type
            },
            "tools": {
                "total_calls": metrics.tool_calls_total,
                "by_name": metrics.tool_calls_by_name
            }
        }

    def _calculate_health(self, metrics: AgentMetrics) -> str:
        summary = metrics.get_summary()

        if summary["error_rate"] > 0.1:
            return "critical"
        if summary["error_rate"] > 0.05:
            return "degraded"
        if summary["avg_latency_ms"] > 5000:
            return "slow"
        return "healthy"

    def _calculate_rpm(self) -> float:
        # Calculate requests per minute from recent activity
        return self.obs.metrics.requests_total / max(1, self._minutes_running())

    def _calculate_tpm(self) -> float:
        total_tokens = self.obs.metrics.tokens_input + self.obs.metrics.tokens_output
        return total_tokens / max(1, self._minutes_running())

    def _minutes_running(self) -> float:
        # This would track actual runtime
        return 10  # Placeholder

    def get_recent_errors(self, limit: int = 10) -> List[Dict]:
        """Get recent error logs"""
        error_logs = [l for l in self.obs.logs if l.level == "error"]
        return [
            {
                "timestamp": l.timestamp,
                "message": l.message,
                "agent_id": l.agent_id,
                "context": l.context
            }
            for l in error_logs[-limit:]
        ]

    def get_slow_traces(self, threshold_ms: float = 5000) -> List[Dict]:
        """Get traces exceeding latency threshold"""
        slow_traces = []

        for trace_id, spans in self.obs.traces.items():
            root_span = next((s for s in spans if not s.parent_span_id), None)
            if root_span and root_span.duration_ms > threshold_ms:
                slow_traces.append({
                    "trace_id": trace_id,
                    "duration_ms": root_span.duration_ms,
                    "operation": root_span.operation_name,
                    "span_count": len(spans)
                })

        return sorted(slow_traces, key=lambda t: t["duration_ms"], reverse=True)[:10]
```

Observability transforms AI agents from black boxes into understandable systems. Combine metrics, logs, and traces to gain complete visibility into agent behavior.
