---
title: "LLMOps Emergence: Operating Large Language Models in Production"
description: "LLMOps is essential for reliable LLM applications. Start with prompt management and evaluation, then add observability and cost tracking as you scale."
author: Michael John Peña
draft: false
date: 2024-12-24
tags:
  - LLMOps
  - LLM
  - Operations
  - AI
  - Production
---

## LLMOps vs Traditional MLOps

```
Traditional MLOps                    LLMOps
─────────────────                   ─────────
Train custom models                  Use pre-trained models
Feature engineering                  Prompt engineering
Model metrics (accuracy, F1)         Quality metrics (relevance, coherence)
Structured data                      Unstructured data
Batch retraining                     Continuous prompt iteration
Model versioning                     Prompt + model versioning
Deterministic outputs                Non-deterministic outputs
```

## Core LLMOps Components

### Component 1: Prompt Management

```python
from dataclasses import dataclass
from typing import Optional, List
from datetime import datetime
import hashlib

@dataclass
class PromptVersion:
    id: str
    template: str
    variables: List[str]
    model: str
    version: str
    created_at: datetime
    metrics: dict
    status: str  # draft, staging, production, archived

class PromptRegistry:
    """Manage prompt versions like model versions."""

    def __init__(self, storage_backend):
        self.storage = storage_backend
        self.prompts = {}

    def register_prompt(
        self,
        name: str,
        template: str,
        model: str,
        metadata: dict = None
    ) -> PromptVersion:
        """Register a new prompt version."""

        # Extract variables from template
        variables = self.extract_variables(template)

        # Generate version ID
        version_id = hashlib.md5(
            f"{template}{model}".encode()
        ).hexdigest()[:8]

        prompt_version = PromptVersion(
            id=f"{name}:{version_id}",
            template=template,
            variables=variables,
            model=model,
            version=version_id,
            created_at=datetime.now(),
            metrics={},
            status="draft"
        )

        self.storage.save(prompt_version)
        return prompt_version

    def get_production_prompt(self, name: str) -> PromptVersion:
        """Get current production prompt."""
        prompts = self.storage.query(
            name=name,
            status="production"
        )
        if prompts:
            return prompts[0]
        raise ValueError(f"No production prompt for {name}")

    def promote_to_production(
        self,
        prompt_id: str,
        archive_current: bool = True
    ):
        """Promote prompt to production."""
        prompt = self.storage.get(prompt_id)

        if archive_current:
            current = self.get_production_prompt(prompt.name)
            current.status = "archived"
            self.storage.save(current)

        prompt.status = "production"
        self.storage.save(prompt)

    def render_prompt(
        self,
        prompt_id: str,
        variables: dict
    ) -> str:
        """Render prompt with variables."""
        prompt = self.storage.get(prompt_id)

        rendered = prompt.template
        for var, value in variables.items():
            rendered = rendered.replace(f"{{{var}}}", str(value))

        return rendered

# Example usage
registry = PromptRegistry(storage)

prompt = registry.register_prompt(
    name="customer_support",
    template="""You are a customer support agent for {company_name}.

Help the customer with their query about {topic}.

Guidelines:
- Be professional and friendly
- Only answer based on our documentation
- If unsure, offer to escalate

Customer Query: {query}

Response:""",
    model="gpt-4o"
)
```

### Component 2: Evaluation Pipeline

