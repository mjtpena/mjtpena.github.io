---
title: "Observability for LLM Applications: Tracing, Metrics, and Debugging"
author: Michael John Peña
draft: false
date: 2025-07-30
tags:
  - Observability
  - LLM
  - Monitoring
  - Azure Monitor
  - OpenTelemetry

---

I wrote "Observability for LLM Applications: Tracing, Metrics, and Debugging" to share practical, production-minded guidance on this topic.

## Implementing LLM Tracing

Use OpenTelemetry to capture detailed traces:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
import functools

# Initialize tracing
trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer(__name__)

exporter = AzureMonitorTraceExporter(
    connection_string="InstrumentationKey=..."
)
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(exporter)
)

def trace_llm_call(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        with tracer.start_as_current_span("llm_completion") as span:
            # Capture request details
            span.set_attribute("llm.model", kwargs.get("model", "unknown"))
            span.set_attribute("llm.temperature", kwargs.get("temperature", 1.0))

            messages = kwargs.get("messages", [])
            span.set_attribute("llm.prompt_messages", len(messages))

            try:
                response = await func(*args, **kwargs)

                # Capture response metrics
                usage = response.usage
                span.set_attribute("llm.prompt_tokens", usage.prompt_tokens)
                span.set_attribute("llm.completion_tokens", usage.completion_tokens)
                span.set_attribute("llm.total_tokens", usage.total_tokens)
                span.set_attribute("llm.finish_reason", response.choices[0].finish_reason)

                return response

            except Exception as e:
                span.set_attribute("llm.error", str(e))
                span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
                raise

    return wrapper
```

## Custom Metrics Dashboard

Track key performance indicators:

```python
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider

meter = metrics.get_meter(__name__)

# Define LLM-specific metrics
token_counter = meter.create_counter(
    "llm.tokens.total",
    description="Total tokens consumed"
)

latency_histogram = meter.create_histogram(
    "llm.latency.seconds",
    description="LLM response latency"
)

cost_counter = meter.create_counter(
    "llm.cost.usd",
    description="Estimated API cost in USD"
)

def record_llm_metrics(model: str, usage: dict, latency: float):
    labels = {"model": model}

    token_counter.add(usage["total_tokens"], labels)
    latency_histogram.record(latency, labels)

    # Calculate cost based on model pricing
    cost = calculate_cost(model, usage)
    cost_counter.add(cost, labels)
```

## Debugging Failed Interactions

Log prompts and responses for failed interactions to a secure store for debugging. Implement sampling for successful calls to control storage costs while maintaining debugging capability.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
