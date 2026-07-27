---
title: "Federated Governance in Data Mesh"
author: Michael John Peña
draft: false
date: 2024-06-17
tags:
  - Data Mesh
  - Governance
  - Microsoft Fabric
  - Data Platform
  - Compliance
---

Federated governance balances domain autonomy with organizational standards. Today I'm exploring how to implement effective federated governance in Microsoft Fabric.

## Governance Model

```
                    ┌─────────────────────┐
                    │  Global Policies    │
                    │  ─────────────────  │
                    │  Security           │
                    │  Privacy            │
                    │  Compliance         │
                    │  Interoperability   │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Finance Domain │   │ Marketing Domain│   │ Operations Domain│
│  ─────────────  │   │ ──────────────  │   │ ────────────────│
│  Domain Policies│   │ Domain Policies │   │ Domain Policies │
│  Local Standards│   │ Local Standards │   │ Local Standards │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

## Global vs Domain Policies

```python
from dataclasses import dataclass
from typing import Dict, List, Optional
from enum import Enum

class PolicyScope(Enum):
    GLOBAL = "global"  # Must be followed by all
    DOMAIN = "domain"  # Domain-specific
    OPTIONAL = "optional"  # Recommended best practice

@dataclass
class GovernancePolicy:
    name: str
    scope: PolicyScope
    description: str
    rules: List[Dict]
    enforcement: str  # "block", "warn", "audit"

# Global policies (mandatory)
global_policies = [
    GovernancePolicy(
        name="SensitivityLabeling",
        scope=PolicyScope.GLOBAL,
        description="All data products must have sensitivity labels",
        rules=[
            {"type": "require_label", "item_types": ["lakehouse", "warehouse", "report"]},
            {"type": "allowed_labels", "values": ["Public", "Internal", "Confidential", "Restricted"]}
        ],
        enforcement="block"
    ),
    GovernancePolicy(
        name="DataRetention",
        scope=PolicyScope.GLOBAL,
        description="Minimum data retention requirements",
        rules=[
            {"type": "min_retention", "days": 365, "data_class": "business"},
            {"type": "min_retention", "days": 2555, "data_class": "financial"},
            {"type": "max_retention", "days": 90, "data_class": "pii_temporary"}
        ],
        enforcement="warn"
    ),
    GovernancePolicy(
        name="QualityBaseline",
        scope=PolicyScope.GLOBAL,
        description="Minimum quality standards for certified products",
        rules=[
            {"type": "completeness", "threshold": 0.95},
            {"type": "freshness", "max_hours": 24},
            {"type": "documentation", "required": True}
        ],
        enforcement="block"
    )
]

# Domain policies (domain-specific)
finance_policies = [
    GovernancePolicy(
        name="FinancialDataApproval",
        scope=PolicyScope.DOMAIN,
        description="Financial data changes require approval",
        rules=[
            {"type": "approval_required", "for": ["schema_change", "delete", "publish"]},
            {"type": "approvers", "group": "finance-data-stewards"}
        ],
        enforcement="block"
    ),
    GovernancePolicy(
        name="SOXCompliance",
        scope=PolicyScope.DOMAIN,
        description="SOX compliance requirements",
        rules=[
            {"type": "audit_trail", "required": True},
            {"type": "change_management", "required": True},
            {"type": "access_review", "frequency": "quarterly"}
        ],
        enforcement="audit"
    )
]
```

## Policy Enforcement

```python
class PolicyEnforcer:
    """Enforce governance policies across the data mesh."""

    def __init__(self, global_policies: List[GovernancePolicy], domain_policies: Dict[str, List[GovernancePolicy]]):
        self.global_policies = global_policies
        self.domain_policies = domain_policies

    def validate_data_product(self, product: dict, domain: str) -> dict:
        """Validate a data product against all applicable policies."""
        results = {
            "product_name": product["name"],
            "domain": domain,
            "compliant": True,
            "violations": [],
            "warnings": []
        }

        # Check global policies
        for policy in self.global_policies:
            result = self._check_policy(product, policy)
            if not result["passed"]:
                if policy.enforcement == "block":
                    results["compliant"] = False
                    results["violations"].append({
                        "policy": policy.name,
                        "details": result["details"]
                    })
                elif policy.enforcement == "warn":
                    results["warnings"].append({
                        "policy": policy.name,
                        "details": result["details"]
                    })

        # Check domain policies
        for policy in self.domain_policies.get(domain, []):
            result = self._check_policy(product, policy)
            if not result["passed"]:
                if policy.enforcement == "block":
                    results["compliant"] = False
                    results["violations"].append({
                        "policy": policy.name,
                        "details": result["details"]
                    })
                elif policy.enforcement == "warn":
                    results["warnings"].append({
                        "policy": policy.name,
                        "details": result["details"]
                    })

        return results

    def _check_policy(self, product: dict, policy: GovernancePolicy) -> dict:
        """Check a single policy against a product."""
        for rule in policy.rules:
            if rule["type"] == "require_label":
                if not product.get("sensitivity_label"):
                    return {"passed": False, "details": "Missing sensitivity label"}

            elif rule["type"] == "completeness":
                if product.get("quality_score", {}).get("completeness", 0) < rule["threshold"]:
                    return {"passed": False, "details": f"Completeness below {rule['threshold']}"}

            elif rule["type"] == "freshness":
                hours_old = product.get("hours_since_update", 999)
                if hours_old > rule["max_hours"]:
                    return {"passed": False, "details": f"Data is {hours_old}h old, max is {rule['max_hours']}h"}

            elif rule["type"] == "documentation":
                if rule["required"] and not product.get("documentation"):
                    return {"passed": False, "details": "Documentation required but missing"}

        return {"passed": True, "details": None}
