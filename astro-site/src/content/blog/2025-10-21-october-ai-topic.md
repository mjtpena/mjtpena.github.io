---
title: "Monitoring AI Applications with Azure Monitor and Application Insights"
description: "Configure alerts for latency spikes, error rate increases, and token usage anomalies to catch issues before they impact users."
author: Michael John Peña
draft: false
date: 2025-10-21
tags:
  - Azure Monitor
  - Application Insights
  - Observability
  - AI Applications
  - MLOps
---

## Implementing Custom AI Metrics

Track AI-specific metrics in your application:

```python
from opencensus.ext.azure import metrics_exporter
from opencensus.stats import aggregation, measure, stats, view
from opencensus.tags import tag_map
from opentelemetry import metrics
from azure.monitor.opentelemetry import configure_azure_monitor
import time

class AIMetricsTracker:
    def __init__(self, connection_string: str):
        configure_azure_monitor(connection_string=connection_string)

        self.meter = metrics.get_meter(__name__)

        # Define metrics
        self.inference_latency = self.meter.create_histogram(
            name="ai.inference.latency",
            description="Time taken for model inference",
            unit="ms"
        )

        self.token_usage = self.meter.create_counter(
            name="ai.token.usage",
            description="Total tokens consumed"
        )

        self.inference_count = self.meter.create_counter(
            name="ai.inference.count",
            description="Number of inference requests"
        )

        self.error_count = self.meter.create_counter(
            name="ai.error.count",
            description="Number of inference errors"
        )

    def record_inference(
        self,
        latency_ms: float,
        tokens_used: int,
        model_name: str,
        success: bool
    ):
        """Record metrics for an inference call."""

        attributes = {"model": model_name}

        self.inference_latency.record(latency_ms, attributes)
        self.token_usage.add(tokens_used, attributes)
        self.inference_count.add(1, attributes)

        if not success:
            self.error_count.add(1, attributes)
```

## Creating a Monitored AI Service

Wrap AI calls with comprehensive tracking:

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
import logging

tracer = trace.get_tracer(__name__)
logger = logging.getLogger(__name__)

class MonitoredAIService:
    def __init__(self, openai_client, metrics_tracker: AIMetricsTracker):
        self.client = openai_client
        self.metrics = metrics_tracker

    def generate_completion(self, prompt: str, model: str = "gpt-4") -> dict:
        """Generate completion with full observability."""

        with tracer.start_as_current_span("ai_completion") as span:
            span.set_attribute("ai.model", model)
            span.set_attribute("ai.prompt_length", len(prompt))

            start_time = time.time()
            success = True

            try:
                response = self.client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}]
                )

                span.set_attribute("ai.completion_tokens", response.usage.completion_tokens)
                span.set_attribute("ai.prompt_tokens", response.usage.prompt_tokens)
                span.set_status(Status(StatusCode.OK))

                result = {
                    "content": response.choices[0].message.content,
                    "tokens": response.usage.total_tokens
                }

            except Exception as e:
                success = False
                span.set_status(Status(StatusCode.ERROR, str(e)))
                logger.error(f"AI completion failed: {e}")
                raise

            finally:
                latency_ms = (time.time() - start_time) * 1000
                tokens = response.usage.total_tokens if success else 0

                self.metrics.record_inference(
                    latency_ms=latency_ms,
                    tokens_used=tokens,
                    model_name=model,
                    success=success
                )

            return result
```

## Setting Up Alerts

Configure alerts for latency spikes, error rate increases, and token usage anomalies to catch issues before they impact users.
