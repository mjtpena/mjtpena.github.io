---
title: "Azure Arc Updates - Hybrid Cloud Management"
author: "Michael John Peña"
draft: false
date: 2022-10-02
tags: ["Azure", "Azure Arc", "Hybrid Cloud", "Multi-Cloud"]

---

I wrote "Azure Arc Updates - Hybrid Cloud Management" to share practical, production-minded guidance on this topic.

## Azure Arc Overview

### Arc-Enabled Servers

```bash
# Connect a server to Azure Arc
# Download and run the connection script from Azure Portal

# Or use Azure CLI
az connectedmachine connect \
    --resource-group "HybridServers" \
    --name "WebServer01" \
    --location "eastus"

# List connected machines
az connectedmachine list \
    --resource-group "HybridServers" \
    --output table

# Show machine details
az connectedmachine show \
    --resource-group "HybridServers" \
    --name "WebServer01"
```

### Arc-Enabled Kubernetes

```bash
# Connect a Kubernetes cluster to Azure Arc
az connectedk8s connect \
    --resource-group "HybridK8s" \
    --name "OnPremCluster" \
    --location "eastus" \
    --kube-config ~/.kube/config

# Verify connection
az connectedk8s show \
    --resource-group "HybridK8s" \
    --name "OnPremCluster"

# List connected clusters
az connectedk8s list \
    --resource-group "HybridK8s" \
    --output table

# Enable cluster extensions
az k8s-extension create \
    --resource-group "HybridK8s" \
    --cluster-name "OnPremCluster" \
    --cluster-type connectedClusters \
    --name "azuremonitor-containers" \
    --extension-type Microsoft.AzureMonitor.Containers
```

### Arc-Enabled Data Services

```bash
# Create data controller
az arcdata dc create \
    --name "arc-dc" \
    --resource-group "ArcData" \
    --location "eastus" \
    --connectivity-mode "indirect" \
    --k8s-namespace "arc" \
    --storage-class "default" \
    --infrastructure "onpremises"

# Create Arc-enabled SQL Managed Instance
az sql mi-arc create \
    --name "sql-mi-arc" \
    --resource-group "ArcData" \
    --location "eastus" \
    --custom-location "onprem-location" \
    --storage-class-data "default" \
    --storage-class-logs "default" \
    --cores-limit 4 \
    --memory-limit "8Gi"

# Create Arc-enabled PostgreSQL
az postgres arc-server create \
    --name "postgres-arc" \
    --resource-group "ArcData" \
    --custom-location "onprem-location" \
    --storage-class-data "default" \
    --storage-class-logs "default"
```

## Managing Arc Resources

### Azure Policy for Arc

```json
// Policy to require tags on Arc-enabled servers
{
    "mode": "Indexed",
    "policyRule": {
        "if": {
            "allOf": [
                {
                    "field": "type",
                    "equals": "Microsoft.HybridCompute/machines"
                },
                {
                    "field": "tags['Environment']",
                    "exists": false
                }
            ]
        },
        "then": {
            "effect": "deny"
        }
    }
}
```

```bash
# Apply policy to Arc-enabled servers
az policy assignment create \
    --name "require-env-tag" \
    --scope "/subscriptions/{subscription-id}/resourceGroups/HybridServers" \
    --policy "require-environment-tag"

# View compliance
az policy state list \
    --resource-group "HybridServers" \
    --filter "complianceState eq 'NonCompliant'"
```

### Monitoring Arc Resources

```csharp
using Azure.Monitor.Query;
using Azure.Identity;

public class ArcMonitoringService
{
    private readonly LogsQueryClient _logsClient;
    private readonly MetricsQueryClient _metricsClient;

    public ArcMonitoringService()
    {
        var credential = new DefaultAzureCredential();
        _logsClient = new LogsQueryClient(credential);
        _metricsClient = new MetricsQueryClient(credential);
    }

    public async Task<List<ArcServerMetrics>> GetArcServerMetricsAsync(string workspaceId)
    {
        var query = @"
            Heartbeat
            | where ResourceProvider == 'Microsoft.HybridCompute'
            | summarize LastHeartbeat = max(TimeGenerated) by Computer, OSType, Version
            | project Computer, OSType, Version, LastHeartbeat,
                      Status = iff(LastHeartbeat > ago(5m), 'Online', 'Offline')
            | order by Computer asc";

        var response = await _logsClient.QueryWorkspaceAsync(
            workspaceId,
            query,
            new QueryTimeRange(TimeSpan.FromDays(1)));

        var metrics = new List<ArcServerMetrics>();
        foreach (var row in response.Value.Table.Rows)
        {
            metrics.Add(new ArcServerMetrics
            {
                Computer = row["Computer"].ToString(),
                OSType = row["OSType"].ToString(),
                Version = row["Version"].ToString(),
                LastHeartbeat = (DateTime)row["LastHeartbeat"],
                Status = row["Status"].ToString()
            });
        }

        return metrics;
    }

    public async Task<List<ArcK8sMetrics>> GetArcK8sMetricsAsync(string workspaceId)
    {
        var query = @"
            KubeNodeInventory
            | where ClusterName startswith 'arc-'
            | summarize by ClusterName, Computer, Status, KubeletVersion
            | project ClusterName, NodeName = Computer, Status, KubeletVersion";

        var response = await _logsClient.QueryWorkspaceAsync(
            workspaceId,
            query,
            new QueryTimeRange(TimeSpan.FromHours(1)));

        var metrics = new List<ArcK8sMetrics>();
        foreach (var row in response.Value.Table.Rows)
        {
            metrics.Add(new ArcK8sMetrics
            {
                ClusterName = row["ClusterName"].ToString(),
                NodeName = row["NodeName"].ToString(),
                Status = row["Status"].ToString(),
                KubeletVersion = row["KubeletVersion"].ToString()
            });
        }

        return metrics;
    }
}

public class ArcServerMetrics
{
    public string Computer { get; set; }
    public string OSType { get; set; }
    public string Version { get; set; }
    public DateTime LastHeartbeat { get; set; }
    public string Status { get; set; }
}

public class ArcK8sMetrics
{
    public string ClusterName { get; set; }
    public string NodeName { get; set; }
    public string Status { get; set; }
    public string KubeletVersion { get; set; }
}
```

### GitOps with Arc

```yaml
# flux-config.yaml - GitOps configuration
apiVersion: v1
kind: Namespace
metadata:
  name: flux-system\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
