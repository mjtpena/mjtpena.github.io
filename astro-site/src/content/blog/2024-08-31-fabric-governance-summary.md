---
title: "Microsoft Fabric Governance: A Complete Guide"
author: Michael John Peña
draft: false
date: 2024-08-31
tags:
  - Microsoft Fabric
  - Governance
  - Data Management
  - Best Practices
  - Enterprise
---

## Governance Framework Overview

```
Fabric Governance Framework:
┌─────────────────────────────────────────────────────────────┐
│                    GOVERNANCE PILLARS                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Access  │  │   Data   │  │   Cost   │  │ Lifecycle│    │
│  │  Control │  │  Quality │  │ Manage   │  │  Manage  │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │           │
│       └─────────────┴─────────────┴─────────────┘           │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │   Policies  │                          │
│                    │   & Rules   │                          │
│                    └──────┬──────┘                          │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │ Monitoring  │                          │
│                    │ & Reporting │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

## Governance Checklist

### Access Control

```python
access_control_checklist = {
    "workspace_governance": [
        {
            "item": "Workspace naming convention defined",
            "description": "Consistent naming pattern for workspaces",
            "example": "DEPT-PROJECT-ENV (e.g., SALES-ANALYTICS-PROD)"
        },
        {
            "item": "Workspace creation policy",
            "description": "Control who can create workspaces",
            "recommendation": "Require admin approval for new workspaces"
        },
        {
            "item": "Role assignments documented",
            "description": "Clear mapping of users/groups to workspace roles",
            "roles": ["Admin", "Member", "Contributor", "Viewer"]
        }
    ],
    "item_level_security": [
        {
            "item": "Semantic model RLS",
            "description": "Row-level security on sensitive data",
            "applies_to": "Power BI semantic models"
        },
        {
            "item": "Lakehouse access",
            "description": "OneLake RBAC for data access",
            "recommendation": "Principle of least privilege"
        }
    ],
    "external_sharing": [
        {
            "item": "External sharing policy",
            "description": "Rules for sharing with external users",
            "options": ["Disabled", "Admin-approved", "Enabled"]
        },
        {
            "item": "Guest user access",
            "description": "Azure AD B2B configuration"
        }
    ]
}

def generate_access_control_audit(current_state: dict) -> list:
    """Audit access control configuration."""

    findings = []

    for category, items in access_control_checklist.items():
        for item in items:
            item_name = item["item"]
            if not current_state.get(item_name, False):
                findings.append({
                    "category": category,
                    "item": item_name,
                    "status": "Missing/Incomplete",
                    "recommendation": item.get("recommendation", "Implement this control")
                })

    return findings
```

### Data Quality

```python
data_quality_framework = {
    "data_profiling": {
        "description": "Understand data characteristics",
        "activities": [
            "Column statistics (null counts, unique values)",
            "Data type validation",
            "Value distribution analysis"
        ],
        "tools": ["Spark notebooks", "Data Factory data flows"]
    },
    "data_validation": {
        "description": "Ensure data meets expectations",
        "rules": [
            "Schema validation",
            "Referential integrity",
            "Business rule validation",
            "Freshness checks"
        ],
        "implementation": "Great Expectations, custom Spark validators"
    },
    "data_lineage": {
        "description": "Track data origin and transformations",
        "features": [
            "Automatic lineage in Fabric",
            "Manual documentation for external sources",
            "Impact analysis for changes"
        ]
    },
    "data_catalog": {
        "description": "Document and discover data assets",
        "components": [
            "Business glossary",
            "Data dictionary",
            "Search and discovery"
        ],
        "tool": "Microsoft Purview integration"
    }
}

class DataQualityMonitor:
    """Monitor data quality metrics."""

    def __init__(self):
        self.quality_scores = {}

    def calculate_quality_score(
        self,
        table_name: str,
        completeness: float,
        accuracy: float,
        timeliness: float,
        consistency: float
    ) -> dict:
        """Calculate overall data quality score."""

        # Weighted average
        weights = {
            "completeness": 0.3,
            "accuracy": 0.3,
            "timeliness": 0.2,
            "consistency": 0.2
        }

        overall = (
            completeness * weights["completeness"] +
            accuracy * weights["accuracy"] +
            timeliness * weights["timeliness"] +
            consistency * weights["consistency"]
        )

        self.quality_scores[table_name] = {
            "completeness": completeness,
            "accuracy": accuracy,
            "timeliness": timeliness,
            "consistency": consistency,
            "overall": overall
        }

        return self.quality_scores[table_name]

    def get_quality_report(self) -> dict:
        """Generate quality report across all tables."""

        if not self.quality_scores:
            return {"message": "No quality data"}

        avg_overall = sum(
            s["overall"] for s in self.quality_scores.values()
        ) / len(self.quality_scores)

        below_threshold = [
            name for name, scores in self.quality_scores.items()
            if scores["overall"] < 0.8
        ]

        return {
            "tables_monitored": len(self.quality_scores),
            "average_quality_score": avg_overall,
            "tables_below_threshold": below_threshold,
            "details": self.quality_scores
        }
