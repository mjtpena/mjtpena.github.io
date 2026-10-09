---
title: "Agent Safety Patterns: Building Trustworthy AI Systems"
description: "Safety in AI agents is not optional - it's foundational. Build safety in from the start, and your agents will be both powerful and trustworthy."
author: "Michael John Peña"
draft: false
date: 2024-10-07
tags: ["AI Safety", "Agents", "Security", "Best Practices", "Production"]
---

## Safety Architecture

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from enum import Enum
import logging

logger = logging.getLogger(__name__)

class RiskLevel(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

@dataclass
class Action:
    """Represents an action an agent wants to take"""
    type: str
    parameters: Dict[str, Any]
    description: str
    risk_level: RiskLevel = RiskLevel.LOW

@dataclass
class SafetyDecision:
    """Decision from safety check"""
    allowed: bool
    reason: str
    modifications: Optional[Dict] = None
    require_confirmation: bool = False

class SafetyGuard(ABC):
    """Base class for safety guards"""

    @abstractmethod
    def check(self, action: Action, context: Dict) -> SafetyDecision:
        """Check if an action is safe"""
        pass

class SafetyPipeline:
    """Pipeline of safety checks"""

    def __init__(self):
        self.guards: List[SafetyGuard] = []
        self.audit_log: List[Dict] = []

    def add_guard(self, guard: SafetyGuard):
        """Add a safety guard to the pipeline"""
        self.guards.append(guard)
        return self

    def check_action(self, action: Action, context: Dict) -> SafetyDecision:
        """Run action through all safety guards"""

        for guard in self.guards:
            decision = guard.check(action, context)

            # Log the check
            self.audit_log.append({
                "action": action.type,
                "guard": guard.__class__.__name__,
                "allowed": decision.allowed,
                "reason": decision.reason
            })

            if not decision.allowed:
                logger.warning(f"Action blocked by {guard.__class__.__name__}: {decision.reason}")
                return decision

        return SafetyDecision(allowed=True, reason="Passed all checks")
```

## Common Safety Guards

```python
class PermissionGuard(SafetyGuard):
    """Check if agent has permission for action"""

    def __init__(self, permissions: Dict[str, List[str]]):
        self.permissions = permissions

    def check(self, action: Action, context: Dict) -> SafetyDecision:
        agent_id = context.get("agent_id")
        allowed_actions = self.permissions.get(agent_id, [])

        if action.type in allowed_actions or "*" in allowed_actions:
            return SafetyDecision(allowed=True, reason="Permission granted")

        return SafetyDecision(
            allowed=False,
            reason=f"Agent {agent_id} not permitted to perform {action.type}"
        )

class RateLimitGuard(SafetyGuard):
    """Prevent rapid action execution"""

    def __init__(self, max_actions_per_minute: int = 10):
        self.max_per_minute = max_actions_per_minute
        self.action_times: List[float] = []

    def check(self, action: Action, context: Dict) -> SafetyDecision:
        import time
        now = time.time()
        minute_ago = now - 60

        # Clean old entries
        self.action_times = [t for t in self.action_times if t > minute_ago]

        if len(self.action_times) >= self.max_per_minute:
            return SafetyDecision(
                allowed=False,
                reason=f"Rate limit exceeded: {self.max_per_minute}/minute"
            )

        self.action_times.append(now)
        return SafetyDecision(allowed=True, reason="Within rate limit")

class RiskLevelGuard(SafetyGuard):
    """Block high-risk actions without confirmation"""

    def __init__(self, max_auto_risk: RiskLevel = RiskLevel.MEDIUM):
        self.max_auto_risk = max_auto_risk

    def check(self, action: Action, context: Dict) -> SafetyDecision:
        if action.risk_level.value <= self.max_auto_risk.value:
            return SafetyDecision(allowed=True, reason="Risk level acceptable")

        if context.get("user_confirmed"):
            return SafetyDecision(allowed=True, reason="User confirmed high-risk action")

        return SafetyDecision(
            allowed=False,
            reason=f"Action risk level {action.risk_level.name} requires confirmation",
            require_confirmation=True
        )

class ResourceGuard(SafetyGuard):
    """Prevent excessive resource consumption"""

    def __init__(self, limits: Dict[str, int]):
        self.limits = limits
        self.usage: Dict[str, int] = {}

    def check(self, action: Action, context: Dict) -> SafetyDecision:
        resource = action.parameters.get("resource_type")
        amount = action.parameters.get("amount", 1)

        if resource in self.limits:
            current = self.usage.get(resource, 0)
            if current + amount > self.limits[resource]:
                return SafetyDecision(
                    allowed=False,
                    reason=f"Would exceed {resource} limit: {current + amount}/{self.limits[resource]}"
                )

            self.usage[resource] = current + amount

        return SafetyDecision(allowed=True, reason="Within resource limits")

class ContentGuard(SafetyGuard):
    """Filter dangerous content in actions"""

    BLOCKED_PATTERNS = [
        "rm -rf",
        "format c:",
        "drop table",
        "delete from",
        "shutdown",
        "; --",
        "<script>",
    ]

    def check(self, action: Action, context: Dict) -> SafetyDecision:
        # Check all string parameters for dangerous patterns
        for key, value in action.parameters.items():
            if isinstance(value, str):
                value_lower = value.lower()
                for pattern in self.BLOCKED_PATTERNS:
                    if pattern in value_lower:
                        return SafetyDecision(
                            allowed=False,
                            reason=f"Blocked pattern detected: {pattern}"
                        )

        return SafetyDecision(allowed=True, reason="No dangerous content detected")
```

## Human-in-the-Loop

```python
from typing import Callable

class HumanApprovalGuard(SafetyGuard):
    """Require human approval for certain actions"""

    def __init__(self,
                 requires_approval: List[str],
                 approval_callback: Callable[[Action], bool]):
        self.requires_approval = requires_approval
        self.approval_callback = approval_callback

    def check(self, action: Action, context: Dict) -> SafetyDecision:
        if action.type not in self.requires_approval:
            return SafetyDecision(allowed=True, reason="No approval required")

        # Request human approval
        approved = self.approval_callback(action)

        if approved:
            return SafetyDecision(allowed=True, reason="Human approved")
        else:
            return SafetyDecision(allowed=False, reason="Human rejected")

class ConfirmationManager:
    """Manage human confirmations for agent actions"""

    def __init__(self):
        self.pending_confirmations: Dict[str, Action] = {}

    def request_confirmation(self, action: Action, agent_id: str) -> str:
        """Request confirmation for an action"""
        import uuid
        confirmation_id = str(uuid.uuid4())

        self.pending_confirmations[confirmation_id] = {
            "action": action,
            "agent_id": agent_id,
            "requested_at": time.time()
        }

        # In production, this would send notification to human
        return confirmation_id

    def confirm(self, confirmation_id: str) -> bool:
        """Confirm a pending action"""
        if confirmation_id in self.pending_confirmations:
            del self.pending_confirmations[confirmation_id]
            return True
        return False

    def reject(self, confirmation_id: str) -> bool:
        """Reject a pending action"""
        if confirmation_id in self.pending_confirmations:
            del self.pending_confirmations[confirmation_id]
            return True
        return False

    def get_pending(self, agent_id: str = None) -> List[Dict]:
        """Get pending confirmations"""
        if agent_id:
            return [
                {"id": k, **v}
                for k, v in self.pending_confirmations.items()
                if v["agent_id"] == agent_id
            ]
        return [{"id": k, **v} for k, v in self.pending_confirmations.items()]
```

## Safe Agent Implementation

```python
class SafeAgent:
    """Agent with built-in safety"""

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.safety_pipeline = self._build_safety_pipeline()
        self.action_history: List[Dict] = []

    def _build_safety_pipeline(self) -> SafetyPipeline:
        """Build the safety pipeline"""
        pipeline = SafetyPipeline()

        # Add guards in order of importance
        pipeline.add_guard(ContentGuard())
        pipeline.add_guard(PermissionGuard({
            self.agent_id: ["read", "write", "execute"]
        }))
        pipeline.add_guard(RateLimitGuard(max_actions_per_minute=30))
        pipeline.add_guard(RiskLevelGuard(max_auto_risk=RiskLevel.MEDIUM))
        pipeline.add_guard(ResourceGuard({
            "api_calls": 1000,
            "file_writes": 100,
            "network_requests": 500
        }))

        return pipeline

    def execute(self, action: Action, context: Dict = None) -> Dict:
        """Execute an action with safety checks"""

        context = context or {}
        context["agent_id"] = self.agent_id

        # Run safety checks
        decision = self.safety_pipeline.check_action(action, context)

        if not decision.allowed:
            return {
                "success": False,
                "blocked": True,
                "reason": decision.reason,
                "require_confirmation": decision.require_confirmation
            }

        # Apply any modifications from safety checks
        if decision.modifications:
            action.parameters.update(decision.modifications)

        # Execute the action
        try:
            result = self._do_execute(action)

            self.action_history.append({
                "action": action.type,
                "success": True,
                "timestamp": time.time()
            })

            return {"success": True, "result": result}

        except Exception as e:
            self.action_history.append({
                "action": action.type,
                "success": False,
                "error": str(e),
                "timestamp": time.time()
            })

            return {"success": False, "error": str(e)}

    def _do_execute(self, action: Action) -> Any:
        """Actually execute the action (override in subclasses)"""
        raise NotImplementedError
```

## Monitoring and Alerting

```python
class SafetyMonitor:
    """Monitor agent safety metrics"""

    def __init__(self):
        self.blocked_actions = 0
        self.allowed_actions = 0
        self.alerts: List[Dict] = []

    def record_decision(self, action: Action, decision: SafetyDecision):
        """Record a safety decision"""
        if decision.allowed:
            self.allowed_actions += 1
        else:
            self.blocked_actions += 1

            # Alert on high-risk blocked actions
            if action.risk_level.value >= RiskLevel.HIGH.value:
                self._create_alert(action, decision)

    def _create_alert(self, action: Action, decision: SafetyDecision):
        """Create a safety alert"""
        alert = {
            "timestamp": time.time(),
            "action_type": action.type,
            "risk_level": action.risk_level.name,
            "reason": decision.reason,
            "severity": "high" if action.risk_level == RiskLevel.CRITICAL else "medium"
        }

        self.alerts.append(alert)
        logger.warning(f"Safety alert: {alert}")

    def get_metrics(self) -> Dict:
        """Get safety metrics"""
        total = self.allowed_actions + self.blocked_actions
        return {
            "total_actions": total,
            "allowed": self.allowed_actions,
            "blocked": self.blocked_actions,
            "block_rate": self.blocked_actions / total if total > 0 else 0,
            "recent_alerts": self.alerts[-10:]
        }
```

Safety in AI agents is not optional - it's foundational. Build safety in from the start, and your agents will be both powerful and trustworthy.
