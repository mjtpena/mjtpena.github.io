---
title: "Gradual Rollout Strategies for AI Features"
author: "Michael John Peña"
draft: false
date: 2024-03-29
tags: ["AI", "Deployment", "MLOps", "DevOps", "Risk Management"]

---

I wrote "Gradual Rollout Strategies for AI Features" to share practical, production-minded guidance on this topic.

Deploying AI features to production requires careful risk management. Gradual rollouts help identify issues early while minimizing blast radius.

## Rollout Strategies Overview

```python
from enum import Enum
from dataclasses import dataclass
from typing import List, Dict, Callable
from datetime import datetime, timedelta

class RolloutStrategy(Enum):
    PERCENTAGE = "percentage"  # Gradually increase traffic
    RING = "ring"  # Deploy to rings of users
    CANARY = "canary"  # Small test before full rollout
    BLUE_GREEN = "blue_green"  # Switch between versions
    SHADOW = "shadow"  # Run in parallel without affecting users

@dataclass
class RolloutStage:
    name: str
    percentage: float
    duration_hours: int
    success_criteria: Dict[str, float]
    auto_advance: bool = True

@dataclass
class RolloutPlan:
    feature_name: str
    strategy: RolloutStrategy
    stages: List[RolloutStage]
    rollback_criteria: Dict[str, float]
```

## Percentage-Based Rollout

```python
import hashlib
from datetime import datetime
import anthropic

class PercentageRollout:
    """Gradually increase traffic to new AI feature"""

    def __init__(self, plan: RolloutPlan):
        self.plan = plan
        self.current_stage_index = 0
        self.stage_start_time = datetime.now()
        self.metrics_collector = MetricsCollector()

    @property
    def current_stage(self) -> RolloutStage:
        return self.plan.stages[self.current_stage_index]

    def should_use_new_feature(self, user_id: str) -> bool:
        """Determine if user should get new feature"""
        # Consistent hashing
        hash_val = int(hashlib.md5(
            f"{self.plan.feature_name}:{user_id}".encode()
        ).hexdigest(), 16) % 100

        return hash_val < self.current_stage.percentage

    def check_and_advance(self):
        """Check if ready to advance to next stage"""
        if self.current_stage_index >= len(self.plan.stages) - 1:
            return  # Already at final stage

        # Check duration
        elapsed = datetime.now() - self.stage_start_time
        if elapsed < timedelta(hours=self.current_stage.duration_hours):
            return  # Not enough time

        # Check success criteria
        metrics = self.metrics_collector.get_current_metrics()
        if self._meets_criteria(metrics, self.current_stage.success_criteria):
            if self.current_stage.auto_advance:
                self.advance_stage()

    def _meets_criteria(self, metrics: Dict, criteria: Dict) -> bool:
        """Check if metrics meet success criteria"""
        for metric, threshold in criteria.items():
            if metrics.get(metric, 0) < threshold:
                return False
        return True

    def advance_stage(self):
        """Advance to next rollout stage"""
        self.current_stage_index += 1
        self.stage_start_time = datetime.now()
        print(f"Advanced to stage: {self.current_stage.name} "
              f"({self.current_stage.percentage}%)")

    def rollback(self):
        """Rollback to previous stage or disable"""
        if self.current_stage_index > 0:
            self.current_stage_index -= 1
            print(f"Rolled back to stage: {self.current_stage.name}")
        else:
            # Disable entirely
            self.plan.stages[0].percentage = 0
            print("Feature disabled - rollback complete")

# Example rollout plan
example_plan = RolloutPlan(
    feature_name="claude-3-opus-upgrade",
    strategy=RolloutStrategy.PERCENTAGE,
    stages=[
        RolloutStage(
            name="canary",
            percentage=1,
            duration_hours=24,
            success_criteria={"error_rate": 0.01, "latency_p99": 5000}
        ),
        RolloutStage(
            name="early_adopters",
            percentage=10,
            duration_hours=48,
            success_criteria={"error_rate": 0.01, "user_satisfaction": 0.8}
        ),
        RolloutStage(
            name="general_availability",
            percentage=50,
            duration_hours=72,
            success_criteria={"error_rate": 0.005, "user_satisfaction": 0.85}
        ),
        RolloutStage(
            name="full_rollout",
            percentage=100,
            duration_hours=0,
            success_criteria={},
            auto_advance=False
        )
    ],
    rollback_criteria={
        "error_rate": 0.05,
        "latency_p99": 10000
    }
)
```

## Ring-Based Deployment

