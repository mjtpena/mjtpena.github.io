---
title: "Secrets Management Patterns: Best Practices for Azure"
author: Michael John Peña
draft: false
date: 2022-02-17
url: /blog/secrets-management-patterns/
tags:
  - azure
  - security
  - secrets
  - patterns

---

I wrote "Secrets Management Patterns: Best Practices for Azure" to share practical, production-minded guidance on this topic.

## Secret Categories

| Category | Example | Recommended Approach |
|----------|---------|---------------------|
| Azure Services | Storage, SQL | Managed Identity |
| External APIs | Third-party APIs | Key Vault |
| Certificates | TLS, Auth | Key Vault or Managed |
| Connection Strings | Legacy systems | Key Vault with rotation |
| Encryption Keys | Data encryption | Key Vault Keys |

## Centralized Secret Management

```bicep
// Central Key Vault setup
resource keyVault 'Microsoft.KeyVault/vaults@2021-11-01-preview' = {
  name: 'kv-${environment}-secrets'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'premium'  // For HSM-backed keys
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      virtualNetworkRules: [
        {
          id: appSubnet.id
        }
      ]
      ipRules: [
        {
          value: allowedIpRange
        }
      ]
    }
  }
}

// RBAC assignments
resource secretsUserRole 'Microsoft.Authorization/roleAssignments@2020-10-01-preview' = {
  scope: keyVault
  name: guid(keyVault.id, appServiceIdentity, 'secrets-user')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')  // Key Vault Secrets User
    principalId: appServiceIdentity
    principalType: 'ServicePrincipal'
  }
}
```

## Application Configuration Pattern

```csharp
// Program.cs - ASP.NET Core
using Azure.Identity;
using Azure.Extensions.AspNetCore.Configuration.Secrets;

var builder = WebApplication.CreateBuilder(args);

// Add Key Vault as configuration source
var keyVaultUri = builder.Configuration["KeyVaultUri"];
if (!string.IsNullOrEmpty(keyVaultUri))
{
    builder.Configuration.AddAzureKeyVault(
        new Uri(keyVaultUri),
        new DefaultAzureCredential(),
        new AzureKeyVaultConfigurationOptions
        {
            ReloadInterval = TimeSpan.FromMinutes(5)
        });
}

// Use configuration
builder.Services.Configure<ApiOptions>(
    builder.Configuration.GetSection("ExternalApi"));
```

```json
// Key Vault secrets map to configuration
// Secret name: ExternalApi--ApiKey
// Configuration path: ExternalApi:ApiKey
{
  "ExternalApi": {
    "ApiKey": "from-key-vault",
    "BaseUrl": "https://api.external.com"
  }
}
```

## Secrets in Kubernetes

```yaml
# secrets-provider-class.yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: azure-keyvault-secrets
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    useVMManagedIdentity: "true"
    userAssignedIdentityID: "$IDENTITY_CLIENT_ID"
    keyvaultName: "kv-prod-secrets"
    objects: |
      array:
        - |
          objectName: database-connection-string
          objectType: secret
        - |
          objectName: api-key
          objectType: secret
    tenantId: "$TENANT_ID"
  secretObjects:
    - secretName: app-secrets
      type: Opaque
      data:
        - objectName: database-connection-string
          key: DB_CONNECTION
        - objectName: api-key
          key: API_KEY\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
