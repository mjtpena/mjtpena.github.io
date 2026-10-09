---
title: "Cost Reduction Strategies with GPT-4o"
description: "GPT-4o is already 50% cheaper than GPT-4 Turbo, but there are more ways to optimize costs. Here are practical strategies I use in production."
author: Michael John Peña
draft: false
date: 2024-05-07
tags:
  - AI
  - OpenAI
  - GPT-4o
  - Cost Optimization
  - Azure
---

GPT-4o is already 50% cheaper than GPT-4 Turbo, but there are more ways to optimize costs. Here are practical strategies I use in production.

## Understanding GPT-4o Pricing

| Token Type | GPT-4 Turbo | GPT-4o | Savings |
|------------|-------------|--------|---------|
| Input | $10/1M | $5/1M | 50% |
| Output | $30/1M | $15/1M | 50% |

For a typical application processing 1M input tokens and 500K output tokens daily:

- GPT-4 Turbo: $10 + $15 = $25/day = $750/month
- GPT-4o: $5 + $7.50 = $12.50/day = $375/month

## Strategy 1: Prompt Optimization

Reduce input tokens by optimizing prompts:

```python
# Before: Verbose prompt (150 tokens)
verbose_prompt = """
You are an expert data analyst with years of experience in business intelligence.
Your task is to analyze the following data and provide comprehensive insights.
Please consider all aspects including trends, anomalies, and patterns.
Make sure to explain your reasoning in detail.
Here is the data you need to analyze:
"""

# After: Concise prompt (30 tokens)
concise_prompt = """Analyze this data. Report: trends, anomalies, key insights.
Data:"""

# Token savings: 80% reduction in system prompt tokens
```

## Strategy 2: Response Length Control

```python
def get_completion(prompt: str, max_length: str = "concise") -> str:
    length_instructions = {
        "brief": "Answer in 1-2 sentences.",
        "concise": "Keep response under 100 words.",
        "detailed": "Provide comprehensive analysis."
    }

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": f"Be helpful. {length_instructions[max_length]}"
            },
            {"role": "user", "content": prompt}
        ],
        max_tokens=500 if max_length != "detailed" else 2000
    )

    return response.choices[0].message.content
```

## Strategy 3: Caching Responses

```python
import hashlib
import redis
import json

class CachedOpenAI:
    def __init__(self, client, redis_client):
        self.client = client
        self.cache = redis_client
        self.cache_ttl = 3600  # 1 hour

    def _cache_key(self, messages: list, model: str) -> str:
        content = json.dumps({"messages": messages, "model": model})
        return f"openai:{hashlib.sha256(content.encode()).hexdigest()}"

    def chat(self, messages: list, **kwargs) -> str:
        cache_key = self._cache_key(messages, kwargs.get("model", "gpt-4o"))

        # Check cache
        cached = self.cache.get(cache_key)
        if cached:
            return json.loads(cached)

        # Make API call
        response = self.client.chat.completions.create(
            messages=messages,
            **kwargs
        )

        result = response.choices[0].message.content

        # Cache result
        self.cache.setex(
            cache_key,
            self.cache_ttl,
            json.dumps(result)
        )

        return result

# Usage
redis_client = redis.Redis(host='localhost', port=6379)
cached_client = CachedOpenAI(client, redis_client)

# First call: API request
result1 = cached_client.chat([{"role": "user", "content": "What is Azure?"}], model="gpt-4o")

# Second call: From cache (no cost)
result2 = cached_client.chat([{"role": "user", "content": "What is Azure?"}], model="gpt-4o")
```

## Strategy 4: Model Routing

Use cheaper models for simpler tasks:

```python
from enum import Enum

class TaskComplexity(Enum):
    SIMPLE = "simple"
    MODERATE = "moderate"
    COMPLEX = "complex"

class ModelRouter:
    MODEL_MAP = {
        TaskComplexity.SIMPLE: "gpt-3.5-turbo",  # $0.50/$1.50 per 1M
        TaskComplexity.MODERATE: "gpt-4o-mini",   # $0.15/$0.60 per 1M
        TaskComplexity.COMPLEX: "gpt-4o"          # $5/$15 per 1M
    }

    def __init__(self, client):
        self.client = client

    def classify_task(self, prompt: str) -> TaskComplexity:
        """Simple heuristic-based classification."""
        prompt_lower = prompt.lower()

        # Complex indicators
        if any(word in prompt_lower for word in
               ["analyze", "compare", "strategy", "optimize", "architecture"]):
            return TaskComplexity.COMPLEX

        # Moderate indicators
        if any(word in prompt_lower for word in
               ["explain", "summarize", "list", "describe"]):
            return TaskComplexity.MODERATE

        return TaskComplexity.SIMPLE

    def route(self, prompt: str, force_model: str = None) -> str:
        if force_model:
            model = force_model
        else:
            complexity = self.classify_task(prompt)
            model = self.MODEL_MAP[complexity]

        response = self.client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.choices[0].message.content, model

# Usage
router = ModelRouter(client)

# Simple question -> GPT-3.5 Turbo
answer, model = router.route("What is the capital of France?")
print(f"Used {model}")  # gpt-3.5-turbo

# Complex analysis -> GPT-4o
answer, model = router.route("Analyze this system architecture for scalability issues...")
print(f"Used {model}")  # gpt-4o
```

