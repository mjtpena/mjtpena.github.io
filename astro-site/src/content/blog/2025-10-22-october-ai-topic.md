---
title: "Cost Optimization Strategies for Azure OpenAI Deployments"
description: "Balance cost and quality by routing requests to appropriate models based on task requirements."
author: Michael John Peña
draft: false
date: 2025-10-22
tags:
  - Azure OpenAI
  - Cost Optimization
  - FinOps
  - Token Management
  - Cloud Economics
---

## Token Usage Optimization

Implement intelligent prompt management to reduce token consumption:

```python
from dataclasses import dataclass
from typing import Optional
import tiktoken

@dataclass
class TokenBudget:
    max_prompt_tokens: int
    max_completion_tokens: int
    warning_threshold: float = 0.8

class TokenOptimizer:
    def __init__(self, model: str = "gpt-4"):
        self.encoding = tiktoken.encoding_for_model(model)

    def count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        return len(self.encoding.encode(text))

    def truncate_to_budget(self, text: str, max_tokens: int) -> str:
        """Truncate text to fit within token budget."""
        tokens = self.encoding.encode(text)
        if len(tokens) <= max_tokens:
            return text

        truncated_tokens = tokens[:max_tokens]
        return self.encoding.decode(truncated_tokens)

    def optimize_prompt(
        self,
        system_prompt: str,
        user_content: str,
        context: Optional[str],
        budget: TokenBudget
    ) -> dict:
        """Optimize prompt components to fit budget."""

        system_tokens = self.count_tokens(system_prompt)
        user_tokens = self.count_tokens(user_content)

        remaining_budget = budget.max_prompt_tokens - system_tokens - user_tokens

        optimized_context = ""
        if context and remaining_budget > 100:
            optimized_context = self.truncate_to_budget(context, remaining_budget - 50)

        total_tokens = system_tokens + user_tokens + self.count_tokens(optimized_context)

        return {
            "system_prompt": system_prompt,
            "user_content": user_content,
            "context": optimized_context,
            "total_prompt_tokens": total_tokens,
            "budget_utilization": total_tokens / budget.max_prompt_tokens
        }
```

## Implementing Caching

Cache repeated requests to avoid redundant API calls:

```python
import hashlib
import json
from datetime import datetime, timedelta

class ResponseCache:
    def __init__(self, redis_client, default_ttl_hours: int = 24):
        self.redis = redis_client
        self.default_ttl = timedelta(hours=default_ttl_hours)

    def _generate_key(self, prompt: str, model: str, temperature: float) -> str:
        """Generate cache key from request parameters."""
        content = json.dumps({
            "prompt": prompt,
            "model": model,
            "temperature": temperature
        }, sort_keys=True)
        return f"ai_cache:{hashlib.sha256(content.encode()).hexdigest()}"

    def get_cached_response(self, prompt: str, model: str, temperature: float) -> Optional[dict]:
        """Retrieve cached response if available."""
        key = self._generate_key(prompt, model, temperature)
        cached = self.redis.get(key)

        if cached:
            return json.loads(cached)
        return None

    def cache_response(
        self,
        prompt: str,
        model: str,
        temperature: float,
        response: dict,
        ttl: Optional[timedelta] = None
    ):
        """Cache response for future requests."""
        key = self._generate_key(prompt, model, temperature)
        ttl = ttl or self.default_ttl

        self.redis.setex(key, ttl, json.dumps(response))
```

## Model Selection Strategy

Choose the right model for each task:

```python
class ModelSelector:
    MODEL_COSTS = {
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-4-turbo": {"input": 0.01, "output": 0.03},
        "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015}
    }

    def select_model(self, task_complexity: str, quality_requirement: str) -> str:
        """Select optimal model based on requirements."""
        if quality_requirement == "high" and task_complexity in ["complex", "reasoning"]:
            return "gpt-4"
        elif task_complexity in ["simple", "classification"]:
            return "gpt-3.5-turbo"
        return "gpt-4-turbo"
```

Balance cost and quality by routing requests to appropriate models based on task requirements.
