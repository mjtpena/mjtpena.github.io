---
title: "Prometheus Remote Write to Azure Monitor: Unified Metrics"
description: "Prometheus remote write to Azure Monitor provides a powerful, unified metrics platform for cloud-native applications."
author: Michael John Peña
draft: false
date: 2022-02-28
url: /blog/prometheus-remote-write-azure/
tags:
  - Azure
  - Prometheus
  - Monitoring
  - Kubernetes
---

## Setting Up Azure Monitor Workspace

```bicep
resource azureMonitorWorkspace 'Microsoft.Monitor/accounts@2021-06-03-preview' = {
  name: 'prometheus-${environment}'
  location: location
  properties: {}
}

resource prometheusRuleGroup 'Microsoft.AlertsManagement/prometheusRuleGroups@2021-07-22-preview' = {
  name: 'kubernetes-recording-rules'
  location: location
  properties: {
    scopes: [azureMonitorWorkspace.id]
    enabled: true
    interval: 'PT1M'
    rules: [
      {
        record: 'node:cpu_utilization:avg5m'
        expression: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) by (instance)'
      }
      {
        record: 'node:memory_utilization:ratio'
        expression: '1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes'
      }
    ]
  }
}

output queryEndpoint string = azureMonitorWorkspace.properties.metrics.prometheusQueryEndpoint
output ingestEndpoint string = azureMonitorWorkspace.properties.metrics.internalId
```

## Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

remote_write:
  - url: "https://prometheus-prod.australiaeast.prometheus.monitor.azure.com/api/v1/write"
    azure_ad:
      managed_identity:
        client_id: "${AZURE_CLIENT_ID}"
    queue_config:
      max_samples_per_send: 1000
      max_shards: 200
      capacity: 2500

scrape_configs:
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
```

## AKS with Managed Prometheus

```bicep
resource aksCluster 'Microsoft.ContainerService/managedClusters@2022-03-01' = {
  name: aksClusterName
  location: location
  properties: {
    azureMonitorProfile: {
      metrics: {
        enabled: true
        kubeStateMetrics: {
          metricLabelsAllowlist: '*'
          metricAnnotationsAllowList: '*'
        }
      }
    }
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalyticsWorkspace.id
          useAADAuth: 'true'
        }
      }
    }
  }
}

resource dcrAssociation 'Microsoft.Insights/dataCollectionRuleAssociations@2021-09-01-preview' = {
  name: 'aks-prometheus-dcr'
  scope: aksCluster
  properties: {
    dataCollectionRuleId: prometheusDCR.id
  }
}
```

## Data Collection Rule for Prometheus

```bicep
resource prometheusDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-prometheus-metrics'
  location: location
  kind: 'Linux'
  properties: {
    dataSources: {
      prometheusForwarder: [
        {
          name: 'prometheusDataSource'
          streams: ['Microsoft-PrometheusMetrics']
          labelIncludeFilter: {
            'kubernetes_namespace': ['default', 'kube-system', 'monitoring']
          }
        }
      ]
    }
    destinations: {
      monitoringAccounts: [
        {
          name: 'azureMonitor'
          accountResourceId: azureMonitorWorkspace.id
        }
      ]
    }
    dataFlows: [
      {
        streams: ['Microsoft-PrometheusMetrics']
        destinations: ['azureMonitor']
      }
    ]
  }
}
```

## Querying Prometheus Metrics

### PromQL in Azure

```promql
# CPU usage by pod
sum(rate(container_cpu_usage_seconds_total{namespace="production"}[5m])) by (pod)

# Memory usage percentage
(sum(container_memory_working_set_bytes{namespace="production"}) by (pod))
/
(sum(container_spec_memory_limit_bytes{namespace="production"}) by (pod))
* 100

# Request rate by service
sum(rate(http_requests_total{namespace="production"}[5m])) by (service)

# Error rate
sum(rate(http_requests_total{status=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
```

### Using the API

```python
import requests
from azure.identity import DefaultAzureCredential

class PrometheusQueryClient:
    def __init__(self, query_endpoint: str):
        self.endpoint = query_endpoint
        self.credential = DefaultAzureCredential()

    def query(self, promql: str) -> dict:
        """Execute a PromQL query."""
        token = self.credential.get_token("https://prometheus.monitor.azure.com/.default")

        headers = {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

        response = requests.post(
            f"{self.endpoint}/api/v1/query",
            headers=headers,
            data={"query": promql}
        )

        return response.json()

    def query_range(self, promql: str, start: str, end: str, step: str) -> dict:
        """Execute a range query."""
        token = self.credential.get_token("https://prometheus.monitor.azure.com/.default")

        headers = {"Authorization": f"Bearer {token.token}"}

        response = requests.get(
            f"{self.endpoint}/api/v1/query_range",
            headers=headers,
            params={
                "query": promql,
                "start": start,
                "end": end,
                "step": step
            }
        )

        return response.json()

# Usage
client = PrometheusQueryClient(
    "https://prometheus-prod.australiaeast.prometheus.monitor.azure.com"
)

result = client.query('up{job="kubernetes-pods"}')
```

## Grafana Integration

```json
{
  "name": "Azure Managed Prometheus",
  "type": "prometheus",
  "access": "proxy",
  "url": "https://prometheus-prod.australiaeast.prometheus.monitor.azure.com",
  "jsonData": {
    "azureCredentials": {
      "authType": "msi"
    },
    "httpMethod": "POST"
  }
}
```

## Alerting with Prometheus Rules

```bicep
resource alertRuleGroup 'Microsoft.AlertsManagement/prometheusRuleGroups@2021-07-22-preview' = {
  name: 'kubernetes-alerts'
  location: location
  properties: {
    scopes: [azureMonitorWorkspace.id]
    enabled: true
    interval: 'PT1M'
    rules: [
      {
        alert: 'HighPodCPU'
        expression: 'sum(rate(container_cpu_usage_seconds_total[5m])) by (pod, namespace) > 0.8'
        for: 'PT5M'
        severity: 2
        annotations: {
          summary: 'Pod {{ $labels.pod }} in {{ $labels.namespace }} has high CPU usage'
        }
        actions: [
          {
            actionGroupId: actionGroup.id
          }
        ]
      }
      {
        alert: 'PodNotReady'
        expression: 'kube_pod_status_ready{condition="false"} == 1'
        for: 'PT5M'
        severity: 1
        annotations: {
          summary: 'Pod {{ $labels.pod }} is not ready'
        }
      }
    ]
  }
}
```

Prometheus remote write to Azure Monitor provides a powerful, unified metrics platform for cloud-native applications.
