---
title: "Log Analytics Workspace Design for Enterprise Kubernetes"
author: "Michael John Peña"
draft: false
date: 2021-10-11
tags: ["Azure", "Log Analytics", "Monitoring", "Architecture", "Enterprise"]

---

I wrote "Log Analytics Workspace Design for Enterprise Kubernetes" to share practical, production-minded guidance on this topic.

Log Analytics workspace design is one of those infrastructure decisions that feels low-stakes until your bill arrives or you hit a query that crosses a workspace boundary and requires a `workspace()` function call. The core design tension: centralised workspace (all logs in one place, simpler queries, easier cross-resource correlation) versus distributed workspaces (separate billing, access control by workspace, data residency compliance). For most organisations, the answer is a hybrid: a central workspace for platform and security logs (Azure Activity, Azure AD, Defender for Cloud) with separate workspaces for team-owned applications where the team manages their own Log Analytics costs and access. The data retention setting and data capping (daily ingestion limit) are the cost control mechanisms—set them before you connect high-volume data sources like verbose application logging or network flow logs.

## Workspace Design Considerations

Key factors to consider:
- **Data sovereignty** - Regional data residency requirements
- **Access control** - Who needs access to what data
- **Cost allocation** - Chargeback to teams or projects
- **Query performance** - Cross-workspace query implications
- **Data retention** - Compliance and operational needs

## Common Workspace Patterns

### Pattern 1: Centralized Workspace

All clusters report to a single workspace:

```
┌─────────────────────────────────────────┐
│         Central Log Analytics           │
│              Workspace                  │
├─────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Cluster │ │ Cluster │ │ Cluster │   │
│  │   Dev   │ │   QA    │ │  Prod   │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘
```

Pros:
- Simplified management
- Easy cross-cluster queries
- Consolidated billing

Cons:
- Single point of failure
- Complex access control
- All-or-nothing data access

### Pattern 2: Environment-Based Workspaces

Separate workspaces per environment:

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Dev/Test      │ │    Staging      │ │   Production    │
│   Workspace     │ │    Workspace    │ │    Workspace    │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ ┌─────────────┐ │
│ │ Dev Cluster │ │ │ │ QA Cluster  │ │ │ │Prod Cluster │ │
│ └─────────────┘ │ │ └─────────────┘ │ │ └─────────────┘ │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

Pros:
- Clear separation of concerns
- Environment-specific retention
- Simplified access control

Cons:
- Cross-environment queries more complex
- Multiple workspaces to manage

### Pattern 3: Team/Application Workspaces

Each team owns their workspace:

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Platform      │ │    App Team A   │ │   App Team B    │
│   Workspace     │ │    Workspace    │ │    Workspace    │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ Infrastructure  │ │ App A Data      │ │ App B Data      │
│ Cluster Data    │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

Pros:
- Team autonomy
- Clear cost allocation
- Data isolation

Cons:
- Complex cross-team visibility
- Duplicate infrastructure costs

## Creating Workspaces

### Azure CLI

```bash
# Create workspace for production
az monitor log-analytics workspace create \
    --resource-group monitoring-rg \
    --workspace-name aks-prod-logs \
    --location eastus \
    --sku PerGB2018 \
    --retention-time 90

# Create workspace for development
az monitor log-analytics workspace create \
    --resource-group monitoring-rg \
    --workspace-name aks-dev-logs \
    --location eastus \
    --sku PerGB2018 \
    --retention-time 30
```

### Terraform

```hcl
resource "azurerm_log_analytics_workspace" "prod" {
  name                = "aks-prod-logs"
  location            = azurerm_resource_group.monitoring.location
  resource_group_name = azurerm_resource_group.monitoring.name
  sku                 = "PerGB2018"
  retention_in_days   = 90

  tags = {
    Environment = "Production"
    CostCenter  = "Platform"
  }
}

resource "azurerm_log_analytics_workspace" "dev" {
  name                = "aks-dev-logs"
  location            = azurerm_resource_group.monitoring.location
  resource_group_name = azurerm_resource_group.monitoring.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 5

  tags = {
    Environment = "Development"
    CostCenter  = "Development"
  }
}
```

## Access Control

### Workspace-Level RBAC

```bash
# Grant read access to workspace
az role assignment create \
    --role "Log Analytics Reader" \
    --assignee user@company.com \
    --scope /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}

# Grant contributor access for management
az role assignment create \
    --role "Log Analytics Contributor" \
    --assignee admin@company.com \
    --scope /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}
```

