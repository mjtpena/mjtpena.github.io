---
title: "Microsoft Fabric Security: Protecting Your Data Platform"
author: Michael John Peña
draft: false
date: 2023-06-14
tags:
  - Microsoft Fabric
  - Security
  - Data Protection
  - Governance
  - Azure AD

---

I wrote "Microsoft Fabric Security: Protecting Your Data Platform" to share practical, production-minded guidance on this topic.

## Fabric Security Model

```
┌─────────────────────────────────────────────────────┐
│              Fabric Security Layers                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │            Identity (Azure AD)                   ││
│  │  - User authentication                          ││
│  │  - Service principals                           ││
│  │  - Managed identities                           ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Tenant Settings                     ││
│  │  - Feature enablement                           ││
│  │  - Export/sharing policies                      ││
│  │  - Data residency                               ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Workspace Security                  ││
│  │  - Workspace roles (Admin, Member, etc.)        ││
│  │  - Capacity assignment                          ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Item Permissions                    ││
│  │  - Read, Write, Reshare                         ││
│  │  - Build permissions                            ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Data Security                       ││
│  │  - Row-level security (RLS)                     ││
│  │  - Column-level security (OLS)                  ││
│  │  - Sensitivity labels                           ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Authentication

### Azure AD Integration

```python
# All Fabric authentication flows through Azure AD

authentication_methods = {
    "interactive_users": {
        "method": "Azure AD sign-in",
        "supports": ["MFA", "Conditional Access", "SSO"],
        "license": "Power BI Pro or Fabric capacity"
    },
    "service_principals": {
        "method": "App registration with client secret/certificate",
        "use_cases": ["Automation", "CI/CD", "API access"],
        "setup": "Azure AD > App registrations"
    },
    "managed_identities": {
        "method": "Azure-managed identity",
        "use_cases": ["Azure services integration", "Secure credential-less access"],
        "types": ["System-assigned", "User-assigned"]
    }
}
```

### Service Principal Setup

```python
# Using service principal for Fabric API access
from azure.identity import ClientSecretCredential
import requests

