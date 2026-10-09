---
title: "Deep Dive into Azure Monitor for Containers"
description: "Azure Monitor for Containers (the Container Insights feature) is the native Azure observability solution for AKS that doesn't require running your own…"
author: "Michael John Peña"
draft: false
date: 2021-10-10
tags: ["Azure", "Kubernetes", "AKS", "Azure Monitor", "Monitoring"]
---

Azure Monitor for Containers (the Container Insights feature) is the native Azure observability solution for AKS that doesn't require running your own Prometheus and Grafana—it's the right starting point for teams that want comprehensive cluster visibility with minimal operational overhead. The Log Analytics workspace receives container metrics and logs; the built-in workbooks surface cluster health, node utilisation, pod inventory, and failed pod events; Azure Monitor Alerts connect to the metrics for automated notifications. The tradeoff compared to self-managed Prometheus: Azure Monitor pricing at scale (high cardinality metrics and verbose logging volumes add up in Log Analytics) versus the operational overhead of managing your own Prometheus stack. The hybrid approach—Container Insights for platform metrics and logs, plus self-managed Prometheus for application-level metrics—is how many teams run it in practice.

## Architecture Overview

Azure Monitor for Containers consists of:
- **Container Insights agent (omsagent)** - DaemonSet collecting metrics and logs
- **Log Analytics workspace** - Stores collected data
- **Azure Monitor** - Provides alerting, visualization, and analysis

## Data Collection Configuration

### Customizing Collection with ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: container-azm-ms-agentconfig
  namespace: kube-system
data:
  schema-version: v1
  config-version: ver1
  log-data-collection-settings: |
    [log_collection_settings]
      [log_collection_settings.stdout]
        enabled = true
        exclude_namespaces = ["kube-system", "gatekeeper-system"]
      [log_collection_settings.stderr]
        enabled = true
        exclude_namespaces = ["kube-system"]
      [log_collection_settings.env_var]
        enabled = false
      [log_collection_settings.enrich_container_logs]
        enabled = true
      [log_collection_settings.collect_all_kube_events]
        enabled = true
  metric-data-collection-settings: |
    [metric_collection_settings]
      interval = "1m"
      namespace_filtering_mode = "Include"
      namespaces = ["default", "production", "staging"]
```

### Filtering by Annotation

Control log collection per pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: verbose-app
  annotations:
    # Exclude from log collection
    fluentbit.io/exclude: "true"
spec:
  containers:
  - name: app
    image: myapp:v1
```

## Advanced Kusto Queries

### Container Performance Analysis

```kusto
// CPU throttling analysis
Perf
| where ObjectName == "K8SContainer"
| where CounterName == "cpuThrottledTimeMs"
| summarize ThrottledMs = sum(CounterValue) by bin(TimeGenerated, 5m), InstanceName
| where ThrottledMs > 0
| render timechart
```

### Memory Pressure Detection

```kusto
// Containers approaching memory limits
let memoryUsage = Perf
| where ObjectName == "K8SContainer"
| where CounterName == "memoryWorkingSetBytes"
| summarize MemUsage = avg(CounterValue) by InstanceName;

let memoryLimits = KubePodInventory
| distinct ContainerID, ContainerName
| join kind=inner (
    Perf
    | where ObjectName == "K8SContainer"
    | where CounterName == "memoryLimitBytes"
    | where CounterValue > 0
    | summarize MemLimit = avg(CounterValue) by InstanceName
) on $left.ContainerID == $right.InstanceName;

memoryUsage
| join kind=inner memoryLimits on InstanceName
| extend UsagePercent = (MemUsage / MemLimit) * 100
| where UsagePercent > 80
| project ContainerName, UsagePercent, MemUsage, MemLimit
| order by UsagePercent desc
```

### Log Analysis for Errors

```kusto
// Error trends by container
ContainerLog
| where LogEntry contains "error" or LogEntry contains "exception"
| summarize ErrorCount = count() by bin(TimeGenerated, 1h), ContainerID
| join kind=inner (
    KubePodInventory
    | distinct ContainerID, Name, Namespace
) on ContainerID
| project TimeGenerated, Name, Namespace, ErrorCount
| render timechart
```

### Deployment Health

```kusto
// Deployment replica status
KubePodInventory
| where TimeGenerated > ago(1h)
| summarize
    Running = countif(PodStatus == "Running"),
    Pending = countif(PodStatus == "Pending"),
    Failed = countif(PodStatus == "Failed")
    by ControllerName, Namespace
| where Pending > 0 or Failed > 0
```

