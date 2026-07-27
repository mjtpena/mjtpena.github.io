---
title: "Data Loss Prevention in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-26
tags:
  - Microsoft Fabric
  - Data Loss Prevention
  - DLP
  - Security
  - Compliance
---

Data Loss Prevention (DLP) helps prevent accidental data exposure and ensures compliance. Today I'm exploring DLP implementation in Microsoft Fabric.

## DLP Overview

```
DLP Protection Layers:
├── Content Inspection
│   ├── Sensitive Info Types
│   ├── Keywords
│   ├── Regular Expressions
│   └── Trainable Classifiers
├── Policy Actions
│   ├── Block
│   ├── Warn
│   ├── Encrypt
│   └── Audit
├── Coverage
│   ├── Lakehouses
│   ├── Warehouses
│   ├── Datasets
│   ├── Reports
│   └── Dataflows
└── Notifications
    ├── User Tips
    ├── Admin Alerts
    └── Incident Reports
```

## DLP Policy Configuration

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum

class PolicyAction(Enum):
    AUDIT = "audit"
    WARN = "warn"
    BLOCK = "block"
    ENCRYPT = "encrypt"

class PolicyScope(Enum):
    ALL_WORKSPACES = "all"
    SPECIFIC_WORKSPACES = "specific"
    EXCLUDE_WORKSPACES = "exclude"

@dataclass
class DLPCondition:
    condition_type: str  # sensitiveInfoType, keyword, regex
    value: str
    min_count: int = 1
    min_confidence: int = 75

@dataclass
class DLPPolicy:
    name: str
    description: str
    conditions: List[DLPCondition]
    actions: List[PolicyAction]
    scope: PolicyScope
    workspaces: List[str] = field(default_factory=list)
    enabled: bool = True
    priority: int = 0

class DLPPolicyManager:
    """Manage DLP policies in Fabric."""

    def __init__(self, purview_client, fabric_client):
        self.purview = purview_client
        self.fabric = fabric_client

    def create_policy(self, policy: DLPPolicy) -> dict:
        """Create a new DLP policy."""
        policy_config = {
            "name": policy.name,
            "description": policy.description,
            "enabled": policy.enabled,
            "priority": policy.priority,
            "conditions": self._build_conditions(policy.conditions),
            "actions": [a.value for a in policy.actions],
            "scope": self._build_scope(policy.scope, policy.workspaces)
        }

        return self.purview.dlp_policies.create(policy_config)

    def _build_conditions(self, conditions: List[DLPCondition]) -> dict:
        """Build condition configuration."""
        condition_groups = {
            "sensitiveInfoTypes": [],
            "keywords": [],
            "regexPatterns": []
        }

        for condition in conditions:
            if condition.condition_type == "sensitiveInfoType":
                condition_groups["sensitiveInfoTypes"].append({
                    "id": condition.value,
                    "minCount": condition.min_count,
                    "minConfidence": condition.min_confidence
                })
            elif condition.condition_type == "keyword":
                condition_groups["keywords"].append(condition.value)
            elif condition.condition_type == "regex":
                condition_groups["regexPatterns"].append({
                    "pattern": condition.value,
                    "minCount": condition.min_count
                })

        return condition_groups

    def _build_scope(self, scope: PolicyScope, workspaces: List[str]) -> dict:
        """Build scope configuration."""
        if scope == PolicyScope.ALL_WORKSPACES:
            return {"type": "all", "locations": ["MicrosoftFabric"]}
        elif scope == PolicyScope.SPECIFIC_WORKSPACES:
            return {
                "type": "include",
                "locations": ["MicrosoftFabric"],
                "workspaces": workspaces
            }
        else:
            return {
                "type": "exclude",
                "locations": ["MicrosoftFabric"],
                "excludedWorkspaces": workspaces
            }

    def update_policy(self, policy_id: str, updates: dict) -> dict:
        """Update an existing policy."""
        return self.purview.dlp_policies.update(policy_id, updates)

    def list_policies(self) -> List[dict]:
        """List all DLP policies."""
        return self.purview.dlp_policies.list(
            filter="locations/any(l: l eq 'MicrosoftFabric')"
        )

    def test_policy(
        self,
        policy_id: str,
        content: str,
        content_type: str = "text"
    ) -> dict:
        """Test a policy against sample content."""
        return self.purview.dlp_policies.evaluate(
            policy_id=policy_id,
            content=content,
            content_type=content_type
        )

