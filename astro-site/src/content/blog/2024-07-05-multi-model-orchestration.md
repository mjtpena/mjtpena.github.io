---
title: "Multi-Model Orchestration: Using Multiple LLMs Effectively"
description: "Different tasks need different capability levels. Using GPT-4o for simple classifications wastes money."
author: Michael John Peña
draft: false
date: 2024-07-05
tags:
  - AI
  - LLM
  - Architecture
  - Azure
  - Multi-Model
---

## Why Multi-Model?

**Different Strengths**

No single model excels at everything:
- GPT-4o: Great at math, real-time audio
- Claude 3.5 Sonnet: Excellent at code, precise instructions
- Gemini: Strong multimodal, long context
- Llama 3: Open source, customizable, local deployment

**Risk Mitigation**

Relying on one provider creates risk:
- Outages happen
- Pricing changes
- Policy changes
- Capability regressions

**Cost Optimization**

Different tasks need different capability levels. Using GPT-4o for simple classifications wastes money.

## Basic Orchestration Pattern

```python
from enum import Enum
from typing import Protocol, Any
from dataclasses import dataclass
import os

class ModelCapability(Enum):
    CODE_GENERATION = "code_generation"
    REASONING = "reasoning"
    CLASSIFICATION = "classification"
    SUMMARIZATION = "summarization"
    MATH = "math"
    VISION = "vision"
    LONG_CONTEXT = "long_context"

@dataclass
class ModelConfig:
    name: str
    provider: str
    capabilities: list[ModelCapability]
    cost_per_1k_input: float
    cost_per_1k_output: float
    max_tokens: int
    latency_ms: float  # Average

class LLMClient(Protocol):
    def complete(self, messages: list[dict], **kwargs) -> str: ...
    def get_usage(self) -> dict: ...

class ModelOrchestrator:
    def __init__(self):
        self.models: dict[str, ModelConfig] = {}
        self.clients: dict[str, LLMClient] = {}
        self._setup_models()

    def _setup_models(self):
        self.models = {
            "gpt-4o": ModelConfig(
                name="gpt-4o",
                provider="azure_openai",
                capabilities=[
                    ModelCapability.CODE_GENERATION,
                    ModelCapability.REASONING,
                    ModelCapability.MATH,
                    ModelCapability.VISION,
                ],
                cost_per_1k_input=0.005,
                cost_per_1k_output=0.015,
                max_tokens=128000,
                latency_ms=800
            ),
            "claude-3.5-sonnet": ModelConfig(
                name="claude-3-5-sonnet-20240620",
                provider="anthropic",
                capabilities=[
                    ModelCapability.CODE_GENERATION,
                    ModelCapability.REASONING,
                    ModelCapability.LONG_CONTEXT,
                ],
                cost_per_1k_input=0.003,
                cost_per_1k_output=0.015,
                max_tokens=200000,
                latency_ms=600
            ),
            "gpt-4o-mini": ModelConfig(
                name="gpt-4o-mini",
                provider="azure_openai",
                capabilities=[
                    ModelCapability.CLASSIFICATION,
                    ModelCapability.SUMMARIZATION,
                ],
                cost_per_1k_input=0.00015,
                cost_per_1k_output=0.0006,
                max_tokens=128000,
                latency_ms=300
            ),
        }

    def select_model(
        self,
        required_capabilities: list[ModelCapability],
        optimize_for: str = "cost",  # cost, latency, quality
        max_tokens_needed: int = 4096
    ) -> str:
        candidates = []

        for model_name, config in self.models.items():
            # Check capability match
            if all(cap in config.capabilities for cap in required_capabilities):
                if config.max_tokens >= max_tokens_needed:
                    candidates.append((model_name, config))

        if not candidates:
            raise ValueError(f"No model supports capabilities: {required_capabilities}")

        # Sort by optimization criteria
        if optimize_for == "cost":
            candidates.sort(key=lambda x: x[1].cost_per_1k_input)
        elif optimize_for == "latency":
            candidates.sort(key=lambda x: x[1].latency_ms)
        elif optimize_for == "quality":
            # Prefer more expensive models as proxy for quality
            candidates.sort(key=lambda x: x[1].cost_per_1k_input, reverse=True)

        return candidates[0][0]

    def complete(
        self,
        messages: list[dict],
        capabilities: list[ModelCapability],
        optimize_for: str = "cost",
        **kwargs
    ) -> tuple[str, str]:  # (response, model_used)
        model_name = self.select_model(
            capabilities,
            optimize_for,
            kwargs.get("max_tokens", 4096)
        )

        client = self._get_client(model_name)
        response = client.complete(messages, **kwargs)

        return response, model_name

    def _get_client(self, model_name: str) -> LLMClient:
        if model_name not in self.clients:
            config = self.models[model_name]
            self.clients[model_name] = self._create_client(config)
        return self.clients[model_name]

    def _create_client(self, config: ModelConfig) -> LLMClient:
        if config.provider == "azure_openai":
            return AzureOpenAIClient(config.name)
        elif config.provider == "anthropic":
            return AnthropicClient(config.name)
        raise ValueError(f"Unknown provider: {config.provider}")
```

