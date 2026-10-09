---
title: "Azure Deployment Environments: Infrastructure as Code for Dev Teams"
description: "Azure Deployment Environments addresses these challenges with templated, self-service infrastructure."
author: Michael John Peña
draft: false
date: 2022-05-02
tags:
  - Azure
  - deployment-environments
  - infrastructure-as-code
  - DevOps
---

## The Problem It Solves

Traditionally, developers would need to:
1. Request infrastructure from IT/Platform teams
2. Wait for provisioning (hours to days)
3. Deal with configuration drift between environments

Azure Deployment Environments addresses these challenges with templated, self-service infrastructure.

## Environment Definitions

Create reusable environment templates using ARM or Bicep:

```bicep
// environment.bicep
@description('The environment name')
param environmentName string

@description('The location for resources')
param location string = resourceGroup().location

resource appServicePlan 'Microsoft.Web/serverfarms@2021-03-01' = {
  name: '${environmentName}-plan'
  location: location
  sku: {
    name: 'P1v3'
    tier: 'PremiumV3'
    size: 'P1v3'
    capacity: 1
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2021-03-01' = {
  name: '${environmentName}-app'
  location: location
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|6.0'
      alwaysOn: true
    }
  }
}

resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
  name: '${environmentName}-sql'
  location: location
  properties: {
    administratorLogin: 'sqladmin'
    administratorLoginPassword: 'P@ssw0rd123!'
    version: '12.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2021-11-01' = {
  parent: sqlServer
  name: '${environmentName}-db'
  location: location
  sku: {
    name: 'S0'
    tier: 'Standard'
  }
}

output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
```

## Catalog Configuration

Define your environment catalog in a Git repository:

```yaml
# manifest.yaml
name: web-app-with-sql
version: 1.0.0
summary: Web application with Azure SQL Database
description: |
  Deploys an App Service with Azure SQL Database
  Suitable for development and testing scenarios
parameters:
  - name: environmentName
    type: string
    required: true
    description: Name prefix for all resources
  - name: sqlAdminPassword
    type: secureString
    required: true
    description: SQL Server admin password
templatePath: ./environment.bicep
```

## Setting Up Dev Center

Configure the Dev Center with environment types:

```powershell
# Create Dev Center
az devcenter admin devcenter create \
    --name "contoso-devcenter" \
    --resource-group "platform-rg" \
    --location "eastus"

# Create environment type
az devcenter admin environment-type create \
    --dev-center-name "contoso-devcenter" \
    --resource-group "platform-rg" \
    --name "Dev" \
    --tags Environment=Development

# Create catalog from GitHub
az devcenter admin catalog create \
    --dev-center-name "contoso-devcenter" \
    --resource-group "platform-rg" \
    --name "environment-catalog" \
    --git-hub \
    --uri "https://github.com/contoso/env-catalog.git" \
    --branch "main" \
    --path "/environments"
```

## Project Configuration

```csharp
using Azure.ResourceManager.DevCenter;
using Azure.ResourceManager.DevCenter.Models;

public async Task ConfigureProjectAsync(DevCenterResource devCenter)
{
    // Create project
    var projectData = new DevCenterProjectData(AzureLocation.EastUS)
    {
        DevCenterId = devCenter.Id,
        Description = "E-commerce platform development"
    };

    var project = await devCenter.GetDevCenterProjects()
        .CreateOrUpdateAsync(WaitUntil.Completed, "ecommerce-project", projectData);

    // Configure environment type for project
    var envTypeData = new ProjectEnvironmentTypeData
    {
        DeploymentTargetId = new ResourceIdentifier(
            "/subscriptions/xxx/resourceGroups/dev-environments"),
        Status = EnvironmentTypeEnableStatus.Enabled,
        CreatorRoleAssignment = new ProjectEnvironmentTypeUpdatePropertiesCreatorRoleAssignment
        {
            Roles = { { "Contributor", new EnvironmentRole() } }
        }
    };

    await project.Value.GetProjectEnvironmentTypes()
        .CreateOrUpdateAsync(WaitUntil.Completed, "Dev", envTypeData);
}
```

## Developer Experience

Developers can create environments through CLI or portal:

```bash
# List available environment definitions
az devcenter dev environment-definition list \
    --project "ecommerce-project"

# Create a new environment
az devcenter dev environment create \
    --project "ecommerce-project" \
    --environment-type "Dev" \
    --catalog-name "environment-catalog" \
    --environment-definition-name "web-app-with-sql" \
    --name "feature-checkout" \
    --parameters '{"environmentName": "checkout-dev"}'

# Check environment status
az devcenter dev environment show \
    --project "ecommerce-project" \
    --name "feature-checkout"

# Delete environment when done
az devcenter dev environment delete \
    --project "ecommerce-project" \
    --name "feature-checkout"
```

## Cost Management

Set up budget controls and expiration policies:

```json
{
  "properties": {
    "maxEnvironmentsPerUser": 5,
    "defaultAutoExpireMinutes": 480,
    "budgetPerEnvironment": {
      "amount": 100,
      "currency": "USD",
      "period": "Daily"
    }
  }
}
```

## Integration with CI/CD

Use environments in your GitHub Actions workflow:

```yaml
name: Feature Environment

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  create-environment:
    runs-on: ubuntu-latest
    steps:
      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Create Environment
        run: |
          az devcenter dev environment create \
            --project "ecommerce-project" \
            --environment-type "Dev" \
            --catalog-name "environment-catalog" \
            --environment-definition-name "web-app-with-sql" \
            --name "pr-${{ github.event.pull_request.number }}" \
            --parameters '{"environmentName": "pr-${{ github.event.pull_request.number }}"}'

      - name: Deploy Application
        run: |
          # Deploy to the newly created environment
          az webapp deploy --name "pr-${{ github.event.pull_request.number }}-app" \
            --resource-group "pr-${{ github.event.pull_request.number }}-rg" \
            --src-path ./publish
```

## Summary

Azure Deployment Environments bridges the gap between developer agility and platform governance:

- Self-service infrastructure provisioning
- Consistent, versioned environment definitions
- Cost controls and automatic cleanup
- Integration with existing DevOps workflows

This service complements Microsoft Dev Box by providing the backend infrastructure that developers need alongside their cloud workstations.
