---
title: Working with Azure Activity Logs for Audit and Compliance
author: Michael John Peña
draft: false
date: 2021-07-22
url: /blog/activity-logs/
tags:
  - Azure
  - Monitoring
  - Security
  - Compliance
  - Governance

---

I wrote "2021-07-22-activity-logs" to share practical, production-minded guidance on this topic.

# Understanding Activity Log Categories

Activity Logs include several categories:

- **Administrative**: Resource management operations (create, update, delete)
- **Security**: Security Center alerts and recommendations
- **Service Health**: Azure service incidents and maintenance
- **Alert**: Metric and log alert activations
- **Recommendation**: Azure Advisor recommendations
- **Policy**: Azure Policy evaluations
- **Autoscale**: Autoscale operations
- **Resource Health**: Resource availability changes

# Querying Activity Logs

Query Activity Logs using Azure CLI:

```bash
# Get all activity logs from last 24 hours
az monitor activity-log list \
    --start-time $(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ') \
    --output table

# Filter by operation type
az monitor activity-log list \
    --start-time $(date -u -d '7 days ago' '+%Y-%m-%dT%H:%M:%SZ') \
    --filter "operationName eq 'Microsoft.Authorization/roleAssignments/write'" \
    --output table

# Filter by resource group
az monitor activity-log list \
    --resource-group rg-production \
    --start-time $(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ')

# Get failed operations
az monitor activity-log list \
    --start-time $(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ') \
    --filter "status eq 'Failed'" \
    --output table
```

# Python SDK for Activity Logs

Query and analyze activity logs programmatically:

```python
from azure.mgmt.monitor import MonitorManagementClient
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta
import pandas as pd

credential = DefaultAzureCredential()
monitor_client = MonitorManagementClient(credential, subscription_id)

def get_activity_logs(days=7, filter_str=None):
    """Get activity logs with optional filtering."""

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(days=days)

    # Build filter
    time_filter = f"eventTimestamp ge '{start_time.isoformat()}Z' and eventTimestamp le '{end_time.isoformat()}Z'"

    if filter_str:
        full_filter = f"{time_filter} and {filter_str}"
    else:
        full_filter = time_filter

    logs = monitor_client.activity_logs.list(filter=full_filter)

    results = []
    for log in logs:
        results.append({
            "timestamp": log.event_timestamp,
            "operation": log.operation_name.localized_value if log.operation_name else None,
            "status": log.status.value if log.status else None,
            "caller": log.caller,
            "resource_type": log.resource_type.value if log.resource_type else None,
            "resource_id": log.resource_id,
            "category": log.category.value if log.category else None,
            "level": log.level.value if log.level else None,
            "description": log.description
        })

    return pd.DataFrame(results)

# Get all administrative operations
admin_logs = get_activity_logs(
    days=7,
    filter_str="category eq 'Administrative'"
)

print(f"Total administrative operations: {len(admin_logs)}")
print(admin_logs.head())

# Analyze by operation type
operation_counts = admin_logs.groupby("operation").size().sort_values(ascending=False)
print("\nTop operations:")
print(operation_counts.head(10))
```

# Security Audit Queries

Audit security-relevant operations:

```python
def audit_role_assignments(days=30):
    """Audit all role assignment changes."""

    logs = get_activity_logs(
        days=days,
        filter_str="operationName eq 'Microsoft.Authorization/roleAssignments/write' or operationName eq 'Microsoft.Authorization/roleAssignments/delete'"
    )

    print(f"\nRole assignment changes in last {days} days: {len(logs)}")

    for _, log in logs.iterrows():
        action = "Created" if "write" in str(log["operation"]) else "Deleted"
        print(f"{log['timestamp']}: {action} by {log['caller']}")
        print(f"  Resource: {log['resource_id']}")
        print(f"  Status: {log['status']}")
        print()

    return logs

def audit_resource_deletions(days=7):
    """Audit all resource deletions."""

    logs = get_activity_logs(
        days=days,
        filter_str="operationName contains 'delete' and status eq 'Succeeded'"
    )

    deleted_resources = logs[logs["operation"].str.contains("Delete", case=False, na=False)]

    print(f"\nSuccessful deletions in last {days} days: {len(deleted_resources)}")

    # Group by resource type
    by_type = deleted_resources.groupby("resource_type").size().sort_values(ascending=False)
    print("\nDeletions by resource type:")
    print(by_type)

    return deleted_resources

def audit_failed_operations(days=1):
    """Audit failed operations for troubleshooting."""

    logs = get_activity_logs(
        days=days,
        filter_str="status eq 'Failed'"
    )

    print(f"\nFailed operations in last {days} days: {len(logs)}")

    # Group by operation
    by_operation = logs.groupby("operation").size().sort_values(ascending=False)
    print("\nFailed operations by type:")
    print(by_operation.head(10))

    return logs

# Run security audits
role_changes = audit_role_assignments(days=30)
deletions = audit_resource_deletions(days=7)
failures = audit_failed_operations(days=1)
```

