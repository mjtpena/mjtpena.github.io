---
title: "Fallback Patterns for AI Applications: Ensuring Continuity"
author: "Michael John Peña"
draft: false
date: 2024-09-24
tags: ["Fallback", "Resilience", "AI", "Architecture", "Production"]

---

I wrote "Fallback Patterns for AI Applications: Ensuring Continuity" to share practical, production-minded guidance on this topic.

## Fallback Hierarchy

```python
from typing import Callable, TypeVar, Generic, List, Optional
from dataclasses import dataclass
from enum import Enum
import logging

logger = logging.getLogger(__name__)

T = TypeVar('T')

class FallbackLevel(Enum):
    PRIMARY = "primary"        # Main AI service
    SECONDARY = "secondary"    # Alternative AI service
    CACHE = "cache"            # Cached responses
    STATIC = "static"          # Pre-computed responses
    GRACEFUL = "graceful"      # Graceful degradation message

@dataclass
class FallbackResult(Generic[T]):
    """Result from fallback chain"""
    value: T
    level: FallbackLevel
    latency_ms: float
    error_context: Optional[str] = None

class FallbackChain(Generic[T]):
    """Chain of fallback options"""

    def __init__(self):
        self.handlers: List[tuple[FallbackLevel, Callable[..., T]]] = []

    def add(self, level: FallbackLevel, handler: Callable[..., T]) -> 'FallbackChain':
        """Add a fallback handler"""
        self.handlers.append((level, handler))
        return self

    def execute(self, *args, **kwargs) -> FallbackResult[T]:
        """Execute through the chain until success"""

        import time
        errors = []

        for level, handler in self.handlers:
            start = time.time()
            try:
                result = handler(*args, **kwargs)
                latency = (time.time() - start) * 1000

                if level != FallbackLevel.PRIMARY:
                    logger.warning(f"Using fallback level: {level.value}")

                return FallbackResult(
                    value=result,
                    level=level,
                    latency_ms=latency
                )

            except Exception as e:
                errors.append(f"{level.value}: {str(e)}")
                logger.warning(f"Fallback {level.value} failed: {e}")
                continue

        # All fallbacks failed
        raise RuntimeError(f"All fallbacks failed: {errors}")

# Build a fallback chain
def build_chat_fallback() -> FallbackChain[str]:

    def primary_gpt4(prompt: str) -> str:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    def secondary_gpt4_mini(prompt: str) -> str:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    def cached_response(prompt: str) -> str:
        # Check cache for similar prompts
        cached = cache.get_similar(prompt)
        if cached:
            return cached
        raise ValueError("No cached response available")

    def static_response(prompt: str) -> str:
        return "I'm currently experiencing high demand. Please try again in a few moments, or contact support for immediate assistance."

    chain = FallbackChain[str]()
    chain.add(FallbackLevel.PRIMARY, primary_gpt4)
    chain.add(FallbackLevel.SECONDARY, secondary_gpt4_mini)
    chain.add(FallbackLevel.CACHE, cached_response)
    chain.add(FallbackLevel.STATIC, static_response)

    return chain

# Usage
chat_fallback = build_chat_fallback()
result = chat_fallback.execute("What is machine learning?")
print(f"Response (via {result.level.value}): {result.value}")
```

## Multi-Provider Fallback

```python
from openai import OpenAI
import anthropic
from typing import Protocol

class LLMProvider(Protocol):
    """Protocol for LLM providers"""
    def generate(self, prompt: str, max_tokens: int) -> str: ...

class OpenAIProvider:
    def __init__(self, model: str = "gpt-4o"):
        self.client = OpenAI()
        self.model = model

    def generate(self, prompt: str, max_tokens: int = 1024) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens
        )
        return response.choices[0].message.content

class AnthropicProvider:
    def __init__(self, model: str = "claude-3-sonnet-20240229"):
        self.client = anthropic.Anthropic()
        self.model = model

    def generate(self, prompt: str, max_tokens: int = 1024) -> str:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text

class MultiProviderFallback:
    """Fallback across multiple LLM providers"""

    def __init__(self):
        self.providers: List[tuple[str, LLMProvider]] = []

    def add_provider(self, name: str, provider: LLMProvider) -> 'MultiProviderFallback':
        self.providers.append((name, provider))
        return self

    def generate(self, prompt: str, max_tokens: int = 1024) -> tuple[str, str]:
        """Generate with fallback, returns (response, provider_name)"""

        for name, provider in self.providers:
            try:
                result = provider.generate(prompt, max_tokens)
                return result, name
            except Exception as e:
                logger.warning(f"Provider {name} failed: {e}")
                continue

        raise RuntimeError("All providers failed")

# Usage
multi = MultiProviderFallback()
multi.add_provider("openai-gpt4", OpenAIProvider("gpt-4o"))
multi.add_provider("openai-mini", OpenAIProvider("gpt-4o-mini"))
multi.add_provider("anthropic", AnthropicProvider())

response, provider = multi.generate("Explain quantum computing")
print(f"Response from {provider}: {response[:100]}...")
```

