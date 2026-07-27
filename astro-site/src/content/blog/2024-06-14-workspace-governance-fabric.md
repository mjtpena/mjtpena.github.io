---
title: "Workspace Governance in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-14
tags:
  - Microsoft Fabric
  - Governance
  - Workspaces
  - Best Practices
  - Administration
---

Workspaces are the containers for collaboration in Fabric. Effective governance ensures organization, security, and efficiency. Today I'm covering workspace governance strategies.

## Workspace Structure

### Recommended Patterns

```
Organization:
├── Domain-Based (by business area)
│   ├── Finance-Analytics
│   ├── Marketing-Analytics
│   └── Operations-Analytics
│
├── Environment-Based (by lifecycle)
│   ├── Sales-DEV
│   ├── Sales-TEST
│   └── Sales-PROD
│
└── Hybrid (domain + environment)
    ├── FIN-Sales-DEV
    ├── FIN-Sales-TEST
    ├── FIN-Sales-PROD
    ├── MKT-Campaign-DEV
    └── MKT-Campaign-PROD
```

### Naming Convention

```python
import re
from dataclasses import dataclass
from typing import Optional

@dataclass
class WorkspaceNameConfig:
    """Configuration for workspace naming validation."""
    pattern: str
    max_length: int = 64
    required_parts: list = None

    def validate(self, name: str) -> dict:
        issues = []

        if len(name) > self.max_length:
            issues.append(f"Name exceeds {self.max_length} characters")

        if not re.match(self.pattern, name):
            issues.append(f"Name doesn't match pattern: {self.pattern}")

        return {
            "valid": len(issues) == 0,
            "issues": issues
        }

# Define naming convention
# Pattern: DEPT-Project-ENV
naming_config = WorkspaceNameConfig(
    pattern=r"^[A-Z]{2,5}-[A-Za-z0-9]+-(?:DEV|TEST|UAT|PROD)$",
    max_length=64
)

# Validate
print(naming_config.validate("FIN-SalesAnalytics-PROD"))  # Valid
print(naming_config.validate("my workspace"))  # Invalid
```

## Workspace Templates

```python
class WorkspaceTemplate:
    """Template for creating consistent workspaces."""

    def __init__(self, template_config: dict):
        self.config = template_config

    def create_workspace(self, name: str, owners: list) -> dict:
        """Create workspace from template."""
        workspace = {
            "name": name,
            "description": self.config.get("description_template", "").format(name=name),
            "capacity_id": self.config["capacity_id"],
            "license_mode": self.config.get("license_mode", "Fabric"),
            "default_dataset_storage_format": self.config.get("storage_format", "Large")
        }

        # Create workspace
        ws = admin_client.workspaces.create(workspace)

        # Add role assignments
        for owner in owners:
            admin_client.workspaces.add_user(
                workspace_id=ws.id,
                user_email=owner,
                role="Admin"
            )

        # Add standard groups
        for role, groups in self.config.get("default_groups", {}).items():
            for group in groups:
                admin_client.workspaces.add_group(
                    workspace_id=ws.id,
                    group_id=group,
                    role=role
                )

        # Apply sensitivity label
        if self.config.get("sensitivity_label"):
            admin_client.workspaces.set_sensitivity_label(
                workspace_id=ws.id,
                label_id=self.config["sensitivity_label"]
            )

        return ws

# Define templates
templates = {
    "development": WorkspaceTemplate({
        "capacity_id": "dev-capacity-id",
        "description_template": "Development workspace for {name}",
        "license_mode": "Fabric",
        "default_groups": {
            "Contributor": ["developers-sg"],
            "Viewer": ["testers-sg"]
        }
    }),

    "production": WorkspaceTemplate({
        "capacity_id": "prod-capacity-id",
        "description_template": "Production workspace for {name}",
        "license_mode": "Fabric",
        "sensitivity_label": "confidential-label-id",
        "default_groups": {
            "Contributor": ["data-engineers-sg"],
            "Viewer": ["business-users-sg"]
        }
    })
}

# Create workspace
ws = templates["production"].create_workspace(
    name="FIN-Revenue-PROD",
    owners=["admin@company.com"]
)
```

## Access Management

### Role-Based Access

```python
class WorkspaceAccessManager:
    """Manage workspace access consistently."""

    ROLE_HIERARCHY = ["Admin", "Member", "Contributor", "Viewer"]

    def __init__(self, admin_client):
        self.client = admin_client

    def audit_access(self, workspace_id: str) -> dict:
        """Audit current access configuration."""
        access = self.client.workspaces.get_access(workspace_id)

        audit = {
            "workspace_id": workspace_id,
            "users": [],
            "groups": [],
            "apps": [],
            "issues": []
        }

        for entry in access:
            if entry.principal_type == "User":
                audit["users"].append({
                    "email": entry.identifier,
                    "role": entry.role
                })
            elif entry.principal_type == "Group":
                audit["groups"].append({
                    "id": entry.identifier,
                    "name": entry.display_name,
                    "role": entry.role
                })
            elif entry.principal_type == "App":
                audit["apps"].append({
                    "id": entry.identifier,
                    "role": entry.role
                })

        # Check for issues
        admin_count = sum(1 for u in audit["users"] if u["role"] == "Admin")
        if admin_count > 3:
            audit["issues"].append(f"Too many individual admins: {admin_count}")

        individual_users = len(audit["users"])
        if individual_users > 10:
            audit["issues"].append(f"Too many individual users: {individual_users}. Consider using groups.")

        return audit

    def enforce_group_policy(self, workspace_id: str, policy: dict):
        """Enforce that access is managed via groups, not individuals."""
        current_access = self.client.workspaces.get_access(workspace_id)

        for entry in current_access:
            if entry.principal_type == "User":
                # Check if user should be in a group instead
                if entry.identifier not in policy.get("allowed_individuals", []):
                    print(f"Warning: Individual user {entry.identifier} should be in a group")

        # Ensure required groups exist
        for role, groups in policy.get("required_groups", {}).items():
            for group_id in groups:
                self.client.workspaces.add_group(
                    workspace_id=workspace_id,
                    group_id=group_id,
                    role=role
                )
```

### Access Reviews

```python
def generate_access_review_report(workspace_ids: list) -> dict:
    """Generate access review report for compliance."""

    report = {
        "generated": datetime.utcnow().isoformat(),
        "workspaces": []
    }

    for ws_id in workspace_ids:
        ws = admin_client.workspaces.get(ws_id)
        access = admin_client.workspaces.get_access(ws_id)

        ws_report = {
            "workspace_id": ws_id,
            "workspace_name": ws.name,
            "access_entries": len(access),
            "by_role": {},
            "by_type": {},
            "last_activity": None
        }

        for entry in access:
            # Count by role
            role = entry.role
            ws_report["by_role"][role] = ws_report["by_role"].get(role, 0) + 1

            # Count by type
            ptype = entry.principal_type
            ws_report["by_type"][ptype] = ws_report["by_type"].get(ptype, 0) + 1

        # Get last activity
        activity = admin_client.workspaces.get_activity(ws_id, days=90)
        if activity:
            ws_report["last_activity"] = max(a.timestamp for a in activity).isoformat()

        report["workspaces"].append(ws_report)

    return report
```

## Lifecycle Management

