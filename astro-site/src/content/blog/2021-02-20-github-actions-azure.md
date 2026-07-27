---
title: CI/CD to Azure with GitHub Actions
author: Michael John Peña
draft: false
date: 2021-02-20
url: /blog/github-actions-azure/
tags:
  - Azure
  - GitHub Actions
  - CI/CD
  - DevOps
  - Automation
---

GitHub Actions went from "interesting alternative to Azure DevOps Pipelines" to "my default CI/CD choice for most new Azure projects" in about twelve months. The tipping point was OIDC authentication—instead of storing a service principal secret in a GitHub repo secret, you federate the identity, and the workflow requests a short-lived token per run. No secret rotation, no leaked credentials in logs, no "who rotated the service principal last and when?" conversations. Plus the Azure Actions catalogue (deployments, Function publishes, AKS updates) has caught up to the AzDO tasks in coverage.

## Setting Up Azure Authentication

### Using OIDC (Recommended)

```bash
# Create Azure AD App Registration for GitHub OIDC
az ad app create --display-name github-actions-oidc

# Get the app ID
APP_ID=$(az ad app list --display-name github-actions-oidc --query "[0].appId" -o tsv)

# Create federated credential for GitHub
az ad app federated-credential create \
    --id $APP_ID \
    --parameters '{
        "name": "github-main-branch",
        "issuer": "https://token.actions.githubusercontent.com",
        "subject": "repo:myorg/myrepo:ref:refs/heads/main",
        "description": "GitHub Actions main branch",
        "audiences": ["api://AzureADTokenExchange"]
    }'

# Create service principal
az ad sp create --id $APP_ID

# Assign role
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
az role assignment create \
    --role Contributor \
    --assignee $APP_ID \
    --scope /subscriptions/$SUBSCRIPTION_ID
```

## Basic Deployment Workflow

```yaml
# .github/workflows/deploy-azure.yml
name: Deploy to Azure

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  id-token: write
  contents: read

env:
  AZURE_RESOURCE_GROUP: rg-myapp
  AZURE_WEBAPP_NAME: app-myapp-prod

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build application
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: app-build
          path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment:
      name: production
      url: ${{ steps.deploy.outputs.webapp-url }}

    steps:
      - name: Download artifact
        uses: actions/download-artifact@v3
        with:
          name: app-build
          path: dist/

      - name: Azure Login (OIDC)
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to Azure Web App
        id: deploy
        uses: azure/webapps-deploy@v2
        with:
          app-name: ${{ env.AZURE_WEBAPP_NAME }}
          package: dist/
```

## Container Deployment to Azure

```yaml
# .github/workflows/deploy-container.yml
name: Build and Deploy Container

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

env:
  ACR_NAME: myregistryacr
  IMAGE_NAME: myapp
  RESOURCE_GROUP: rg-containers
  ACA_NAME: myapp-container

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Login to ACR
        run: az acr login --name ${{ env.ACR_NAME }}

      - name: Build and push image
        run: |
          IMAGE_TAG=${{ env.ACR_NAME }}.azurecr.io/${{ env.IMAGE_NAME }}:${{ github.sha }}
          docker build -t $IMAGE_TAG .
          docker push $IMAGE_TAG
          echo "IMAGE_TAG=$IMAGE_TAG" >> $GITHUB_ENV

      - name: Deploy to Azure Container Apps
        run: |
          az containerapp update \
            --name ${{ env.ACA_NAME }} \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --image ${{ env.IMAGE_TAG }}
```

## Infrastructure Deployment with Bicep

