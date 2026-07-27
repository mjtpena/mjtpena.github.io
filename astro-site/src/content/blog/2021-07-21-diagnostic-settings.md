---
title: Configuring Azure Diagnostic Settings for Comprehensive Logging
author: Michael John Peña
draft: false
date: 2021-07-21
url: /blog/diagnostic-settings/
tags:
  - Azure
  - Monitoring
  - Logging
  - DevOps
  - Observability

---

I wrote "2021-07-21-diagnostic-settings" to share practical, production-minded guidance on this topic.

# Understanding Diagnostic Data

Azure resources produce several types of diagnostic data:

- **Platform Metrics**: Numerical performance data
- **Resource Logs**: Detailed operational logs (formerly diagnostic logs)
- **Activity Logs**: Subscription-level events

# Creating Diagnostic Settings

Configure diagnostics using Azure CLI:

```bash
# Create diagnostic setting for a storage account
az monitor diagnostic-settings create \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/mystorageaccount \
    --name storage-diagnostics \
    --workspace /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-monitoring/providers/Microsoft.OperationalInsights/workspaces/log-analytics-ws \
    --storage-account /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-monitoring/providers/Microsoft.Storage/storageAccounts/diagnosticsstorage \
    --logs '[
        {"category": "StorageRead", "enabled": true, "retentionPolicy": {"enabled": true, "days": 90}},
        {"category": "StorageWrite", "enabled": true, "retentionPolicy": {"enabled": true, "days": 90}},
        {"category": "StorageDelete", "enabled": true, "retentionPolicy": {"enabled": true, "days": 90}}
    ]' \
    --metrics '[{"category": "Transaction", "enabled": true, "retentionPolicy": {"enabled": true, "days": 90}}]'

# List available log categories for a resource type
az monitor diagnostic-settings categories list \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-sql/providers/Microsoft.Sql/servers/sqlserver/databases/mydb
```

# Terraform Configuration

Comprehensive diagnostic settings with Terraform:

```hcl
# Log Analytics Workspace
resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-analytics-ws"
  resource_group_name = azurerm_resource_group.monitoring.name
  location            = azurerm_resource_group.monitoring.location
  sku                 = "PerGB2018"
  retention_in_days   = 90

  tags = {
    Environment = "Production"
  }
}

# Storage account for long-term retention
resource "azurerm_storage_account" "diagnostics" {
  name                     = "diagnosticsstorage"
  resource_group_name      = azurerm_resource_group.monitoring.name
  location                 = azurerm_resource_group.monitoring.location
  account_tier             = "Standard"
  account_replication_type = "GRS"

  tags = {
    Purpose = "Diagnostics"
  }
}

# Event Hub for streaming
resource "azurerm_eventhub_namespace" "diagnostics" {
  name                = "diagnostics-eventhub-ns"
  resource_group_name = azurerm_resource_group.monitoring.name
  location            = azurerm_resource_group.monitoring.location
  sku                 = "Standard"
  capacity            = 2

  tags = {
    Purpose = "Diagnostics Streaming"
  }
}

resource "azurerm_eventhub" "diagnostics" {
  name                = "diagnostics-hub"
  namespace_name      = azurerm_eventhub_namespace.diagnostics.name
  resource_group_name = azurerm_resource_group.monitoring.name
  partition_count     = 4
  message_retention   = 7
}

# Key Vault Diagnostic Settings
resource "azurerm_monitor_diagnostic_setting" "keyvault" {
  name                       = "keyvault-diagnostics"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  storage_account_id         = azurerm_storage_account.diagnostics.id

  enabled_log {
    category = "AuditEvent"
  }

  enabled_log {
    category = "AzurePolicyEvaluationDetails"
  }

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

# Azure SQL Database Diagnostic Settings
resource "azurerm_monitor_diagnostic_setting" "sql" {
  name                       = "sql-diagnostics"
  target_resource_id         = azurerm_mssql_database.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "SQLInsights"
  }

  enabled_log {
    category = "AutomaticTuning"
  }

  enabled_log {
    category = "QueryStoreRuntimeStatistics"
  }

  enabled_log {
    category = "QueryStoreWaitStatistics"
  }

  enabled_log {
    category = "Errors"
  }

  enabled_log {
    category = "DatabaseWaitStatistics"
  }

  enabled_log {
    category = "Timeouts"
  }

  enabled_log {
    category = "Blocks"
  }

  enabled_log {
    category = "Deadlocks"
  }

  metric {
    category = "Basic"
    enabled  = true
  }

  metric {
    category = "InstanceAndAppAdvanced"
    enabled  = true
  }

  metric {
    category = "WorkloadManagement"
    enabled  = true
  }
}

# Azure Firewall Diagnostic Settings
resource "azurerm_monitor_diagnostic_setting" "firewall" {
  name                           = "firewall-diagnostics"
  target_resource_id             = azurerm_firewall.main.id
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.main.id
  eventhub_authorization_rule_id = azurerm_eventhub_namespace_authorization_rule.diagnostics.id
  eventhub_name                  = azurerm_eventhub.diagnostics.name

  enabled_log {
    category = "AzureFirewallApplicationRule"
  }

  enabled_log {
    category = "AzureFirewallNetworkRule"
  }

  enabled_log {
    category = "AzureFirewallDnsProxy"
  }

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

# App Service Diagnostic Settings
resource "azurerm_monitor_diagnostic_setting" "appservice" {
  name                       = "appservice-diagnostics"
  target_resource_id         = azurerm_app_service.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AppServiceHTTPLogs"
  }

  enabled_log {
    category = "AppServiceConsoleLogs"
  }

  enabled_log {
    category = "AppServiceAppLogs"
  }

  enabled_log {
    category = "AppServiceAuditLogs"
  }

  enabled_log {
    category = "AppServiceIPSecAuditLogs"
  }

  enabled_log {
    category = "AppServicePlatformLogs"
  }

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}
```

