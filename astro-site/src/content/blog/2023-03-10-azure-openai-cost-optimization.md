---
title: "Azure OpenAI Cost Optimization Strategies"
description: "One token is roughly 4 characters in English. A 1000-word document is about 1300 tokens. Start with these strategies and refine based on your usage…"
author: Michael John Pena
draft: false
date: 2023-03-10
tags:
  - Azure
  - OpenAI
  - AI
  - Cost Optimization
  - FinOps
---

## Understanding the Cost Model

Azure OpenAI charges per token:
- GPT-3.5 Turbo: ~$0.002 per 1K tokens
- GPT-4 (8K): ~$0.03 input / $0.06 output per 1K tokens
- GPT-4 (32K): ~$0.06 input / $0.12 output per 1K tokens
- Embeddings: ~$0.0004 per 1K tokens

One token is roughly 4 characters in English. A 1000-word document is about 1300 tokens.

## Strategy 1: Model Selection

Route requests to the cheapest capable model:

```python
from enum import Enum
from dataclasses import dataclass

class TaskComplexity(Enum):
    SIMPLE = "simple"        # Classification, simple extraction
    MODERATE = "moderate"    # Summarization, basic analysis
    COMPLEX = "complex"      # Multi-step reasoning, code review
    ADVANCED = "advanced"    # Long-form analysis, complex code

@dataclass
class ModelConfig:
    deployment: str
    cost_per_1k_input: float
    cost_per_1k_output: float
    context_window: int

MODELS = {
    TaskComplexity.SIMPLE: ModelConfig("gpt-35-turbo", 0.002, 0.002, 4096),
    TaskComplexity.MODERATE: ModelConfig("gpt-35-turbo", 0.002, 0.002, 4096),
    TaskComplexity.COMPLEX: ModelConfig("gpt-4", 0.03, 0.06, 8192),
    TaskComplexity.ADVANCED: ModelConfig("gpt-4-32k", 0.06, 0.12, 32768),
}

class ModelRouter:
    def __init__(self):
        self.complexity_patterns = {
            TaskComplexity.SIMPLE: [
                "classify", "categorize", "extract entity",
                "yes or no", "true or false"
            ],
            TaskComplexity.MODERATE: [
                "summarize", "explain briefly", "list",
                "translate", "rewrite"
            ],
            TaskComplexity.COMPLEX: [
                "analyze", "compare", "evaluate",
                "debug", "review code", "optimize"
            ],
            TaskComplexity.ADVANCED: [
                "comprehensive analysis", "detailed review",
                "full document", "entire codebase"
            ]
        }

    def classify_task(self, prompt: str) -> TaskComplexity:
        """Determine task complexity from prompt."""
        prompt_lower = prompt.lower()

        for complexity, patterns in self.complexity_patterns.items():
            if any(p in prompt_lower for p in patterns):
                return complexity

        return TaskComplexity.MODERATE  # Default

    def select_model(self, prompt: str, context_length: int = 0) -> ModelConfig:
        """Select optimal model for task."""
        complexity = self.classify_task(prompt)
        config = MODELS[complexity]

        # Upgrade if context exceeds model limit
        total_tokens = context_length + len(prompt) // 4
        if total_tokens > config.context_window * 0.8:
            if complexity in [TaskComplexity.SIMPLE, TaskComplexity.MODERATE]:
                complexity = TaskComplexity.COMPLEX
            else:
                complexity = TaskComplexity.ADVANCED
            config = MODELS[complexity]

        return config

# Usage
router = ModelRouter()
model = router.select_model("Classify this customer feedback as positive or negative")
print(f"Using {model.deployment} (${model.cost_per_1k_input}/1K tokens)")
```

## Strategy 2: Prompt Optimization

Reduce tokens while maintaining quality:

```python
class PromptOptimizer:
    def __init__(self):
        self.abbreviations = {
            "Please": "",
            "Could you please": "",
            "I would like you to": "",
            "Can you help me": "",
        }

    def optimize(self, prompt: str) -> str:
        """Reduce prompt length without losing meaning."""
        optimized = prompt

        # Remove filler phrases
        for phrase, replacement in self.abbreviations.items():
            optimized = optimized.replace(phrase, replacement)

        # Remove excessive whitespace
        optimized = ' '.join(optimized.split())

        # Remove redundant instructions
        optimized = optimized.replace("Make sure to", "")
        optimized = optimized.replace("Remember to", "")

        return optimized.strip()

    def estimate_savings(self, original: str, optimized: str) -> dict:
        """Estimate token savings."""
        original_tokens = len(original) // 4
        optimized_tokens = len(optimized) // 4
        savings = original_tokens - optimized_tokens

        return {
            "original_tokens": original_tokens,
            "optimized_tokens": optimized_tokens,
            "tokens_saved": savings,
            "percent_reduction": (savings / original_tokens * 100) if original_tokens > 0 else 0
        }

# Example
optimizer = PromptOptimizer()
original = """Please could you help me analyze this customer feedback and
classify it as positive, negative, or neutral. Make sure to consider the
overall sentiment and any specific mentions of our products or services.
Remember to be thorough in your analysis."""

optimized = optimizer.optimize(original)
print(f"Optimized: {optimized}")
print(f"Savings: {optimizer.estimate_savings(original, optimized)}")
```

