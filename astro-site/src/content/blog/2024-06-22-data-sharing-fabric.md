---
title: "Data Sharing Patterns in Microsoft Fabric"
description: "Data sharing enables collaboration while maintaining security. Today I'm exploring data sharing patterns in Microsoft Fabric."
author: Michael John Peña
draft: false
date: 2024-06-22
tags:
  - Microsoft Fabric
  - Data Sharing
  - OneLake
  - Collaboration
  - Security
---

Data sharing enables collaboration while maintaining security. Today I'm exploring data sharing patterns in Microsoft Fabric.

## Sharing Mechanisms

```
Fabric Sharing Options:
├── Workspace Sharing (role-based)
├── Item Sharing (specific items)
├── OneLake Shortcuts (zero-copy)
├── External Sharing (B2B)
└── API Access (programmatic)
```

## Workspace Sharing

```python
class WorkspaceSharingManager:
    """Manage workspace-level sharing."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def add_user(
        self,
        workspace_id: str,
        user_email: str,
        role: str
    ):
        """Add user to workspace with specific role."""
        valid_roles = ["Admin", "Member", "Contributor", "Viewer"]
        if role not in valid_roles:
            raise ValueError(f"Role must be one of: {valid_roles}")

        self.client.workspaces.add_user(
            workspace_id=workspace_id,
            principal_type="User",
            identifier=user_email,
            role=role
        )

    def add_group(
        self,
        workspace_id: str,
        group_id: str,
        role: str
    ):
        """Add security group to workspace."""
        self.client.workspaces.add_user(
            workspace_id=workspace_id,
            principal_type="Group",
            identifier=group_id,
            role=role
        )

    def set_role_based_access(
        self,
        workspace_id: str,
        access_config: dict
    ):
        """Configure role-based access for a workspace."""
        # Clear existing access (except admins)
        current = self.client.workspaces.get_access(workspace_id)
        for entry in current:
            if entry.role != "Admin":
                self.client.workspaces.remove_access(
                    workspace_id,
                    entry.identifier
                )

        # Apply new configuration
        for role, principals in access_config.items():
            for principal in principals:
                if principal["type"] == "user":
                    self.add_user(workspace_id, principal["email"], role)
                elif principal["type"] == "group":
                    self.add_group(workspace_id, principal["id"], role)

# Usage
manager = WorkspaceSharingManager(fabric_client)

manager.set_role_based_access(
    workspace_id="ws-123",
    access_config={
        "Contributor": [
            {"type": "group", "id": "data-engineers-sg"},
            {"type": "user", "email": "lead@company.com"}
        ],
        "Viewer": [
            {"type": "group", "id": "business-analysts-sg"}
        ]
    }
)
```

## OneLake Shortcuts

```python
class ShortcutManager:
    """Manage OneLake shortcuts for zero-copy data sharing."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def create_internal_shortcut(
        self,
        source_workspace: str,
        source_lakehouse: str,
        source_path: str,
        target_workspace: str,
        target_lakehouse: str,
        shortcut_name: str
    ):
        """Create shortcut to another OneLake location."""
        return self.client.shortcuts.create(
            workspace_id=target_workspace,
            lakehouse_id=target_lakehouse,
            shortcut_name=shortcut_name,
            target={
                "type": "OneLake",
                "workspace_id": source_workspace,
                "item_id": source_lakehouse,
                "path": source_path
            }
        )

    def create_adls_shortcut(
        self,
        target_workspace: str,
        target_lakehouse: str,
        shortcut_name: str,
        storage_account: str,
        container: str,
        path: str
    ):
        """Create shortcut to Azure Data Lake Storage."""
        return self.client.shortcuts.create(
            workspace_id=target_workspace,
            lakehouse_id=target_lakehouse,
            shortcut_name=shortcut_name,
            target={
                "type": "AzureDataLakeStorageGen2",
                "url": f"https://{storage_account}.dfs.core.windows.net/{container}",
                "path": path
            }
        )

    def create_s3_shortcut(
        self,
        target_workspace: str,
        target_lakehouse: str,
        shortcut_name: str,
        bucket: str,
        path: str,
        connection_id: str
    ):
        """Create shortcut to AWS S3."""
        return self.client.shortcuts.create(
            workspace_id=target_workspace,
            lakehouse_id=target_lakehouse,
            shortcut_name=shortcut_name,
            target={
                "type": "AmazonS3",
                "bucket": bucket,
                "path": path,
                "connection_id": connection_id
            }
        )

# Usage: Share data product via shortcut
shortcut_mgr = ShortcutManager(fabric_client)

# Finance domain shares revenue data with Analytics domain
shortcut_mgr.create_internal_shortcut(
    source_workspace="FIN-Revenue-PROD",
    source_lakehouse="revenue_lakehouse",
    source_path="Tables/daily_revenue",
    target_workspace="Analytics-Central",
    target_lakehouse="analytics_lakehouse",
    shortcut_name="finance_daily_revenue"
)
```

