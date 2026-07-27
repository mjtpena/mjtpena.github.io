---
title: "OpenTelemetry for AI: Standard Observability for LLM Applications"
author: "Michael John Peña"
draft: false
date: 2024-10-13
tags: ["OpenTelemetry", "Observability", "AI", "Tracing", "Metrics"]

---

I wrote "OpenTelemetry for AI: Standard Observability for LLM Applications" to share practical, production-minded guidance on this topic.

## Setting Up OpenTelemetry for AI

```python
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource

# Configure resource with service information
resource = Resource.create({
    "service.name": "ai-agent-service",
    "service.version": "1.0.0",
    "deployment.environment": "production"
})

# Set up tracing
tracer_provider = TracerProvider(resource=resource)
tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter())
)
trace.set_tracer_provider(tracer_provider)

# Set up metrics
metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(),
    export_interval_millis=60000
)
meter_provider = MeterProvider(
    resource=resource,
    metric_readers=[metric_reader]
)
metrics.set_meter_provider(meter_provider)

# Get tracer and meter for AI operations
tracer = trace.get_tracer("ai.agent", "1.0.0")
meter = metrics.get_meter("ai.agent", "1.0.0")
```

## AI-Specific Metrics

```python
from opentelemetry.metrics import Counter, Histogram, UpDownCounter

class AIMetrics:
    """OpenTelemetry metrics for AI applications"""

    def __init__(self, meter):
        # Counters
        self.llm_requests = meter.create_counter(
            name="ai.llm.requests",
            description="Number of LLM API requests",
            unit="1"
        )

        self.tokens_used = meter.create_counter(
            name="ai.llm.tokens",
            description="Total tokens used",
            unit="1"
        )

        self.tool_calls = meter.create_counter(
            name="ai.tools.calls",
            description="Number of tool calls",
            unit="1"
        )

        # Histograms
        self.request_duration = meter.create_histogram(
            name="ai.llm.request.duration",
            description="LLM request duration",
            unit="ms"
        )

        self.tokens_per_request = meter.create_histogram(
            name="ai.llm.tokens_per_request",
            description="Tokens per LLM request",
            unit="1"
        )

        # UpDownCounters
        self.active_sessions = meter.create_up_down_counter(
            name="ai.sessions.active",
            description="Active AI sessions",
            unit="1"
        )

    def record_llm_call(self, model: str, prompt_tokens: int,
                       completion_tokens: int, duration_ms: float,
                       success: bool):
        """Record an LLM call"""
        labels = {
            "model": model,
            "success": str(success)
        }

        self.llm_requests.add(1, labels)
        self.tokens_used.add(prompt_tokens, {**labels, "type": "prompt"})
        self.tokens_used.add(completion_tokens, {**labels, "type": "completion"})
        self.request_duration.record(duration_ms, labels)
        self.tokens_per_request.record(prompt_tokens + completion_tokens, labels)

    def record_tool_call(self, tool_name: str, success: bool, duration_ms: float):
        """Record a tool call"""
        self.tool_calls.add(1, {
            "tool": tool_name,
            "success": str(success)
        })

    def session_started(self):
        """Record session start"""
        self.active_sessions.add(1)

    def session_ended(self):
        """Record session end"""
        self.active_sessions.add(-1)

# Initialize metrics
ai_metrics = AIMetrics(meter)
```

## Span Attributes for AI

