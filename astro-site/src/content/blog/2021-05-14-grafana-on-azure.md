---
title: "Azure Managed Grafana: Visualization for Cloud Observability"
author: Michael John Peña
draft: false
date: 2021-05-14
tags:
  - Azure
  - Grafana
  - Monitoring
  - Visualization
  - Observability
---

Grafana on Azure became substantially easier when Azure Managed Grafana reached general availability. Before that, teams ran Grafana on AKS or a VM, managed their own TLS, authentication, and version upgrades, and inevitably accumulated a Grafana instance that nobody updated for two years. Managed Grafana handles the hosting, authentication (Azure AD SSO built in), plugin management, and HA. The native Azure Monitor data source integration means you point it at your subscription and the metrics are browsable immediately. I pair it with Azure Monitor Managed Service for Prometheus for Kubernetes observability—Prometheus scraping, Azure data storage for the metrics, and Grafana as the query and dashboard layer.

## Why Managed Grafana?

Self-hosting Grafana requires:
- Infrastructure management
- Authentication configuration
- Plugin management
- High availability setup
- Security patching

Azure Managed Grafana handles all of this while integrating natively with Azure AD and Azure Monitor.

## Creating a Managed Grafana Instance

```bash
# Create Managed Grafana instance
az grafana create \
    --name my-grafana \
    --resource-group my-rg \
    --location eastus \
    --sku-tier Standard

# Get Grafana endpoint
az grafana show \
    --name my-grafana \
    --resource-group my-rg \
    --query properties.endpoint

# Assign yourself Grafana Admin role
GRAFANA_ID=$(az grafana show --name my-grafana --resource-group my-rg --query id -o tsv)
USER_ID=$(az ad signed-in-user show --query id -o tsv)

az role assignment create \
    --assignee $USER_ID \
    --role "Grafana Admin" \
    --scope $GRAFANA_ID
```

## Configuring Data Sources

### Azure Monitor

Azure Monitor is pre-configured, but you can customize it:

```bash
# Grant Grafana access to subscription metrics
GRAFANA_IDENTITY=$(az grafana show \
    --name my-grafana \
    --resource-group my-rg \
    --query identity.principalId -o tsv)

az role assignment create \
    --assignee $GRAFANA_IDENTITY \
    --role "Monitoring Reader" \
    --scope /subscriptions/<subscription-id>
```

### Azure Data Explorer

```json
{
  "name": "Azure Data Explorer",
  "type": "grafana-azure-data-explorer-datasource",
  "access": "proxy",
  "jsonData": {
    "clusterUrl": "https://mycluster.eastus.kusto.windows.net",
    "tenantId": "<tenant-id>",
    "clientId": "<client-id>",
    "defaultDatabase": "mydb"
  },
  "secureJsonData": {
    "clientSecret": "<client-secret>"
  }
}
```

### Prometheus

```json
{
  "name": "Prometheus",
  "type": "prometheus",
  "access": "proxy",
  "url": "http://prometheus-server.monitoring.svc.cluster.local:80",
  "jsonData": {
    "httpMethod": "POST",
    "timeInterval": "15s"
  }
}
```

## Creating Dashboards via API

Use Terraform or API to create dashboards as code:

```python
import requests
import json

grafana_url = "https://my-grafana-xxxx.grafana.azure.com"
api_key = "your-api-key"  # Create via Grafana UI

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

dashboard = {
    "dashboard": {
        "id": None,
        "uid": "azure-vms-overview",
        "title": "Azure VMs Overview",
        "tags": ["azure", "infrastructure"],
        "timezone": "browser",
        "schemaVersion": 30,
        "version": 0,
        "refresh": "30s",
        "panels": [
            {
                "id": 1,
                "title": "CPU Percentage by VM",
                "type": "timeseries",
                "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
                "datasource": "Azure Monitor",
                "targets": [
                    {
                        "refId": "A",
                        "queryType": "Azure Monitor",
                        "azureMonitor": {
                            "resourceGroup": "$resourceGroup",
                            "resourceName": "$vmName",
                            "metricNamespace": "Microsoft.Compute/virtualMachines",
                            "metricName": "Percentage CPU",
                            "aggregation": "Average",
                            "timeGrain": "auto"
                        }
                    }
                ]
            },
            {
                "id": 2,
                "title": "Available Memory",
                "type": "gauge",
                "gridPos": {"h": 8, "w": 6, "x": 12, "y": 0},
                "datasource": "Azure Monitor",
                "options": {
                    "showThresholdLabels": False,
                    "showThresholdMarkers": True
                },
                "fieldConfig": {
                    "defaults": {
                        "thresholds": {
                            "mode": "percentage",
                            "steps": [
                                {"color": "red", "value": None},
                                {"color": "orange", "value": 20},
                                {"color": "green", "value": 40}
                            ]
                        },
                        "unit": "bytes",
                        "min": 0
                    }
                },
                "targets": [
                    {
                        "refId": "A",
                        "azureMonitor": {
                            "resourceGroup": "$resourceGroup",
                            "resourceName": "$vmName",
                            "metricNamespace": "Microsoft.Compute/virtualMachines",
                            "metricName": "Available Memory Bytes",
                            "aggregation": "Average"
                        }
                    }
                ]
            }
        ],
        "templating": {
            "list": [
                {
                    "name": "resourceGroup",
                    "type": "query",
                    "datasource": "Azure Monitor",
                    "query": "ResourceGroups()",
                    "refresh": 1
                },
                {
                    "name": "vmName",
                    "type": "query",
                    "datasource": "Azure Monitor",
                    "query": "ResourceNames($resourceGroup, Microsoft.Compute/virtualMachines)",
                    "refresh": 1
                }
            ]
        }
    },
    "folderId": 0,
    "overwrite": True
}

response = requests.post(
    f"{grafana_url}/api/dashboards/db",
    headers=headers,
    json=dashboard
)

print(response.json())
```

