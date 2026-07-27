---
title: "Workload Identity Federation: Keyless Authentication from Anywhere"
author: Michael John Peña
draft: false
date: 2022-02-12
url: /blog/workload-identity-federation/
tags:
  - azure
  - security
  - identity
  - federation

---

I wrote "Workload Identity Federation: Keyless Authentication from Anywhere" to share practical, production-minded guidance on this topic.

## How Federation Works

Instead of client secrets:
1. External identity provider issues a token
2. Token is exchanged for an Azure AD token
3. Application uses Azure AD token to access resources

## Setting Up Federation for GitHub Actions

```bicep
// Create service principal and configure federation
resource appRegistration 'Microsoft.Graph/applications@v1.0' = {
  displayName: 'GitHub Actions Deploy'
  web: {
    redirectUris: []
  }
}

resource federatedCredential 'Microsoft.Graph/applications/federatedIdentityCredentials@v1.0' = {
  name: 'github-main-branch'
  parent: appRegistration
  properties: {
    name: 'github-main-branch'
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:myorg/myrepo:ref:refs/heads/main'
    audiences: ['api://AzureADTokenExchange']
  }
}
```

Using Azure CLI:

```bash
# Create app registration
az ad app create --display-name "GitHub Actions Deploy"
APP_ID=$(az ad app list --display-name "GitHub Actions Deploy" --query "[0].appId" -o tsv)

# Create federated credential
az ad app federated-credential create \
  --id $APP_ID \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:myorg/myrepo:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# Create service principal
az ad sp create --id $APP_ID

# Grant permissions
az role assignment create \
  --assignee $APP_ID \
  --role "Contributor" \
  --scope "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}"
```

## GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to Azure

on:
  push:
    branches: [main]

permissions:
  id-token: write  # Required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login (OIDC)
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Infrastructure
        run: |
          az deployment group create \
            --resource-group myResourceGroup \
            --template-file main.bicep

      - name: Deploy Application
        uses: azure/webapps-deploy@v2
        with:
          app-name: mywebapp
          package: ./app
```

## Federated Credentials for Different Scenarios

```bash
# For pull requests
az ad app federated-credential create \
  --id $APP_ID \
  --parameters '{
    "name": "github-pull-requests",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:myorg/myrepo:pull_request",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# For specific environment
az ad app federated-credential create \
  --id $APP_ID \
  --parameters '{
    "name": "github-production-env",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:myorg/myrepo:environment:production",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# For tags
az ad app federated-credential create \
  --id $APP_ID \
  --parameters '{
    "name": "github-release-tags",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:myorg/myrepo:ref:refs/tags/v*",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

## Azure DevOps OIDC

```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'Azure-OIDC-Connection'  # Service connection with OIDC
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        az account show
        az deployment group create \
          --resource-group myResourceGroup \
          --template-file main.bicep
```

Service connection configuration:

```json
{
  "name": "Azure-OIDC-Connection",
  "type": "AzureRM",
  "authorizationType": "WorkloadIdentityFederation",
  "data": {
    "subscriptionId": "xxx",
    "subscriptionName": "My Subscription",
    "servicePrincipalId": "xxx",
    "tenantId": "xxx",
    "creationMode": "Manual"
  }
}
```

## Kubernetes Workload Identity

```yaml
# Service account with federated identity
apiVersion: v1
kind: ServiceAccount
metadata:
  name: workload-identity-sa
  namespace: default
  annotations:
    azure.workload.identity/client-id: "<CLIENT_ID>"
  labels:
    azure.workload.identity/use: "true"\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