## Strategy 3: Caching

Cache repeated queries:

```python
import hashlib
import json
from datetime import datetime, timedelta
from typing import Optional

class ResponseCache:
    def __init__(self, redis_client, ttl_hours: int = 24):
        self.redis = redis_client
        self.ttl = timedelta(hours=ttl_hours)

    def _hash_request(self, model: str, messages: list, params: dict) -> str:
        """Create cache key from request."""
        content = json.dumps({
            "model": model,
            "messages": messages,
            "temperature": params.get("temperature", 0.7)
        }, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()

    def get(self, model: str, messages: list, params: dict) -> Optional[str]:
        """Get cached response."""
        key = self._hash_request(model, messages, params)
        cached = self.redis.get(f"openai:{key}")
        if cached:
            return json.loads(cached)
        return None

    def set(self, model: str, messages: list, params: dict, response: str):
        """Cache response."""
        key = self._hash_request(model, messages, params)
        self.redis.setex(
            f"openai:{key}",
            self.ttl,
            json.dumps(response)
        )

class CachedOpenAIClient:
    def __init__(self, cache: ResponseCache):
        self.cache = cache
        self.cache_hits = 0
        self.cache_misses = 0

    def chat_completion(self, model: str, messages: list, **params) -> str:
        """Chat completion with caching."""
        # Only cache deterministic responses
        if params.get("temperature", 0.7) > 0:
            return self._call_api(model, messages, params)

        # Check cache
        cached = self.cache.get(model, messages, params)
        if cached:
            self.cache_hits += 1
            return cached

        # Call API
        self.cache_misses += 1
        response = self._call_api(model, messages, params)

        # Cache response
        self.cache.set(model, messages, params, response)
        return response

    def _call_api(self, model: str, messages: list, params: dict) -> str:
        import openai
        response = openai.ChatCompletion.create(
            engine=model,
            messages=messages,
            **params
        )
        return response.choices[0].message.content

    def get_stats(self) -> dict:
        """Get cache statistics."""
        total = self.cache_hits + self.cache_misses
        return {
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "hit_rate": self.cache_hits / total if total > 0 else 0
        }
```

## Strategy 4: Batch Processing

Process multiple items efficiently:

```python
import asyncio
from dataclasses import dataclass
from typing import Callable
import openai

@dataclass
class BatchItem:
    id: str
    content: str
    result: str = None
    error: str = None

class BatchProcessor:
    def __init__(self, model: str, max_concurrent: int = 5):
        self.model = model
        self.semaphore = asyncio.Semaphore(max_concurrent)

    async def process_item(self, item: BatchItem, prompt_template: str) -> BatchItem:
        """Process a single item."""
        async with self.semaphore:
            try:
                prompt = prompt_template.format(content=item.content)

                response = await openai.ChatCompletion.acreate(
                    engine=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0
                )

                item.result = response.choices[0].message.content
            except Exception as e:
                item.error = str(e)

            return item

    async def process_batch(
        self,
        items: list[BatchItem],
        prompt_template: str
    ) -> list[BatchItem]:
        """Process all items concurrently."""
        tasks = [
            self.process_item(item, prompt_template)
            for item in items
        ]
        return await asyncio.gather(*tasks)

# Usage
async def classify_feedback():
    items = [
        BatchItem(id="1", content="Great product!"),
        BatchItem(id="2", content="Terrible experience."),
        BatchItem(id="3", content="It's okay I guess."),
    ]

    processor = BatchProcessor("gpt-35-turbo", max_concurrent=10)
    results = await processor.process_batch(
        items,
        "Classify this feedback as positive, negative, or neutral: {content}"
    )

    for item in results:
        print(f"{item.id}: {item.result}")

# asyncio.run(classify_feedback())
```

## Strategy 5: Token Budgeting

Set and enforce limits:

