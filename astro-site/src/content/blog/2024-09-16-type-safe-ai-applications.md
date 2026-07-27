---
title: "Building Type-Safe AI Applications: From Prompts to Production"
author: "Michael John Peña"
draft: false
date: 2024-09-16
tags: ["Type Safety", "AI", "Python", "TypeScript", "Best Practices"]

---

I wrote "Building Type-Safe AI Applications: From Prompts to Production" to share practical, production-minded guidance on this topic.

## Why Type Safety Matters for AI

```python
# Without type safety - anything can happen
def process_llm_response(response):
    # response could be anything
    # No IDE support, no validation
    return response["data"]["items"][0]["value"]  # Might crash!

# With type safety - predictable and safe
from pydantic import BaseModel
from typing import List

class Item(BaseModel):
    value: str
    score: float

class LLMResponse(BaseModel):
    data: List[Item]

def process_llm_response_safe(response: LLMResponse) -> str:
    # IDE knows exactly what's available
    # Validation happens automatically
    return response.data[0].value if response.data else ""
```

## Complete Type-Safe Pipeline

```python
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Optional, TypeVar, Generic
from enum import Enum
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

client = OpenAI()

# Define your domain types
class Sentiment(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    MIXED = "mixed"

class Entity(BaseModel):
    name: str
    type: str
    confidence: float = Field(ge=0, le=1)

class AnalysisResult(BaseModel):
    sentiment: Sentiment
    entities: List[Entity]
    summary: str
    key_phrases: List[str]
    language: str

# Generic result wrapper
T = TypeVar('T', bound=BaseModel)

class AIResult(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    error: Optional[str] = None
    model: str
    tokens_used: int

class TypeSafeAI:
    """Type-safe wrapper for AI operations"""

    def __init__(self, model: str = "gpt-4o-2024-08-06"):
        self.model = model
        self.client = OpenAI()

    def analyze(self, text: str) -> AIResult[AnalysisResult]:
        """Analyze text with full type safety"""

        try:
            response = self.client.beta.chat.completions.parse(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "Analyze the provided text comprehensively."
                    },
                    {
                        "role": "user",
                        "content": text
                    }
                ],
                response_format=AnalysisResult
            )

            message = response.choices[0].message

            if message.refusal:
                return AIResult(
                    success=False,
                    error=f"Model refused: {message.refusal}",
                    model=self.model,
                    tokens_used=response.usage.total_tokens
                )

            return AIResult(
                success=True,
                data=message.parsed,
                model=self.model,
                tokens_used=response.usage.total_tokens
            )

        except Exception as e:
            logger.error(f"Analysis failed: {e}")
            return AIResult(
                success=False,
                error=str(e),
                model=self.model,
                tokens_used=0
            )

# Usage
ai = TypeSafeAI()
result = ai.analyze("Apple announced new products today. Stock is up 5%.")

if result.success and result.data:
    print(f"Sentiment: {result.data.sentiment.value}")
    for entity in result.data.entities:
        print(f"  Entity: {entity.name} ({entity.type})")
```

## TypeScript Integration

```typescript
// types.ts - Shared types between Python and TypeScript
interface Entity {
  name: string;
  type: string;
  confidence: number;
}

interface AnalysisResult {
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  entities: Entity[];
  summary: string;
  key_phrases: string[];
  language: string;
}

interface AIResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  model: string;
  tokens_used: number;
}

// client.ts - Type-safe API client
async function analyzeText(text: string): Promise<AIResult<AnalysisResult>> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  const result: AIResult<AnalysisResult> = await response.json();

  // TypeScript knows exactly what fields are available
  if (result.success && result.data) {
    console.log(`Sentiment: ${result.data.sentiment}`);
    result.data.entities.forEach(entity => {
      console.log(`  ${entity.name}: ${entity.type}`);
    });
  }

  return result;
}
```

## Validation Layers

