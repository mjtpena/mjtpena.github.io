---
title: "Monitoring AI Applications: Observability Patterns for LLM Systems"
description: "LLM systems have unique characteristics: non-deterministic outputs, variable latency, complex cost models, and quality metrics that require semantic…"
author: Michael John Peña
draft: false
date: 2025-11-19
tags:
  - Observability
  - Monitoring
  - LLM
  - Azure Monitor
  - OpenTelemetry
---

## The Observability Challenge

LLM systems have unique characteristics: non-deterministic outputs, variable latency, complex cost models, and quality metrics that require semantic evaluation. Traditional APM tools miss these critical dimensions.

## Implementing Comprehensive Tracing

Use OpenTelemetry to capture the full lifecycle of AI requests:

```python
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from azure.monitor.opentelemetry import configure_azure_monitor
import time

# Configure Azure Monitor integration
configure_azure_monitor(
    connection_string="InstrumentationKey=your-key"
)

tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)

# Custom metrics for LLM monitoring
token_counter = meter.create_counter(
    "llm.tokens.total",
    description="Total tokens processed",
    unit="tokens"
)

latency_histogram = meter.create_histogram(
    "llm.request.duration",
    description="LLM request duration",
    unit="ms"
)

cost_counter = meter.create_counter(
    "llm.cost.total",
    description="Estimated cost in USD",
    unit="usd"
)

class ObservableLLMClient:
    def __init__(self, openai_client, model_pricing: dict):
        self.client = openai_client
        self.pricing = model_pricing

    async def chat_completion(
        self,
        messages: list,
        model: str,
        **kwargs
    ) -> dict:
        """Execute chat completion with full observability."""

        with tracer.start_as_current_span("llm.chat_completion") as span:
            span.set_attribute("llm.model", model)
            span.set_attribute("llm.message_count", len(messages))
            span.set_attribute("llm.temperature", kwargs.get("temperature", 1.0))

            # Estimate input tokens
            input_tokens = self.estimate_tokens(messages)
            span.set_attribute("llm.input_tokens_estimate", input_tokens)

            start_time = time.time()

            try:
                response = await self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    **kwargs
                )

                duration_ms = (time.time() - start_time) * 1000

                # Extract usage metrics
                usage = response.usage
                span.set_attribute("llm.prompt_tokens", usage.prompt_tokens)
                span.set_attribute("llm.completion_tokens", usage.completion_tokens)
                span.set_attribute("llm.total_tokens", usage.total_tokens)
                span.set_attribute("llm.duration_ms", duration_ms)

                # Calculate cost
                cost = self.calculate_cost(model, usage)
                span.set_attribute("llm.cost_usd", cost)

                # Record metrics
                token_counter.add(
                    usage.total_tokens,
                    {"model": model, "type": "total"}
                )
                latency_histogram.record(
                    duration_ms,
                    {"model": model}
                )
                cost_counter.add(
                    cost,
                    {"model": model}
                )

                return response

            except Exception as e:
                span.set_status(trace.Status(trace.StatusCode.ERROR))
                span.record_exception(e)
                raise

    def calculate_cost(self, model: str, usage) -> float:
        """Calculate request cost based on model pricing."""
        pricing = self.pricing.get(model, {"input": 0, "output": 0})

        input_cost = (usage.prompt_tokens / 1000) * pricing["input"]
        output_cost = (usage.completion_tokens / 1000) * pricing["output"]

        return input_cost + output_cost
```

## Quality Monitoring

Track response quality over time:

```python
class QualityMonitor:
    def __init__(self):
        self.quality_gauge = meter.create_gauge(
            "llm.response.quality_score",
            description="Response quality score"
        )

    async def evaluate_response(
        self,
        request: str,
        response: str,
        context: dict
    ) -> dict:
        """Evaluate response quality on multiple dimensions."""

        with tracer.start_as_current_span("llm.quality_evaluation") as span:
            scores = {
                "relevance": await self.score_relevance(request, response),
                "coherence": await self.score_coherence(response),
                "groundedness": await self.score_groundedness(
                    response, context.get("sources", [])
                )
            }

            overall_score = sum(scores.values()) / len(scores)

            for dimension, score in scores.items():
                span.set_attribute(f"quality.{dimension}", score)
                self.quality_gauge.set(
                    score,
                    {"dimension": dimension, "model": context.get("model")}
                )

            return {"scores": scores, "overall": overall_score}
```

## Dashboard Essentials

Key metrics to track include token usage trends, cost by application or user, latency percentiles, error rates by type, and quality scores over time. Azure Monitor workbooks provide customizable dashboards for these AI-specific metrics.

Comprehensive observability transforms AI operations from reactive troubleshooting to proactive optimization, enabling teams to improve quality while managing costs effectively.