```yaml
# .github/workflows/deploy-infrastructure.yml
name: Deploy Infrastructure

on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/**'
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'dev'
        type: choice
        options:
          - dev
          - staging
          - prod

permissions:
  id-token: write
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Validate Bicep
        run: |
          az bicep build --file infrastructure/main.bicep

      - name: What-If Analysis
        uses: azure/arm-deploy@v1
        with:
          scope: subscription
          region: eastus
          subscriptionId: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
          template: infrastructure/main.bicep
          parameters: infrastructure/parameters.${{ github.event.inputs.environment || 'dev' }}.json
          additionalArguments: --what-if

  deploy:
    needs: validate
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'dev' }}

    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Bicep
        uses: azure/arm-deploy@v1
        with:
          scope: subscription
          region: eastus
          subscriptionId: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
          template: infrastructure/main.bicep
          parameters: infrastructure/parameters.${{ github.event.inputs.environment || 'dev' }}.json
          deploymentName: deploy-${{ github.run_number }}
```

## Azure Functions Deployment

```yaml
# .github/workflows/deploy-functions.yml
name: Deploy Azure Functions

on:
  push:
    branches: [main]
    paths:
      - 'functions/**'

permissions:
  id-token: write
  contents: read

env:
  AZURE_FUNCTIONAPP_NAME: func-myapp-prod
  PYTHON_VERSION: '3.9'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dependencies
        run: |
          cd functions
          python -m pip install --upgrade pip
          pip install -r requirements.txt --target=".python_packages/lib/site-packages"

      - name: Run tests
        run: |
          cd functions
          pip install pytest
          python -m pytest tests/

      - name: Azure Login
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Functions
        uses: azure/functions-action@v1
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
          package: functions
          scm-do-build-during-deployment: false
```

## Multi-Environment Pipeline

```yaml
# .github/workflows/multi-env-deploy.yml
name: Multi-Environment Deployment

on:
  push:
    branches: [main, develop]

permissions:
  id-token: write
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      artifact-name: ${{ steps.build.outputs.artifact }}
    steps:
      - uses: actions/checkout@v3

      - name: Build
        id: build
        run: |
          npm ci
          npm run build
          echo "artifact=build-${{ github.sha }}" >> $GITHUB_OUTPUT

      - uses: actions/upload-artifact@v3
        with:
          name: build-${{ github.sha }}
          path: dist/

  deploy-dev:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    environment: development
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: ${{ needs.build.outputs.artifact-name }}

      - uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: azure/webapps-deploy@v2
        with:
          app-name: app-myapp-dev
          package: .

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: staging
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: ${{ needs.build.outputs.artifact-name }}

      - uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: azure/webapps-deploy@v2
        with:
          app-name: app-myapp-staging
          package: .

  deploy-production:
    needs: [build, deploy-staging]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://myapp.azurewebsites.net
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: ${{ needs.build.outputs.artifact-name }}

      - uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: azure/webapps-deploy@v2
        with:
          app-name: app-myapp-prod
          package: .
          slot-name: staging

      - name: Swap slots
        run: |
          az webapp deployment slot swap \
            --name app-myapp-prod \
            --resource-group rg-myapp \
            --slot staging \
            --target-slot production
```

## Reusable Workflows

```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      app-name:
        required: true
        type: string
    secrets:
      AZURE_CLIENT_ID:
        required: true
      AZURE_TENANT_ID:
        required: true
      AZURE_SUBSCRIPTION_ID:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: actions/download-artifact@v3
        with:
          name: build-artifact

      - uses: azure/webapps-deploy@v2
        with:
          app-name: ${{ inputs.app-name }}
          package: .
```

Call the reusable workflow:

```yaml
# .github/workflows/main.yml
jobs:
  deploy-prod:
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: production
      app-name: app-myapp-prod
    secrets:
      AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
      AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
      AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

## Best Practices

1. **Use OIDC authentication** instead of storing credentials as secrets
2. **Implement environment protection rules** for production deployments
3. **Use reusable workflows** to reduce duplication
4. **Cache dependencies** to speed up builds
5. **Run security scans** before deploying
6. **Use deployment slots** for zero-downtime deployments

## Conclusion

GitHub Actions provides a powerful, flexible platform for deploying to Azure. With OIDC authentication, you can securely deploy without managing secrets, while environments and protection rules ensure proper governance for production deployments.

Start with simple workflows and gradually add complexity as your CI/CD needs evolve.
