---
title: Azure Kubernetes Service Networking Deep Dive
author: Michael John Pena
draft: false
date: 2021-03-01
url: /blog/azure-kubernetes-service-networking/
tags:
  - Azure
  - Kubernetes
  - AKS
  - Networking
  - Cloud Native

---


AKS networking is the part of Kubernetes that looks like a detail until it becomes a blocker. "I can't reach the on-prem database from the cluster" is a conversation that happens exactly once per project, usually at the worst possible moment. The choices made at cluster creation—CNI vs kubenet, the CIDR ranges, whether to use Azure CNI with overlay or not—can't be easily changed later. Today I'm walking through the key decisions, what each choice forecloses, and the private cluster + Private DNS Zone configuration I now use by default for anything production-bound.

## Network Models in AKS

AKS supports two primary network models: kubenet and Azure CNI (Container Network Interface).

### Kubenet (Basic Networking)

Kubenet is the default networking option. With kubenet:
- Nodes receive an IP address from the Azure virtual network subnet
- Pods receive an IP address from a logically different address space
- Network address translation (NAT) is configured so pods can reach resources on the Azure virtual network

```bash
# Create an AKS cluster with kubenet networking
az aks create \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --network-plugin kubenet \
    --vnet-subnet-id /subscriptions/<subscription-id>/resourceGroups/myResourceGroup/providers/Microsoft.Network/virtualNetworks/myVnet/subnets/mySubnet \
    --pod-cidr 10.244.0.0/16 \
    --service-cidr 10.0.0.0/16 \
    --dns-service-ip 10.0.0.10 \
    --docker-bridge-address 172.17.0.1/16 \
    --generate-ssh-keys
```

### Azure CNI (Advanced Networking)

Azure CNI provides every pod with an IP address from the subnet and can be accessed directly. These IP addresses must be unique across your network space.

```bash
# Create an AKS cluster with Azure CNI
az aks create \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --network-plugin azure \
    --vnet-subnet-id /subscriptions/<subscription-id>/resourceGroups/myResourceGroup/providers/Microsoft.Network/virtualNetworks/myVnet/subnets/mySubnet \
    --service-cidr 10.0.0.0/16 \
    --dns-service-ip 10.0.0.10 \
    --docker-bridge-address 172.17.0.1/16 \
    --generate-ssh-keys
```

## Network Policies

Network policies in Kubernetes allow you to control traffic flow between pods. AKS supports both Azure Network Policy and Calico.

```yaml
# network-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress

