---
title: "GitHub Actions for Azure Deployments"
description: "Azure DevOps Pipelines was the obvious answer for years. GitHub Actions in 2020 changed that calculus — for any project where the source already lives on…"
author: Michael John Peña
draft: false
date: 2020-10-10
tags:
  - GitHub
  - Azure
  - CI/CD
  - DevOps
---

Azure DevOps Pipelines was the obvious answer for years. GitHub Actions in 2020 changed that calculus — for any project where the source already lives on GitHub, keeping CI/CD in the same place removes a whole layer of cross-system plumbing. The OIDC-based federated identity for `azure/login` (newer than this post, but the direction of travel) makes credential management cleaner too. For new projects, GitHub Actions is increasingly my default.

## Azure Login Action

```yaml
name: Deploy to Azure

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
```

## Setting Up Credentials

```bash
# Create service principal
az ad sp create-for-rbac --name "github-actions" --role contributor \
    --scopes /subscriptions/{subscription-id} --sdk-auth

# Output JSON goes to GitHub secret AZURE_CREDENTIALS
```

## Deploy to App Service

```yaml
- name: Build and deploy
  uses: azure/webapps-deploy@v2
  with:
    app-name: 'my-web-app'
    package: './dist'
```

## Deploy to AKS

```yaml
- name: Set AKS context
  uses: azure/aks-set-context@v1
  with:
    creds: ${{ secrets.AZURE_CREDENTIALS }}
    cluster-name: myAKSCluster
    resource-group: myResourceGroup

- name: Deploy to AKS
  uses: azure/k8s-deploy@v1
  with:
    manifests: |
      kubernetes/deployment.yaml
      kubernetes/service.yaml
    images: |
      myregistry.azurecr.io/myapp:${{ github.sha }}
```

## Deploy ARM Template

```yaml
- name: Deploy ARM Template
  uses: azure/arm-deploy@v1
  with:
    subscriptionId: ${{ secrets.AZURE_SUBSCRIPTION }}
    resourceGroupName: myResourceGroup
    template: ./azuredeploy.json
    parameters: environment=production
```

## Complete Workflow

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Build
        run: npm ci && npm run build
      - name: Test
        run: npm test
      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: dist
          path: dist

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v2
        with:
          name: dist
      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: Deploy
        uses: azure/webapps-deploy@v2
        with:
          app-name: my-app
          package: .
```

GitHub Actions + Azure = streamlined DevOps.
