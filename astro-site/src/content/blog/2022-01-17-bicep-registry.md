---
title: "Bicep Registry: Sharing and Reusing Infrastructure Modules"
author: Michael John Peña
draft: false
date: 2022-01-17
url: /blog/bicep-registry/
tags:
  - azure
  - bicep
  - infrastructure-as-code
  - modules

---

I wrote "Bicep Registry: Sharing and Reusing Infrastructure Modules" to share practical, production-minded guidance on this topic.

## Setting Up a Bicep Registry

Create an Azure Container Registry:

```bicep
// registry.bicep
param location string = resourceGroup().location
param registryName string

resource acr 'Microsoft.ContainerRegistry/registries@2021-12-01-preview' = {
  name: registryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

output registryLoginServer string = acr.properties.loginServer
```

## Publishing Modules

Publish a module to your registry:

```bash
# Login to Azure
az login

# Publish module to registry
az bicep publish \
  --file modules/storage-account.bicep \
  --target br:myregistry.azurecr.io/bicep/storage-account:v1.0.0
```

Create a publishing script for automation:

```bash
#!/bin/bash
# publish-modules.sh

REGISTRY="myregistry.azurecr.io"
MODULES_DIR="./modules"

for module in "$MODULES_DIR"/*.bicep; do
  filename=$(basename "$module" .bicep)
  version=$(cat "$MODULES_DIR/$filename.version" 2>/dev/null || echo "v1.0.0")

  echo "Publishing $filename:$version"

  az bicep publish \
    --file "$module" \
    --target "br:$REGISTRY/bicep/$filename:$version"
done
```

## Consuming Registry Modules

Use modules from your registry:

```bicep
// main.bicep
param environment string
param location string = 'australiaeast'

// Use module from registry
module storageAccount 'br:myregistry.azurecr.io/bicep/storage-account:v1.0.0' = {
  name: 'storage-deployment'
  params: {
    name: 'st${environment}${uniqueString(resourceGroup().id)}'
    location: location
    sku: 'Standard_LRS'
  }
}

module appService 'br:myregistry.azurecr.io/bicep/app-service:v2.1.0' = {
  name: 'app-deployment'
  params: {
    name: 'app-${environment}'
    location: location
    sku: environment == 'prod' ? 'P1v3' : 'B1'
  }
}

output storageEndpoint string = storageAccount.outputs.primaryEndpoint
output appUrl string = appService.outputs.url
```

## Module Aliasing

Configure aliases in bicepconfig.json:

```json
{
  "moduleAliases": {
    "br": {
      "myregistry": {
        "registry": "myregistry.azurecr.io"
      },
      "publicregistry": {
        "registry": "mcr.microsoft.com"
      }
    },
    "ts": {
      "myspecs": {
        "subscription": "00000000-0000-0000-0000-000000000000",
        "resourceGroup": "rg-template-specs"
      }
    }
  }
}
```

Use aliases in your Bicep files:

```bicep
// Using alias
module storage 'br/myregistry:bicep/storage-account:v1.0.0' = {
  name: 'storage'
  params: {
    name: storageName
    location: location
  }
}
```

## Creating Enterprise-Grade Modules

```bicep
// modules/storage-account.bicep
@description('Name of the storage account')
@minLength(3)
@maxLength(24)
param name string

@description('Location for the storage account')
param location string = resourceGroup().location

@description('Storage account SKU')
@allowed([
  'Standard_LRS'
  'Standard_GRS'
  'Standard_RAGRS'
  'Standard_ZRS'
  'Premium_LRS'
])
param sku string = 'Standard_LRS'

@description('Enable blob versioning')
param enableVersioning bool = true

@description('Enable soft delete for blobs')
param enableBlobSoftDelete bool = true

@description('Soft delete retention days')
@minValue(1)
@maxValue(365)
param softDeleteRetentionDays int = 7

@description('Resource tags')
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2021-08-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    isVersioningEnabled: enableVersioning
    deleteRetentionPolicy: {
      enabled: enableBlobSoftDelete
      days: softDeleteRetentionDays
    }
  }
}

@description('The resource ID of the storage account')
output id string = storageAccount.id

@description('The name of the storage account')
output name string = storageAccount.name

@description('The primary blob endpoint')
output primaryEndpoint string = storageAccount.properties.primaryEndpoints.blob

@description('The primary connection string')
output connectionString string = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
```

## CI/CD for Module Publishing

```yaml
# .github/workflows/publish-modules.yml
name: Publish Bicep Modules

on:
  push:
    branches: [main]
    paths:
      - 'modules/**'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Get changed modules
        id: changes
        run: |
          echo "modules=$(git diff --name-only HEAD~1 | grep '^modules/.*\.bicep$' | tr '\n' ' ')" >> $GITHUB_OUTPUT

      - name: Publish changed modules
        run: |
          for module in ${{ steps.changes.outputs.modules }}; do
            name=$(basename "$module" .bicep)
            version="v1.0.${{ github.run_number }}"

            az bicep publish \
              --file "$module" \
              --target "br:${{ secrets.ACR_NAME }}.azurecr.io/bicep/$name:$version" \
              --target "br:${{ secrets.ACR_NAME }}.azurecr.io/bicep/$name:latest"
          done
```

The Bicep Registry is essential for scaling infrastructure as code across enterprise organizations.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
