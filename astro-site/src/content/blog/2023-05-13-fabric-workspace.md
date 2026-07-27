---
title: "Microsoft Fabric Workspace: Organization and Collaboration"
author: Michael John Peña
draft: false
date: 2023-05-13
tags:
  - Microsoft Fabric
  - Workspace
  - Collaboration
  - Governance
  - Azure
---

A Fabric workspace is the collaboration boundary in Microsoft Fabric—the container where Fabric items (Lakehouses, Warehouses, Notebooks, Pipelines, KQL Databases, Semantic Models, Reports, Dashboards) are created, organised, and shared. The workspace is also a Power BI workspace—Fabric workspaces appear in the Power BI service, and Power BI content created in a Fabric workspace appears alongside Fabric data items. The workspace roles: Owner (full control, including deleting the workspace and managing members); Member (create, edit, and delete items; share items); Contributor (create, edit, and delete items; cannot share); Viewer (view items and reports; cannot edit or create). The workspace-to-capacity binding: a workspace must be assigned to a Fabric capacity (or a Power BI Premium capacity with Fabric enabled) to use Fabric items; the capacity provides the compute resources that back the workspace's Spark, SQL, and KQL workloads. The workspace governance design pattern: organising workspaces by lifecycle stage (bronze/silver/gold workspaces for the medallion architecture) rather than by team enables finer-grained access control—the bronze workspace (raw ingestion) is accessible only to data engineers; the gold workspace (business-ready data) is accessible to BI developers and business users; data flows between workspaces via OneLake shortcuts without data copying. The personal workspace limitation: personal workspaces in Power BI (the workspace named "My workspace") cannot be assigned to Fabric capacity; Fabric items can only be created in group workspaces (workspaces with members other than just the creator).

## What is a Fabric Workspace?

A workspace in Fabric is a container for your data artifacts that provides:
- Collaboration space for teams
- Security boundary for data access
- Capacity assignment for compute resources
- Git integration for version control

```
┌─────────────────────────────────────────────────────┐
│                Fabric Workspace                      │
│              "Sales Analytics"                       │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐│
│  │                   Items                          ││
│  ├─────────────┬─────────────┬─────────────────────┤│
│  │ Lakehouses  │ Warehouses  │ Semantic Models     ││
│  │ Notebooks   │ Pipelines   │ Reports             ││
│  │ KQL DBs     │ Dataflows   │ Spark Job Defs      ││
│  └─────────────┴─────────────┴─────────────────────┘│
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐│
│  │              Access Control                      ││
│  │  Admin │ Member │ Contributor │ Viewer          ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  Assigned Capacity: F64                             │
│  Git: Connected to Azure DevOps                     │
└─────────────────────────────────────────────────────┘
```

## Creating Workspaces

### Via Fabric Portal

```python
# Workspace creation settings
workspace_settings = {
    "name": "Sales Analytics - Production",
    "description": "Production workspace for Sales Analytics team",
    "license_mode": "Fabric",  # or "Premium", "Pro"
    "capacity": "F64-Capacity",
    "default_storage": "OneLake",
    "contact_list": ["sales-analytics-team@contoso.com"],
    "workspace_admins": ["admin1@contoso.com", "admin2@contoso.com"]
}
```

### Via REST API

```python
import requests

def create_workspace(workspace_name: str, capacity_id: str, access_token: str):
    url = "https://api.powerbi.com/v1.0/myorg/groups"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    payload = {
        "name": workspace_name,
        "capacityId": capacity_id
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Create workspace
workspace = create_workspace(
    "Sales Analytics - Production",
    "capacity-guid-here",
    access_token
)
print(f"Created workspace: {workspace['id']}")
```

## Workspace Roles

```python
# Fabric workspace roles and permissions
workspace_roles = {
    "Admin": {
        "description": "Full control over workspace",
        "permissions": [
            "Add/remove members",
            "Change workspace settings",
            "Delete workspace",
            "Create/edit/delete all items",
            "Publish apps",
            "Manage permissions on all items"
        ]
    },
    "Member": {
        "description": "Create and edit content, share items",
        "permissions": [
            "Create/edit/delete all items",
            "Share items and manage item permissions",
            "Publish apps (with admin approval)",
            "Cannot add/remove members",
            "Cannot change workspace settings"
        ]
    },
    "Contributor": {
        "description": "Create and edit content only",
        "permissions": [
            "Create/edit/delete all items",
            "Cannot share items",
            "Cannot manage permissions",
            "Cannot publish apps"
        ]
    },
    "Viewer": {
        "description": "View content only",
        "permissions": [
            "View all items",
            "Cannot create or edit",
            "Cannot share",
            "Can interact with reports (filters, etc.)"
        ]
    }
}
```

### Assigning Roles

```python
def assign_workspace_role(workspace_id: str, user_email: str, role: str, access_token: str):
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/users"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    payload = {
        "emailAddress": user_email,
        "groupUserAccessRight": role  # Admin, Member, Contributor, Viewer
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.status_code == 200

# Add users to workspace
assign_workspace_role(workspace_id, "analyst@contoso.com", "Contributor", token)
assign_workspace_role(workspace_id, "manager@contoso.com", "Member", token)
assign_workspace_role(workspace_id, "executive@contoso.com", "Viewer", token)
```