## Task-Based Routing

Route tasks to appropriate models:

```python
from dataclasses import dataclass
from typing import Callable

@dataclass
class TaskRoute:
    task_type: str
    model: str
    system_prompt: str
    preprocessor: Callable[[str], str] = None
    postprocessor: Callable[[str], Any] = None

class TaskRouter:
    def __init__(self, orchestrator: ModelOrchestrator):
        self.orchestrator = orchestrator
        self.routes = self._setup_routes()

    def _setup_routes(self) -> dict[str, TaskRoute]:
        return {
            "code_review": TaskRoute(
                task_type="code_review",
                model="claude-3.5-sonnet",
                system_prompt="""You are a senior software engineer reviewing code.
                Focus on: bugs, security issues, performance, maintainability.
                Be specific and provide corrected code snippets."""
            ),
            "sql_generation": TaskRoute(
                task_type="sql_generation",
                model="gpt-4o",
                system_prompt="""You are a database expert. Generate optimized SQL.
                Consider indexing, query plans, and Azure SQL/Synapse best practices.""",
                postprocessor=lambda x: x.strip().strip("```sql").strip("```")
            ),
            "classification": TaskRoute(
                task_type="classification",
                model="gpt-4o-mini",
                system_prompt="""Classify the input into exactly one category.
                Return only the category name, nothing else."""
            ),
            "summarization": TaskRoute(
                task_type="summarization",
                model="gpt-4o-mini",
                system_prompt="""Summarize the following text concisely.
                Focus on key points and actionable insights."""
            ),
            "complex_reasoning": TaskRoute(
                task_type="complex_reasoning",
                model="claude-3.5-sonnet",
                system_prompt="""Think through this problem step by step.
                Consider multiple approaches and explain your reasoning."""
            ),
        }

    def route(self, task_type: str, content: str, **kwargs) -> tuple[str, str]:
        route = self.routes.get(task_type)
        if not route:
            raise ValueError(f"Unknown task type: {task_type}")

        # Preprocess if needed
        if route.preprocessor:
            content = route.preprocessor(content)

        messages = [
            {"role": "system", "content": route.system_prompt},
            {"role": "user", "content": content}
        ]

        config = self.orchestrator.models[route.model]
        client = self.orchestrator._get_client(route.model)
        response = client.complete(messages, **kwargs)

        # Postprocess if needed
        if route.postprocessor:
            response = route.postprocessor(response)

        return response, route.model

# Usage
orchestrator = ModelOrchestrator()
router = TaskRouter(orchestrator)

# Route different tasks to appropriate models
code_feedback, model1 = router.route("code_review", python_code)
query, model2 = router.route("sql_generation", "Get top 10 customers by revenue")
category, model3 = router.route("classification", email_text)
```

## Parallel Execution

For independent tasks, run models in parallel:

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

class ParallelOrchestrator:
    def __init__(self, orchestrator: ModelOrchestrator):
        self.orchestrator = orchestrator
        self.executor = ThreadPoolExecutor(max_workers=10)

    async def execute_parallel(
        self,
        tasks: list[dict]  # [{"messages": [...], "capabilities": [...], ...}]
    ) -> list[tuple[str, str]]:
        loop = asyncio.get_event_loop()

        futures = [
            loop.run_in_executor(
                self.executor,
                lambda t=task: self.orchestrator.complete(
                    t["messages"],
                    t["capabilities"],
                    **t.get("kwargs", {})
                )
            )
            for task in tasks
        ]

        results = await asyncio.gather(*futures, return_exceptions=True)
        return results

    async def consensus(
        self,
        messages: list[dict],
        models: list[str],
        aggregator: Callable[[list[str]], str] = None
    ) -> str:
        """Get responses from multiple models and aggregate."""
        tasks = [
            {
                "messages": messages,
                "capabilities": [],
                "kwargs": {"model_override": model}
            }
            for model in models
        ]

        results = await self.execute_parallel(tasks)
        responses = [r[0] for r in results if not isinstance(r, Exception)]

        if aggregator:
            return aggregator(responses)

        # Default: return majority or first
        return responses[0] if responses else None