## Workbooks

### Creating Custom Workbooks

```json
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 1,
      "content": {
        "json": "# AKS Cluster Health Dashboard"
      }
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "KubeNodeInventory | summarize count() by Status | render piechart",
        "size": 1,
        "title": "Node Status"
      }
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "KubePodInventory | where TimeGenerated > ago(1h) | summarize count() by PodStatus | render piechart",
        "size": 1,
        "title": "Pod Status"
      }
    }
  ]
}
```

## Alerting Strategies

### Resource-Based Alerts

```bash
# High memory alert
az monitor metrics alert create \
    --name "High Memory Usage" \
    --resource-group myResourceGroup \
    --scopes "/subscriptions/{sub}/resourceGroups/MC_{rg}_{cluster}_{region}/providers/Microsoft.Compute/virtualMachineScaleSets/{vmss}" \
    --condition "avg Percentage Memory > 85" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action /subscriptions/{sub}/resourceGroups/{rg}/providers/microsoft.insights/actionGroups/{ag}
```

### Log-Based Alerts

```kusto
// Alert: Pod in CrashLoopBackOff
KubePodInventory
| where PodStatus == "Running"
| where ContainerStatus contains "CrashLoopBackOff"
| distinct Name, Namespace, ContainerStatus
```

### Multi-Resource Alerts

```json
{
  "type": "Microsoft.Insights/scheduledQueryRules",
  "properties": {
    "displayName": "Cross-Cluster Alert",
    "scopes": [
      "/subscriptions/{sub}/resourceGroups/{rg1}/providers/Microsoft.OperationalInsights/workspaces/{ws1}",
      "/subscriptions/{sub}/resourceGroups/{rg2}/providers/Microsoft.OperationalInsights/workspaces/{ws2}"
    ],
    "criteria": {
      "allOf": [
        {
          "query": "KubePodInventory | where PodStatus == 'Failed' | summarize count() by ClusterName",
          "threshold": 0,
          "operator": "GreaterThan"
        }
      ]
    }
  }
}
```

## Integration with Azure Services

### Sending Alerts to Logic Apps

```json
{
  "type": "Microsoft.Logic/workflows",
  "properties": {
    "definition": {
      "triggers": {
        "manual": {
          "type": "Request",
          "kind": "Http"
        }
      },
      "actions": {
        "Send_Teams_message": {
          "type": "ApiConnection",
          "inputs": {
            "method": "post",
            "body": {
              "title": "AKS Alert: @{triggerBody()?['data']?['alertContext']?['AlertRule']}",
              "text": "@{triggerBody()?['data']?['alertContext']?['Description']}"
            }
          }
        }
      }
    }
  }
}
```

### Exporting to Event Hubs

```bash
# Create diagnostic setting for continuous export
az monitor diagnostic-settings create \
    --name export-to-eventhub \
    --resource "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ContainerService/managedClusters/{cluster}" \
    --event-hub-rule "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.EventHub/namespaces/{ns}/authorizationRules/RootManageSharedAccessKey" \
    --logs '[{"category":"kube-apiserver","enabled":true},{"category":"kube-controller-manager","enabled":true}]'
```

## Cost Management

### Analyzing Data Ingestion

```kusto
// Data volume by table
Usage
| where TimeGenerated > ago(30d)
| where IsBillable == true
| summarize TotalGB = sum(Quantity) / 1000 by DataType
| order by TotalGB desc
```

### Implementing Sampling

```yaml
# Reduce collection frequency for non-critical namespaces
metric-data-collection-settings: |
  [metric_collection_settings]
    interval = "5m"  # Increase interval to reduce data
```

## Best Practices

1. **Right-size your workspace** - Choose appropriate pricing tier
2. **Filter noisy namespaces** - Exclude kube-system from log collection
3. **Use data collection rules** - Control what data is collected
4. **Implement retention policies** - Archive old data to cheaper storage
5. **Use workbooks for investigation** - Build reusable analysis templates

## Conclusion

Azure Monitor for Containers provides native, comprehensive monitoring for AKS clusters. Combined with custom queries, alerts, and workbooks, you can build a robust observability platform integrated with the Azure ecosystem.

Tomorrow, we'll explore Log Analytics workspace design patterns for enterprise environments.
