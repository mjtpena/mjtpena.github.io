---
title: "Fabric Endorsement: Certifying Trusted Data Products"
description: "Fabric endorsement — the Promoted and Certified badge system for Fabric items — is a lightweight but important trust signal in a self-service analytics…"
author: "Michael John Peña"
draft: false
date: 2023-11-14
tags: ["Microsoft Fabric", "Endorsement", "Data Quality", "Certification", "Governance"]
---

Fabric endorsement — the Promoted and Certified badge system for Fabric items — is a lightweight but important trust signal in a self-service analytics environment. In a large organisation with hundreds of datasets, reports, and lakehouses in a shared Fabric tenant, users need a way to distinguish authoritative, reviewed data products from personal experiments and works-in-progress. Promoted items can be marked by workspace members; Certified items require a Certification reviewer role and represent a higher standard of quality assurance. The practical implementation: organisations need to define what Certified means — what criteria a dataset must meet (documentation, refresh schedule, data quality checks, business sign-off) before a Certification reviewer marks it as Certified. The badge without the criteria is just a sticker; the criteria make it a meaningful data governance control.

## Understanding Endorsement Levels

```python
from enum import Enum
from dataclasses import dataclass
from typing import List, Optional
from datetime import datetime

class EndorsementLevel(Enum):
    NONE = "None"
    PROMOTED = "Promoted"
    CERTIFIED = "Certified"

@dataclass
class EndorsementCriteria:
    level: EndorsementLevel
    requirements: List[str]
    approvers: List[str]
    validity_days: int

endorsement_criteria = {
    EndorsementLevel.PROMOTED: EndorsementCriteria(
        level=EndorsementLevel.PROMOTED,
        requirements=[
            "Data owner identified",
            "Basic documentation complete",
            "Actively maintained",
            "Used by team members"
        ],
        approvers=["workspace_admin", "data_owner"],
        validity_days=365
    ),
    EndorsementLevel.CERTIFIED: EndorsementCriteria(
        level=EndorsementLevel.CERTIFIED,
        requirements=[
            "Comprehensive documentation",
            "Data quality validated",
            "Security review passed",
            "Performance benchmarked",
            "Governance approved",
            "Business stakeholder sign-off"
        ],
        approvers=["data_governance_team", "domain_owner"],
        validity_days=180
    )
}
```

## Implementing an Endorsement Workflow

```python
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import json

@dataclass
class EndorsementRequest:
    item_id: str
    item_name: str
    item_type: str
    requested_level: EndorsementLevel
    requestor: str
    request_date: datetime
    justification: str
    checklist: Dict[str, bool] = field(default_factory=dict)
    approvals: List[dict] = field(default_factory=list)
    status: str = "pending"

class EndorsementWorkflow:
    def __init__(self):
        self.requests: Dict[str, EndorsementRequest] = {}
        self.endorsed_items: Dict[str, dict] = {}

    def submit_request(
        self,
        item_id: str,
        item_name: str,
        item_type: str,
        level: EndorsementLevel,
        requestor: str,
        justification: str
    ) -> str:
        """Submit a new endorsement request."""
        request = EndorsementRequest(
            item_id=item_id,
            item_name=item_name,
            item_type=item_type,
            requested_level=level,
            requestor=requestor,
            request_date=datetime.now(),
            justification=justification
        )

        # Initialize checklist from criteria
        criteria = endorsement_criteria[level]
        request.checklist = {req: False for req in criteria.requirements}

        self.requests[item_id] = request
        return item_id

    def update_checklist(self, item_id: str, requirement: str, completed: bool):
        """Update a checklist item."""
        if item_id in self.requests:
            self.requests[item_id].checklist[requirement] = completed

    def check_ready_for_approval(self, item_id: str) -> dict:
        """Check if all requirements are met."""
        request = self.requests.get(item_id)
        if not request:
            return {"ready": False, "error": "Request not found"}

        incomplete = [k for k, v in request.checklist.items() if not v]

        return {
            "ready": len(incomplete) == 0,
            "incomplete_requirements": incomplete,
            "completion_percentage": (
                len([v for v in request.checklist.values() if v]) /
                len(request.checklist) * 100
            )
        }

    def approve(self, item_id: str, approver: str, comments: str = "") -> dict:
        """Approve an endorsement request."""
        request = self.requests.get(item_id)
        if not request:
            return {"success": False, "error": "Request not found"}

        readiness = self.check_ready_for_approval(item_id)
        if not readiness["ready"]:
            return {
                "success": False,
                "error": "Requirements not met",
                "details": readiness
            }

        criteria = endorsement_criteria[request.requested_level]

        request.approvals.append({
            "approver": approver,
            "timestamp": datetime.now().isoformat(),
            "comments": comments
        })

        # Check if we have enough approvals
        if len(request.approvals) >= 1:  # Simplified for example
            request.status = "approved"
            self.endorsed_items[item_id] = {
                "item_id": item_id,
                "item_name": request.item_name,
                "level": request.requested_level.value,
                "endorsed_date": datetime.now().isoformat(),
                "expires": (datetime.now() + timedelta(days=criteria.validity_days)).isoformat(),
                "approvals": request.approvals
            }

        return {"success": True, "status": request.status}

# Usage example
workflow = EndorsementWorkflow()

# Submit request for certification
workflow.submit_request(
    item_id="semantic-model-001",
    item_name="Sales Performance Model",
    item_type="SemanticModel",
    level=EndorsementLevel.CERTIFIED,
    requestor="data.engineer@company.com",
    justification="Core model used across all sales reporting"
)

# Complete checklist items
workflow.update_checklist("semantic-model-001", "Comprehensive documentation", True)
workflow.update_checklist("semantic-model-001", "Data quality validated", True)
workflow.update_checklist("semantic-model-001", "Security review passed", True)

# Check readiness
print(workflow.check_ready_for_approval("semantic-model-001"))
```

