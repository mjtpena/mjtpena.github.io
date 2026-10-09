---
title: "Token Budgeting: Cost-Effective LLM Applications"
description: "Token costs for GPT-4 in mid-2023 are real enough to design around: roughly $0.03 per 1K input tokens and $0.06 per 1K output tokens for the 8K context…"
author: Michael John Peña
draft: false
date: 2023-06-24
tags:
  - Azure OpenAI
  - Token Management
  - Cost Optimization
  - LLM
  - Best Practices
---

Token costs for GPT-4 in mid-2023 are real enough to design around: roughly $0.03 per 1K input tokens and $0.06 per 1K output tokens for the 8K context version. For a busy enterprise chat application that handles thousands of conversations per day, unmanaged token usage compounds quickly into a meaningful budget line. Token budgeting means deliberately allocating the context window across its competing consumers: the system prompt (usually fixed cost, worth compressing aggressively), the conversation history (variable, grows with conversation length), any RAG-retrieved context (often the largest single block), function definitions if using tool calling, and the space reserved for the model's response. I use `tiktoken` for counting before every call — it's exact for gpt-3.5-turbo and gpt-4 since they share the same `cl100k_base` encoding.

## Understanding Token Costs

```python
# Azure OpenAI pricing (example - check current pricing)
pricing = {
    "gpt-4": {"input": 0.03, "output": 0.06},  # per 1K tokens
    "gpt-4-32k": {"input": 0.06, "output": 0.12},
    "gpt-4-turbo": {"input": 0.01, "output": 0.03},
    "gpt-35-turbo": {"input": 0.0015, "output": 0.002}
}

def estimate_cost(
    input_tokens: int,
    output_tokens: int,
    model: str = "gpt-4"
) -> float:
    """Estimate cost for a request"""
    rates = pricing.get(model, pricing["gpt-4"])
    return (input_tokens / 1000 * rates["input"] +
            output_tokens / 1000 * rates["output"])

# Example: 2000 input tokens, 500 output tokens with GPT-4
cost = estimate_cost(2000, 500, "gpt-4")
print(f"Estimated cost: ${cost:.4f}")  # ~$0.09
```

## Token Budget Manager

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
import threading

@dataclass
class UsageRecord:
    timestamp: datetime
    input_tokens: int
    output_tokens: int
    model: str
    cost: float

class TokenBudgetManager:
    """Manage token budgets across requests"""

    def __init__(self, hourly_limit: int = 100000, daily_limit: int = 1000000):
        self.hourly_limit = hourly_limit
        self.daily_limit = daily_limit
        self.usage_log: list[UsageRecord] = []
        self.lock = threading.Lock()

    def can_proceed(self, estimated_tokens: int) -> tuple[bool, str]:
        """Check if request is within budget"""
        with self.lock:
            hourly_usage = self._get_usage(hours=1)
            daily_usage = self._get_usage(hours=24)

            if hourly_usage + estimated_tokens > self.hourly_limit:
                return False, f"Hourly limit reached ({hourly_usage}/{self.hourly_limit})"

            if daily_usage + estimated_tokens > self.daily_limit:
                return False, f"Daily limit reached ({daily_usage}/{self.daily_limit})"

            return True, "OK"

    def record_usage(self, input_tokens: int, output_tokens: int, model: str):
        """Record token usage"""
        with self.lock:
            cost = estimate_cost(input_tokens, output_tokens, model)
            record = UsageRecord(
                timestamp=datetime.utcnow(),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model=model,
                cost=cost
            )
            self.usage_log.append(record)

            # Cleanup old records
            cutoff = datetime.utcnow() - timedelta(days=7)
            self.usage_log = [r for r in self.usage_log if r.timestamp > cutoff]

    def _get_usage(self, hours: int) -> int:
        """Get total token usage for time period"""
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        return sum(
            r.input_tokens + r.output_tokens
            for r in self.usage_log
            if r.timestamp > cutoff
        )

    def get_stats(self) -> dict:
        """Get usage statistics"""
        now = datetime.utcnow()

        hourly = [r for r in self.usage_log if r.timestamp > now - timedelta(hours=1)]
        daily = [r for r in self.usage_log if r.timestamp > now - timedelta(hours=24)]

        return {
            "hourly_tokens": sum(r.input_tokens + r.output_tokens for r in hourly),
            "hourly_cost": sum(r.cost for r in hourly),
            "hourly_remaining": self.hourly_limit - sum(r.input_tokens + r.output_tokens for r in hourly),
            "daily_tokens": sum(r.input_tokens + r.output_tokens for r in daily),
            "daily_cost": sum(r.cost for r in daily),
            "daily_remaining": self.daily_limit - sum(r.input_tokens + r.output_tokens for r in daily)
        }