## External Sharing (B2B)

```python
class ExternalSharingManager:
    """Manage sharing with external organizations."""

    def __init__(self, fabric_client, graph_client):
        self.fabric = fabric_client
        self.graph = graph_client

    async def invite_external_user(
        self,
        email: str,
        workspace_id: str,
        role: str,
        message: str = None
    ):
        """Invite external user via B2B."""
        # Create B2B invitation
        invitation = await self.graph.invitations.create(
            invited_user_email_address=email,
            invite_redirect_url="https://app.fabric.microsoft.com",
            send_invitation_message=True,
            invited_user_message_info={
                "customized_message_body": message
            }
        )

        # Wait for invitation acceptance (or handle async)
        invited_user_id = invitation.invited_user.id

        # Add to workspace
        self.fabric.workspaces.add_user(
            workspace_id=workspace_id,
            principal_type="User",
            identifier=invited_user_id,
            role=role
        )

        return invitation

    def create_share_link(
        self,
        item_id: str,
        item_type: str,
        link_type: str = "organization",
        expiry_days: int = None
    ):
        """Create shareable link for an item."""
        link_config = {
            "type": link_type,  # "anyone", "organization", "specific_people"
            "scope": "view"
        }

        if expiry_days:
            link_config["expiration"] = (
                datetime.utcnow() + timedelta(days=expiry_days)
            ).isoformat()

        return self.fabric.items.create_link(
            item_id=item_id,
            item_type=item_type,
            link_config=link_config
        )

    def share_with_specific_people(
        self,
        item_id: str,
        item_type: str,
        recipients: list,
        message: str = None
    ):
        """Share item with specific people (internal or external)."""
        return self.fabric.items.share(
            item_id=item_id,
            item_type=item_type,
            recipients=[
                {"email": r["email"], "role": r.get("role", "Viewer")}
                for r in recipients
            ],
            notify=True,
            message=message
        )
```

## Row-Level Security

```python
class RowLevelSecurityManager:
    """Implement row-level security for shared data."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def create_security_role(
        self,
        dataset_id: str,
        role_name: str,
        filter_expression: str
    ):
        """Create an RLS role with DAX filter."""
        return self.client.datasets.create_role(
            dataset_id=dataset_id,
            role={
                "name": role_name,
                "table_permissions": [
                    {
                        "table_name": "Sales",
                        "filter_expression": filter_expression
                    }
                ]
            }
        )

    def assign_user_to_role(
        self,
        dataset_id: str,
        role_name: str,
        user_email: str
    ):
        """Assign user to an RLS role."""
        return self.client.datasets.add_role_member(
            dataset_id=dataset_id,
            role_name=role_name,
            member={
                "email_address": user_email
            }
        )

# Example: Regional data access
rls_manager = RowLevelSecurityManager(fabric_client)

# Create roles for each region
regions = ["North", "South", "East", "West"]
for region in regions:
    rls_manager.create_security_role(
        dataset_id="sales-dataset-id",
        role_name=f"{region}Region",
        filter_expression=f"[Region] = \"{region}\""
    )

# Assign users to their regions
rls_manager.assign_user_to_role(
    dataset_id="sales-dataset-id",
    role_name="NorthRegion",
    user_email="north-manager@company.com"
)
```

