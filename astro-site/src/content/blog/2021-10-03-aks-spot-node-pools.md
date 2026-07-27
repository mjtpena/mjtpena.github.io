---
title: "Cost Optimization with AKS Spot Node Pools"
author: "Michael John Peña"
draft: false
date: 2021-10-03
tags: ["Azure", "Kubernetes", "AKS", "Cost Optimization"]

---

I wrote "Cost Optimization with AKS Spot Node Pools" to share practical, production-minded guidance on this topic.

AKS Spot node pools are the cost reduction lever that can cut compute spend by up to 90%—at the cost of accepting that Azure may evict spot nodes with a two-minute warning when it needs the capacity back. The deal: Azure Spot VMs use excess Azure capacity at heavily discounted prices, but that capacity can be reclaimed. The right workload types: batch processing jobs with checkpointing (can restart from last checkpoint if interrupted), CI/CD agents (new builds can retry), stateless worker pods with queue-based work distribution (incomplete work returns to the queue on eviction). The wrong workload types: stateful databases, anything that can't tolerate interruption mid-operation, user-facing services without equivalent non-spot fallback capacity. The standard pattern is a non-spot node pool with minimum capacity for critical services, plus spot node pools for burst and batch work.

## Understanding Spot VMs

Spot VMs are ideal for workloads that can handle interruptions:
- Batch processing jobs
- Dev/test environments
- CI/CD build agents
- Stateless web applications with redundancy
- Big data processing

## Creating a Spot Node Pool

```bash
az aks nodepool add \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name spotpool \
    --node-count 3 \
    --node-vm-size Standard_D4s_v3 \
    --priority Spot \
    --eviction-policy Delete \
    --spot-max-price -1 \
    --labels kubernetes.azure.com/scalesetpriority=spot \
    --node-taints kubernetes.azure.com/scalesetpriority=spot:NoSchedule
```

Key parameters:
- `--priority Spot` - Creates a spot node pool
- `--eviction-policy Delete` - Deletes the VM when evicted (default)
- `--spot-max-price -1` - Pay up to the on-demand price (never evicted for price)

## Setting a Maximum Price

To control costs further, set a maximum price per hour:

```bash
az aks nodepool add \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name spotpool \
    --node-count 3 \
    --node-vm-size Standard_D4s_v3 \
    --priority Spot \
    --eviction-policy Delete \
    --spot-max-price 0.05
```

## Handling Evictions Gracefully

Spot VMs can be evicted with 30 seconds notice. Design your applications to handle this:

### Pod Disruption Budgets

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: batch-job-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: batch-processor
```

### Graceful Shutdown Handler

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-processor
spec:
  replicas: 5
  selector:
    matchLabels:
      app: batch-processor
  template:
    metadata:
      labels:
        app: batch-processor
    spec:
      nodeSelector:
        kubernetes.azure.com/scalesetpriority: spot
      tolerations:
      - key: "kubernetes.azure.com/scalesetpriority"
        operator: "Equal"
        value: "spot"
        effect: "NoSchedule"
      terminationGracePeriodSeconds: 25
      containers:
      - name: processor
        image: myregistry.azurecr.io/batch-processor:v1
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 5 && /app/graceful-shutdown.sh"]
```

## Spot Node Pool with Autoscaling

Combine spot nodes with cluster autoscaler:

```bash
az aks nodepool update \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name spotpool \
    --enable-cluster-autoscaler \
    --min-count 0 \
    --max-count 20
```

## Hybrid Architecture: Spot + Regular Nodes

For reliability, combine spot and regular nodes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 6
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            preference:
              matchExpressions:
              - key: kubernetes.azure.com/scalesetpriority
                operator: In
                values:
                - spot
          - weight: 1
            preference:
              matchExpressions:
              - key: kubernetes.azure.com/scalesetpriority
                operator: DoesNotExist
      tolerations:
      - key: "kubernetes.azure.com/scalesetpriority"
        operator: "Equal"
        value: "spot"
        effect: "NoSchedule"
      containers:
      - name: web
        image: myregistry.azurecr.io/web-app:v1
```

## Terraform Configuration

```hcl
resource "azurerm_kubernetes_cluster_node_pool" "spot" {
  name                  = "spot"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size              = "Standard_D4s_v3"

  priority        = "Spot"
  eviction_policy = "Delete"
  spot_max_price  = -1

  enable_auto_scaling = true
  node_count          = 3
  min_count           = 0
  max_count           = 20

  node_labels = {
    "kubernetes.azure.com/scalesetpriority" = "spot"
  }

  node_taints = [
    "kubernetes.azure.com/scalesetpriority=spot:NoSchedule"
  ]

  tags = {
    Environment = "Production"
    NodeType    = "Spot"
  }
}
```

## Monitoring Spot Evictions

Create an alert for spot evictions:

```bash
# Query for spot eviction events in Azure Monitor
az monitor metrics alert create \
    --name spot-eviction-alert \
    --resource-group myResourceGroup \
    --scopes /subscriptions/{subscription-id}/resourceGroups/myResourceGroup/providers/Microsoft.ContainerService/managedClusters/myAKSCluster \
    --condition "count VMEvictionCount > 0" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action myActionGroup
```

## Cost Comparison Script

```python
import subprocess
import json

def get_vm_pricing(vm_size, region):
    # Fetch spot and regular prices
    result = subprocess.run([
        'az', 'vm', 'list-skus',
        '--location', region,
        '--size', vm_size,
        '--output', 'json'
    ], capture_output=True, text=True)

    return json.loads(result.stdout)

def calculate_savings(regular_price, spot_price, hours_per_month=730):
    monthly_regular = regular_price * hours_per_month
    monthly_spot = spot_price * hours_per_month
    savings = monthly_regular - monthly_spot
    percentage = (savings / monthly_regular) * 100

    return {
        'monthly_regular': monthly_regular,
        'monthly_spot': monthly_spot,
        'savings': savings,
        'percentage': percentage
    }

# Example usage
# savings = calculate_savings(0.192, 0.038)
# print(f"Monthly savings: ${savings['savings']:.2f} ({savings['percentage']:.1f}%)")
```

## Best Practices

1. **Never run stateful workloads on spot** - Use regular nodes for databases and persistent workloads
2. **Implement proper health checks** - Ensure quick pod replacement
3. **Use multiple VM sizes** - Increase availability across different spot pools
4. **Set appropriate PDBs** - Maintain minimum availability during evictions
5. **Monitor eviction rates** - Track and respond to high eviction periods
6. **Combine with regular nodes** - Ensure baseline capacity for critical workloads

## Conclusion

Spot node pools are an excellent way to reduce Kubernetes costs for appropriate workloads. By designing for interruption and implementing proper failover strategies, you can achieve significant savings while maintaining reliability.

Tomorrow, we'll explore virtual nodes for serverless Kubernetes scaling.

