---
title: "Fallback Patterns for AI Applications"
author: Michael John Peña
draft: false
date: 2023-06-29
tags:
  - Azure OpenAI
  - Fallback
  - Resilience
  - Architecture
  - Production

---

I wrote "Fallback Patterns for AI Applications" to share practical, production-minded guidance on this topic.

## Fallback Strategy Hierarchy

```python
from abc import ABC, abstractmethod
from typing import Optional

class FallbackStrategy(ABC):
    @abstractmethod
    async def execute(self, request: dict) -> Optional[dict]:
        pass

    @abstractmethod
    def can_handle(self, error: Exception) -> bool:
        pass

class ModelFallback(FallbackStrategy):
    """Fallback to alternative models"""

    def __init__(self, client, fallback_models: list):
        self.client = client
        self.fallback_models = fallback_models

    async def execute(self, request: dict) -> Optional[dict]:
        for model in self.fallback_models:
            try:
                response = await self.client.chat.completions.create(
                    model=model,
                    messages=request["messages"],
                    **{k: v for k, v in request.items() if k != "messages"}
                )
                return {
                    "response": response,
                    "fallback_model": model
                }
            except Exception as e:
                continue
        return None

    def can_handle(self, error: Exception) -> bool:
        return "model" in str(error).lower() or isinstance(error, (TimeoutError,))

class RegionFallback(FallbackStrategy):
    """Fallback to different Azure region"""

    def __init__(self, region_clients: dict):
        self.clients = region_clients  # {"eastus": client1, "westus": client2}

    async def execute(self, request: dict) -> Optional[dict]:
        for region, client in self.clients.items():
            try:
                response = await client.chat.completions.create(**request)
                return {
                    "response": response,
                    "fallback_region": region
                }
            except Exception:
                continue
        return None

    def can_handle(self, error: Exception) -> bool:
        return "unavailable" in str(error).lower() or "503" in str(error)

class CachedFallback(FallbackStrategy):
    """Return cached response if available"""

    def __init__(self, cache):
        self.cache = cache

    async def execute(self, request: dict) -> Optional[dict]:
        cache_key = self._generate_key(request)
        cached = await self.cache.get(cache_key)
        if cached:
            return {
                "response": cached,
                "from_cache": True
            }
        return None

    def can_handle(self, error: Exception) -> bool:
        return True  # Can always try cache

    def _generate_key(self, request: dict) -> str:
        import hashlib
        content = str(request.get("messages", []))
        return hashlib.md5(content.encode()).hexdigest()

class SimplifiedFallback(FallbackStrategy):
    """Simplified response without AI"""

    def __init__(self):
        self.templates = {
            "greeting": "Hello! How can I help you?",
            "error": "I apologize, but I cannot process that request right now.",
            "unknown": "I'm having trouble understanding. Could you rephrase?"
        }

    async def execute(self, request: dict) -> Optional[dict]:
        messages = request.get("messages", [])
        user_message = messages[-1]["content"] if messages else ""

        intent = self._detect_intent(user_message)
        response = self.templates.get(intent, self.templates["unknown"])

        return {
            "response": response,
            "simplified": True
        }

    def can_handle(self, error: Exception) -> bool:
        return True  # Last resort

    def _detect_intent(self, text: str) -> str:
        text = text.lower()
        if any(w in text for w in ["hi", "hello", "hey"]):
            return "greeting"
        return "unknown"
```

## Fallback Chain

