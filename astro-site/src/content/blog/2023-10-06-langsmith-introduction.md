---
title: "LangSmith Introduction: Observability for LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-06
description: "Getting started with LangSmith for tracing, debugging, and monitoring LLM applications."
tags:
  - LangSmith
  - LLM Observability
  - Debugging
  - LangChain
  - AI

---

I wrote "LangSmith Introduction: Observability for LLM Applications" to share practical, production-minded guidance on this topic.

## Introduction

LangSmith is LangChain's platform for debugging, testing, evaluating, and monitoring LLM applications. It provides essential observability features that make developing and maintaining production LLM applications much easier.

## Getting Started with LangSmith

### Setup and Configuration

```python
import os

# Set environment variables for LangSmith
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-langsmith-api-key"
os.environ["LANGCHAIN_PROJECT"] = "my-first-project"

# Optional: Custom endpoint for self-hosted
# os.environ["LANGCHAIN_ENDPOINT"] = "https://api.langsmith.com"

# Now all LangChain operations are automatically traced
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

llm = ChatOpenAI()
prompt = ChatPromptTemplate.from_template("Explain {topic} simply")
chain = prompt | llm

# This call is automatically traced to LangSmith
result = chain.invoke({"topic": "quantum computing"})
```

### Understanding Traces

```python
from langsmith import Client

# Initialize LangSmith client
client = Client()

# List recent runs
runs = client.list_runs(
    project_name="my-first-project",
    run_type="chain",
    limit=10
)

for run in runs:
    print(f"Run ID: {run.id}")
    print(f"Name: {run.name}")
    print(f"Status: {run.status}")
    print(f"Latency: {run.latency_ms}ms")
    print(f"Token count: {run.total_tokens}")
    print("---")

# Get detailed run information
run_id = "your-run-id"
run = client.read_run(run_id)
print(f"Inputs: {run.inputs}")
print(f"Outputs: {run.outputs}")
print(f"Error: {run.error}")
```

## Tracing Features

### Custom Run Names and Tags

```python
from langchain_core.runnables import RunnableConfig

# Add custom metadata to traces
config = RunnableConfig(
    run_name="customer-support-query",
    tags=["production", "support", "high-priority"],
    metadata={
        "user_id": "user-123",
        "session_id": "session-456",
        "environment": "production"
    }
)

result = chain.invoke({"topic": "machine learning"}, config=config)
```

### Nested Tracing with Context

```python
from langsmith import traceable

@traceable(name="process_document")
def process_document(doc: str) -> dict:
    """Process a document with nested tracing"""
    # Each step is traced as a child run
    cleaned = clean_text(doc)
    entities = extract_entities(cleaned)
    summary = summarize(cleaned)

    return {
        "cleaned": cleaned,
        "entities": entities,
        "summary": summary
    }

@traceable(name="clean_text")
def clean_text(text: str) -> str:
    """Clean text - traced as child"""
    return text.strip().lower()

@traceable(name="extract_entities")
def extract_entities(text: str) -> list:
    """Extract entities - traced as child"""
    chain = (
        ChatPromptTemplate.from_template("Extract entities from: {text}")
        | llm
    )
    return chain.invoke({"text": text})

@traceable(name="summarize")
def summarize(text: str) -> str:
    """Summarize text - traced as child"""
    chain = (
        ChatPromptTemplate.from_template("Summarize: {text}")
        | llm
    )
    return chain.invoke({"text": text})

# Execute with full tracing
result = process_document("Sample document text here...")
```

### Async Tracing

```python
from langsmith import traceable
import asyncio

@traceable(name="async_analysis")
async def async_analysis(text: str) -> dict:
    """Async function with tracing"""
    # Run multiple analyses concurrently
    tasks = [
        async_sentiment(text),
        async_keywords(text),
        async_summary(text)
    ]

    results = await asyncio.gather(*tasks)

    return {
        "sentiment": results[0],
        "keywords": results[1],
        "summary": results[2]
    }

@traceable(name="async_sentiment")
async def async_sentiment(text: str) -> str:
    return await sentiment_chain.ainvoke({"text": text})

@traceable(name="async_keywords")
async def async_keywords(text: str) -> str:
    return await keyword_chain.ainvoke({"text": text})

@traceable(name="async_summary")
async def async_summary(text: str) -> str:
    return await summary_chain.ainvoke({"text": text})

# Run async
result = asyncio.run(async_analysis("Sample text for analysis"))
```

## Debugging with LangSmith

### Identifying Failures

```python
# Query failed runs
failed_runs = client.list_runs(
    project_name="my-project",
    error=True,
    limit=20
)

for run in failed_runs:
    print(f"Failed run: {run.id}")
    print(f"Error: {run.error}")
    print(f"Inputs: {run.inputs}")
    print("---")

# Get full error traceback
run = client.read_run(failed_run_id)
print(f"Full error:\n{run.error}")
```

### Comparing Runs

