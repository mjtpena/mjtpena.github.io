---
title: "Security Fundamentals in Microsoft Fabric"
description: "Security is foundational to any data platform. Today I'm exploring the security architecture and best practices in Microsoft Fabric."
author: Michael John Peña
draft: false
date: 2024-06-24
tags:
  - Microsoft Fabric
  - Security
  - Data Protection
  - Governance
  - Compliance
---

Security is foundational to any data platform. Today I'm exploring the security architecture and best practices in Microsoft Fabric.

## Security Layers

```
Fabric Security Model:
├── Identity & Access
│   ├── Microsoft Entra ID
│   ├── Workspace Roles
│   ├── Item Permissions
│   └── Row-Level Security
├── Data Protection
│   ├── Encryption at Rest
│   ├── Encryption in Transit
│   ├── Sensitivity Labels
│   └── Data Loss Prevention
├── Network Security
│   ├── Private Endpoints
│   ├── Service Tags
│   └── Firewall Rules
└── Compliance
    ├── Audit Logs
    ├── Data Residency
    └── Certifications
```

## Identity Management

```python
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

class WorkspaceRole(Enum):
    ADMIN = "Admin"
    MEMBER = "Member"
    CONTRIBUTOR = "Contributor"
    VIEWER = "Viewer"

@dataclass
class SecurityPrincipal:
    principal_id: str
    principal_type: str  # User, Group, ServicePrincipal
    display_name: str
    email: Optional[str] = None

class IdentityManager:
    """Manage identities and access in Fabric."""

    def __init__(self, fabric_client, graph_client):
        self.fabric = fabric_client
        self.graph = graph_client

    def add_workspace_member(
        self,
        workspace_id: str,
        principal: SecurityPrincipal,
        role: WorkspaceRole
    ):
        """Add a member to a workspace with a specific role."""
        return self.fabric.workspaces.add_access(
            workspace_id=workspace_id,
            principal={
                "id": principal.principal_id,
                "type": principal.principal_type
            },
            role=role.value
        )

    def sync_security_group(
        self,
        workspace_id: str,
        group_id: str,
        role: WorkspaceRole
    ):
        """Sync a security group to workspace access."""
        # Get group members
        members = self.graph.groups.list_members(group_id)

        # Add group (not individual members)
        return self.fabric.workspaces.add_access(
            workspace_id=workspace_id,
            principal={
                "id": group_id,
                "type": "Group"
            },
            role=role.value
        )

    def audit_workspace_access(self, workspace_id: str) -> dict:
        """Audit all access to a workspace."""
        access_list = self.fabric.workspaces.list_access(workspace_id)

        audit = {
            "workspace_id": workspace_id,
            "access_entries": [],
            "summary": {
                "total_principals": 0,
                "by_role": {},
                "by_type": {}
            }
        }

        for entry in access_list:
            audit["access_entries"].append({
                "principal_id": entry.principal.id,
                "principal_type": entry.principal.type,
                "display_name": entry.principal.display_name,
                "role": entry.role
            })

            # Update summary
            audit["summary"]["total_principals"] += 1
            role = entry.role
            audit["summary"]["by_role"][role] = audit["summary"]["by_role"].get(role, 0) + 1
            ptype = entry.principal.type
            audit["summary"]["by_type"][ptype] = audit["summary"]["by_type"].get(ptype, 0) + 1

        return audit

# Usage
identity_mgr = IdentityManager(fabric_client, graph_client)

# Add security group with Contributor role
identity_mgr.sync_security_group(
    workspace_id="ws-analytics",
    group_id="data-engineers-sg",
    role=WorkspaceRole.CONTRIBUTOR
)

# Audit access
audit = identity_mgr.audit_workspace_access("ws-analytics")
print(f"Total principals: {audit['summary']['total_principals']}")
```

## Item-Level Permissions