```python
class FallbackChain:
    """Chain multiple fallback strategies"""

    def __init__(self, primary_client, strategies: list[FallbackStrategy]):
        self.primary = primary_client
        self.strategies = strategies
        self.execution_log = []

    async def execute(self, request: dict) -> dict:
        # Try primary
        try:
            response = await self.primary.chat.completions.create(**request)
            self._log("primary", success=True)
            return {
                "response": response.choices[0].message.content,
                "source": "primary"
            }
        except Exception as primary_error:
            self._log("primary", success=False, error=str(primary_error))

            # Try fallback strategies
            for strategy in self.strategies:
                if strategy.can_handle(primary_error):
                    try:
                        result = await strategy.execute(request)
                        if result:
                            self._log(strategy.__class__.__name__, success=True)
                            return {
                                **result,
                                "source": strategy.__class__.__name__
                            }
                    except Exception as fallback_error:
                        self._log(strategy.__class__.__name__, success=False, error=str(fallback_error))

            # All fallbacks failed
            raise Exception("All fallback strategies exhausted")

    def _log(self, source: str, success: bool, error: str = None):
        self.execution_log.append({
            "source": source,
            "success": success,
            "error": error,
            "timestamp": datetime.utcnow().isoformat()
        })
```

## Degradation Levels

```python
from enum import Enum

class DegradationLevel(Enum):
    FULL = 1      # Full AI capability
    REDUCED = 2   # Simpler model or limited features
    MINIMAL = 3   # Cached or template responses
    OFFLINE = 4   # Error message only

class GracefulDegradation:
    """Manage degradation levels based on system health"""

    def __init__(self):
        self.current_level = DegradationLevel.FULL
        self.health_scores = []

    def update_health(self, success: bool, latency_ms: int):
        score = 1.0 if success else 0.0
        if latency_ms > 5000:
            score *= 0.5

        self.health_scores.append(score)
        self.health_scores = self.health_scores[-100:]  # Keep last 100

        avg_health = sum(self.health_scores) / len(self.health_scores)
        self._adjust_level(avg_health)

    def _adjust_level(self, health: float):
        if health > 0.9:
            self.current_level = DegradationLevel.FULL
        elif health > 0.7:
            self.current_level = DegradationLevel.REDUCED
        elif health > 0.3:
            self.current_level = DegradationLevel.MINIMAL
        else:
            self.current_level = DegradationLevel.OFFLINE

    def get_config_for_level(self) -> dict:
        configs = {
            DegradationLevel.FULL: {
                "model": "gpt-4",
                "max_tokens": 1000,
                "features": ["function_calling", "streaming"]
            },
            DegradationLevel.REDUCED: {
                "model": "gpt-35-turbo",
                "max_tokens": 500,
                "features": []
            },
            DegradationLevel.MINIMAL: {
                "use_cache_only": True,
                "max_tokens": 200
            },
            DegradationLevel.OFFLINE: {
                "template_only": True
            }
        }
        return configs[self.current_level]
```

## Complete Implementation

```python
class ResilientAIService:
    def __init__(self, config: dict):
        self.primary_client = AzureOpenAI(**config["primary"])

        # Setup fallback chain
        fallback_strategies = [
            ModelFallback(self.primary_client, ["gpt-4-turbo", "gpt-35-turbo"]),
            RegionFallback({
                region: AzureOpenAI(**cfg)
                for region, cfg in config.get("regions", {}).items()
            }),
            CachedFallback(config["cache"]),
            SimplifiedFallback()
        ]

        self.fallback_chain = FallbackChain(self.primary_client, fallback_strategies)
        self.degradation = GracefulDegradation()

    async def chat(self, messages: list) -> dict:
        start_time = time.time()

        try:
            config = self.degradation.get_config_for_level()

            if config.get("template_only"):
                return SimplifiedFallback().execute({"messages": messages})

            request = {
                "model": config.get("model", "gpt-4"),
                "messages": messages,
                "max_tokens": config.get("max_tokens", 1000)
            }

            result = await self.fallback_chain.execute(request)

            latency = (time.time() - start_time) * 1000
            self.degradation.update_health(True, latency)

            return result

        except Exception as e:
            latency = (time.time() - start_time) * 1000
            self.degradation.update_health(False, latency)
            raise
```

Fallback patterns ensure continuous service availability. Tomorrow, I will cover circuit breakers for AI applications.

## Resources

- [Fallback Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/)
- [Graceful Degradation](https://en.wikipedia.org/wiki/Graceful_degradation)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