# Activity Log Configuration

Configure subscription-level activity log export:

```hcl
# Activity Log Diagnostic Setting
resource "azurerm_monitor_diagnostic_setting" "activity_log" {
  name                       = "activity-log-diagnostics"
  target_resource_id         = "/subscriptions/${data.azurerm_subscription.current.subscription_id}"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  storage_account_id         = azurerm_storage_account.diagnostics.id

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
```

# Automating Diagnostic Settings

Deploy diagnostic settings across all resources:

```python
from azure.mgmt.monitor import MonitorManagementClient
from azure.mgmt.resource import ResourceManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
monitor_client = MonitorManagementClient(credential, subscription_id)
resource_client = ResourceManagementClient(credential, subscription_id)

# Log categories by resource type
LOG_CATEGORIES = {
    "Microsoft.KeyVault/vaults": ["AuditEvent"],
    "Microsoft.Sql/servers/databases": ["SQLInsights", "Errors", "Deadlocks", "QueryStoreRuntimeStatistics"],
    "Microsoft.Storage/storageAccounts/blobServices": ["StorageRead", "StorageWrite", "StorageDelete"],
    "Microsoft.Web/sites": ["AppServiceHTTPLogs", "AppServiceConsoleLogs", "AppServiceAppLogs"],
    "Microsoft.Network/applicationGateways": ["ApplicationGatewayAccessLog", "ApplicationGatewayPerformanceLog", "ApplicationGatewayFirewallLog"],
    "Microsoft.ContainerRegistry/registries": ["ContainerRegistryRepositoryEvents", "ContainerRegistryLoginEvents"]
}

def ensure_diagnostic_settings(resource, workspace_id, storage_id):
    """Ensure diagnostic settings exist for a resource."""

    resource_type = resource.type

    if resource_type not in LOG_CATEGORIES:
        return None

    categories = LOG_CATEGORIES[resource_type]

    # Check if diagnostic setting already exists
    existing = list(monitor_client.diagnostic_settings.list(resource.id))
    if existing:
        print(f"Diagnostic settings already exist for {resource.name}")
        return existing[0]

    # Create diagnostic setting
    logs = [{"category": cat, "enabled": True, "retention_policy": {"enabled": True, "days": 90}} for cat in categories]

    setting = monitor_client.diagnostic_settings.create_or_update(
        resource_uri=resource.id,
        name=f"{resource.name}-diagnostics",
        parameters={
            "workspace_id": workspace_id,
            "storage_account_id": storage_id,
            "logs": logs,
            "metrics": [{"category": "AllMetrics", "enabled": True, "retention_policy": {"enabled": True, "days": 90}}]
        }
    )

    print(f"Created diagnostic settings for {resource.name}")
    return setting

# Apply to all resources in subscription
workspace_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.OperationalInsights/workspaces/log-analytics-ws"
storage_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Storage/storageAccounts/diagnosticsstorage"

resources = resource_client.resources.list()
for resource in resources:
    try:
        ensure_diagnostic_settings(resource, workspace_id, storage_id)
    except Exception as e:
        print(f"Error configuring {resource.name}: {e}")
```