```python
from typing import Set

@dataclass
class Ring:
    name: str
    user_ids: Set[str]
    percentage_of_total: float
    priority: int  # Lower = earlier

class RingDeployment:
    """Deploy to user rings (internal -> beta -> GA)"""

    def __init__(self, rings: List[Ring]):
        self.rings = sorted(rings, key=lambda r: r.priority)
        self.enabled_rings: Set[str] = set()
        self.client = anthropic.Anthropic()

    def enable_ring(self, ring_name: str):
        """Enable feature for a ring"""
        self.enabled_rings.add(ring_name)

    def disable_ring(self, ring_name: str):
        """Disable feature for a ring"""
        self.enabled_rings.discard(ring_name)

    def is_enabled_for_user(self, user_id: str) -> bool:
        """Check if feature is enabled for user"""
        for ring in self.rings:
            if ring.name in self.enabled_rings:
                if user_id in ring.user_ids:
                    return True
        return False

    def get_enabled_percentage(self) -> float:
        """Get total percentage of users with feature enabled"""
        total = 0
        for ring in self.rings:
            if ring.name in self.enabled_rings:
                total += ring.percentage_of_total
        return total

# Example rings
rings = [
    Ring(
        name="internal",
        user_ids={"employee1", "employee2", "employee3"},
        percentage_of_total=0.1,
        priority=1
    ),
    Ring(
        name="beta",
        user_ids={"beta_user1", "beta_user2"},  # Or use dynamic membership
        percentage_of_total=5.0,
        priority=2
    ),
    Ring(
        name="early_access",
        user_ids=set(),  # Typically based on signup or criteria
        percentage_of_total=20.0,
        priority=3
    ),
    Ring(
        name="general",
        user_ids=set(),  # All remaining users
        percentage_of_total=74.9,
        priority=4
    )
]

deployment = RingDeployment(rings)
deployment.enable_ring("internal")  # Start with internal users
```

## Shadow Deployment

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

class ShadowDeployment:
    """Run new model in shadow mode alongside production"""

    def __init__(self):
        self.client = anthropic.Anthropic()
        self.executor = ThreadPoolExecutor(max_workers=4)
        self.comparison_results = []

    async def process_with_shadow(
        self,
        message: str,
        production_model: str,
        shadow_model: str
    ) -> str:
        """Process request with both models, return production result"""

        # Production call (synchronous, user-facing)
        production_response = self.client.messages.create(
            model=production_model,
            max_tokens=1000,
            messages=[{"role": "user", "content": message}]
        )

        # Shadow call (async, non-blocking)
        asyncio.create_task(
            self._shadow_call(message, shadow_model, production_response)
        )

        return production_response.content[0].text

    async def _shadow_call(
        self,
        message: str,
        shadow_model: str,
        production_response
    ):
        """Make shadow call and compare results"""
        try:
            shadow_response = self.client.messages.create(
                model=shadow_model,
                max_tokens=1000,
                messages=[{"role": "user", "content": message}]
            )

            # Compare responses
            comparison = self._compare_responses(
                production_response.content[0].text,
                shadow_response.content[0].text
            )

            self.comparison_results.append({
                "message": message[:100],
                "production_model": production_response.model,
                "shadow_model": shadow_response.model,
                "comparison": comparison,
                "production_latency": production_response.usage.input_tokens,  # Simplified
                "shadow_latency": shadow_response.usage.input_tokens
            })

        except Exception as e:
            print(f"Shadow call failed: {e}")

    def _compare_responses(self, prod: str, shadow: str) -> Dict:
        """Compare production and shadow responses"""
        # Simplified comparison - use LLM for better comparison
        return {
            "length_diff": len(shadow) - len(prod),
            "word_overlap": len(set(prod.split()) & set(shadow.split())) /
                           len(set(prod.split()) | set(shadow.split())),
        }

    def get_shadow_report(self) -> Dict:
        """Generate report comparing shadow vs production"""
        if not self.comparison_results:
            return {"status": "no data"}

        import numpy as np

        overlaps = [r["comparison"]["word_overlap"] for r in self.comparison_results]

        return {
            "total_comparisons": len(self.comparison_results),
            "avg_word_overlap": np.mean(overlaps),
            "min_overlap": np.min(overlaps),
            "ready_for_promotion": np.mean(overlaps) > 0.7
        }
```

## Automated Rollout Controller

```python
class AutomatedRolloutController:
    """Automated rollout with health checks and auto-rollback"""

    def __init__(
        self,
        rollout: PercentageRollout,
        health_check_interval_seconds: int = 60
    ):
        self.rollout = rollout
        self.check_interval = health_check_interval_seconds
        self.running = False

    async def start(self):
        """Start automated rollout monitoring"""
        self.running = True

        while self.running:
            # Check health
            health = await self._check_health()

            if self._should_rollback(health):
                self.rollout.rollback()
                await self._alert("Rollback triggered", health)
            else:
                # Check for stage advancement
                self.rollout.check_and_advance()

            await asyncio.sleep(self.check_interval)

    async def _check_health(self) -> Dict:
        """Check system health metrics"""
        return {
            "error_rate": self.rollout.metrics_collector.get_error_rate(),
            "latency_p99": self.rollout.metrics_collector.get_latency_p99(),
            "user_satisfaction": self.rollout.metrics_collector.get_satisfaction()
        }

    def _should_rollback(self, health: Dict) -> bool:
        """Determine if rollback is needed"""
        for metric, threshold in self.rollout.plan.rollback_criteria.items():
            if metric in health and health[metric] > threshold:
                return True
        return False

    async def _alert(self, message: str, context: Dict):
        """Send alert"""
        print(f"ALERT: {message}")
        print(f"Context: {context}")
        # Implement actual alerting (Slack, PagerDuty, etc.)

    def stop(self):
        """Stop the controller"""
        self.running = False
```

## Conclusion

Gradual rollouts are essential for safe AI deployments. Combine percentage-based rollouts with automated health monitoring and quick rollback capabilities. Use shadow deployments to validate new models before any user exposure.

