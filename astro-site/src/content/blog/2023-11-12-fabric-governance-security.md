---
title: "Fabric Governance: Building a Secure Data Platform"
author: "Michael John Peña"
draft: false
date: 2023-11-12
tags: ["Microsoft Fabric", "Governance", "Security", "Data Management", "Compliance"]

---

I wrote "Fabric Governance: Building a Secure Data Platform" to share practical, production-minded guidance on this topic.

Fabric governance is where the platform's SaaS architecture creates both an advantage and a complication for enterprise security teams. The advantage: because Fabric is a unified platform, you have one governance layer to configure rather than separate security policies for Synapse, Power BI, Azure Data Factory, and Azure ML. The complication: Fabric's workspace model and item-level permissions interact with Microsoft 365 tenant settings and Entra ID in ways that require coordination between the Fabric admin and the Microsoft 365 admin — not all governance controls live in the Fabric admin portal. Row-Level Security for semantic models, sensitivity labels from Microsoft Purview Information Protection, and external sharing controls are three areas where getting the configuration right requires understanding how Fabric integrates with the broader Microsoft 365 ecosystem, not just Fabric-specific settings.

## Workspace-Level Security

Workspaces are the primary security boundary in Fabric:

```python
# Fabric workspace roles and permissions
workspace_roles = {
    "Admin": {
        "description": "Full control over workspace",
        "permissions": [
            "manage_workspace_settings",
            "manage_members",
            "delete_workspace",
            "create_items",
            "edit_items",
            "delete_items",
            "share_items",
            "view_items"
        ]
    },
    "Member": {
        "description": "Can create and edit content",
        "permissions": [
            "create_items",
            "edit_items",
            "delete_items",
            "share_items",
            "view_items"
        ]
    },
    "Contributor": {
        "description": "Can create and edit, cannot share",
        "permissions": [
            "create_items",
            "edit_items",
            "delete_items",
            "view_items"
        ]
    },
    "Viewer": {
        "description": "Read-only access",
        "permissions": [
            "view_items"
        ]
    }
}

def check_permission(role: str, action: str) -> bool:
    """Check if a role has a specific permission."""
    if role not in workspace_roles:
        return False
    return action in workspace_roles[role]["permissions"]

# Example
print(check_permission("Contributor", "share_items"))  # False
print(check_permission("Member", "share_items"))  # True
```

## Item-Level Security

Beyond workspace roles, Fabric supports granular item permissions:

```python
from enum import Enum
from typing import List, Dict

class ItemPermission(Enum):
    READ = "Read"
    WRITE = "Write"
    RESHARE = "Reshare"
    BUILD = "Build"  # For semantic models

class FabricItem:
    def __init__(self, name: str, item_type: str):
        self.name = name
        self.item_type = item_type
        self.permissions: Dict[str, List[ItemPermission]] = {}

    def grant_permission(self, principal: str, permissions: List[ItemPermission]):
        """Grant permissions to a user or group."""
        self.permissions[principal] = permissions

    def check_access(self, principal: str, required: ItemPermission) -> bool:
        """Check if principal has required permission."""
        user_perms = self.permissions.get(principal, [])
        return required in user_perms

# Example: Configure semantic model permissions
sales_model = FabricItem("Sales Analysis", "SemanticModel")
sales_model.grant_permission(
    "sales-analysts@company.com",
    [ItemPermission.READ, ItemPermission.BUILD]
)
sales_model.grant_permission(
    "data-engineers@company.com",
    [ItemPermission.READ, ItemPermission.WRITE, ItemPermission.RESHARE]
)
```

## Row-Level Security (RLS)

Implement data-level security in your semantic models:

```dax
// DAX for Row-Level Security

// Create a security table
SecurityRoles =
DATATABLE(
    "Email", STRING,
    "Region", STRING,
    {
        {"user1@company.com", "North America"},
        {"user2@company.com", "Europe"},
        {"user3@company.com", "Asia Pacific"},
        {"manager@company.com", "ALL"}
    }
)

// RLS Filter Expression for Sales table
[Region] = LOOKUPVALUE(
    SecurityRoles[Region],
    SecurityRoles[Email],
    USERPRINCIPALNAME()
)
||
LOOKUPVALUE(
    SecurityRoles[Region],
    SecurityRoles[Email],
    USERPRINCIPALNAME()
) = "ALL"
```

## Object-Level Security (OLS)

Hide sensitive columns from certain users:

