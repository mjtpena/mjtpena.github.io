---
title: "Tracing Frameworks for AI: Distributed Tracing in LLM Applications"
author: "Michael John Peña"
draft: false
date: 2024-10-12
tags: ["Tracing", "Distributed Systems", "AI", "Observability", "OpenTelemetry"]

---

I wrote "Tracing Frameworks for AI: Distributed Tracing in LLM Applications" to share practical, production-minded guidance on this topic.

## Tracing Concepts for AI

```python
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from contextlib import contextmanager
import threading
import time
import uuid

@dataclass
class TraceContext:
    """Context that flows through a distributed trace"""
    trace_id: str
    span_id: str
    parent_span_id: Optional[str] = None
    baggage: Dict[str, str] = field(default_factory=dict)

@dataclass
class AISpan:
    """Span specialized for AI operations"""
    context: TraceContext
    operation_name: str
    service_name: str
    start_time: float
    end_time: Optional[float] = None
    status: str = "UNSET"
    attributes: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict] = field(default_factory=list)

    # AI-specific fields
    model: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0

    def set_ai_metrics(self, model: str, prompt_tokens: int,
                      completion_tokens: int, cost_usd: float = 0.0):
        """Set AI-specific metrics"""
        self.model = model
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = prompt_tokens + completion_tokens
        self.cost_usd = cost_usd
        self.attributes.update({
            "ai.model": model,
            "ai.prompt_tokens": prompt_tokens,
            "ai.completion_tokens": completion_tokens,
            "ai.total_tokens": self.total_tokens,
            "ai.cost_usd": cost_usd
        })

    def add_event(self, name: str, attributes: Dict = None):
        self.events.append({
            "timestamp": time.time(),
            "name": name,
            "attributes": attributes or {}
        })

    def end(self, status: str = "OK"):
        self.end_time = time.time()
        self.status = status

    @property
    def duration_ms(self) -> float:
        if self.end_time:
            return (self.end_time - self.start_time) * 1000
        return 0

class AITracer:
    """Tracer specialized for AI applications"""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.spans: Dict[str, List[AISpan]] = {}
        self._context_var = threading.local()

    def get_current_context(self) -> Optional[TraceContext]:
        return getattr(self._context_var, 'context', None)

    def set_current_context(self, context: TraceContext):
        self._context_var.context = context

    @contextmanager
    def start_span(self, operation_name: str, **attributes) -> AISpan:
        """Start a new span"""
        current_context = self.get_current_context()

        if current_context:
            # Child span
            trace_id = current_context.trace_id
            parent_span_id = current_context.span_id
        else:
            # Root span
            trace_id = str(uuid.uuid4())
            parent_span_id = None

        span_id = str(uuid.uuid4())

        context = TraceContext(
            trace_id=trace_id,
            span_id=span_id,
            parent_span_id=parent_span_id
        )

        span = AISpan(
            context=context,
            operation_name=operation_name,
            service_name=self.service_name,
            start_time=time.time(),
            attributes=attributes
        )

        # Store span
        if trace_id not in self.spans:
            self.spans[trace_id] = []
        self.spans[trace_id].append(span)

        # Set as current context
        old_context = self.get_current_context()
        self.set_current_context(context)

        try:
            yield span
            span.end("OK")
        except Exception as e:
            span.end("ERROR")
            span.add_event("exception", {
                "type": type(e).__name__,
                "message": str(e)
            })
            raise
        finally:
            if old_context:
                self.set_current_context(old_context)
            else:
                self._context_var.context = None

    @contextmanager
    def start_llm_span(self, operation_name: str, model: str) -> AISpan:
        """Start a span specifically for LLM calls"""
        with self.start_span(operation_name, ai_model=model) as span:
            span.add_event("llm_call_start", {"model": model})
            yield span

    def get_trace(self, trace_id: str) -> Dict:
        """Get complete trace data"""
        spans = self.spans.get(trace_id, [])

        return {
            "trace_id": trace_id,
            "spans": [
                {
                    "span_id": s.context.span_id,
                    "parent_span_id": s.context.parent_span_id,
                    "operation": s.operation_name,
                    "service": s.service_name,
                    "duration_ms": s.duration_ms,
                    "status": s.status,
                    "attributes": s.attributes,
                    "events": s.events,
                    "ai_metrics": {
                        "model": s.model,
                        "tokens": s.total_tokens,
                        "cost": s.cost_usd
                    } if s.model else None
                }
                for s in spans
            ],
            "total_duration_ms": self._calculate_trace_duration(spans),
            "total_tokens": sum(s.total_tokens for s in spans),
            "total_cost_usd": sum(s.cost_usd for s in spans)
        }

    def _calculate_trace_duration(self, spans: List[AISpan]) -> float:
        root_spans = [s for s in spans if not s.context.parent_span_id]
        if root_spans:
            return root_spans[0].duration_ms
        return 0
```

## LLM Call Instrumentation

