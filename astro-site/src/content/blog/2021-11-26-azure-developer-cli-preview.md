---
title: "Azure Developer CLI Preview: Streamlined Cloud Development"
description: "Azure Developer CLI represents a significant shift toward developer productivity. By providing high-level commands and proven templates, it reduces the…"
author: Michael John Pena
draft: false
date: 2021-11-26
tags:
  - Azure
  - Developer Tools
  - CLI
  - DevOps
  - Cloud Native
---

## What is Azure Developer CLI?

Azure Developer CLI provides:

- **Template-based setup**: Start projects from proven templates
- **Environment management**: Development, staging, production
- **Integrated provisioning**: Infrastructure as Code with Bicep
- **CI/CD generation**: GitHub Actions and Azure DevOps pipelines
- **Simple commands**: init, up, deploy, down

## Getting Started

### Installation

```bash
# macOS/Linux
curl -fsSL https://aka.ms/install-azd.sh | bash

# Windows (PowerShell)
powershell -ex AllSigned -c "Invoke-RestMethod 'https://aka.ms/install-azd.ps1' | Invoke-Expression"

# Verify installation
azd version

# Login to Azure
azd auth login
```

### Initialize a Project

```bash
# Start from a template
azd init --template azure-samples/todo-nodejs-mongo

# Or create from scratch
mkdir my-app && cd my-app
azd init

# Project structure created:
# my-app/
# ├── .azure/           # Azure configuration
# ├── infra/            # Bicep templates
# ├── src/              # Application code
# └── azure.yaml        # Project configuration
```

### Project Configuration

```yaml
# azure.yaml
name: my-todo-app
metadata:
  template: azure-samples/todo-nodejs-mongo@0.0.1

services:
  api:
    project: ./src/api
    language: js
    host: appservice

  web:
    project: ./src/web
    language: js
    host: appservice

pipeline:
  provider: github
```

## Provisioning Infrastructure

### Single Command Deployment

```bash
# Provision and deploy everything
azd up

# This runs:
# 1. azd provision - Creates Azure resources
# 2. azd deploy - Deploys application code

# Output:
# Deploying services (azd deploy)
#   (1/2) Deploying service api
#   (2/2) Deploying service web
#
# SUCCESS: Your application was deployed to Azure!
#
# Web:  https://my-todo-app-web.azurewebsites.net
# API:  https://my-todo-app-api.azurewebsites.net
```

### Environment Management

```bash
# Create environments
azd env new dev
azd env new staging
azd env new prod

# List environments
azd env list

# Switch environments
azd env select staging

# Set environment variables
azd env set DATABASE_URL "mongodb://..."
azd env set API_KEY "secret-key"

# View environment
azd env get-values
```

### Infrastructure Files

```bicep
// infra/main.bicep
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
param name string

@minLength(1)
param location string

param apiServiceName string = ''
param webServiceName string = ''

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, name, location))
var tags = { 'azd-env-name': name }

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: '${abbrs.resourcesResourceGroups}${name}'
  location: location
  tags: tags
}

module api './app/api.bicep' = {
  name: 'api'
  scope: rg
  params: {
    name: !empty(apiServiceName) ? apiServiceName : '${abbrs.webSitesAppService}api-${resourceToken}'
    location: location
    tags: tags
    applicationInsightsName: monitoring.outputs.applicationInsightsName
    appServicePlanId: appServicePlan.outputs.id
    runtimeName: 'node'
    runtimeVersion: '16-lts'
    appSettings: {
      MONGODB_URI: cosmos.outputs.connectionString
    }
  }
}

module web './app/web.bicep' = {
  name: 'web'
  scope: rg
  params: {
    name: !empty(webServiceName) ? webServiceName : '${abbrs.webSitesAppService}web-${resourceToken}'
    location: location
    tags: tags
    applicationInsightsName: monitoring.outputs.applicationInsightsName
    appServicePlanId: appServicePlan.outputs.id
    runtimeName: 'node'
    runtimeVersion: '16-lts'
    appSettings: {
      API_BASE_URL: api.outputs.uri
    }
  }
}

module appServicePlan './core/host/appserviceplan.bicep' = {
  name: 'appserviceplan'
  scope: rg
  params: {
    name: '${abbrs.webServerFarms}${resourceToken}'
    location: location
    tags: tags
    sku: {
      name: 'B1'
    }
  }
}

module cosmos './core/database/cosmos-mongo.bicep' = {
  name: 'cosmos'
  scope: rg
  params: {
    name: '${abbrs.documentDBDatabaseAccounts}${resourceToken}'
    location: location
    tags: tags
    databaseName: 'todo'
  }
}

module monitoring './core/monitor/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    location: location
    tags: tags
    logAnalyticsName: '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
    applicationInsightsName: '${abbrs.insightsComponents}${resourceToken}'
  }
}

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output API_URI string = api.outputs.uri
output WEB_URI string = web.outputs.uri
```

