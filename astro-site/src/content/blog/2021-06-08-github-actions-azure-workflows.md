---
title: GitHub Actions Workflows for Azure Deployments
description: "GitHub Actions workflows for Azure deployment have become my default for any project that lives on GitHub and targets Azure. The Azure/login action with…"
author: Michael John Peña
draft: false
date: 2021-06-08
url: /blog/github-actions-azure-workflows/
tags:
  - GitHub Actions
  - Azure
  - CI/CD
  - DevOps
---

GitHub Actions workflows for Azure deployment have become my default for any project that lives on GitHub and targets Azure. The Azure/login action with OIDC removes the service principal secret management problem entirely. The Azure CLI action, the AKS set-context action, the Function App deploy action—they cover the deployment scenarios I hit most frequently. The pattern I've settled on: environment-specific deployment workflows triggered by branch pushes (main → production, release/* → staging), with environment protection rules in GitHub for the production deployment approval gate. Reusable workflows (GitHub's equivalent of Azure Pipelines templates) keep the shared logic in one place.

## Basic Workflow Structure

```yaml
# .github/workflows/azure-deploy.yml
name: Deploy to Azure

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:  # Manual trigger

env:
  AZURE_WEBAPP_NAME: myapp
  AZURE_WEBAPP_PACKAGE_PATH: './publish'
  DOTNET_VERSION: '6.0.x'

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup .NET
        uses: actions/setup-dotnet@v1
        with:
          dotnet-version: ${{ env.DOTNET_VERSION }}
          include-prerelease: true

      - name: Restore dependencies
        run: dotnet restore

      - name: Build
        run: dotnet build --configuration Release --no-restore

      - name: Test
        run: dotnet test --no-restore --verbosity normal

      - name: Publish
        run: dotnet publish -c Release -o ${{ env.AZURE_WEBAPP_PACKAGE_PATH }}

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: webapp
          path: ${{ env.AZURE_WEBAPP_PACKAGE_PATH }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Download artifact
        uses: actions/download-artifact@v2
        with:
          name: webapp
          path: ${{ env.AZURE_WEBAPP_PACKAGE_PATH }}

      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v2
        with:
          app-name: ${{ env.AZURE_WEBAPP_NAME }}
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: ${{ env.AZURE_WEBAPP_PACKAGE_PATH }}
```

## Azure Login Methods

### Using Service Principal

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      # AZURE_CREDENTIALS format:
      # {
      #   "clientId": "<GUID>",
      #   "clientSecret": "<SECRET>",
      #   "subscriptionId": "<GUID>",
      #   "tenantId": "<GUID>"
      # }
```

### Using OIDC (Recommended)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Azure Login with OIDC
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

## Multi-Environment Deployments

```yaml
name: Multi-Environment Deploy

on:
  push:
    branches: [main, develop]

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v2

      - name: Generate version
        id: version
        run: echo "::set-output name=version::$(date +'%Y.%m.%d').${{ github.run_number }}"

      - name: Setup .NET
        uses: actions/setup-dotnet@v1
        with:
          dotnet-version: '6.0.x'

      - name: Build and publish
        run: |
          dotnet restore
          dotnet build --configuration Release
          dotnet publish -c Release -o ./publish

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: webapp-${{ steps.version.outputs.version }}
          path: ./publish

  deploy-dev:
    needs: build
    runs-on: ubuntu-latest
    environment: development
    if: github.ref == 'refs/heads/develop' || github.ref == 'refs/heads/main'

    steps:
      - name: Download artifact
        uses: actions/download-artifact@v2
        with:
          name: webapp-${{ needs.build.outputs.version }}
          path: ./publish

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS_DEV }}

      - name: Deploy to Dev
        uses: azure/webapps-deploy@v2
        with:
          app-name: myapp-dev
          package: ./publish

  deploy-staging:
    needs: [build, deploy-dev]
    runs-on: ubuntu-latest
    environment: staging
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Download artifact
        uses: actions/download-artifact@v2
        with:
          name: webapp-${{ needs.build.outputs.version }}
          path: ./publish

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS_STAGING }}

      - name: Deploy to Staging
        uses: azure/webapps-deploy@v2
        with:
          app-name: myapp-staging
          package: ./publish

  deploy-production:
    needs: [build, deploy-staging]
    runs-on: ubuntu-latest
    environment: production
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Download artifact
        uses: actions/download-artifact@v2
        with:
          name: webapp-${{ needs.build.outputs.version }}
          path: ./publish

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS_PROD }}

      - name: Deploy to Production
        uses: azure/webapps-deploy@v2
        with:
          app-name: myapp-prod
          slot-name: staging
          package: ./publish

      - name: Swap slots
        run: |
          az webapp deployment slot swap \
            --name myapp-prod \
            --resource-group rg-prod \
            --slot staging \
            --target-slot production
```

## Azure Functions Deployment

```yaml
name: Deploy Azure Function

on:
  push:
    branches: [main]
    paths:
      - 'src/Functions/**'

