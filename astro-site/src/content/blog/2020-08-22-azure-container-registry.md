---
title: "Managing Container Images with Azure Container Registry"
description: "Azure Container Registry provides a secure, scalable foundation for container-based deployments on Azure."
author: Michael John Peña
draft: false
date: 2020-08-22
tags:
  - Azure
  - Containers
  - Docker
  - DevOps
---

## Creating a Container Registry

```bash
# Create a container registry
az acr create \
    --resource-group rg-containers \
    --name myacr2020 \
    --sku Premium \
    --location australiaeast

# Enable admin user (for development)
az acr update \
    --name myacr2020 \
    --admin-enabled true

# Get login credentials
az acr credential show --name myacr2020
```

## SKU Comparison

| Feature | Basic | Standard | Premium |
|---------|-------|----------|---------|
| Storage | 10 GB | 100 GB | 500 GB |
| Webhooks | 2 | 10 | 500 |
| Geo-replication | No | No | Yes |
| Content trust | No | No | Yes |
| Private endpoints | No | No | Yes |

## Building Images with ACR Tasks

Build directly in ACR without local Docker:

```bash
# Quick build from Dockerfile
az acr build \
    --registry myacr2020 \
    --image myapp:v1 \
    --file Dockerfile .

# Build with build arguments
az acr build \
    --registry myacr2020 \
    --image myapp:v1 \
    --build-arg BUILD_ENV=production \
    --file Dockerfile .
```

## Multi-Stage Dockerfile Example

```dockerfile
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:3.1 AS build
WORKDIR /src

COPY *.csproj ./
RUN dotnet restore

COPY . ./
RUN dotnet publish -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:3.1 AS runtime
WORKDIR /app

COPY --from=build /app/publish .

EXPOSE 80
ENTRYPOINT ["dotnet", "MyApp.dll"]
```

## Pushing Images to ACR

```bash
# Login to ACR
az acr login --name myacr2020

# Tag local image
docker tag myapp:latest myacr2020.azurecr.io/myapp:v1

# Push to ACR
docker push myacr2020.azurecr.io/myapp:v1

# List images
az acr repository list --name myacr2020

# Show tags
az acr repository show-tags \
    --name myacr2020 \
    --repository myapp
```

## ACR Tasks for Automation

Create a task for automatic builds:

```yaml
# acr-task.yaml
version: v1.1.0
steps:
  - build: -t {{.Run.Registry}}/myapp:{{.Run.ID}} -t {{.Run.Registry}}/myapp:latest .
  - push:
      - {{.Run.Registry}}/myapp:{{.Run.ID}}
      - {{.Run.Registry}}/myapp:latest
```

```bash
# Create the task
az acr task create \
    --registry myacr2020 \
    --name build-myapp \
    --context https://github.com/myorg/myapp.git \
    --file Dockerfile \
    --image myapp:{{.Run.ID}} \
    --git-access-token $PAT

# Trigger on commits
az acr task create \
    --registry myacr2020 \
    --name auto-build \
    --context https://github.com/myorg/myapp.git \
    --file Dockerfile \
    --image myapp:{{.Run.ID}} \
    --commit-trigger-enabled true \
    --git-access-token $PAT
```

## Base Image Updates

Automatically rebuild when base images update:

```bash
az acr task create \
    --registry myacr2020 \
    --name base-image-update \
    --context https://github.com/myorg/myapp.git \
    --file Dockerfile \
    --image myapp:{{.Run.ID}} \
    --base-image-trigger-enabled true \
    --git-access-token $PAT
```

## Security Scanning

```bash
# Enable vulnerability scanning
az acr config content-trust update \
    --registry myacr2020 \
    --status enabled

# View scan results
az acr repository show \
    --name myacr2020 \
    --image myapp:v1 \
    --query "changeableAttributes.quarantineState"
```

## Geo-Replication

For global deployments:

```bash
# Add replication regions
az acr replication create \
    --registry myacr2020 \
    --location westus2

az acr replication create \
    --registry myacr2020 \
    --location westeurope

# List replications
az acr replication list --registry myacr2020
```

## Service Principal Authentication

For CI/CD pipelines:

```bash
# Create service principal
az ad sp create-for-rbac \
    --name acr-service-principal \
    --scopes /subscriptions/{sub}/resourceGroups/rg-containers/providers/Microsoft.ContainerRegistry/registries/myacr2020 \
    --role acrpush

# Use in Docker login
docker login myacr2020.azurecr.io \
    --username $SP_APP_ID \
    --password $SP_PASSWORD
```

## Managed Identity with AKS

```bash
# Attach ACR to AKS
az aks update \
    --name my-aks-cluster \
    --resource-group rg-aks \
    --attach-acr myacr2020

# Or during AKS creation
az aks create \
    --resource-group rg-aks \
    --name my-aks-cluster \
    --attach-acr myacr2020
```

## Webhooks

Trigger actions on image push:

```bash
# Create a webhook
az acr webhook create \
    --registry myacr2020 \
    --name deploy-webhook \
    --uri https://myapp.azurewebsites.net/api/deploy \
    --actions push \
    --scope myapp:*

# Test the webhook
az acr webhook ping --registry myacr2020 --name deploy-webhook
```

## Image Retention Policies

Clean up old images:

```bash
# Delete untagged manifests
az acr run \
    --registry myacr2020 \
    --cmd "acr purge --filter 'myapp:.*' --untagged --ago 30d" \
    /dev/null

# Create scheduled purge task
az acr task create \
    --registry myacr2020 \
    --name purge-task \
    --cmd "acr purge --filter 'myapp:.*' --untagged --ago 7d --keep 5" \
    --schedule "0 0 * * *" \
    --context /dev/null
```

## Importing Images

Import from other registries:

```bash
# Import from Docker Hub
az acr import \
    --name myacr2020 \
    --source docker.io/library/nginx:latest \
    --image nginx:latest

# Import from another ACR
az acr import \
    --name myacr2020 \
    --source otheracr.azurecr.io/myapp:v1 \
    --image myapp:v1
```

Azure Container Registry provides a secure, scalable foundation for container-based deployments on Azure.

One often-missed lever: ACR Tasks. Instead of building images in a CI runner and pushing them, ACR Tasks build *inside* the registry — fast network, no egress, and you can trigger rebuilds on base-image updates so security patches flow through automatically. For teams that haven't already standardised on a CI builder, Tasks are a surprisingly clean place to land.
