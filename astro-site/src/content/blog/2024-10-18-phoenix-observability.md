---
title: "Phoenix Observability: Local-First LLM Tracing"
author: "Michael John Peña"
draft: false
date: 2024-10-18
tags: ["Phoenix", "Arize", "LLM", "Observability", "Open Source"]

---

I wrote "Phoenix Observability: Local-First LLM Tracing" to share practical, production-minded guidance on this topic.

## Getting Started with Phoenix

```python
# pip install arize-phoenix openinference-instrumentation-openai

import phoenix as px
from openinference.instrumentation.openai import OpenAIInstrumentor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from phoenix.otel import register

# Launch Phoenix app
session = px.launch_app()
print(f"Phoenix UI available at: {session.url}")

# Set up OpenTelemetry with Phoenix
tracer_provider = TracerProvider()
register(tracer_provider=tracer_provider)
trace.set_tracer_provider(tracer_provider)

# Instrument OpenAI
OpenAIInstrumentor().instrument(tracer_provider=tracer_provider)
```

## Automatic Instrumentation

```python
from openai import OpenAI

# All OpenAI calls are automatically traced
client = OpenAI()

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is machine learning?"}
    ]
)

# View in Phoenix UI - shows:
# - Full request/response
# - Token counts
# - Latency
# - Model used
```

## Multi-Framework Instrumentation

```python
# Instrument multiple frameworks
from openinference.instrumentation.langchain import LangChainInstrumentor
from openinference.instrumentation.llama_index import LlamaIndexInstrumentor
from openinference.instrumentation.anthropic import AnthropicInstrumentor

# LangChain
LangChainInstrumentor().instrument(tracer_provider=tracer_provider)

# LlamaIndex
LlamaIndexInstrumentor().instrument(tracer_provider=tracer_provider)

# Anthropic
AnthropicInstrumentor().instrument(tracer_provider=tracer_provider)

# Now all calls to these libraries are traced
from langchain_openai import ChatOpenAI
from llama_index.llms.openai import OpenAI as LlamaOpenAI
import anthropic

# Each framework's calls appear in Phoenix
```

## Custom Spans and Attributes

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

def process_document(document: str) -> dict:
    """Process a document with custom tracing"""

    with tracer.start_as_current_span("process_document") as span:
        span.set_attribute("document_length", len(document))

        # Extract entities
        with tracer.start_as_current_span("extract_entities") as extract_span:
            entities = extract_entities_with_llm(document)
            extract_span.set_attribute("entity_count", len(entities))

        # Summarize
        with tracer.start_as_current_span("summarize") as summary_span:
            summary = summarize_with_llm(document)
            summary_span.set_attribute("summary_length", len(summary))

        # Generate insights
        with tracer.start_as_current_span("generate_insights"):
            insights = generate_insights(document, entities, summary)

        return {
            "entities": entities,
            "summary": summary,
            "insights": insights
        }

def extract_entities_with_llm(text: str) -> list:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "Extract named entities as JSON array."},
            {"role": "user", "content": text}
        ]
    )
    return json.loads(response.choices[0].message.content)
```

## Embedding Visualization

```python
import phoenix as px
import pandas as pd
import numpy as np

# Create embeddings for analysis
def create_embedding(text: str) -> list:
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding

# Sample data
documents = [
    "Machine learning is a subset of AI",
    "Deep learning uses neural networks",
    "Natural language processing handles text",
    "Computer vision processes images",
    "Reinforcement learning learns from rewards"
]

embeddings = [create_embedding(doc) for doc in documents]

# Create DataFrame for Phoenix
df = pd.DataFrame({
    "text": documents,
    "embedding": embeddings,
    "category": ["ML", "DL", "NLP", "CV", "RL"]
})

# View embeddings in Phoenix
px.Client().log_dataframe(
    df,
    dataframe_name="document_embeddings",
    embedding_column="embedding"
)

# Phoenix provides:
# - 2D/3D embedding visualization
# - Cluster analysis
# - Similarity search
# - Drift detection
```

## Evaluation in Phoenix

```python
from phoenix.evals import (
    HallucinationEvaluator,
    RelevanceEvaluator,
    QAEvaluator
)

# Create evaluators
hallucination_eval = HallucinationEvaluator(
    model=OpenAIModel(model_name="gpt-4o")
)

relevance_eval = RelevanceEvaluator(
    model=OpenAIModel(model_name="gpt-4o")
)

# Evaluate responses
def evaluate_response(question: str, context: str, response: str) -> dict:
    """Evaluate an LLM response"""

    # Check for hallucination
    hallucination_result = hallucination_eval.evaluate(
        input=question,
        reference=context,
        output=response
    )

    # Check relevance
    relevance_result = relevance_eval.evaluate(
        input=question,
        output=response
    )

    return {
        "is_hallucination": hallucination_result.score < 0.5,
        "hallucination_score": hallucination_result.score,
        "is_relevant": relevance_result.score > 0.7,
        "relevance_score": relevance_result.score
    }

# Bulk evaluation
eval_data = [
    {
        "question": "What is Python?",
        "context": "Python is a programming language.",
        "response": "Python is a high-level programming language."
    },
    # ... more examples
]

for item in eval_data:
    result = evaluate_response(**item)
    print(f"Question: {item['question']}")
    print(f"Evaluation: {result}")
```

## Exporting Data

```python
import phoenix as px

# Get client
client = px.Client()

# Export traces
traces_df = client.get_spans_dataframe()

# Export to various formats
traces_df.to_csv("traces.csv")
traces_df.to_parquet("traces.parquet")

# Query specific traces
filtered_traces = client.get_spans_dataframe(
    filter_condition="span_kind == 'LLM'"
)

# Get evaluation results
eval_df = client.get_evaluations_dataframe()

# Analysis
print(f"Total LLM calls: {len(filtered_traces)}")
print(f"Average latency: {filtered_traces['latency_ms'].mean():.2f}ms")
print(f"Total tokens: {filtered_traces['total_tokens'].sum()}")
```

## Production Deployment

```python
# Phoenix can run as a standalone server for production

# Option 1: Docker
# docker run -p 6006:6006 arizephoenix/phoenix:latest

# Option 2: Python process
import phoenix as px
from phoenix.server import ThreadServer

# Start Phoenix server
server = ThreadServer(port=6006)
server.run()

# Configure client to connect
import os
os.environ["PHOENIX_COLLECTOR_ENDPOINT"] = "http://localhost:6006"

# Instrument application
from openinference.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# Export to Phoenix server
exporter = OTLPSpanExporter(endpoint="http://localhost:6006/v1/traces")
tracer_provider.add_span_processor(BatchSpanProcessor(exporter))

# Now traces are sent to Phoenix server
```

Phoenix provides powerful local-first observability that keeps your data private while offering the visualization and analysis capabilities needed for effective LLM development.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
