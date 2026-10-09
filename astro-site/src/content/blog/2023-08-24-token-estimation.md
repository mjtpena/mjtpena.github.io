---
title: "Token Estimation: Predicting API Costs"
author: Michael John Peña
draft: false
date: 2023-08-24
tags:
  - Tokens
  - API
  - Cost Estimation
  - OpenAI
---

## Understanding Tokens

```python
import tiktoken

# Tokens are pieces of text, roughly 4 chars = 1 token in English
# Different models use different tokenizers

def count_tokens(text, model="gpt-4"):
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

# Examples
examples = {
    "Hello": 1,
    "Hello, world!": 4,
    "The quick brown fox": 4,
    "Supercalifragilisticexpialidocious": 9
}

for text, expected in examples.items():
    actual = count_tokens(text)
    print(f"'{text}': {actual} tokens")
```

## Token Estimation Functions

```python
import tiktoken

class TokenEstimator:
    def __init__(self, model="gpt-4"):
        self.encoding = tiktoken.encoding_for_model(model)

    def count_text(self, text):
        return len(self.encoding.encode(text))

    def count_messages(self, messages):
        """Estimate tokens for chat messages."""
        # Base tokens per message
        tokens_per_message = 4  # <|im_start|>, role, \n, content, <|im_end|>

        total = 0
        for msg in messages:
            total += tokens_per_message
            total += self.count_text(msg.get("role", ""))
            total += self.count_text(msg.get("content", ""))
            if "name" in msg:
                total += self.count_text(msg["name"]) + 1

        total += 3  # Reply priming
        return total

    def estimate_cost(self, input_tokens, output_tokens, model="gpt-4"):
        pricing = {
            "gpt-4": {"input": 0.03, "output": 0.06},
            "gpt-4-turbo": {"input": 0.01, "output": 0.03},
            "gpt-3.5-turbo": {"input": 0.0015, "output": 0.002}
        }

        rates = pricing.get(model, pricing["gpt-4"])
        input_cost = (input_tokens / 1000) * rates["input"]
        output_cost = (output_tokens / 1000) * rates["output"]

        return {"input_cost": input_cost, "output_cost": output_cost, "total": input_cost + output_cost}
```

## Estimating Output Tokens

```python
def estimate_output_tokens(task_type, input_tokens):
    """Estimate output tokens based on task type."""
    estimates = {
        "classification": (5, 20),      # Short answer
        "qa": (50, 200),                # Medium answer
        "summarization": (input_tokens * 0.2, input_tokens * 0.4),
        "generation": (100, 500),       # Variable
        "code": (50, 300),              # Depends on complexity
        "chat": (50, 200)               # Conversational
    }

    min_tokens, max_tokens = estimates.get(task_type, (50, 200))
    return {"min": int(min_tokens), "max": int(max_tokens), "expected": int((min_tokens + max_tokens) / 2)}

# Example
task = "summarization"
input_text = "Long article..." * 100
input_tokens = TokenEstimator().count_text(input_text)
output_estimate = estimate_output_tokens(task, input_tokens)
print(f"Input: {input_tokens}, Expected output: {output_estimate['expected']}")
```

## Cost Calculator

```python
class CostCalculator:
    def __init__(self, model="gpt-4"):
        self.model = model
        self.estimator = TokenEstimator(model)
        self.history = []

    def estimate_request(self, messages, max_tokens=None):
        input_tokens = self.estimator.count_messages(messages)
        output_tokens = max_tokens or 500

        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "estimated_cost": self.estimator.estimate_cost(input_tokens, output_tokens, self.model)
        }

    def record_actual(self, input_tokens, output_tokens, cost):
        self.history.append({
            "input": input_tokens,
            "output": output_tokens,
            "cost": cost
        })

    def get_stats(self):
        if not self.history:
            return None

        return {
            "total_requests": len(self.history),
            "total_input_tokens": sum(h["input"] for h in self.history),
            "total_output_tokens": sum(h["output"] for h in self.history),
            "total_cost": sum(h["cost"] for h in self.history),
            "avg_input": sum(h["input"] for h in self.history) / len(self.history),
            "avg_output": sum(h["output"] for h in self.history) / len(self.history)
        }
```

## Batch Cost Estimation

```python
def estimate_batch_cost(requests, model="gpt-4"):
    """Estimate cost for a batch of requests."""
    estimator = TokenEstimator(model)
    total_input = 0
    total_output = 0

    for req in requests:
        input_tokens = estimator.count_messages(req["messages"])
        output_tokens = req.get("max_tokens", 500)

        total_input += input_tokens
        total_output += output_tokens

    cost = estimator.estimate_cost(total_input, total_output, model)

    return {
        "request_count": len(requests),
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "estimated_cost": cost["total"]
    }

# Example
requests = [
    {"messages": [{"role": "user", "content": "Hello"}], "max_tokens": 100},
    {"messages": [{"role": "user", "content": "Explain quantum computing"}], "max_tokens": 500},
]

estimate = estimate_batch_cost(requests)
print(f"Batch cost estimate: ${estimate['estimated_cost']:.4f}")
```

## Token Budget Management

```python
class TokenBudget:
    def __init__(self, daily_limit, alert_threshold=0.8):
        self.daily_limit = daily_limit
        self.alert_threshold = alert_threshold
        self.used_today = 0
        self.reset_date = datetime.now().date()

    def check_budget(self, estimated_tokens):
        self._maybe_reset()

        if self.used_today + estimated_tokens > self.daily_limit:
            return False, "Budget exceeded"

        if (self.used_today + estimated_tokens) / self.daily_limit > self.alert_threshold:
            return True, "Approaching budget limit"

        return True, "OK"

    def record_usage(self, actual_tokens):
        self.used_today += actual_tokens

    def remaining(self):
        return self.daily_limit - self.used_today

    def _maybe_reset(self):
        if datetime.now().date() > self.reset_date:
            self.used_today = 0
            self.reset_date = datetime.now().date()
```

Tomorrow we'll explore prompt compression techniques.

## Resources

- [tiktoken Library](https://github.com/openai/tiktoken)
- [OpenAI Tokenizer](https://platform.openai.com/tokenizer)
- [Azure OpenAI Pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)
