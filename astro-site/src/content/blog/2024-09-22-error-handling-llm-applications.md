---
title: "Error Handling in LLM Applications: A Comprehensive Guide"
description: "Robust error handling is what separates prototypes from production systems. Invest in comprehensive error handling early to avoid painful debugging later."
author: "Michael John Peña"
draft: false
date: 2024-09-22
tags: ["Error Handling", "LLM", "Python", "Best Practices", "Production"]
---

## Error Taxonomy

```python
from enum import Enum
from typing import Optional, Dict, Any
from dataclasses import dataclass

class ErrorCategory(Enum):
    API_ERROR = "api_error"           # OpenAI/Azure API errors
    RATE_LIMIT = "rate_limit"         # Rate limiting
    CONTENT_FILTER = "content_filter" # Content moderation
    CONTEXT_LENGTH = "context_length" # Token limits
    VALIDATION = "validation"         # Input/output validation
    TIMEOUT = "timeout"               # Request timeout
    TOOL_ERROR = "tool_error"         # Tool execution failure
    PARSING = "parsing"               # Response parsing failure
    NETWORK = "network"               # Network connectivity

class ErrorSeverity(Enum):
    LOW = "low"           # Log and continue
    MEDIUM = "medium"     # Retry with backoff
    HIGH = "high"         # Alert and retry
    CRITICAL = "critical" # Stop and escalate

@dataclass
class LLMError(Exception):
    """Base class for LLM-related errors"""
    category: ErrorCategory
    severity: ErrorSeverity
    message: str
    details: Optional[Dict[str, Any]] = None
    retryable: bool = True
    retry_after: Optional[float] = None

    def __str__(self):
        return f"[{self.category.value}] {self.message}"

# Specific error classes
class RateLimitError(LLMError):
    def __init__(self, retry_after: float = 60):
        super().__init__(
            category=ErrorCategory.RATE_LIMIT,
            severity=ErrorSeverity.MEDIUM,
            message="Rate limit exceeded",
            retryable=True,
            retry_after=retry_after
        )

class ContentFilterError(LLMError):
    def __init__(self, filter_type: str):
        super().__init__(
            category=ErrorCategory.CONTENT_FILTER,
            severity=ErrorSeverity.HIGH,
            message=f"Content filtered: {filter_type}",
            retryable=False,
            details={"filter_type": filter_type}
        )

class ContextLengthError(LLMError):
    def __init__(self, tokens_used: int, max_tokens: int):
        super().__init__(
            category=ErrorCategory.CONTEXT_LENGTH,
            severity=ErrorSeverity.MEDIUM,
            message=f"Context length exceeded: {tokens_used}/{max_tokens}",
            retryable=True,
            details={"tokens_used": tokens_used, "max_tokens": max_tokens}
        )
```

## Error Handler

```python
from openai import OpenAI, APIError, RateLimitError as OpenAIRateLimitError
from openai import APIConnectionError, APITimeoutError
import time
import logging

logger = logging.getLogger(__name__)

class LLMErrorHandler:
    """Centralized error handling for LLM operations"""

    def __init__(self, max_retries: int = 3, base_delay: float = 1.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.error_counts: Dict[ErrorCategory, int] = {}

    def handle(self, func, *args, **kwargs):
        """Execute function with comprehensive error handling"""

        last_error = None

        for attempt in range(self.max_retries + 1):
            try:
                return func(*args, **kwargs)

            except OpenAIRateLimitError as e:
                error = self._classify_openai_error(e)
                last_error = error

                if attempt < self.max_retries:
                    delay = error.retry_after or self._calculate_delay(attempt)
                    logger.warning(f"Rate limited. Retrying in {delay}s...")
                    time.sleep(delay)
                    continue

            except APITimeoutError as e:
                error = LLMError(
                    category=ErrorCategory.TIMEOUT,
                    severity=ErrorSeverity.MEDIUM,
                    message="Request timed out",
                    retryable=True
                )
                last_error = error

                if attempt < self.max_retries:
                    delay = self._calculate_delay(attempt)
                    logger.warning(f"Timeout. Retrying in {delay}s...")
                    time.sleep(delay)
                    continue

            except APIConnectionError as e:
                error = LLMError(
                    category=ErrorCategory.NETWORK,
                    severity=ErrorSeverity.MEDIUM,
                    message="Connection failed",
                    retryable=True
                )
                last_error = error

                if attempt < self.max_retries:
                    delay = self._calculate_delay(attempt)
                    logger.warning(f"Connection error. Retrying in {delay}s...")
                    time.sleep(delay)
                    continue

            except APIError as e:
                error = self._classify_openai_error(e)
                self._record_error(error)

                if error.retryable and attempt < self.max_retries:
                    delay = self._calculate_delay(attempt)
                    time.sleep(delay)
                    continue

                raise error

            except Exception as e:
                # Unexpected error
                logger.error(f"Unexpected error: {e}")
                raise

        # All retries exhausted
        if last_error:
            self._record_error(last_error)
            raise last_error

    def _classify_openai_error(self, error: APIError) -> LLMError:
        """Classify OpenAI API error"""

        error_code = getattr(error, 'code', None)
        status_code = getattr(error, 'status_code', None)

        if status_code == 429:
            retry_after = float(error.response.headers.get('retry-after', 60))
            return RateLimitError(retry_after=retry_after)

        if error_code == 'context_length_exceeded':
            return ContextLengthError(tokens_used=0, max_tokens=0)

        if error_code == 'content_filter':
            return ContentFilterError(filter_type="unknown")

        return LLMError(
            category=ErrorCategory.API_ERROR,
            severity=ErrorSeverity.HIGH,
            message=str(error),
            retryable=status_code in [500, 502, 503, 504]
        )

    def _calculate_delay(self, attempt: int) -> float:
        """Calculate exponential backoff delay"""
        delay = self.base_delay * (2 ** attempt)
        # Add jitter
        import random
        jitter = random.uniform(0, delay * 0.1)
        return delay + jitter

    def _record_error(self, error: LLMError):
        """Record error for monitoring"""
        self.error_counts[error.category] = self.error_counts.get(error.category, 0) + 1
        logger.error(f"LLM Error: {error}", extra={
            "category": error.category.value,
            "severity": error.severity.value,
            "details": error.details
        })
```

