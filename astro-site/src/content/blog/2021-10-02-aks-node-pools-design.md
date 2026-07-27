---
title: "Designing AKS Node Pools for Production Workloads"
author: "Michael John Peña"
draft: false
date: 2021-10-02
tags: ["Azure", "Kubernetes", "AKS", "Infrastructure"]

---

I wrote "Designing AKS Node Pools for Production Workloads" to share practical, production-minded guidance on this topic.

Node pools are the AKS mechanism for running heterogeneous workloads on a single cluster—different VM SKUs, OS types, and node configurations within the same cluster namespace. The system node pool (required, Linux) runs critical cluster components: CoreDNS, metrics-server, and the AKS-managed system pods. User node pools run your application workloads. The design principle: isolate workloads with different hardware or OS requirements into separate node pools, use taints and tolerations to ensure pods schedule on the right pool, and size node pools for the expected workload shape. For a cluster running both web API pods (CPU-bound, benefit from burstable B-series VMs) and ML inference pods (GPU-required, need NC-series), two user node pools with distinct VM SKUs and taints is the correct architecture.

## System vs User Node Pools

AKS distinguishes between two types of node pools:

**System Node Pools:**
- Run critical system pods (CoreDNS, metrics-server, etc.)
- Required for cluster operation
- Should be highly available

**User Node Pools:**
- Run your application workloads
- Can be specialized for different needs
- Can be scaled to zero

## Creating a System Node Pool

```bash
# Create a dedicated system node pool
az aks nodepool add \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name systempool \
    --node-count 3 \
    --node-vm-size Standard_DS2_v2 \
    --mode System \
    --zones 1 2 3
```

## Creating Specialized User Node Pools

### General Purpose Workloads

```bash
az aks nodepool add \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name generalpool \
    --node-count 3 \
    --node-vm-size Standard_D4s_v3 \
    --mode User \
    --zones 1 2 3 \
    --labels workload=general
```

### Memory-Optimized for Databases

```bash
az aks nodepool add \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name memorypool \
    --node-count 2 \
    --node-vm-size Standard_E4s_v3 \
    --mode User \
    --zones 1 2 3 \
    --labels workload=memory-intensive \
    --node-taints workload=memory-intensive:NoSchedule
```

### GPU-Enabled for ML Workloads

```bash
az aks nodepool add \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name gpupool \
    --node-count 1 \
    --node-vm-size Standard_NC6s_v3 \
    --mode User \
    --labels workload=gpu \
    --node-taints sku=gpu:NoSchedule
```

## Using Node Selectors and Tolerations

To schedule pods on specific node pools, use node selectors and tolerations:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ml-training-job
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ml-training
  template:
    metadata:
      labels:
        app: ml-training
    spec:
      nodeSelector:
        workload: gpu
      tolerations:
      - key: "sku"
        operator: "Equal"
        value: "gpu"
        effect: "NoSchedule"
      containers:
      - name: training
        image: myregistry.azurecr.io/ml-training:v1
        resources:
          limits:
            nvidia.com/gpu: 1
```

## Node Pool Autoscaling

Enable cluster autoscaler for dynamic scaling:

```bash
az aks nodepool update \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name generalpool \
    --enable-cluster-autoscaler \
    --min-count 2 \
    --max-count 10
```

## Scaling Node Pools to Zero

User node pools can scale to zero to save costs:

```bash
# Scale to zero manually
az aks nodepool scale \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name gpupool \
    --node-count 0

# Or enable autoscaler with min-count 0
az aks nodepool update \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name gpupool \
    --enable-cluster-autoscaler \
    --min-count 0 \
    --max-count 3
```

## Node Pool Management with Terraform

For infrastructure as code, here's a Terraform example:

```hcl
resource "azurerm_kubernetes_cluster_node_pool" "general" {
  name                  = "general"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size              = "Standard_D4s_v3"
  node_count           = 3

  enable_auto_scaling = true
  min_count           = 2
  max_count           = 10

  zones = ["1", "2", "3"]

  node_labels = {
    "workload" = "general"
  }

  tags = {
    Environment = "Production"
  }
}

resource "azurerm_kubernetes_cluster_node_pool" "memory" {
  name                  = "memory"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size              = "Standard_E8s_v3"
  node_count           = 2

  enable_auto_scaling = true
  min_count           = 1
  max_count           = 5

  zones = ["1", "2", "3"]

  node_labels = {
    "workload" = "memory-intensive"
  }

  node_taints = [
    "workload=memory-intensive:NoSchedule"
  ]
}
```

## Best Practices

1. **Separate system and user workloads** - Keep system pods isolated for stability
2. **Use availability zones** - Distribute nodes across zones for HA
3. **Right-size your VMs** - Match VM sizes to workload requirements
4. **Implement autoscaling** - Use cluster autoscaler for dynamic workloads
5. **Use taints and tolerations** - Ensure pods run on appropriate nodes
6. **Plan for upgrades** - Design node pools to allow rolling upgrades

## Conclusion

Thoughtful node pool design is crucial for running efficient, cost-effective Kubernetes workloads. By separating workloads and matching resources to requirements, you can optimize both performance and cost.

Tomorrow, we'll explore spot node pools for cost optimization with interruptible workloads.

