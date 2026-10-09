---
title: "Item Permissions in Fabric: Granular Access Control"
description: "Item permissions provide the flexibility to share specific artifacts securely. Tomorrow, I will cover Row-Level Security in Fabric."
author: Michael John Peña
draft: false
date: 2023-06-16
tags:
  - Microsoft Fabric
  - Permissions
  - Security
  - Data Access
  - Governance
---

## Item Permissions Overview

Item permissions allow access to specific items independent of workspace membership:

```python
item_permission_types = {
    "read": {
        "description": "View item and its data",
        "includes": ["View", "Query data", "Use in reports"]
    },
    "write": {
        "description": "Modify the item",
        "includes": ["Edit", "Save changes"]
    },
    "reshare": {
        "description": "Share with others",
        "includes": ["Grant permissions", "Share links"]
    },
    "build": {
        "description": "Build new content (semantic models)",
        "includes": ["Create reports", "Use as data source"]
    }
}
```

## Sharing Items

```python
import requests

def share_item(
    workspace_id: str,
    item_id: str,
    recipient_email: str,
    permissions: list,
    headers: dict
):
    """Share item with specific permissions"""

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{item_id}/share"

    payload = {
        "recipients": [
            {
                "userPrincipalName": recipient_email
            }
        ],
        "permissions": permissions  # ["Read", "Write", "Reshare"]
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Share semantic model with build permission
share_item(
    workspace_id="ws-guid",
    item_id="semantic-model-guid",
    recipient_email="analyst@company.com",
    permissions=["Read", "Build"],
    headers=headers
)
```

## Permission Inheritance

```
┌─────────────────────────────────────────────────────┐
│            Permission Inheritance                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Workspace Role                                     │
│       │                                             │
│       ▼                                             │
│  ┌─────────────┐      ┌─────────────┐              │
│  │ Lakehouse   │──────│ Tables      │              │
│  │ (workspace  │      │ (inherits)  │              │
│  │  access)    │      │             │              │
│  └─────────────┘      └─────────────┘              │
│                                                      │
│  Item Permission                                    │
│       │                                             │
│       ▼                                             │
│  ┌─────────────┐      ┌─────────────┐              │
│  │ Semantic    │──────│ Reports     │              │
│  │ Model       │      │ (can be     │              │
│  │ (shared)    │      │  shared     │              │
│  │             │      │  separately)│              │
│  └─────────────┘      └─────────────┘              │
│                                                      │
│  Note: Data access flows through semantic model    │
│  RLS applies regardless of item permissions        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Managing Item Permissions via API

```python
class ItemPermissionManager:
    def __init__(self, headers: dict):
        self.headers = headers
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def get_item_permissions(self, workspace_id: str, item_id: str) -> list:
        """Get all permissions for an item"""
        url = f"{self.base_url}/workspaces/{workspace_id}/items/{item_id}/permissions"
        response = requests.get(url, headers=self.headers)
        return response.json().get("value", [])

    def grant_permission(
        self,
        workspace_id: str,
        item_id: str,
        principal_type: str,  # User, Group, ServicePrincipal
        principal_id: str,
        permissions: list
    ) -> dict:
        """Grant permissions to a principal"""
        url = f"{self.base_url}/workspaces/{workspace_id}/items/{item_id}/permissions"

        payload = {
            "principal": {
                "type": principal_type,
                "id": principal_id
            },
            "permissions": permissions
        }

        response = requests.post(url, headers=self.headers, json=payload)
        return response.json()

    def revoke_permission(
        self,
        workspace_id: str,
        item_id: str,
        principal_id: str
    ) -> bool:
        """Revoke all permissions for a principal"""
        url = f"{self.base_url}/workspaces/{workspace_id}/items/{item_id}/permissions/{principal_id}"
        response = requests.delete(url, headers=self.headers)
        return response.status_code == 200

    def update_permission(
        self,
        workspace_id: str,
        item_id: str,
        principal_id: str,
        new_permissions: list
    ) -> dict:
        """Update permissions for a principal"""
        url = f"{self.base_url}/workspaces/{workspace_id}/items/{item_id}/permissions/{principal_id}"

        payload = {
            "permissions": new_permissions
        }

        response = requests.patch(url, headers=self.headers, json=payload)
        return response.json()

