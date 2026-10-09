---
title: "Arize AI for Production LLM Monitoring"
description: "Arize provides comprehensive production monitoring for LLMs with enterprise features like drift detection, alerting, and detailed analytics. It's ideal for…"
author: "Michael John Peña"
draft: false
date: 2024-10-19
tags: ["Arize", "Production", "LLM", "Monitoring", "ML Observability"]
---

## Setting Up Arize

```python
# pip install arize

from arize.pandas.logger import Client
from arize.utils.types import ModelTypes, Environments

# Initialize Arize client
arize_client = Client(
    space_key="YOUR_SPACE_KEY",
    api_key="YOUR_API_KEY"
)

# Configuration
ARIZE_CONFIG = {
    "model_id": "llm-chatbot",
    "model_version": "1.0.0",
    "model_type": ModelTypes.GENERATIVE_LLM
}
```

## Logging LLM Interactions

```python
import pandas as pd
from datetime import datetime
from arize.utils.types import Schema, EmbeddingColumnNames

def log_llm_interaction(
    prompt: str,
    response: str,
    prompt_embedding: list,
    response_embedding: list,
    latency_ms: float,
    tokens: dict,
    metadata: dict = None
):
    """Log an LLM interaction to Arize"""

    # Create DataFrame with interaction data
    df = pd.DataFrame([{
        "prediction_id": str(uuid.uuid4()),
        "timestamp": datetime.utcnow(),

        # Input/Output
        "prompt": prompt,
        "response": response,

        # Embeddings for semantic analysis
        "prompt_embedding": prompt_embedding,
        "response_embedding": response_embedding,

        # Metrics
        "latency_ms": latency_ms,
        "input_tokens": tokens.get("input", 0),
        "output_tokens": tokens.get("output", 0),
        "total_tokens": tokens.get("total", 0),

        # Metadata
        "model": metadata.get("model", "gpt-4o"),
        "user_id": metadata.get("user_id"),
        "session_id": metadata.get("session_id")
    }])

    # Define schema
    schema = Schema(
        prediction_id_column_name="prediction_id",
        timestamp_column_name="timestamp",
        prompt_column_names=EmbeddingColumnNames(
            vector_column_name="prompt_embedding",
            data_column_name="prompt"
        ),
        response_column_names=EmbeddingColumnNames(
            vector_column_name="response_embedding",
            data_column_name="response"
        ),
        tag_column_names=["model", "user_id", "session_id"]
    )

    # Log to Arize
    response = arize_client.log(
        dataframe=df,
        schema=schema,
        model_id=ARIZE_CONFIG["model_id"],
        model_version=ARIZE_CONFIG["model_version"],
        model_type=ARIZE_CONFIG["model_type"],
        environment=Environments.PRODUCTION
    )

    return response

# Usage
prompt = "What is machine learning?"
response = call_llm(prompt)

log_llm_interaction(
    prompt=prompt,
    response=response.text,
    prompt_embedding=get_embedding(prompt),
    response_embedding=get_embedding(response.text),
    latency_ms=response.latency_ms,
    tokens=response.usage,
    metadata={
        "model": "gpt-4o",
        "user_id": "user123",
        "session_id": "session456"
    }
)
```

## Evaluation Logging

```python
from arize.utils.types import EvaluationLabel

def log_evaluation(
    prediction_id: str,
    evaluation_name: str,
    score: float,
    label: str = None,
    explanation: str = None
):
    """Log an evaluation result to Arize"""

    eval_df = pd.DataFrame([{
        "prediction_id": prediction_id,
        "evaluation_name": evaluation_name,
        "score": score,
        "label": label,
        "explanation": explanation
    }])

    arize_client.log_evaluations(
        dataframe=eval_df,
        model_id=ARIZE_CONFIG["model_id"],
        model_version=ARIZE_CONFIG["model_version"]
    )

# Log different types of evaluations
def evaluate_and_log(prediction_id: str, prompt: str, response: str):
    """Run evaluations and log to Arize"""

    # Relevance evaluation
    relevance = evaluate_relevance(prompt, response)
    log_evaluation(
        prediction_id=prediction_id,
        evaluation_name="relevance",
        score=relevance.score,
        label="relevant" if relevance.score > 0.7 else "not_relevant"
    )

    # Hallucination detection
    hallucination = detect_hallucination(prompt, response)
    log_evaluation(
        prediction_id=prediction_id,
        evaluation_name="hallucination",
        score=hallucination.score,
        label="no_hallucination" if hallucination.score < 0.3 else "hallucination"
    )

    # Toxicity check
    toxicity = check_toxicity(response)
    log_evaluation(
        prediction_id=prediction_id,
        evaluation_name="toxicity",
        score=toxicity.score,
        label="safe" if toxicity.score < 0.1 else "toxic"
    )
```

## Drift Monitoring

