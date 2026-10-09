---
title: "Azure Managed Grafana Preview: Enterprise Observability"
description: "Azure Managed Grafana provides enterprise observability with seamless Azure integration and reduced operational overhead."
author: Michael John Peña
draft: false
date: 2022-02-20
url: /blog/azure-managed-grafana/
tags:
  - Azure
  - Grafana
  - Monitoring
  - Observability
---

## What is Azure Managed Grafana?

Azure Managed Grafana provides:
- Fully managed Grafana service
- Native integration with Azure Monitor, Data Explorer, and Prometheus
- Azure AD authentication
- Built-in Azure dashboards
- Enterprise security features

## Creating a Managed Grafana Instance

```bicep
resource managedGrafana 'Microsoft.Dashboard/grafana@2022-08-01' = {
  name: 'grafana-${environment}'
  location: location
  sku: {
    name: 'Standard'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    grafanaIntegrations: {
      azureMonitorWorkspaceIntegrations: [
        {
          azureMonitorWorkspaceResourceId: logAnalytics.id
        }
      ]
    }
    zoneRedundancy: 'Enabled'
    apiKey: 'Disabled'
    deterministicOutboundIP: 'Enabled'
    publicNetworkAccess: 'Enabled'
  }
}

// Grant Grafana access to Azure Monitor data
resource monitorReaderRole 'Microsoft.Authorization/roleAssignments@2020-10-01-preview' = {
  scope: subscription()
  name: guid(subscription().id, managedGrafana.id, 'monitoring-reader')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05')  // Monitoring Reader
    principalId: managedGrafana.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Configuring Data Sources

### Azure Monitor

```json
{
  "name": "Azure Monitor",
  "type": "grafana-azure-monitor-datasource",
  "access": "proxy",
  "jsonData": {
    "subscriptionId": "${SUBSCRIPTION_ID}",
    "cloudName": "azuremonitor",
    "azureAuthType": "msi"
  }
}
```

### Azure Data Explorer

```json
{
  "name": "Azure Data Explorer",
  "type": "grafana-azure-data-explorer-datasource",
  "jsonData": {
    "clusterUrl": "https://mycluster.australiaeast.kusto.windows.net",
    "defaultDatabase": "mydb",
    "azureCredentials": {
      "authType": "msi"
    }
  }
}
```

### Prometheus (Azure Monitor Managed)

```json
{
  "name": "Prometheus",
  "type": "prometheus",
  "access": "proxy",
  "url": "https://myworkspace.australiaeast.prometheus.monitor.azure.com",
  "jsonData": {
    "azureCredentials": {
      "authType": "msi"
    },
    "httpMethod": "POST"
  }
}
```

## Creating Dashboards

### Infrastructure Overview Dashboard

```json
{
  "dashboard": {
    "title": "Azure Infrastructure Overview",
    "panels": [
      {
        "title": "VM CPU Usage",
        "type": "timeseries",
        "datasource": "Azure Monitor",
        "targets": [
          {
            "queryType": "Azure Monitor",
            "azureMonitor": {
              "resourceGroup": "$resourceGroup",
              "metricDefinition": "microsoft.compute/virtualmachines",
              "metricNamespace": "microsoft.compute/virtualmachines",
              "metricName": "Percentage CPU",
              "aggregation": "Average",
              "timeGrain": "PT1M"
            }
          }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 }
      },
      {
        "title": "Storage Account Latency",
        "type": "gauge",
        "datasource": "Azure Monitor",
        "targets": [
          {
            "queryType": "Azure Monitor",
            "azureMonitor": {
              "resourceGroup": "$resourceGroup",
              "metricDefinition": "microsoft.storage/storageaccounts",
              "metricName": "SuccessE2ELatency",
              "aggregation": "Average"
            }
          }
        ],
        "gridPos": { "h": 8, "w": 6, "x": 12, "y": 0 }
      }
    ],
    "templating": {
      "list": [
        {
          "name": "resourceGroup",
          "type": "query",
          "datasource": "Azure Monitor",
          "query": "ResourceGroups()"
        }
      ]
    }
  }
}
```

### Log Analytics Dashboard

```json
{
  "panels": [
    {
      "title": "Application Errors",
      "type": "timeseries",
      "datasource": "Azure Monitor",
      "targets": [
        {
          "queryType": "Azure Log Analytics",
          "azureLogAnalytics": {
            "workspace": "${LOG_ANALYTICS_WORKSPACE}",
            "query": "AppExceptions\n| summarize count() by bin(TimeGenerated, 5m), ProblemId\n| order by TimeGenerated asc"
          }
        }
      ]
    },
    {
      "title": "Request Duration Percentiles",
      "type": "timeseries",
      "targets": [
        {
          "queryType": "Azure Log Analytics",
          "azureLogAnalytics": {
            "query": "AppRequests\n| summarize p50=percentile(DurationMs, 50), p95=percentile(DurationMs, 95), p99=percentile(DurationMs, 99) by bin(TimeGenerated, 5m)\n| order by TimeGenerated asc"
          }
        }
      ]
    }
  ]
}
```

## Alerting Configuration

```json
{
  "alertRules": [
    {
      "title": "High CPU Alert",
      "condition": {
        "type": "query",
        "query": {
          "datasource": "Azure Monitor",
          "model": {
            "azureMonitor": {
              "metricName": "Percentage CPU",
              "aggregation": "Average"
            }
          }
        },
        "evaluator": {
          "type": "gt",
          "params": [80]
        },
        "reducer": {
          "type": "avg"
        }
      },
      "for": "5m",
      "notifications": [
        {
          "uid": "teams-notification"
        }
      ]
    }
  ]
}
```

## Terraform Configuration

```hcl
resource "azurerm_dashboard_grafana" "grafana" {
  name                              = "grafana-prod"
  resource_group_name               = azurerm_resource_group.rg.name
  location                          = azurerm_resource_group.rg.location
  grafana_major_version             = 9
  api_key_enabled                   = false
  deterministic_outbound_ip_enabled = true
  public_network_access_enabled     = true

  identity {
    type = "SystemAssigned"
  }

  azure_monitor_workspace_integrations {
    resource_id = azurerm_log_analytics_workspace.law.id
  }
}

resource "azurerm_role_assignment" "grafana_monitor_reader" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Monitoring Reader"
  principal_id         = azurerm_dashboard_grafana.grafana.identity[0].principal_id
}
```

Azure Managed Grafana provides enterprise observability with seamless Azure integration and reduced operational overhead.
