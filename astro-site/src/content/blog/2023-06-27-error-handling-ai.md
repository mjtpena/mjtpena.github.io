---
title: "Error Handling for AI Applications: Building Resilient Systems"
description: "Robust error handling ensures AI applications remain useful even during failures. Tomorrow, I will cover retry strategies in more depth."
author: Michael John Peña
draft: false
date: 2023-06-27
tags:
  - Azure OpenAI
  - Error Handling
  - Resilience
  - Production
  - Best Practices
---

## Common Error Types

```python
from enum import Enum

class AIErrorType(Enum):
    RATE_LIMIT = "rate_limit"
    TOKEN_LIMIT = "token_limit"
    CONTENT_FILTER = "content_filter"
    INVALID_REQUEST = "invalid_request"
    MODEL_UNAVAILABLE = "model_unavailable"
    TIMEOUT = "timeout"
    NETWORK = "network"
    AUTHENTICATION = "authentication"
    QUOTA_EXCEEDED = "quota_exceeded"

error_handling_strategies = {
    AIErrorType.RATE_LIMIT: "Retry with exponential backoff",
    AIErrorType.TOKEN_LIMIT: "Reduce context and retry",
    AIErrorType.CONTENT_FILTER: "Modify input or use fallback",
    AIErrorType.INVALID_REQUEST: "Validate and correct request",
    AIErrorType.MODEL_UNAVAILABLE: "Use fallback model",
    AIErrorType.TIMEOUT: "Retry with shorter timeout",
    AIErrorType.NETWORK: "Retry with backoff",
    AIErrorType.AUTHENTICATION: "Refresh credentials",
    AIErrorType.QUOTA_EXCEEDED: "Alert and queue for later"
}
```

## Exception Hierarchy

```python
class AIException(Exception):
    """Base exception for AI operations"""

    def __init__(self, message: str, error_type: AIErrorType, details: dict = None):
        super().__init__(message)
        self.error_type = error_type
        self.details = details or {}
        self.retryable = error_type in [
            AIErrorType.RATE_LIMIT,
            AIErrorType.TIMEOUT,
            AIErrorType.NETWORK
        ]

class RateLimitException(AIException):
    def __init__(self, message: str, retry_after: int = None):
        super().__init__(message, AIErrorType.RATE_LIMIT, {"retry_after": retry_after})
        self.retry_after = retry_after

class TokenLimitException(AIException):
    def __init__(self, message: str, tokens_used: int, limit: int):
        super().__init__(message, AIErrorType.TOKEN_LIMIT, {
            "tokens_used": tokens_used,
            "limit": limit
        })

class ContentFilterException(AIException):
    def __init__(self, message: str, categories: list):
        super().__init__(message, AIErrorType.CONTENT_FILTER, {"categories": categories})
        self.categories = categories
```

## Error Handler

```python
from openai import RateLimitError, APIError, APITimeoutError, BadRequestError
import logging

logger = logging.getLogger(__name__)

class AIErrorHandler:
    """Handle and classify AI errors"""

    def handle_openai_error(self, error: Exception) -> AIException:
        """Convert OpenAI errors to our exception types"""

        if isinstance(error, RateLimitError):
            retry_after = getattr(error, 'retry_after', 60)
            return RateLimitException(
                f"Rate limit exceeded. Retry after {retry_after}s",
                retry_after=retry_after
            )

        if isinstance(error, APITimeoutError):
            return AIException(
                "API request timed out",
                AIErrorType.TIMEOUT
            )

        if isinstance(error, BadRequestError):
            error_msg = str(error)

            # Check for content filter
            if "content_filter" in error_msg.lower():
                return ContentFilterException(
                    "Content was filtered",
                    categories=self._extract_filter_categories(error)
                )

            # Check for token limit
            if "maximum context length" in error_msg.lower():
                return TokenLimitException(
                    "Token limit exceeded",
                    tokens_used=self._extract_token_count(error),
                    limit=self._extract_limit(error)
                )

            return AIException(error_msg, AIErrorType.INVALID_REQUEST)

        if isinstance(error, APIError):
            return AIException(
                str(error),
                AIErrorType.MODEL_UNAVAILABLE if "model" in str(error).lower()
                else AIErrorType.NETWORK
            )

        # Unknown error
        logger.error(f"Unexpected error: {type(error).__name__}: {error}")
        return AIException(str(error), AIErrorType.NETWORK)

    def _extract_filter_categories(self, error) -> list:
        # Parse error message for filter categories
        return []

    def _extract_token_count(self, error) -> int:
        # Parse error message for token count
        return 0

    def _extract_limit(self, error) -> int:
        return 0
```

## Retry Logic

```python
import asyncio
from functools import wraps
import random

def retry_with_backoff(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    jitter: bool = True
):
    """Decorator for retry with exponential backoff"""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            error_handler = AIErrorHandler()
            last_exception = None

            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    ai_error = error_handler.handle_openai_error(e)
                    last_exception = ai_error

                    if not ai_error.retryable or attempt == max_retries:
                        raise ai_error

                    # Calculate delay
                    delay = min(
                        base_delay * (exponential_base ** attempt),
                        max_delay
                    )

                    # Use retry_after if available
                    if hasattr(ai_error, 'retry_after') and ai_error.retry_after:
                        delay = ai_error.retry_after

                    # Add jitter
                    if jitter:
                        delay *= (0.5 + random.random())

                    logger.warning(
                        f"Attempt {attempt + 1} failed: {ai_error}. "
                        f"Retrying in {delay:.2f}s"
                    )

                    await asyncio.sleep(delay)

            raise last_exception

        return wrapper
    return decorator

# Usage
@retry_with_backoff(max_retries=3, base_delay=1.0)
async def call_openai(messages: list):
    return await client.chat.completions.create(
        model="gpt-4",
        messages=messages
    )
```