## Strategy 5: Batching Requests

```python
import asyncio
from typing import List

async def batch_process(prompts: List[str], batch_size: int = 10) -> List[str]:
    """Process multiple prompts efficiently."""
    results = []

    for i in range(0, len(prompts), batch_size):
        batch = prompts[i:i + batch_size]

        # Process batch concurrently
        tasks = [
            asyncio.to_thread(
                client.chat.completions.create,
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}]
            )
            for prompt in batch
        ]

        responses = await asyncio.gather(*tasks)
        results.extend([r.choices[0].message.content for r in responses])

    return results

# Usage
prompts = ["Summarize: " + doc for doc in documents]
summaries = asyncio.run(batch_process(prompts))
```

## Strategy 6: Streaming for Early Termination

```python
def stream_with_early_stop(prompt: str, stop_condition: callable) -> str:
    """Stream response and stop when condition met."""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    full_response = ""
    for chunk in response:
        if chunk.choices[0].delta.content:
            full_response += chunk.choices[0].delta.content

            # Check if we have enough
            if stop_condition(full_response):
                break

    return full_response

# Stop when we find a specific answer
result = stream_with_early_stop(
    "What is 2+2? Explain your reasoning.",
    lambda text: "4" in text
)
```

## Strategy 7: Token Budget Management

```python
import tiktoken

class TokenBudget:
    def __init__(self, daily_budget: int = 1_000_000):
        self.daily_budget = daily_budget
        self.used_today = 0
        self.encoder = tiktoken.encoding_for_model("gpt-4o")

    def estimate_tokens(self, messages: list) -> int:
        total = 0
        for msg in messages:
            if isinstance(msg["content"], str):
                total += len(self.encoder.encode(msg["content"]))
            else:
                # Handle multimodal content
                for item in msg["content"]:
                    if item["type"] == "text":
                        total += len(self.encoder.encode(item["text"]))
                    elif item["type"] == "image_url":
                        total += 500  # Rough estimate for images
        return total

    def can_process(self, messages: list, expected_output: int = 500) -> bool:
        estimated = self.estimate_tokens(messages) + expected_output
        return (self.used_today + estimated) <= self.daily_budget

    def record_usage(self, usage):
        self.used_today += usage.total_tokens

# Usage
budget = TokenBudget(daily_budget=500_000)

if budget.can_process(messages):
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages
    )
    budget.record_usage(response.usage)
else:
    print("Daily token budget exceeded")
```

## Cost Tracking Dashboard

```python
from datetime import datetime, timedelta

class CostTracker:
    PRICING = {
        "gpt-4o": {"input": 5.0, "output": 15.0},
        "gpt-4-turbo": {"input": 10.0, "output": 30.0},
        "gpt-3.5-turbo": {"input": 0.5, "output": 1.5}
    }

    def __init__(self):
        self.usage_log = []

    def log_request(self, model: str, input_tokens: int, output_tokens: int):
        pricing = self.PRICING[model]
        cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000

        self.usage_log.append({
            "timestamp": datetime.now(),
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": cost
        })

    def daily_report(self) -> dict:
        today = datetime.now().date()
        today_usage = [u for u in self.usage_log
                       if u["timestamp"].date() == today]

        return {
            "total_cost": sum(u["cost"] for u in today_usage),
            "total_requests": len(today_usage),
            "total_tokens": sum(u["input_tokens"] + u["output_tokens"] for u in today_usage),
            "by_model": self._group_by_model(today_usage)
        }
```

## Summary

| Strategy | Potential Savings |
|----------|------------------|
| Prompt optimization | 20-50% |
| Response length control | 30-60% |
| Caching | 50-80% for repeated queries |
| Model routing | 60-90% for simple tasks |
| Batching | 10-20% (efficiency) |
| Token budgeting | Prevents overruns |

Combine these strategies for maximum impact.

## Resources

- [OpenAI Pricing](https://openai.com/pricing)
- [Azure OpenAI Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/)
- [Tiktoken Library](https://github.com/openai/tiktoken)
