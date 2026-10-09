---
title: "Azure Kubernetes Service: Managed Kubernetes"
author: Michael John Peña
draft: false
date: 2020-10-08
tags:
  - Azure
  - Kubernetes
  - AKS
  - Containers
---

## Creating a Cluster

```bash
az aks create \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --node-count 3 \
    --node-vm-size Standard_DS2_v2 \
    --enable-addons monitoring \
    --generate-ssh-keys \
    --enable-managed-identity

# Get credentials
az aks get-credentials --resource-group myResourceGroup --name myAKSCluster
```

## Deploying an Application

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: myregistry.azurecr.io/myapp:v1
        ports:
        - containerPort: 80
        resources:
          limits:
            cpu: "500m"
            memory: "128Mi"
```
