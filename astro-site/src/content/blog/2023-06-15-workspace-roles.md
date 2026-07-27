---
title: "Fabric Workspace Roles: Managing Access and Collaboration"
author: Michael John Peña
draft: false
date: 2023-06-15
tags:
  - Microsoft Fabric
  - Security
  - Workspace
  - RBAC
  - Governance

---

I wrote "Fabric Workspace Roles: Managing Access and Collaboration" to share practical, production-minded guidance on this topic.

## Role Hierarchy

```
┌─────────────────────────────────────────────────────┐
│              Workspace Role Hierarchy                │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │                    ADMIN                         ││
│  │  Full workspace control                          ││
│  │  + Member permissions                            ││
│  │  + Add/remove members                            ││
│  │  + Delete workspace                              ││
│  │  + Manage workspace settings                     ││
│  └───────────────────────┬─────────────────────────┘│
│                          │                          │
│  ┌───────────────────────▼─────────────────────────┐│
│  │                   MEMBER                         ││
│  │  + Contributor permissions                       ││
│  │  + Share items                                   ││
│  │  + Manage item permissions                       ││
│  │  + Publish and update apps                       ││
│  └───────────────────────┬─────────────────────────┘│
│                          │                          │
│  ┌───────────────────────▼─────────────────────────┐│
│  │                CONTRIBUTOR                       ││
│  │  + Viewer permissions                            ││
│  │  + Create, edit, delete items                    ││
│  │  + Copy items                                    ││
│  └───────────────────────┬─────────────────────────┘│
│                          │                          │
│  ┌───────────────────────▼─────────────────────────┐│
│  │                   VIEWER                         ││
│  │  View all items                                  ││
│  │  Interact with reports                          ││
│  │  Export (if allowed)                            ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Detailed Permission Matrix

```python
permission_matrix = {
    "workspace_management": {
        "Admin": True,
        "Member": False,
        "Contributor": False,
        "Viewer": False
    },
    "add_remove_users": {
        "Admin": True,
        "Member": False,
        "Contributor": False,
        "Viewer": False
    },
    "delete_workspace": {
        "Admin": True,
        "Member": False,
        "Contributor": False,
        "Viewer": False
    },
    "create_items": {
        "Admin": True,
        "Member": True,
        "Contributor": True,
        "Viewer": False
    },
    "edit_items": {
        "Admin": True,
        "Member": True,
        "Contributor": True,
        "Viewer": False
    },
    "delete_items": {
        "Admin": True,
        "Member": True,
        "Contributor": True,
        "Viewer": False
    },
    "share_items": {
        "Admin": True,
        "Member": True,
        "Contributor": False,
        "Viewer": False
    },
    "manage_item_permissions": {
        "Admin": True,
        "Member": True,
        "Contributor": False,
        "Viewer": False
    },
    "publish_apps": {
        "Admin": True,
        "Member": True,  # Requires admin approval in some configs
        "Contributor": False,
        "Viewer": False
    },
    "view_items": {
        "Admin": True,
        "Member": True,
        "Contributor": True,
        "Viewer": True
    },
    "run_notebooks": {
        "Admin": True,
        "Member": True,
        "Contributor": True,
        "Viewer": False
    },
    "run_pipelines": {
        "Admin": True,
        "Member": True,
        "Contributor": True,
        "Viewer": False
    }
}
```

## Role Assignment Strategies

### Using Azure AD Groups

```python
# Best practice: Use Azure AD groups for role assignment

# Group structure example
azure_ad_groups = {
    "FABRIC-Sales-Admins": {
        "members": ["Platform team", "Data leads"],
        "fabric_role": "Admin",
        "workspaces": ["Sales Analytics - Dev", "Sales Analytics - Prod"]
    },
    "FABRIC-Sales-Engineers": {
        "members": ["Data engineers", "ETL developers"],
        "fabric_role": "Contributor",
        "workspaces": ["Sales Analytics - Dev"]
    },
    "FABRIC-Sales-Analysts": {
        "members": ["Business analysts", "Report authors"],
        "fabric_role": "Member",
        "workspaces": ["Sales Analytics - Dev"]
    },
    "FABRIC-Sales-Viewers": {
        "members": ["Sales managers", "Executives"],
        "fabric_role": "Viewer",
        "workspaces": ["Sales Analytics - Prod"]
    }
}

# Benefits of using groups:
# - Centralized access management in Azure AD
# - Easy onboarding/offboarding
# - Audit trail in Azure AD
# - Can be managed by IT/security team
```

### Environment-Based Roles

```python
# Different roles for different environments

environment_roles = {
    "development": {
        "workspace": "Sales Analytics - Dev",
        "role_mapping": {
            "Data Engineers": "Contributor",  # Can create and modify
            "Analysts": "Contributor",
            "Testers": "Viewer"
        }
    },
    "test": {
        "workspace": "Sales Analytics - Test",
        "role_mapping": {
            "Data Engineers": "Member",  # Can deploy and test
            "Analysts": "Viewer",
            "Testers": "Viewer",
            "QA Team": "Contributor"
        }
    },
    "production": {
        "workspace": "Sales Analytics - Prod",
        "role_mapping": {
            "Data Engineers": "Viewer",  # Read-only in prod
            "Analysts": "Viewer",
            "Business Users": "Viewer",
            "Platform Admin": "Admin"  # Only admins can modify prod
        }
    }
}
```

## Managing Roles via API

```python
import requests
from azure.identity import DefaultAzureCredential

