---
title: "Cost Controls for AI Applications: Budgeting and Optimization"
description: "Cost control in AI applications requires a multi-layered approach: track everything, set budgets, optimize requests, and review regularly. The strategies…"
author: "Michael John Peña"
draft: false
date: 2024-09-30
tags: ["Cost Control", "Budget", "AI", "Optimization", "FinOps"]
---

## Cost Tracking Foundation

```python
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
import threading

@dataclass
class ModelPricing:
    """Pricing for a specific model"""
    model: str
    input_per_million: Decimal
    output_per_million: Decimal
    cached_input_per_million: Optional[Decimal] = None

# Current pricing (as of September 2024)
PRICING = {
    "gpt-4o": ModelPricing(
        model="gpt-4o",
        input_per_million=Decimal("2.50"),
        output_per_million=Decimal("10.00")
    ),
    "gpt-4o-mini": ModelPricing(
        model="gpt-4o-mini",
        input_per_million=Decimal("0.15"),
        output_per_million=Decimal("0.60")
    ),
    "o1-preview": ModelPricing(
        model="o1-preview",
        input_per_million=Decimal("15.00"),
        output_per_million=Decimal("60.00")
    ),
    "o1-mini": ModelPricing(
        model="o1-mini",
        input_per_million=Decimal("3.00"),
        output_per_million=Decimal("12.00")
    ),
    "text-embedding-3-small": ModelPricing(
        model="text-embedding-3-small",
        input_per_million=Decimal("0.02"),
        output_per_million=Decimal("0")
    )
}

@dataclass
class UsageRecord:
    """Record of API usage"""
    timestamp: datetime
    model: str
    input_tokens: int
    output_tokens: int
    cost: Decimal
    user_id: Optional[str] = None
    request_id: Optional[str] = None

class CostTracker:
    """Track AI API costs"""

    def __init__(self):
        self.records: List[UsageRecord] = []
        self._lock = threading.Lock()

    def calculate_cost(self, model: str, input_tokens: int,
                      output_tokens: int) -> Decimal:
        """Calculate cost for a request"""
        if model not in PRICING:
            # Default to gpt-4o pricing if unknown
            pricing = PRICING["gpt-4o"]
        else:
            pricing = PRICING[model]

        input_cost = (Decimal(input_tokens) / 1_000_000) * pricing.input_per_million
        output_cost = (Decimal(output_tokens) / 1_000_000) * pricing.output_per_million

        return input_cost + output_cost

    def record(self, model: str, input_tokens: int, output_tokens: int,
              user_id: str = None, request_id: str = None):
        """Record usage"""
        cost = self.calculate_cost(model, input_tokens, output_tokens)

        record = UsageRecord(
            timestamp=datetime.now(),
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost,
            user_id=user_id,
            request_id=request_id
        )

        with self._lock:
            self.records.append(record)

        return cost

    def get_total_cost(self, period: timedelta = None) -> Decimal:
        """Get total cost for a period"""
        with self._lock:
            if period:
                cutoff = datetime.now() - period
                records = [r for r in self.records if r.timestamp > cutoff]
            else:
                records = self.records

            return sum(r.cost for r in records)

    def get_cost_by_model(self, period: timedelta = None) -> Dict[str, Decimal]:
        """Get cost breakdown by model"""
        with self._lock:
            if period:
                cutoff = datetime.now() - period
                records = [r for r in self.records if r.timestamp > cutoff]
            else:
                records = self.records

            costs = {}
            for record in records:
                if record.model not in costs:
                    costs[record.model] = Decimal("0")
                costs[record.model] += record.cost

            return costs

    def get_cost_by_user(self, period: timedelta = None) -> Dict[str, Decimal]:
        """Get cost breakdown by user"""
        with self._lock:
            if period:
                cutoff = datetime.now() - period
                records = [r for r in self.records if r.timestamp > cutoff]
            else:
                records = self.records

            costs = {}
            for record in records:
                user = record.user_id or "anonymous"
                if user not in costs:
                    costs[user] = Decimal("0")
                costs[user] += record.cost

            return costs
```

## Budget Enforcement