```python
class ItemPermissionManager:
    """Manage item-level permissions."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def share_item(
        self,
        workspace_id: str,
        item_id: str,
        item_type: str,
        recipients: List[dict],
        permission: str = "Read",
        notify: bool = True
    ):
        """Share an item with specific permissions."""
        return self.client.items.share(
            workspace_id=workspace_id,
            item_id=item_id,
            item_type=item_type,
            share_request={
                "recipients": recipients,
                "permission": permission,
                "notify_recipients": notify
            }
        )

    def grant_direct_access(
        self,
        workspace_id: str,
        item_id: str,
        principal_id: str,
        principal_type: str,
        permissions: List[str]
    ):
        """Grant direct access to an item."""
        return self.client.items.update_permissions(
            workspace_id=workspace_id,
            item_id=item_id,
            principal={
                "id": principal_id,
                "type": principal_type
            },
            permissions=permissions
        )

    def revoke_access(
        self,
        workspace_id: str,
        item_id: str,
        principal_id: str
    ):
        """Revoke access from a principal."""
        return self.client.items.remove_permissions(
            workspace_id=workspace_id,
            item_id=item_id,
            principal_id=principal_id
        )

    def list_item_permissions(
        self,
        workspace_id: str,
        item_id: str
    ) -> List[dict]:
        """List all permissions on an item."""
        return self.client.items.list_permissions(
            workspace_id=workspace_id,
            item_id=item_id
        )

# Usage
perm_mgr = ItemPermissionManager(fabric_client)

# Share report with specific users
perm_mgr.share_item(
    workspace_id="ws-analytics",
    item_id="report-sales-dashboard",
    item_type="Report",
    recipients=[
        {"email": "sales-manager@company.com"},
        {"email": "vp-sales@company.com"}
    ],
    permission="Read"
)
```

## Row-Level Security

```python
class RowLevelSecurityManager:
    """Implement row-level security."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def create_rls_role(
        self,
        dataset_id: str,
        role_name: str,
        table_permissions: List[dict]
    ):
        """Create an RLS role with table filters."""
        return self.client.datasets.create_role(
            dataset_id=dataset_id,
            role={
                "name": role_name,
                "tablePermissions": table_permissions
            }
        )

    def assign_role_members(
        self,
        dataset_id: str,
        role_name: str,
        members: List[dict]
    ):
        """Assign members to an RLS role."""
        for member in members:
            self.client.datasets.add_role_member(
                dataset_id=dataset_id,
                role_name=role_name,
                member=member
            )

    def create_dynamic_rls(
        self,
        dataset_id: str,
        table_name: str,
        user_column: str
    ):
        """Create dynamic RLS based on user identity."""
        # DAX filter that matches user email to data
        filter_expression = f'[{user_column}] = USERPRINCIPALNAME()'

        return self.create_rls_role(
            dataset_id=dataset_id,
            role_name="DynamicRLS",
            table_permissions=[{
                "tableName": table_name,
                "filterExpression": filter_expression
            }]
        )

# Usage
rls_mgr = RowLevelSecurityManager(fabric_client)

# Create regional RLS roles
regions = {
    "NorthAmerica": '[Region] = "NA"',
    "Europe": '[Region] = "EU"',
    "AsiaPacific": '[Region] = "APAC"'
}

for role_name, filter_expr in regions.items():
    rls_mgr.create_rls_role(
        dataset_id="sales-dataset",
        role_name=role_name,
        table_permissions=[{
            "tableName": "Sales",
            "filterExpression": filter_expr
        }]
    )

# Assign users to roles
rls_mgr.assign_role_members(
    dataset_id="sales-dataset",
    role_name="NorthAmerica",
    members=[
        {"emailAddress": "na-sales@company.com"},
        {"groupId": "na-sales-team-sg"}
    ]
)

# Create dynamic RLS
rls_mgr.create_dynamic_rls(
    dataset_id="sales-dataset",
    table_name="Sales",
    user_column="SalesRepEmail"
)
```

## Object-Level Security