```

## Model Selection Based on Budget

```python
class ModelSelector:
    """Select appropriate model based on task and budget"""

    def __init__(self, budget_manager: TokenBudgetManager):
        self.budget = budget_manager
        self.model_capabilities = {
            "gpt-4": {"reasoning": 10, "creativity": 9, "speed": 5, "cost": 10},
            "gpt-4-turbo": {"reasoning": 9, "creativity": 9, "speed": 7, "cost": 7},
            "gpt-35-turbo": {"reasoning": 7, "creativity": 7, "speed": 9, "cost": 2}
        }

    def select_model(
        self,
        task_type: str,
        estimated_tokens: int,
        quality_required: str = "medium"
    ) -> str:
        """Select best model for task within budget"""

        # Check budget
        can_proceed, reason = self.budget.can_proceed(estimated_tokens)
        if not can_proceed:
            # Force cheapest model if over budget
            return "gpt-35-turbo"

        # Task-based selection
        task_requirements = {
            "simple_qa": {"reasoning": 5, "model": "gpt-35-turbo"},
            "summarization": {"reasoning": 6, "model": "gpt-35-turbo"},
            "analysis": {"reasoning": 8, "model": "gpt-4-turbo"},
            "complex_reasoning": {"reasoning": 9, "model": "gpt-4"},
            "code_generation": {"reasoning": 8, "model": "gpt-4-turbo"},
            "creative_writing": {"creativity": 8, "model": "gpt-4"}
        }

        # Quality adjustment
        quality_multiplier = {"low": 0.7, "medium": 1.0, "high": 1.3}[quality_required]

        req = task_requirements.get(task_type, {"reasoning": 7, "model": "gpt-4-turbo"})

        # If high quality required or complex task, use better model
        if quality_required == "high" or req["reasoning"] * quality_multiplier > 8:
            return "gpt-4"
        elif req["reasoning"] * quality_multiplier > 6:
            return "gpt-4-turbo"
        else:
            return "gpt-35-turbo"
```

## Request Optimization

```python
class RequestOptimizer:
    """Optimize requests to minimize token usage"""

    def __init__(self, client):
        self.client = client

    def optimize_prompt(self, prompt: str, max_tokens: int = None) -> str:
        """Compress prompt while preserving meaning"""

        # Remove unnecessary whitespace
        import re
        prompt = re.sub(r'\s+', ' ', prompt).strip()

        # Remove common filler words if over budget
        if max_tokens and count_tokens(prompt) > max_tokens:
            fillers = ["please", "kindly", "basically", "actually", "really", "very"]
            for filler in fillers:
                prompt = re.sub(rf'\b{filler}\b\s*', '', prompt, flags=re.IGNORECASE)

        return prompt

    def batch_requests(self, prompts: list, batch_size: int = 5) -> list:
        """Batch similar requests to reduce overhead"""

        # Group similar prompts
        batched_prompt = "Process each of the following requests:\n\n"
        for i, prompt in enumerate(prompts[:batch_size], 1):
            batched_prompt += f"Request {i}:\n{prompt}\n\n"

        batched_prompt += "Provide numbered responses for each request."

        return batched_prompt

    def use_caching(self, prompt: str, cache: dict) -> tuple[str, bool]:
        """Check cache before making API call"""
        import hashlib

        # Create cache key
        key = hashlib.md5(prompt.encode()).hexdigest()

        if key in cache:
            return cache[key], True  # Cache hit

        return None, False  # Cache miss

    def estimate_and_optimize(
        self,
        prompt: str,
        context: list,
        budget_tokens: int
    ) -> dict:
        """Optimize request to fit budget"""

        prompt_tokens = count_tokens(prompt)
        context_tokens = count_messages_tokens(context)
        total = prompt_tokens + context_tokens

        optimizations = []

        if total > budget_tokens:
            # Strategy 1: Compress prompt
            optimized_prompt = self.optimize_prompt(prompt, budget_tokens // 2)
            optimizations.append("prompt_compressed")

            # Strategy 2: Reduce context
            if count_tokens(optimized_prompt) + context_tokens > budget_tokens:
                # Keep only essential context
                context = context[-5:]  # Last 5 messages
                optimizations.append("context_reduced")

        return {
            "prompt": optimized_prompt if optimizations else prompt,
            "context": context,
            "estimated_tokens": count_tokens(optimized_prompt or prompt) + count_messages_tokens(context),
            "optimizations": optimizations
        }
```

## Integration Example

```python
class CostAwareChatService:
    """Chat service with cost controls"""

    def __init__(self, client, budget_manager, model_selector, optimizer):
        self.client = client
        self.budget = budget_manager
        self.selector = model_selector
        self.optimizer = optimizer
        self.cache = {}

    def chat(
        self,
        user_message: str,
        conversation: list,
        task_type: str = "simple_qa",
        quality: str = "medium"
    ) -> dict:
        """Process chat with cost optimization"""

        # Check cache
        cached, hit = self.optimizer.use_caching(user_message, self.cache)
        if hit:
            return {"response": cached, "cached": True, "cost": 0}

        # Estimate tokens
        estimated = count_tokens(user_message) + count_messages_tokens(conversation) + 500

        # Check budget
        can_proceed, reason = self.budget.can_proceed(estimated)
        if not can_proceed:
            return {"error": reason, "cost": 0}

        # Select model
        model = self.selector.select_model(task_type, estimated, quality)

        # Optimize request
        optimized = self.optimizer.estimate_and_optimize(
            user_message,
            conversation,
            budget_tokens=8000 if model == "gpt-4" else 4000
        )

        # Make request
        messages = optimized["context"] + [{"role": "user", "content": optimized["prompt"]}]

        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=500
        )

        # Record usage
        usage = response.usage
        self.budget.record_usage(usage.prompt_tokens, usage.completion_tokens, model)

        result = response.choices[0].message.content

        # Cache result
        cache_key = self.optimizer.use_caching(user_message, {})[0]
        self.cache[cache_key] = result

        return {
            "response": result,
            "model": model,
            "tokens": {"input": usage.prompt_tokens, "output": usage.completion_tokens},
            "cost": estimate_cost(usage.prompt_tokens, usage.completion_tokens, model),
            "optimizations": optimized["optimizations"],
            "cached": False
        }
```

Effective token budgeting keeps costs under control. Tomorrow, I will cover caching strategies for LLM applications.

## Resources

- [Azure OpenAI Pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)
- [Token Counting](https://github.com/openai/tiktoken)
