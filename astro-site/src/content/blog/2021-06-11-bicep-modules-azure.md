---
title: Bicep Modules for Modular Azure Infrastructure
author: Michael John Peña
draft: false
date: 2021-06-11
url: /blog/bicep-modules-azure/
tags:
  - Bicep
  - Azure
  - Infrastructure as Code
  - ARM

---

I wrote "2021-06-11-bicep-modules-azure" to share practical, production-minded guidance on this topic.

## Bicep Basics

### Simple Resource Definition

```bicep
// main.bicep
param environment string
param location string = resourceGroup().location

var namePrefix = 'myapp-${environment}'

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-02-01' = {
  name: 'st${replace(namePrefix, '-', '')}${uniqueString(resourceGroup().id)}'
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    accessTier: 'Hot'
  }
}

output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
```

## Creating Modules

### App Service Module

```bicep
// modules/appService.bicep
@description('Name prefix for resources')
param namePrefix string

@description('Location for resources')
param location string

@description('Environment (dev, staging, prod)')
@allowed([
  'dev'
  'staging'
  'prod'
])
param environment string

@description('Application Insights instrumentation key')
param appInsightsInstrumentationKey string = ''

@description('Additional app settings')
param additionalAppSettings array = []

var isProd = environment == 'prod'
var skuName = isProd ? 'S1' : 'B1'
var skuTier = isProd ? 'Standard' : 'Basic'

resource appServicePlan 'Microsoft.Web/serverfarms@2021-02-01' = {
  name: 'asp-${namePrefix}'
  location: location
  kind: 'linux'
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    reserved: true
  }
}

var baseAppSettings = [
  {
    name: 'ASPNETCORE_ENVIRONMENT'
    value: isProd ? 'Production' : 'Development'
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsightsInstrumentationKey
  }
]

resource webApp 'Microsoft.Web/sites@2021-02-01' = {
  name: 'app-${namePrefix}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|6.0'
      alwaysOn: isProd
      http20Enabled: true
      minTlsVersion: '1.2'
      appSettings: concat(baseAppSettings, additionalAppSettings)
    }
  }
}

// Staging slot for production
resource stagingSlot 'Microsoft.Web/sites/slots@2021-02-01' = if (isProd) {
  parent: webApp
  name: 'staging'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|6.0'
      alwaysOn: true
    }
  }
}

output appServiceName string = webApp.name
output appServiceUrl string = 'https://${webApp.properties.defaultHostName}'
output appServicePrincipalId string = webApp.identity.principalId
output appServicePlanId string = appServicePlan.id
```

### SQL Database Module

```bicep
// modules/sqlDatabase.bicep
@description('Name prefix for resources')
param namePrefix string

@description('Location for resources')
param location string

@description('Environment (dev, staging, prod)')
param environment string

@description('SQL administrator login')
@secure()
param adminLogin string

@description('SQL administrator password')
@secure()
param adminPassword string

@description('Azure AD admin object ID')
param aadAdminObjectId string = ''

@description('Azure AD admin login name')
param aadAdminLogin string = ''

var isProd = environment == 'prod'

resource sqlServer 'Microsoft.Sql/servers@2021-05-01-preview' = {
  name: 'sql-${namePrefix}'
  location: location
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
  }
}

// Azure AD administrator
resource aadAdmin 'Microsoft.Sql/servers/administrators@2021-05-01-preview' = if (!empty(aadAdminObjectId)) {
  parent: sqlServer
  name: 'ActiveDirectory'
  properties: {
    administratorType: 'ActiveDirectory'
    login: aadAdminLogin
    sid: aadAdminObjectId
    tenantId: tenant().tenantId
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2021-05-01-preview' = {
  parent: sqlServer
  name: 'sqldb-${namePrefix}'
  location: location
  sku: {
    name: isProd ? 'S1' : 'Basic'
    tier: isProd ? 'Standard' : 'Basic'
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: isProd ? 53687091200 : 2147483648
    zoneRedundant: isProd
  }
}

// Allow Azure services
resource firewallRule 'Microsoft.Sql/servers/firewallRules@2021-05-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = sqlDatabase.name
output connectionString string = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${sqlDatabase.name};'
```

### Key Vault Module

```bicep
// modules/keyVault.bicep
@description('Name prefix for resources')
param namePrefix string

@description('Location for resources')
param location string

@description('Environment (dev, staging, prod)')
param environment string

@description('Principal IDs to grant secret access')
param secretAccessPrincipalIds array = []

@description('Secrets to create')
param secrets array = []

var isProd = environment == 'prod'

resource keyVault 'Microsoft.KeyVault/vaults@2021-06-01-preview' = {
  name: 'kv-${namePrefix}'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenant().tenantId
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: isProd
    accessPolicies: [for principalId in secretAccessPrincipalIds: {
      tenantId: tenant().tenantId
      objectId: principalId
      permissions: {
        secrets: [
          'get'
          'list'
        ]
      }
    }]
  }
}

// Create secrets
resource keyVaultSecrets 'Microsoft.KeyVault/vaults/secrets@2021-06-01-preview' = [for secret in secrets: {
  parent: keyVault
  name: secret.name
  properties: {
    value: secret.value
  }
}]

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultId string = keyVault.id
```