## CI/CD Pipeline Generation

```bash
# Generate pipeline
azd pipeline config

# This creates:
# - .github/workflows/azure-dev.yml (for GitHub)
# - .azdo/pipelines/azure-dev.yml (for Azure DevOps)
```

Generated GitHub Actions workflow:

```yaml
# .github/workflows/azure-dev.yml
name: Azure Dev

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      AZURE_CLIENT_ID: ${{ vars.AZURE_CLIENT_ID }}
      AZURE_TENANT_ID: ${{ vars.AZURE_TENANT_ID }}
      AZURE_SUBSCRIPTION_ID: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      AZURE_ENV_NAME: ${{ vars.AZURE_ENV_NAME }}
      AZURE_LOCATION: ${{ vars.AZURE_LOCATION }}

    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Install azd
        uses: Azure/setup-azd@v0.1.0

      - name: Log in with Azure (Federated Credentials)
        if: ${{ env.AZURE_CLIENT_ID != '' }}
        run: |
          azd auth login `
            --client-id "$Env:AZURE_CLIENT_ID" `
            --federated-credential-provider "github" `
            --tenant-id "$Env:AZURE_TENANT_ID"
        shell: pwsh

      - name: Provision Infrastructure
        run: azd provision --no-prompt
        env:
          AZURE_ENV_NAME: ${{ vars.AZURE_ENV_NAME }}
          AZURE_LOCATION: ${{ vars.AZURE_LOCATION }}
          AZURE_SUBSCRIPTION_ID: ${{ vars.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Application
        run: azd deploy --no-prompt
```

## Working with Templates

### List Available Templates

```bash
# Browse templates
azd template list

# Popular templates:
# - todo-nodejs-mongo       Node.js + MongoDB
# - todo-python-mongo       Python + MongoDB
# - todo-csharp-cosmos-sql  C# + Cosmos DB
# - todo-java-mongo         Java + MongoDB
# - react-web-app           React frontend
```

### Create Your Own Template

```bash
# Initialize as template
azd init --template-name my-company-template

# Template structure:
my-company-template/
├── .azdo/                    # Azure DevOps pipelines
├── .devcontainer/            # Dev container config
├── .github/                  # GitHub Actions
├── .vscode/                  # VS Code settings
├── infra/                    # Bicep templates
│   ├── main.bicep
│   ├── main.parameters.json
│   └── core/                 # Reusable modules
├── src/
│   ├── api/
│   └── web/
├── azure.yaml                # Project manifest
├── README.md
└── .gitignore
```

Template manifest:

```yaml
# azure.yaml for template
name: my-company-template
metadata:
  template: my-company/microservices-template@1.0.0
  version: 1.0.0

infra:
  provider: bicep
  path: ./infra

services:
  api:
    project: ./src/api
    language: csharp
    host: containerapp
    docker:
      path: ./src/api/Dockerfile

  worker:
    project: ./src/worker
    language: csharp
    host: containerapp
    docker:
      path: ./src/worker/Dockerfile

  web:
    project: ./src/web
    language: js
    host: staticwebapp

hooks:
  preprovision:
    shell: sh
    run: ./scripts/pre-provision.sh

  postprovision:
    shell: sh
    run: ./scripts/post-provision.sh

  predeploy:
    shell: sh
    run: npm run build
```

## Advanced Commands

### Monitoring and Logs

```bash
# View recent logs
azd monitor --logs

# Open Application Insights
azd monitor --live

# Open Azure Portal
azd monitor --portal

# View specific service logs
azd deploy api --logs
```

### Partial Operations

```bash
# Provision only
azd provision

# Deploy only (after provision)
azd deploy

# Deploy specific service
azd deploy api

# Preview changes before provision
azd provision --preview
```

### Clean Up

```bash
# Delete all resources
azd down

# Keep resource group but delete resources
azd down --purge

# Force delete without confirmation
azd down --force
```

## Integration with VS Code

```json
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "azd: up",
      "type": "shell",
      "command": "azd up",
      "problemMatcher": []
    },
    {
      "label": "azd: deploy",
      "type": "shell",
      "command": "azd deploy",
      "problemMatcher": []
    },
    {
      "label": "azd: provision",
      "type": "shell",
      "command": "azd provision",
      "problemMatcher": []
    }
  ]
}
```

Azure Developer CLI represents a significant shift toward developer productivity. By providing high-level commands and proven templates, it reduces the complexity of building cloud applications while maintaining flexibility.

## Resources

- [Azure Developer CLI Documentation](https://docs.microsoft.com/en-us/azure/developer/azure-developer-cli/)
- [Template Gallery](https://azure.github.io/awesome-azd/)
- [GitHub Repository](https://github.com/Azure/azure-dev)
