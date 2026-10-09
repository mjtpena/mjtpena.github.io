---
title: "Introduction to LLMOps: MLOps for Large Language Models"
description: "LLMOps brings discipline to LLM application development. Start with these foundations and iterate as your applications mature."
author: Michael John Pena
draft: false
date: 2023-03-29
tags:
  - Azure
  - OpenAI
  - AI
  - LLMOps
  - MLOps
---

## LLMOps vs Traditional MLOps

| Aspect | Traditional MLOps | LLMOps |
|--------|------------------|--------|
| Model Training | Train from scratch | Fine-tune or prompt engineer |
| Data Management | Training datasets | Prompts, examples, RAG corpus |
| Versioning | Model weights | Prompts, configs, retrieval indices |
| Evaluation | Accuracy metrics | Quality, safety, factuality |
| Cost Driver | Training compute | Inference tokens |
| Deployment | Model serving | API management + caching |

## Prompt Versioning

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import json
import hashlib

@dataclass
class PromptVersion:
    name: str
    version: str
    system_prompt: str
    user_template: str
    model: str
    temperature: float
    max_tokens: int
    created_at: datetime = field(default_factory=datetime.utcnow)
    created_by: str = "system"
    metadata: dict = field(default_factory=dict)

    @property
    def hash(self) -> str:
        """Generate hash for change detection."""
        content = f"{self.system_prompt}{self.user_template}{self.model}{self.temperature}"
        return hashlib.md5(content.encode()).hexdigest()[:8]

class PromptRegistry:
    """Version-controlled prompt registry."""

    def __init__(self, storage_backend):
        self.storage = storage_backend
        self.cache = {}

    async def register(self, prompt: PromptVersion) -> str:
        """Register a new prompt version."""
        key = f"{prompt.name}:{prompt.version}"

        # Check for duplicate version
        existing = await self.storage.get(key)
        if existing:
            raise ValueError(f"Version {prompt.version} already exists for {prompt.name}")

        # Store
        await self.storage.set(key, prompt)

        # Update latest pointer
        await self.storage.set(f"{prompt.name}:latest", prompt.version)

        return key

    async def get(
        self,
        name: str,
        version: str = "latest"
    ) -> Optional[PromptVersion]:
        """Get a prompt version."""
        if version == "latest":
            version = await self.storage.get(f"{name}:latest")
            if not version:
                return None

        key = f"{name}:{version}"

        if key in self.cache:
            return self.cache[key]

        prompt = await self.storage.get(key)
        if prompt:
            self.cache[key] = prompt

        return prompt

    async def list_versions(self, name: str) -> list[str]:
        """List all versions of a prompt."""
        return await self.storage.list_keys(f"{name}:*")

    async def compare(
        self,
        name: str,
        version1: str,
        version2: str
    ) -> dict:
        """Compare two prompt versions."""
        p1 = await self.get(name, version1)
        p2 = await self.get(name, version2)

        return {
            "version1": version1,
            "version2": version2,
            "system_prompt_changed": p1.system_prompt != p2.system_prompt,
            "template_changed": p1.user_template != p2.user_template,
            "model_changed": p1.model != p2.model,
            "params_changed": p1.temperature != p2.temperature or p1.max_tokens != p2.max_tokens
        }
```

## Evaluation Pipeline

```python
from dataclasses import dataclass
from typing import Callable
import asyncio

@dataclass
class EvalCase:
    input: str
    expected_output: str = None
    expected_contains: list[str] = None
    expected_not_contains: list[str] = None
    metadata: dict = None

@dataclass
class EvalResult:
    case: EvalCase
    output: str
    passed: bool
    scores: dict
    latency_ms: float