class WorkspaceRoleManager:
    def __init__(self):
        credential = DefaultAzureCredential()
        token = credential.get_token("https://api.powerbi.com/.default")
        self.headers = {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }
        self.base_url = "https://api.powerbi.com/v1.0/myorg"

    def list_workspace_users(self, workspace_id: str) -> list:
        """List all users in a workspace"""
        url = f"{self.base_url}/groups/{workspace_id}/users"
        response = requests.get(url, headers=self.headers)
        return response.json().get("value", [])

    def add_user(self, workspace_id: str, email: str, role: str) -> bool:
        """Add user to workspace"""
        url = f"{self.base_url}/groups/{workspace_id}/users"
        payload = {
            "emailAddress": email,
            "groupUserAccessRight": role
        }
        response = requests.post(url, headers=self.headers, json=payload)
        return response.status_code == 200

    def add_group(self, workspace_id: str, group_id: str, role: str) -> bool:
        """Add Azure AD group to workspace"""
        url = f"{self.base_url}/groups/{workspace_id}/users"
        payload = {
            "identifier": group_id,
            "groupUserAccessRight": role,
            "principalType": "Group"
        }
        response = requests.post(url, headers=self.headers, json=payload)
        return response.status_code == 200

    def update_user_role(self, workspace_id: str, email: str, new_role: str) -> bool:
        """Update user's role in workspace"""
        url = f"{self.base_url}/groups/{workspace_id}/users"
        payload = {
            "emailAddress": email,
            "groupUserAccessRight": new_role
        }
        response = requests.put(url, headers=self.headers, json=payload)
        return response.status_code == 200

    def remove_user(self, workspace_id: str, email: str) -> bool:
        """Remove user from workspace"""
        url = f"{self.base_url}/groups/{workspace_id}/users/{email}"
        response = requests.delete(url, headers=self.headers)
        return response.status_code == 200

    def audit_workspace_access(self, workspace_id: str) -> dict:
        """Audit current access assignments"""
        users = self.list_workspace_users(workspace_id)

        audit = {
            "Admin": [],
            "Member": [],
            "Contributor": [],
            "Viewer": []
        }

        for user in users:
            role = user.get("groupUserAccessRight")
            principal = user.get("emailAddress") or user.get("displayName")
            if role in audit:
                audit[role].append(principal)

        return audit

# Usage
manager = WorkspaceRoleManager()

# Add Azure AD group
manager.add_group(
    workspace_id="workspace-guid",
    group_id="azure-ad-group-guid",
    role="Member"
)

# Audit access
audit = manager.audit_workspace_access("workspace-guid")
print("Workspace Access Audit:")
for role, users in audit.items():
    print(f"  {role}: {len(users)} users")
    for user in users:
        print(f"    - {user}")
```

## Access Review Process

```python
# Implement regular access reviews

def conduct_access_review(workspace_id: str, manager: WorkspaceRoleManager):
    """Conduct access review for a workspace"""

    current_access = manager.audit_workspace_access(workspace_id)

    review_results = {
        "workspace_id": workspace_id,
        "review_date": datetime.now().isoformat(),
        "findings": [],
        "recommendations": []
    }

    # Check for excessive admins
    admin_count = len(current_access["Admin"])
    if admin_count > 2:
        review_results["findings"].append(
            f"High number of admins: {admin_count}"
        )
        review_results["recommendations"].append(
            "Review and reduce admin count"
        )

    # Check for inactive users (would need activity data)
    # ...

    # Check for direct user assignments vs groups
    users_without_groups = []
    for role, users in current_access.items():
        for user in users:
            if "@" in str(user):  # Direct user assignment
                users_without_groups.append(user)

    if users_without_groups:
        review_results["findings"].append(
            f"Direct user assignments found: {len(users_without_groups)}"
        )
        review_results["recommendations"].append(
            "Move users to Azure AD groups"
        )

    return review_results
```

## Best Practices Summary

```python
workspace_role_best_practices = {
    "assignment": [
        "Use Azure AD groups, not individual users",
        "Follow principle of least privilege",
        "Start with Viewer, elevate as needed"
    ],
    "admin_role": [
        "Limit to 2-3 admins per workspace",
        "Require justification for admin access",
        "Consider break-glass admin account"
    ],
    "environment_separation": [
        "Dev: More permissive for experimentation",
        "Test: Controlled for validation",
        "Prod: Highly restricted, mostly viewers"
    ],
    "governance": [
        "Conduct quarterly access reviews",
        "Document role assignments",
        "Automate provisioning/deprovisioning"
    ]
}
```

Proper role management is essential for secure and efficient collaboration. Tomorrow, I will cover Item Permissions in more detail.

## Resources

- [Workspace Roles](https://learn.microsoft.com/en-us/fabric/get-started/roles-workspaces)
- [Azure AD Groups](https://learn.microsoft.com/en-us/azure/active-directory/fundamentals/active-directory-groups-create-azure-portal)
- [Access Management Best Practices](https://learn.microsoft.com/en-us/power-bi/admin/service-admin-role)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