```python
from typing import List, Callable
import asyncio

class LLMEvaluator:
    """Evaluate LLM outputs systematically."""

    def __init__(self, llm_client):
        self.client = llm_client
        self.metrics = {}

    async def evaluate(
        self,
        prompt_version: PromptVersion,
        test_cases: List[dict],
        metrics: List[str] = None
    ) -> dict:
        """Run evaluation on prompt version."""

        metrics = metrics or ["relevance", "coherence", "accuracy"]
        results = []

        for test_case in test_cases:
            # Generate response
            response = await self.generate_response(
                prompt_version,
                test_case["input"]
            )

            # Evaluate each metric
            case_metrics = {}
            for metric in metrics:
                evaluator = self.get_metric_evaluator(metric)
                score = await evaluator(
                    response,
                    test_case.get("expected"),
                    test_case.get("context")
                )
                case_metrics[metric] = score

            results.append({
                "input": test_case["input"],
                "output": response,
                "expected": test_case.get("expected"),
                "metrics": case_metrics
            })

        # Aggregate metrics
        aggregated = self.aggregate_metrics(results)

        return {
            "prompt_version": prompt_version.id,
            "test_cases": len(test_cases),
            "results": results,
            "aggregated_metrics": aggregated
        }

    def get_metric_evaluator(self, metric: str) -> Callable:
        """Get evaluator function for metric."""

        evaluators = {
            "relevance": self.evaluate_relevance,
            "coherence": self.evaluate_coherence,
            "accuracy": self.evaluate_accuracy,
            "toxicity": self.evaluate_toxicity,
            "groundedness": self.evaluate_groundedness
        }
        return evaluators.get(metric, self.evaluate_generic)

    async def evaluate_relevance(
        self,
        response: str,
        expected: str,
        context: str
    ) -> float:
        """Evaluate response relevance using LLM-as-judge."""

        judge_prompt = f"""Rate the relevance of this response on a scale of 1-5.

Context: {context}
Expected: {expected}
Response: {response}

Relevance criteria:
- Does it address the question?
- Is it appropriate for the context?
- Does it contain relevant information?

Return only a number 1-5."""

        result = await self.client.generate(judge_prompt)
        return float(result.strip()) / 5.0

    async def evaluate_groundedness(
        self,
        response: str,
        expected: str,
        context: str
    ) -> float:
        """Evaluate if response is grounded in provided context."""

        judge_prompt = f"""Evaluate if this response is grounded in the given context.

Context: {context}
Response: {response}

Score 1-5:
1 = Completely hallucinated, no connection to context
3 = Partially grounded, some claims not in context
5 = Fully grounded, all claims supported by context

Return only a number 1-5."""

        result = await self.client.generate(judge_prompt)
        return float(result.strip()) / 5.0
```

### Component 3: A/B Testing for Prompts

```python
import random
from collections import defaultdict

class PromptABTest:
    """A/B testing for prompt versions."""

    def __init__(self, name: str, variants: dict):
        self.name = name
        self.variants = variants  # {"control": prompt_v1, "treatment": prompt_v2}
        self.assignments = {}
        self.metrics = defaultdict(list)

    def get_variant(self, user_id: str) -> tuple:
        """Get variant assignment for user."""
        if user_id not in self.assignments:
            # Consistent assignment based on user_id hash
            hash_val = hash(f"{self.name}:{user_id}") % 100
            if hash_val < 50:
                self.assignments[user_id] = "control"
            else:
                self.assignments[user_id] = "treatment"

        variant_name = self.assignments[user_id]
        return variant_name, self.variants[variant_name]

    def record_metric(
        self,
        user_id: str,
        metric_name: str,
        value: float
    ):
        """Record metric for analysis."""
        variant = self.assignments.get(user_id)
        if variant:
            self.metrics[variant].append({
                "metric": metric_name,
                "value": value,
                "user_id": user_id
            })

    def get_results(self) -> dict:
        """Get A/B test results."""
        from scipy import stats

        results = {}
        for metric in ["satisfaction", "task_completion", "response_time"]:
            control_values = [
                m["value"] for m in self.metrics["control"]
                if m["metric"] == metric
            ]
            treatment_values = [
                m["value"] for m in self.metrics["treatment"]
                if m["metric"] == metric
            ]

            if control_values and treatment_values:
                t_stat, p_value = stats.ttest_ind(control_values, treatment_values)

                results[metric] = {
                    "control_mean": sum(control_values) / len(control_values),
                    "treatment_mean": sum(treatment_values) / len(treatment_values),
                    "p_value": p_value,
                    "significant": p_value < 0.05,
                    "winner": "treatment" if sum(treatment_values) > sum(control_values) and p_value < 0.05 else "control"
                }

        return results
```

### Component 4: Cost and Usage Tracking

