---
title: "Multi-LLM Strategies: Building Resilient AI Applications"
author: Michael John Peña
draft: false
date: 2024-02-03
tags:
  - Multi-LLM
  - Architecture
  - Azure OpenAI
  - Anthropic
  - Resilience

---

I wrote "Multi-LLM Strategies: Building Resilient AI Applications" to share practical, production-minded guidance on this topic.

## Why Multi-LLM?

- **Resilience**: Failover when one provider has outages
- **Cost optimization**: Route to cheaper models when possible
- **Capability matching**: Use best model for each task
- **Vendor independence**: Avoid lock-in

## Architecture Patterns

### Pattern 1: Fallback Chain

```python
from typing import Optional
import time

class FallbackLLMClient:
    def __init__(self, clients: list[dict]):
        self.clients = clients  # Ordered by preference

    async def complete(self, prompt: str, **kwargs) -> tuple[str, str]:
        """Try each client in order until one succeeds."""

        last_error = None

        for config in self.clients:
            try:
                client = config["client"]
                model = config["model"]

                response = await self._call_client(client, model, prompt, **kwargs)
                return response, config["name"]

            except Exception as e:
                last_error = e
                print(f"Failed {config['name']}: {e}, trying next...")
                continue

        raise Exception(f"All LLM providers failed. Last error: {last_error}")

    async def _call_client(self, client, model, prompt, **kwargs):
        # Implementation varies by client type
        pass

# Usage
clients = [
    {"name": "azure-openai", "client": azure_client, "model": "gpt-4"},
    {"name": "openai-direct", "client": openai_client, "model": "gpt-4"},
    {"name": "anthropic", "client": anthropic_client, "model": "claude-3-opus"}
]

llm = FallbackLLMClient(clients)
response, provider = await llm.complete("Analyze this data...")
print(f"Response from {provider}")
```

### Pattern 2: Load Balancing

```python
import random
from collections import defaultdict

class LoadBalancedLLM:
    def __init__(self, endpoints: list[dict]):
        self.endpoints = endpoints
        self.weights = [e.get("weight", 1) for e in endpoints]
        self.health = {e["name"]: True for e in endpoints}
        self.error_counts = defaultdict(int)

    def select_endpoint(self) -> dict:
        """Select endpoint based on weights and health."""

        healthy = [
            (e, w) for e, w in zip(self.endpoints, self.weights)
            if self.health[e["name"]]
        ]

        if not healthy:
            # All unhealthy, reset and try anyway
            self.health = {e["name"]: True for e in self.endpoints}
            healthy = list(zip(self.endpoints, self.weights))

        endpoints, weights = zip(*healthy)
        return random.choices(endpoints, weights=weights)[0]

    async def complete(self, prompt: str, **kwargs) -> str:
        endpoint = self.select_endpoint()

        try:
            response = await self._call(endpoint, prompt, **kwargs)
            self.error_counts[endpoint["name"]] = 0
            return response

        except Exception as e:
            self.error_counts[endpoint["name"]] += 1

            # Mark unhealthy after 3 consecutive errors
            if self.error_counts[endpoint["name"]] >= 3:
                self.health[endpoint["name"]] = False

            # Retry with different endpoint
            return await self.complete(prompt, **kwargs)
```

### Pattern 3: Task-Based Routing

```python
class TaskRouter:
    def __init__(self):
        self.routes = {
            "code": {"provider": "openai", "model": "gpt-4-turbo"},
            "analysis": {"provider": "anthropic", "model": "claude-3-opus"},
            "simple_qa": {"provider": "openai", "model": "gpt-3.5-turbo"},
            "long_document": {"provider": "anthropic", "model": "claude-3-opus"},
            "creative": {"provider": "openai", "model": "gpt-4-turbo"},
            "default": {"provider": "openai", "model": "gpt-4-turbo"}
        }

    def classify_task(self, prompt: str, context_length: int) -> str:
        """Classify the task type from prompt characteristics."""

        prompt_lower = prompt.lower()

        if context_length > 50000:
            return "long_document"

        if any(kw in prompt_lower for kw in ["code", "function", "implement", "debug"]):
            return "code"

        if any(kw in prompt_lower for kw in ["analyze", "compare", "evaluate"]):
            return "analysis"

        if any(kw in prompt_lower for kw in ["write a story", "creative", "imagine"]):
            return "creative"

        if len(prompt) < 100:
            return "simple_qa"

        return "default"

    def route(self, prompt: str, context_length: int = 0) -> dict:
        task_type = self.classify_task(prompt, context_length)
        return self.routes[task_type]
```

## Cost Optimization

```python
class CostAwareLLM:
    PRICING = {
        "gpt-4-turbo": {"input": 0.01, "output": 0.03},
        "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
        "claude-3-opus": {"input": 0.015, "output": 0.075},
        "claude-3-sonnet": {"input": 0.003, "output": 0.015}
    }

    def __init__(self, budget_per_day: float = 100.0):
        self.budget = budget_per_day
        self.spent_today = 0.0

    def select_model(self, estimated_tokens: int, quality_required: str) -> str:
        """Select model based on budget and quality needs."""

        remaining_budget = self.budget - self.spent_today

        if quality_required == "high":
            preferred = ["gpt-4-turbo", "claude-3-opus"]
        else:
            preferred = ["gpt-3.5-turbo", "claude-3-sonnet", "gpt-4-turbo"]

        for model in preferred:
            estimated_cost = self._estimate_cost(model, estimated_tokens)

            if estimated_cost < remaining_budget * 0.1:  # Don't use more than 10% on one call
                return model

        return preferred[-1]  # Fall back to first choice if budget allows

    def _estimate_cost(self, model: str, tokens: int) -> float:
        pricing = self.PRICING.get(model, self.PRICING["gpt-4-turbo"])
        return (tokens / 1000) * (pricing["input"] + pricing["output"]) / 2
```

## Monitoring

```python
from dataclasses import dataclass
from datetime import datetime

@dataclass
class LLMMetric:
    timestamp: datetime
    provider: str
    model: str
    latency_ms: float
    tokens_in: int
    tokens_out: int
    cost: float
    success: bool

class MultiLLMMonitor:
    def __init__(self):
        self.metrics: list[LLMMetric] = []

    def record(self, metric: LLMMetric):
        self.metrics.append(metric)

    def get_summary(self, hours: int = 24) -> dict:
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        recent = [m for m in self.metrics if m.timestamp > cutoff]

        by_provider = defaultdict(list)
        for m in recent:
            by_provider[m.provider].append(m)

        return {
            provider: {
                "calls": len(metrics),
                "success_rate": sum(m.success for m in metrics) / len(metrics),
                "avg_latency": sum(m.latency_ms for m in metrics) / len(metrics),
                "total_cost": sum(m.cost for m in metrics)
            }
            for provider, metrics in by_provider.items()
        }
```

## Best Practices

1. **Start with fallback** - Simple and effective
2. **Add routing** - As you understand usage patterns
3. **Monitor everything** - Latency, cost, success rate
4. **Test failover** - Regularly verify fallback works
5. **Abstract the interface** - Keep application code provider-agnostic

## Conclusion

Multi-LLM strategies transform AI applications from fragile to resilient. Start with basic fallback, evolve to smart routing, and continuously optimize based on monitoring data.

