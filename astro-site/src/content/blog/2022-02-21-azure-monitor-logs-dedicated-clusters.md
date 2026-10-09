---
title: "Azure Monitor Logs Dedicated Clusters: Enterprise-Scale Logging"
description: "Dedicated clusters provide enterprise-grade security and scale for Azure Monitor Logs."
author: Michael John Peña
draft: false
date: 2022-02-21
url: /blog/azure-monitor-logs-dedicated-clusters/
tags:
  - Azure
  - Monitoring
  - log-analytics
  - Enterprise
---

## Why Dedicated Clusters?

Dedicated clusters offer:
- Customer-managed keys (CMK) for encryption
- Double encryption at rest
- Cross-resource queries across workspaces
- Private link support
- Commitment tier pricing (500+ GB/day)

## Creating a Dedicated Cluster

```bicep
resource logCluster 'Microsoft.OperationalInsights/clusters@2021-06-01' = {
  name: 'log-cluster-${environment}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'CapacityReservation'
    capacity: 1000  // GB/day commitment
  }
  properties: {
    isDoubleEncryptionEnabled: true
    isAvailabilityZonesEnabled: true
  }
}

// Configure customer-managed key
resource clusterCMK 'Microsoft.OperationalInsights/clusters@2021-06-01' = {
  name: logCluster.name
  properties: {
    keyVaultProperties: {
      keyVaultUri: keyVault.properties.vaultUri
      keyName: encryptionKey.name
      keyVersion: encryptionKey.properties.keyUriWithVersion
    }
  }
  dependsOn: [
    keyVaultAccessPolicy
  ]
}

// Link workspace to cluster
resource workspace 'Microsoft.OperationalInsights/workspaces@2021-12-01-preview' = {
  name: 'law-${environment}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
    features: {
      clusterResourceId: logCluster.id
    }
  }
}
```

## Key Vault Configuration for CMK

```bicep
resource keyVault 'Microsoft.KeyVault/vaults@2021-11-01-preview' = {
  name: 'kv-logging-cmk'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'premium'  // HSM-backed keys
    }
    tenantId: subscription().tenantId
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
  }
}

resource encryptionKey 'Microsoft.KeyVault/vaults/keys@2021-11-01-preview' = {
  parent: keyVault
  name: 'log-encryption-key'
  properties: {
    kty: 'RSA'
    keySize: 2048
    keyOps: [
      'wrapKey'
      'unwrapKey'
    ]
  }
}

resource keyVaultAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2021-11-01-preview' = {
  parent: keyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: logCluster.identity.principalId
        permissions: {
          keys: ['get', 'wrapKey', 'unwrapKey']
        }
      }
    ]
  }
}
```

## Cross-Resource Queries

Query across multiple workspaces linked to the same cluster:

```kusto
// Query across workspaces
union
    workspace('law-production').AzureDiagnostics,
    workspace('law-staging').AzureDiagnostics
| where TimeGenerated > ago(24h)
| where Category == "ApplicationGatewayFirewallLog"
| summarize count() by ResourceId, bin(TimeGenerated, 1h)

// Function to abstract workspace selection
let GetAllLogs = (startTime:datetime, endTime:datetime) {
    let prod = workspace('law-production');
    let staging = workspace('law-staging');
    let dev = workspace('law-development');
    union
        (prod.Heartbeat | where TimeGenerated between(startTime .. endTime)),
        (staging.Heartbeat | where TimeGenerated between(startTime .. endTime)),
        (dev.Heartbeat | where TimeGenerated between(startTime .. endTime))
};
GetAllLogs(ago(1h), now())
| summarize count() by Computer
```

## Private Link Integration

```bicep
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2021-08-01' = {
  name: 'pe-log-cluster'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'log-cluster-connection'
        properties: {
          privateLinkServiceId: logCluster.id
          groupIds: [
            'azuremonitor'
          ]
        }
      }
    ]
  }
}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.monitor.azure.com'
  location: 'global'
}

resource privateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: 'vnet-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnet.id
    }
    registrationEnabled: false
  }
}
```

## Monitoring Cluster Health

```kusto
// Monitor cluster capacity
_LogOperation
| where Category == "Ingestion"
| where Operation == "Ingestion"
| summarize
    IngestedGB = sum(Quantity) / 1024,
    RecordCount = sum(RequestCount)
    by bin(TimeGenerated, 1h)
| extend CapacityUtilization = IngestedGB / 1000 * 100  // For 1000 GB/day commitment

// Check for throttling
_LogOperation
| where Category == "Ingestion"
| where Operation == "Ingestion"
| where StatusCode != 200
| summarize ThrottledRequests = count() by StatusCode, bin(TimeGenerated, 1h)
```

## Terraform Configuration

```hcl
resource "azurerm_log_analytics_cluster" "cluster" {
  name                = "log-cluster-prod"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location

  identity {
    type = "SystemAssigned"
  }

  size_gb = 1000
}

resource "azurerm_log_analytics_cluster_customer_managed_key" "cmk" {
  log_analytics_cluster_id = azurerm_log_analytics_cluster.cluster.id
  key_vault_key_id         = azurerm_key_vault_key.log_encryption.id
}

resource "azurerm_log_analytics_workspace" "workspace" {
  name                = "law-production"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  sku                 = "PerGB2018"
  retention_in_days   = 90
}

resource "azurerm_log_analytics_linked_service" "link" {
  resource_group_name = azurerm_resource_group.rg.name
  workspace_id        = azurerm_log_analytics_workspace.workspace.id
  read_access_id      = azurerm_log_analytics_cluster.cluster.id
}
```

Dedicated clusters provide enterprise-grade security and scale for Azure Monitor Logs.