class LLMEvaluator:
    """Evaluate LLM outputs systematically."""

    def __init__(self, client):
        self.client = client
        self.scorers = {}

    def add_scorer(self, name: str, scorer: Callable):
        """Add a custom scorer."""
        self.scorers[name] = scorer

    async def evaluate_prompt(
        self,
        prompt: PromptVersion,
        test_cases: list[EvalCase]
    ) -> dict:
        """Evaluate prompt against test cases."""

        results = []
        for case in test_cases:
            result = await self._evaluate_case(prompt, case)
            results.append(result)

        # Aggregate metrics
        passed = sum(1 for r in results if r.passed)
        avg_latency = sum(r.latency_ms for r in results) / len(results)

        score_aggregates = {}
        for scorer_name in self.scorers:
            scores = [r.scores.get(scorer_name, 0) for r in results]
            score_aggregates[scorer_name] = {
                "mean": sum(scores) / len(scores),
                "min": min(scores),
                "max": max(scores)
            }

        return {
            "prompt_name": prompt.name,
            "prompt_version": prompt.version,
            "total_cases": len(test_cases),
            "passed": passed,
            "pass_rate": passed / len(test_cases),
            "avg_latency_ms": avg_latency,
            "scores": score_aggregates,
            "results": results
        }

    async def _evaluate_case(
        self,
        prompt: PromptVersion,
        case: EvalCase
    ) -> EvalResult:
        """Evaluate single test case."""
        import time

        # Generate response
        start = time.time()
        user_message = prompt.user_template.format(input=case.input)

        response = await self.client.chat_completion(
            model=prompt.model,
            messages=[
                {"role": "system", "content": prompt.system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=prompt.temperature,
            max_tokens=prompt.max_tokens
        )

        latency = (time.time() - start) * 1000
        output = response.content

        # Run scorers
        scores = {}
        for name, scorer in self.scorers.items():
            scores[name] = await scorer(case, output)

        # Check pass criteria
        passed = True
        if case.expected_output:
            passed = passed and (output.strip() == case.expected_output.strip())
        if case.expected_contains:
            passed = passed and all(s in output for s in case.expected_contains)
        if case.expected_not_contains:
            passed = passed and not any(s in output for s in case.expected_not_contains)

        return EvalResult(
            case=case,
            output=output,
            passed=passed,
            scores=scores,
            latency_ms=latency
        )

# Built-in scorers
async def relevance_scorer(case: EvalCase, output: str) -> float:
    """Score output relevance to input."""
    # Use LLM to judge relevance
    # Return 0-1 score
    return 0.8

async def safety_scorer(case: EvalCase, output: str) -> float:
    """Score output safety."""
    # Check for harmful content
    return 1.0

async def factuality_scorer(case: EvalCase, output: str) -> float:
    """Score factual accuracy."""
    # Compare against expected or external sources
    return 0.9
```

## Deployment Pipeline

```python
class LLMDeploymentPipeline:
    """CI/CD pipeline for LLM applications."""

    def __init__(
        self,
        prompt_registry: PromptRegistry,
        evaluator: LLMEvaluator,
        deployment_target
    ):
        self.registry = prompt_registry
        self.evaluator = evaluator
        self.target = deployment_target

    async def deploy(
        self,
        prompt_name: str,
        version: str,
        test_cases: list[EvalCase],
        min_pass_rate: float = 0.9
    ) -> dict:
        """Deploy prompt with validation."""

        # Get prompt
        prompt = await self.registry.get(prompt_name, version)
        if not prompt:
            return {"success": False, "error": "Prompt not found"}

        # Run evaluation
        eval_results = await self.evaluator.evaluate_prompt(prompt, test_cases)

        # Check pass rate
        if eval_results["pass_rate"] < min_pass_rate:
            return {
                "success": False,
                "error": f"Pass rate {eval_results['pass_rate']:.2%} below threshold {min_pass_rate:.2%}",
                "evaluation": eval_results
            }

        # Deploy
        deployment = await self.target.deploy(prompt)

        # Update routing
        await self.target.update_routing(prompt_name, version)

        return {
            "success": True,
            "deployment": deployment,
            "evaluation": eval_results
        }

    async def rollback(
        self,
        prompt_name: str,
        target_version: str
    ) -> dict:
        """Rollback to previous version."""
        prompt = await self.registry.get(prompt_name, target_version)
        if not prompt:
            return {"success": False, "error": "Version not found"}

        await self.target.update_routing(prompt_name, target_version)

        return {"success": True, "rolled_back_to": target_version}

    async def canary_deploy(
        self,
        prompt_name: str,
        new_version: str,
        traffic_percent: float = 10
    ) -> dict:
        """Canary deployment with traffic splitting."""
        current_version = await self.registry.storage.get(f"{prompt_name}:production")
        new_prompt = await self.registry.get(prompt_name, new_version)

        # Configure traffic split
        await self.target.configure_traffic_split({
            current_version: 100 - traffic_percent,
            new_version: traffic_percent
        })

        return {
            "success": True,
            "canary_version": new_version,
            "traffic_percent": traffic_percent
        }
```

## Monitoring and Observability

```python
from dataclasses import dataclass
from datetime import datetime
import logging

@dataclass
class LLMRequestLog:
    request_id: str
    timestamp: datetime
    prompt_name: str
    prompt_version: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    status: str
    user_id: str = None
    cost: float = None

class LLMMonitor:
    """Monitor LLM application health and performance."""

    def __init__(self, metrics_backend, alerts_backend):
        self.metrics = metrics_backend
        self.alerts = alerts_backend
        self.logger = logging.getLogger("llmops")

    async def log_request(self, log: LLMRequestLog):
        """Log LLM request."""
        # Log to structured logging
        self.logger.info(
            "LLM Request",
            extra={
                "request_id": log.request_id,
                "prompt": f"{log.prompt_name}:{log.prompt_version}",
                "tokens": log.input_tokens + log.output_tokens,
                "latency_ms": log.latency_ms,
                "status": log.status
            }
        )

        # Record metrics
        await self.metrics.record("llm_requests_total", 1, {
            "prompt": log.prompt_name,
            "version": log.prompt_version,
            "status": log.status
        })

        await self.metrics.record("llm_tokens_total", log.input_tokens + log.output_tokens, {
            "prompt": log.prompt_name,
            "type": "total"
        })

        await self.metrics.record("llm_latency_ms", log.latency_ms, {
            "prompt": log.prompt_name
        })

        if log.cost:
            await self.metrics.record("llm_cost_usd", log.cost, {
                "prompt": log.prompt_name
            })

        # Check alerts
        await self._check_alerts(log)

    async def _check_alerts(self, log: LLMRequestLog):
        """Check for alert conditions."""
        # High latency alert
        if log.latency_ms > 5000:
            await self.alerts.send(
                severity="warning",
                message=f"High latency: {log.latency_ms}ms for {log.prompt_name}"
            )

        # Error alert
        if log.status == "error":
            await self.alerts.send(
                severity="error",
                message=f"LLM error for {log.prompt_name}: {log.request_id}"
            )

    async def get_dashboard_metrics(
        self,
        prompt_name: str = None,
        hours: int = 24
    ) -> dict:
        """Get metrics for dashboard."""
        return {
            "requests": await self.metrics.query("llm_requests_total", hours),
            "tokens": await self.metrics.query("llm_tokens_total", hours),
            "latency_p50": await self.metrics.query("llm_latency_ms", hours, aggregation="p50"),
            "latency_p99": await self.metrics.query("llm_latency_ms", hours, aggregation="p99"),
            "cost": await self.metrics.query("llm_cost_usd", hours, aggregation="sum"),
            "error_rate": await self.metrics.query("llm_requests_total", hours, filter={"status": "error"})
        }
```

## LLMOps Checklist

1. **Prompt Management**: Version control, registry, comparison
2. **Evaluation**: Automated testing, quality metrics, regression detection
3. **Deployment**: CI/CD, canary, rollback capability
4. **Monitoring**: Latency, tokens, costs, errors
5. **Cost Control**: Budgets, alerts, optimization
6. **Security**: Content filtering, PII detection, audit logs

LLMOps brings discipline to LLM application development. Start with these foundations and iterate as your applications mature.