```

## Governance Roles

```python
@dataclass
class GovernanceRole:
    name: str
    scope: str  # "global", "domain", "product"
    responsibilities: List[str]
    permissions: List[str]

governance_roles = {
    "chief_data_officer": GovernanceRole(
        name="Chief Data Officer",
        scope="global",
        responsibilities=[
            "Set global data strategy",
            "Approve global policies",
            "Resolve cross-domain conflicts",
            "Report to executive team"
        ],
        permissions=["read_all", "policy_admin", "domain_admin"]
    ),

    "domain_data_owner": GovernanceRole(
        name="Domain Data Owner",
        scope="domain",
        responsibilities=[
            "Own domain data strategy",
            "Approve domain data products",
            "Ensure domain compliance",
            "Manage domain team"
        ],
        permissions=["domain_admin", "product_approve", "access_manage"]
    ),

    "data_product_owner": GovernanceRole(
        name="Data Product Owner",
        scope="product",
        responsibilities=[
            "Define product requirements",
            "Ensure product quality",
            "Manage product lifecycle",
            "Support consumers"
        ],
        permissions=["product_manage", "schema_manage", "access_request"]
    ),

    "data_steward": GovernanceRole(
        name="Data Steward",
        scope="domain",
        responsibilities=[
            "Maintain data quality",
            "Manage metadata",
            "Handle data issues",
            "Train users"
        ],
        permissions=["metadata_manage", "quality_manage", "issue_manage"]
    )
}
```

## Compliance Dashboard

```python
class ComplianceDashboard:
    """Generate compliance metrics and reports."""

    def __init__(self, enforcer: PolicyEnforcer):
        self.enforcer = enforcer

    def generate_compliance_report(self, products: List[dict]) -> dict:
        """Generate organization-wide compliance report."""
        report = {
            "generated_at": datetime.utcnow().isoformat(),
            "summary": {
                "total_products": len(products),
                "compliant": 0,
                "non_compliant": 0,
                "with_warnings": 0
            },
            "by_domain": {},
            "by_policy": {},
            "critical_violations": []
        }

        for product in products:
            domain = product["domain"]
            result = self.enforcer.validate_data_product(product, domain)

            # Update summary
            if result["compliant"]:
                report["summary"]["compliant"] += 1
            else:
                report["summary"]["non_compliant"] += 1

            if result["warnings"]:
                report["summary"]["with_warnings"] += 1

            # By domain
            if domain not in report["by_domain"]:
                report["by_domain"][domain] = {"compliant": 0, "non_compliant": 0}

            if result["compliant"]:
                report["by_domain"][domain]["compliant"] += 1
            else:
                report["by_domain"][domain]["non_compliant"] += 1

            # By policy
            for violation in result["violations"]:
                policy = violation["policy"]
                if policy not in report["by_policy"]:
                    report["by_policy"][policy] = 0
                report["by_policy"][policy] += 1

                # Track critical violations
                if self._is_critical(violation):
                    report["critical_violations"].append({
                        "product": product["name"],
                        "domain": domain,
                        "policy": policy,
                        "details": violation["details"]
                    })

        # Calculate compliance rate
        total = report["summary"]["total_products"]
        if total > 0:
            report["summary"]["compliance_rate"] = report["summary"]["compliant"] / total

        return report

    def _is_critical(self, violation: dict) -> bool:
        critical_policies = ["SensitivityLabeling", "SOXCompliance", "DataRetention"]
        return violation["policy"] in critical_policies
```

## Implementing in Fabric

```python
def setup_federated_governance(fabric_client, domains: List[str]):
    """Set up federated governance in Fabric."""

    # 1. Create global governance workspace
    gov_workspace = fabric_client.workspaces.create(
        name="DataGovernance-Central",
        description="Central governance artifacts and reporting"
    )

    # 2. Create governance dashboard
    dashboard = fabric_client.reports.create(
        workspace_id=gov_workspace.id,
        name="Governance Dashboard",
        template="governance_template"
    )

    # 3. Set up domain-level governance
    for domain in domains:
        # Create domain governance workspace
        domain_gov_ws = fabric_client.workspaces.create(
            name=f"{domain}-Governance"
        )

        # Assign governance team
        fabric_client.workspaces.add_group(
            workspace_id=domain_gov_ws.id,
            group_id=f"{domain.lower()}-data-stewards",
            role="Contributor"
        )

    # 4. Configure policies in tenant settings
    for policy in global_policies:
        apply_policy_to_tenant(fabric_client, policy)

    # 5. Set up monitoring
    setup_compliance_monitoring(fabric_client, domains)

    return {
        "governance_workspace": gov_workspace.id,
        "dashboard_id": dashboard.id
    }
```

## Best Practices

1. **Start with essentials** - Don't over-govern
2. **Automate enforcement** - Manual checks don't scale
3. **Enable, don't block** - Make compliance easy
4. **Measure and report** - What gets measured gets managed
5. **Evolve iteratively** - Governance is a journey

## What's Next

Tomorrow I'll cover data products in detail.

## Resources

- [Data Mesh Governance](https://www.datamesh-architecture.com/data-mesh-principles/federated-computational-governance)
- [Fabric Governance](https://learn.microsoft.com/fabric/governance/)
- [Purview Integration](https://learn.microsoft.com/purview/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