env:
  AZURE_FUNCTIONAPP_NAME: my-function-app
  AZURE_FUNCTIONAPP_PACKAGE_PATH: 'src/Functions'
  DOTNET_VERSION: '6.0.x'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup .NET
        uses: actions/setup-dotnet@v1
        with:
          dotnet-version: ${{ env.DOTNET_VERSION }}

      - name: Build Functions
        shell: bash
        run: |
          pushd '${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}'
          dotnet build --configuration Release --output ./output
          popd

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
          package: '${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}/output'
```

## Container Deployment to AKS

```yaml
name: Deploy to AKS

on:
  push:
    branches: [main]

env:
  REGISTRY: myregistry.azurecr.io
  IMAGE_NAME: myapp
  CLUSTER_NAME: my-aks-cluster
  RESOURCE_GROUP: rg-aks

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}

    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Login to ACR
        run: az acr login --name myregistry

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v3
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=ref,event=branch

      - name: Build and push
        uses: docker/build-push-action@v2
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Get AKS credentials
        run: |
          az aks get-credentials \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --name ${{ env.CLUSTER_NAME }}

      - name: Deploy to AKS
        run: |
          kubectl set image deployment/myapp \
            myapp=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          kubectl rollout status deployment/myapp
```

## Infrastructure as Code with Terraform

```yaml
name: Terraform Deploy

on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/**'
  pull_request:
    branches: [main]
    paths:
      - 'infrastructure/**'

env:
  TF_VERSION: '1.0.0'
  WORKING_DIRECTORY: './infrastructure'

jobs:
  plan:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ env.TF_VERSION }}

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Terraform Init
        working-directory: ${{ env.WORKING_DIRECTORY }}
        run: terraform init

      - name: Terraform Plan
        working-directory: ${{ env.WORKING_DIRECTORY }}
        run: terraform plan -out=tfplan
        env:
          ARM_CLIENT_ID: ${{ secrets.ARM_CLIENT_ID }}
          ARM_CLIENT_SECRET: ${{ secrets.ARM_CLIENT_SECRET }}
          ARM_SUBSCRIPTION_ID: ${{ secrets.ARM_SUBSCRIPTION_ID }}
          ARM_TENANT_ID: ${{ secrets.ARM_TENANT_ID }}

      - name: Upload plan
        uses: actions/upload-artifact@v2
        with:
          name: tfplan
          path: ${{ env.WORKING_DIRECTORY }}/tfplan

  apply:
    needs: plan
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production

    steps:
      - uses: actions/checkout@v2

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ env.TF_VERSION }}

      - name: Download plan
        uses: actions/download-artifact@v2
        with:
          name: tfplan
          path: ${{ env.WORKING_DIRECTORY }}

      - name: Terraform Init
        working-directory: ${{ env.WORKING_DIRECTORY }}
        run: terraform init

      - name: Terraform Apply
        working-directory: ${{ env.WORKING_DIRECTORY }}
        run: terraform apply -auto-approve tfplan
        env:
          ARM_CLIENT_ID: ${{ secrets.ARM_CLIENT_ID }}
          ARM_CLIENT_SECRET: ${{ secrets.ARM_CLIENT_SECRET }}
          ARM_SUBSCRIPTION_ID: ${{ secrets.ARM_SUBSCRIPTION_ID }}
          ARM_TENANT_ID: ${{ secrets.ARM_TENANT_ID }}
```

## Reusable Workflows

```yaml
# .github/workflows/reusable-dotnet-build.yml
name: Reusable .NET Build

on:
  workflow_call:
    inputs:
      dotnet-version:
        required: false
        type: string
        default: '6.0.x'
      configuration:
        required: false
        type: string
        default: 'Release'
    outputs:
      artifact-name:
        description: 'Name of the published artifact'
        value: ${{ jobs.build.outputs.artifact-name }}

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      artifact-name: webapp-${{ github.run_number }}

    steps:
      - uses: actions/checkout@v2

      - name: Setup .NET
        uses: actions/setup-dotnet@v1
        with:
          dotnet-version: ${{ inputs.dotnet-version }}

      - name: Build
        run: |
          dotnet restore
          dotnet build --configuration ${{ inputs.configuration }}
          dotnet publish -c ${{ inputs.configuration }} -o ./publish

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: webapp-${{ github.run_number }}
          path: ./publish
```

### Using Reusable Workflow

```yaml
# .github/workflows/main.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main]

jobs:
  build:
    uses: ./.github/workflows/reusable-dotnet-build.yml
    with:
      dotnet-version: '6.0.x'
      configuration: 'Release'

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v2
        with:
          name: ${{ needs.build.outputs.artifact-name }}
```

## Conclusion

GitHub Actions provides a flexible platform for Azure deployments with excellent integration options. By leveraging reusable workflows, environment protection rules, and the extensive marketplace, you can build sophisticated CI/CD pipelines that scale with your organization's needs.

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Azure GitHub Actions](https://github.com/Azure/actions)