```python
from openai import OpenAI
import functools

class TracedOpenAI:
    """OpenAI client with automatic tracing"""

    def __init__(self, tracer: AITracer):
        self.client = OpenAI()
        self.tracer = tracer

    def chat_completion(self, **kwargs) -> Dict:
        """Make a traced chat completion call"""
        model = kwargs.get("model", "gpt-4o")

        with self.tracer.start_llm_span("chat_completion", model) as span:
            # Add request attributes
            span.attributes["ai.messages_count"] = len(kwargs.get("messages", []))
            span.attributes["ai.max_tokens"] = kwargs.get("max_tokens")
            span.attributes["ai.temperature"] = kwargs.get("temperature")

            # Add event for prompt
            if kwargs.get("messages"):
                span.add_event("prompt", {
                    "system": self._extract_system_message(kwargs["messages"]),
                    "user_length": self._user_message_length(kwargs["messages"])
                })

            # Make the call
            response = self.client.chat.completions.create(**kwargs)

            # Record metrics
            usage = response.usage
            cost = self._calculate_cost(model, usage.prompt_tokens, usage.completion_tokens)

            span.set_ai_metrics(
                model=model,
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                cost_usd=cost
            )

            # Add response event
            span.add_event("response", {
                "finish_reason": response.choices[0].finish_reason,
                "response_length": len(response.choices[0].message.content)
            })

            return response

    def _extract_system_message(self, messages: List[Dict]) -> str:
        for m in messages:
            if m.get("role") == "system":
                return m["content"][:100]  # First 100 chars
        return ""

    def _user_message_length(self, messages: List[Dict]) -> int:
        for m in reversed(messages):
            if m.get("role") == "user":
                return len(m.get("content", ""))
        return 0

    def _calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        # Pricing per million tokens
        pricing = {
            "gpt-4o": (2.50, 10.00),
            "gpt-4o-mini": (0.15, 0.60),
            "o1-preview": (15.00, 60.00)
        }

        input_rate, output_rate = pricing.get(model, (2.50, 10.00))
        return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
```

## Multi-Service Tracing

```python
class DistributedTracer:
    """Handle tracing across multiple services"""

    def __init__(self):
        self.tracers: Dict[str, AITracer] = {}

    def get_tracer(self, service_name: str) -> AITracer:
        """Get or create a tracer for a service"""
        if service_name not in self.tracers:
            self.tracers[service_name] = AITracer(service_name)
        return self.tracers[service_name]

    def inject_context(self, headers: Dict) -> Dict:
        """Inject trace context into headers for propagation"""
        context = None
        for tracer in self.tracers.values():
            context = tracer.get_current_context()
            if context:
                break

        if context:
            headers["X-Trace-ID"] = context.trace_id
            headers["X-Span-ID"] = context.span_id
            if context.baggage:
                headers["X-Baggage"] = ",".join(f"{k}={v}" for k, v in context.baggage.items())

        return headers

    def extract_context(self, headers: Dict) -> Optional[TraceContext]:
        """Extract trace context from headers"""
        trace_id = headers.get("X-Trace-ID")
        span_id = headers.get("X-Span-ID")

        if trace_id and span_id:
            baggage = {}
            if "X-Baggage" in headers:
                for item in headers["X-Baggage"].split(","):
                    k, v = item.split("=")
                    baggage[k] = v

            return TraceContext(
                trace_id=trace_id,
                span_id=span_id,
                baggage=baggage
            )

        return None

# Example: Tracing across agent and tool services
distributed_tracer = DistributedTracer()

# Agent service
agent_tracer = distributed_tracer.get_tracer("agent-service")

async def agent_process_request(request: Dict):
    with agent_tracer.start_span("process_request") as span:
        # Call tool service
        headers = distributed_tracer.inject_context({})
        result = await call_tool_service(request, headers)
        return result

# Tool service
tool_tracer = distributed_tracer.get_tracer("tool-service")

async def tool_endpoint(request: Dict, headers: Dict):
    # Extract context from parent
    parent_context = distributed_tracer.extract_context(headers)

    if parent_context:
        tool_tracer.set_current_context(parent_context)

    with tool_tracer.start_span("execute_tool") as span:
        result = await execute_tool(request)
        return result
```

## Trace Analysis

```python
class TraceAnalyzer:
    """Analyze traces for insights"""

    def __init__(self, tracer: AITracer):
        self.tracer = tracer

    def get_critical_path(self, trace_id: str) -> List[Dict]:
        """Get the critical path through a trace"""
        trace = self.tracer.get_trace(trace_id)
        spans = trace["spans"]

        # Build span tree
        children: Dict[str, List[Dict]] = {}
        for span in spans:
            parent = span["parent_span_id"]
            if parent not in children:
                children[parent] = []
            children[parent].append(span)

        # Find critical path (longest duration at each level)
        def find_path(parent_id: Optional[str]) -> List[Dict]:
            if parent_id not in children:
                return []

            child_spans = children[parent_id]
            if not child_spans:
                return []

            # Get span with longest duration
            longest = max(child_spans, key=lambda s: s["duration_ms"])

            return [longest] + find_path(longest["span_id"])

        root = next((s for s in spans if not s["parent_span_id"]), None)
        if root:
            return [root] + find_path(root["span_id"])

        return []

    def get_ai_summary(self, trace_id: str) -> Dict:
        """Get AI-specific summary for a trace"""
        trace = self.tracer.get_trace(trace_id)

        llm_spans = [s for s in trace["spans"] if s.get("ai_metrics")]

        return {
            "llm_calls": len(llm_spans),
            "total_tokens": trace["total_tokens"],
            "total_cost_usd": trace["total_cost_usd"],
            "models_used": list(set(s["ai_metrics"]["model"] for s in llm_spans if s["ai_metrics"]["model"])),
            "by_model": self._aggregate_by_model(llm_spans)
        }

    def _aggregate_by_model(self, spans: List[Dict]) -> Dict:
        by_model = {}
        for span in spans:
            metrics = span.get("ai_metrics", {})
            model = metrics.get("model")
            if model:
                if model not in by_model:
                    by_model[model] = {"calls": 0, "tokens": 0, "cost": 0}
                by_model[model]["calls"] += 1
                by_model[model]["tokens"] += metrics.get("tokens", 0)
                by_model[model]["cost"] += metrics.get("cost", 0)
        return by_model
```

Effective tracing reveals the inner workings of AI applications, helping you understand performance bottlenecks, cost drivers, and error sources across your entire system.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