```python
from decimal import Decimal
from enum import Enum

class BudgetAction(Enum):
    ALLOW = "allow"
    WARN = "warn"
    LIMIT = "limit"
    BLOCK = "block"

@dataclass
class Budget:
    """Budget configuration"""
    name: str
    amount: Decimal
    period: timedelta
    warning_threshold: float = 0.75
    limit_threshold: float = 0.9

class BudgetEnforcer:
    """Enforce budget limits"""

    def __init__(self, cost_tracker: CostTracker):
        self.cost_tracker = cost_tracker
        self.budgets: Dict[str, Budget] = {}

    def set_budget(self, entity_id: str, budget: Budget):
        """Set budget for an entity"""
        self.budgets[entity_id] = budget

    def check_budget(self, entity_id: str, estimated_cost: Decimal) -> tuple[BudgetAction, str]:
        """Check if request is within budget"""

        if entity_id not in self.budgets:
            return BudgetAction.ALLOW, "No budget set"

        budget = self.budgets[entity_id]
        current_spend = self.cost_tracker.get_total_cost(budget.period)
        projected_spend = current_spend + estimated_cost

        utilization = float(projected_spend / budget.amount)

        if utilization >= 1.0:
            return BudgetAction.BLOCK, f"Budget exhausted: ${current_spend:.2f}/${budget.amount:.2f}"

        if utilization >= budget.limit_threshold:
            return BudgetAction.LIMIT, f"Budget nearly exhausted: {utilization:.1%} used"

        if utilization >= budget.warning_threshold:
            return BudgetAction.WARN, f"Budget warning: {utilization:.1%} used"

        return BudgetAction.ALLOW, f"Budget available: {utilization:.1%} used"

    def get_budget_status(self, entity_id: str) -> dict:
        """Get budget status for an entity"""

        if entity_id not in self.budgets:
            return {"error": "No budget set"}

        budget = self.budgets[entity_id]
        current_spend = self.cost_tracker.get_total_cost(budget.period)

        return {
            "budget": float(budget.amount),
            "spent": float(current_spend),
            "remaining": float(budget.amount - current_spend),
            "utilization": float(current_spend / budget.amount),
            "period_days": budget.period.days
        }

# Usage
cost_tracker = CostTracker()
budget_enforcer = BudgetEnforcer(cost_tracker)

# Set daily budget of $100
budget_enforcer.set_budget("org_123", Budget(
    name="daily_budget",
    amount=Decimal("100.00"),
    period=timedelta(days=1)
))

# Before each request
def call_with_budget(org_id: str, prompt: str, model: str = "gpt-4o") -> str:
    # Estimate cost
    estimated_tokens = len(prompt) // 4 + 1000
    estimated_cost = cost_tracker.calculate_cost(
        model,
        input_tokens=estimated_tokens,
        output_tokens=1000
    )

    # Check budget
    action, message = budget_enforcer.check_budget(org_id, estimated_cost)

    if action == BudgetAction.BLOCK:
        raise BudgetExceededError(message)

    if action == BudgetAction.LIMIT:
        # Use cheaper model
        model = "gpt-4o-mini"

    # Make request
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )

    # Record actual cost
    usage = response.usage
    cost_tracker.record(
        model=model,
        input_tokens=usage.prompt_tokens,
        output_tokens=usage.completion_tokens,
        user_id=org_id
    )

    return response.choices[0].message.content

class BudgetExceededError(Exception):
    pass
```

## Cost Optimization Strategies

