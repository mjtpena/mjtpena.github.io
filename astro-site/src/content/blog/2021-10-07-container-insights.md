---
title: "Comprehensive AKS Monitoring with Container Insights"
author: "Michael John Peña"
draft: false
date: 2021-10-07
tags: ["Azure", "Kubernetes", "AKS", "Monitoring", "Azure Monitor"]

---

I wrote "Comprehensive AKS Monitoring with Container Insights" to share practical, production-minded guidance on this topic.

Container Insights is the Azure Monitor feature that closes the observability gap for AKS clusters—without it, you have Kubernetes metrics available in the cluster but no persistent store, no alerting integration, and no correlation with Azure platform metrics. The omsagent DaemonSet collects container metrics (CPU/memory by pod, node, and namespace), container logs (stdout/stderr from every container), and Kubernetes events, forwarding them to a Log Analytics workspace. The Container Insights workbooks in the Azure portal provide the curated views: cluster health, node utilisation, pod inventory, deployment status, and container logs. For production AKS operations, the minimum viable monitoring baseline is Container Insights plus alerting on node CPU/memory saturation and pod restart count—everything else builds on that foundation.

## Enabling Container Insights

### On a New Cluster

```bash
az aks create \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --node-count 3 \
    --enable-addons monitoring \
    --workspace-resource-id /subscriptions/{sub}/resourcegroups/{rg}/providers/microsoft.operationalinsights/workspaces/{workspace}
```

### On an Existing Cluster

```bash
az aks enable-addons \
    --addons monitoring \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --workspace-resource-id /subscriptions/{sub}/resourcegroups/{rg}/providers/microsoft.operationalinsights/workspaces/{workspace}
```

## What Gets Collected

Container Insights collects:
- **Performance metrics**: CPU, memory, network, disk for nodes and containers
- **Container logs**: stdout and stderr from all containers
- **Kubernetes events**: Cluster events and state changes
- **Inventory data**: Pods, deployments, services, nodes

## Verifying Installation

```bash
# Check the omsagent DaemonSet
kubectl get daemonset omsagent -n kube-system

# Check omsagent pods
kubectl get pods -n kube-system -l component=oms-agent
```

## Key Container Insights Tables

### Perf Table - Performance Metrics

```kusto
Perf
| where ObjectName == "K8SContainer"
| where CounterName == "cpuUsageNanoCores"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 5m), InstanceName
| render timechart
```

### ContainerLog Table - Container Logs

```kusto
ContainerLog
| where LogEntry contains "error"
| project TimeGenerated, Computer, ContainerID, LogEntry
| order by TimeGenerated desc
| take 100
```

### KubeEvents Table - Kubernetes Events

```kusto
KubeEvents
| where KubeEventType == "Warning"
| summarize count() by Name, Reason
| order by count_ desc
```

### KubePodInventory - Pod Information

```kusto
KubePodInventory
| where Namespace != "kube-system"
| where PodStatus == "Running"
| summarize count() by Namespace, ControllerName
| order by count_ desc
```

## Useful Queries

### High CPU Pods

```kusto
Perf
| where ObjectName == "K8SContainer"
| where CounterName == "cpuUsageNanoCores"
| summarize AvgCPU = avg(CounterValue) by InstanceName
| top 10 by AvgCPU desc
```

### Memory Usage by Namespace

```kusto
KubePodInventory
| where TimeGenerated > ago(1h)
| join kind=inner (
    Perf
    | where ObjectName == "K8SContainer"
    | where CounterName == "memoryWorkingSetBytes"
) on $left.ContainerID == $right.InstanceName
| summarize AvgMemory = avg(CounterValue) by Namespace
| order by AvgMemory desc
```

### Container Restart Count

```kusto
KubePodInventory
| where TimeGenerated > ago(24h)
| where ContainerRestartCount > 0
| summarize MaxRestarts = max(ContainerRestartCount) by Name, Namespace
| where MaxRestarts > 3
| order by MaxRestarts desc
```

### Pods in Failed State

```kusto
KubePodInventory
| where TimeGenerated > ago(1h)
| where PodStatus == "Failed"
| distinct Name, Namespace, PodStatus
```

### Node Resource Pressure

```kusto
KubeNodeInventory
| where TimeGenerated > ago(1h)
| where Status contains "pressure"
| project TimeGenerated, Computer, Status
```

## Setting Up Alerts

### High CPU Alert

```bash
az monitor scheduled-query create \
    --name "High CPU Alert" \
    --resource-group myResourceGroup \
    --scopes /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace} \
    --condition "count 'Perf | where ObjectName == \"K8SContainer\" | where CounterName == \"cpuUsageNanoCores\" | summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 5m), InstanceName | where AvgCPU > 800000000' > 0" \
    --severity 2 \
    --evaluation-frequency 5m \
    --window-size 15m \
    --action-groups /subscriptions/{sub}/resourceGroups/{rg}/providers/microsoft.insights/actionGroups/myActionGroup
```

### Pod Restart Alert

Create an alert rule in the portal or via ARM template:

```json
{
  "type": "Microsoft.Insights/scheduledQueryRules",
  "apiVersion": "2021-08-01",
  "name": "Pod Restart Alert",
  "location": "eastus",
  "properties": {
    "displayName": "Pod Restart Alert",
    "severity": 2,
    "enabled": true,
    "evaluationFrequency": "PT5M",
    "scopes": ["/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}"],
    "windowSize": "PT15M",
    "criteria": {
      "allOf": [
        {
          "query": "KubePodInventory | where ContainerRestartCount > 5 | summarize count() by Name, Namespace",
          "timeAggregation": "Count",
          "operator": "GreaterThan",
          "threshold": 0
        }
      ]
    },
    "actions": {
      "actionGroups": ["/subscriptions/{sub}/resourceGroups/{rg}/providers/microsoft.insights/actionGroups/myActionGroup"]
    }
  }
}
```

## Configuring Log Collection

### ConfigMap for Log Collection Settings

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
        exclude_namespaces = ["kube-system"]
      [log_collection_settings.stderr]
        enabled = true
        exclude_namespaces = ["kube-system"]
      [log_collection_settings.env_var]
        enabled = true
  prometheus-data-collection-settings: |
    [prometheus_data_collection_settings.cluster]
      interval = "1m"
      monitor_kubernetes_pods = true
```

Apply the ConfigMap:

```bash
kubectl apply -f container-azm-ms-agentconfig.yaml
```

## Workbook Visualizations

Container Insights includes built-in workbooks:
- Cluster health
- Node performance
- Controller metrics
- Container insights
- Deployments and HPAs
- Persistent volumes

Access them through:
Azure Portal > AKS Cluster > Insights > Workbooks

## Cost Optimization

Container logs can generate significant data. Optimize costs by:

1. **Filtering namespaces** - Exclude noisy namespaces
2. **Sampling** - Reduce collection frequency
3. **Retention policies** - Set appropriate retention periods
4. **Data caps** - Configure daily caps

```bash
# Set daily cap on workspace
az monitor log-analytics workspace update \
    --resource-group myResourceGroup \
    --workspace-name myWorkspace \
    --quota 5
```

## Conclusion

Container Insights provides the foundation for observability in AKS. Combined with custom queries, alerts, and workbooks, you can maintain deep visibility into your Kubernetes workloads.

Tomorrow, we'll explore Prometheus metrics collection for even more detailed application monitoring.

