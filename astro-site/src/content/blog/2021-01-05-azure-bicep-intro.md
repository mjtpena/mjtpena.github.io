---
title: "Azure Bicep: Infrastructure as Code Simplified"
description: "ARM templates and I have a long, unhealthy relationship. Hundreds of lines of JSON to express what reads like fifteen lines of intent. Bicep is the cure…"
author: Michael John Peña
draft: false
date: 2021-01-05
tags:
  - Azure
  - Bicep
  - IaC
  - ARM
---

ARM templates and I have a long, unhealthy relationship. Hundreds of lines of JSON to express what reads like fifteen lines of intent. Bicep is the cure I've been waiting for. Same deployment engine, same resource providers, but a clean, type-checked DSL that compiles to ARM. Modules, loops, conditions, and references that don't make me cry. If you're starting a greenfield project in 2021, write it in Bicep—you'll thank yourself in six months.

## Why Bicep?

| ARM JSON | Bicep |
|----------|-------|
| Verbose | Concise |
| Complex syntax | Natural syntax |
| Hard to read | Easy to read |
| Reference functions | Simple references |

## Basic Syntax

```bicep
// main.bicep
param location string = resourceGroup().location
param storageAccountName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-02-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
  }
}

output storageAccountId string = storageAccount.id
output primaryEndpoint string = storageAccount.properties.primaryEndpoints.blob
```

## Deploy Bicep

```bash
# Deploy directly
az deployment group create \
    --resource-group myRG \
    --template-file main.bicep \
    --parameters storageAccountName=mystorage123

# Compile to ARM (optional)
az bicep build --file main.bicep
```

## Variables and Expressions

```bicep
var baseName = 'myapp'
var uniqueSuffix = uniqueString(resourceGroup().id)
var storageAccountName = '${baseName}${uniqueSuffix}'

// String interpolation
var connectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value}'
```

## Parameters with Decorators

```bicep
@description('The environment name')
@allowed([
  'dev'
  'test'
  'prod'
])
param environment string

@minLength(3)
@maxLength(24)
param storageAccountName string

@secure()
param adminPassword string

@minValue(1)
@maxValue(10)
param instanceCount int = 2
```

## Conditional Deployment

```bicep
param deployStorage bool = true

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-02-01' = if (deployStorage) {
  name: storageAccountName
  location: location
  // ...
}
```

## Loops

```bicep
param storageAccounts array = [
  'storage1'
  'storage2'
  'storage3'
]

resource accounts 'Microsoft.Storage/storageAccounts@2021-02-01' = [for name in storageAccounts: {
  name: name
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
}]

// Loop with index
resource indexedAccounts 'Microsoft.Storage/storageAccounts@2021-02-01' = [for (name, i) in storageAccounts: {
  name: '${name}${i}'
  // ...
}]
```

## Modules

```bicep
// modules/storage.bicep
param name string
param location string

resource storage 'Microsoft.Storage/storageAccounts@2021-02-01' = {
  name: name
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
}

output id string = storage.id
```

```bicep
// main.bicep
module storageModule 'modules/storage.bicep' = {
  name: 'storageDeployment'
  params: {
    name: 'mystorage'
    location: location
  }
}

output storageId string = storageModule.outputs.id
```

## Existing Resources

```bicep
// Reference existing resource
resource existingVnet 'Microsoft.Network/virtualNetworks@2021-02-01' existing = {
  name: 'my-existing-vnet'
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2021-02-01' = {
  parent: existingVnet
  name: 'new-subnet'
  properties: {
    addressPrefix: '10.0.1.0/24'
  }
}
```

## Complete Example

```bicep
// Deploy web app with SQL
param appName string
param sqlAdminPassword string

resource sqlServer 'Microsoft.Sql/servers@2021-02-01-preview' = {
  name: '${appName}-sql'
  location: location
  properties: {
    administratorLogin: 'sqladmin'
    administratorLoginPassword: sqlAdminPassword
  }
}

resource sqlDb 'Microsoft.Sql/servers/databases@2021-02-01-preview' = {
  parent: sqlServer
  name: '${appName}-db'
  location: location
  sku: {
    name: 'Basic'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2021-01-01' = {
  name: '${appName}-plan'
  location: location
  sku: {
    name: 'S1'
  }
}

resource webApp 'Microsoft.Web/sites@2021-01-01' = {
  name: appName
  location: location
  properties: {
    serverFarmId: appServicePlan.id
  }
}
```

Bicep: ARM templates you can actually read.
