---
title: "Serverless Kubernetes with AKS Virtual Nodes"
author: "Michael John Peña"
draft: false
date: 2021-10-04
tags: ["Azure", "Kubernetes", "AKS", "Serverless", "ACI"]

---

I wrote "Serverless Kubernetes with AKS Virtual Nodes" to share practical, production-minded guidance on this topic.

Virtual nodes in AKS enable pods to run on Azure Container Instances rather than on VM-based node pool nodes—useful for burst workloads that spike unpredictably and where provisioning a new VM node (which takes minutes) is too slow. The mechanism is Virtual Kubelet: a Kubernetes node object backed by ACI rather than a VM. When a pod is scheduled to the virtual node, it launches as an ACI container group, consuming ACI pricing (per-second billing) rather than VM hours. The practical limitations in 2021: not all workloads can run on virtual nodes (DaemonSets don't work, host networking isn't supported, some admission webhooks behave differently), and ACI cold start is slower than scheduling to a pre-warmed node. Virtual nodes work best for batch and burst scenarios that arrive unpredictably and where a few seconds of startup latency is acceptable.

## How Virtual Nodes Work

Virtual nodes use the Virtual Kubelet to provision pods in ACI. When you schedule a pod on a virtual node:
1. Kubernetes scheduler assigns the pod to the virtual node
2. Virtual Kubelet creates a container group in ACI
3. The pod runs in ACI with its own networking and storage

## Prerequisites

Before enabling virtual nodes:
- AKS cluster must use Azure CNI networking
- A subnet dedicated to ACI in your virtual network
- The Microsoft.ContainerInstance provider registered

## Enabling Virtual Nodes

### Register the Provider

```bash
az provider register --namespace Microsoft.ContainerInstance
```

### Create a Subnet for ACI

```bash
az network vnet subnet create \
    --resource-group myResourceGroup \
    --vnet-name myVNet \
    --name aciSubnet \
    --address-prefixes 10.241.0.0/16 \
    --delegations Microsoft.ContainerInstance/containerGroups
```

### Enable Virtual Nodes on AKS

```bash
az aks enable-addons \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --addons virtual-node \
    --subnet-name aciSubnet
```

## Verifying Virtual Node Installation

```bash
# Check virtual node is ready
kubectl get nodes

# Output should show virtual-node-aci-linux
NAME                                STATUS   ROLES   AGE   VERSION
aks-nodepool1-12345678-vmss000000   Ready    agent   1d    v1.22.2
virtual-node-aci-linux              Ready    agent   1h    v1.19.10-vk-azure-aci-1.4.1
```

## Scheduling Pods on Virtual Nodes

Use node selectors and tolerations:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: burst-workload
spec:
  replicas: 10
  selector:
    matchLabels:
      app: burst-workload
  template:
    metadata:
      labels:
        app: burst-workload
    spec:
      nodeSelector:
        kubernetes.io/role: agent
        beta.kubernetes.io/os: linux
        type: virtual-kubelet
      tolerations:
      - key: virtual-kubelet.io/provider
        operator: Exists
      - key: azure.com/aci
        effect: NoSchedule
      containers:
      - name: processor
        image: myregistry.azurecr.io/processor:v1
        resources:
          requests:
            cpu: 1
            memory: 2Gi
          limits:
            cpu: 2
            memory: 4Gi
```

## Burst Scaling Pattern

Combine virtual nodes with cluster autoscaler for intelligent scaling:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 5
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
              - key: type
                operator: NotIn
                values:
                - virtual-kubelet
          - weight: 1
            preference:
              matchExpressions:
              - key: type
                operator: In
                values:
                - virtual-kubelet
      tolerations:
      - key: virtual-kubelet.io/provider
        operator: Exists
      - key: azure.com/aci
        effect: NoSchedule
      containers:
      - name: web
        image: myregistry.azurecr.io/web:v1
```

This configuration prefers regular nodes but allows bursting to virtual nodes when needed.

## Using GPU on Virtual Nodes

ACI supports NVIDIA GPUs:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-workload
spec:
  nodeSelector:
    type: virtual-kubelet
  tolerations:
  - key: virtual-kubelet.io/provider
    operator: Exists
  - key: azure.com/aci
    effect: NoSchedule
  containers:
  - name: gpu-processor
    image: myregistry.azurecr.io/gpu-processor:v1
    resources:
      requests:
        cpu: 4
        memory: 14Gi
      limits:
        cpu: 4
        memory: 14Gi
        nvidia.com/gpu: 1
```

## Persistent Storage with Virtual Nodes

Mount Azure Files shares:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: stateful-aci-pod
spec:
  nodeSelector:
    type: virtual-kubelet
  tolerations:
  - key: virtual-kubelet.io/provider
    operator: Exists
  containers:
  - name: app
    image: myregistry.azurecr.io/app:v1
    volumeMounts:
    - name: azure-files
      mountPath: /data
  volumes:
  - name: azure-files
    azureFile:
      secretName: azure-secret
      shareName: myshare
      readOnly: false
```

## Networking Considerations

Virtual nodes run in a dedicated subnet. Configure network policies:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-aci-traffic
spec:
  podSelector:
    matchLabels:
      app: backend-api
  ingress:
  - from:
    - ipBlock:
        cidr: 10.241.0.0/16  # ACI subnet
    ports:
    - protocol: TCP
      port: 8080
```

## Terraform Configuration

```hcl
resource "azurerm_subnet" "aci" {
  name                 = "aci-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.241.0.0/16"]

  delegation {
    name = "aciDelegation"
    service_delegation {
      name    = "Microsoft.ContainerInstance/containerGroups"
      actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
    }
  }
}

resource "azurerm_kubernetes_cluster" "main" {
  name                = "myAKSCluster"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "myaks"

  default_node_pool {
    name       = "default"
    node_count = 3
    vm_size    = "Standard_D2s_v3"
    vnet_subnet_id = azurerm_subnet.default.id
  }

  network_profile {
    network_plugin = "azure"
  }

  aci_connector_linux {
    subnet_name = azurerm_subnet.aci.name
  }

  identity {
    type = "SystemAssigned"
  }
}
```

## Monitoring Virtual Node Pods

Query ACI metrics in Azure Monitor:

```kusto
ContainerInstanceLog_CL
| where ContainerGroup_s contains "aci-connector"
| project TimeGenerated, ContainerGroup_s, Message
| order by TimeGenerated desc
```

## Limitations to Consider

1. **No DaemonSets** - DaemonSets don't apply to virtual nodes
2. **Limited regions** - Not available in all Azure regions
3. **No privileged containers** - ACI doesn't support privileged mode
4. **Init container limitations** - Some init container features may not work
5. **Service mesh considerations** - Sidecar injection needs special handling

## Best Practices

1. **Use for burst workloads** - Virtual nodes excel at handling traffic spikes
2. **Set resource requests** - ACI billing is based on resource allocation
3. **Implement health checks** - Ensure quick detection of failed pods
4. **Consider cold start** - Account for container pull time in SLAs
5. **Use private registries** - Configure ACI to pull from ACR with managed identity

## Conclusion

Virtual nodes provide a powerful serverless option for Kubernetes workloads. They're ideal for burst scenarios, batch processing, and workloads that need rapid, unlimited scaling without infrastructure management.

Tomorrow, we'll dive into AKS pod identity for secure access to Azure resources.