## Dynamic Data Masking

```sql
-- Implement data masking in Fabric Warehouse
CREATE TABLE customers (
    customer_id VARCHAR(20) NOT NULL,
    full_name VARCHAR(200) MASKED WITH (FUNCTION = 'partial(1, "***", 1)'),
    email VARCHAR(200) MASKED WITH (FUNCTION = 'email()'),
    phone VARCHAR(20) MASKED WITH (FUNCTION = 'partial(0, "XXX-XXX-", 4)'),
    ssn VARCHAR(11) MASKED WITH (FUNCTION = 'default()'),
    credit_card VARCHAR(20) MASKED WITH (FUNCTION = 'partial(0, "XXXX-XXXX-XXXX-", 4)'),
    salary DECIMAL(18,2) MASKED WITH (FUNCTION = 'random(1000, 100000)')
);

-- Grant unmask permission to specific users
GRANT UNMASK TO [finance-team@company.com];

-- Verify masking
EXECUTE AS USER = 'regular-user@company.com';
SELECT * FROM customers;
-- Shows: J*** D**, r***@***.com, XXX-XXX-1234, xxxx, XXXX-XXXX-XXXX-5678, 45678.00

REVERT;
EXECUTE AS USER = 'finance-team@company.com';
SELECT * FROM customers;
-- Shows: John Doe, real@email.com, 555-123-1234, 123-45-6789, 1234-5678-9012-5678, 85000.00
```

## Sharing Governance

```python
class SharingGovernance:
    """Enforce sharing policies."""

    def __init__(self, admin_client):
        self.admin = admin_client

    def get_external_sharing_report(self) -> dict:
        """Audit external sharing across tenant."""
        all_shares = self.admin.sharing.list_all_shares()

        report = {
            "total_external_shares": 0,
            "by_workspace": {},
            "by_item_type": {},
            "external_users": set()
        }

        for share in all_shares:
            if share.is_external:
                report["total_external_shares"] += 1
                report["external_users"].add(share.recipient_email)

                ws = share.workspace_name
                report["by_workspace"][ws] = report["by_workspace"].get(ws, 0) + 1

                item_type = share.item_type
                report["by_item_type"][item_type] = report["by_item_type"].get(item_type, 0) + 1

        report["external_users"] = list(report["external_users"])
        return report

    def enforce_sharing_policy(
        self,
        policy: dict
    ):
        """Enforce tenant-wide sharing policies."""
        # Block public links
        if not policy.get("allow_public_links", False):
            self.admin.tenant_settings.update(
                "PublishToWeb",
                enabled=False
            )

        # Restrict external sharing
        if policy.get("external_sharing_groups"):
            self.admin.tenant_settings.update(
                "AllowExternalGuestSharing",
                enabled=True,
                enabled_security_groups=policy["external_sharing_groups"]
            )

        # Require sensitivity labels for sharing
        if policy.get("require_label_for_sharing"):
            self.admin.tenant_settings.update(
                "RequireSensitivityLabelForSharing",
                enabled=True
            )
```

## Best Practices

1. **Principle of least privilege** - Start with Viewer, escalate as needed
2. **Use groups** - Don't manage individual access
3. **Prefer shortcuts** - Zero-copy, no duplication
4. **Audit regularly** - Review external sharing
5. **Apply RLS** - Row-level security for sensitive data

## What's Next

Tomorrow I'll cover external data access patterns.

## Resources

- [Fabric Sharing](https://learn.microsoft.com/fabric/admin/sharing)
- [OneLake Shortcuts](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts)
- [Row-Level Security](https://learn.microsoft.com/fabric/security/row-level-security)