```python
from opentelemetry.trace import Status, StatusCode
from contextlib import contextmanager

class AISpanAttributes:
    """Standard attributes for AI spans"""

    # Namespace prefix
    PREFIX = "ai."

    # LLM attributes
    LLM_MODEL = "ai.llm.model"
    LLM_PROVIDER = "ai.llm.provider"
    LLM_PROMPT_TOKENS = "ai.llm.prompt_tokens"
    LLM_COMPLETION_TOKENS = "ai.llm.completion_tokens"
    LLM_TOTAL_TOKENS = "ai.llm.total_tokens"
    LLM_TEMPERATURE = "ai.llm.temperature"
    LLM_MAX_TOKENS = "ai.llm.max_tokens"
    LLM_STOP_REASON = "ai.llm.stop_reason"

    # Cost attributes
    COST_USD = "ai.cost.usd"

    # Tool attributes
    TOOL_NAME = "ai.tool.name"
    TOOL_PARAMETERS = "ai.tool.parameters"
    TOOL_RESULT = "ai.tool.result"

    # Agent attributes
    AGENT_ID = "ai.agent.id"
    AGENT_SESSION_ID = "ai.agent.session_id"
    AGENT_STEP = "ai.agent.step"

class OTelAITracer:
    """OpenTelemetry tracer for AI operations"""

    def __init__(self, tracer, metrics: AIMetrics):
        self.tracer = tracer
        self.metrics = metrics

    @contextmanager
    def llm_call(self, operation: str, model: str, **kwargs):
        """Trace an LLM call"""
        with self.tracer.start_as_current_span(operation) as span:
            span.set_attribute(AISpanAttributes.LLM_MODEL, model)
            span.set_attribute(AISpanAttributes.LLM_PROVIDER, self._get_provider(model))

            if "temperature" in kwargs:
                span.set_attribute(AISpanAttributes.LLM_TEMPERATURE, kwargs["temperature"])
            if "max_tokens" in kwargs:
                span.set_attribute(AISpanAttributes.LLM_MAX_TOKENS, kwargs["max_tokens"])

            start_time = time.time()

            try:
                yield span

            except Exception as e:
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                raise

            finally:
                duration_ms = (time.time() - start_time) * 1000

                # Metrics will be recorded by the caller after setting token counts
                if span.attributes.get(AISpanAttributes.LLM_PROMPT_TOKENS):
                    self.metrics.record_llm_call(
                        model=model,
                        prompt_tokens=span.attributes.get(AISpanAttributes.LLM_PROMPT_TOKENS, 0),
                        completion_tokens=span.attributes.get(AISpanAttributes.LLM_COMPLETION_TOKENS, 0),
                        duration_ms=duration_ms,
                        success=span.status.status_code != StatusCode.ERROR
                    )

    @contextmanager
    def tool_call(self, tool_name: str, parameters: dict = None):
        """Trace a tool call"""
        with self.tracer.start_as_current_span(f"tool.{tool_name}") as span:
            span.set_attribute(AISpanAttributes.TOOL_NAME, tool_name)
            if parameters:
                span.set_attribute(AISpanAttributes.TOOL_PARAMETERS, str(parameters))

            start_time = time.time()

            try:
                yield span
                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                raise

            finally:
                duration_ms = (time.time() - start_time) * 1000
                self.metrics.record_tool_call(
                    tool_name=tool_name,
                    success=span.status.status_code != StatusCode.ERROR,
                    duration_ms=duration_ms
                )

    @contextmanager
    def agent_step(self, agent_id: str, step_name: str, step_number: int):
        """Trace an agent step"""
        with self.tracer.start_as_current_span(f"agent.step.{step_name}") as span:
            span.set_attribute(AISpanAttributes.AGENT_ID, agent_id)
            span.set_attribute(AISpanAttributes.AGENT_STEP, step_number)

            yield span

    def _get_provider(self, model: str) -> str:
        if model.startswith("gpt") or model.startswith("o1"):
            return "openai"
        elif model.startswith("claude"):
            return "anthropic"
        elif model.startswith("gemini"):
            return "google"
        return "unknown"

# Create tracer instance
otel_ai_tracer = OTelAITracer(tracer, ai_metrics)
```

## Instrumented LLM Client

```python
from openai import OpenAI

class InstrumentedOpenAI:
    """OpenAI client with OpenTelemetry instrumentation"""

    def __init__(self, otel_tracer: OTelAITracer):
        self.client = OpenAI()
        self.otel = otel_tracer

    def chat_completion(self, **kwargs) -> dict:
        """Make instrumented chat completion call"""
        model = kwargs.get("model", "gpt-4o")

        with self.otel.llm_call("chat_completion", model, **kwargs) as span:
            response = self.client.chat.completions.create(**kwargs)

            # Set token attributes
            usage = response.usage
            span.set_attribute(AISpanAttributes.LLM_PROMPT_TOKENS, usage.prompt_tokens)
            span.set_attribute(AISpanAttributes.LLM_COMPLETION_TOKENS, usage.completion_tokens)
            span.set_attribute(AISpanAttributes.LLM_TOTAL_TOKENS, usage.total_tokens)
            span.set_attribute(AISpanAttributes.LLM_STOP_REASON, response.choices[0].finish_reason)

            # Calculate and set cost
            cost = self._calculate_cost(model, usage.prompt_tokens, usage.completion_tokens)
            span.set_attribute(AISpanAttributes.COST_USD, cost)

            return response

    def _calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        pricing = {
            "gpt-4o": (2.50, 10.00),
            "gpt-4o-mini": (0.15, 0.60),
        }
        input_rate, output_rate = pricing.get(model, (2.50, 10.00))
        return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000

# Usage
instrumented_client = InstrumentedOpenAI(otel_ai_tracer)

response = instrumented_client.chat_completion(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Exporting to Different Backends

```python
# Export to Jaeger
from opentelemetry.exporter.jaeger.thrift import JaegerExporter

jaeger_exporter = JaegerExporter(
    agent_host_name="localhost",
    agent_port=6831
)

# Export to Zipkin
from opentelemetry.exporter.zipkin.json import ZipkinExporter

zipkin_exporter = ZipkinExporter(
    endpoint="http://localhost:9411/api/v2/spans"
)

# Export to Datadog
from opentelemetry.exporter.datadog import DatadogSpanExporter

datadog_exporter = DatadogSpanExporter(
    agent_url="http://localhost:8126"
)

# Configure based on environment
import os

def get_exporter():
    backend = os.getenv("OTEL_EXPORTER", "otlp")

    if backend == "jaeger":
        return JaegerExporter()
    elif backend == "zipkin":
        return ZipkinExporter()
    elif backend == "datadog":
        return DatadogSpanExporter()
    else:
        return OTLPSpanExporter()
```

OpenTelemetry provides a standardized way to instrument AI applications, ensuring your observability data is portable across different backends and tools.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