```python
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Dict

@dataclass
class TokenBudget:
    daily_limit: int
    monthly_limit: int
    daily_used: int = 0
    monthly_used: int = 0
    last_reset_date: date = field(default_factory=date.today)
    last_reset_month: int = field(default_factory=lambda: date.today().month)

class BudgetManager:
    def __init__(self, budgets: Dict[str, TokenBudget]):
        self.budgets = budgets

    def check_budget(self, project: str, tokens_needed: int) -> bool:
        """Check if budget allows request."""
        if project not in self.budgets:
            return True

        budget = self.budgets[project]
        self._reset_if_needed(budget)

        # Check limits
        if budget.daily_used + tokens_needed > budget.daily_limit:
            return False
        if budget.monthly_used + tokens_needed > budget.monthly_limit:
            return False

        return True

    def record_usage(self, project: str, tokens: int):
        """Record token usage."""
        if project not in self.budgets:
            self.budgets[project] = TokenBudget(
                daily_limit=100000,
                monthly_limit=3000000
            )

        budget = self.budgets[project]
        self._reset_if_needed(budget)

        budget.daily_used += tokens
        budget.monthly_used += tokens

    def _reset_if_needed(self, budget: TokenBudget):
        """Reset counters if period elapsed."""
        today = date.today()

        if budget.last_reset_date != today:
            budget.daily_used = 0
            budget.last_reset_date = today

        if budget.last_reset_month != today.month:
            budget.monthly_used = 0
            budget.last_reset_month = today.month

    def get_usage_report(self) -> dict:
        """Get usage report for all projects."""
        report = {}
        for project, budget in self.budgets.items():
            report[project] = {
                "daily_used": budget.daily_used,
                "daily_limit": budget.daily_limit,
                "daily_percent": budget.daily_used / budget.daily_limit * 100,
                "monthly_used": budget.monthly_used,
                "monthly_limit": budget.monthly_limit,
                "monthly_percent": budget.monthly_used / budget.monthly_limit * 100,
            }
        return report
```

## Strategy 6: Monitoring and Alerts

Track spending in real-time:

```python
from dataclasses import dataclass
from datetime import datetime
import logging

@dataclass
class UsageEvent:
    timestamp: datetime
    project: str
    model: str
    input_tokens: int
    output_tokens: int
    cost: float

class CostMonitor:
    def __init__(self, alert_threshold: float = 100.0):
        self.events: list[UsageEvent] = []
        self.alert_threshold = alert_threshold
        self.logger = logging.getLogger(__name__)

    def record(self, project: str, model: str, input_tokens: int, output_tokens: int):
        """Record usage event."""
        cost = self._calculate_cost(model, input_tokens, output_tokens)

        event = UsageEvent(
            timestamp=datetime.utcnow(),
            project=project,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost
        )

        self.events.append(event)
        self._check_alerts(project)

    def _calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """Calculate cost in dollars."""
        rates = {
            "gpt-35-turbo": (0.002, 0.002),
            "gpt-4": (0.03, 0.06),
            "gpt-4-32k": (0.06, 0.12),
        }

        input_rate, output_rate = rates.get(model, (0.002, 0.002))
        return (input_tokens / 1000 * input_rate) + (output_tokens / 1000 * output_rate)

    def _check_alerts(self, project: str):
        """Check if spending exceeds threshold."""
        today = datetime.utcnow().date()
        daily_cost = sum(
            e.cost for e in self.events
            if e.project == project and e.timestamp.date() == today
        )

        if daily_cost > self.alert_threshold:
            self.logger.warning(
                f"ALERT: Project {project} daily spend (${daily_cost:.2f}) "
                f"exceeds threshold (${self.alert_threshold:.2f})"
            )

    def get_daily_report(self) -> dict:
        """Get daily spending report."""
        today = datetime.utcnow().date()
        today_events = [e for e in self.events if e.timestamp.date() == today]

        by_project = {}
        for event in today_events:
            if event.project not in by_project:
                by_project[event.project] = {"cost": 0, "requests": 0, "tokens": 0}

            by_project[event.project]["cost"] += event.cost
            by_project[event.project]["requests"] += 1
            by_project[event.project]["tokens"] += event.input_tokens + event.output_tokens

        return {
            "date": str(today),
            "total_cost": sum(e.cost for e in today_events),
            "total_requests": len(today_events),
            "by_project": by_project
        }
```

## Quick Wins Checklist

1. Use GPT-3.5 for simple tasks
2. Cache deterministic responses
3. Optimize prompts to reduce tokens
4. Batch similar requests
5. Set token budgets per project
6. Monitor costs daily
7. Use shorter max_tokens where possible
8. Leverage embeddings caching

Start with these strategies and refine based on your usage patterns. A 50-70% cost reduction is achievable with proper optimization.
