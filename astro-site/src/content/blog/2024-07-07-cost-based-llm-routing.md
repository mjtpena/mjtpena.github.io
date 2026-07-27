---
title: "Cost-Based LLM Routing: Optimizing AI Spend"
author: Michael John Peña
draft: false
date: 2024-07-07
tags:
  - AI
  - LLM
  - Cost Optimization
  - Azure
  - FinOps

---

I wrote "Cost-Based LLM Routing: Optimizing AI Spend" to share practical, production-minded guidance on this topic.

## The Cost Landscape

Current pricing (per 1M tokens):

| Model | Input | Output | Relative Cost |
|-------|-------|--------|---------------|
| GPT-4o | $5.00 | $15.00 | 1x |
| Claude 3.5 Sonnet | $3.00 | $15.00 | 0.9x |
| GPT-4o-mini | $0.15 | $0.60 | 0.03x |
| Claude 3 Haiku | $0.25 | $1.25 | 0.06x |

The difference is dramatic. A 1000-token task costs $0.02 with GPT-4o but $0.0002 with GPT-4o-mini.

## Cost-Aware Router Implementation

```python
from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)

@dataclass
class ModelCost:
    input_per_1k: float
    output_per_1k: float

    def estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        return (input_tokens / 1000 * self.input_per_1k +
                output_tokens / 1000 * self.output_per_1k)

@dataclass
class CostBudget:
    max_per_request: float
    daily_limit: float
    monthly_limit: float

class CostBasedRouter:
    def __init__(self, budget: CostBudget):
        self.budget = budget
        self.costs = {
            "gpt-4o": ModelCost(0.005, 0.015),
            "claude-3.5-sonnet": ModelCost(0.003, 0.015),
            "gpt-4o-mini": ModelCost(0.00015, 0.0006),
            "claude-3-haiku": ModelCost(0.00025, 0.00125),
        }
        self.daily_spend = 0.0
        self.monthly_spend = 0.0

        # Quality tiers (1-5, 5 being highest)
        self.quality_tiers = {
            "gpt-4o": 5,
            "claude-3.5-sonnet": 5,
            "gpt-4o-mini": 3,
            "claude-3-haiku": 3,
        }

    def route(
        self,
        input_tokens: int,
        expected_output_tokens: int,
        min_quality_tier: int = 3,
        prefer_cheapest: bool = True
    ) -> Optional[str]:
        """Route to cheapest model that meets quality requirements and budget."""

        candidates = []

        for model, cost in self.costs.items():
            # Check quality tier
            if self.quality_tiers[model] < min_quality_tier:
                continue

            estimated_cost = cost.estimate_cost(input_tokens, expected_output_tokens)

            # Check per-request budget
            if estimated_cost > self.budget.max_per_request:
                continue

            # Check daily budget
            if self.daily_spend + estimated_cost > self.budget.daily_limit:
                continue

            candidates.append((model, estimated_cost, self.quality_tiers[model]))

        if not candidates:
            logger.warning("No model available within budget constraints")
            return None

        if prefer_cheapest:
            # Sort by cost, then by quality (higher is better as tiebreaker)
            candidates.sort(key=lambda x: (x[1], -x[2]))
        else:
            # Sort by quality (higher first), then cost
            candidates.sort(key=lambda x: (-x[2], x[1]))

        selected = candidates[0][0]
        logger.info(f"Selected {selected} with estimated cost ${candidates[0][1]:.4f}")

        return selected

    def record_spend(self, amount: float):
        """Record actual spend after request completion."""
        self.daily_spend += amount
        self.monthly_spend += amount

        # Log warnings at thresholds
        if self.daily_spend > self.budget.daily_limit * 0.8:
            logger.warning(f"Daily spend at {self.daily_spend / self.budget.daily_limit * 100:.1f}%")
        if self.monthly_spend > self.budget.monthly_limit * 0.8:
            logger.warning(f"Monthly spend at {self.monthly_spend / self.budget.monthly_limit * 100:.1f}%")

    def reset_daily(self):
        """Reset daily counter (call from scheduler)."""
        self.daily_spend = 0.0

    def reset_monthly(self):
        """Reset monthly counter (call from scheduler)."""
        self.monthly_spend = 0.0

# Usage
budget = CostBudget(
    max_per_request=0.10,  # $0.10 max per request
    daily_limit=50.00,      # $50/day
    monthly_limit=1000.00   # $1000/month
)

router = CostBasedRouter(budget)

# Simple task - will route to cheapest
model = router.route(
    input_tokens=500,
    expected_output_tokens=200,
    min_quality_tier=3  # Accepts mini models
)
print(f"Simple task: {model}")  # gpt-4o-mini

# Complex task requiring high quality
model = router.route(
    input_tokens=5000,
    expected_output_tokens=2000,
    min_quality_tier=5  # Requires top tier
)
print(f"Complex task: {model}")  # claude-3.5-sonnet (cheaper input)
```

