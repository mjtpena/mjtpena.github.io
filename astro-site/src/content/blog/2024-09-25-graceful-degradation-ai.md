---
title: "Graceful Degradation in AI Systems: Maintaining Service Quality"
author: "Michael John Peña"
draft: false
date: 2024-09-25
tags: ["Graceful Degradation", "Resilience", "AI", "Architecture", "Production"]

---

I wrote "Graceful Degradation in AI Systems: Maintaining Service Quality" to share practical, production-minded guidance on this topic.

## Degradation Levels

```python
from enum import Enum, auto
from dataclasses import dataclass
from typing import Dict, Any, Optional, Callable
import time

class ServiceLevel(Enum):
    FULL = auto()       # All features available
    REDUCED = auto()    # Some features disabled
    MINIMAL = auto()    # Core functionality only
    EMERGENCY = auto()  # Static responses only

@dataclass
class DegradationConfig:
    """Configuration for each degradation level"""
    level: ServiceLevel
    max_tokens: int
    model: str
    features_enabled: set
    timeout_seconds: float
    cache_ttl_seconds: int

DEGRADATION_CONFIGS = {
    ServiceLevel.FULL: DegradationConfig(
        level=ServiceLevel.FULL,
        max_tokens=4096,
        model="gpt-4o",
        features_enabled={"tool_use", "streaming", "vision", "long_context"},
        timeout_seconds=60,
        cache_ttl_seconds=300
    ),
    ServiceLevel.REDUCED: DegradationConfig(
        level=ServiceLevel.REDUCED,
        max_tokens=2048,
        model="gpt-4o-mini",
        features_enabled={"tool_use", "streaming"},
        timeout_seconds=30,
        cache_ttl_seconds=600
    ),
    ServiceLevel.MINIMAL: DegradationConfig(
        level=ServiceLevel.MINIMAL,
        max_tokens=1024,
        model="gpt-4o-mini",
        features_enabled=set(),
        timeout_seconds=15,
        cache_ttl_seconds=1800
    ),
    ServiceLevel.EMERGENCY: DegradationConfig(
        level=ServiceLevel.EMERGENCY,
        max_tokens=256,
        model="gpt-4o-mini",
        features_enabled=set(),
        timeout_seconds=5,
        cache_ttl_seconds=3600
    )
}

class ServiceLevelManager:
    """Manage service level based on system health"""

    def __init__(self):
        self.current_level = ServiceLevel.FULL
        self.error_window: list = []
        self.window_seconds = 300  # 5 minutes

    def record_success(self):
        """Record successful request"""
        self._cleanup_window()
        # Consider upgrading if stable
        if len(self.error_window) == 0 and self.current_level != ServiceLevel.FULL:
            self._try_upgrade()

    def record_error(self, error_type: str):
        """Record an error"""
        self._cleanup_window()
        self.error_window.append((time.time(), error_type))

        # Check if we need to degrade
        error_rate = len(self.error_window) / max(1, self._get_request_count())
        self._evaluate_degradation(error_rate)

    def _cleanup_window(self):
        """Remove old errors from window"""
        cutoff = time.time() - self.window_seconds
        self.error_window = [(t, e) for t, e in self.error_window if t > cutoff]

    def _evaluate_degradation(self, error_rate: float):
        """Determine if degradation is needed"""
        if error_rate > 0.5 and self.current_level.value < ServiceLevel.EMERGENCY.value:
            self._degrade()
        elif error_rate > 0.25 and self.current_level.value < ServiceLevel.MINIMAL.value:
            self._degrade()
        elif error_rate > 0.1 and self.current_level.value < ServiceLevel.REDUCED.value:
            self._degrade()

    def _degrade(self):
        """Move to a lower service level"""
        levels = list(ServiceLevel)
        current_idx = levels.index(self.current_level)
        if current_idx < len(levels) - 1:
            self.current_level = levels[current_idx + 1]
            logger.warning(f"Service degraded to {self.current_level.name}")

    def _try_upgrade(self):
        """Try to restore higher service level"""
        levels = list(ServiceLevel)
        current_idx = levels.index(self.current_level)
        if current_idx > 0:
            self.current_level = levels[current_idx - 1]
            logger.info(f"Service upgraded to {self.current_level.name}")

    def get_config(self) -> DegradationConfig:
        """Get current configuration"""
        return DEGRADATION_CONFIGS[self.current_level]
```

## Adaptive Response Generation

```python
class AdaptiveGenerator:
    """Generate responses adapted to current service level"""

    def __init__(self, level_manager: ServiceLevelManager):
        self.level_manager = level_manager
        self.client = OpenAI()

    def generate(self, prompt: str, tools: list = None) -> dict:
        """Generate with adaptive quality"""

        config = self.level_manager.get_config()

        try:
            if config.level == ServiceLevel.EMERGENCY:
                return self._emergency_response(prompt)

            response = self._make_request(prompt, tools, config)
            self.level_manager.record_success()

            return {
                "content": response,
                "service_level": config.level.name,
                "degraded": config.level != ServiceLevel.FULL
            }

        except Exception as e:
            self.level_manager.record_error(type(e).__name__)
            raise

    def _make_request(self, prompt: str, tools: list, config: DegradationConfig) -> str:
        """Make LLM request with config"""

        request = {
            "model": config.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": config.max_tokens,
            "timeout": config.timeout_seconds
        }

        # Add tools if enabled
        if tools and "tool_use" in config.features_enabled:
            request["tools"] = tools

        response = self.client.chat.completions.create(**request)
        return response.choices[0].message.content

    def _emergency_response(self, prompt: str) -> str:
        """Return emergency response without API call"""

        # Try to match common patterns
        prompt_lower = prompt.lower()

        if any(word in prompt_lower for word in ["help", "support", "error"]):
            return "I apologize, but I'm currently operating in limited mode. Please contact support at support@example.com for immediate assistance."

        if any(word in prompt_lower for word in ["weather", "time", "date"]):
            return "I'm unable to provide real-time information at the moment. Please check back shortly."

        return "I'm temporarily unable to process complex requests. Please try again in a few minutes or simplify your request."
```

