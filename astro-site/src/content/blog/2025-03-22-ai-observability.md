---
title: "AI Observability: Monitoring LLM Applications in Production"
description: "Comprehensive observability enables continuous improvement of AI applications."
author: Michael John Peña
draft: false
date: 2025-03-22
tags:
  - AI
  - Observability
  - Monitoring
  - Production
  - DevOps
---

## AI Observability Framework

```python
from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import trace, metrics
from opentelemetry.trace import SpanKind
import time
from dataclasses import dataclass

@dataclass
class LLMMetrics:
    latency_ms: float
    input_tokens: int
    output_tokens: int
    total_cost: float
    model: str

class AIObservability:
    def __init__(self, connection_string: str):
        configure_azure_monitor(connection_string=connection_string)
        self.tracer = trace.get_tracer(__name__)
        self.meter = metrics.get_meter(__name__)

        # Custom metrics
        self.latency_histogram = self.meter.create_histogram(
            "llm.latency",
            description="LLM request latency in ms"
        )
        self.token_counter = self.meter.create_counter(
            "llm.tokens",
            description="Token usage"
        )
        self.cost_counter = self.meter.create_counter(
            "llm.cost",
            description="Estimated cost in USD"
        )
        self.quality_histogram = self.meter.create_histogram(
            "llm.quality_score",
            description="Response quality score"
        )

    def track_llm_call(self, metrics: LLMMetrics, attributes: dict = None):
        """Track LLM call metrics."""
        attrs = {"model": metrics.model, **(attributes or {})}

        self.latency_histogram.record(metrics.latency_ms, attrs)
        self.token_counter.add(metrics.input_tokens, {"type": "input", **attrs})
        self.token_counter.add(metrics.output_tokens, {"type": "output", **attrs})
        self.cost_counter.add(metrics.total_cost, attrs)

    def trace_rag_pipeline(self, question: str):
        """Create trace for RAG pipeline."""
        return self.tracer.start_as_current_span(
            "rag_pipeline",
            kind=SpanKind.INTERNAL,
            attributes={"question": question[:100]}
        )

    def trace_retrieval(self, num_results: int, latency_ms: float):
        """Track retrieval step."""
        span = trace.get_current_span()
        span.set_attribute("retrieval.num_results", num_results)
        span.set_attribute("retrieval.latency_ms", latency_ms)

    def track_quality(self, score: float, dimensions: dict):
        """Track response quality metrics."""
        self.quality_histogram.record(score, dimensions)

    async def evaluate_and_track(self, question: str, response: str, context: str):
        """Evaluate response quality and track metrics."""
        # Compute quality scores
        relevancy = await self.compute_relevancy(question, response)
        faithfulness = await self.compute_faithfulness(response, context)

        self.track_quality(relevancy, {"dimension": "relevancy"})
        self.track_quality(faithfulness, {"dimension": "faithfulness"})

        return {"relevancy": relevancy, "faithfulness": faithfulness}

# Usage with context manager
with observability.trace_rag_pipeline("What are our Q3 sales?") as span:
    docs = retrieve(question)
    observability.trace_retrieval(len(docs), retrieval_time)

    response = generate(question, docs)
    observability.track_llm_call(metrics)
```

Comprehensive observability enables continuous improvement of AI applications.
