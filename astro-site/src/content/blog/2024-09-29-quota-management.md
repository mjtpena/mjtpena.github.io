---
title: "Quota Management: Controlling AI Resource Consumption"
description: "Effective quota management protects both your users and your budget. Implement quotas at multiple levels - per request, per user, and per organization - to…"
author: "Michael John Peña"
draft: false
date: 2024-09-29
tags: ["Quota", "Resource Management", "AI", "Cost Control", "Production"]
---

## Quota System Design

```python
from dataclasses import dataclass, field
from typing import Dict, Optional
from datetime import datetime, timedelta
from enum import Enum
import threading

class QuotaPeriod(Enum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"

@dataclass
class Quota:
    """Quota definition"""
    name: str
    limit: int
    period: QuotaPeriod
    resource_type: str  # "requests", "tokens", "cost"

@dataclass
class QuotaUsage:
    """Track quota usage"""
    quota: Quota
    used: int = 0
    period_start: datetime = field(default_factory=datetime.now)

    def is_exceeded(self) -> bool:
        return self.used >= self.quota.limit

    def remaining(self) -> int:
        return max(0, self.quota.limit - self.used)

    def percentage_used(self) -> float:
        return (self.used / self.quota.limit) * 100

class QuotaManager:
    """Manage quotas for different entities"""

    def __init__(self):
        self.quotas: Dict[str, Quota] = {}
        self.usage: Dict[str, Dict[str, QuotaUsage]] = {}  # entity_id -> quota_name -> usage
        self._lock = threading.Lock()

    def define_quota(self, quota: Quota):
        """Define a new quota"""
        self.quotas[quota.name] = quota

    def get_usage(self, entity_id: str, quota_name: str) -> Optional[QuotaUsage]:
        """Get current usage for an entity"""
        with self._lock:
            if entity_id not in self.usage:
                return None
            return self.usage[entity_id].get(quota_name)

    def check_quota(self, entity_id: str, quota_name: str, amount: int = 1) -> tuple[bool, str]:
        """Check if quota allows the request"""
        with self._lock:
            if quota_name not in self.quotas:
                return True, "No quota defined"

            quota = self.quotas[quota_name]

            if entity_id not in self.usage:
                self.usage[entity_id] = {}

            if quota_name not in self.usage[entity_id]:
                self.usage[entity_id][quota_name] = QuotaUsage(quota=quota)

            usage = self.usage[entity_id][quota_name]

            # Check if period needs reset
            self._maybe_reset_period(usage)

            if usage.used + amount > quota.limit:
                return False, f"Quota exceeded: {usage.used}/{quota.limit} {quota.resource_type}"

            return True, f"Quota available: {usage.remaining()} remaining"

    def consume(self, entity_id: str, quota_name: str, amount: int = 1):
        """Consume quota"""
        with self._lock:
            if entity_id not in self.usage or quota_name not in self.usage[entity_id]:
                self.check_quota(entity_id, quota_name, 0)  # Initialize

            usage = self.usage[entity_id][quota_name]
            self._maybe_reset_period(usage)
            usage.used += amount

    def _maybe_reset_period(self, usage: QuotaUsage):
        """Reset usage if period has elapsed"""
        now = datetime.now()
        period = usage.quota.period

        should_reset = False
        if period == QuotaPeriod.HOURLY:
            should_reset = (now - usage.period_start) > timedelta(hours=1)
        elif period == QuotaPeriod.DAILY:
            should_reset = (now - usage.period_start) > timedelta(days=1)
        elif period == QuotaPeriod.WEEKLY:
            should_reset = (now - usage.period_start) > timedelta(weeks=1)
        elif period == QuotaPeriod.MONTHLY:
            should_reset = (now - usage.period_start) > timedelta(days=30)

        if should_reset:
            usage.used = 0
            usage.period_start = now

    def get_all_usage(self, entity_id: str) -> Dict[str, dict]:
        """Get all quota usage for an entity"""
        with self._lock:
            if entity_id not in self.usage:
                return {}

            return {
                name: {
                    "used": u.used,
                    "limit": u.quota.limit,
                    "remaining": u.remaining(),
                    "percentage": u.percentage_used(),
                    "period": u.quota.period.value
                }
                for name, u in self.usage[entity_id].items()
            }

# Usage
quota_manager = QuotaManager()

# Define quotas
quota_manager.define_quota(Quota(
    name="daily_requests",
    limit=1000,
    period=QuotaPeriod.DAILY,
    resource_type="requests"
))

quota_manager.define_quota(Quota(
    name="daily_tokens",
    limit=1_000_000,
    period=QuotaPeriod.DAILY,
    resource_type="tokens"
))

quota_manager.define_quota(Quota(
    name="monthly_cost",
    limit=10000,  # $100 in cents
    period=QuotaPeriod.MONTHLY,
    resource_type="cost"
))
```