```python
# Object-Level Security configuration
ols_config = {
    "semantic_model": "Financial Reports",
    "tables": {
        "Employees": {
            "columns": {
                "Salary": {
                    "hidden_for": ["general-users@company.com"],
                    "visible_for": ["hr-team@company.com", "finance-team@company.com"]
                },
                "SSN": {
                    "hidden_for": ["*"],  # Hidden from everyone except admins
                    "visible_for": ["hr-admins@company.com"]
                }
            }
        },
        "Sales": {
            "columns": {
                "Cost": {
                    "hidden_for": ["sales-reps@company.com"],
                    "visible_for": ["finance-team@company.com"]
                },
                "Margin": {
                    "hidden_for": ["sales-reps@company.com"],
                    "visible_for": ["sales-managers@company.com"]
                }
            }
        }
    }
}
```

## Data Classification and Sensitivity Labels

```python
from dataclasses import dataclass
from typing import Optional
from datetime import datetime

@dataclass
class SensitivityLabel:
    name: str
    priority: int
    encryption_required: bool
    watermark: bool
    restrictions: dict

# Microsoft Purview sensitivity labels
sensitivity_labels = {
    "Public": SensitivityLabel(
        name="Public",
        priority=0,
        encryption_required=False,
        watermark=False,
        restrictions={}
    ),
    "Internal": SensitivityLabel(
        name="Internal",
        priority=1,
        encryption_required=False,
        watermark=False,
        restrictions={"external_sharing": False}
    ),
    "Confidential": SensitivityLabel(
        name="Confidential",
        priority=2,
        encryption_required=True,
        watermark=True,
        restrictions={
            "external_sharing": False,
            "download": "restricted",
            "print": "restricted"
        }
    ),
    "Highly Confidential": SensitivityLabel(
        name="Highly Confidential",
        priority=3,
        encryption_required=True,
        watermark=True,
        restrictions={
            "external_sharing": False,
            "download": "blocked",
            "print": "blocked",
            "copy": "blocked"
        }
    )
}

def apply_label(item_name: str, label_name: str) -> dict:
    """Apply sensitivity label to a Fabric item."""
    if label_name not in sensitivity_labels:
        raise ValueError(f"Unknown label: {label_name}")

    label = sensitivity_labels[label_name]

    return {
        "item": item_name,
        "label_applied": label.name,
        "timestamp": datetime.now().isoformat(),
        "encryption_enabled": label.encryption_required,
        "restrictions_applied": label.restrictions
    }
```

## Audit Logging

Track all activities in your Fabric environment:

```python
import json
from datetime import datetime, timedelta

# Query audit logs via Microsoft 365 Unified Audit Log
audit_query = {
    "start_date": (datetime.now() - timedelta(days=7)).isoformat(),
    "end_date": datetime.now().isoformat(),
    "operations": [
        "ViewReport",
        "ExportReport",
        "ShareReport",
        "CreateDataset",
        "DeleteDataset",
        "UpdateDatasetParameters",
        "RefreshDataset",
        "CreateWorkspace",
        "DeleteWorkspace",
        "AddWorkspaceMember"
    ],
    "record_types": ["PowerBIAudit"]
}

# Sample audit log entry structure
sample_audit_entry = {
    "CreationTime": "2023-11-12T10:30:00Z",
    "Operation": "ViewReport",
    "OrganizationId": "contoso.com",
    "UserType": 0,
    "UserKey": "user@contoso.com",
    "Workload": "PowerBI",
    "UserId": "user@contoso.com",
    "ClientIP": "192.168.1.100",
    "Activity": "ViewReport",
    "ItemName": "Sales Dashboard",
    "WorkspaceName": "Sales Analytics",
    "WorkspaceId": "guid-here",
    "ReportId": "report-guid",
    "ReportType": "PowerBIReport"
}

def analyze_audit_logs(logs: list) -> dict:
    """Analyze audit logs for insights."""
    operations_count = {}
    users_activity = {}

    for log in logs:
        op = log.get("Operation", "Unknown")
        user = log.get("UserId", "Unknown")

        operations_count[op] = operations_count.get(op, 0) + 1
        users_activity[user] = users_activity.get(user, 0) + 1

    return {
        "total_events": len(logs),
        "operations_breakdown": operations_count,
        "most_active_users": sorted(
            users_activity.items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]
    }
```

## Best Practices

1. **Use Azure AD groups** for permission management
2. **Apply sensitivity labels** consistently
3. **Enable audit logging** and review regularly
4. **Implement RLS** for multi-tenant scenarios
5. **Use separate workspaces** for dev/test/prod
6. **Regular access reviews** to maintain least privilege

Tomorrow, we'll explore Fabric Domains and how to organize your data platform effectively.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