```python
class WorkspaceLifecycleManager:
    """Manage workspace lifecycle: create, archive, delete."""

    def __init__(self, admin_client, retention_policy: dict):
        self.client = admin_client
        self.retention = retention_policy

    def identify_stale_workspaces(self, days: int = 90) -> list:
        """Find workspaces with no recent activity."""
        all_workspaces = self.client.workspaces.list_all()
        stale = []

        for ws in all_workspaces:
            last_activity = self.client.workspaces.get_last_activity(ws.id)

            if last_activity:
                days_since = (datetime.utcnow() - last_activity).days
                if days_since > days:
                    stale.append({
                        "workspace_id": ws.id,
                        "name": ws.name,
                        "days_inactive": days_since,
                        "last_activity": last_activity.isoformat()
                    })
            else:
                # Never used
                stale.append({
                    "workspace_id": ws.id,
                    "name": ws.name,
                    "days_inactive": None,
                    "last_activity": None
                })

        return stale

    def archive_workspace(self, workspace_id: str):
        """Archive a workspace (rename and restrict access)."""
        ws = self.client.workspaces.get(workspace_id)

        # Rename with archive prefix
        archived_name = f"[ARCHIVED] {ws.name}"
        self.client.workspaces.update(workspace_id, name=archived_name)

        # Remove all access except admins
        access = self.client.workspaces.get_access(workspace_id)
        for entry in access:
            if entry.role != "Admin":
                self.client.workspaces.remove_access(
                    workspace_id,
                    entry.identifier
                )

        # Add archived tag
        self.client.workspaces.add_tag(workspace_id, "archived")

        return archived_name

    def cleanup_orphaned_workspaces(self, dry_run: bool = True) -> list:
        """Find and optionally delete orphaned workspaces."""
        all_workspaces = self.client.workspaces.list_all()
        orphaned = []

        for ws in all_workspaces:
            access = self.client.workspaces.get_access(ws.id)
            admins = [a for a in access if a.role == "Admin"]

            if len(admins) == 0:
                orphaned.append(ws)

                if not dry_run:
                    # Assign to IT admin before deletion
                    self.client.workspaces.add_user(
                        ws.id,
                        "it-admin@company.com",
                        "Admin"
                    )

        return orphaned
```

## Monitoring and Compliance

```python
def workspace_compliance_check(workspace_id: str, policies: dict) -> dict:
    """Check workspace against compliance policies."""

    ws = admin_client.workspaces.get(workspace_id)
    results = {
        "workspace_id": workspace_id,
        "workspace_name": ws.name,
        "compliant": True,
        "checks": []
    }

    # Check naming convention
    if policies.get("naming_pattern"):
        name_valid = re.match(policies["naming_pattern"], ws.name)
        results["checks"].append({
            "check": "naming_convention",
            "passed": bool(name_valid),
            "message": "Name follows convention" if name_valid else "Name violates convention"
        })
        if not name_valid:
            results["compliant"] = False

    # Check sensitivity label
    if policies.get("require_sensitivity_label"):
        has_label = ws.sensitivity_label_id is not None
        results["checks"].append({
            "check": "sensitivity_label",
            "passed": has_label,
            "message": "Has label" if has_label else "Missing sensitivity label"
        })
        if not has_label:
            results["compliant"] = False

    # Check capacity assignment
    if policies.get("required_capacity"):
        correct_capacity = ws.capacity_id == policies["required_capacity"]
        results["checks"].append({
            "check": "capacity_assignment",
            "passed": correct_capacity,
            "message": "Correct capacity" if correct_capacity else "Wrong capacity"
        })
        if not correct_capacity:
            results["compliant"] = False

    return results
```

## Best Practices

1. **Consistent naming** - Enforce naming conventions
2. **Use templates** - Standardize workspace creation
3. **Group-based access** - Minimize individual permissions
4. **Regular reviews** - Audit access quarterly
5. **Lifecycle management** - Archive inactive workspaces

## What's Next

Tomorrow I'll start covering Data Mesh with Fabric.

## Resources

- [Workspace Governance](https://learn.microsoft.com/fabric/governance/)
- [Access Management](https://learn.microsoft.com/fabric/admin/workspace-access)
- [Best Practices](https://learn.microsoft.com/fabric/governance/best-practices)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
