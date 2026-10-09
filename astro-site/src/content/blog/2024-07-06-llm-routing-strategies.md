---
title: "LLM Routing Strategies for Production Systems"
description: "The simplest approach: fixed rules based on task type. Pros: Simple, predictable, easy to debug Cons: Doesn't adapt, requires manual tuning"
author: Michael John Peña
draft: false
date: 2024-07-06
tags:
  - AI
  - LLM
  - Architecture
  - Azure
  - Routing
---

## The Routing Decision

Every request needs a routing decision based on:
- **Task complexity**: Simple vs. complex
- **Latency requirements**: Real-time vs. batch
- **Cost constraints**: Budget limits
- **Quality requirements**: Acceptable error rate
- **Context size**: Token requirements

## Static Routing

The simplest approach: fixed rules based on task type.

```python
from dataclasses import dataclass
from typing import Optional
import re

@dataclass
class RoutingRule:
    name: str
    model: str
    conditions: dict

class StaticRouter:
    def __init__(self):
        self.rules = [
            RoutingRule(
                name="code_tasks",
                model="claude-3.5-sonnet",
                conditions={"task_type": "code"}
            ),
            RoutingRule(
                name="classification",
                model="gpt-4o-mini",
                conditions={"task_type": "classification"}
            ),
            RoutingRule(
                name="long_context",
                model="claude-3.5-sonnet",
                conditions={"min_tokens": 50000}
            ),
            RoutingRule(
                name="default",
                model="gpt-4o",
                conditions={}
            ),
        ]

    def route(
        self,
        task_type: str,
        input_tokens: int,
        metadata: Optional[dict] = None
    ) -> str:
        for rule in self.rules:
            if self._matches(rule, task_type, input_tokens, metadata):
                return rule.model

        return "gpt-4o"  # Default fallback

    def _matches(
        self,
        rule: RoutingRule,
        task_type: str,
        input_tokens: int,
        metadata: Optional[dict]
    ) -> bool:
        conditions = rule.conditions

        if "task_type" in conditions and conditions["task_type"] != task_type:
            return False

        if "min_tokens" in conditions and input_tokens < conditions["min_tokens"]:
            return False

        if "max_tokens" in conditions and input_tokens > conditions["max_tokens"]:
            return False

        return True

# Usage
router = StaticRouter()
model = router.route(task_type="code", input_tokens=5000)
print(f"Routing to: {model}")
```

**Pros**: Simple, predictable, easy to debug
**Cons**: Doesn't adapt, requires manual tuning

## Dynamic Routing

Adjust routes based on real-time conditions:

```python
from datetime import datetime, timedelta
from collections import defaultdict
import threading

class DynamicRouter:
    def __init__(self):
        self.model_stats = defaultdict(lambda: {
            "success_count": 0,
            "error_count": 0,
            "total_latency_ms": 0,
            "last_error": None
        })
        self.lock = threading.Lock()
        self.circuit_breakers = {}

    def route(
        self,
        candidates: list[str],
        optimize_for: str = "balanced"
    ) -> str:
        available = [m for m in candidates if not self._is_circuit_open(m)]

        if not available:
            # All circuits open, try first candidate anyway
            available = candidates[:1]

        if optimize_for == "latency":
            return self._select_fastest(available)
        elif optimize_for == "reliability":
            return self._select_most_reliable(available)
        elif optimize_for == "cost":
            return self._select_cheapest(available)
        else:  # balanced
            return self._select_balanced(available)

    def _select_fastest(self, candidates: list[str]) -> str:
        def avg_latency(model):
            stats = self.model_stats[model]
            total = stats["success_count"] + stats["error_count"]
            if total == 0:
                return float("inf")
            return stats["total_latency_ms"] / total

        return min(candidates, key=avg_latency)

    def _select_most_reliable(self, candidates: list[str]) -> str:
        def success_rate(model):
            stats = self.model_stats[model]
            total = stats["success_count"] + stats["error_count"]
            if total == 0:
                return 0.5  # Unknown, assume average
            return stats["success_count"] / total

        return max(candidates, key=success_rate)

    def _select_cheapest(self, candidates: list[str]) -> str:
        costs = {
            "gpt-4o": 0.005,
            "claude-3.5-sonnet": 0.003,
            "gpt-4o-mini": 0.00015,
        }
        return min(candidates, key=lambda m: costs.get(m, 0.01))

    def _select_balanced(self, candidates: list[str]) -> str:
        def score(model):
            stats = self.model_stats[model]
            total = stats["success_count"] + stats["error_count"]

            if total < 10:
                return 0.5  # Not enough data

            success_rate = stats["success_count"] / total
            avg_latency = stats["total_latency_ms"] / total

            # Normalize latency (assume 2000ms is max acceptable)
            latency_score = max(0, 1 - (avg_latency / 2000))

            return (success_rate * 0.6) + (latency_score * 0.4)

        return max(candidates, key=score)

    def _is_circuit_open(self, model: str) -> bool:
        if model not in self.circuit_breakers:
            return False

        cb = self.circuit_breakers[model]
        if cb["state"] == "open":
            # Check if cooldown has passed
            if datetime.utcnow() > cb["retry_after"]:
                cb["state"] = "half-open"
                return False
            return True

        return False

    def record_result(
        self,
        model: str,
        success: bool,
        latency_ms: float
    ):
        with self.lock:
            stats = self.model_stats[model]

            if success:
                stats["success_count"] += 1
                stats["total_latency_ms"] += latency_ms

                # Reset circuit breaker on success
                if model in self.circuit_breakers:
                    if self.circuit_breakers[model]["state"] == "half-open":
                        del self.circuit_breakers[model]
            else:
                stats["error_count"] += 1
                stats["last_error"] = datetime.utcnow()

                # Check if circuit should open
                total = stats["success_count"] + stats["error_count"]
                if total >= 10:
                    error_rate = stats["error_count"] / total
                    if error_rate > 0.5:  # >50% errors
                        self.circuit_breakers[model] = {
                            "state": "open",
                            "retry_after": datetime.utcnow() + timedelta(minutes=5)
                        }

# Usage
router = DynamicRouter()

# Route request
model = router.route(
    candidates=["gpt-4o", "claude-3.5-sonnet"],
    optimize_for="balanced"
)

# After completion, record result
router.record_result(model, success=True, latency_ms=450)
```

