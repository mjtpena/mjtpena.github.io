---
title: "OIDC for GitHub Actions: Secure Azure Deployments"
description: "OIDC for GitHub Actions is the modern, secure approach to Azure authentication in CI/CD pipelines."
author: Michael John Peña
draft: false
date: 2022-02-13
url: /blog/oidc-github-actions/
tags:
  - GitHub
  - Azure
  - OIDC
  - Security
---

## Why OIDC?

Traditional approach problems:
- Secrets stored in GitHub
- Manual rotation required
- Risk of secret exposure

OIDC benefits:
- No stored secrets
- Short-lived tokens
- Automatic rotation
- Fine-grained access control

## Setting Up Azure for OIDC

```bash
# Create app registration
az ad app create --display-name "GitHub Actions OIDC"
APP_ID=$(az ad app list --display-name "GitHub Actions OIDC" --query "[0].appId" -o tsv)
OBJECT_ID=$(az ad app list --display-name "GitHub Actions OIDC" --query "[0].id" -o tsv)

# Create service principal
az ad sp create --id $APP_ID
SP_ID=$(az ad sp list --display-name "GitHub Actions OIDC" --query "[0].id" -o tsv)

# Add federated credential for main branch
az rest --method POST \
  --uri "https://graph.microsoft.com/beta/applications/${OBJECT_ID}/federatedIdentityCredentials" \
  --body '{
    "name": "github-actions-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:myorg/myrepo:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# Add federated credential for pull requests
az rest --method POST \
  --uri "https://graph.microsoft.com/beta/applications/${OBJECT_ID}/federatedIdentityCredentials" \
  --body '{
    "name": "github-actions-pr",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:myorg/myrepo:pull_request",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# Grant permissions
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
az role assignment create \
  --assignee $APP_ID \
  --role "Contributor" \
  --scope "/subscriptions/${SUBSCRIPTION_ID}"
```

## Infrastructure with Bicep

```bicep
// setup-oidc.bicep
targetScope = 'subscription'

param githubOrg string
param githubRepo string
param resourceGroupName string
param location string = 'australiaeast'

// Create resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: resourceGroupName
  location: location
}

// Output values needed for GitHub secrets
output tenantId string = subscription().tenantId
output subscriptionId string = subscription().subscriptionId
output resourceGroupName string = rg.name
```

## GitHub Workflow Configuration

```yaml
# .github/workflows/azure-deploy.yml
name: Deploy to Azure

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  id-token: write   # Required for requesting the JWT
  contents: read    # Required for actions/checkout

env:
  AZURE_RESOURCE_GROUP: rg-myapp-prod

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build Application
        run: |
          dotnet build --configuration Release
          dotnet publish --configuration Release --output ./publish

      - uses: actions/upload-artifact@v3
        with:
          name: app
          path: ./publish

  deploy-infrastructure:
    runs-on: ubuntu-latest
    needs: build
    outputs:
      appServiceName: ${{ steps.deploy.outputs.appServiceName }}
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login (OIDC)
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Infrastructure
        id: deploy
        uses: azure/arm-deploy@v1
        with:
          resourceGroupName: ${{ env.AZURE_RESOURCE_GROUP }}
          template: ./infrastructure/main.bicep
          parameters: environment=prod

  deploy-application:
    runs-on: ubuntu-latest
    needs: [build, deploy-infrastructure]
    environment: production
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: app
          path: ./app

      - name: Azure Login (OIDC)
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to App Service
        uses: azure/webapps-deploy@v2
        with:
          app-name: ${{ needs.deploy-infrastructure.outputs.appServiceName }}
          package: ./app
```

## Environment-Specific Access

```bash
# Create separate credentials for each environment
environments=("development" "staging" "production")

for env in "${environments[@]}"; do
  az rest --method POST \
    --uri "https://graph.microsoft.com/beta/applications/${OBJECT_ID}/federatedIdentityCredentials" \
    --body "{
      \"name\": \"github-actions-${env}\",
      \"issuer\": \"https://token.actions.githubusercontent.com\",
      \"subject\": \"repo:myorg/myrepo:environment:${env}\",
      \"audiences\": [\"api://AzureADTokenExchange\"]
    }"
done
```

```yaml
# Workflow with environment-specific deployment
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging  # Must match federated credential subject
    steps:
      - name: Azure Login
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_STAGING }}

  deploy-production:
    runs-on: ubuntu-latest
    needs: deploy-staging
    environment: production  # Requires approval
    steps:
      - name: Azure Login
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_PROD }}
```

## Using Azure CLI with OIDC

```yaml
- name: Azure Login
  uses: azure/login@v1
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Run Azure Commands
  uses: azure/CLI@v1
  with:
    inlineScript: |
      # Get access token for other services
      az account get-access-token --resource https://database.windows.net/

      # Deploy container
      az containerapp update \
        --name myapp \
        --resource-group ${{ env.AZURE_RESOURCE_GROUP }} \
        --image myregistry.azurecr.io/myapp:${{ github.sha }}
```

## Troubleshooting

```yaml
- name: Debug OIDC Token
  run: |
    # Print token claims (for debugging)
    curl -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=api://AzureADTokenExchange" \
      | jq -R 'split(".") | .[1] | @base64d | fromjson'
  env:
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Common issues:
- Subject mismatch (check repo/branch/environment)
- Audience mismatch (must be `api://AzureADTokenExchange`)
- Missing `id-token: write` permission

OIDC for GitHub Actions is the modern, secure approach to Azure authentication in CI/CD pipelines.
