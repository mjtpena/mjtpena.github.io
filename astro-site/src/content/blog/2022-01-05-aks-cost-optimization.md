---
title: "AKS Cost Optimization: Strategies for Reducing Kubernetes Spending"
author: Michael John Peña
draft: false
date: 2022-01-05
url: /blog/aks-cost-optimization/
tags:
  - Azure
  - Kubernetes
  - AKS
  - cost-optimization
---

## Understanding AKS Costs

AKS costs come from several components:
- Virtual Machine nodes
- Storage (managed disks, Azure Files)
- Networking (load balancers, bandwidth)
- Container Registry
- Log Analytics

## Right-Sizing Your Nodes

Use the Kubernetes Vertical Pod Autoscaler (VPA) to understand actual resource usage:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Off"  # Just recommend, don't auto-apply
  resourcePolicy:
    containerPolicies:
    - containerName: '*'
      minAllowed:
        cpu: 100m
        memory: 128Mi
      maxAllowed:
        cpu: 4
        memory: 8Gi
```

## Cluster Autoscaler Configuration

Configure the cluster autoscaler for cost efficiency:

```bicep
agentPoolProfiles: [
  {
    name: 'userpool'
    count: 2
    vmSize: 'Standard_D4s_v3'
    enableAutoScaling: true
    minCount: 1
    maxCount: 20
    scaleDownMode: 'Delete'
    scaleSetEvictionPolicy: 'Delete'
  }
]
```

Set appropriate scale-down settings:

```bash
az aks update \
  --resource-group myResourceGroup \
  --name myAKSCluster \
  --cluster-autoscaler-profile \
    scale-down-delay-after-add=10m \
    scale-down-unneeded-time=10m \
    scale-down-utilization-threshold=0.5
```

## Using Spot Node Pools

Spot VMs can reduce costs by up to 90%:

```bicep
resource spotPool 'Microsoft.ContainerService/managedClusters/agentPools@2021-10-01' = {
  parent: aksCluster
  name: 'spotpool'
  properties: {
    count: 3
    vmSize: 'Standard_D4s_v3'
    scaleSetPriority: 'Spot'
    scaleSetEvictionPolicy: 'Delete'
    spotMaxPrice: -1  // Use current spot price
    enableAutoScaling: true
    minCount: 0
    maxCount: 50
    nodeTaints: [
      'kubernetes.azure.com/scalesetpriority=spot:NoSchedule'
    ]
    nodeLabels: {
      'kubernetes.azure.com/scalesetpriority': 'spot'
    }
  }
}
```

Schedule workloads on spot nodes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-job
spec:
  template:
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: kubernetes.azure.com/scalesetpriority
                operator: In
                values:
                - spot
      tolerations:
      - key: kubernetes.azure.com/scalesetpriority
        operator: Equal
        value: spot
        effect: NoSchedule
      containers:
      - name: batch
        image: myregistry.azurecr.io/batch:latest
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "2"
            memory: "2Gi"
```

## Reserved Instances for Base Capacity

For predictable workloads, use reserved instances:

```bash
# Calculate your base capacity needs first
# Then purchase reservations for consistent savings

az reservations reservation-order purchase \
  --sku Standard_D4s_v3 \
  --location eastus \
  --reserved-resource-type VirtualMachines \
  --billing-scope-id /subscriptions/xxx \
  --term P1Y \
  --quantity 5 \
  --applied-scope-type Single \
  --applied-scopes /subscriptions/xxx/resourceGroups/myResourceGroup
```

## Implementing Pod Disruption Budgets

Protect critical workloads while allowing cost optimization:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api
```

## Cost Monitoring with KubeCost

Deploy KubeCost for visibility:

```bash
helm repo add kubecost https://kubecost.github.io/cost-analyzer/
helm install kubecost kubecost/cost-analyzer \
  --namespace kubecost \
  --create-namespace \
  --set kubecostToken="xxx"
```

## Summary

Key cost optimization strategies:
1. Right-size resources using VPA recommendations
2. Use cluster autoscaler aggressively
3. Leverage Spot VMs for fault-tolerant workloads
4. Purchase reserved instances for baseline capacity
5. Monitor and analyze costs continuously
6. Implement resource quotas and limit ranges

A well-optimized AKS cluster can reduce costs by 50-70% without sacrificing performance.
