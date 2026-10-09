---
title: "Azure Deployment Environments: Self-Service Infrastructure for Developers"
description: "Deployment Environments enables platform engineering teams to provide governed self-service infrastructure to developers. Tomorrow, I will cover Azure…"
author: Michael John Peña
draft: false
date: 2023-05-27
tags:
  - Azure
  - Deployment Environments
  - IaC
  - DevOps
  - Platform Engineering
---

## What is Azure Deployment Environments?

Deployment Environments provides:
- Self-service infrastructure provisioning
- Governed templates defined by platform teams
- Cost tracking per environment
- Automatic cleanup and lifecycle management

```
┌─────────────────────────────────────────────────────┐
│           Azure Deployment Environments              │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │  Platform Team  │───▶│  Environment Definitions│ │
│  │  (Admins)       │    │  - ARM Templates        │ │
│  └─────────────────┘    │  - Bicep Templates      │ │
│                         │  - Terraform (preview)  │ │
│                         └─────────────────────────┘ │
│                                  │                  │
│                                  ▼                  │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │  Developers     │───▶│  Create Environments    │ │
│  │  (Self-service) │    │  - Select template      │ │
│  └─────────────────┘    │  - Provide parameters   │ │
│                         │  - Deploy resources     │ │
│                         └─────────────────────────┘ │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Setting Up Dev Center for Environments

```bash
# Create dev center with environment configuration
az devcenter admin devcenter create \
    --name mydevcenter \
    --resource-group devbox-rg \
    --location eastus \
    --identity-type SystemAssigned

# Assign subscription permissions to dev center identity
DEV_CENTER_ID=$(az devcenter admin devcenter show \
    --name mydevcenter \
    --resource-group devbox-rg \
    --query identity.principalId -o tsv)

az role assignment create \
    --assignee $DEV_CENTER_ID \
    --role "Owner" \
    --scope "/subscriptions/{subscription-id}"
```

## Creating Environment Definitions

### Catalog Setup

```bash
# Add GitHub catalog with environment definitions
az devcenter admin catalog create \
    --name environment-catalog \
    --dev-center-name mydevcenter \
    --resource-group devbox-rg \
    --git-hub \
        uri="https://github.com/myorg/environment-definitions" \
        branch="main" \
        path="/environments"
```

### Bicep Environment Definition

```bicep
// environments/web-app/main.bicep
@description('The name of the web application')
param appName string

@description('The environment (dev, test, prod)')
@allowed(['dev', 'test', 'prod'])
param environment string = 'dev'

@description('The SKU for the App Service Plan')
param sku string = 'B1'

var location = resourceGroup().location
var appServicePlanName = 'asp-${appName}-${environment}'
var webAppName = 'web-${appName}-${environment}'
var appInsightsName = 'ai-${appName}-${environment}'

// App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: sku
  }
  properties: {
    reserved: true // Linux
  }
}

// Web App
resource webApp 'Microsoft.Web/sites@2022-03-01' = {
  name: webAppName
  location: location
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|18-lts'
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~18'
        }
      ]
    }
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
  }
}

output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output appInsightsKey string = appInsights.properties.InstrumentationKey
```

### Environment Manifest

```yaml
# environments/web-app/environment.yaml
name: web-app
version: 1.0.0
summary: Web application with App Service and Application Insights
description: |
  Creates a complete web application environment including:
  - Azure App Service (Linux)
  - Application Insights for monitoring
  - Configured for Node.js 18

templatePath: main.bicep

parameters:
  - id: appName
    name: Application Name
    description: The name of the web application (alphanumeric, 3-24 chars)
    type: string
    required: true

  - id: environment
    name: Environment
    description: The deployment environment
    type: string
    required: true
    default: dev
    allowed:
      - dev
      - test
      - prod

  - id: sku
    name: App Service SKU
    description: The App Service Plan pricing tier
    type: string
    required: false
    default: B1
    allowed:
      - F1
      - B1
      - B2
      - S1
```

### Microservices Environment

```bicep
// environments/microservices/main.bicep
@description('The base name for resources')
param baseName string

@description('Number of API replicas')
param apiReplicas int = 2

