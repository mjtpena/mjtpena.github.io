---
title: "Implementing Observability for AI Applications with OpenTelemetry"
author: Michael John Peña
draft: false
date: 2025-12-13
tags:
  - Observability
  - OpenTelemetry
  - AI
  - Monitoring
  - Azure

---

I wrote "Implementing Observability for AI Applications with OpenTelemetry" to share practical, production-minded guidance on this topic.

## The Three Pillars for AI

Beyond standard metrics, traces, and logs, AI applications need:
- Token usage tracking
- Latency by model/operation
- Response quality metrics
- Cost attribution

## OpenTelemetry Setup

```python
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter

# Initialize providers
trace.set_tracer_provider(TracerProvider())
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="your-collector:4317"))
)

meter_provider = MeterProvider(
    metric_readers=[PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint="your-collector:4317"),
        export_interval_millis=60000
    )]
)
metrics.set_meter_provider(meter_provider)

tracer = trace.get_tracer("ai-service")
meter = metrics.get_meter("ai-service")
```

## Custom AI Metrics

```python
# Define AI-specific metrics
token_counter = meter.create_counter(
    "ai.tokens.total",
    description="Total tokens used",
    unit="tokens"
)

latency_histogram = meter.create_histogram(
    "ai.completion.latency",
    description="LLM completion latency",
    unit="ms"
)

cost_counter = meter.create_counter(
    "ai.cost.total",
    description="Estimated AI cost",
    unit="usd"
)

class AIMetricsCollector:
    def __init__(self):
        self.pricing = {
            "gpt-4": {"input": 0.03, "output": 0.06},
            "gpt-4o": {"input": 0.005, "output": 0.015},
            "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015}
        }

    def record_completion(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        latency_ms: float,
        user_id: str
    ):
        attributes = {"model": model, "user_id": user_id}

        # Record tokens
        token_counter.add(input_tokens, {**attributes, "direction": "input"})
        token_counter.add(output_tokens, {**attributes, "direction": "output"})

        # Record latency
        latency_histogram.record(latency_ms, attributes)

        # Calculate and record cost
        pricing = self.pricing.get(model, {"input": 0.01, "output": 0.03})
        cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1000
        cost_counter.add(cost, attributes)
```

## Tracing AI Operations

```python
from opentelemetry.trace import Status, StatusCode

async def traced_completion(prompt: str, model: str = "gpt-4"):
    with tracer.start_as_current_span("llm.completion") as span:
        span.set_attribute("ai.model", model)
        span.set_attribute("ai.prompt.length", len(prompt))

        start_time = time.time()
        try:
            response = await openai_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}]
            )

            # Record completion attributes
            span.set_attribute("ai.response.length", len(response.choices[0].message.content))
            span.set_attribute("ai.tokens.input", response.usage.prompt_tokens)
            span.set_attribute("ai.tokens.output", response.usage.completion_tokens)
            span.set_attribute("ai.finish_reason", response.choices[0].finish_reason)

            latency = (time.time() - start_time) * 1000
            metrics_collector.record_completion(
                model, response.usage.prompt_tokens,
                response.usage.completion_tokens, latency, user_id
            )

            return response

        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise
```

## Dashboard Queries (KQL)

```kql
// Token usage by model over time
customMetrics
| where name == "ai.tokens.total"
| summarize TotalTokens = sum(value) by bin(timestamp, 1h), tostring(customDimensions.model)
| render timechart

// P95 latency by model
customMetrics
| where name == "ai.completion.latency"
| summarize P95 = percentile(value, 95) by tostring(customDimensions.model)
```

Observability is essential for AI applications. Without it, you're flying blind on costs, performance, and quality. Implement these patterns early and iterate based on production insights.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