```python
from pydantic import BaseModel, field_validator, model_validator
from typing import List
import re

class ValidatedInput(BaseModel):
    """Input validation before sending to LLM"""

    text: str
    max_entities: int = Field(default=10, ge=1, le=50)
    include_sentiment: bool = True

    @field_validator('text')
    @classmethod
    def validate_text(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Text cannot be empty")

        if len(v) > 50000:
            raise ValueError("Text too long (max 50000 chars)")

        # Remove potentially problematic content
        cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', v)
        return cleaned.strip()

class ValidatedOutput(BaseModel):
    """Output validation after LLM response"""

    sentiment: str
    entities: List[Entity]
    confidence: float

    @field_validator('sentiment')
    @classmethod
    def validate_sentiment(cls, v: str) -> str:
        valid = {'positive', 'negative', 'neutral', 'mixed'}
        if v.lower() not in valid:
            return 'neutral'  # Safe default
        return v.lower()

    @field_validator('confidence')
    @classmethod
    def validate_confidence(cls, v: float) -> float:
        return max(0.0, min(1.0, v))  # Clamp to valid range

    @model_validator(mode='after')
    def validate_consistency(self):
        # Ensure entities have reasonable confidence
        for entity in self.entities:
            if entity.confidence < 0.1:
                entity.confidence = 0.1
        return self
```

## Error Boundaries

```python
from typing import Callable, TypeVar
from functools import wraps
import traceback

T = TypeVar('T')

class AIError(Exception):
    """Base class for AI-related errors"""
    pass

class ValidationError(AIError):
    """Input or output validation failed"""
    pass

class RateLimitError(AIError):
    """API rate limit exceeded"""
    pass

class ModelError(AIError):
    """Model returned unexpected response"""
    pass

def type_safe_boundary(default_value: T) -> Callable:
    """
    Decorator that ensures type safety with a fallback
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            try:
                result = func(*args, **kwargs)

                # Verify return type matches expected
                if not isinstance(result, type(default_value)):
                    logger.warning(f"Type mismatch in {func.__name__}")
                    return default_value

                return result

            except ValidationError as e:
                logger.error(f"Validation error in {func.__name__}: {e}")
                return default_value

            except RateLimitError as e:
                logger.error(f"Rate limit in {func.__name__}: {e}")
                raise  # Re-raise rate limits

            except Exception as e:
                logger.error(f"Unexpected error in {func.__name__}: {e}")
                logger.debug(traceback.format_exc())
                return default_value

        return wrapper
    return decorator

# Usage
@type_safe_boundary(default_value=AnalysisResult(
    sentiment=Sentiment.NEUTRAL,
    entities=[],
    summary="Analysis unavailable",
    key_phrases=[],
    language="en"
))
def analyze_with_safety(text: str) -> AnalysisResult:
    # Implementation here
    pass
```

## Runtime Type Checking

```python
from typing import get_type_hints, get_origin, get_args
import inspect

def validate_types_at_runtime(func: Callable) -> Callable:
    """Decorator for runtime type validation"""

    hints = get_type_hints(func)

    @wraps(func)
    def wrapper(*args, **kwargs):
        # Get parameter names
        sig = inspect.signature(func)
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()

        # Validate each argument
        for param_name, value in bound.arguments.items():
            if param_name in hints:
                expected_type = hints[param_name]

                # Handle Optional types
                origin = get_origin(expected_type)
                if origin is type(None) or (origin and value is None):
                    continue

                if not isinstance(value, expected_type if not origin else origin):
                    raise TypeError(
                        f"Parameter '{param_name}' expected {expected_type}, "
                        f"got {type(value)}"
                    )

        # Call function
        result = func(*args, **kwargs)

        # Validate return type
        if 'return' in hints:
            expected_return = hints['return']
            if expected_return is not type(None):
                if not isinstance(result, expected_return):
                    raise TypeError(
                        f"Return value expected {expected_return}, "
                        f"got {type(result)}"
                    )

        return result

    return wrapper
```

Type safety transforms AI applications from fragile prototypes into robust production systems. Invest in types early - your future self will thank you.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