### Table-Level RBAC

Restrict access to specific tables:

```bash
# Create custom role for limited access
az role definition create --role-definition '{
    "Name": "ContainerLogs Reader",
    "Description": "Can read container logs only",
    "Actions": [
        "Microsoft.OperationalInsights/workspaces/read",
        "Microsoft.OperationalInsights/workspaces/query/ContainerLog/read",
        "Microsoft.OperationalInsights/workspaces/query/ContainerLogV2/read"
    ],
    "AssignableScopes": [
        "/subscriptions/{subscription-id}"
    ]
}'
```

## Data Collection Rules

Control what data is collected per cluster:

```json
{
  "type": "Microsoft.Insights/dataCollectionRules",
  "apiVersion": "2021-04-01",
  "name": "aks-prod-dcr",
  "location": "eastus",
  "properties": {
    "dataSources": {
      "extensions": [
        {
          "streams": ["Microsoft-ContainerLog", "Microsoft-Perf"],
          "extensionName": "ContainerInsights",
          "extensionSettings": {
            "dataCollectionSettings": {
              "interval": "1m",
              "namespaceFilteringMode": "Include",
              "namespaces": ["default", "production"]
            }
          }
        }
      ]
    },
    "destinations": {
      "logAnalytics": [
        {
          "workspaceResourceId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/aks-prod-logs",
          "name": "prodWorkspace"
        }
      ]
    },
    "dataFlows": [
      {
        "streams": ["Microsoft-ContainerLog", "Microsoft-Perf"],
        "destinations": ["prodWorkspace"]
      }
    ]
  }
}
```

## Retention and Archiving

### Setting Retention

```bash
# Set workspace retention
az monitor log-analytics workspace update \
    --resource-group monitoring-rg \
    --workspace-name aks-prod-logs \
    --retention-time 90

# Set table-specific retention
az monitor log-analytics workspace table update \
    --resource-group monitoring-rg \
    --workspace-name aks-prod-logs \
    --name ContainerLog \
    --retention-time 30 \
    --total-retention-time 365
```

### Archive to Storage

```bash
# Export data to storage for long-term retention
az monitor log-analytics workspace data-export create \
    --resource-group monitoring-rg \
    --workspace-name aks-prod-logs \
    --name archive-export \
    --destination /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{account} \
    --tables ContainerLog Perf \
    --enable true
```

## Cost Optimization

### Commitment Tiers

```bash
# Set commitment tier for predictable costs
az monitor log-analytics workspace update \
    --resource-group monitoring-rg \
    --workspace-name aks-prod-logs \
    --capacity-reservation-level 100
```

### Daily Caps

```bash
# Set daily ingestion cap
az monitor log-analytics workspace update \
    --resource-group monitoring-rg \
    --workspace-name aks-dev-logs \
    --quota 5
```

### Analyzing Costs

```kusto
// Ingestion by table
Usage
| where TimeGenerated > ago(30d)
| summarize TotalGB = sum(Quantity) / 1000 by DataType
| order by TotalGB desc

// Ingestion by cluster
ContainerLog
| where TimeGenerated > ago(7d)
| extend ClusterName = extract("aks-([^-]+)-", 1, Computer)
| summarize DataGB = sum(string_size(LogEntry)) / 1073741824 by ClusterName
```

## Workspace Linking

Link AKS cluster to workspace:

```bash
az aks enable-addons \
    --addons monitoring \
    --resource-group cluster-rg \
    --name myAKSCluster \
    --workspace-resource-id /subscriptions/{sub}/resourceGroups/monitoring-rg/providers/Microsoft.OperationalInsights/workspaces/aks-prod-logs
```

## Best Practices

1. **Start with environment separation** - Separate prod from non-prod
2. **Use resource tagging** - Tag workspaces for cost tracking
3. **Implement daily caps for dev** - Prevent runaway costs
4. **Plan retention carefully** - Balance compliance with cost
5. **Use table-level RBAC** - Provide least-privilege access
6. **Monitor ingestion trends** - Set up alerts for unusual spikes

## Conclusion

Thoughtful Log Analytics workspace design balances operational needs with cost and security requirements. Choose a pattern that fits your organization's structure and scale appropriately as your Kubernetes estate grows.

Tomorrow, we'll explore cross-workspace queries for enterprise-wide visibility.

