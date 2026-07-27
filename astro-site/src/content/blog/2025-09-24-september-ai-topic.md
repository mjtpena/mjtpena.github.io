---
title: "Data Mesh: Federated Computational Governance"
author: Michael John Peña
draft: false
date: 2025-09-24
tags:
  - Data Mesh
  - Governance
  - Data Quality
  - Policy as Code
  - Automation

---

I wrote "Data Mesh: Federated Computational Governance" to share practical, production-minded guidance on this topic.

## Policy as Code

```python
from dataclasses import dataclass
from typing import List, Dict, Callable, Any
from enum import Enum
import re

class PolicySeverity(Enum):
    ERROR = "error"  # Blocks deployment
    WARNING = "warning"  # Logged but allowed
    INFO = "info"  # Informational only

@dataclass
class PolicyViolation:
    policy_name: str
    severity: PolicySeverity
    message: str
    location: str
    remediation: str

@dataclass
class GovernancePolicy:
    name: str
    description: str
    severity: PolicySeverity
    check: Callable[[Dict], List[PolicyViolation]]

class FederatedGovernance:
    def __init__(self):
        self.policies: List[GovernancePolicy] = []
        self._register_default_policies()

    def _register_default_policies(self):
        """Register organization-wide default policies."""

        # Naming convention policy
        self.policies.append(GovernancePolicy(
            name="naming-convention",
            description="Data products must follow naming conventions",
            severity=PolicySeverity.ERROR,
            check=self._check_naming_convention
        ))

        # Schema documentation policy
        self.policies.append(GovernancePolicy(
            name="schema-documentation",
            description="All fields must have descriptions",
            severity=PolicySeverity.ERROR,
            check=self._check_schema_documentation
        ))

        # PII classification policy
        self.policies.append(GovernancePolicy(
            name="pii-classification",
            description="Fields containing PII must be tagged",
            severity=PolicySeverity.ERROR,
            check=self._check_pii_classification
        ))

        # Data quality SLA policy
        self.policies.append(GovernancePolicy(
            name="quality-sla",
            description="Data products must define quality SLAs",
            severity=PolicySeverity.WARNING,
            check=self._check_quality_sla
        ))

    def _check_naming_convention(self, spec: Dict) -> List[PolicyViolation]:
        """Check naming follows domain-name pattern."""
        violations = []
        name = spec.get("name", "")
        domain = spec.get("domain", "")

        expected_pattern = f"^{domain}-[a-z0-9-]+$"
        if not re.match(expected_pattern, name):
            violations.append(PolicyViolation(
                policy_name="naming-convention",
                severity=PolicySeverity.ERROR,
                message=f"Name '{name}' must match pattern '{expected_pattern}'",
                location="metadata.name",
                remediation=f"Rename to '{domain}-<descriptive-name>'"
            ))

        return violations

    def _check_schema_documentation(self, spec: Dict) -> List[PolicyViolation]:
        """Check all schema fields have descriptions."""
        violations = []
        schema = spec.get("schema", {})

        for field_name, field_def in schema.get("fields", {}).items():
            if not field_def.get("description"):
                violations.append(PolicyViolation(
                    policy_name="schema-documentation",
                    severity=PolicySeverity.ERROR,
                    message=f"Field '{field_name}' missing description",
                    location=f"schema.fields.{field_name}",
                    remediation=f"Add 'description' to field definition"
                ))

        return violations

    def _check_pii_classification(self, spec: Dict) -> List[PolicyViolation]:
        """Check PII fields are properly tagged."""
        violations = []
        pii_patterns = ["email", "phone", "ssn", "address", "name", "dob"]
        schema = spec.get("schema", {})

        for field_name, field_def in schema.get("fields", {}).items():
            field_lower = field_name.lower()
            if any(p in field_lower for p in pii_patterns):
                if "pii" not in field_def.get("tags", []):
                    violations.append(PolicyViolation(
                        policy_name="pii-classification",
                        severity=PolicySeverity.ERROR,
                        message=f"Field '{field_name}' may contain PII but is not tagged",
                        location=f"schema.fields.{field_name}",
                        remediation="Add 'pii' to field tags"
                    ))

        return violations

    def validate(self, data_product_spec: Dict) -> Dict:
        """Validate a data product spec against all policies."""
        all_violations = []

        for policy in self.policies:
            violations = policy.check(data_product_spec)
            all_violations.extend(violations)

        errors = [v for v in all_violations if v.severity == PolicySeverity.ERROR]

        return {
            "valid": len(errors) == 0,
            "violations": all_violations,
            "error_count": len(errors)
        }
```

Computational governance scales where manual review cannot. Embed policies in CI/CD pipelines to catch issues before they reach production.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
