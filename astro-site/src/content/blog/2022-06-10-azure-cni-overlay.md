---
title: "Azure CNI Overlay: Scalable Pod Networking"
author: Michael John Peña
draft: false
date: 2022-06-10
tags:
  - azure
  - aks
  - networking
  - cni

---

I wrote "Azure CNI Overlay: Scalable Pod Networking" to share practical, production-minded guidance on this topic.

## Traditional vs Overlay Networking

Traditional Azure CNI assigns VNet IPs to pods, limiting scale. Overlay mode uses a separate address space for pods.

## Enabling Overlay Mode

```bash
az aks create \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --network-plugin azure \
    --network-plugin-mode overlay \
    --pod-cidr 192.168.0.0/16
```

## Configuration

```yaml
# Node configuration
nodeConfig:
  networkPlugin: azure
  networkPluginMode: overlay
  podCIDR: 192.168.0.0/16
  serviceCIDR: 10.0.0.0/16
```

## Benefits

- Larger pod address space
- Reduced VNet IP consumption
- Better scalability
- Maintained Azure integration

## Migration Considerations

```bash
# Check current network mode
az aks show --resource-group myRG --name myAKS --query networkProfile
```

## Summary

Azure CNI Overlay solves IP exhaustion challenges while maintaining Azure network integration, enabling larger AKS deployments.


