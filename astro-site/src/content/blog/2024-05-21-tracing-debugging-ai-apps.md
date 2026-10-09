---
title: "Tracing and Debugging AI Applications"
description: "Debugging AI applications is different from traditional software. Today I'm exploring tracing and debugging techniques for production AI systems."
author: Michael John Peña
draft: false
date: 2024-05-21
tags:
  - Azure
  - Observability
  - Debugging
  - OpenTelemetry
  - Azure AI
---

Debugging AI applications is different from traditional software. Today I'm exploring tracing and debugging techniques for production AI systems.

## Why AI Tracing is Different

Traditional debugging:
- Deterministic behavior
- Clear error messages
- Stack traces

AI debugging:
- Probabilistic outputs
- Quality issues vs errors
- Prompt/context problems
- Model behavior changes

## OpenTelemetry for AI

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter

# Setup tracing
trace.set_tracer_provider(TracerProvider())
tracer_provider = trace.get_tracer_provider()

# Export to Azure Monitor
azure_exporter = AzureMonitorTraceExporter(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
tracer_provider.add_span_processor(BatchSpanProcessor(azure_exporter))

# Get tracer
tracer = trace.get_tracer(__name__)
```

## Tracing AI Calls

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind
import json

tracer = trace.get_tracer(__name__)

class TracedOpenAIClient:
    def __init__(self, client):
        self.client = client

    def chat_completion(self, messages: list, **kwargs) -> dict:
        with tracer.start_as_current_span(
            "openai.chat.completion",
            kind=SpanKind.CLIENT
        ) as span:
            # Record input
            span.set_attribute("ai.model", kwargs.get("model", "unknown"))
            span.set_attribute("ai.messages_count", len(messages))
            span.set_attribute("ai.temperature", kwargs.get("temperature", 1.0))
            span.set_attribute("ai.max_tokens", kwargs.get("max_tokens", 0))

            # Optionally record messages (be careful with PII)
            if os.environ.get("TRACE_PROMPTS", "false") == "true":
                span.set_attribute("ai.messages", json.dumps(messages))

            try:
                response = self.client.chat.completions.create(
                    messages=messages,
                    **kwargs
                )

                # Record output metrics
                span.set_attribute("ai.completion_tokens", response.usage.completion_tokens)
                span.set_attribute("ai.prompt_tokens", response.usage.prompt_tokens)
                span.set_attribute("ai.total_tokens", response.usage.total_tokens)
                span.set_attribute("ai.finish_reason", response.choices[0].finish_reason)

                return response

            except Exception as e:
                span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
                span.record_exception(e)
                raise
```

## RAG Pipeline Tracing

```python
class TracedRAGPipeline:
    def __init__(self, retriever, generator):
        self.retriever = retriever
        self.generator = generator

    def query(self, question: str) -> dict:
        with tracer.start_as_current_span("rag.query") as parent_span:
            parent_span.set_attribute("rag.question", question)

            # Trace retrieval
            with tracer.start_as_current_span("rag.retrieve") as retrieve_span:
                documents = self.retriever.search(question)
                retrieve_span.set_attribute("rag.documents_retrieved", len(documents))
                retrieve_span.set_attribute("rag.top_score", documents[0].score if documents else 0)

            # Trace generation
            with tracer.start_as_current_span("rag.generate") as generate_span:
                context = "\n".join([d.content for d in documents])
                generate_span.set_attribute("rag.context_length", len(context))

                response = self.generator.generate(question, context)
                generate_span.set_attribute("rag.response_length", len(response))

            parent_span.set_attribute("rag.success", True)
            return {
                "answer": response,
                "sources": [d.metadata for d in documents]
            }
```

## Prompt Flow Tracing

```python
from promptflow.tracing import start_trace, trace

# Enable tracing
start_trace(
    collection="my-rag-app",
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)

@trace
def retrieve_documents(query: str) -> list:
    """This function is automatically traced."""
    # Retrieval logic
    return documents

@trace
def generate_answer(context: str, question: str) -> str:
    """This function is automatically traced."""
    # Generation logic
    return answer
```

## Custom Metrics

```python
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from azure.monitor.opentelemetry.exporter import AzureMonitorMetricExporter

# Setup metrics
exporter = AzureMonitorMetricExporter(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
reader = PeriodicExportingMetricReader(exporter, export_interval_millis=60000)
metrics.set_meter_provider(MeterProvider(metric_readers=[reader]))

meter = metrics.get_meter(__name__)

# Create metrics
token_counter = meter.create_counter(
    "ai.tokens.total",
    description="Total tokens used",
    unit="tokens"
)

latency_histogram = meter.create_histogram(
    "ai.latency",
    description="AI call latency",
    unit="ms"
)

quality_gauge = meter.create_observable_gauge(
    "ai.quality.score",
    callbacks=[lambda: get_quality_scores()],
    description="AI quality scores"
)

# Record metrics
def record_ai_call(model: str, tokens: int, latency_ms: float):
    token_counter.add(tokens, {"model": model})
    latency_histogram.record(latency_ms, {"model": model})
```

## Debugging Common Issues

### Hallucination Detection

```python
class HallucinationDebugger:
    def __init__(self, tracer):
        self.tracer = tracer

    def analyze_response(
        self,
        question: str,
        context: str,
        response: str
    ) -> dict:
        with self.tracer.start_as_current_span("debug.hallucination") as span:
            # Check for claims not in context
            claims = self._extract_claims(response)
            grounded_claims = []
            ungrounded_claims = []

            for claim in claims:
                if self._is_grounded(claim, context):
                    grounded_claims.append(claim)
                else:
                    ungrounded_claims.append(claim)

            span.set_attribute("debug.total_claims", len(claims))
            span.set_attribute("debug.grounded_claims", len(grounded_claims))
            span.set_attribute("debug.ungrounded_claims", len(ungrounded_claims))

            if ungrounded_claims:
                span.add_event(
                    "potential_hallucination",
                    {"claims": str(ungrounded_claims)}
                )

            return {
                "grounded_ratio": len(grounded_claims) / len(claims) if claims else 1.0,
                "ungrounded_claims": ungrounded_claims
            }

    def _extract_claims(self, text: str) -> list:
        # Use NLP to extract factual claims
        sentences = text.split(". ")
        return [s for s in sentences if self._is_factual(s)]

    def _is_grounded(self, claim: str, context: str) -> bool:
        # Check if claim can be verified from context
        # Simplified - in practice use semantic similarity
        return any(word in context.lower() for word in claim.lower().split())

    def _is_factual(self, sentence: str) -> bool:
        # Check if sentence contains factual claims
        factual_indicators = ["is", "are", "was", "were", "has", "have"]
        return any(ind in sentence.lower() for ind in factual_indicators)
```

### Retrieval Quality Debugging

```python
class RetrievalDebugger:
    def __init__(self):
        self.tracer = trace.get_tracer(__name__)

    def debug_retrieval(
        self,
        query: str,
        retrieved_docs: list,
        expected_docs: list = None
    ) -> dict:
        with self.tracer.start_as_current_span("debug.retrieval") as span:
            debug_info = {
                "query": query,
                "num_retrieved": len(retrieved_docs),
                "scores": [d.score for d in retrieved_docs],
                "score_distribution": {
                    "min": min(d.score for d in retrieved_docs) if retrieved_docs else 0,
                    "max": max(d.score for d in retrieved_docs) if retrieved_docs else 0,
                    "avg": sum(d.score for d in retrieved_docs) / len(retrieved_docs) if retrieved_docs else 0
                }
            }

            # Check for issues
            issues = []

            # Low relevance scores
            if debug_info["score_distribution"]["max"] < 0.5:
                issues.append("Low relevance scores - query may not match index")

            # Score cliff
            if len(retrieved_docs) > 1:
                score_drop = retrieved_docs[0].score - retrieved_docs[1].score
                if score_drop > 0.3:
                    issues.append("Large score gap - possibly single relevant document")

            # Expected doc check
            if expected_docs:
                retrieved_ids = {d.id for d in retrieved_docs}
                expected_ids = set(expected_docs)
                missing = expected_ids - retrieved_ids
                if missing:
                    issues.append(f"Missing expected docs: {missing}")

            debug_info["issues"] = issues

            span.set_attribute("debug.issues_count", len(issues))
            for i, issue in enumerate(issues):
                span.add_event(f"issue_{i}", {"description": issue})

            return debug_info
```

## Distributed Tracing

```python
from opentelemetry.propagate import extract, inject
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

propagator = TraceContextTextMapPropagator()

# Propagate context to downstream services
def call_downstream_service(data: dict):
    headers = {}
    inject(headers)  # Injects trace context

    response = requests.post(
        "https://downstream-service/api",
        json=data,
        headers=headers
    )
    return response

# Extract context from incoming request
@app.route("/api/query")
def handle_query():
    context = extract(request.headers)

    with tracer.start_as_current_span(
        "handle_query",
        context=context
    ) as span:
        # Process request
        pass
```

## Debugging UI

```python
from flask import Flask, render_template
import json

app = Flask(__name__)

@app.route("/debug/<trace_id>")
def debug_trace(trace_id: str):
    # Fetch trace from Azure Monitor
    traces = query_traces(trace_id)

    # Build debug view
    debug_data = {
        "trace_id": trace_id,
        "spans": [],
        "metrics": {},
        "issues": []
    }

    for span in traces:
        debug_data["spans"].append({
            "name": span.name,
            "duration_ms": span.duration,
            "attributes": span.attributes,
            "events": span.events
        })

        # Extract AI-specific metrics
        if "ai.tokens" in span.attributes:
            debug_data["metrics"]["tokens"] = span.attributes["ai.tokens"]

        # Find issues
        if span.status.is_error:
            debug_data["issues"].append({
                "span": span.name,
                "error": span.status.description
            })

    return render_template("debug.html", data=debug_data)
```

## Best Practices

1. **Trace everything** - Better too much than too little
2. **Use structured attributes** - Makes querying easier
3. **Correlate with business metrics** - Connect AI quality to outcomes
4. **Set up alerts** - Catch issues proactively
5. **Protect PII** - Be careful what you log

## What's Next

Tomorrow I'll cover Azure AI Agent Service preview.

## Resources

- [OpenTelemetry Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Azure Monitor OpenTelemetry](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable)
- [Prompt Flow Tracing](https://microsoft.github.io/promptflow/how-to-guides/tracing/)