# Usage
parallel = ParallelOrchestrator(orchestrator)

# Run multiple analyses in parallel
tasks = [
    {
        "messages": [{"role": "user", "content": f"Analyze: {text}"}],
        "capabilities": [ModelCapability.REASONING]
    }
    for text in documents
]

results = asyncio.run(parallel.execute_parallel(tasks))
```

## Fallback Chains

Handle failures gracefully:

```python
class FallbackChain:
    def __init__(self, orchestrator: ModelOrchestrator):
        self.orchestrator = orchestrator
        self.chains = {
            "default": ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini"],
            "code": ["claude-3.5-sonnet", "gpt-4o", "gpt-4o-mini"],
            "fast": ["gpt-4o-mini", "gpt-4o", "claude-3.5-sonnet"],
        }

    def execute_with_fallback(
        self,
        messages: list[dict],
        chain_name: str = "default",
        **kwargs
    ) -> tuple[str, str, list[str]]:
        chain = self.chains.get(chain_name, self.chains["default"])
        errors = []

        for model_name in chain:
            try:
                client = self.orchestrator._get_client(model_name)
                response = client.complete(messages, **kwargs)
                return response, model_name, errors
            except Exception as e:
                errors.append(f"{model_name}: {str(e)}")
                continue

        raise RuntimeError(f"All models failed: {errors}")

# Usage
fallback = FallbackChain(orchestrator)
response, model_used, errors = fallback.execute_with_fallback(
    messages=[{"role": "user", "content": "Generate a report"}],
    chain_name="default"
)
```

## Monitoring and Observability

Track multi-model usage:

```python
from datetime import datetime
import json

class OrchestrationMetrics:
    def __init__(self):
        self.metrics = []

    def record(
        self,
        model: str,
        task_type: str,
        latency_ms: float,
        input_tokens: int,
        output_tokens: int,
        success: bool,
        error: str = None
    ):
        self.metrics.append({
            "timestamp": datetime.utcnow().isoformat(),
            "model": model,
            "task_type": task_type,
            "latency_ms": latency_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "success": success,
            "error": error,
            "estimated_cost": self._estimate_cost(model, input_tokens, output_tokens)
        })

    def _estimate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        costs = {
            "gpt-4o": (0.005, 0.015),
            "claude-3.5-sonnet": (0.003, 0.015),
            "gpt-4o-mini": (0.00015, 0.0006),
        }
        if model in costs:
            input_cost, output_cost = costs[model]
            return (input_tokens / 1000 * input_cost) + (output_tokens / 1000 * output_cost)
        return 0

    def get_summary(self) -> dict:
        if not self.metrics:
            return {}

        by_model = {}
        for m in self.metrics:
            model = m["model"]
            if model not in by_model:
                by_model[model] = {"count": 0, "total_cost": 0, "avg_latency": 0, "errors": 0}
            by_model[model]["count"] += 1
            by_model[model]["total_cost"] += m["estimated_cost"]
            by_model[model]["avg_latency"] += m["latency_ms"]
            if not m["success"]:
                by_model[model]["errors"] += 1

        for model in by_model:
            by_model[model]["avg_latency"] /= by_model[model]["count"]

        return by_model
```

## Best Practices

1. **Start with capability mapping**: Know what each model does well
2. **Build abstraction layers**: Don't couple to specific APIs
3. **Monitor everything**: Track costs, latency, errors by model
4. **Test fallbacks**: Ensure your chain handles outages gracefully
5. **Version your prompts**: Different models may need different prompts

## Conclusion

Multi-model orchestration isn't just about having options - it's about using each model optimally. The setup investment pays off in cost savings, reliability, and better results.

Start with simple routing, add complexity as needed, and always measure the outcomes.