# Azure Policy for Diagnostic Settings

Enforce diagnostic settings with Azure Policy:

```json
{
    "mode": "Indexed",
    "policyRule": {
        "if": {
            "field": "type",
            "equals": "Microsoft.KeyVault/vaults"
        },
        "then": {
            "effect": "deployIfNotExists",
            "details": {
                "type": "Microsoft.Insights/diagnosticSettings",
                "name": "setByPolicy",
                "existenceCondition": {
                    "allOf": [
                        {
                            "field": "Microsoft.Insights/diagnosticSettings/logs.enabled",
                            "equals": "true"
                        },
                        {
                            "field": "Microsoft.Insights/diagnosticSettings/workspaceId",
                            "equals": "[parameters('logAnalyticsWorkspace')]"
                        }
                    ]
                },
                "roleDefinitionIds": [
                    "/providers/Microsoft.Authorization/roleDefinitions/749f88d5-cbae-40b8-bcfc-e573ddc772fa",
                    "/providers/Microsoft.Authorization/roleDefinitions/92aaf0da-9dab-42b6-94a3-d43ce8d16293"
                ],
                "deployment": {
                    "properties": {
                        "mode": "incremental",
                        "template": {
                            "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
                            "contentVersion": "1.0.0.0",
                            "parameters": {
                                "resourceName": {"type": "string"},
                                "logAnalyticsWorkspace": {"type": "string"}
                            },
                            "resources": [
                                {
                                    "type": "Microsoft.KeyVault/vaults/providers/diagnosticSettings",
                                    "apiVersion": "2021-05-01-preview",
                                    "name": "[concat(parameters('resourceName'), '/Microsoft.Insights/setByPolicy')]",
                                    "properties": {
                                        "workspaceId": "[parameters('logAnalyticsWorkspace')]",
                                        "logs": [
                                            {"category": "AuditEvent", "enabled": true}
                                        ],
                                        "metrics": [
                                            {"category": "AllMetrics", "enabled": true}
                                        ]
                                    }
                                }
                            ]
                        },
                        "parameters": {
                            "resourceName": {"value": "[field('name')]"},
                            "logAnalyticsWorkspace": {"value": "[parameters('logAnalyticsWorkspace')]"}
                        }
                    }
                }
            }
        }
    },
    "parameters": {
        "logAnalyticsWorkspace": {
            "type": "String",
            "metadata": {
                "displayName": "Log Analytics Workspace",
                "description": "Resource ID of the Log Analytics workspace"
            }
        }
    }
}
```

# Querying Diagnostic Logs

Query logs in Log Analytics:

```kusto
// Key Vault audit events
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where Category == "AuditEvent"
| where TimeGenerated > ago(24h)
| project TimeGenerated, OperationName, ResultType, CallerIPAddress, identity_claim_upn_s
| order by TimeGenerated desc

// SQL Database errors
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.SQL"
| where Category == "Errors"
| project TimeGenerated, error_number_d, severity_d, message_s, state_d
| order by TimeGenerated desc

// Firewall denied traffic
AzureDiagnostics
| where Category == "AzureFirewallNetworkRule"
| where msg_s contains "Deny"
| parse msg_s with Protocol " request from " SourceIP ":" SourcePort " to " DestIP ":" DestPort *
| summarize count() by SourceIP, DestIP, DestPort, bin(TimeGenerated, 1h)
| order by count_ desc
```

# Conclusion

Diagnostic settings are fundamental for observability in Azure. By routing logs and metrics to appropriate destinations, you enable troubleshooting, compliance auditing, and security monitoring across your infrastructure.

Best practices include using Azure Policy to enforce diagnostic settings, choosing appropriate retention periods for different data types, and leveraging Log Analytics for cross-resource analysis. With proper diagnostic configuration, you have the visibility needed to operate reliable Azure solutions.

