---
title: "Monitoring AI Systems in Production"
author: "Michael John Peña"
draft: false
date: 2024-03-30
tags: ["AI", "Monitoring", "MLOps", "Observability", "Production"]

---

I wrote "Monitoring AI Systems in Production" to share practical, production-minded guidance on this topic.

AI systems require specialized monitoring beyond traditional application metrics. This guide covers comprehensive observability for production AI.

## AI Monitoring Dimensions

```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime
import time

class MonitoringDimension(Enum):
    PERFORMANCE = "performance"  # Latency, throughput
    QUALITY = "quality"  # Output quality, accuracy
    COST = "cost"  # Token usage, API costs
    SAFETY = "safety"  # Harmful outputs, policy violations
    RELIABILITY = "reliability"  # Errors, availability

@dataclass
class AIMetric:
    name: str
    dimension: MonitoringDimension
    value: float
    timestamp: datetime = field(default_factory=datetime.now)
    tags: Dict[str, str] = field(default_factory=dict)
```

## Comprehensive Metrics Collection

```python
import anthropic
from contextlib import contextmanager
from collections import defaultdict
import threading

class AIMetricsCollector:
    """Collect and aggregate AI system metrics"""

    def __init__(self):
        self.metrics: Dict[str, List[AIMetric]] = defaultdict(list)
        self.lock = threading.Lock()

    def record(self, metric: AIMetric):
        """Record a metric"""
        with self.lock:
            self.metrics[metric.name].append(metric)

    @contextmanager
    def track_latency(self, operation: str, tags: Dict = None):
        """Context manager to track operation latency"""
        start = time.time()
        try:
            yield
        finally:
            latency_ms = (time.time() - start) * 1000
            self.record(AIMetric(
                name=f"{operation}_latency_ms",
                dimension=MonitoringDimension.PERFORMANCE,
                value=latency_ms,
                tags=tags or {}
            ))

    def track_token_usage(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        tags: Dict = None
    ):
        """Track token usage for cost monitoring"""
        self.record(AIMetric(
            name="input_tokens",
            dimension=MonitoringDimension.COST,
            value=input_tokens,
            tags={"model": model, **(tags or {})}
        ))
        self.record(AIMetric(
            name="output_tokens",
            dimension=MonitoringDimension.COST,
            value=output_tokens,
            tags={"model": model, **(tags or {})}
        ))

        # Calculate cost
        cost = self._calculate_cost(model, input_tokens, output_tokens)
        self.record(AIMetric(
            name="request_cost_usd",
            dimension=MonitoringDimension.COST,
            value=cost,
            tags={"model": model, **(tags or {})}
        ))

    def _calculate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """Calculate cost based on model pricing"""
        pricing = {
            "claude-3-opus-20240229": (15.0, 75.0),
            "claude-3-sonnet-20240229": (3.0, 15.0),
            "claude-3-haiku-20240307": (0.25, 1.25)
        }

        input_price, output_price = pricing.get(model, (10.0, 30.0))
        return (input_tokens / 1_000_000 * input_price +
                output_tokens / 1_000_000 * output_price)

    def track_quality(
        self,
        metric_name: str,
        score: float,
        tags: Dict = None
    ):
        """Track quality metrics"""
        self.record(AIMetric(
            name=metric_name,
            dimension=MonitoringDimension.QUALITY,
            value=score,
            tags=tags or {}
        ))

    def track_error(
        self,
        error_type: str,
        tags: Dict = None
    ):
        """Track errors"""
        self.record(AIMetric(
            name="error_count",
            dimension=MonitoringDimension.RELIABILITY,
            value=1,
            tags={"error_type": error_type, **(tags or {})}
        ))

    def get_aggregates(
        self,
        metric_name: str,
        window_minutes: int = 5
    ) -> Dict:
        """Get metric aggregates over time window"""
        import numpy as np
        from datetime import timedelta

        cutoff = datetime.now() - timedelta(minutes=window_minutes)

        with self.lock:
            values = [
                m.value for m in self.metrics.get(metric_name, [])
                if m.timestamp >= cutoff
            ]

        if not values:
            return {}

        return {
            "count": len(values),
            "mean": np.mean(values),
            "p50": np.percentile(values, 50),
            "p95": np.percentile(values, 95),
            "p99": np.percentile(values, 99),
            "min": np.min(values),
            "max": np.max(values)
        }
```

