---
title: "Prompt Caching: Reducing Latency and Cost for Repetitive Contexts"
author: Michael John Peña
draft: false
date: 2024-02-09
tags:
  - Prompt Caching
  - LLM Optimization
  - Latency
  - Azure OpenAI
  - Performance

---

I wrote "Prompt Caching: Reducing Latency and Cost for Repetitive Contexts" to share practical, production-minded guidance on this topic.

## The Problem

Many applications send the same system prompt and context repeatedly:

```python
# Same system prompt sent 10,000 times/day
system_prompt = """You are a customer service agent for ACME Corp.
You help customers with:
- Order status inquiries
- Return requests
- Product information
[... 500 more tokens of instructions ...]
"""

# Each call pays for these 500 tokens
```

## Solution: Cached Context

```python
class PromptCache:
    def __init__(self):
        self.context_cache = {}

    def create_cached_context(self, context_id: str, context: str) -> str:
        """Cache a common context for reuse."""
        self.context_cache[context_id] = {
            "content": context,
            "token_count": count_tokens(context),
            "created": datetime.utcnow()
        }
        return context_id

    def build_prompt(self, context_id: str, user_message: str) -> list[dict]:
        """Build prompt using cached context."""
        cached = self.context_cache.get(context_id)
        if not cached:
            raise ValueError(f"Context not found: {context_id}")

        return [
            {"role": "system", "content": cached["content"]},
            {"role": "user", "content": user_message}
        ]

# Create cached context once
cache = PromptCache()
cache.create_cached_context("customer_service", system_prompt)

# Reuse for all requests
messages = cache.build_prompt("customer_service", "Where is my order?")
```

## API-Level Caching (Azure OpenAI)

```python
# Azure OpenAI supports prompt caching at API level
# for prompts with identical prefixes

class AzurePromptOptimizer:
    def __init__(self, client):
        self.client = client
        self.prefix_cache = {}

    def optimize_batch(self, base_context: str, user_messages: list[str]) -> list:
        """Process batch with shared context efficiently."""

        # Sort messages to maximize prefix sharing
        # Azure can cache common prefixes between sequential requests

        results = []
        for msg in user_messages:
            response = self.client.chat.completions.create(
                model="gpt-4-turbo",
                messages=[
                    {"role": "system", "content": base_context},
                    {"role": "user", "content": msg}
                ]
            )
            results.append(response.choices[0].message.content)

        return results
```

## Measuring Impact

```python
def measure_caching_benefit(
    context_tokens: int,
    user_tokens: int,
    requests_per_day: int
) -> dict:
    """Calculate caching benefits."""

    # Without caching: pay for context every time
    without_caching = requests_per_day * (context_tokens + user_tokens)

    # With caching: context charged once (simplified)
    with_caching = context_tokens + (requests_per_day * user_tokens)

    savings = without_caching - with_caching
    savings_percent = (savings / without_caching) * 100

    return {
        "tokens_without_caching": without_caching,
        "tokens_with_caching": with_caching,
        "tokens_saved": savings,
        "savings_percent": savings_percent
    }

# Example: 500 token context, 100 token queries, 10K requests/day
result = measure_caching_benefit(500, 100, 10000)
# savings_percent ≈ 83%
```

## Best Practices

1. **Identify common prefixes** - System prompts, few-shot examples
2. **Batch similar requests** - Maximize cache efficiency
3. **Version your contexts** - Track when cached contexts change
4. **Monitor cache hit rates** - Ensure caching is working

## Conclusion

Prompt caching is especially valuable for applications with long, consistent system prompts. Structure your prompts to maximize prefix sharing.