# Exporting Activity Logs

Configure long-term export to storage:

```hcl
# Diagnostic setting for Activity Log
resource "azurerm_monitor_diagnostic_setting" "activity_log_export" {
  name                       = "activity-log-export"
  target_resource_id         = "/subscriptions/${data.azurerm_subscription.current.subscription_id}"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  storage_account_id         = azurerm_storage_account.audit.id

  enabled_log {
    category = "Administrative"
  }

  enabled_log {
    category = "Security"
  }

  enabled_log {
    category = "ServiceHealth"
  }

  enabled_log {
    category = "Alert"
  }

  enabled_log {
    category = "Recommendation"
  }

  enabled_log {
    category = "Policy"
  }

  enabled_log {
    category = "Autoscale"
  }

  enabled_log {
    category = "ResourceHealth"
  }
}

# Storage account for compliance retention
resource "azurerm_storage_account" "audit" {
  name                     = "auditlogsstorage"
  resource_group_name      = azurerm_resource_group.compliance.name
  location                 = azurerm_resource_group.compliance.location
  account_tier             = "Standard"
  account_replication_type = "GRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 365
    }
  }

  # Immutable storage for compliance
  immutability_policy {
    allow_protected_append_writes = true
    period_since_creation_in_days = 365
    state                         = "Locked"
  }

  tags = {
    Purpose    = "Audit Logs"
    Compliance = "Required"
  }
}
```

# Log Analytics Queries

Query Activity Logs in Log Analytics:

```kusto
// All resource creations
AzureActivity
| where OperationNameValue contains "write"
| where ActivityStatusValue == "Success"
| where TimeGenerated > ago(7d)
| project TimeGenerated, Caller, OperationNameValue, ResourceGroup, _ResourceId
| order by TimeGenerated desc

// Administrative changes by user
AzureActivity
| where CategoryValue == "Administrative"
| where TimeGenerated > ago(30d)
| summarize OperationCount = count() by Caller
| order by OperationCount desc
| take 20

// Failed operations with error details
AzureActivity
| where ActivityStatusValue == "Failed"
| where TimeGenerated > ago(24h)
| project TimeGenerated, Caller, OperationNameValue, ResourceGroup,
          Properties_d.statusMessage, Properties_d.statusCode
| order by TimeGenerated desc

// Policy evaluation failures
AzureActivity
| where CategoryValue == "Policy"
| where ActivityStatusValue == "Failed"
| where TimeGenerated > ago(7d)
| project TimeGenerated, OperationNameValue, ResourceGroup, Properties_d.message
| order by TimeGenerated desc

// RBAC changes
AzureActivity
| where OperationNameValue has "Microsoft.Authorization/roleAssignments"
| where TimeGenerated > ago(30d)
| extend RoleDefinitionId = tostring(parse_json(tostring(Properties_d.requestbody)).Properties.RoleDefinitionId)
| extend PrincipalId = tostring(parse_json(tostring(Properties_d.requestbody)).Properties.PrincipalId)
| project TimeGenerated, Caller, OperationNameValue, RoleDefinitionId, PrincipalId, ActivityStatusValue
| order by TimeGenerated desc

// Resource health changes
AzureActivity
| where CategoryValue == "ResourceHealth"
| where TimeGenerated > ago(7d)
| project TimeGenerated, _ResourceId, OperationNameValue, Properties_d
| order by TimeGenerated desc
```