## Automated Quality Checks for Endorsement

```python
from typing import Callable, List
import statistics

class QualityChecker:
    def __init__(self):
        self.checks: List[dict] = []

    def add_check(self, name: str, check_func: Callable, threshold: float):
        """Add a quality check."""
        self.checks.append({
            "name": name,
            "function": check_func,
            "threshold": threshold
        })

    def run_checks(self, data: dict) -> dict:
        """Run all quality checks."""
        results = []

        for check in self.checks:
            try:
                score = check["function"](data)
                passed = score >= check["threshold"]
                results.append({
                    "check": check["name"],
                    "score": score,
                    "threshold": check["threshold"],
                    "passed": passed
                })
            except Exception as e:
                results.append({
                    "check": check["name"],
                    "error": str(e),
                    "passed": False
                })

        overall_passed = all(r.get("passed", False) for r in results)

        return {
            "overall_passed": overall_passed,
            "checks": results,
            "pass_rate": len([r for r in results if r.get("passed")]) / len(results)
        }

# Define quality checks
checker = QualityChecker()

# Completeness check
checker.add_check(
    "completeness",
    lambda d: 1 - (d.get("null_count", 0) / d.get("total_rows", 1)),
    0.95
)

# Freshness check
checker.add_check(
    "freshness",
    lambda d: 1 if d.get("hours_since_update", 999) < 24 else 0,
    1.0
)

# Documentation check
checker.add_check(
    "documentation",
    lambda d: len(d.get("documented_fields", [])) / max(d.get("total_fields", 1), 1),
    0.80
)

# Run checks
sample_data = {
    "null_count": 100,
    "total_rows": 10000,
    "hours_since_update": 6,
    "documented_fields": ["field1", "field2", "field3"],
    "total_fields": 4
}

quality_report = checker.run_checks(sample_data)
print(json.dumps(quality_report, indent=2))
```

## Displaying Endorsement Status

```python
def generate_endorsement_badge(item: dict) -> str:
    """Generate HTML badge for endorsement status."""
    level = item.get("endorsement_level", "none")

    badges = {
        "certified": {
            "color": "#107c10",
            "icon": "verified",
            "text": "Certified"
        },
        "promoted": {
            "color": "#0078d4",
            "icon": "star",
            "text": "Promoted"
        },
        "none": {
            "color": "#666666",
            "icon": "circle",
            "text": "Not Endorsed"
        }
    }

    badge = badges.get(level.lower(), badges["none"])

    return f"""
    <span class="endorsement-badge" style="
        background-color: {badge['color']};
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
    ">
        {badge['text']}
    </span>
    """

# In Power BI/Fabric, endorsement badges appear automatically
# This is for custom applications consuming Fabric APIs
```

## Best Practices

1. **Start with Promoted** - Lower barrier to entry
2. **Reserve Certified** for critical, widely-used assets
3. **Regular re-certification** - Quality degrades over time
4. **Document the criteria** - Make requirements transparent
5. **Automate where possible** - Quality checks, freshness monitoring

Tomorrow, we'll explore Data Lineage in Fabric and how it connects to Microsoft Purview!