## Workspace Organization Strategies

### By Environment

```
┌─────────────────────────────────────────────────────┐
│                Development                           │
│  ├── Sales Analytics - Dev                          │
│  ├── Marketing Analytics - Dev                      │
│  └── Finance Analytics - Dev                        │
├─────────────────────────────────────────────────────┤
│                Test/UAT                              │
│  ├── Sales Analytics - Test                         │
│  ├── Marketing Analytics - Test                     │
│  └── Finance Analytics - Test                       │
├─────────────────────────────────────────────────────┤
│                Production                            │
│  ├── Sales Analytics - Prod                         │
│  ├── Marketing Analytics - Prod                     │
│  └── Finance Analytics - Prod                       │
└─────────────────────────────────────────────────────┘
```

### By Domain

```
┌─────────────────────────────────────────────────────┐
│                    Sales Domain                      │
│  ├── Sales Raw Data (Lakehouse)                     │
│  ├── Sales Curated (Lakehouse)                      │
│  └── Sales Analytics (Reports)                      │
├─────────────────────────────────────────────────────┤
│                  Marketing Domain                    │
│  ├── Marketing Raw Data                             │
│  ├── Marketing Curated                              │
│  └── Marketing Analytics                            │
├─────────────────────────────────────────────────────┤
│                   Shared Data                        │
│  ├── Enterprise Dimensions                          │
│  ├── Common Reference Data                          │
│  └── Master Data                                    │
└─────────────────────────────────────────────────────┘
```

### By Layer (Medallion Architecture)

```python
# Medallion architecture workspace structure
medallion_workspaces = {
    "Bronze Layer": {
        "workspace": "Data Platform - Bronze",
        "purpose": "Raw data ingestion",
        "items": ["Lakehouses for raw data", "Ingestion pipelines"],
        "access": "Data engineers only"
    },
    "Silver Layer": {
        "workspace": "Data Platform - Silver",
        "purpose": "Cleaned and conformed data",
        "items": ["Lakehouses for curated data", "Transformation notebooks"],
        "access": "Data engineers and scientists"
    },
    "Gold Layer": {
        "workspace": "Data Platform - Gold",
        "purpose": "Business-ready aggregations",
        "items": ["Warehouses", "Semantic models", "Reports"],
        "access": "Analysts and business users"
    }
}
```

## Workspace Settings

### Configure Spark Settings

```python
# Workspace-level Spark configuration
spark_settings = {
    "spark.executor.memory": "28g",
    "spark.executor.cores": "4",
    "spark.driver.memory": "8g",
    "spark.sql.shuffle.partitions": "200",
    "spark.sql.adaptive.enabled": "true"
}

# Apply via workspace settings in Fabric portal
# Settings > Spark settings > Spark properties
```

### OneLake Settings

```python
# OneLake workspace settings
onelake_settings = {
    "storage_format": "Delta",           # Default format for tables
    "external_data_access": True,        # Allow shortcuts to external data
    "cross_workspace_access": True,      # Allow other workspaces to create shortcuts
    "retention_policy": "30 days"        # Soft delete retention
}
```

## Workspace Governance

### Naming Conventions

```python
# Recommended naming convention
naming_convention = {
    "pattern": "{Domain} - {Layer/Purpose} - {Environment}",
    "examples": [
        "Sales - Analytics - Prod",
        "Marketing - Raw Data - Dev",
        "Finance - Reporting - Test",
        "Enterprise - Shared Dimensions - Prod"
    ],
    "rules": [
        "Use consistent capitalization",
        "Include environment suffix",
        "Keep names concise but descriptive",
        "Avoid special characters"
    ]
}
```

### Tagging and Metadata

```python
# Use workspace description for metadata
workspace_metadata = {
    "name": "Sales Analytics - Production",
    "description": """
    Owner: Sales Analytics Team
    Contact: sales-analytics@contoso.com
    Data Classification: Internal
    Business Domain: Sales
    Last Review: 2023-05-01
    SLA: 99.5% availability
    """,
    "contacts": ["sales-analytics-team@contoso.com"]
}
```

## Cross-Workspace Access

```python
# Access data from another workspace via shortcuts
# In Lakehouse: Create shortcut > OneLake > Select workspace > Select item

# Or via Spark with absolute paths
df = spark.read.format("delta").load(
    "abfss://other-workspace@onelake.dfs.fabric.microsoft.com/lakehouse.Lakehouse/Tables/shared_dimensions"
)

# SQL endpoint cross-database query
# FROM other_lakehouse.dbo.shared_dimensions
```

Tomorrow, I will cover the comparison between Fabric and Azure Synapse Analytics.

## Resources

- [Workspace Overview](https://learn.microsoft.com/en-us/fabric/get-started/workspaces)
- [Workspace Roles](https://learn.microsoft.com/en-us/fabric/get-started/roles-workspaces)
- [Workspace Settings](https://learn.microsoft.com/en-us/fabric/admin/workspace-tenant-settings)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
