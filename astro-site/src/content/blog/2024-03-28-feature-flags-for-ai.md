---
title: "Feature Flags for AI: Controlling AI Rollouts"
author: "Michael John Peña"
draft: false
date: 2024-03-28
tags: ["AI", "Feature Flags", "MLOps", "DevOps", "Deployment"]

---

I wrote "Feature Flags for AI: Controlling AI Rollouts" to share practical, production-minded guidance on this topic.

Feature flags provide fine-grained control over AI features, enabling safe deployments, quick rollbacks, and targeted releases. This guide covers implementing feature flags for AI systems.

## Why Feature Flags for AI?

```python
from enum import Enum
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
import hashlib
import json

class AIFeatureFlagBenefits(Enum):
    GRADUAL_ROLLOUT = "Deploy new models to small percentage first"
    QUICK_ROLLBACK = "Instantly revert if issues detected"
    USER_TARGETING = "Enable for specific user segments"
    COST_CONTROL = "Limit expensive model usage"
    A_B_TESTING = "Compare model variants"
    KILL_SWITCH = "Disable AI features during outages"

@dataclass
class FeatureFlag:
    key: str
    name: str
    description: str
    enabled: bool
    targeting_rules: List[Dict]
    default_variant: str
    variants: Dict[str, Any]
    metadata: Dict = None
```

## Feature Flag Service Implementation

```python
from datetime import datetime
import random

class AIFeatureFlagService:
    """Feature flag service optimized for AI features"""

    def __init__(self):
        self.flags: Dict[str, FeatureFlag] = {}
        self.evaluation_log = []

    def create_flag(self, flag: FeatureFlag):
        """Create or update a feature flag"""
        self.flags[flag.key] = flag

    def evaluate(
        self,
        flag_key: str,
        user_context: Dict
    ) -> Dict:
        """Evaluate flag for user context"""

        if flag_key not in self.flags:
            return {"enabled": False, "variant": None, "reason": "flag_not_found"}

        flag = self.flags[flag_key]

        # Check if globally disabled
        if not flag.enabled:
            return {
                "enabled": False,
                "variant": None,
                "reason": "flag_disabled"
            }

        # Evaluate targeting rules
        for rule in flag.targeting_rules:
            if self._evaluate_rule(rule, user_context):
                variant = rule.get("variant", flag.default_variant)
                return {
                    "enabled": True,
                    "variant": variant,
                    "config": flag.variants.get(variant, {}),
                    "reason": f"rule_matched:{rule.get('name', 'unnamed')}"
                }

        # Default evaluation
        return {
            "enabled": True,
            "variant": flag.default_variant,
            "config": flag.variants.get(flag.default_variant, {}),
            "reason": "default"
        }

    def _evaluate_rule(self, rule: Dict, context: Dict) -> bool:
        """Evaluate a targeting rule"""

        rule_type = rule.get("type")

        if rule_type == "percentage":
            # Consistent hashing for percentage rollout
            user_id = context.get("user_id", str(random.random()))
            hash_val = int(hashlib.md5(user_id.encode()).hexdigest(), 16) % 100
            return hash_val < rule.get("percentage", 0)

        elif rule_type == "user_list":
            return context.get("user_id") in rule.get("users", [])

        elif rule_type == "attribute":
            attr_name = rule.get("attribute")
            operator = rule.get("operator")
            value = rule.get("value")

            user_value = context.get(attr_name)

            if operator == "equals":
                return user_value == value
            elif operator == "in":
                return user_value in value
            elif operator == "greater_than":
                return user_value > value
            elif operator == "less_than":
                return user_value < value

        elif rule_type == "time_based":
            now = datetime.now()
            start = datetime.fromisoformat(rule.get("start", "2000-01-01"))
            end = datetime.fromisoformat(rule.get("end", "2100-01-01"))
            return start <= now <= end

        return False

    def get_ai_config(
        self,
        flag_key: str,
        user_context: Dict
    ) -> Optional[Dict]:
        """Get AI configuration from feature flag"""
        result = self.evaluate(flag_key, user_context)

        if not result["enabled"]:
            return None

        return result.get("config", {})
```

## AI-Specific Feature Flags

```python
# Example: Model Selection Flag
model_selection_flag = FeatureFlag(
    key="ai-model-selection",
    name="AI Model Selection",
    description="Controls which AI model is used for chat",
    enabled=True,
    targeting_rules=[
        {
            "name": "premium_users",
            "type": "attribute",
            "attribute": "subscription_tier",
            "operator": "equals",
            "value": "premium",
            "variant": "opus"
        },
        {
            "name": "beta_testers",
            "type": "user_list",
            "users": ["user123", "user456"],
            "variant": "opus"
        },
        {
            "name": "gradual_rollout",
            "type": "percentage",
            "percentage": 10,
            "variant": "sonnet"
        }
    ],
    default_variant="haiku",
    variants={
        "opus": {
            "model_id": "claude-3-opus-20240229",
            "max_tokens": 2000,
            "temperature": 0.7
        },
        "sonnet": {
            "model_id": "claude-3-sonnet-20240229",
            "max_tokens": 1500,
            "temperature": 0.7
        },
        "haiku": {
            "model_id": "claude-3-haiku-20240307",
            "max_tokens": 1000,
            "temperature": 0.7
        }
    }
)

# Example: Prompt Version Flag
prompt_version_flag = FeatureFlag(
    key="ai-prompt-version",
    name="AI Prompt Version",
    description="Controls which prompt template version to use",
    enabled=True,
    targeting_rules=[
        {
            "name": "a_b_test",
            "type": "percentage",
            "percentage": 50,
            "variant": "v2"
        }
    ],
    default_variant="v1",
    variants={
        "v1": {
            "system_prompt": "You are a helpful assistant.",
            "temperature": 0.7
        },
        "v2": {
            "system_prompt": "You are a knowledgeable and friendly assistant. Be concise.",
            "temperature": 0.5
        }
    }
)

# Example: AI Feature Kill Switch
ai_kill_switch = FeatureFlag(
    key="ai-enabled",
    name="AI Feature Kill Switch",
    description="Emergency switch to disable all AI features",
    enabled=True,  # Set to False to disable all AI
    targeting_rules=[],
    default_variant="enabled",
    variants={
        "enabled": {"ai_active": True},
        "disabled": {"ai_active": False}
    }
)
```