## Content-Based Routing

Analyze the request content to choose the best model:

```python
import re
from typing import Callable

class ContentRouter:
    def __init__(self):
        self.analyzers: list[tuple[Callable[[str], bool], str]] = [
            (self._is_code_heavy, "claude-3.5-sonnet"),
            (self._is_math_heavy, "gpt-4o"),
            (self._is_simple_query, "gpt-4o-mini"),
            (self._has_image, "gpt-4o"),
        ]
        self.default_model = "gpt-4o"

    def route(self, content: str, has_images: bool = False) -> str:
        if has_images:
            return "gpt-4o"  # Vision capable

        for analyzer, model in self.analyzers:
            if analyzer(content):
                return model

        return self.default_model

    def _is_code_heavy(self, content: str) -> bool:
        # Check for code blocks or programming keywords
        code_patterns = [
            r"```\w*\n",  # Code blocks
            r"def \w+\(",  # Python functions
            r"function \w+\(",  # JavaScript functions
            r"class \w+",  # Class definitions
            r"import \w+",  # Import statements
        ]

        matches = sum(1 for p in code_patterns if re.search(p, content))
        return matches >= 2

    def _is_math_heavy(self, content: str) -> bool:
        math_patterns = [
            r"\d+\s*[\+\-\*\/\^]\s*\d+",  # Arithmetic
            r"equation|formula|calculate|solve",
            r"integral|derivative|matrix",
            r"\$.*\$",  # LaTeX
        ]

        matches = sum(1 for p in math_patterns if re.search(p, content, re.I))
        return matches >= 2

    def _is_simple_query(self, content: str) -> bool:
        # Short queries without complexity indicators
        if len(content) > 500:
            return False

        complex_indicators = [
            "explain in detail",
            "analyze",
            "compare and contrast",
            "step by step",
            "comprehensive",
        ]

        return not any(ind in content.lower() for ind in complex_indicators)

    def _has_image(self, content: str) -> bool:
        # Would check for image attachments in real implementation
        return False

# Usage
router = ContentRouter()

code_prompt = """
```python
def process_data(df):
    # Need help optimizing this
    return df.groupby('category').agg({'value': 'sum'})
```
Review this code for performance issues.
"""

model = router.route(code_prompt)
print(f"Code task routed to: {model}")  # claude-3.5-sonnet

simple_prompt = "What is the capital of France?"
model = router.route(simple_prompt)
print(f"Simple query routed to: {model}")  # gpt-4o-mini
```

## Hybrid Routing

Combine multiple strategies:

```python
from enum import Enum
from dataclasses import dataclass

class RoutingStrategy(Enum):
    STATIC = "static"
    DYNAMIC = "dynamic"
    CONTENT = "content"
    COST = "cost"
    LATENCY = "latency"

@dataclass
class RoutingContext:
    content: str
    task_type: str
    input_tokens: int
    has_images: bool
    max_latency_ms: int
    max_cost: float
    priority: str  # "quality", "speed", "cost"