def get_fabric_client(tenant_id: str, client_id: str, client_secret: str):
    """Create authenticated Fabric API client"""

    credential = ClientSecretCredential(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret
    )

    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    return {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

# Enable service principal in Fabric Admin Portal:
# Admin Portal > Tenant settings > Developer settings
# > Allow service principals to use Power BI APIs
```

## Workspace Security

```python
# Workspace roles and permissions
workspace_roles = {
    "Admin": {
        "permissions": [
            "Full control over workspace",
            "Add/remove members",
            "Delete workspace",
            "Manage all items",
            "Publish apps"
        ],
        "assign_to": "Workspace owners, platform team"
    },
    "Member": {
        "permissions": [
            "Create, edit, delete items",
            "Share items",
            "Manage item permissions",
            "Cannot add/remove workspace members"
        ],
        "assign_to": "Data engineers, senior analysts"
    },
    "Contributor": {
        "permissions": [
            "Create, edit, delete items",
            "Cannot share items",
            "Cannot manage permissions"
        ],
        "assign_to": "Developers, analysts"
    },
    "Viewer": {
        "permissions": [
            "View items",
            "Cannot create or edit",
            "Cannot share"
        ],
        "assign_to": "Report consumers, stakeholders"
    }
}

# Best practices
workspace_security_practices = [
    "Use Azure AD groups for role assignments",
    "Minimize Admin role assignments",
    "Separate workspaces by security boundary",
    "Regular access reviews"
]
```

### Managing Workspace Access

```python
import requests

def add_workspace_member(workspace_id: str, user_email: str, role: str, headers: dict):
    """Add user to workspace with specified role"""

    url = f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/users"

    payload = {
        "emailAddress": user_email,
        "groupUserAccessRight": role  # Admin, Member, Contributor, Viewer
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.status_code == 200

def get_workspace_users(workspace_id: str, headers: dict):
    """Get all users in a workspace"""

    url = f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/users"
    response = requests.get(url, headers=headers)
    return response.json()["value"]

def remove_workspace_user(workspace_id: str, user_email: str, headers: dict):
    """Remove user from workspace"""

    url = f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/users/{user_email}"
    response = requests.delete(url, headers=headers)
    return response.status_code == 200
```

## Item-Level Permissions

```python
# Permissions at item level
item_permissions = {
    "read": "View the item and its data",
    "write": "Modify the item",
    "reshare": "Share item with others",
    "build": "Create new content based on this item (semantic models)"
}

# Grant item permissions via API
def grant_item_permission(workspace_id: str, item_id: str, user_email: str, permission: str, headers: dict):
    """Grant permission on specific item"""

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{item_id}/permissions"

    payload = {
        "principal": {
            "type": "User",
            "emailAddress": user_email
        },
        "permission": permission  # Read, Write, Reshare
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()
```

## Row-Level Security (RLS)

```dax
// RLS in semantic models

// 1. Create security table mapping users to their data access
// Table: UserSecurity
// Columns: UserEmail, Region, Department

// 2. Define RLS role with DAX filter
// Role: RegionalAccess
// Table: Sales
// Filter:
Sales[Region] IN
    CALCULATETABLE(
        VALUES(UserSecurity[Region]),
        UserSecurity[UserEmail] = USERPRINCIPALNAME()
    )

// 3. Complex RLS: Manager sees all reports' data
// Role: ManagerAccess
// Table: Sales
Sales[SalesRepEmail] IN
    CALCULATETABLE(
        DISTINCT(OrgHierarchy[ReportEmail]),
        PATHCONTAINS(
            OrgHierarchy[ManagerPath],
            LOOKUPVALUE(
                OrgHierarchy[EmployeeID],
                OrgHierarchy[Email],
                USERPRINCIPALNAME()
            )
        )
    )
    ||
    Sales[SalesRepEmail] = USERPRINCIPALNAME()
```

### Testing RLS

```python
# Test RLS with API
def test_rls(dataset_id: str, role_name: str, user_email: str, headers: dict):
    """Execute query as specific user to test RLS"""

    url = f"https://api.powerbi.com/v1.0/myorg/datasets/{dataset_id}/executeQueries"

    payload = {
        "queries": [
            {
                "query": "EVALUATE SUMMARIZE(Sales, Sales[Region], \"Total\", SUM(Sales[Amount]))"
            }
        ],
        "impersonatedUserName": user_email
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()
```

## Sensitivity Labels

```python
# Microsoft Information Protection labels
sensitivity_labels = {
    "public": {
        "description": "Data can be shared externally",
        "restrictions": "None",
        "encryption": "No"
    },
    "internal": {
        "description": "Internal use only",
        "restrictions": "No external sharing",
        "encryption": "Optional"
    },
    "confidential": {
        "description": "Sensitive business data",
        "restrictions": "Limited sharing, no export",
        "encryption": "Yes"
    },
    "highly_confidential": {
        "description": "Most sensitive data",
        "restrictions": "Strict access control",
        "encryption": "Yes, with additional controls"
    }
}

# Apply label via API
def apply_sensitivity_label(workspace_id: str, item_id: str, label_id: str, headers: dict):
    """Apply sensitivity label to item"""

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{item_id}/sensitivityLabel"

    payload = {
        "labelId": label_id
    }

    response = requests.put(url, headers=headers, json=payload)
    return response.json()
```

## Data Protection Best Practices

```python
security_best_practices = {
    "principle_of_least_privilege": [
        "Grant minimum necessary permissions",
        "Use Viewer role as default",
        "Elevate only when needed"
    ],
    "access_management": [
        "Use Azure AD groups for assignments",
        "Implement regular access reviews",
        "Remove access promptly on role change"
    ],
    "data_classification": [
        "Apply sensitivity labels consistently",
        "Train users on classification",
        "Automate label application where possible"
    ],
    "monitoring": [
        "Enable audit logging",
        "Review access patterns",
        "Alert on suspicious activity"
    ]
}
```

Security is an ongoing responsibility. Tomorrow, I will cover Workspace Roles in more detail.

## Resources

- [Fabric Security Overview](https://learn.microsoft.com/en-us/fabric/security/security-overview)
- [Row-Level Security](https://learn.microsoft.com/en-us/power-bi/enterprise/service-admin-rls)
- [Sensitivity Labels](https://learn.microsoft.com/en-us/power-bi/enterprise/service-security-sensitivity-label-overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