## Task-Complexity Scoring

Automatically determine required quality tier:

```python
import re
from dataclasses import dataclass

@dataclass
class ComplexityScore:
    score: int  # 1-5
    reasoning: str

class TaskComplexityAnalyzer:
    def __init__(self):
        self.complexity_indicators = {
            "high": [
                (r"analyze.*detail", 2),
                (r"compare and contrast", 2),
                (r"code review", 2),
                (r"security audit", 2),
                (r"step by step reasoning", 1),
                (r"comprehensive", 1),
                (r"```[\w]*\n.*```", 1),  # Code blocks
                (r"explain why", 1),
            ],
            "low": [
                (r"^(what|who|when|where) is", -1),
                (r"summarize", -1),
                (r"list \d+", -1),
                (r"true or false", -2),
                (r"yes or no", -2),
            ]
        }

    def analyze(self, prompt: str) -> ComplexityScore:
        base_score = 3  # Start at medium
        reasons = []

        # Length factor
        word_count = len(prompt.split())
        if word_count > 1000:
            base_score += 1
            reasons.append("long input")
        elif word_count < 50:
            base_score -= 1
            reasons.append("short input")

        # Pattern matching
        prompt_lower = prompt.lower()

        for pattern, adjustment in self.complexity_indicators["high"]:
            if re.search(pattern, prompt_lower, re.DOTALL):
                base_score += adjustment
                reasons.append(f"matched: {pattern[:20]}")

        for pattern, adjustment in self.complexity_indicators["low"]:
            if re.search(pattern, prompt_lower):
                base_score += adjustment
                reasons.append(f"matched simple: {pattern[:20]}")

        # Clamp to 1-5
        final_score = max(1, min(5, base_score))

        return ComplexityScore(
            score=final_score,
            reasoning=", ".join(reasons) if reasons else "default"
        )

class SmartCostRouter:
    def __init__(self, budget: CostBudget):
        self.cost_router = CostBasedRouter(budget)
        self.analyzer = TaskComplexityAnalyzer()

    def route(
        self,
        prompt: str,
        expected_output_tokens: int = 1000
    ) -> tuple[str, ComplexityScore]:
        # Analyze complexity
        complexity = self.analyzer.analyze(prompt)

        # Route based on complexity
        model = self.cost_router.route(
            input_tokens=len(prompt.split()) * 1.3,  # Rough token estimate
            expected_output_tokens=expected_output_tokens,
            min_quality_tier=complexity.score
        )

        return model, complexity

# Usage
smart_router = SmartCostRouter(budget)

# Simple question
model, complexity = smart_router.route("What is the capital of France?")
print(f"Model: {model}, Complexity: {complexity.score}")
# Model: gpt-4o-mini, Complexity: 2

# Complex analysis
model, complexity = smart_router.route("""
Analyze this code in detail for security vulnerabilities:
```python
def authenticate(username, password):
    query = f"SELECT * FROM users WHERE username='{username}' AND password='{password}'"
    return db.execute(query)