## Log Analytics Queries

Query Azure Log Analytics from Grafana:

```kusto
// Panel query for Application Insights requests
requests
| where timestamp > ago(1h)
| summarize count() by bin(timestamp, 5m), resultCode
| order by timestamp asc
```

```kusto
// Error rate panel
requests
| where timestamp > ago(1h)
| summarize
    total = count(),
    errors = countif(success == false)
    by bin(timestamp, 5m)
| extend error_rate = errors * 100.0 / total
| project timestamp, error_rate
```

## Alerting

Configure alerts in Grafana:

```python
alert_rule = {
    "name": "High CPU Alert",
    "interval": "1m",
    "rules": [
        {
            "grafana_alert": {
                "condition": "B",
                "data": [
                    {
                        "refId": "A",
                        "datasourceUid": "azure-monitor-uid",
                        "model": {
                            "azureMonitor": {
                                "aggregation": "Average",
                                "metricName": "Percentage CPU",
                                "metricNamespace": "Microsoft.Compute/virtualMachines",
                                "resourceGroup": "production",
                                "resourceName": "web-server"
                            }
                        }
                    },
                    {
                        "refId": "B",
                        "datasourceUid": "__expr__",
                        "model": {
                            "conditions": [
                                {
                                    "evaluator": {
                                        "params": [80],
                                        "type": "gt"
                                    },
                                    "operator": {"type": "and"},
                                    "query": {"params": ["A"]},
                                    "reducer": {"params": [], "type": "avg"},
                                    "type": "query"
                                }
                            ],
                            "type": "classic_conditions"
                        }
                    }
                ],
                "exec_err_state": "Error",
                "no_data_state": "NoData",
                "title": "High CPU on Web Server"
            }
        }
    ]
}
```

## Dashboard Best Practices

### Use Variables for Flexibility

```json
{
  "templating": {
    "list": [
      {
        "name": "subscription",
        "type": "query",
        "query": "Subscriptions()",
        "multi": false
      },
      {
        "name": "resourceGroup",
        "type": "query",
        "query": "ResourceGroups($subscription)",
        "multi": true
      },
      {
        "name": "timeRange",
        "type": "interval",
        "options": [
          {"text": "1h", "value": "1h"},
          {"text": "6h", "value": "6h"},
          {"text": "24h", "value": "24h"},
          {"text": "7d", "value": "7d"}
        ]
      }
    ]
  }
}
```

### Organize with Rows

```json
{
  "panels": [
    {
      "type": "row",
      "title": "CPU Metrics",
      "collapsed": false,
      "gridPos": {"h": 1, "w": 24, "x": 0, "y": 0}
    },
    {
      "id": 1,
      "title": "CPU Usage",
      "gridPos": {"h": 8, "w": 12, "x": 0, "y": 1}
    },
    {
      "type": "row",
      "title": "Memory Metrics",
      "collapsed": true,
      "gridPos": {"h": 1, "w": 24, "x": 0, "y": 9},
      "panels": [
        {
          "id": 2,
          "title": "Memory Usage",
          "gridPos": {"h": 8, "w": 12, "x": 0, "y": 10}
        }
      ]
    }
  ]
}
```

## Sharing and Embedding

### Public Snapshots

```python
# Create a snapshot
snapshot = {
    "dashboard": dashboard_json,
    "expires": 86400  # 24 hours
}

response = requests.post(
    f"{grafana_url}/api/snapshots",
    headers=headers,
    json=snapshot
)

print(f"Snapshot URL: {response.json()['url']}")
```

### Embedding Panels

```html
<!-- Embed a single panel in external application -->
<iframe
  src="https://my-grafana.grafana.azure.com/d-solo/azure-vms-overview/azure-vms?orgId=1&panelId=1&from=now-1h&to=now"
  width="800"
  height="400"
  frameborder="0">
</iframe>
```

## Terraform Configuration

```hcl
resource "azurerm_dashboard_grafana" "main" {
  name                = "my-grafana"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku                                = "Standard"
  zone_redundancy_enabled           = true
  api_key_enabled                   = true
  deterministic_outbound_ip_enabled = true

  identity {
    type = "SystemAssigned"
  }

  azure_monitor_workspace_integrations {
    resource_id = azurerm_monitor_workspace.main.id
  }

  tags = {
    environment = "production"
  }
}

resource "azurerm_role_assignment" "grafana_monitoring" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Monitoring Reader"
  principal_id         = azurerm_dashboard_grafana.main.identity[0].principal_id
}
```

## Resources

- [Azure Managed Grafana Documentation](https://docs.microsoft.com/en-us/azure/managed-grafana/)
- [Grafana Dashboard JSON Model](https://grafana.com/docs/grafana/latest/dashboards/json-model/)
- [Azure Monitor Data Source](https://grafana.com/docs/grafana/latest/datasources/azure-monitor/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
