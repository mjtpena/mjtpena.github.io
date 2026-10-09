---
title: "Azure Kubernetes Service Upgrades: A Practical Guide"
description: "AKS cluster upgrades are the operational task that feels straightforward until you do them in production and discover the nuances—node cordoning order, pod…"
author: "Michael John Peña"
draft: false
date: 2021-10-01
tags: ["Azure", "Kubernetes", "AKS", "DevOps"]
---

AKS cluster upgrades are the operational task that feels straightforward until you do them in production and discover the nuances—node cordoning order, pod disruption budgets blocking drain operations, admission webhooks that fail against new API versions, and the fact that "30 days to upgrade before support ends" is less buffer than it sounds when you factor in testing cycles and change management processes. The upgrade path is sequential: you can't skip minor versions. If your cluster is on 1.20 and 1.23 is available, you upgrade 1.20→1.21→1.22→1.23, not 1.20→1.23 directly. Control plane upgrades first, then node pools. The cluster auto-upgrade feature (available since 2021) handles this automatically on a schedule, which is the right default for teams without dedicated platform engineers managing upgrade windows manually.

## Understanding AKS Version Support

Microsoft supports three minor GA versions of Kubernetes. When a new minor version is released, the oldest supported version is deprecated. You typically have 30 days after deprecation to upgrade before the version goes out of support.

## Checking Available Upgrades

First, let's check what upgrades are available for your cluster:

```bash
# Get the current cluster version
az aks show --resource-group myResourceGroup --name myAKSCluster --query kubernetesVersion -o tsv

# Check available upgrades
az aks get-upgrades --resource-group myResourceGroup --name myAKSCluster --output table
```

## Planning Your Upgrade Strategy

Before upgrading, consider these factors:

1. **Test in non-production first** - Always validate upgrades in dev/staging environments
2. **Review release notes** - Check for breaking changes and deprecated APIs
3. **Validate workloads** - Ensure your applications are compatible with the target version

## Performing the Upgrade

### Control Plane Upgrade

You can upgrade just the control plane first:

```bash
az aks upgrade \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --control-plane-only \
    --kubernetes-version 1.22.2
```

### Full Cluster Upgrade

To upgrade both control plane and node pools:

```bash
az aks upgrade \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --kubernetes-version 1.22.2
```

## Upgrade Strategy with Node Pools

For production clusters, I recommend a staged approach:

```bash
# Step 1: Upgrade control plane only
az aks upgrade \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --control-plane-only \
    --kubernetes-version 1.22.2

# Step 2: Upgrade system node pool
az aks nodepool upgrade \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name systempool \
    --kubernetes-version 1.22.2

# Step 3: Upgrade user node pools one at a time
az aks nodepool upgrade \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name userpool1 \
    --kubernetes-version 1.22.2
```

## Setting Max Surge for Faster Upgrades

By default, AKS upgrades nodes one at a time. You can speed this up with max surge:

```bash
az aks nodepool update \
    --resource-group myResourceGroup \
    --cluster-name myAKSCluster \
    --name userpool1 \
    --max-surge 33%
```

## Monitoring the Upgrade

Watch the upgrade progress:

```bash
# Watch node status
kubectl get nodes -w

# Check pod status
kubectl get pods --all-namespaces -o wide
```

## Handling Upgrade Failures

If an upgrade fails, you can check the activity log:

```bash
az monitor activity-log list \
    --resource-group myResourceGroup \
    --query "[?contains(operationName.value, 'Microsoft.ContainerService')]"
```

## Automating Upgrades

For non-production environments, consider auto-upgrade channels:

```bash
az aks update \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --auto-upgrade-channel stable
```

Available channels:
- `none` - No automatic upgrades
- `patch` - Automatically upgrade to the latest patch version
- `stable` - Automatically upgrade to the latest stable version
- `rapid` - Automatically upgrade to the latest supported version
- `node-image` - Automatically upgrade node images

## Conclusion

Regular AKS upgrades are essential for maintaining a secure and well-supported cluster. By following a staged approach and testing thoroughly, you can minimize downtime and ensure smooth transitions between versions.

Tomorrow, we'll dive deeper into AKS node pools and how to design them for different workload requirements.