## Main Deployment Using Modules

```bicep
// main.bicep
targetScope = 'subscription'

@description('Environment name')
@allowed([
  'dev'
  'staging'
  'prod'
])
param environment string

@description('Location for resources')
param location string = 'australiaeast'

@description('SQL admin username')
@secure()
param sqlAdminLogin string

@description('SQL admin password')
@secure()
param sqlAdminPassword string

var namePrefix = 'myapp-${environment}'

// Resource Group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-${namePrefix}'
  location: location
  tags: {
    Environment: environment
    ManagedBy: 'Bicep'
  }
}

// Application Insights
module appInsights 'modules/appInsights.bicep' = {
  name: 'appInsights'
  scope: rg
  params: {
    namePrefix: namePrefix
    location: location
  }
}

// App Service
module appService 'modules/appService.bicep' = {
  name: 'appService'
  scope: rg
  params: {
    namePrefix: namePrefix
    location: location
    environment: environment
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
  }
}

// SQL Database
module sqlDatabase 'modules/sqlDatabase.bicep' = {
  name: 'sqlDatabase'
  scope: rg
  params: {
    namePrefix: namePrefix
    location: location
    environment: environment
    adminLogin: sqlAdminLogin
    adminPassword: sqlAdminPassword
  }
}

// Key Vault
module keyVault 'modules/keyVault.bicep' = {
  name: 'keyVault'
  scope: rg
  params: {
    namePrefix: namePrefix
    location: location
    environment: environment
    secretAccessPrincipalIds: [
      appService.outputs.appServicePrincipalId
    ]
    secrets: [
      {
        name: 'SqlConnectionString'
        value: '${sqlDatabase.outputs.connectionString}Authentication=Active Directory Managed Identity;'
      }
    ]
  }
}

// Outputs
output resourceGroupName string = rg.name
output appServiceUrl string = appService.outputs.appServiceUrl
output keyVaultUri string = keyVault.outputs.keyVaultUri
output sqlServerFqdn string = sqlDatabase.outputs.sqlServerFqdn
```

## Application Insights Module

```bicep
// modules/appInsights.bicep
param namePrefix string
param location string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2021-06-01' = {
  name: 'log-${namePrefix}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${namePrefix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

output instrumentationKey string = appInsights.properties.InstrumentationKey
output connectionString string = appInsights.properties.ConnectionString
output appInsightsId string = appInsights.id
```

## Conditional Deployments

```bicep
// modules/networking.bicep
param namePrefix string
param location string
param deployPrivateEndpoints bool = false

resource vnet 'Microsoft.Network/virtualNetworks@2021-03-01' = {
  name: 'vnet-${namePrefix}'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'snet-app'
        properties: {
          addressPrefix: '10.0.1.0/24'
          delegations: [
            {
              name: 'delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
      {
        name: 'snet-data'
        properties: {
          addressPrefix: '10.0.2.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// Only deploy private DNS zone if private endpoints are enabled
resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (deployPrivateEndpoints) {
  name: 'privatelink.database.windows.net'
  location: 'global'
}

resource privateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (deployPrivateEndpoints) {
  parent: privateDnsZone
  name: '${vnet.name}-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnet.id
    }
    registrationEnabled: false
  }
}

output vnetId string = vnet.id
output appSubnetId string = vnet.properties.subnets[0].id
output dataSubnetId string = vnet.properties.subnets[1].id
```

## Deployment Commands

```bash
# Deploy to subscription scope
az deployment sub create \
  --location australiaeast \
  --template-file main.bicep \
  --parameters environment=dev \
  --parameters sqlAdminLogin=adminuser \
  --parameters sqlAdminPassword='SecureP@ssw0rd!'

# What-if deployment
az deployment sub what-if \
  --location australiaeast \
  --template-file main.bicep \
  --parameters environment=prod

# Deploy with parameter file
az deployment sub create \
  --location australiaeast \
  --template-file main.bicep \
  --parameters @parameters.prod.json
```

### Parameter File

```json
// parameters.prod.json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "environment": {
      "value": "prod"
    },
    "location": {
      "value": "australiaeast"
    },
    "sqlAdminLogin": {
      "reference": {
        "keyVault": {
          "id": "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.KeyVault/vaults/{kv}"
        },
        "secretName": "sqlAdminLogin"
      }
    },
    "sqlAdminPassword": {
      "reference": {
        "keyVault": {
          "id": "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.KeyVault/vaults/{kv}"
        },
        "secretName": "sqlAdminPassword"
      }
    }
  }
}
```

## Conclusion

Bicep modules enable clean, maintainable Azure infrastructure code. By separating concerns into modules, you create reusable components that can be shared across projects. The clear syntax, type checking, and VS Code integration make Bicep an excellent choice for Azure-native infrastructure as code.

## References

- [Bicep Documentation](https://docs.microsoft.com/en-us/azure/azure-resource-manager/bicep/)
- [Bicep Modules](https://docs.microsoft.com/en-us/azure/azure-resource-manager/bicep/modules)