```sql
-- Fabric Warehouse: Column-level security
CREATE TABLE sales_data (
    sale_id VARCHAR(50),
    customer_name VARCHAR(200),
    product VARCHAR(200),
    revenue DECIMAL(18,2),
    cost DECIMAL(18,2),
    profit DECIMAL(18,2)
);

-- Grant SELECT on specific columns
GRANT SELECT ON sales_data (sale_id, customer_name, product, revenue)
TO [sales-team@company.com];

-- Finance team can see all columns including cost and profit
GRANT SELECT ON sales_data
TO [finance-team@company.com];

-- Create secure view for aggregated data
CREATE VIEW sales_summary
WITH SCHEMABINDING
AS
SELECT
    product,
    COUNT(*) as transaction_count,
    SUM(revenue) as total_revenue
FROM dbo.sales_data
GROUP BY product;

GRANT SELECT ON sales_summary TO [marketing-team@company.com];
```

## Security Monitoring

```python
class SecurityMonitor:
    """Monitor security events and compliance."""

    def __init__(self, admin_client, log_analytics_client):
        self.admin = admin_client
        self.logs = log_analytics_client

    def get_access_events(
        self,
        workspace_id: str = None,
        days: int = 7
    ) -> List[dict]:
        """Get access-related events."""
        query = f"""
        FabricActivity
        | where TimeGenerated > ago({days}d)
        | where Operation in (
            "AddWorkspaceAccess",
            "RemoveWorkspaceAccess",
            "UpdateWorkspaceAccess",
            "ShareReport",
            "RevokeAccess"
        )
        """

        if workspace_id:
            query += f"| where WorkspaceId == '{workspace_id}'"

        query += """
        | project
            TimeGenerated,
            Operation,
            UserId,
            WorkspaceId,
            ItemId,
            TargetPrincipal = tostring(parse_json(Properties).targetPrincipal)
        | order by TimeGenerated desc
        """

        return self.logs.query(query)

    def detect_suspicious_activity(self, days: int = 1) -> List[dict]:
        """Detect potentially suspicious security events."""
        alerts = []

        # Check for bulk permission changes
        bulk_changes = self.logs.query(f"""
            FabricActivity
            | where TimeGenerated > ago({days}d)
            | where Operation contains "Access"
            | summarize ChangeCount = count() by UserId, bin(TimeGenerated, 1h)
            | where ChangeCount > 20
        """)

        for change in bulk_changes:
            alerts.append({
                "type": "BulkPermissionChange",
                "user": change["UserId"],
                "count": change["ChangeCount"],
                "severity": "high"
            })

        # Check for access from new locations
        new_locations = self.logs.query(f"""
            SigninLogs
            | where TimeGenerated > ago({days}d)
            | where AppDisplayName contains "Fabric"
            | where ResultType == 0
            | summarize
                Locations = make_set(Location),
                FirstSeen = min(TimeGenerated)
            by UserPrincipalName
            | where array_length(Locations) > 3
        """)

        for location in new_locations:
            alerts.append({
                "type": "MultipleLoginLocations",
                "user": location["UserPrincipalName"],
                "locations": location["Locations"],
                "severity": "medium"
            })

        return alerts

    def generate_security_report(self) -> dict:
        """Generate comprehensive security report."""
        return {
            "access_summary": self._get_access_summary(),
            "permission_changes": self.get_access_events(days=30),
            "suspicious_activity": self.detect_suspicious_activity(days=7),
            "compliance_status": self._check_compliance(),
            "recommendations": self._generate_recommendations()
        }

# Usage
monitor = SecurityMonitor(admin_client, log_analytics_client)

# Generate weekly security report
report = monitor.generate_security_report()
print(f"Suspicious activities: {len(report['suspicious_activity'])}")
```

## Best Practices

1. **Least privilege** - Grant minimum required permissions
2. **Use groups** - Manage access through security groups
3. **Enable auditing** - Track all access and changes
4. **Regular reviews** - Audit permissions periodically
5. **Defense in depth** - Multiple security layers

## What's Next

Tomorrow I'll cover sensitivity labels and data classification.

## Resources

- [Fabric Security Overview](https://learn.microsoft.com/fabric/security/security-overview)
- [Row-Level Security](https://learn.microsoft.com/fabric/security/row-level-security)
- [Workspace Roles](https://learn.microsoft.com/fabric/get-started/roles-workspaces)