# Usage
dlp_mgr = DLPPolicyManager(purview_client, fabric_client)

# Create PII protection policy
pii_policy = DLPPolicy(
    name="Fabric-PII-Protection",
    description="Protect personally identifiable information in Fabric",
    conditions=[
        DLPCondition(
            condition_type="sensitiveInfoType",
            value="U.S. Social Security Number (SSN)",
            min_count=1,
            min_confidence=85
        ),
        DLPCondition(
            condition_type="sensitiveInfoType",
            value="Credit Card Number",
            min_count=1,
            min_confidence=85
        ),
        DLPCondition(
            condition_type="sensitiveInfoType",
            value="U.S. Individual Taxpayer Identification Number (ITIN)",
            min_count=1,
            min_confidence=85
        )
    ],
    actions=[PolicyAction.WARN, PolicyAction.AUDIT],
    scope=PolicyScope.ALL_WORKSPACES,
    priority=1
)

dlp_mgr.create_policy(pii_policy)
```

## Sensitive Information Types

```python
class SensitiveInfoTypeManager:
    """Manage custom sensitive information types."""

    def __init__(self, purview_client):
        self.purview = purview_client

    def create_custom_sit(
        self,
        name: str,
        description: str,
        patterns: List[dict],
        keywords: List[str] = None
    ):
        """Create a custom sensitive information type."""
        sit_config = {
            "name": name,
            "description": description,
            "patterns": []
        }

        for pattern in patterns:
            sit_config["patterns"].append({
                "confidenceLevel": pattern.get("confidence", "high"),
                "pattern": pattern["regex"],
                "supportingElements": pattern.get("validators", [])
            })

        if keywords:
            sit_config["keywords"] = {
                "keywordGroups": [{
                    "keywords": keywords,
                    "matchType": "word"
                }]
            }

        return self.purview.sensitive_info_types.create(sit_config)

    def get_built_in_types(self) -> List[dict]:
        """Get all built-in sensitive information types."""
        return self.purview.sensitive_info_types.list(
            filter="isBuiltIn eq true"
        )

# Usage
sit_mgr = SensitiveInfoTypeManager(purview_client)

# Create custom SIT for employee IDs
sit_mgr.create_custom_sit(
    name="Company Employee ID",
    description="Matches company employee ID format EMP-XXXXX",
    patterns=[{
        "regex": r"EMP-[0-9]{5}",
        "confidence": "high",
        "validators": ["checksum_validator"]
    }],
    keywords=["employee", "emp id", "staff number"]
)