class HybridRouter:
    def __init__(self):
        self.static_router = StaticRouter()
        self.dynamic_router = DynamicRouter()
        self.content_router = ContentRouter()

    def route(self, context: RoutingContext) -> str:
        candidates = self._get_candidates(context)

        # Apply filters
        candidates = self._filter_by_cost(candidates, context.max_cost)
        candidates = self._filter_by_latency(candidates, context.max_latency_ms)
        candidates = self._filter_by_capability(candidates, context)

        if not candidates:
            raise ValueError("No suitable model found for constraints")

        # Final selection based on priority
        if context.priority == "quality":
            return self._select_highest_quality(candidates)
        elif context.priority == "speed":
            return self.dynamic_router.route(candidates, optimize_for="latency")
        elif context.priority == "cost":
            return self.dynamic_router.route(candidates, optimize_for="cost")

        return self.dynamic_router.route(candidates, optimize_for="balanced")

    def _get_candidates(self, context: RoutingContext) -> list[str]:
        # Start with content-based suggestion
        content_suggestion = self.content_router.route(
            context.content,
            context.has_images
        )

        # Get static routing suggestion
        static_suggestion = self.static_router.route(
            context.task_type,
            context.input_tokens
        )

        # Build candidate list prioritizing suggestions
        all_models = ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini"]
        candidates = []

        if content_suggestion:
            candidates.append(content_suggestion)
        if static_suggestion and static_suggestion not in candidates:
            candidates.append(static_suggestion)

        for model in all_models:
            if model not in candidates:
                candidates.append(model)

        return candidates

    def _filter_by_cost(
        self,
        candidates: list[str],
        max_cost: float
    ) -> list[str]:
        costs = {
            "gpt-4o": 0.005,
            "claude-3.5-sonnet": 0.003,
            "gpt-4o-mini": 0.00015,
        }
        return [m for m in candidates if costs.get(m, 0.01) <= max_cost]

    def _filter_by_latency(
        self,
        candidates: list[str],
        max_latency_ms: int
    ) -> list[str]:
        expected_latency = {
            "gpt-4o": 800,
            "claude-3.5-sonnet": 600,
            "gpt-4o-mini": 300,
        }
        return [m for m in candidates if expected_latency.get(m, 1000) <= max_latency_ms]

    def _filter_by_capability(
        self,
        candidates: list[str],
        context: RoutingContext
    ) -> list[str]:
        if context.has_images:
            vision_models = ["gpt-4o", "claude-3.5-sonnet"]
            return [m for m in candidates if m in vision_models]

        if context.input_tokens > 100000:
            long_context_models = ["claude-3.5-sonnet", "gpt-4o"]
            return [m for m in candidates if m in long_context_models]

        return candidates

    def _select_highest_quality(self, candidates: list[str]) -> str:
        quality_ranking = ["claude-3.5-sonnet", "gpt-4o", "gpt-4o-mini"]
        for model in quality_ranking:
            if model in candidates:
                return model
        return candidates[0]

# Usage
router = HybridRouter()

context = RoutingContext(
    content="Review this Python code for security issues...",
    task_type="code_review",
    input_tokens=2000,
    has_images=False,
    max_latency_ms=2000,
    max_cost=0.01,
    priority="quality"
)

model = router.route(context)
print(f"Selected model: {model}")
```

## A/B Testing Routes

Test routing strategies systematically:

```python
import random
import hashlib
from datetime import datetime

class ABTestRouter:
    def __init__(self):
        self.experiments = {
            "code_model_test": {
                "control": {"model": "gpt-4o", "weight": 0.5},
                "treatment": {"model": "claude-3.5-sonnet", "weight": 0.5},
                "task_types": ["code_review", "code_generation"],
            }
        }
        self.results = []

    def route_with_experiment(
        self,
        task_type: str,
        user_id: str
    ) -> tuple[str, str, str]:  # model, experiment_name, variant
        # Find applicable experiment
        for exp_name, exp_config in self.experiments.items():
            if task_type in exp_config.get("task_types", []):
                variant = self._assign_variant(user_id, exp_name, exp_config)
                model = exp_config[variant]["model"]
                return model, exp_name, variant

        return "gpt-4o", None, None

    def _assign_variant(
        self,
        user_id: str,
        experiment_name: str,
        config: dict
    ) -> str:
        # Deterministic assignment based on user_id
        hash_input = f"{user_id}:{experiment_name}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16)
        normalized = (hash_value % 1000) / 1000

        control_weight = config["control"]["weight"]
        return "control" if normalized < control_weight else "treatment"

    def record_result(
        self,
        experiment_name: str,
        variant: str,
        success: bool,
        latency_ms: float,
        quality_score: float = None
    ):
        self.results.append({
            "timestamp": datetime.utcnow().isoformat(),
            "experiment": experiment_name,
            "variant": variant,
            "success": success,
            "latency_ms": latency_ms,
            "quality_score": quality_score
        })

    def get_experiment_stats(self, experiment_name: str) -> dict:
        exp_results = [r for r in self.results if r["experiment"] == experiment_name]

        stats = {}
        for variant in ["control", "treatment"]:
            variant_results = [r for r in exp_results if r["variant"] == variant]
            if variant_results:
                stats[variant] = {
                    "count": len(variant_results),
                    "success_rate": sum(1 for r in variant_results if r["success"]) / len(variant_results),
                    "avg_latency": sum(r["latency_ms"] for r in variant_results) / len(variant_results),
                    "avg_quality": sum(r["quality_score"] or 0 for r in variant_results) / len(variant_results)
                }

        return stats
```

## Best Practices

1. **Start simple**: Begin with static routing, add complexity as needed
2. **Measure everything**: You can't optimize what you don't measure
3. **Use circuit breakers**: Protect against cascading failures
4. **Test routing changes**: A/B test before full rollout
5. **Document routing logic**: Make decisions traceable

## Conclusion

Good routing is the difference between an efficient multi-model system and a chaotic one. Start with clear routing rules, measure outcomes, and iterate based on data.

The goal is maximizing value: right model, right task, right cost.
