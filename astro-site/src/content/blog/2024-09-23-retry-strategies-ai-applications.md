---
title: "Retry Strategies for AI Applications: Beyond Simple Backoff"
description: "Smart retry strategies balance reliability with resource efficiency. The key is adapting behavior based on error type, system state, and business requirements."
author: "Michael John Peña"
draft: false
date: 2024-09-23
tags: ["Retry", "Resilience", "AI", "Best Practices", "Production"]
---

## Intelligent Retry Framework

```python
from dataclasses import dataclass, field
from typing import Callable, Optional, List, Any
from enum import Enum
import time
import random
import logging

logger = logging.getLogger(__name__)

class RetryDecision(Enum):
    RETRY = "retry"
    FAIL = "fail"
    MODIFY_AND_RETRY = "modify_and_retry"

@dataclass
class RetryConfig:
    """Configuration for retry behavior"""
    max_attempts: int = 3
    base_delay: float = 1.0
    max_delay: float = 60.0
    exponential_base: float = 2.0
    jitter: bool = True
    retry_on: List[type] = field(default_factory=list)

@dataclass
class RetryContext:
    """Context for making retry decisions"""
    attempt: int
    error: Exception
    elapsed_time: float
    previous_errors: List[Exception]

class SmartRetry:
    """Intelligent retry with adaptive behavior"""

    def __init__(self, config: RetryConfig = None):
        self.config = config or RetryConfig()
        self.decision_handlers: List[Callable[[RetryContext], RetryDecision]] = []

    def add_decision_handler(self, handler: Callable[[RetryContext], RetryDecision]):
        """Add custom logic for retry decisions"""
        self.decision_handlers.append(handler)
        return self

    def execute(self, func: Callable, *args, **kwargs) -> Any:
        """Execute with smart retry logic"""

        errors: List[Exception] = []
        start_time = time.time()

        for attempt in range(1, self.config.max_attempts + 1):
            try:
                return func(*args, **kwargs)

            except Exception as e:
                errors.append(e)
                elapsed = time.time() - start_time

                context = RetryContext(
                    attempt=attempt,
                    error=e,
                    elapsed_time=elapsed,
                    previous_errors=errors[:-1]
                )

                decision = self._make_decision(context)

                if decision == RetryDecision.FAIL:
                    logger.error(f"Failing after {attempt} attempts")
                    raise

                if decision == RetryDecision.MODIFY_AND_RETRY:
                    # Modification happens via kwargs update
                    pass

                if attempt < self.config.max_attempts:
                    delay = self._calculate_delay(attempt, context)
                    logger.info(f"Attempt {attempt} failed. Retrying in {delay:.2f}s")
                    time.sleep(delay)

        # Should not reach here, but just in case
        raise errors[-1] if errors else RuntimeError("Retry failed")

    def _make_decision(self, context: RetryContext) -> RetryDecision:
        """Determine whether to retry"""

        # Check custom handlers first
        for handler in self.decision_handlers:
            decision = handler(context)
            if decision != RetryDecision.RETRY:
                return decision

        # Default logic
        error = context.error

        # Don't retry certain errors
        non_retryable = [
            ValueError,
            TypeError,
            KeyError,
        ]

        if any(isinstance(error, t) for t in non_retryable):
            return RetryDecision.FAIL

        # Check if error type is in retry list
        if self.config.retry_on:
            if not any(isinstance(error, t) for t in self.config.retry_on):
                return RetryDecision.FAIL

        return RetryDecision.RETRY

    def _calculate_delay(self, attempt: int, context: RetryContext) -> float:
        """Calculate delay with adaptive behavior"""

        # Base exponential backoff
        delay = self.config.base_delay * (self.config.exponential_base ** (attempt - 1))

        # Cap at max delay
        delay = min(delay, self.config.max_delay)

        # Add jitter
        if self.config.jitter:
            delay = delay * (0.5 + random.random())

        # Adaptive: if same error repeating, increase delay
        if len(context.previous_errors) > 0:
            same_error_count = sum(
                1 for e in context.previous_errors
                if type(e) == type(context.error)
            )
            if same_error_count > 1:
                delay *= 1.5  # Longer delay for repeated errors

        return delay
```

## LLM-Specific Retry Strategies