## Monitored AI Client

```python
class MonitoredAIClient:
    """AI client with built-in monitoring"""

    def __init__(self, metrics: AIMetricsCollector):
        self.client = anthropic.Anthropic()
        self.metrics = metrics

    def generate(
        self,
        model: str,
        messages: List[Dict],
        max_tokens: int = 1000,
        tags: Dict = None
    ) -> str:
        """Generate with full monitoring"""

        tags = tags or {}
        tags["model"] = model

        try:
            with self.metrics.track_latency("generation", tags):
                response = self.client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    messages=messages
                )

            # Track token usage
            self.metrics.track_token_usage(
                model=model,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                tags=tags
            )

            # Track success
            self.metrics.record(AIMetric(
                name="request_success",
                dimension=MonitoringDimension.RELIABILITY,
                value=1,
                tags=tags
            ))

            return response.content[0].text

        except anthropic.RateLimitError:
            self.metrics.track_error("rate_limit", tags)
            raise
        except anthropic.APIError as e:
            self.metrics.track_error("api_error", tags)
            raise
        except Exception as e:
            self.metrics.track_error("unknown", tags)
            raise
```

## Quality Monitoring

```python
class QualityMonitor:
    """Monitor AI output quality"""

    def __init__(self, metrics: AIMetricsCollector):
        self.client = anthropic.Anthropic()
        self.metrics = metrics

    def evaluate_response(
        self,
        question: str,
        response: str,
        context: str = None,
        tags: Dict = None
    ):
        """Evaluate response quality"""

        # Use smaller model for fast evaluation
        eval_prompt = f"""Rate this AI response on a scale of 0-1 for each criterion:

Question: {question}
Response: {response}
{f'Context: {context}' if context else ''}

Rate:
- relevance (0-1): Does it answer the question?
- coherence (0-1): Is it well-structured?
- helpfulness (0-1): Is it useful?

Format: relevance:X.X, coherence:X.X, helpfulness:X.X"""

        eval_response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=50,
            messages=[{"role": "user", "content": eval_prompt}]
        )

        # Parse scores
        try:
            text = eval_response.content[0].text
            scores = {}
            for part in text.split(","):
                name, value = part.strip().split(":")
                scores[name.strip()] = float(value.strip())

            # Record quality metrics
            for metric_name, score in scores.items():
                self.metrics.track_quality(
                    f"quality_{metric_name}",
                    score,
                    tags=tags
                )

        except Exception as e:
            print(f"Failed to parse quality scores: {e}")

    def detect_safety_issues(
        self,
        response: str,
        tags: Dict = None
    ) -> bool:
        """Check for safety/policy issues in response"""

        check_prompt = f"""Analyze this AI response for safety issues.
Check for: harmful content, PII exposure, inappropriate language, misinformation.

Response: {response}

Has safety issues? Answer YES or NO only:"""

        check_response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=10,
            messages=[{"role": "user", "content": check_prompt}]
        )

        has_issues = "YES" in check_response.content[0].text.upper()

        self.metrics.record(AIMetric(
            name="safety_issue_detected",
            dimension=MonitoringDimension.SAFETY,
            value=1 if has_issues else 0,
            tags=tags or {}
        ))

        return has_issues
```

## Dashboard Metrics