```python
class DriftMonitor:
    """Monitor for embedding drift"""

    def __init__(self, baseline_embeddings: list):
        self.baseline = np.array(baseline_embeddings)
        self.baseline_centroid = np.mean(self.baseline, axis=0)

    def calculate_drift(self, new_embeddings: list) -> dict:
        """Calculate drift metrics"""
        new = np.array(new_embeddings)
        new_centroid = np.mean(new, axis=0)

        # Centroid drift
        centroid_drift = np.linalg.norm(new_centroid - self.baseline_centroid)

        # Distribution drift (simplified)
        baseline_distances = np.linalg.norm(self.baseline - self.baseline_centroid, axis=1)
        new_distances = np.linalg.norm(new - new_centroid, axis=1)

        return {
            "centroid_drift": centroid_drift,
            "baseline_spread": np.std(baseline_distances),
            "current_spread": np.std(new_distances)
        }

def log_drift_metrics(drift_metrics: dict, window_start: datetime, window_end: datetime):
    """Log drift metrics to Arize"""

    df = pd.DataFrame([{
        "timestamp": datetime.utcnow(),
        "window_start": window_start,
        "window_end": window_end,
        **drift_metrics
    }])

    arize_client.log_metrics(
        dataframe=df,
        model_id=ARIZE_CONFIG["model_id"],
        metric_type="drift"
    )

# Periodic drift check
def check_drift_hourly():
    """Check for drift every hour"""
    # Get recent embeddings
    recent_embeddings = get_recent_embeddings(hours=1)

    # Calculate drift
    drift = drift_monitor.calculate_drift(recent_embeddings)

    # Log to Arize
    log_drift_metrics(
        drift,
        window_start=datetime.utcnow() - timedelta(hours=1),
        window_end=datetime.utcnow()
    )

    # Alert if drift exceeds threshold
    if drift["centroid_drift"] > 0.5:
        send_alert("Significant embedding drift detected")
```

## Performance Monitoring

```python
def log_performance_metrics(metrics: dict):
    """Log performance metrics"""

    df = pd.DataFrame([{
        "timestamp": datetime.utcnow(),
        "latency_p50_ms": metrics["latency_p50"],
        "latency_p95_ms": metrics["latency_p95"],
        "latency_p99_ms": metrics["latency_p99"],
        "throughput_rps": metrics["throughput"],
        "error_rate": metrics["error_rate"],
        "token_cost_usd": metrics["cost"]
    }])

    arize_client.log_metrics(
        dataframe=df,
        model_id=ARIZE_CONFIG["model_id"],
        metric_type="performance"
    )

class PerformanceTracker:
    """Track performance metrics over time"""

    def __init__(self):
        self.latencies = []
        self.errors = 0
        self.requests = 0
        self.cost = 0.0

    def record_request(self, latency_ms: float, success: bool, cost_usd: float):
        self.latencies.append(latency_ms)
        self.requests += 1
        self.cost += cost_usd
        if not success:
            self.errors += 1

    def get_metrics(self) -> dict:
        if not self.latencies:
            return {}

        sorted_latencies = sorted(self.latencies)
        n = len(sorted_latencies)

        return {
            "latency_p50": sorted_latencies[int(n * 0.5)],
            "latency_p95": sorted_latencies[int(n * 0.95)],
            "latency_p99": sorted_latencies[int(n * 0.99)],
            "throughput": self.requests,
            "error_rate": self.errors / self.requests if self.requests > 0 else 0,
            "cost": self.cost
        }

    def reset(self):
        self.latencies = []
        self.errors = 0
        self.requests = 0
        self.cost = 0.0

# Usage
tracker = PerformanceTracker()

# Record each request
tracker.record_request(latency_ms=150, success=True, cost_usd=0.01)

# Periodically log metrics
metrics = tracker.get_metrics()
log_performance_metrics(metrics)
tracker.reset()
```

## Alerting Integration

```python
# Arize supports alerting through the UI and API
# Configure alerts for:

ALERT_CONFIG = {
    "latency_alert": {
        "metric": "latency_p95_ms",
        "threshold": 5000,
        "comparison": "greater_than",
        "window_minutes": 5,
        "severity": "warning"
    },
    "error_rate_alert": {
        "metric": "error_rate",
        "threshold": 0.05,
        "comparison": "greater_than",
        "window_minutes": 15,
        "severity": "critical"
    },
    "drift_alert": {
        "metric": "centroid_drift",
        "threshold": 0.5,
        "comparison": "greater_than",
        "window_minutes": 60,
        "severity": "warning"
    },
    "hallucination_alert": {
        "metric": "hallucination_rate",
        "threshold": 0.1,
        "comparison": "greater_than",
        "window_minutes": 30,
        "severity": "critical"
    }
}

# Alerts can be sent to:
# - Email
# - Slack
# - PagerDuty
# - Webhooks
```

Arize provides comprehensive production monitoring for LLMs with enterprise features like drift detection, alerting, and detailed analytics. It's ideal for teams running AI at scale.
