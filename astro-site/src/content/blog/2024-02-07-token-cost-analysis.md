---
title: "Token Cost Analysis: Understanding and Managing LLM Expenses"
author: Michael John Peña
draft: false
date: 2024-02-07
tags:
  - Token Analysis
  - Cost Management
  - LLM
  - Azure OpenAI
  - Budgeting
---

## Token Basics

```python
import tiktoken

def count_tokens(text: str, model: str = "gpt-4") -> int:
    """Count tokens for a given text."""
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

# Examples
print(count_tokens("Hello, world!"))  # ~3 tokens
print(count_tokens("A" * 1000))        # ~250 tokens (4 chars per token average)
```

## Cost Calculation

```python
class TokenCostCalculator:
    PRICING = {
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-4-turbo": {"input": 0.01, "output": 0.03},
        "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
        "text-embedding-ada-002": {"input": 0.0001, "output": 0}
    }

    def calculate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        pricing = self.PRICING.get(model)
        return (
            input_tokens / 1000 * pricing["input"] +
            output_tokens / 1000 * pricing["output"]
        )

    def estimate_monthly_cost(
        self,
        model: str,
        daily_requests: int,
        avg_input_tokens: int,
        avg_output_tokens: int
    ) -> dict:
        daily = self.calculate_cost(model, avg_input_tokens * daily_requests, avg_output_tokens * daily_requests)
        return {
            "daily": daily,
            "monthly": daily * 30,
            "yearly": daily * 365
        }

# Example
calc = TokenCostCalculator()
costs = calc.estimate_monthly_cost("gpt-4-turbo", 10000, 500, 200)
print(f"Monthly cost: ${costs['monthly']:.2f}")
```

## Usage Analysis

```python
def analyze_usage_patterns(usage_logs: list[dict]) -> dict:
    """Analyze token usage patterns."""

    total_input = sum(log["input_tokens"] for log in usage_logs)
    total_output = sum(log["output_tokens"] for log in usage_logs)

    input_avg = total_input / len(usage_logs)
    output_avg = total_output / len(usage_logs)

    # Find outliers
    input_p95 = sorted([log["input_tokens"] for log in usage_logs])[int(len(usage_logs) * 0.95)]
    output_p95 = sorted([log["output_tokens"] for log in usage_logs])[int(len(usage_logs) * 0.95)]

    return {
        "total_requests": len(usage_logs),
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "avg_input_tokens": input_avg,
        "avg_output_tokens": output_avg,
        "p95_input_tokens": input_p95,
        "p95_output_tokens": output_p95,
        "input_output_ratio": total_input / total_output
    }
```

## Token Optimization Tips

```python
optimization_strategies = {
    "prompt_compression": {
        "technique": "Remove filler words and redundant instructions",
        "savings": "20-40%"
    },
    "context_truncation": {
        "technique": "Limit context to most relevant content",
        "savings": "30-60%"
    },
    "response_limits": {
        "technique": "Set max_tokens appropriately",
        "savings": "10-30%"
    },
    "caching": {
        "technique": "Cache common responses",
        "savings": "20-50%"
    }
}
```

## Monitoring Dashboard

```python
class TokenDashboard:
    def __init__(self):
        self.usage_history = []

    def record(self, model: str, input_tokens: int, output_tokens: int, cost: float):
        self.usage_history.append({
            "timestamp": datetime.utcnow(),
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": cost
        })

    def get_daily_summary(self) -> dict:
        today = [u for u in self.usage_history if u["timestamp"].date() == datetime.utcnow().date()]
        return {
            "total_requests": len(today),
            "total_cost": sum(u["cost"] for u in today),
            "total_tokens": sum(u["input_tokens"] + u["output_tokens"] for u in today)
        }
```

## Conclusion

Token cost analysis enables informed decisions about LLM usage. Track, analyze, and optimize to keep costs predictable and manageable.