# Creating Alerts on Activity Logs

Set up alerts for critical operations:

```python
def create_activity_log_alert(name, operation_name, severity=2):
    """Create an alert for specific activity log operations."""

    alert = monitor_client.activity_log_alerts.create_or_update(
        resource_group_name="rg-monitoring",
        activity_log_alert_name=name,
        activity_log_alert={
            "location": "global",
            "scopes": [f"/subscriptions/{subscription_id}"],
            "enabled": True,
            "condition": {
                "allOf": [
                    {
                        "field": "category",
                        "equals": "Administrative"
                    },
                    {
                        "field": "operationName",
                        "equals": operation_name
                    },
                    {
                        "field": "status",
                        "equals": "Succeeded"
                    }
                ]
            },
            "actions": {
                "actionGroups": [{
                    "actionGroupId": f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/security-team"
                }]
            },
            "description": f"Alert when {operation_name} occurs"
        }
    )

    return alert

# Create alerts for security-sensitive operations
alerts_to_create = [
    ("role-assignment-alert", "Microsoft.Authorization/roleAssignments/write"),
    ("policy-assignment-alert", "Microsoft.Authorization/policyAssignments/write"),
    ("keyvault-secret-delete", "Microsoft.KeyVault/vaults/secrets/delete"),
    ("nsg-rule-write", "Microsoft.Network/networkSecurityGroups/securityRules/write"),
    ("diagnostic-setting-delete", "Microsoft.Insights/diagnosticSettings/delete")
]

for name, operation in alerts_to_create:
    create_activity_log_alert(name, operation)
    print(f"Created alert: {name}")
```

# Compliance Reporting

Generate compliance reports from Activity Logs:

```python
def generate_compliance_report(days=30):
    """Generate a compliance report from Activity Logs."""

    logs_df = get_activity_logs(days=days)

    report = {
        "period": f"Last {days} days",
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "total_operations": len(logs_df),
            "successful": len(logs_df[logs_df["status"] == "Succeeded"]),
            "failed": len(logs_df[logs_df["status"] == "Failed"]),
            "unique_callers": logs_df["caller"].nunique()
        },
        "by_category": logs_df.groupby("category").size().to_dict(),
        "security_events": {},
        "high_risk_operations": []
    }

    # Security-relevant operations
    security_operations = [
        "Microsoft.Authorization/roleAssignments",
        "Microsoft.Authorization/policyAssignments",
        "Microsoft.KeyVault",
        "Microsoft.Network/networkSecurityGroups"
    ]

    for op in security_operations:
        op_logs = logs_df[logs_df["operation"].str.contains(op, case=False, na=False)]
        report["security_events"][op] = {
            "count": len(op_logs),
            "successful": len(op_logs[op_logs["status"] == "Succeeded"]),
            "callers": op_logs["caller"].unique().tolist()
        }

    # High-risk operations (deletions, permission changes)
    high_risk = logs_df[
        (logs_df["operation"].str.contains("delete", case=False, na=False)) |
        (logs_df["operation"].str.contains("roleAssignment", case=False, na=False))
    ]

    for _, row in high_risk.iterrows():
        report["high_risk_operations"].append({
            "timestamp": row["timestamp"].isoformat() if pd.notna(row["timestamp"]) else None,
            "operation": row["operation"],
            "caller": row["caller"],
            "resource": row["resource_id"],
            "status": row["status"]
        })

    return report

# Generate and save report
report = generate_compliance_report(days=30)

import json
with open("compliance_report.json", "w") as f:
    json.dump(report, f, indent=2, default=str)

print(f"Report generated: {report['summary']}")
```

# Conclusion

Azure Activity Logs are fundamental for governance, compliance, and security in Azure. They provide a complete audit trail of control plane operations, enabling you to track who did what, when, and to which resources.

Best practices include exporting logs to long-term storage for compliance, setting up alerts on security-sensitive operations, and regularly reviewing logs for suspicious activity. Combined with Log Analytics queries, Activity Logs give you the visibility needed to maintain secure and compliant Azure environments.