## Integration with AI Service

```python
import anthropic

class FeatureFlaggedAIService:
    """AI service with feature flag integration"""

    def __init__(self, flag_service: AIFeatureFlagService):
        self.flags = flag_service
        self.client = anthropic.Anthropic()

    def get_response(
        self,
        user_id: str,
        user_context: Dict,
        message: str
    ) -> Optional[str]:
        """Get AI response with feature flag evaluation"""

        # Check kill switch
        kill_switch = self.flags.evaluate(
            "ai-enabled",
            {"user_id": user_id, **user_context}
        )

        if not kill_switch.get("enabled") or not kill_switch.get("config", {}).get("ai_active", True):
            return self._fallback_response(message)

        # Get model configuration
        model_config = self.flags.get_ai_config(
            "ai-model-selection",
            {"user_id": user_id, **user_context}
        )

        # Get prompt configuration
        prompt_config = self.flags.get_ai_config(
            "ai-prompt-version",
            {"user_id": user_id, **user_context}
        )

        # Make API call with feature-flagged config
        response = self.client.messages.create(
            model=model_config["model_id"],
            max_tokens=model_config["max_tokens"],
            temperature=prompt_config.get("temperature", 0.7),
            system=prompt_config["system_prompt"],
            messages=[{"role": "user", "content": message}]
        )

        return response.content[0].text

    def _fallback_response(self, message: str) -> str:
        """Fallback when AI is disabled"""
        return "I'm currently unavailable. Please try again later."
```

## Cost Control with Feature Flags

```python
class CostControlledAIService:
    """AI service with cost controls via feature flags"""

    def __init__(self, flag_service: AIFeatureFlagService):
        self.flags = flag_service
        self.client = anthropic.Anthropic()
        self.usage_tracker = {}

    def get_response(
        self,
        user_id: str,
        user_context: Dict,
        message: str
    ) -> str:
        # Get cost tier for user
        cost_config = self.flags.get_ai_config(
            "ai-cost-tier",
            {"user_id": user_id, **user_context}
        )

        # Check usage limits
        if self._exceeded_limit(user_id, cost_config):
            return self._limit_exceeded_response(cost_config)

        # Select model based on remaining budget
        model = self._select_model_for_budget(user_id, cost_config)

        response = self.client.messages.create(
            model=model["id"],
            max_tokens=model["max_tokens"],
            messages=[{"role": "user", "content": message}]
        )

        # Track usage
        self._track_usage(user_id, response.usage)

        return response.content[0].text

    def _exceeded_limit(self, user_id: str, config: Dict) -> bool:
        daily_limit = config.get("daily_token_limit", float("inf"))
        current_usage = self.usage_tracker.get(user_id, {}).get("tokens", 0)
        return current_usage >= daily_limit

    def _select_model_for_budget(self, user_id: str, config: Dict) -> Dict:
        # Downgrade model if approaching limit
        remaining = config.get("daily_token_limit", float("inf")) - \
                   self.usage_tracker.get(user_id, {}).get("tokens", 0)

        if remaining < 1000:
            return {"id": "claude-3-haiku-20240307", "max_tokens": 200}
        elif remaining < 5000:
            return {"id": "claude-3-haiku-20240307", "max_tokens": 500}
        else:
            return {"id": config.get("model", "claude-3-sonnet-20240229"),
                    "max_tokens": config.get("max_tokens", 1000)}

    def _track_usage(self, user_id: str, usage):
        if user_id not in self.usage_tracker:
            self.usage_tracker[user_id] = {"tokens": 0}
        self.usage_tracker[user_id]["tokens"] += usage.input_tokens + usage.output_tokens

    def _limit_exceeded_response(self, config: Dict) -> str:
        return f"You've reached your daily AI usage limit. Limit resets at midnight."
```

## Best Practices

```python
FEATURE_FLAG_BEST_PRACTICES = {
    "naming": "Use consistent naming: ai-{feature}-{aspect}",
    "defaults": "Default to safe/cheap variant",
    "monitoring": "Log all flag evaluations",
    "cleanup": "Remove flags after full rollout",
    "documentation": "Document each flag's purpose",
    "testing": "Test all variants in staging",
    "gradual": "Use percentage rollouts for new models"
}
```

## Conclusion

Feature flags provide essential control over AI deployments. Use them for gradual rollouts, A/B testing, cost control, and emergency shutoffs. Integrate feature flag evaluation into your AI service layer for maximum flexibility.