```
Explain why each vulnerability is dangerous and provide corrected code.
""")
print(f"Model: {model}, Complexity: {complexity.score}")
# Model: claude-3.5-sonnet, Complexity: 5
```

## Cost Tracking and Alerts

Monitor spending in real-time:

```python
from datetime import datetime, timedelta
from collections import defaultdict
import json

class CostTracker:
    def __init__(self, storage_path: str = "cost_data.json"):
        self.storage_path = storage_path
        self.hourly_costs = defaultdict(float)
        self.daily_costs = defaultdict(float)
        self.by_model = defaultdict(float)
        self.by_task_type = defaultdict(float)
        self.alerts_sent = set()

    def record(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        task_type: str = "unknown"
    ):
        cost = self._calculate_cost(model, input_tokens, output_tokens)

        now = datetime.utcnow()
        hour_key = now.strftime("%Y-%m-%d-%H")
        day_key = now.strftime("%Y-%m-%d")

        self.hourly_costs[hour_key] += cost
        self.daily_costs[day_key] += cost
        self.by_model[model] += cost
        self.by_task_type[task_type] += cost

        self._check_alerts(day_key)

        return cost

    def _calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        costs = {
            "gpt-4o": (0.005, 0.015),
            "claude-3.5-sonnet": (0.003, 0.015),
            "gpt-4o-mini": (0.00015, 0.0006),
            "claude-3-haiku": (0.00025, 0.00125),
        }

        if model not in costs:
            return 0.0

        input_cost, output_cost = costs[model]
        return (input_tokens / 1000 * input_cost +
                output_tokens / 1000 * output_cost)

    def _check_alerts(self, day_key: str):
        daily_total = self.daily_costs[day_key]
        thresholds = [10, 25, 50, 100, 200, 500]

        for threshold in thresholds:
            alert_key = f"{day_key}-{threshold}"
            if daily_total >= threshold and alert_key not in self.alerts_sent:
                self._send_alert(f"Daily AI spend reached ${threshold}")
                self.alerts_sent.add(alert_key)

    def _send_alert(self, message: str):
        # In production: send to Slack, Teams, email, etc.
        print(f"ALERT: {message}")

    def get_daily_report(self, date: str = None) -> dict:
        if date is None:
            date = datetime.utcnow().strftime("%Y-%m-%d")

        return {
            "date": date,
            "total_cost": self.daily_costs.get(date, 0),
            "by_model": dict(self.by_model),
            "by_task_type": dict(self.by_task_type),
        }

    def get_optimization_suggestions(self) -> list[str]:
        suggestions = []

        # Check model usage patterns
        total = sum(self.by_model.values())
        if total > 0:
            expensive_ratio = (self.by_model.get("gpt-4o", 0) +
                             self.by_model.get("claude-3.5-sonnet", 0)) / total

            if expensive_ratio > 0.8:
                suggestions.append(
                    f"80%+ of spend is on premium models. "
                    f"Review if all tasks require this quality level."
                )

        # Check task distribution
        if self.by_task_type:
            top_task = max(self.by_task_type.items(), key=lambda x: x[1])
            if top_task[1] > total * 0.5:
                suggestions.append(
                    f"'{top_task[0]}' accounts for 50%+ of spend. "
                    f"Consider optimizing this task type specifically."
                )

        return suggestions

# Usage
tracker = CostTracker()

# After each API call
cost = tracker.record(
    model="gpt-4o",
    input_tokens=1500,
    output_tokens=500,
    task_type="code_review"
)
print(f"Request cost: ${cost:.4f}")

# Get daily report
report = tracker.get_daily_report()
print(f"Daily total: ${report['total_cost']:.2f}")

# Get optimization suggestions
for suggestion in tracker.get_optimization_suggestions():
    print(f"Suggestion: {suggestion}")
```