# Usage
manager = ItemPermissionManager(headers)

# Grant read access to a report
manager.grant_permission(
    workspace_id="ws-guid",
    item_id="report-guid",
    principal_type="User",
    principal_id="user@company.com",
    permissions=["Read"]
)

# Grant build permission on semantic model
manager.grant_permission(
    workspace_id="ws-guid",
    item_id="semantic-model-guid",
    principal_type="Group",
    principal_id="azure-ad-group-guid",
    permissions=["Read", "Build"]
)
```

## Common Sharing Scenarios

```python
sharing_scenarios = {
    "report_to_executives": {
        "item_type": "Report",
        "permissions": ["Read"],
        "description": "View-only access to finished report",
        "rls": "May apply based on semantic model"
    },
    "semantic_model_to_analysts": {
        "item_type": "Semantic Model",
        "permissions": ["Read", "Build"],
        "description": "Analysts can create their own reports",
        "rls": "Applies to all reports built on model"
    },
    "lakehouse_to_data_engineers": {
        "item_type": "Lakehouse",
        "permissions": ["Read", "Write"],
        "description": "Engineers can read and write data",
        "note": "Usually via workspace role instead"
    },
    "pipeline_to_operations": {
        "item_type": "Pipeline",
        "permissions": ["Read"],
        "description": "Ops can monitor but not modify",
        "note": "Cannot execute without workspace access"
    }
}
```

## Bulk Permission Management

```python
def bulk_grant_permissions(
    manager: ItemPermissionManager,
    workspace_id: str,
    item_ids: list,
    principals: list,
    permissions: list
):
    """Grant same permissions across multiple items"""

    results = []
    for item_id in item_ids:
        for principal in principals:
            result = manager.grant_permission(
                workspace_id=workspace_id,
                item_id=item_id,
                principal_type=principal["type"],
                principal_id=principal["id"],
                permissions=permissions
            )
            results.append({
                "item_id": item_id,
                "principal": principal["id"],
                "success": "error" not in result
            })

    return results

# Share multiple reports with a group
reports = ["report-1-guid", "report-2-guid", "report-3-guid"]
principals = [{"type": "Group", "id": "sales-team-group-guid"}]

results = bulk_grant_permissions(
    manager=manager,
    workspace_id="ws-guid",
    item_ids=reports,
    principals=principals,
    permissions=["Read"]
)
```

## Permission Auditing

```python
def audit_item_permissions(manager: ItemPermissionManager, workspace_id: str, item_id: str):
    """Audit permissions for an item"""

    permissions = manager.get_item_permissions(workspace_id, item_id)

    audit_report = {
        "item_id": item_id,
        "audit_date": datetime.now().isoformat(),
        "total_permissions": len(permissions),
        "by_type": {"User": 0, "Group": 0, "ServicePrincipal": 0},
        "by_permission": {"Read": 0, "Write": 0, "Reshare": 0, "Build": 0},
        "details": []
    }

    for perm in permissions:
        principal_type = perm.get("principal", {}).get("type")
        audit_report["by_type"][principal_type] = audit_report["by_type"].get(principal_type, 0) + 1

        for p in perm.get("permissions", []):
            audit_report["by_permission"][p] = audit_report["by_permission"].get(p, 0) + 1

        audit_report["details"].append({
            "principal": perm.get("principal", {}).get("displayName"),
            "type": principal_type,
            "permissions": perm.get("permissions")
        })

    return audit_report
```

Item permissions provide the flexibility to share specific artifacts securely. Tomorrow, I will cover Row-Level Security in Fabric.

## Resources

- [Share Items](https://learn.microsoft.com/en-us/fabric/get-started/share-items)
- [Permission Model](https://learn.microsoft.com/en-us/fabric/get-started/permission-model)
- [Sharing Best Practices](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-how-to-collaborate-distribute-dashboards-reports)