# Create custom SIT for internal project codes
sit_mgr.create_custom_sit(
    name="Internal Project Code",
    description="Matches internal project codes",
    patterns=[{
        "regex": r"PRJ-[A-Z]{2}-[0-9]{4}",
        "confidence": "high"
    }]
)
```

## Policy Rules and Actions

```python
class DLPRuleEngine:
    """Define and manage DLP rules."""

    def __init__(self, purview_client):
        self.purview = purview_client

    def create_rule(
        self,
        policy_id: str,
        rule_name: str,
        conditions: dict,
        actions: dict,
        exceptions: dict = None
    ):
        """Create a rule within a policy."""
        rule_config = {
            "name": rule_name,
            "conditions": conditions,
            "actions": actions
        }

        if exceptions:
            rule_config["exceptions"] = exceptions

        return self.purview.dlp_policies.add_rule(policy_id, rule_config)

    def create_tiered_rules(self, policy_id: str, sensitive_types: List[str]):
        """Create tiered rules based on data volume."""
        # Low volume - just audit
        self.create_rule(
            policy_id=policy_id,
            rule_name="Low-Volume-Audit",
            conditions={
                "sensitiveInfoTypes": sensitive_types,
                "minCount": 1,
                "maxCount": 10
            },
            actions={
                "audit": True,
                "notifyUser": False,
                "notifyAdmin": False
            }
        )

        # Medium volume - warn user
        self.create_rule(
            policy_id=policy_id,
            rule_name="Medium-Volume-Warn",
            conditions={
                "sensitiveInfoTypes": sensitive_types,
                "minCount": 11,
                "maxCount": 100
            },
            actions={
                "audit": True,
                "notifyUser": True,
                "userNotificationMessage": "This content contains sensitive data. Please review before sharing.",
                "notifyAdmin": False
            }
        )

        # High volume - block and notify
        self.create_rule(
            policy_id=policy_id,
            rule_name="High-Volume-Block",
            conditions={
                "sensitiveInfoTypes": sensitive_types,
                "minCount": 101
            },
            actions={
                "audit": True,
                "notifyUser": True,
                "blockAccess": True,
                "userNotificationMessage": "Access blocked: Large volume of sensitive data detected.",
                "notifyAdmin": True,
                "adminEmailRecipients": ["security@company.com"]
            }
        )

# Usage
rule_engine = DLPRuleEngine(purview_client)

# Create tiered rules for PII
rule_engine.create_tiered_rules(
    policy_id="fabric-pii-policy-id",
    sensitive_types=[
        "U.S. Social Security Number (SSN)",
        "Credit Card Number"
    ]
)
```

## DLP Monitoring and Alerts

```python
class DLPMonitor:
    """Monitor DLP policy matches and incidents."""

    def __init__(self, purview_client, log_analytics_client):
        self.purview = purview_client
        self.logs = log_analytics_client

    def get_policy_matches(
        self,
        policy_id: str = None,
        days: int = 7
    ) -> List[dict]:
        """Get DLP policy matches."""
        query = f"""
        DLPPolicyMatch
        | where TimeGenerated > ago({days}d)
        | where Application == "MicrosoftFabric"
        """

        if policy_id:
            query += f"| where PolicyId == '{policy_id}'"

        query += """
        | project
            TimeGenerated,
            PolicyName,
            RuleName,
            SensitiveInfoType,
            MatchCount,
            Action,
            UserId,
            ItemId,
            WorkspaceId
        | order by TimeGenerated desc
        """

        return self.logs.query(query)

    def get_incident_summary(self, days: int = 30) -> dict:
        """Get summary of DLP incidents."""
        matches = self.get_policy_matches(days=days)

        summary = {
            "total_incidents": len(matches),
            "by_policy": {},
            "by_action": {},
            "by_sensitive_type": {},
            "by_user": {},
            "trend": []
        }

        for match in matches:
            # By policy
            policy = match["PolicyName"]
            summary["by_policy"][policy] = summary["by_policy"].get(policy, 0) + 1

            # By action
            action = match["Action"]
            summary["by_action"][action] = summary["by_action"].get(action, 0) + 1

            # By sensitive type
            sit = match["SensitiveInfoType"]
            summary["by_sensitive_type"][sit] = summary["by_sensitive_type"].get(sit, 0) + 1

            # By user
            user = match["UserId"]
            summary["by_user"][user] = summary["by_user"].get(user, 0) + 1

        return summary

    def create_alert_rule(
        self,
        name: str,
        policy_id: str,
        threshold: int,
        window_minutes: int,
        recipients: List[str]
    ):
        """Create alert rule for policy violations."""
        return self.logs.create_alert(
            name=name,
            query=f"""
                DLPPolicyMatch
                | where PolicyId == '{policy_id}'
                | where TimeGenerated > ago({window_minutes}m)
                | summarize MatchCount = count()
                | where MatchCount >= {threshold}
            """,
            frequency_minutes=window_minutes,
            severity="high",
            action={
                "type": "email",
                "recipients": recipients
            }
        )

    def generate_compliance_report(self) -> dict:
        """Generate DLP compliance report."""
        policies = self.purview.dlp_policies.list(
            filter="locations/any(l: l eq 'MicrosoftFabric')"
        )

        report = {
            "generated_at": datetime.utcnow().isoformat(),
            "policies": [],
            "overall_compliance": 0
        }

        total_items = 0
        compliant_items = 0

        for policy in policies:
            matches = self.get_policy_matches(policy_id=policy["id"], days=30)
            blocked_count = len([m for m in matches if m["Action"] == "Block"])

            policy_report = {
                "policy_name": policy["name"],
                "enabled": policy["enabled"],
                "total_matches": len(matches),
                "blocked_count": blocked_count,
                "warned_count": len([m for m in matches if m["Action"] == "Warn"]),
                "audit_only_count": len([m for m in matches if m["Action"] == "Audit"]),
                "unique_users_affected": len(set(m["UserId"] for m in matches))
            }
            report["policies"].append(policy_report)

        return report