## Budget Enforcement Strategies

Different approaches for staying within budget:

```python
from enum import Enum

class BudgetStrategy(Enum):
    HARD_LIMIT = "hard_limit"      # Reject requests over budget
    DOWNGRADE = "downgrade"         # Use cheaper model
    QUEUE = "queue"                 # Queue for later
    ALERT_ONLY = "alert_only"       # Allow but alert

class BudgetEnforcer:
    def __init__(
        self,
        daily_budget: float,
        strategy: BudgetStrategy = BudgetStrategy.DOWNGRADE
    ):
        self.daily_budget = daily_budget
        self.strategy = strategy
        self.current_spend = 0.0
        self.queued_requests = []

    def check_request(
        self,
        estimated_cost: float,
        requested_model: str,
        priority: int = 5  # 1-10, 10 highest
    ) -> tuple[bool, str, str]:
        """
        Returns (allowed, model_to_use, message)
        """
        remaining = self.daily_budget - self.current_spend

        if estimated_cost <= remaining:
            return True, requested_model, "Within budget"

        if self.strategy == BudgetStrategy.HARD_LIMIT:
            return False, None, "Daily budget exceeded"

        elif self.strategy == BudgetStrategy.DOWNGRADE:
            # Try to find a cheaper alternative
            cheaper = self._find_cheaper_model(estimated_cost, remaining)
            if cheaper:
                return True, cheaper, f"Downgraded to {cheaper} due to budget"
            return False, None, "No model fits remaining budget"

        elif self.strategy == BudgetStrategy.QUEUE:
            self.queued_requests.append({
                "model": requested_model,
                "cost": estimated_cost,
                "priority": priority
            })
            return False, None, "Request queued for tomorrow"

        elif self.strategy == BudgetStrategy.ALERT_ONLY:
            return True, requested_model, "WARNING: Over budget"

        return False, None, "Unknown strategy"

    def _find_cheaper_model(self, original_cost: float, max_cost: float) -> str:
        # Estimate costs for alternatives
        alternatives = [
            ("gpt-4o-mini", 0.03),  # Relative cost factor
            ("claude-3-haiku", 0.06),
        ]

        for model, factor in alternatives:
            if original_cost * factor <= max_cost:
                return model

        return None

    def process_queued(self, new_daily_budget: float = None):
        """Process queued requests with fresh budget."""
        if new_daily_budget:
            self.daily_budget = new_daily_budget
        self.current_spend = 0.0

        # Sort by priority
        self.queued_requests.sort(key=lambda x: x["priority"], reverse=True)

        processed = []
        for request in self.queued_requests:
            allowed, model, msg = self.check_request(
                request["cost"],
                request["model"],
                request["priority"]
            )
            if allowed:
                processed.append(request)
                self.current_spend += request["cost"]

        # Remove processed
        for p in processed:
            self.queued_requests.remove(p)

        return processed

# Usage
enforcer = BudgetEnforcer(
    daily_budget=50.0,
    strategy=BudgetStrategy.DOWNGRADE
)

# Check if request is allowed
allowed, model, message = enforcer.check_request(
    estimated_cost=0.05,
    requested_model="gpt-4o"
)

if allowed:
    print(f"Proceed with {model}: {message}")
else:
    print(f"Blocked: {message}")
```

## Best Practices

1. **Set realistic budgets**: Base on actual value delivered, not arbitrary limits
2. **Track by task type**: Know where money goes
3. **Review regularly**: Costs and capabilities change
4. **Have fallback plans**: Don't fail silently when budget exhausted
5. **Communicate limits**: Users should know about constraints

## Conclusion

Cost-based routing isn't about being cheap - it's about being efficient. Use the right model for each task, and you'll get better results for less money.

The key insight: most tasks don't need GPT-4o. Reserve premium models for where they matter.