## User-Level Quotas

```python
@dataclass
class UserTier:
    """User tier with associated quotas"""
    name: str
    daily_requests: int
    daily_tokens: int
    monthly_cost_cents: int
    max_tokens_per_request: int
    allowed_models: list

USER_TIERS = {
    "free": UserTier(
        name="free",
        daily_requests=50,
        daily_tokens=50_000,
        monthly_cost_cents=0,  # Covered by platform
        max_tokens_per_request=1000,
        allowed_models=["gpt-4o-mini"]
    ),
    "basic": UserTier(
        name="basic",
        daily_requests=500,
        daily_tokens=500_000,
        monthly_cost_cents=2000,  # $20
        max_tokens_per_request=4000,
        allowed_models=["gpt-4o-mini", "gpt-4o"]
    ),
    "pro": UserTier(
        name="pro",
        daily_requests=5000,
        daily_tokens=5_000_000,
        monthly_cost_cents=10000,  # $100
        max_tokens_per_request=8000,
        allowed_models=["gpt-4o-mini", "gpt-4o", "o1-preview"]
    )
}

class UserQuotaManager:
    """Manage quotas per user"""

    def __init__(self):
        self.quota_manager = QuotaManager()
        self.user_tiers: Dict[str, str] = {}  # user_id -> tier_name

    def set_user_tier(self, user_id: str, tier_name: str):
        """Set user's tier"""
        if tier_name not in USER_TIERS:
            raise ValueError(f"Unknown tier: {tier_name}")

        self.user_tiers[user_id] = tier_name
        tier = USER_TIERS[tier_name]

        # Define user's quotas based on tier
        self.quota_manager.define_quota(Quota(
            name=f"{user_id}_daily_requests",
            limit=tier.daily_requests,
            period=QuotaPeriod.DAILY,
            resource_type="requests"
        ))

        self.quota_manager.define_quota(Quota(
            name=f"{user_id}_daily_tokens",
            limit=tier.daily_tokens,
            period=QuotaPeriod.DAILY,
            resource_type="tokens"
        ))

    def check_request(self, user_id: str, model: str,
                     estimated_tokens: int) -> tuple[bool, str]:
        """Check if user can make request"""

        tier_name = self.user_tiers.get(user_id, "free")
        tier = USER_TIERS[tier_name]

        # Check model access
        if model not in tier.allowed_models:
            return False, f"Model {model} not available in {tier_name} tier"

        # Check token limit per request
        if estimated_tokens > tier.max_tokens_per_request:
            return False, f"Request exceeds max tokens ({tier.max_tokens_per_request})"

        # Check daily request quota
        allowed, msg = self.quota_manager.check_quota(
            user_id, f"{user_id}_daily_requests"
        )
        if not allowed:
            return False, msg

        # Check daily token quota
        allowed, msg = self.quota_manager.check_quota(
            user_id, f"{user_id}_daily_tokens", estimated_tokens
        )
        if not allowed:
            return False, msg

        return True, "Request allowed"

    def record_usage(self, user_id: str, tokens_used: int, cost_cents: int):
        """Record usage after request"""
        self.quota_manager.consume(user_id, f"{user_id}_daily_requests", 1)
        self.quota_manager.consume(user_id, f"{user_id}_daily_tokens", tokens_used)
```

## Quota Enforcement Middleware