# Usage
monitor = DLPMonitor(purview_client, log_analytics_client)

# Get incident summary
summary = monitor.get_incident_summary(days=30)
print(f"Total DLP incidents: {summary['total_incidents']}")

# Create alert for high-volume violations
monitor.create_alert_rule(
    name="DLP-High-Volume-Alert",
    policy_id="fabric-pii-policy-id",
    threshold=50,
    window_minutes=60,
    recipients=["security-team@company.com"]
)

# Generate compliance report
report = monitor.generate_compliance_report()
```

## User Notifications

```python
class DLPNotificationManager:
    """Manage DLP user notifications."""

    def __init__(self, purview_client):
        self.purview = purview_client

    def configure_policy_tip(
        self,
        policy_id: str,
        message: str,
        learn_more_url: str = None
    ):
        """Configure policy tip shown to users."""
        tip_config = {
            "enabled": True,
            "message": message
        }

        if learn_more_url:
            tip_config["learnMoreUrl"] = learn_more_url

        return self.purview.dlp_policies.update(
            policy_id,
            {"userNotification": tip_config}
        )

    def configure_override_options(
        self,
        policy_id: str,
        allow_override: bool,
        require_justification: bool,
        require_approval: bool = False
    ):
        """Configure user override options."""
        override_config = {
            "allowOverride": allow_override,
            "requireJustification": require_justification,
            "requireApproval": require_approval
        }

        if require_approval:
            override_config["approvers"] = ["dlp-approvers@company.com"]

        return self.purview.dlp_policies.update(
            policy_id,
            {"overrideOptions": override_config}
        )

# Usage
notification_mgr = DLPNotificationManager(purview_client)

# Configure user-friendly policy tip
notification_mgr.configure_policy_tip(
    policy_id="fabric-pii-policy-id",
    message="This data contains sensitive personal information. Please ensure you have authorization to access and share this data.",
    learn_more_url="https://company.com/data-handling-policy"
)

# Allow override with justification
notification_mgr.configure_override_options(
    policy_id="fabric-pii-policy-id",
    allow_override=True,
    require_justification=True,
    require_approval=False
)
```

## Best Practices

1. **Start with audit mode** - Understand data flows before blocking
2. **Tier your policies** - Different actions for different severity
3. **Customize notifications** - Clear, actionable messages
4. **Monitor false positives** - Tune policies based on data
5. **Combine with labels** - DLP and sensitivity labels together

## What's Next

Tomorrow I'll cover conditional access policies for Fabric.

## Resources

- [DLP in Fabric](https://learn.microsoft.com/fabric/governance/data-loss-prevention)
- [Microsoft Purview DLP](https://learn.microsoft.com/purview/dlp-learn-about-dlp)
- [Sensitive Information Types](https://learn.microsoft.com/purview/sensitive-information-type-learn-about)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