## Quality-Aware Responses

```python
@dataclass
class QualityIndicator:
    """Indicates response quality"""
    confidence: float  # 0-1
    is_complete: bool
    is_cached: bool
    model_used: str
    service_level: str
    latency_ms: float

class QualityAwareGenerator:
    """Generate responses with quality indicators"""

    def __init__(self):
        self.client = OpenAI()
        self.cache = {}

    def generate(self, prompt: str, min_quality: float = 0.5) -> tuple[str, QualityIndicator]:
        """Generate response with quality guarantee"""

        start_time = time.time()

        # Try different strategies based on required quality
        strategies = [
            (0.9, self._high_quality_generation),
            (0.7, self._standard_generation),
            (0.5, self._cached_generation),
            (0.3, self._fast_generation),
            (0.0, self._fallback_generation)
        ]

        for quality_threshold, strategy in strategies:
            if quality_threshold >= min_quality:
                try:
                    response, confidence = strategy(prompt)
                    latency = (time.time() - start_time) * 1000

                    indicator = QualityIndicator(
                        confidence=confidence,
                        is_complete=True,
                        is_cached=strategy == self._cached_generation,
                        model_used=self._get_model_for_strategy(strategy),
                        service_level="standard",
                        latency_ms=latency
                    )

                    return response, indicator

                except Exception as e:
                    logger.warning(f"Strategy failed: {e}")
                    continue

        # All strategies failed
        return self._error_response(prompt)

    def _high_quality_generation(self, prompt: str) -> tuple[str, float]:
        """High quality with GPT-4"""
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Provide thorough, accurate responses."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=4096
        )
        return response.choices[0].message.content, 0.95

    def _standard_generation(self, prompt: str) -> tuple[str, float]:
        """Standard quality with GPT-4o-mini"""
        response = self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2048
        )
        return response.choices[0].message.content, 0.75

    def _cached_generation(self, prompt: str) -> tuple[str, float]:
        """Return cached response"""
        cache_key = hashlib.md5(prompt.encode()).hexdigest()
        if cache_key in self.cache:
            return self.cache[cache_key], 0.6
        raise ValueError("No cached response")

    def _fast_generation(self, prompt: str) -> tuple[str, float]:
        """Fast response with minimal processing"""
        response = self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512
        )
        return response.choices[0].message.content, 0.5

    def _fallback_generation(self, prompt: str) -> tuple[str, float]:
        """Static fallback response"""
        return "I'm currently unable to provide a detailed response. Please try again shortly.", 0.2
```

## User Communication

```python
class DegradationNotifier:
    """Communicate degradation status to users"""

    def __init__(self):
        self.status_messages = {
            ServiceLevel.FULL: None,
            ServiceLevel.REDUCED: "Some advanced features are temporarily unavailable.",
            ServiceLevel.MINIMAL: "We're experiencing high demand. Responses may be slower and shorter than usual.",
            ServiceLevel.EMERGENCY: "We're currently operating in limited mode. Only basic queries are supported."
        }

    def get_user_notice(self, level: ServiceLevel) -> Optional[str]:
        """Get notice to show user"""
        return self.status_messages.get(level)

    def wrap_response(self, response: str, level: ServiceLevel) -> dict:
        """Wrap response with status information"""
        notice = self.get_user_notice(level)

        return {
            "response": response,
            "status": {
                "level": level.name.lower(),
                "degraded": level != ServiceLevel.FULL,
                "notice": notice
            }
        }

    def get_api_headers(self, level: ServiceLevel) -> dict:
        """Get headers indicating service status"""
        return {
            "X-Service-Level": level.name.lower(),
            "X-Service-Degraded": str(level != ServiceLevel.FULL).lower()
        }
```

## Monitoring Degradation

```python
import json
from datetime import datetime

class DegradationMonitor:
    """Monitor and log degradation events"""

    def __init__(self):
        self.events = []

    def record_degradation(self, from_level: ServiceLevel, to_level: ServiceLevel,
                          reason: str):
        """Record a degradation event"""
        event = {
            "timestamp": datetime.now().isoformat(),
            "event": "degradation",
            "from_level": from_level.name,
            "to_level": to_level.name,
            "reason": reason
        }
        self.events.append(event)
        logger.warning(f"Service degradation: {json.dumps(event)}")

    def record_recovery(self, from_level: ServiceLevel, to_level: ServiceLevel):
        """Record a recovery event"""
        event = {
            "timestamp": datetime.now().isoformat(),
            "event": "recovery",
            "from_level": from_level.name,
            "to_level": to_level.name
        }
        self.events.append(event)
        logger.info(f"Service recovery: {json.dumps(event)}")

    def get_degradation_report(self, hours: int = 24) -> dict:
        """Get report on degradation events"""
        cutoff = datetime.now().timestamp() - (hours * 3600)

        recent_events = [
            e for e in self.events
            if datetime.fromisoformat(e["timestamp"]).timestamp() > cutoff
        ]

        degradation_count = sum(1 for e in recent_events if e["event"] == "degradation")
        recovery_count = sum(1 for e in recent_events if e["event"] == "recovery")

        return {
            "period_hours": hours,
            "degradation_count": degradation_count,
            "recovery_count": recovery_count,
            "events": recent_events
        }
```

Graceful degradation is about providing the best possible experience given current constraints. Plan for every level of degradation and communicate clearly with users about current capabilities.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