## Semantic Cache Fallback

```python
import hashlib
from typing import Dict, Optional
import numpy as np

class SemanticCache:
    """Cache with semantic similarity matching"""

    def __init__(self, similarity_threshold: float = 0.9):
        self.cache: Dict[str, dict] = {}
        self.embeddings: Dict[str, np.ndarray] = {}
        self.threshold = similarity_threshold

    def get(self, prompt: str) -> Optional[str]:
        """Get exact match from cache"""
        key = self._hash(prompt)
        if key in self.cache:
            return self.cache[key]["response"]
        return None

    def get_similar(self, prompt: str) -> Optional[str]:
        """Get semantically similar response"""
        if not self.embeddings:
            return None

        # Get embedding for prompt
        prompt_embedding = self._get_embedding(prompt)

        # Find most similar cached prompt
        best_similarity = 0
        best_response = None

        for key, embedding in self.embeddings.items():
            similarity = self._cosine_similarity(prompt_embedding, embedding)
            if similarity > best_similarity and similarity >= self.threshold:
                best_similarity = similarity
                best_response = self.cache[key]["response"]

        if best_response:
            logger.info(f"Cache hit with similarity {best_similarity:.2f}")

        return best_response

    def set(self, prompt: str, response: str):
        """Cache a response"""
        key = self._hash(prompt)
        self.cache[key] = {
            "prompt": prompt,
            "response": response,
            "timestamp": time.time()
        }
        self.embeddings[key] = self._get_embedding(prompt)

    def _hash(self, text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()

    def _get_embedding(self, text: str) -> np.ndarray:
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return np.array(response.data[0].embedding)

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Integrate with fallback
cache = SemanticCache(similarity_threshold=0.85)

def cached_llm_call(prompt: str) -> str:
    # Check cache first
    cached = cache.get(prompt)
    if cached:
        return cached

    # Check semantic cache
    similar = cache.get_similar(prompt)
    if similar:
        return similar

    # Call LLM
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )
    result = response.choices[0].message.content

    # Cache the result
    cache.set(prompt, result)

    return result
```

## Feature-Based Degradation

```python
from dataclasses import dataclass
from typing import Set

@dataclass
class FeatureSet:
    """Features available at different degradation levels"""
    full_generation: bool = True
    tool_use: bool = True
    streaming: bool = True
    vision: bool = True
    long_context: bool = True

class GracefulDegradation:
    """Degrade features based on system health"""

    def __init__(self):
        self.current_features = FeatureSet()
        self.error_counts: Dict[str, int] = {}

    def record_error(self, feature: str):
        """Record an error for a feature"""
        self.error_counts[feature] = self.error_counts.get(feature, 0) + 1

        # Disable feature if too many errors
        if self.error_counts[feature] >= 3:
            self._disable_feature(feature)

    def _disable_feature(self, feature: str):
        """Disable a feature"""
        if hasattr(self.current_features, feature):
            setattr(self.current_features, feature, False)
            logger.warning(f"Feature disabled: {feature}")

    def get_available_features(self) -> FeatureSet:
        """Get currently available features"""
        return self.current_features

    def adapt_request(self, request: dict) -> dict:
        """Adapt request based on available features"""
        features = self.current_features

        if not features.streaming:
            request.pop('stream', None)

        if not features.tool_use:
            request.pop('tools', None)
            request.pop('tool_choice', None)

        if not features.long_context:
            # Truncate messages if needed
            messages = request.get('messages', [])
            if messages:
                # Keep only recent messages
                request['messages'] = messages[-5:]

        return request

# Usage
degradation = GracefulDegradation()

def adaptive_call(prompt: str, tools: List = None) -> str:
    request = {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": prompt}],
        "tools": tools,
        "stream": True
    }

    # Adapt based on current health
    request = degradation.adapt_request(request)

    try:
        response = client.chat.completions.create(**request)
        return response.choices[0].message.content
    except Exception as e:
        # Record which feature caused the error
        if "tool" in str(e).lower():
            degradation.record_error("tool_use")
        elif "context" in str(e).lower():
            degradation.record_error("long_context")
        raise
```

Fallback patterns ensure your AI application remains useful even when primary services fail. Design your fallbacks to maintain the best possible user experience at each degradation level.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
