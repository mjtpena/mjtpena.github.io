---
title: "Fabric Admin Updates: Governance and Management"
description: "Fabric administration has matured significantly. Today I'm covering the latest admin capabilities for managing your Fabric environment effectively."
author: Michael John Peña
draft: false
date: 2024-06-11
tags:
  - Microsoft Fabric
  - Administration
  - Governance
  - Security
  - Management
---

Fabric administration has matured significantly. Today I'm covering the latest admin capabilities for managing your Fabric environment effectively.

## Admin Portal Overview

The Fabric Admin Portal provides centralized management for:
- Tenant settings
- Capacity management
- Usage metrics
- Audit logs
- Domain management

## Tenant Settings

### Feature Controls

```powershell
# Using Fabric Admin REST API
$headers = @{
    "Authorization" = "Bearer $accessToken"
    "Content-Type" = "application/json"
}

# Get current tenant settings
$settings = Invoke-RestMethod `
    -Uri "https://api.fabric.microsoft.com/v1/admin/tenantsettings" `
    -Headers $headers `
    -Method Get

# Update a tenant setting
$body = @{
    "settingName" = "enableExternalDataSharing"
    "enabled" = $true
    "tenantSettingGroup" = "DataSharing"
    "enabledSecurityGroups" = @(
        @{
            "graphId" = "security-group-id"
            "name" = "Data Engineers"
        }
    )
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "https://api.fabric.microsoft.com/v1/admin/tenantsettings" `
    -Headers $headers `
    -Method Patch `
    -Body $body
```

### Key Settings Categories

```yaml
Export and Sharing:
  - Export to Excel
  - Export to CSV
  - External sharing
  - Publish to web

Content Pack and App Settings:
  - Create template apps
  - Push apps to users
  - Publish content packs

Integration Settings:
  - Azure services integration
  - Power Platform integration
  - External tools

Developer Settings:
  - API access
  - Service principals
  - Embed content
```

## Capacity Management

### Monitoring Capacity Usage

```python
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Get capacity metrics via Admin API
capacity_id = "your-capacity-id"
admin_url = "https://api.fabric.microsoft.com/v1/admin"

# List capacities
capacities_response = requests.get(f"{admin_url}/capacities", headers=headers)
capacities = capacities_response.json().get("value", [])

for capacity in capacities:
    print(f"Capacity: {capacity['displayName']}")
    print(f"  SKU: {capacity['sku']}")
    print(f"  State: {capacity['state']}")
    print(f"  Region: {capacity['region']}")

# Get capacity details
capacity_response = requests.get(f"{admin_url}/capacities/{capacity_id}", headers=headers)
capacity_details = capacity_response.json()
print(f"Capacity Details: {capacity_details}")

# Note: Detailed metrics are available in the Fabric Capacity Metrics app
# or via Azure Monitor for comprehensive monitoring
```

### Auto-Scale Configuration

```python
# Configure auto-scaling
autoscale_config = {
    "enabled": True,
    "minCapacity": "F2",
    "maxCapacity": "F64",
    "scaleUpThreshold": 80,  # CU usage %
    "scaleDownThreshold": 20,
    "cooldownPeriodMinutes": 10,
    "schedule": {
        "businessHours": {
            "minCapacity": "F16",
            "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            "startTime": "08:00",
            "endTime": "18:00",
            "timezone": "America/Los_Angeles"
        }
    }
}

admin_client.capacities.update_autoscale(
    capacity_id=capacity_id,
    config=autoscale_config
)
```

### Capacity Assignment

```python
# Assign workspaces to capacity
workspaces_to_assign = [
    "workspace-id-1",
    "workspace-id-2",
    "workspace-id-3"
]

for ws_id in workspaces_to_assign:
    admin_client.workspaces.assign_to_capacity(
        workspace_id=ws_id,
        capacity_id=capacity_id
    )
    print(f"Assigned workspace {ws_id} to capacity {capacity_id}")

# Bulk assignment
admin_client.capacities.bulk_assign_workspaces(
    capacity_id=capacity_id,
    workspace_ids=workspaces_to_assign
)
```

## Workspace Governance

### Workspace Inventory

```python
# Get all workspaces in tenant
workspaces = admin_client.workspaces.list_all(
    include_personal=False,
    include_orphaned=True
)

# Analyze workspace state
stats = {
    "total": 0,
    "by_state": {},
    "by_capacity": {},
    "orphaned": 0
}

for ws in workspaces:
    stats["total"] += 1
    stats["by_state"][ws.state] = stats["by_state"].get(ws.state, 0) + 1

    if ws.capacity_id:
        stats["by_capacity"][ws.capacity_id] = stats["by_capacity"].get(ws.capacity_id, 0) + 1
    else:
        stats["orphaned"] += 1

print(f"Total workspaces: {stats['total']}")
print(f"Orphaned: {stats['orphaned']}")
```

### Workspace Naming Conventions

```python
import re

def validate_workspace_name(name: str, pattern: str) -> dict:
    """Validate workspace naming convention."""
    # Example pattern: "DEPT-PROJECT-ENV" like "FIN-SALES-PROD"
    if not re.match(pattern, name):
        return {
            "valid": False,
            "message": f"Name '{name}' doesn't match pattern '{pattern}'"
        }
    return {"valid": True}

# Check all workspaces
naming_pattern = r"^[A-Z]{2,5}-[A-Z0-9]+-(?:DEV|TEST|PROD)$"
violations = []

for ws in workspaces:
    result = validate_workspace_name(ws.name, naming_pattern)
    if not result["valid"]:
        violations.append({
            "workspace_id": ws.id,
            "name": ws.name,
            "issue": result["message"]
        })

print(f"Naming violations: {len(violations)}")
```

## Audit and Compliance

### Activity Logs

```python
from datetime import datetime, timedelta

# Get audit logs
end_time = datetime.utcnow()
start_time = end_time - timedelta(days=7)

audit_logs = admin_client.audit.get_activity_events(
    start_date=start_time.isoformat(),
    end_date=end_time.isoformat(),
    filter={
        "activity": ["ExportReport", "ShareReport", "DeleteReport"]
    }
)

# Analyze sensitive activities
sensitive_activities = [
    event for event in audit_logs
    if event.activity in ["ExportReport", "ShareReport"]
]

for event in sensitive_activities[:10]:
    print(f"{event.timestamp}: {event.user} - {event.activity} - {event.item_name}")
```

### Compliance Reports

```python
def generate_compliance_report(admin_client, days: int = 30) -> dict:
    """Generate compliance report for the tenant."""

    report = {
        "generated": datetime.utcnow().isoformat(),
        "period_days": days,
        "sections": {}
    }

    # External sharing
    external_shares = admin_client.audit.get_activity_events(
        start_date=(datetime.utcnow() - timedelta(days=days)).isoformat(),
        filter={"activity": ["ShareReport", "ShareDashboard"]},
        filter_external=True
    )
    report["sections"]["external_sharing"] = {
        "count": len(external_shares),
        "details": [{"user": e.user, "item": e.item_name, "date": e.timestamp} for e in external_shares[:100]]
    }

    # Data exports
    exports = admin_client.audit.get_activity_events(
        start_date=(datetime.utcnow() - timedelta(days=days)).isoformat(),
        filter={"activity": ["ExportReport", "ExportDataflow"]}
    )
    report["sections"]["exports"] = {
        "count": len(exports),
        "by_user": {}
    }
    for exp in exports:
        report["sections"]["exports"]["by_user"][exp.user] = \
            report["sections"]["exports"]["by_user"].get(exp.user, 0) + 1

    # Sensitivity labels
    unlabeled = admin_client.items.list_all(
        filter={"sensitivity_label": None}
    )
    report["sections"]["unlabeled_items"] = {
        "count": len(unlabeled),
        "sample": [{"id": i.id, "name": i.name, "type": i.type} for i in unlabeled[:50]]
    }

    return report
```

## Domain Management

```python
# Create a domain
domain = admin_client.domains.create(
    name="Finance",
    description="Finance department data assets",
    admins=["admin@company.com"],
    contributors=["finance-team@company.com"]
)

# Assign workspaces to domain
admin_client.domains.assign_workspaces(
    domain_id=domain.id,
    workspace_ids=["ws-fin-1", "ws-fin-2", "ws-fin-3"]
)

# Set domain policies
admin_client.domains.set_policies(
    domain_id=domain.id,
    policies={
        "require_sensitivity_label": True,
        "allowed_sensitivity_labels": ["Confidential", "Internal"],
        "require_endorsement_for_publish": True,
        "data_retention_days": 365
    }
)
```

## Monitoring Dashboard

```python
from azure.identity import DefaultAzureCredential
from datetime import datetime
import requests

def create_admin_dashboard_data():
    """Collect data for admin monitoring dashboard via REST API."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default").token
    headers = {"Authorization": f"Bearer {token}"}
    admin_url = "https://api.fabric.microsoft.com/v1/admin"

    dashboard_data = {
        "timestamp": datetime.utcnow().isoformat(),
        "capacity": {},
        "workspaces": {},
        "items": {}
    }

    # Get capacities
    capacities = requests.get(f"{admin_url}/capacities", headers=headers).json().get("value", [])
    dashboard_data["capacity"] = {
        "total_capacities": len(capacities),
        "by_state": {}
    }
    for cap in capacities:
        state = cap.get("state", "unknown")
        dashboard_data["capacity"]["by_state"][state] = dashboard_data["capacity"]["by_state"].get(state, 0) + 1

    # Get workspaces
    workspaces = requests.get(f"{admin_url}/workspaces", headers=headers).json().get("value", [])
    dashboard_data["workspaces"] = {
        "total": len(workspaces)
    }

    # Count items by type across workspaces
    item_counts = {"Report": 0, "SemanticModel": 0, "Lakehouse": 0, "Warehouse": 0}
    for ws in workspaces[:10]:  # Sample first 10 for performance
        items = requests.get(f"{admin_url}/workspaces/{ws['id']}/items", headers=headers).json().get("value", [])
        for item in items:
            item_type = item.get("type")
            if item_type in item_counts:
                item_counts[item_type] += 1

    dashboard_data["items"] = item_counts

    return dashboard_data

# Usage
data = create_admin_dashboard_data()
print(f"Total workspaces: {data['workspaces']['total']}")
print(f"Capacities: {data['capacity']}")
```

## Best Practices

1. **Regular audits** - Review activity logs weekly
2. **Capacity monitoring** - Set up alerts for high usage
3. **Governance policies** - Implement naming conventions
4. **Domain structure** - Organize by business domain
5. **Access reviews** - Quarterly permission audits

## What's Next

Tomorrow I'll cover capacity management in more detail.

## Resources

- [Fabric Admin Portal](https://learn.microsoft.com/fabric/admin/)
- [Tenant Settings](https://learn.microsoft.com/fabric/admin/tenant-settings)
- [Capacity Management](https://learn.microsoft.com/fabric/admin/capacity-settings)