## Fallback Strategies

```python
class FallbackManager:
    """Manage fallback strategies for AI calls"""

    def __init__(self, primary_client, fallback_client=None):
        self.primary = primary_client
        self.fallback = fallback_client
        self.fallback_models = ["gpt-4-turbo", "gpt-35-turbo"]

    async def chat_with_fallback(
        self,
        messages: list,
        model: str = "gpt-4"
    ) -> dict:
        """Try primary, fall back to alternatives"""

        # Try primary
        try:
            response = await self.primary.chat.completions.create(
                model=model,
                messages=messages
            )
            return {"response": response, "fallback_used": False}
        except Exception as e:
            logger.warning(f"Primary model failed: {e}")

        # Try fallback models
        for fallback_model in self.fallback_models:
            if fallback_model == model:
                continue

            try:
                response = await self.primary.chat.completions.create(
                    model=fallback_model,
                    messages=messages
                )
                return {
                    "response": response,
                    "fallback_used": True,
                    "model_used": fallback_model
                }
            except Exception as e:
                logger.warning(f"Fallback {fallback_model} failed: {e}")

        # Try fallback client (different region/endpoint)
        if self.fallback:
            try:
                response = await self.fallback.chat.completions.create(
                    model="gpt-35-turbo",
                    messages=messages
                )
                return {
                    "response": response,
                    "fallback_used": True,
                    "fallback_client": True
                }
            except Exception as e:
                logger.error(f"All fallbacks failed: {e}")

        raise AIException(
            "All models and fallbacks failed",
            AIErrorType.MODEL_UNAVAILABLE
        )
```

## Graceful Degradation

```python
class GracefulDegradation:
    """Provide degraded responses when AI fails"""

    def __init__(self):
        self.canned_responses = {
            "greeting": "Hello! I'm here to help, though I'm experiencing some issues. Please try again in a moment.",
            "error": "I apologize, but I'm having trouble processing your request. Please try again later.",
            "fallback": "I cannot provide a detailed response right now. Here's a general answer: {topic}"
        }

    def get_fallback_response(self, user_input: str, error: AIException) -> str:
        """Generate fallback response based on error type"""

        # Content filter - can't respond
        if error.error_type == AIErrorType.CONTENT_FILTER:
            return "I'm unable to respond to that type of request. Please rephrase your question."

        # Rate limit - temporary
        if error.error_type == AIErrorType.RATE_LIMIT:
            return "I'm handling many requests right now. Please try again in a moment."

        # Check for simple queries we can handle
        simple_intent = self._detect_simple_intent(user_input)
        if simple_intent:
            return self._handle_simple_intent(simple_intent)

        return self.canned_responses["error"]

    def _detect_simple_intent(self, text: str) -> str:
        """Detect simple intents without AI"""
        text_lower = text.lower()

        if any(word in text_lower for word in ["hi", "hello", "hey"]):
            return "greeting"
        if any(word in text_lower for word in ["bye", "goodbye", "thanks"]):
            return "farewell"
        if "help" in text_lower:
            return "help"

        return None

    def _handle_simple_intent(self, intent: str) -> str:
        """Handle simple intents with canned responses"""
        responses = {
            "greeting": "Hello! How can I help you today?",
            "farewell": "Goodbye! Have a great day!",
            "help": "I can help with questions, analysis, and more. What would you like to know?"
        }
        return responses.get(intent, self.canned_responses["error"])
```

## Complete Error-Handling Flow

```python
class ResilientAIClient:
    """AI client with comprehensive error handling"""

    def __init__(self, primary_client, fallback_client=None):
        self.error_handler = AIErrorHandler()
        self.fallback_manager = FallbackManager(primary_client, fallback_client)
        self.degradation = GracefulDegradation()

    @retry_with_backoff(max_retries=3)
    async def chat(self, messages: list, model: str = "gpt-4") -> dict:
        try:
            result = await self.fallback_manager.chat_with_fallback(messages, model)
            return {
                "success": True,
                "response": result["response"].choices[0].message.content,
                "fallback_used": result.get("fallback_used", False)
            }
        except AIException as e:
            # Log for monitoring
            logger.error(f"AI call failed: {e.error_type}: {e}")

            # Get degraded response
            user_input = messages[-1]["content"] if messages else ""
            fallback_response = self.degradation.get_fallback_response(user_input, e)

            return {
                "success": False,
                "response": fallback_response,
                "error_type": e.error_type.value,
                "degraded": True
            }
```

Robust error handling ensures AI applications remain useful even during failures. Tomorrow, I will cover retry strategies in more depth.

## Resources

- [Azure OpenAI Error Codes](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/reference)
- [Retry Patterns](https://docs.microsoft.com/en-us/azure/architecture/patterns/retry)