```python
class AIDashboard:
    """Generate dashboard-ready metrics"""

    def __init__(self, metrics: AIMetricsCollector):
        self.metrics = metrics

    def get_dashboard_data(self) -> Dict:
        """Get all metrics for dashboard"""

        return {
            "performance": {
                "latency": self.metrics.get_aggregates("generation_latency_ms"),
                "throughput_rpm": self._calculate_rpm()
            },
            "cost": {
                "hourly_cost": self._calculate_hourly_cost(),
                "token_usage": {
                    "input": self.metrics.get_aggregates("input_tokens"),
                    "output": self.metrics.get_aggregates("output_tokens")
                }
            },
            "quality": {
                "relevance": self.metrics.get_aggregates("quality_relevance"),
                "coherence": self.metrics.get_aggregates("quality_coherence"),
                "helpfulness": self.metrics.get_aggregates("quality_helpfulness")
            },
            "reliability": {
                "success_rate": self._calculate_success_rate(),
                "error_breakdown": self._get_error_breakdown()
            },
            "safety": {
                "issues_detected": self.metrics.get_aggregates("safety_issue_detected")
            }
        }

    def _calculate_rpm(self) -> float:
        """Calculate requests per minute"""
        success_metrics = self.metrics.metrics.get("request_success", [])
        if not success_metrics:
            return 0

        recent = [m for m in success_metrics
                 if m.timestamp >= datetime.now() - timedelta(minutes=1)]
        return len(recent)

    def _calculate_hourly_cost(self) -> float:
        """Calculate cost in last hour"""
        cost_metrics = self.metrics.metrics.get("request_cost_usd", [])
        recent = [m for m in cost_metrics
                 if m.timestamp >= datetime.now() - timedelta(hours=1)]
        return sum(m.value for m in recent)

    def _calculate_success_rate(self) -> float:
        """Calculate success rate"""
        success = len([m for m in self.metrics.metrics.get("request_success", [])
                      if m.timestamp >= datetime.now() - timedelta(minutes=5)])
        errors = len([m for m in self.metrics.metrics.get("error_count", [])
                     if m.timestamp >= datetime.now() - timedelta(minutes=5)])

        total = success + errors
        return success / total if total > 0 else 1.0

    def _get_error_breakdown(self) -> Dict:
        """Get error breakdown by type"""
        errors = [m for m in self.metrics.metrics.get("error_count", [])
                 if m.timestamp >= datetime.now() - timedelta(hours=1)]

        breakdown = defaultdict(int)
        for e in errors:
            error_type = e.tags.get("error_type", "unknown")
            breakdown[error_type] += 1

        return dict(breakdown)
```

## Alerting

```python
class AIAlertManager:
    """Alert on AI system anomalies"""

    def __init__(self, metrics: AIMetricsCollector):
        self.metrics = metrics
        self.thresholds = {
            "generation_latency_ms_p95": 5000,
            "error_rate": 0.05,
            "hourly_cost_usd": 100,
            "safety_issue_rate": 0.01
        }

    def check_alerts(self) -> List[Dict]:
        """Check all alert conditions"""
        alerts = []

        # Latency alert
        latency = self.metrics.get_aggregates("generation_latency_ms")
        if latency.get("p95", 0) > self.thresholds["generation_latency_ms_p95"]:
            alerts.append({
                "type": "latency",
                "severity": "warning",
                "message": f"P95 latency ({latency['p95']:.0f}ms) exceeds threshold"
            })

        # Cost alert
        cost_metrics = self.metrics.metrics.get("request_cost_usd", [])
        hourly_cost = sum(m.value for m in cost_metrics
                        if m.timestamp >= datetime.now() - timedelta(hours=1))
        if hourly_cost > self.thresholds["hourly_cost_usd"]:
            alerts.append({
                "type": "cost",
                "severity": "critical",
                "message": f"Hourly cost (${hourly_cost:.2f}) exceeds threshold"
            })

        return alerts
```

## Conclusion

Comprehensive AI monitoring covers performance, quality, cost, safety, and reliability. Build monitoring into your AI service from the start and set up alerts for anomalies. Use dashboards to track trends and identify optimization opportunities.

