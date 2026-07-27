---
title: "Cost Optimization for LLMs: Strategies That Work"
author: Michael John Peña
draft: false
date: 2024-02-06
tags:
  - Cost Optimization
  - LLM
  - Azure OpenAI
  - Token Management
  - Enterprise AI

---

I wrote "Cost Optimization for LLMs: Strategies That Work" to share practical, production-minded guidance on this topic.

## Cost Reduction Strategies

### 1. Prompt Optimization

```python
def optimize_prompt(prompt: str, context: str) -> str:
    """Reduce prompt size while preserving meaning."""

    # Remove redundant instructions
    prompt = re.sub(r'\b(please|kindly|could you)\b', '', prompt, flags=re.I)

    # Truncate context to relevant portions
    max_context_chars = 4000
    if len(context) > max_context_chars:
        context = context[:max_context_chars] + "..."

    # Use concise formatting
    return f"{prompt}\n\nContext: {context}"

# Before: 2000 tokens
# After: 800 tokens
# Savings: 60%
```

### 2. Response Caching

```python
import hashlib
from functools import lru_cache

class LLMCache:
    def __init__(self, ttl_hours: int = 24):
        self.cache = {}
        self.ttl = ttl_hours * 3600

    def get_or_call(self, prompt: str, llm_func) -> str:
        cache_key = hashlib.md5(prompt.encode()).hexdigest()

        if cache_key in self.cache:
            cached = self.cache[cache_key]
            if time.time() - cached["time"] < self.ttl:
                return cached["response"]

        response = llm_func(prompt)
        self.cache[cache_key] = {"response": response, "time": time.time()}
        return response

# Cache hit rate of 30% = 30% cost reduction
```

### 3. Model Tiering

```python
def select_model_by_task(task_complexity: str) -> tuple[str, float]:
    tiers = {
        "simple": ("gpt-3.5-turbo", 0.002),
        "medium": ("gpt-4-turbo", 0.03),
        "complex": ("gpt-4", 0.06)
    }
    return tiers.get(task_complexity, tiers["medium"])

# 60% simple, 30% medium, 10% complex
# Blended cost: 0.6 * 0.002 + 0.3 * 0.03 + 0.1 * 0.06 = $0.016/1K
# vs all GPT-4: $0.06/1K
# Savings: 73%
```

### 4. Batch Processing

```python
async def batch_process(prompts: list[str], batch_size: int = 20) -> list[str]:
    """Process prompts in batches for efficiency."""

    results = []
    for i in range(0, len(prompts), batch_size):
        batch = prompts[i:i + batch_size]
        batch_results = await asyncio.gather(*[
            process_single(p) for p in batch
        ])
        results.extend(batch_results)

    return results

# Reduces overhead and enables better rate limit management
```

### 5. Token Budget Management

```python
class TokenBudget:
    def __init__(self, daily_budget: int = 1_000_000):
        self.daily_budget = daily_budget
        self.used_today = 0

    def can_process(self, estimated_tokens: int) -> bool:
        return self.used_today + estimated_tokens <= self.daily_budget

    def record_usage(self, tokens: int):
        self.used_today += tokens

    def get_remaining(self) -> int:
        return self.daily_budget - self.used_today
```

## Cost Monitoring

```python
def calculate_daily_cost(usage_log: list[dict]) -> dict:
    pricing = {
        "gpt-4-turbo": {"input": 0.01, "output": 0.03},
        "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015}
    }

    costs = {}
    for entry in usage_log:
        model = entry["model"]
        p = pricing.get(model, pricing["gpt-4-turbo"])
        cost = (
            entry["input_tokens"] / 1000 * p["input"] +
            entry["output_tokens"] / 1000 * p["output"]
        )
        costs[model] = costs.get(model, 0) + cost

    return costs
```

## Best Practices Summary

1. **Cache aggressively** - Identical queries don't need re-processing
2. **Tier your models** - Match model to task complexity
3. **Optimize prompts** - Shorter prompts = lower costs
4. **Set budgets** - Prevent runaway spending
5. **Monitor continuously** - Track cost per query

## Conclusion

Cost optimization is essential for sustainable AI at scale. Combine these strategies to reduce costs by 50-80% while maintaining quality.