## Graceful Degradation

```python
from typing import Callable, TypeVar, Generic

T = TypeVar('T')

class GracefulDegradation(Generic[T]):
    """Handle failures with graceful degradation"""

    def __init__(self, primary: Callable[..., T]):
        self.primary = primary
        self.fallbacks: List[Callable[..., T]] = []
        self.default: Optional[T] = None

    def add_fallback(self, fallback: Callable[..., T]) -> 'GracefulDegradation':
        """Add a fallback function"""
        self.fallbacks.append(fallback)
        return self

    def set_default(self, default: T) -> 'GracefulDegradation':
        """Set default value if all else fails"""
        self.default = default
        return self

    def execute(self, *args, **kwargs) -> T:
        """Execute with fallbacks"""

        # Try primary
        try:
            return self.primary(*args, **kwargs)
        except Exception as e:
            logger.warning(f"Primary failed: {e}")

        # Try fallbacks
        for i, fallback in enumerate(self.fallbacks):
            try:
                logger.info(f"Trying fallback {i + 1}")
                return fallback(*args, **kwargs)
            except Exception as e:
                logger.warning(f"Fallback {i + 1} failed: {e}")

        # Return default
        if self.default is not None:
            logger.warning("All options failed, returning default")
            return self.default

        raise RuntimeError("All execution paths failed")

# Usage example
def call_gpt4(prompt: str) -> str:
    # Primary model
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content

def call_gpt4_mini(prompt: str) -> str:
    # Faster, cheaper fallback
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content

def cached_response(prompt: str) -> str:
    # Return cached response if available
    return "I'm having trouble processing your request. Please try again later."

# Build degradation chain
degraded_call = (
    GracefulDegradation(call_gpt4)
    .add_fallback(call_gpt4_mini)
    .add_fallback(cached_response)
    .set_default("Service temporarily unavailable")
)

result = degraded_call.execute("Hello, world!")
```

## Input Validation

```python
from pydantic import BaseModel, validator, ValidationError
import tiktoken

class ValidatedPrompt(BaseModel):
    """Validate prompts before sending to LLM"""

    content: str
    max_tokens: int = 4096
    model: str = "gpt-4o"

    @validator('content')
    def validate_content(cls, v):
        if not v or not v.strip():
            raise ValueError("Prompt cannot be empty")

        if len(v) > 100000:
            raise ValueError("Prompt too long")

        # Check for prompt injection patterns
        injection_patterns = [
            "ignore previous instructions",
            "disregard all prior",
            "forget everything",
        ]
        lower_content = v.lower()
        for pattern in injection_patterns:
            if pattern in lower_content:
                raise ValueError(f"Potentially malicious prompt detected")

        return v.strip()

    def get_token_count(self) -> int:
        """Count tokens in the prompt"""
        encoding = tiktoken.encoding_for_model(self.model)
        return len(encoding.encode(self.content))

    def validate_token_limit(self, context_window: int = 128000):
        """Ensure prompt fits in context window"""
        tokens = self.get_token_count()
        available = context_window - self.max_tokens

        if tokens > available:
            raise ContextLengthError(
                tokens_used=tokens,
                max_tokens=available
            )

def validate_and_call(content: str) -> str:
    """Validate input before calling LLM"""
    try:
        prompt = ValidatedPrompt(content=content)
        prompt.validate_token_limit()

        return call_llm(prompt.content)

    except ValidationError as e:
        raise LLMError(
            category=ErrorCategory.VALIDATION,
            severity=ErrorSeverity.LOW,
            message="Invalid input",
            details={"errors": e.errors()},
            retryable=False
        )
```

## Output Validation

```python
import json

class OutputValidator:
    """Validate LLM outputs"""

    def validate_json(self, output: str) -> dict:
        """Validate JSON output"""
        try:
            return json.loads(output)
        except json.JSONDecodeError as e:
            raise LLMError(
                category=ErrorCategory.PARSING,
                severity=ErrorSeverity.MEDIUM,
                message="Invalid JSON in response",
                details={"output": output[:500], "error": str(e)},
                retryable=True
            )

    def validate_schema(self, output: dict, schema: type) -> BaseModel:
        """Validate output against Pydantic schema"""
        try:
            return schema.model_validate(output)
        except ValidationError as e:
            raise LLMError(
                category=ErrorCategory.VALIDATION,
                severity=ErrorSeverity.MEDIUM,
                message="Output doesn't match schema",
                details={"errors": e.errors()},
                retryable=True
            )

    def validate_safety(self, output: str) -> str:
        """Basic safety validation of output"""
        # Check for potentially harmful content
        # This is in addition to OpenAI's content filtering

        dangerous_patterns = [
            "sudo rm",
            "DROP TABLE",
            "<script>",
        ]

        for pattern in dangerous_patterns:
            if pattern in output:
                raise LLMError(
                    category=ErrorCategory.CONTENT_FILTER,
                    severity=ErrorSeverity.CRITICAL,
                    message="Potentially dangerous content in output",
                    retryable=False
                )

        return output
```

Robust error handling is what separates prototypes from production systems. Invest in comprehensive error handling early to avoid painful debugging later.