var location = resourceGroup().location
var acrName = 'acr${uniqueString(resourceGroup().id)}'
var aksName = 'aks-${baseName}'
var cosmosName = 'cosmos-${baseName}'
var serviceBusName = 'sb-${baseName}'

// Container Registry
resource acr 'Microsoft.ContainerRegistry/registries@2022-12-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    adminUserEnabled: true
  }
}

// AKS Cluster
resource aks 'Microsoft.ContainerService/managedClusters@2023-03-01' = {
  name: aksName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: aksName
    agentPoolProfiles: [
      {
        name: 'system'
        count: 2
        vmSize: 'Standard_DS2_v2'
        mode: 'System'
      }
      {
        name: 'app'
        count: apiReplicas
        vmSize: 'Standard_DS2_v2'
        mode: 'User'
      }
    ]
  }
}

// Cosmos DB
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }
}

// Service Bus
resource serviceBus 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: serviceBusName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
}

output acrLoginServer string = acr.properties.loginServer
output aksClusterName string = aks.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output serviceBusNamespace string = serviceBus.name
```

## Project Configuration

```python
from azure.mgmt.devcenter import DevCenterMgmtClient
from azure.identity import DefaultAzureCredential

client = DevCenterMgmtClient(DefaultAzureCredential(), subscription_id)

# Create project with environment types
project = client.projects.begin_create_or_update(
    resource_group_name="devbox-rg",
    project_name="ecommerce-project",
    body={
        "location": "eastus",
        "properties": {
            "devCenterId": f"/subscriptions/{sub}/resourceGroups/devbox-rg/providers/Microsoft.DevCenter/devcenters/mydevcenter",
            "description": "E-commerce platform development"
        }
    }
).result()

# Create environment types for the project
env_types = ["dev", "test", "staging"]
for env_type in env_types:
    client.project_environment_types.create_or_update(
        resource_group_name="devbox-rg",
        project_name="ecommerce-project",
        environment_type_name=env_type,
        body={
            "properties": {
                "deploymentTargetId": f"/subscriptions/{sub}",
                "status": "Enabled",
                "creatorRoleAssignment": {
                    "roles": {
                        "Contributor": {}
                    }
                }
            },
            "identity": {
                "type": "SystemAssigned"
            }
        }
    )
```

## Developer Self-Service

```python
from azure.developer.devcenter import DevCenterClient

dev_client = DevCenterClient(
    endpoint="https://devcenter-endpoint.azure.com",
    credential=DefaultAzureCredential()
)

# List available environment definitions
definitions = dev_client.environment_definitions.list(
    project_name="ecommerce-project",
    catalog_name="environment-catalog"
)

for definition in definitions:
    print(f"{definition.name}: {definition.description}")

# Create environment
environment = dev_client.environments.begin_create_or_update(
    project_name="ecommerce-project",
    user_id="me",
    environment_name="my-feature-env",
    body={
        "environmentType": "dev",
        "catalogName": "environment-catalog",
        "environmentDefinitionName": "web-app",
        "parameters": {
            "appName": "feature123",
            "environment": "dev",
            "sku": "B1"
        }
    }
).result()

print(f"Environment: {environment.name}")
print(f"Resource Group: {environment.resource_group_id}")
```

## Cost Management

```python
# Set environment limits
client.project_environment_types.update(
    resource_group_name="devbox-rg",
    project_name="ecommerce-project",
    environment_type_name="dev",
    body={
        "properties": {
            "userRoleAssignments": {
                "developer@contoso.com": {
                    "roles": {
                        "Contributor": {}
                    }
                }
            }
        },
        "tags": {
            "costCenter": "engineering",
            "maxCost": "500"
        }
    }
)
```

Deployment Environments enables platform engineering teams to provide governed self-service infrastructure to developers. Tomorrow, I will cover Azure Container Apps updates.

## Resources

- [Deployment Environments Documentation](https://learn.microsoft.com/en-us/azure/deployment-environments/)
- [Environment Definitions](https://learn.microsoft.com/en-us/azure/deployment-environments/configure-environment-definition)
- [Developer Portal](https://learn.microsoft.com/en-us/azure/deployment-environments/quickstart-create-access-environments)