```python
from functools import wraps

class QuotaExceededError(Exception):
    """Raised when quota is exceeded"""
    def __init__(self, message: str, quota_name: str, usage: dict):
        super().__init__(message)
        self.quota_name = quota_name
        self.usage = usage

def enforce_quota(user_quota_manager: UserQuotaManager):
    """Decorator to enforce quotas on API calls"""

    def decorator(func):
        @wraps(func)
        def wrapper(user_id: str, prompt: str, model: str = "gpt-4o", *args, **kwargs):
            # Estimate tokens
            estimated_tokens = len(prompt) // 4 + 1000

            # Check quota
            allowed, message = user_quota_manager.check_request(
                user_id, model, estimated_tokens
            )

            if not allowed:
                usage = user_quota_manager.quota_manager.get_all_usage(user_id)
                raise QuotaExceededError(message, "request", usage)

            # Execute
            result = func(user_id, prompt, model, *args, **kwargs)

            # Record usage (assuming result has token info)
            tokens_used = result.get("usage", {}).get("total_tokens", estimated_tokens)
            cost_cents = calculate_cost_cents(model, tokens_used)
            user_quota_manager.record_usage(user_id, tokens_used, cost_cents)

            return result

        return wrapper
    return decorator

# Usage
user_quota_mgr = UserQuotaManager()
user_quota_mgr.set_user_tier("user123", "basic")

@enforce_quota(user_quota_mgr)
def generate_response(user_id: str, prompt: str, model: str = "gpt-4o") -> dict:
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    return {
        "content": response.choices[0].message.content,
        "usage": response.usage.model_dump()
    }

# This will check quotas before execution
try:
    result = generate_response("user123", "Hello, world!")
except QuotaExceededError as e:
    print(f"Quota exceeded: {e}")
    print(f"Current usage: {e.usage}")
```

## Quota Alerts

```python
class QuotaAlertManager:
    """Send alerts when quotas are approaching limits"""

    def __init__(self, quota_manager: QuotaManager):
        self.quota_manager = quota_manager
        self.alert_thresholds = [0.5, 0.75, 0.9, 1.0]  # 50%, 75%, 90%, 100%
        self.sent_alerts: Dict[str, set] = {}  # entity_id -> set of sent threshold percentages

    def check_and_alert(self, entity_id: str, quota_name: str) -> Optional[dict]:
        """Check quota and return alert if threshold crossed"""

        usage = self.quota_manager.get_usage(entity_id, quota_name)
        if not usage:
            return None

        percentage = usage.percentage_used() / 100

        # Initialize sent alerts for this entity
        key = f"{entity_id}:{quota_name}"
        if key not in self.sent_alerts:
            self.sent_alerts[key] = set()

        for threshold in self.alert_thresholds:
            if percentage >= threshold and threshold not in self.sent_alerts[key]:
                self.sent_alerts[key].add(threshold)

                return {
                    "entity_id": entity_id,
                    "quota_name": quota_name,
                    "threshold": threshold,
                    "current_percentage": percentage * 100,
                    "used": usage.used,
                    "limit": usage.quota.limit,
                    "remaining": usage.remaining(),
                    "severity": self._get_severity(threshold)
                }

        return None

    def _get_severity(self, threshold: float) -> str:
        if threshold >= 1.0:
            return "critical"
        elif threshold >= 0.9:
            return "warning"
        elif threshold >= 0.75:
            return "notice"
        else:
            return "info"

    def reset_alerts(self, entity_id: str, quota_name: str):
        """Reset alerts when period resets"""
        key = f"{entity_id}:{quota_name}"
        if key in self.sent_alerts:
            self.sent_alerts[key].clear()

# Integration with notification system
async def notify_quota_alert(alert: dict):
    """Send notification for quota alert"""
    if alert["severity"] == "critical":
        # Send immediate alert
        await send_email(
            to=get_admin_email(),
            subject=f"CRITICAL: Quota exceeded for {alert['entity_id']}",
            body=f"Quota {alert['quota_name']} has reached {alert['current_percentage']:.1f}%"
        )
    elif alert["severity"] == "warning":
        # Send warning
        await send_slack_message(
            channel="#alerts",
            message=f"Warning: {alert['entity_id']} quota at {alert['current_percentage']:.1f}%"
        )
```

Effective quota management protects both your users and your budget. Implement quotas at multiple levels - per request, per user, and per organization - to maintain control over resource consumption.