```

### Cost Governance

```python
cost_governance_framework = {
    "budgeting": {
        "description": "Set and track budgets",
        "levels": ["Organization", "Department", "Project", "Workspace"],
        "activities": [
            "Annual budget planning",
            "Monthly budget allocation",
            "Budget vs actual tracking"
        ]
    },
    "optimization": {
        "description": "Continuous cost optimization",
        "strategies": [
            "Right-sizing capacity",
            "Pause during off-hours",
            "Workload scheduling",
            "Storage optimization"
        ]
    },
    "chargeback": {
        "description": "Allocate costs to consumers",
        "models": [
            "Direct consumption",
            "Workspace-based",
            "Tiered pricing"
        ]
    },
    "monitoring": {
        "description": "Track and alert on costs",
        "metrics": [
            "Daily spend",
            "Cost trends",
            "Anomaly detection",
            "Budget utilization"
        ]
    }
}

class CostGovernanceScore:
    """Assess cost governance maturity."""

    def __init__(self):
        self.criteria = {
            "visibility": ["Cost dashboard", "Daily tracking", "Forecasting"],
            "allocation": ["Tagging", "Chargeback", "Showback"],
            "optimization": ["Right-sizing", "Scheduling", "Automation"],
            "governance": ["Budgets", "Policies", "Alerts"]
        }

    def assess(self, implemented: dict) -> dict:
        """Assess governance maturity."""

        scores = {}

        for category, items in self.criteria.items():
            implemented_count = sum(
                1 for item in items
                if implemented.get(item, False)
            )
            scores[category] = implemented_count / len(items) * 100

        overall = sum(scores.values()) / len(scores)

        maturity = (
            "Foundational" if overall < 40
            else "Intermediate" if overall < 70
            else "Advanced"
        )

        return {
            "scores": scores,
            "overall": overall,
            "maturity_level": maturity,
            "gaps": self._identify_gaps(implemented)
        }

    def _identify_gaps(self, implemented: dict) -> list:
        gaps = []
        for category, items in self.criteria.items():
            for item in items:
                if not implemented.get(item, False):
                    gaps.append({"category": category, "item": item})
        return gaps
```

### Lifecycle Management

```python
lifecycle_management = {
    "development": {
        "description": "Development environment standards",
        "practices": [
            "Isolated dev workspaces",
            "Sample data for testing",
            "Version control integration"
        ]
    },
    "deployment": {
        "description": "Promotion to production",
        "practices": [
            "Deployment pipelines",
            "Approval workflows",
            "Rollback procedures"
        ],
        "tool": "Fabric Git integration, Azure DevOps"
    },
    "operations": {
        "description": "Production operations",
        "practices": [
            "Monitoring and alerting",
            "Incident management",
            "Change management"
        ]
    },
    "retirement": {
        "description": "End-of-life management",
        "practices": [
            "Usage monitoring",
            "Archival policies",
            "Secure deletion"
        ]
    }
}

class LifecycleManager:
    """Manage item lifecycle."""

    def __init__(self):
        self.items = {}

    def register_item(
        self,
        item_id: str,
        name: str,
        item_type: str,
        owner: str,
        created_date: str
    ):
        """Register an item for lifecycle tracking."""

        self.items[item_id] = {
            "name": name,
            "type": item_type,
            "owner": owner,
            "created_date": created_date,
            "stage": "active",
            "last_activity": created_date
        }

    def update_activity(self, item_id: str, activity_date: str):
        """Update last activity date."""

        if item_id in self.items:
            self.items[item_id]["last_activity"] = activity_date

    def identify_stale_items(self, days_threshold: int = 90) -> list:
        """Find items without recent activity."""

        from datetime import datetime, timedelta

        cutoff = datetime.now() - timedelta(days=days_threshold)
        stale = []

        for item_id, item in self.items.items():
            last_activity = datetime.fromisoformat(item["last_activity"])
            if last_activity < cutoff:
                stale.append({
                    "item_id": item_id,
                    "name": item["name"],
                    "days_inactive": (datetime.now() - last_activity).days,
                    "recommendation": "Review for archival"
                })

        return stale

    def recommend_action(self, item_id: str) -> dict:
        """Recommend lifecycle action for item."""

        item = self.items.get(item_id)
        if not item:
            return {"error": "Item not found"}

        from datetime import datetime

        last_activity = datetime.fromisoformat(item["last_activity"])
        days_inactive = (datetime.now() - last_activity).days

        if days_inactive > 180:
            return {
                "item": item["name"],
                "recommendation": "Archive",
                "reason": f"No activity for {days_inactive} days"
            }
        elif days_inactive > 90:
            return {
                "item": item["name"],
                "recommendation": "Review",
                "reason": f"Limited activity ({days_inactive} days)"
            }
        else:
            return {
                "item": item["name"],
                "recommendation": "Maintain",
                "reason": "Recent activity"
            }