```python
class CostOptimizer:
    """Optimize AI costs through various strategies"""

    def __init__(self):
        self.cache = {}
        self.cost_tracker = CostTracker()

    def optimize_request(self, prompt: str, required_quality: str = "standard") -> dict:
        """Optimize a request for cost"""

        strategies = []

        # Strategy 1: Check cache
        cache_key = self._hash_prompt(prompt)
        if cache_key in self.cache:
            return {
                "source": "cache",
                "cost": Decimal("0"),
                "response": self.cache[cache_key]
            }
        strategies.append("cache_miss")

        # Strategy 2: Model selection based on quality
        if required_quality == "high":
            model = "gpt-4o"
        elif required_quality == "standard":
            model = "gpt-4o-mini"  # 16x cheaper
        else:
            model = "gpt-4o-mini"

        strategies.append(f"model:{model}")

        # Strategy 3: Prompt optimization
        optimized_prompt = self._optimize_prompt(prompt)
        strategies.append(f"prompt_reduced:{len(prompt)-len(optimized_prompt)}_chars")

        # Strategy 4: Output length control
        max_tokens = self._estimate_required_tokens(prompt)
        strategies.append(f"max_tokens:{max_tokens}")

        return {
            "model": model,
            "prompt": optimized_prompt,
            "max_tokens": max_tokens,
            "strategies_applied": strategies,
            "estimated_cost": self.cost_tracker.calculate_cost(
                model, len(optimized_prompt) // 4, max_tokens
            )
        }

    def _hash_prompt(self, prompt: str) -> str:
        import hashlib
        return hashlib.sha256(prompt.encode()).hexdigest()

    def _optimize_prompt(self, prompt: str) -> str:
        """Remove unnecessary whitespace and redundancy"""
        # Remove extra whitespace
        optimized = " ".join(prompt.split())
        return optimized

    def _estimate_required_tokens(self, prompt: str) -> int:
        """Estimate required output tokens"""
        # Heuristic: shorter prompts usually need shorter responses
        prompt_tokens = len(prompt) // 4

        if prompt_tokens < 100:
            return 500
        elif prompt_tokens < 500:
            return 1000
        else:
            return 2000

class ModelRouter:
    """Route requests to optimal models based on cost/quality tradeoffs"""

    def __init__(self):
        self.complexity_classifier = self._build_classifier()

    def route(self, prompt: str, budget_remaining: Decimal) -> str:
        """Choose optimal model for request"""

        # Estimate complexity
        complexity = self._estimate_complexity(prompt)

        # Route based on complexity and budget
        if budget_remaining < Decimal("0.01"):
            return "gpt-4o-mini"  # Cheapest option

        if complexity == "high":
            if budget_remaining > Decimal("0.10"):
                return "gpt-4o"
            return "gpt-4o-mini"

        if complexity == "reasoning":
            if budget_remaining > Decimal("1.00"):
                return "o1-mini"
            return "gpt-4o"

        return "gpt-4o-mini"

    def _estimate_complexity(self, prompt: str) -> str:
        """Estimate task complexity"""
        prompt_lower = prompt.lower()

        # Keywords indicating reasoning tasks
        reasoning_keywords = ["prove", "derive", "analyze", "explain why", "step by step"]
        if any(kw in prompt_lower for kw in reasoning_keywords):
            return "reasoning"

        # Keywords indicating complex tasks
        complex_keywords = ["compare", "contrast", "evaluate", "synthesize"]
        if any(kw in prompt_lower for kw in complex_keywords):
            return "high"

        return "standard"
```

## Cost Reporting

```python
class CostReporter:
    """Generate cost reports"""

    def __init__(self, cost_tracker: CostTracker):
        self.cost_tracker = cost_tracker

    def daily_report(self) -> dict:
        """Generate daily cost report"""
        period = timedelta(days=1)

        return {
            "period": "daily",
            "total_cost": float(self.cost_tracker.get_total_cost(period)),
            "by_model": {
                k: float(v)
                for k, v in self.cost_tracker.get_cost_by_model(period).items()
            },
            "by_user": {
                k: float(v)
                for k, v in self.cost_tracker.get_cost_by_user(period).items()
            },
            "generated_at": datetime.now().isoformat()
        }

    def monthly_summary(self) -> dict:
        """Generate monthly summary"""
        period = timedelta(days=30)
        daily_costs = []

        # Calculate daily costs for trend
        for i in range(30):
            day_start = datetime.now() - timedelta(days=i+1)
            day_end = datetime.now() - timedelta(days=i)
            # Filter records for this day
            day_cost = sum(
                r.cost for r in self.cost_tracker.records
                if day_start <= r.timestamp < day_end
            )
            daily_costs.append(float(day_cost))

        return {
            "period": "monthly",
            "total_cost": float(self.cost_tracker.get_total_cost(period)),
            "daily_average": sum(daily_costs) / len(daily_costs) if daily_costs else 0,
            "daily_trend": daily_costs,
            "by_model": {
                k: float(v)
                for k, v in self.cost_tracker.get_cost_by_model(period).items()
            },
            "top_users": dict(sorted(
                self.cost_tracker.get_cost_by_user(period).items(),
                key=lambda x: x[1],
                reverse=True
            )[:10]),
            "recommendations": self._generate_recommendations()
        }

    def _generate_recommendations(self) -> List[str]:
        """Generate cost optimization recommendations"""
        recommendations = []

        by_model = self.cost_tracker.get_cost_by_model(timedelta(days=7))

        # Check if expensive models are overused
        if "gpt-4o" in by_model and by_model["gpt-4o"] > Decimal("100"):
            recommendations.append(
                "Consider using gpt-4o-mini for simpler tasks - potential 90% savings"
            )

        if "o1-preview" in by_model and by_model["o1-preview"] > Decimal("50"):
            recommendations.append(
                "Review o1-preview usage - ensure it's used only for complex reasoning tasks"
            )

        return recommendations
```

Cost control in AI applications requires a multi-layered approach: track everything, set budgets, optimize requests, and review regularly. The strategies here help you build cost-effective AI applications without sacrificing quality.
