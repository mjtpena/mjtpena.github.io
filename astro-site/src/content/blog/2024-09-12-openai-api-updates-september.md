---
title: "OpenAI API Updates: September 2024 Changes You Need to Know"
author: "Michael John Peña"
draft: false
date: 2024-09-12
tags: ["OpenAI", "API", "Updates", "AI", "Development"]
---

## New API Version

```python
from openai import OpenAI

# The September 2024 API version includes new features
client = OpenAI()  # Uses latest version by default

# Check client version
print(f"OpenAI SDK version: {client._version}")
```

## o1 Model Parameters

o1 introduces new parameters while removing some familiar ones:

```python
# Parameters that WORK with o1
response = client.chat.completions.create(
    model="o1-preview",
    messages=[{"role": "user", "content": "Hello"}],
    max_completion_tokens=4096,  # NEW: Replaces max_tokens
    # temperature is fixed at 1 for o1
    # top_p is fixed at 1 for o1
)

# Parameters that DON'T work with o1 (yet)
# - system messages
# - streaming
# - tools/function_calling
# - logprobs
# - stop sequences
# - n (multiple completions)
```

## Updated Usage Object

```python
def analyze_usage(response) -> dict:
    """
    New usage object structure with reasoning details
    """
    usage = response.usage

    return {
        "prompt_tokens": usage.prompt_tokens,
        "completion_tokens": usage.completion_tokens,
        "total_tokens": usage.total_tokens,
        # New in September 2024
        "completion_tokens_details": {
            "reasoning_tokens": usage.completion_tokens_details.reasoning_tokens,
            # Additional details may be added in future
        }
    }

response = client.chat.completions.create(
    model="o1-preview",
    messages=[{"role": "user", "content": "Explain quantum entanglement"}],
    max_completion_tokens=4096
)

usage_info = analyze_usage(response)
print(f"Reasoning tokens: {usage_info['completion_tokens_details']['reasoning_tokens']}")
```

## Rate Limits Update

```python
from typing import Dict
import time

class RateLimitManager:
    """
    Handle updated rate limits for different models
    """

    # September 2024 rate limits (tier dependent)
    RATE_LIMITS: Dict[str, Dict] = {
        "o1-preview": {
            "rpm": 20,          # Requests per minute (lower than GPT-4)
            "tpm": 30_000,      # Tokens per minute
            "rpd": 100          # Requests per day
        },
        "o1-mini": {
            "rpm": 20,
            "tpm": 150_000,
            "rpd": 1_000
        },
        "gpt-4o": {
            "rpm": 500,
            "tpm": 30_000,
            "rpd": 10_000
        }
    }

    def __init__(self, model: str):
        self.model = model
        self.limits = self.RATE_LIMITS.get(model, {})
        self.request_times: list = []
        self.tokens_used: int = 0

    def can_make_request(self, estimated_tokens: int = 1000) -> bool:
        """Check if we can make a request within limits"""
        now = time.time()
        minute_ago = now - 60

        # Clean old requests
        self.request_times = [t for t in self.request_times if t > minute_ago]

        if len(self.request_times) >= self.limits.get("rpm", float('inf')):
            return False

        return True

    def record_request(self, tokens_used: int):
        """Record a completed request"""
        self.request_times.append(time.time())
        self.tokens_used += tokens_used

# Usage
rate_manager = RateLimitManager("o1-preview")

if rate_manager.can_make_request():
    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": "..."}],
        max_completion_tokens=4096
    )
    rate_manager.record_request(response.usage.total_tokens)
```

## Model Versioning

```python
# Specific model versions available
MODELS = {
    # o1 family
    "o1-preview": "o1-preview-2024-09-12",
    "o1-mini": "o1-mini-2024-09-12",

    # GPT-4 family (still available)
    "gpt-4o": "gpt-4o-2024-08-06",
    "gpt-4o-mini": "gpt-4o-mini-2024-07-18",
    "gpt-4-turbo": "gpt-4-turbo-2024-04-09",
}

def get_model_for_task(task_complexity: str, needs_streaming: bool = False) -> str:
    """Select appropriate model based on requirements"""

    if needs_streaming:
        # o1 doesn't support streaming yet
        return MODELS["gpt-4o"]

    if task_complexity == "high":
        return MODELS["o1-preview"]
    elif task_complexity == "medium":
        return MODELS["o1-mini"]
    else:
        return MODELS["gpt-4o-mini"]
```

## Error Handling Updates

```python
from openai import APIError, RateLimitError, APIConnectionError

def robust_api_call(prompt: str, model: str = "o1-preview") -> str:
    """Handle various error scenarios with the updated API"""

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=4096
        )
        return response.choices[0].message.content

    except RateLimitError as e:
        # More detailed rate limit info in September 2024
        print(f"Rate limited. Retry after: {e.response.headers.get('retry-after', 'unknown')}")
        raise

    except APIError as e:
        # New error codes for o1-specific issues
        if e.code == "context_length_exceeded":
            print("Input too long for o1-preview (128k context)")
        elif e.code == "max_tokens_exceeded":
            print("max_completion_tokens too high")
        raise

    except APIConnectionError:
        print("Connection failed - check network")
        raise
```

## Backward Compatibility

```python
def create_compatible_request(model: str, messages: list, **kwargs) -> dict:
    """
    Create a request that works with both o1 and GPT-4 models
    """
    is_o1 = model.startswith("o1")

    request_params = {
        "model": model,
        "messages": messages
    }

    # Handle max_tokens vs max_completion_tokens
    if "max_tokens" in kwargs:
        if is_o1:
            request_params["max_completion_tokens"] = kwargs["max_tokens"]
        else:
            request_params["max_tokens"] = kwargs["max_tokens"]

    # Remove unsupported params for o1
    if is_o1:
        # Filter out system messages
        request_params["messages"] = [
            m for m in messages if m.get("role") != "system"
        ]

        # Don't include these for o1
        unsupported = ["temperature", "top_p", "stream", "tools", "tool_choice"]
        for param in unsupported:
            kwargs.pop(param, None)
    else:
        # Add supported params for GPT-4
        for param in ["temperature", "top_p", "stream", "tools"]:
            if param in kwargs:
                request_params[param] = kwargs[param]

    return request_params

# Usage
params = create_compatible_request(
    model="o1-preview",
    messages=[
        {"role": "system", "content": "Be helpful"},  # Will be filtered
        {"role": "user", "content": "Hello"}
    ],
    max_tokens=4096,
    temperature=0.7  # Will be ignored for o1
)

response = client.chat.completions.create(**params)
```

## Summary of Key Changes

| Feature | GPT-4o | o1-preview |
|---------|--------|------------|
| System messages | Yes | No |
| Streaming | Yes | No |
| Function calling | Yes | No |
| max_tokens | Yes | Use max_completion_tokens |
| Temperature | Adjustable | Fixed at 1 |
| Reasoning tokens | No | Yes |
| Context window | 128k | 128k |

Stay updated with OpenAI's changelog for additional features as they're released throughout September and beyond.