```python
from openai import APIError, RateLimitError, APIConnectionError

class LLMRetryStrategy:
    """Retry strategies specific to LLM APIs"""

    @staticmethod
    def rate_limit_handler(context: RetryContext) -> RetryDecision:
        """Handle rate limit errors specially"""
        if isinstance(context.error, RateLimitError):
            # Check if we have retry-after header
            retry_after = getattr(context.error, 'retry_after', None)
            if retry_after and retry_after > 120:
                # Too long to wait
                return RetryDecision.FAIL
            return RetryDecision.RETRY
        return RetryDecision.RETRY

    @staticmethod
    def context_length_handler(context: RetryContext) -> RetryDecision:
        """Handle context length errors"""
        error_code = getattr(context.error, 'code', None)
        if error_code == 'context_length_exceeded':
            # Can't retry with same input
            return RetryDecision.MODIFY_AND_RETRY
        return RetryDecision.RETRY

    @staticmethod
    def content_filter_handler(context: RetryContext) -> RetryDecision:
        """Handle content filter errors"""
        error_code = getattr(context.error, 'code', None)
        if error_code == 'content_filter':
            # Retrying won't help
            return RetryDecision.FAIL
        return RetryDecision.RETRY

# Build LLM-optimized retry
def create_llm_retry() -> SmartRetry:
    config = RetryConfig(
        max_attempts=5,
        base_delay=1.0,
        max_delay=60.0,
        retry_on=[APIError, APIConnectionError, TimeoutError]
    )

    retry = SmartRetry(config)
    retry.add_decision_handler(LLMRetryStrategy.rate_limit_handler)
    retry.add_decision_handler(LLMRetryStrategy.context_length_handler)
    retry.add_decision_handler(LLMRetryStrategy.content_filter_handler)

    return retry

# Usage
llm_retry = create_llm_retry()

def call_with_retry(prompt: str) -> str:
    def _call():
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    return llm_retry.execute(_call)
```

## Request Modification on Retry

```python
class AdaptiveRetry:
    """Retry with automatic request modification"""

    def __init__(self):
        self.modifiers: List[Callable[[dict, Exception], dict]] = []

    def add_modifier(self, modifier: Callable[[dict, Exception], dict]):
        """Add a request modifier for retries"""
        self.modifiers.append(modifier)
        return self

    def execute(self, func: Callable, request: dict, max_attempts: int = 3) -> Any:
        """Execute with adaptive modifications"""

        current_request = request.copy()

        for attempt in range(max_attempts):
            try:
                return func(**current_request)

            except Exception as e:
                if attempt == max_attempts - 1:
                    raise

                # Apply modifiers
                for modifier in self.modifiers:
                    current_request = modifier(current_request, e)

                logger.info(f"Modified request for retry {attempt + 2}")
                time.sleep(2 ** attempt)

def truncate_on_context_error(request: dict, error: Exception) -> dict:
    """Truncate content if context length exceeded"""
    if getattr(error, 'code', None) == 'context_length_exceeded':
        messages = request.get('messages', [])
        if messages:
            # Truncate user message
            for msg in messages:
                if msg['role'] == 'user':
                    content = msg['content']
                    msg['content'] = content[:len(content)//2] + "\n[Content truncated]"
    return request

def reduce_max_tokens(request: dict, error: Exception) -> dict:
    """Reduce max_tokens on certain errors"""
    if 'max_tokens' in request:
        request['max_tokens'] = request['max_tokens'] // 2
    return request

def switch_model_on_failure(request: dict, error: Exception) -> dict:
    """Switch to a different model on repeated failures"""
    fallback_models = {
        'gpt-4o': 'gpt-4o-mini',
        'gpt-4-turbo': 'gpt-4o',
    }
    current_model = request.get('model')
    if current_model in fallback_models:
        request['model'] = fallback_models[current_model]
        logger.info(f"Switching model from {current_model} to {request['model']}")
    return request

# Build adaptive retry
adaptive = AdaptiveRetry()
adaptive.add_modifier(truncate_on_context_error)
adaptive.add_modifier(reduce_max_tokens)
adaptive.add_modifier(switch_model_on_failure)

# Usage
result = adaptive.execute(
    client.chat.completions.create,
    {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": long_prompt}],
        "max_tokens": 4096
    }
)
```

## Retry Budget

```python
from datetime import datetime, timedelta
from collections import defaultdict

class RetryBudget:
    """Limit retries across the application"""

    def __init__(self, max_retries_per_minute: int = 100):
        self.max_per_minute = max_retries_per_minute
        self.retry_counts: defaultdict = defaultdict(list)

    def can_retry(self, key: str = "default") -> bool:
        """Check if retry budget allows another retry"""
        now = datetime.now()
        cutoff = now - timedelta(minutes=1)

        # Clean old entries
        self.retry_counts[key] = [
            t for t in self.retry_counts[key] if t > cutoff
        ]

        return len(self.retry_counts[key]) < self.max_per_minute

    def record_retry(self, key: str = "default"):
        """Record a retry attempt"""
        self.retry_counts[key].append(datetime.now())

    def get_usage(self, key: str = "default") -> dict:
        """Get current usage stats"""
        now = datetime.now()
        cutoff = now - timedelta(minutes=1)

        recent = [t for t in self.retry_counts[key] if t > cutoff]

        return {
            "used": len(recent),
            "limit": self.max_per_minute,
            "percentage": (len(recent) / self.max_per_minute) * 100
        }

# Global retry budget
retry_budget = RetryBudget(max_retries_per_minute=50)

def retry_with_budget(func: Callable, *args, **kwargs) -> Any:
    """Execute with retry budget enforcement"""

    if not retry_budget.can_retry():
        raise RuntimeError("Retry budget exhausted")

    try:
        return func(*args, **kwargs)
    except Exception as e:
        retry_budget.record_retry()
        raise
```

Smart retry strategies balance reliability with resource efficiency. The key is adapting behavior based on error type, system state, and business requirements.
