---
title: "Azure Container Registry: Private Docker Registry"
description: "A second pass at ACR, this time with the lessons I've collected from running it for clients. Use the geo-replicated SKU only if you actually need…"
author: Michael John Peña
draft: false
date: 2020-10-29
tags:
  - Azure
  - Containers
  - Docker
  - ACR
---

A second pass at ACR, this time with the lessons I've collected from running it for clients. Use the geo-replicated SKU only if you actually need cross-region pulls; otherwise, the Premium tier features that *are* worth the upgrade are content trust, vulnerability scanning, and private endpoints. The default tier is fine for getting started; the Premium features pay for themselves the first time a vulnerability scan finds a CVE in a base image you've shipped to production.

## Creating a Registry

```bash
# Create registry
az acr create \
    --resource-group myRG \
    --name myregistry \
    --sku Premium \
    --location eastus

# Enable admin user (for simple scenarios)
az acr update --name myregistry --admin-enabled true

# Get credentials
az acr credential show --name myregistry
```

## Push an Image

```bash
# Login to ACR
az acr login --name myregistry

# Tag image for ACR
docker tag myapp:v1 myregistry.azurecr.io/myapp:v1

# Push
docker push myregistry.azurecr.io/myapp:v1

# Quick build and push (no local Docker needed)
az acr build --registry myregistry --image myapp:v1 .
```

## ACR Tasks

Build images in the cloud.

```bash
# Quick build
az acr build --registry myregistry --image myapp:{{.Run.ID}} .

# Multi-step task
az acr run --registry myregistry --file acr-task.yaml .
```

```yaml
# acr-task.yaml
version: v1.1.0
steps:
  - build: -t {{.Run.Registry}}/myapp:{{.Run.ID}} -f Dockerfile .
  - push:
    - {{.Run.Registry}}/myapp:{{.Run.ID}}
    - {{.Run.Registry}}/myapp:latest
```

## Automated Builds

```bash
# Trigger build on git commit
az acr task create \
    --registry myregistry \
    --name buildOnCommit \
    --image myapp:{{.Run.ID}} \
    --context https://github.com/myorg/myrepo.git \
    --file Dockerfile \
    --git-access-token $GITHUB_PAT

# Trigger build on base image update
az acr task create \
    --registry myregistry \
    --name buildOnBaseUpdate \
    --image myapp:{{.Run.ID}} \
    --context https://github.com/myorg/myrepo.git \
    --file Dockerfile \
    --base-image-trigger-enabled true
```

## Geo-Replication

```bash
# Add replica regions
az acr replication create --registry myregistry --location westus
az acr replication create --registry myregistry --location westeurope

# List replicas
az acr replication list --registry myregistry --output table
```

## AKS Integration

```bash
# Attach ACR to AKS (uses managed identity)
az aks update \
    --name myAKSCluster \
    --resource-group myRG \
    --attach-acr myregistry

# Now AKS can pull images without credentials
```

## Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: myapp
          image: myregistry.azurecr.io/myapp:v1
          ports:
            - containerPort: 80
```

## Image Scanning

```bash
# Enable Defender for container registries
# Automatically scans images for vulnerabilities

# View scan results
az acr repository show-manifests \
    --name myregistry \
    --repository myapp \
    --detail
```

## Repository Management

```bash
# List repositories
az acr repository list --name myregistry

# List tags
az acr repository show-tags --name myregistry --repository myapp

# Delete old tags
az acr repository delete --name myregistry --image myapp:old-tag

# Delete untagged manifests (cleanup)
az acr run --registry myregistry --cmd "acr purge --filter 'myapp:.*' --ago 30d --untagged" /dev/null
```

## Private Endpoints

```bash
# Create private endpoint for ACR
az network private-endpoint create \
    --name acrPrivateEndpoint \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet mySubnet \
    --private-connection-resource-id $(az acr show --name myregistry --query id -o tsv) \
    --group-id registry \
    --connection-name acrConnection
```

ACR is the secure home for your container images.
