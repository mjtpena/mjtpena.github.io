---
title: "AI Observability with Azure Monitor and Application Insights"
author: Michael John Peña
draft: false
date: 2025-08-07
tags:
  - AI Observability
  - Azure Monitor
  - Application Insights
  - LLMOps
  - Monitoring

---

I wrote "AI Observability with Azure Monitor and Application Insights" to share practical, production-minded guidance on this topic.

## Implementing AI Telemetry

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
from openai import AzureOpenAI
import time

# Configure OpenTelemetry with Azure Monitor
trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer(__name__)

exporter = AzureMonitorTraceExporter(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
trace.get_tracer_provider().add_span_processor(BatchSpanProcessor(exporter))

class ObservableAIClient:
    def __init__(self, openai_client: AzureOpenAI):
        self.client = openai_client

    def chat_completion(self, messages: list, model: str = "gpt-4o"):
        with tracer.start_as_current_span("ai_chat_completion") as span:
            span.set_attribute("ai.model", model)
            span.set_attribute("ai.prompt_messages", len(messages))

            start_time = time.time()

            try:
                response = self.client.chat.completions.create(
                    model=model,
                    messages=messages
                )

                # Record metrics
                duration_ms = (time.time() - start_time) * 1000
                span.set_attribute("ai.duration_ms", duration_ms)
                span.set_attribute("ai.prompt_tokens", response.usage.prompt_tokens)
                span.set_attribute("ai.completion_tokens", response.usage.completion_tokens)
                span.set_attribute("ai.total_tokens", response.usage.total_tokens)
                span.set_attribute("ai.finish_reason", response.choices[0].finish_reason)

                return response

            except Exception as e:
                span.set_attribute("ai.error", str(e))
                span.record_exception(e)
                raise
```

## Key Metrics to Track

Monitor these essential AI metrics: latency (p50, p95, p99), token consumption per request, error rates by model and endpoint, cache hit rates for embeddings, and cost per request. Set up alerts for anomalies in any of these metrics.

## Creating AI Dashboards

Use Azure Workbooks to visualize AI performance trends, cost projections, and quality metrics over time. Correlate AI metrics with user satisfaction scores to understand the business impact of your AI systems.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
