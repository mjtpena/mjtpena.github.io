---
title: "Zero Trust Security in Azure: Trust Nothing, Verify Everything"
author: Michael John Pena
draft: false
date: 2021-12-14
tags:
  - Security
  - Zero Trust
  - Azure
  - Identity
  - Cloud Security
---

## Zero Trust Principles

1. **Verify Explicitly**: Always authenticate and authorize based on all available data points
2. **Least Privilege Access**: Limit user access with just-in-time and just-enough-access
3. **Assume Breach**: Minimize blast radius and segment access

## Identity-Based Perimeter

Moving from network-based to identity-based security:

```bicep
// Managed Identity for workloads
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2021-09-30-preview' = {
  name: 'app-identity'
  location: resourceGroup().location
}

// Key Vault with RBAC
resource keyVault 'Microsoft.KeyVault/vaults@2021-10-01' = {
  name: 'app-keyvault'
  location: resourceGroup().location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      virtualNetworkRules: [
        {
          id: subnet.id
        }
      ]
    }
  }
}

// Grant identity access to secrets
resource secretsOfficer 'Microsoft.Authorization/roleAssignments@2021-04-01-preview' = {
  scope: keyVault
  name: guid(keyVault.id, managedIdentity.id, 'secrets-officer')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets Officer
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Conditional Access Policies

```powershell
# Create Conditional Access Policy via Microsoft Graph
$policy = @{
    displayName = "Require MFA for Azure Management"
    state = "enabled"
    conditions = @{
        users = @{
            includeUsers = @("All")
            excludeUsers = @()
            includeGroups = @()
            excludeGroups = @("$breakGlassGroupId")
        }
        applications = @{
            includeApplications = @("797f4846-ba00-4fd7-ba43-dac1f8f63013") # Azure Management
        }
        locations = @{
            includeLocations = @("All")
            excludeLocations = @("$trustedLocationId")
        }
        clientAppTypes = @("all")
        signInRiskLevels = @()
        userRiskLevels = @()
    }
    grantControls = @{
        operator = "AND"
        builtInControls = @("mfa", "compliantDevice")
    }
    sessionControls = @{
        signInFrequency = @{
            value = 4
            type = "hours"
            isEnabled = $true
        }
    }
}

Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" -Body $policy
```

## Network Micro-Segmentation

```bicep
// Private Endpoints for all PaaS services
resource storagePrivateEndpoint 'Microsoft.Network/privateEndpoints@2021-05-01' = {
  name: 'storage-pe'
  location: resourceGroup().location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'storage-pls'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: ['blob']
        }
      }
    ]
  }
}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.core.windows.net'
  location: 'global'
}

resource privateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: 'vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

// Network Security Group with deny-all default
resource nsg 'Microsoft.Network/networkSecurityGroups@2021-05-01' = {
  name: 'app-nsg'
  location: resourceGroup().location
  properties: {
    securityRules: [
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
        }
      }
      {
        name: 'AllowAppGatewayInbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'GatewayManager'
          destinationAddressPrefix: '*'
          sourcePortRange: '*'
          destinationPortRange: '443'
        }
      }
    ]
  }
}
```

## Workload Identity Federation

```csharp
// Using workload identity in Kubernetes
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

public class SecretService
{
    private readonly SecretClient _secretClient;

    public SecretService()
    {
        // Uses workload identity when running in AKS
        var credential = new DefaultAzureCredential(new DefaultAzureCredentialOptions
        {
            // Exclude unnecessary credential types for faster auth
            ExcludeEnvironmentCredential = true,
            ExcludeSharedTokenCacheCredential = true,
            ExcludeVisualStudioCredential = true,
            ExcludeVisualStudioCodeCredential = true,
            ExcludeAzureCliCredential = true,
            ExcludeInteractiveBrowserCredential = true,
            // Keep these for local dev and AKS
            ManagedIdentityClientId = Environment.GetEnvironmentVariable("AZURE_CLIENT_ID")
        });

        var vaultUri = new Uri(Environment.GetEnvironmentVariable("KEY_VAULT_URI"));
        _secretClient = new SecretClient(vaultUri, credential);
    }

    public async Task<string> GetSecretAsync(string secretName)
    {
        var secret = await _secretClient.GetSecretAsync(secretName);
        return secret.Value.Value;
    }
}
```

```yaml
# AKS workload identity configuration
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-identity
  namespace: production
  annotations:
    azure.workload.identity/client-id: "<managed-identity-client-id>"
```