```python
def compare_runs(run_id_1: str, run_id_2: str) -> dict:
    """Compare two runs for debugging"""
    run1 = client.read_run(run_id_1)
    run2 = client.read_run(run_id_2)

    comparison = {
        "latency_diff_ms": run1.latency_ms - run2.latency_ms,
        "token_diff": run1.total_tokens - run2.total_tokens,
        "same_output": run1.outputs == run2.outputs,
        "run1": {
            "inputs": run1.inputs,
            "outputs": run1.outputs,
            "latency": run1.latency_ms
        },
        "run2": {
            "inputs": run2.inputs,
            "outputs": run2.outputs,
            "latency": run2.latency_ms
        }
    }

    return comparison

# Compare before/after a change
comparison = compare_runs("old-run-id", "new-run-id")
print(f"Latency change: {comparison['latency_diff_ms']}ms")
```

### Replay and Debug

```python
def replay_run(run_id: str) -> dict:
    """Replay a run with the same inputs"""
    # Get original run
    original = client.read_run(run_id)

    # Replay with current chain
    new_result = chain.invoke(
        original.inputs,
        config=RunnableConfig(
            tags=["replay", f"original-{run_id}"],
            metadata={"replayed_from": run_id}
        )
    )

    return {
        "original_output": original.outputs,
        "new_output": new_result,
        "match": original.outputs == new_result
    }

# Debug by replaying a problematic run
replay_result = replay_run("problematic-run-id")
```

## Monitoring and Analytics

### Performance Metrics

```python
from datetime import datetime, timedelta
from collections import defaultdict

def get_performance_metrics(project_name: str, days: int = 7) -> dict:
    """Get performance metrics for a project"""
    start_time = datetime.now() - timedelta(days=days)

    runs = list(client.list_runs(
        project_name=project_name,
        start_time=start_time,
        run_type="chain"
    ))

    if not runs:
        return {"error": "No runs found"}

    latencies = [r.latency_ms for r in runs if r.latency_ms]
    tokens = [r.total_tokens for r in runs if r.total_tokens]
    errors = [r for r in runs if r.error]

    return {
        "total_runs": len(runs),
        "error_rate": len(errors) / len(runs) * 100,
        "avg_latency_ms": sum(latencies) / len(latencies) if latencies else 0,
        "p50_latency_ms": sorted(latencies)[len(latencies)//2] if latencies else 0,
        "p95_latency_ms": sorted(latencies)[int(len(latencies)*0.95)] if latencies else 0,
        "avg_tokens": sum(tokens) / len(tokens) if tokens else 0,
        "total_tokens": sum(tokens)
    }

metrics = get_performance_metrics("my-project", days=7)
print(f"Error rate: {metrics['error_rate']:.1f}%")
print(f"Avg latency: {metrics['avg_latency_ms']:.0f}ms")
```

### Cost Tracking

```python
def estimate_costs(project_name: str, days: int = 30) -> dict:
    """Estimate costs based on token usage"""
    start_time = datetime.now() - timedelta(days=days)

    runs = list(client.list_runs(
        project_name=project_name,
        start_time=start_time
    ))

    # Token pricing (example rates)
    PRICING = {
        "gpt-4": {"input": 0.03/1000, "output": 0.06/1000},
        "gpt-3.5-turbo": {"input": 0.001/1000, "output": 0.002/1000}
    }

    costs_by_model = defaultdict(float)
    total_cost = 0

    for run in runs:
        if run.extra and "model" in run.extra:
            model = run.extra["model"]
            if model in PRICING:
                input_cost = (run.prompt_tokens or 0) * PRICING[model]["input"]
                output_cost = (run.completion_tokens or 0) * PRICING[model]["output"]
                cost = input_cost + output_cost
                costs_by_model[model] += cost
                total_cost += cost

    return {
        "total_cost": total_cost,
        "costs_by_model": dict(costs_by_model),
        "runs_analyzed": len(runs),
        "period_days": days
    }

costs = estimate_costs("my-project", days=30)
print(f"Estimated cost: ${costs['total_cost']:.2f}")
```

## Integration Patterns

### Logging to External Systems

```python
from langsmith.run_helpers import traceable
import logging

# Set up logging
logger = logging.getLogger(__name__)

@traceable(name="traced_with_logging")
def traced_with_logging(input_data: dict) -> dict:
    """Function that logs to both LangSmith and external logger"""
    logger.info(f"Processing input: {input_data}")

    try:
        result = chain.invoke(input_data)
        logger.info(f"Success: {result[:100]}...")
        return {"status": "success", "result": result}
    except Exception as e:
        logger.error(f"Error: {e}")
        raise

# With custom callback for external systems
from langchain_core.callbacks import BaseCallbackHandler

class ExternalLoggingCallback(BaseCallbackHandler):
    def on_chain_start(self, serialized, inputs, **kwargs):
        # Send to external logging system
        external_logger.log_event("chain_start", {
            "chain": serialized.get("name"),
            "inputs": inputs
        })

    def on_chain_end(self, outputs, **kwargs):
        external_logger.log_event("chain_end", {"outputs": outputs})

    def on_chain_error(self, error, **kwargs):
        external_logger.log_event("chain_error", {"error": str(error)})
```

## Conclusion

LangSmith provides essential observability for LLM applications. With automatic tracing, debugging tools, and performance monitoring, it becomes much easier to develop, test, and maintain production-quality LLM applications. Start by enabling tracing in development and gradually expand to full production monitoring.

