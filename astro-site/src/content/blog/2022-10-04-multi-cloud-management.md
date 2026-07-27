---
title: "Multi-Cloud Management with Azure"
author: "Michael John Peña"
draft: false
date: 2022-10-04
tags: ["Azure", "Multi-Cloud", "AWS", "GCP", "Management"]

---

I wrote "Multi-Cloud Management with Azure" to share practical, production-minded guidance on this topic.

## Azure Arc for Multi-Cloud

### Connecting AWS Resources

```bash
# Connect AWS EKS cluster to Azure Arc
# First, configure AWS credentials
aws configure

# Get EKS cluster credentials
aws eks update-kubeconfig --name my-eks-cluster --region us-east-1

# Connect to Azure Arc
az connectedk8s connect \
    --resource-group "MultiCloudK8s" \
    --name "aws-eks-cluster" \
    --location "eastus" \
    --distribution eks

# Verify connection
az connectedk8s show \
    --resource-group "MultiCloudK8s" \
    --name "aws-eks-cluster"
```

### Connecting GCP Resources

```bash
# Connect GKE cluster to Azure Arc
# Configure GCP credentials
gcloud auth login
gcloud config set project my-gcp-project

# Get GKE cluster credentials
gcloud container clusters get-credentials my-gke-cluster --zone us-central1-a

# Connect to Azure Arc
az connectedk8s connect \
    --resource-group "MultiCloudK8s" \
    --name "gcp-gke-cluster" \
    --location "eastus" \
    --distribution gke

# List all connected clusters
az connectedk8s list --output table
```

### Multi-Cloud Monitoring

```csharp
using Azure.Monitor.Query;
using Azure.Identity;

public class MultiCloudMonitoringService
{
    private readonly LogsQueryClient _logsClient;

    public MultiCloudMonitoringService()
    {
        _logsClient = new LogsQueryClient(new DefaultAzureCredential());
    }

    public async Task<MultiCloudStatus> GetClusterStatusAsync(string workspaceId)
    {
        var query = @"
            KubeNodeInventory
            | summarize
                NodeCount = dcount(Computer),
                ReadyNodes = dcountif(Computer, Status == 'Ready'),
                LastHeartbeat = max(TimeGenerated)
                by ClusterName
            | extend
                CloudProvider = case(
                    ClusterName contains 'eks', 'AWS',
                    ClusterName contains 'gke', 'GCP',
                    ClusterName contains 'aks', 'Azure',
                    'Unknown'
                )
            | project ClusterName, CloudProvider, NodeCount, ReadyNodes, LastHeartbeat";

        var response = await _logsClient.QueryWorkspaceAsync(
            workspaceId,
            query,
            new QueryTimeRange(TimeSpan.FromHours(1)));

        var status = new MultiCloudStatus();

        foreach (var row in response.Value.Table.Rows)
        {
            status.Clusters.Add(new ClusterStatus
            {
                ClusterName = row["ClusterName"].ToString(),
                CloudProvider = row["CloudProvider"].ToString(),
                NodeCount = Convert.ToInt32(row["NodeCount"]),
                ReadyNodes = Convert.ToInt32(row["ReadyNodes"]),
                LastHeartbeat = (DateTime)row["LastHeartbeat"]
            });
        }

        return status;
    }

    public async Task<List<CostByCloud>> GetMultiCloudCostsAsync()
    {
        // Aggregate costs from multiple sources
        var costs = new List<CostByCloud>();

        // Azure costs from Cost Management API
        var azureCosts = await GetAzureCostsAsync();
        costs.Add(new CostByCloud { Provider = "Azure", Cost = azureCosts });

        // AWS costs (would need AWS Cost Explorer API)
        // GCP costs (would need GCP Billing API)

        return costs;
    }
}

public class MultiCloudStatus
{
    public List<ClusterStatus> Clusters { get; set; } = new();
}

public class ClusterStatus
{
    public string ClusterName { get; set; }
    public string CloudProvider { get; set; }
    public int NodeCount { get; set; }
    public int ReadyNodes { get; set; }
    public DateTime LastHeartbeat { get; set; }
}
```

### Unified Policy Management

```json
// Azure Policy for multi-cloud governance
{
    "mode": "All",
    "policyRule": {
        "if": {
            "allOf": [
                {
                    "field": "type",
                    "equals": "Microsoft.Kubernetes/connectedClusters"
                },
                {
                    "field": "Microsoft.Kubernetes/connectedClusters/distribution",
                    "in": ["eks", "gke", "aks"]
                },
                {
                    "field": "tags['CostCenter']",
                    "exists": false
                }
            ]
        },
        "then": {
            "effect": "deny"
        }
    },
    "parameters": {}
}
```

### GitOps Across Clouds

```yaml
# Flux configuration for multi-cloud GitOps
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: GitRepository
metadata:
  name: multi-cloud-configs
  namespace: flux-system
spec:
  interval: 5m
  url: https://github.com/org/multi-cloud-k8s
  ref:
    branch: main\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