```python
from dataclasses import dataclass
from datetime import datetime

@dataclass
class LLMUsage:
    request_id: str
    timestamp: datetime
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    cost: float
    user_id: str
    prompt_version: str

class LLMCostTracker:
    """Track LLM usage and costs."""

    PRICING = {
        "gpt-4o": {"input": 2.50 / 1_000_000, "output": 10.00 / 1_000_000},
        "gpt-4o-mini": {"input": 0.15 / 1_000_000, "output": 0.60 / 1_000_000},
        "o1-preview": {"input": 15.00 / 1_000_000, "output": 60.00 / 1_000_000}
    }

    def __init__(self):
        self.usage_log = []
        self.budgets = {}

    def track_request(
        self,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: float,
        user_id: str,
        prompt_version: str
    ) -> LLMUsage:
        """Track an LLM request."""

        pricing = self.PRICING.get(model, self.PRICING["gpt-4o"])
        cost = (
            prompt_tokens * pricing["input"] +
            completion_tokens * pricing["output"]
        )

        usage = LLMUsage(
            request_id=self.generate_request_id(),
            timestamp=datetime.now(),
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            latency_ms=latency_ms,
            cost=cost,
            user_id=user_id,
            prompt_version=prompt_version
        )

        self.usage_log.append(usage)
        self.check_budget(user_id, cost)

        return usage

    def get_cost_report(
        self,
        start_date: datetime,
        end_date: datetime,
        group_by: str = "model"
    ) -> dict:
        """Generate cost report."""

        filtered = [
            u for u in self.usage_log
            if start_date <= u.timestamp <= end_date
        ]

        if group_by == "model":
            grouped = defaultdict(lambda: {"cost": 0, "requests": 0, "tokens": 0})
            for u in filtered:
                grouped[u.model]["cost"] += u.cost
                grouped[u.model]["requests"] += 1
                grouped[u.model]["tokens"] += u.total_tokens

        elif group_by == "prompt_version":
            grouped = defaultdict(lambda: {"cost": 0, "requests": 0, "tokens": 0})
            for u in filtered:
                grouped[u.prompt_version]["cost"] += u.cost
                grouped[u.prompt_version]["requests"] += 1
                grouped[u.prompt_version]["tokens"] += u.total_tokens

        return {
            "period": {"start": start_date, "end": end_date},
            "total_cost": sum(u.cost for u in filtered),
            "total_requests": len(filtered),
            "total_tokens": sum(u.total_tokens for u in filtered),
            "breakdown": dict(grouped)
        }

    def set_budget(self, entity: str, daily_limit: float):
        """Set daily budget limit."""
        self.budgets[entity] = daily_limit

    def check_budget(self, entity: str, cost: float):
        """Check if budget exceeded."""
        if entity in self.budgets:
            today_cost = sum(
                u.cost for u in self.usage_log
                if u.user_id == entity and u.timestamp.date() == datetime.now().date()
            )
            if today_cost > self.budgets[entity]:
                raise BudgetExceededException(f"Budget exceeded for {entity}")
```

### Component 5: Observability

```python
class LLMObservability:
    """Observability for LLM systems."""

    def __init__(self):
        self.traces = []

    def trace_request(
        self,
        request_id: str,
        prompt: str,
        response: str,
        metadata: dict
    ):
        """Create trace for LLM request."""

        trace = {
            "request_id": request_id,
            "timestamp": datetime.now().isoformat(),
            "input": {
                "prompt": prompt,
                "prompt_length": len(prompt),
                "prompt_tokens": metadata.get("prompt_tokens")
            },
            "output": {
                "response": response,
                "response_length": len(response),
                "completion_tokens": metadata.get("completion_tokens")
            },
            "metrics": {
                "latency_ms": metadata.get("latency_ms"),
                "model": metadata.get("model"),
                "cost": metadata.get("cost")
            },
            "quality": {
                "contains_refusal": self.detect_refusal(response),
                "confidence": metadata.get("confidence"),
                "citations": self.extract_citations(response)
            }
        }

        self.traces.append(trace)
        return trace

    def detect_refusal(self, response: str) -> bool:
        """Detect if model refused to answer."""
        refusal_patterns = [
            "I cannot",
            "I'm unable to",
            "I don't have information",
            "I can't assist with"
        ]
        return any(p.lower() in response.lower() for p in refusal_patterns)

    def get_quality_dashboard(self) -> dict:
        """Get quality metrics for dashboard."""

        recent_traces = self.traces[-1000:]

        return {
            "total_requests": len(recent_traces),
            "refusal_rate": sum(1 for t in recent_traces if t["quality"]["contains_refusal"]) / len(recent_traces),
            "avg_latency": sum(t["metrics"]["latency_ms"] for t in recent_traces) / len(recent_traces),
            "avg_response_length": sum(t["output"]["response_length"] for t in recent_traces) / len(recent_traces),
            "model_distribution": self.get_model_distribution(recent_traces)
        }
```

LLMOps is essential for reliable LLM applications. Start with prompt management and evaluation, then add observability and cost tracking as you scale.

## Resources

- [LangSmith](https://smith.langchain.com/)
- [Weights & Biases Prompts](https://wandb.ai/site/prompts)
- [Azure AI Foundry Tracing](https://learn.microsoft.com/en-us/azure/ai-foundry/)
