---
title: Kubernetes Operators for Azure Resources
author: Michael John Peña
draft: false
date: 2021-06-29
url: /blog/kubernetes-operators-azure/
tags:
  - Azure
  - Kubernetes
  - Operators
  - AKS

---

I wrote "2021-06-29-kubernetes-operators-azure" to share practical, production-minded guidance on this topic.

## Understanding Operators

### Operator Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Control Plane                             ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      ││
│  │  │ API Server   │  │  Controller  │  │   etcd       │      ││
│  │  │              │◄─┤   Manager    │  │              │      ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                ▲                                 │
│                                │ Watch & Reconcile               │
│  ┌─────────────────────────────┴───────────────────────────────┐│
│  │                    Custom Operator                           ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      ││
│  │  │   Custom     │  │  Reconciler  │  │   Azure      │      ││
│  │  │   Resource   │──┤   Logic      │──┤   SDK        │──────┼┼──► Azure
│  │  │  Definitions │  │              │  │              │      ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Azure Service Operator

### Installation

```bash
# Install cert-manager (required)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.8.0/cert-manager.yaml

# Install Azure Service Operator
helm repo add aso2 https://raw.githubusercontent.com/Azure/azure-service-operator/main/v2/charts
helm repo update

helm install aso2 aso2/azure-service-operator \
    --create-namespace \
    --namespace azureserviceoperator-system \
    --set azureSubscriptionID=$AZURE_SUBSCRIPTION_ID \
    --set azureTenantID=$AZURE_TENANT_ID \
    --set azureClientID=$AZURE_CLIENT_ID \
    --set azureClientSecret=$AZURE_CLIENT_SECRET
```

### Creating Azure Resources

```yaml
# resourcegroup.yaml
apiVersion: resources.azure.com/v1api20200601
kind: ResourceGroup
metadata:
  name: rg-myapp
  namespace: default
spec:
  location: australiaeast
  tags:
    environment: production
    managed-by: aso\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
