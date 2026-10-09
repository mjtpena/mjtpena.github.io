---
title: Running Windows Containers on Azure Kubernetes Service
author: Michael John Pena
draft: false
date: 2021-03-02
url: /blog/aks-windows-containers/
tags:
  - Azure
  - Kubernetes
  - AKS
  - Windows Containers
  - .NET
---

## Why Windows Containers on AKS?

Many enterprises have legacy .NET Framework applications that cannot easily migrate to .NET Core. Windows containers provide a path to containerization without a complete rewrite, enabling:

- Consistent deployment across environments
- Better resource utilization
- Orchestration benefits of Kubernetes
- Gradual modernization strategy

## Creating an AKS Cluster with Windows Node Pools

First, create a cluster with Azure CNI (required for Windows):

```bash
# Create resource group
az group create --name myWindowsAKS --location eastus

# Create AKS cluster with Azure CNI
az aks create \
    --resource-group myWindowsAKS \
    --name myAKSCluster \
    --node-count 2 \
    --network-plugin azure \
    --generate-ssh-keys \
    --windows-admin-username azureuser \
    --vm-set-type VirtualMachineScaleSets \
    --kubernetes-version 1.19.7

# Add Windows node pool
az aks nodepool add \
    --resource-group myWindowsAKS \
    --cluster-name myAKSCluster \
    --os-type Windows \
    --name npwin \
    --node-count 2 \
    --node-vm-size Standard_D4s_v3
```

## Building a Windows Container Image

Here's a Dockerfile for a .NET Framework application:

```dockerfile
# Dockerfile for .NET Framework 4.8 application
FROM mcr.microsoft.com/dotnet/framework/aspnet:4.8-windowsservercore-ltsc2019

WORKDIR /inetpub/wwwroot

# Copy published application
COPY ./publish/ .

# Configure IIS
RUN powershell -Command \
    Import-Module WebAdministration; \
    Set-ItemProperty 'IIS:\AppPools\DefaultAppPool' -Name processModel.identityType -Value LocalSystem

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD powershell -Command \
    try { \
        $response = Invoke-WebRequest -Uri http://localhost/health -UseBasicParsing; \
        if ($response.StatusCode -eq 200) { exit 0 } \
        else { exit 1 } \
    } catch { exit 1 }
```

Build and push to Azure Container Registry:

```bash
# Build the image
docker build -t myacr.azurecr.io/mywindowsapp:v1 .

# Push to ACR
az acr login --name myacr
docker push myacr.azurecr.io/mywindowsapp:v1
```

## Deploying Windows Workloads

Use node selectors to ensure pods run on Windows nodes:

```yaml
# windows-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aspnet-app
  labels:
    app: aspnet-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: aspnet-app
  template:
    metadata:
      labels:
        app: aspnet-app
    spec:
      nodeSelector:
        kubernetes.io/os: windows
      containers:
      - name: aspnet-app
        image: myacr.azurecr.io/mywindowsapp:v1
        ports:
        - containerPort: 80
        resources:
          limits:
            cpu: "2"
            memory: "4Gi"
          requests:
            cpu: "1"
            memory: "2Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 80
          initialDelaySeconds: 60
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 80
          initialDelaySeconds: 30
          periodSeconds: 10
```