```

## Governance Implementation Plan

```python
class GovernanceImplementationPlan:
    """Create a governance implementation roadmap."""

    def __init__(self, organization_name: str):
        self.org_name = organization_name
        self.phases = []

    def create_plan(self) -> dict:
        """Create phased implementation plan."""

        return {
            "organization": self.org_name,
            "phases": [
                {
                    "phase": 1,
                    "name": "Foundation",
                    "duration": "Month 1-2",
                    "activities": [
                        "Define workspace naming convention",
                        "Establish admin group",
                        "Configure tenant settings",
                        "Set up basic monitoring"
                    ],
                    "deliverables": [
                        "Governance policy document",
                        "Admin runbook",
                        "Initial monitoring dashboard"
                    ]
                },
                {
                    "phase": 2,
                    "name": "Access & Security",
                    "duration": "Month 2-3",
                    "activities": [
                        "Implement workspace templates",
                        "Configure row-level security",
                        "Set up data classification",
                        "Enable audit logging"
                    ],
                    "deliverables": [
                        "Security configuration guide",
                        "RLS implementation for sensitive data",
                        "Classification taxonomy"
                    ]
                },
                {
                    "phase": 3,
                    "name": "Cost Management",
                    "duration": "Month 3-4",
                    "activities": [
                        "Implement cost tagging",
                        "Configure budget alerts",
                        "Set up chargeback reporting",
                        "Optimize capacity sizing"
                    ],
                    "deliverables": [
                        "Cost allocation model",
                        "Budget tracking dashboard",
                        "Optimization recommendations"
                    ]
                },
                {
                    "phase": 4,
                    "name": "Operations",
                    "duration": "Month 4-5",
                    "activities": [
                        "Implement deployment pipelines",
                        "Set up lifecycle management",
                        "Create operational runbooks",
                        "Establish change management"
                    ],
                    "deliverables": [
                        "CI/CD pipeline",
                        "Operations handbook",
                        "Change management process"
                    ]
                },
                {
                    "phase": 5,
                    "name": "Optimization",
                    "duration": "Month 5-6",
                    "activities": [
                        "Review and refine policies",
                        "Automate governance checks",
                        "Implement self-service guardrails",
                        "Establish governance review cadence"
                    ],
                    "deliverables": [
                        "Automated compliance checks",
                        "Self-service guidelines",
                        "Quarterly review process"
                    ]
                }
            ]
        }

    def generate_checklist(self, phase: int) -> list:
        """Generate checklist for specific phase."""

        plan = self.create_plan()
        phase_data = next(
            (p for p in plan["phases"] if p["phase"] == phase),
            None
        )

        if not phase_data:
            return []

        return [
            {"item": activity, "status": "pending"}
            for activity in phase_data["activities"]
        ]

# Usage
plan = GovernanceImplementationPlan("Contoso Corp")

implementation = plan.create_plan()
print("Governance Implementation Plan:")
for phase in implementation["phases"]:
    print(f"\n{phase['phase']}. {phase['name']} ({phase['duration']})")
    for activity in phase["activities"]:
        print(f"   - {activity}")
```

## Governance Metrics

```python
class GovernanceMetrics:
    """Track governance effectiveness."""

    def calculate_governance_scorecard(
        self,
        access_control_score: float,
        data_quality_score: float,
        cost_management_score: float,
        lifecycle_score: float
    ) -> dict:
        """Calculate overall governance scorecard."""

        overall = (
            access_control_score * 0.3 +
            data_quality_score * 0.25 +
            cost_management_score * 0.25 +
            lifecycle_score * 0.2
        )

        return {
            "scores": {
                "access_control": access_control_score,
                "data_quality": data_quality_score,
                "cost_management": cost_management_score,
                "lifecycle": lifecycle_score
            },
            "overall": overall,
            "grade": (
                "A" if overall >= 90
                else "B" if overall >= 80
                else "C" if overall >= 70
                else "D" if overall >= 60
                else "F"
            ),
            "areas_for_improvement": [
                area for area, score in {
                    "access_control": access_control_score,
                    "data_quality": data_quality_score,
                    "cost_management": cost_management_score,
                    "lifecycle": lifecycle_score
                }.items() if score < 70
            ]
        }

# Usage
metrics = GovernanceMetrics()

scorecard = metrics.calculate_governance_scorecard(
    access_control_score=85,
    data_quality_score=75,
    cost_management_score=80,
    lifecycle_score=65
)

print(f"Governance Grade: {scorecard['grade']} (Score: {scorecard['overall']:.0f})")
if scorecard["areas_for_improvement"]:
    print(f"Areas to improve: {', '.join(scorecard['areas_for_improvement'])}")
```

## Conclusion

Effective Microsoft Fabric governance requires attention to access control, data quality, cost management, and lifecycle management. This month's exploration has covered:

- **Capacity and Performance**: Understanding capacity models, optimization, autoscale, and smoothing/bursting
- **Cost Management**: FinOps practices, chargeback models, cost allocation, and usage reporting
- **Data Integration**: Mirroring, CDC, data virtualization, and cross-cloud analytics
- **Storage Optimization**: Delta Lake, Parquet optimization, file compaction, V-Order, and Z-Order

Implement governance incrementally, starting with foundational controls and building toward automated compliance. Regular reviews ensure your governance framework evolves with your organization's needs.

Remember: Good governance enables agility by providing guardrails that let teams move fast while staying safe.
