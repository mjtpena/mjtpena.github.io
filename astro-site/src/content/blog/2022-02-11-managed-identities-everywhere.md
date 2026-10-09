---
title: "Managed Identities Everywhere: Eliminating Secrets in Azure"
description: "Managed identities are the foundation of a zero-secrets architecture in Azure."
author: Michael John Peña
draft: false
date: 2022-02-11
url: /blog/managed-identities-everywhere/
tags:
  - Azure
  - Security
  - managed-identity
  - Authentication
---

## Types of Managed Identities

- **System-assigned**: Tied to a resource's lifecycle
- **User-assigned**: Independent, can be shared

## Enabling Managed Identity

```bicep
// System-assigned identity
resource appService 'Microsoft.Web/sites@2021-03-01' = {
  name: 'myapp'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // ...
  }
}

// User-assigned identity
resource userIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2021-09-30-preview' = {
  name: 'shared-app-identity'
  location: location
}

resource functionApp 'Microsoft.Web/sites@2021-03-01' = {
  name: 'myfunc'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userIdentity.id}': {}
    }
  }
}
```

## Granting Permissions

```bicep
// Grant Key Vault access
resource keyVaultAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2021-11-01-preview' = {
  parent: keyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: appService.identity.principalId
        permissions: {
          secrets: ['get', 'list']
        }
      }
    ]
  }
}

// Grant Storage access with RBAC
resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2020-10-01-preview' = {
  scope: storageAccount
  name: guid(storageAccount.id, appService.id, 'Storage Blob Data Reader')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Using Managed Identity in Code

### .NET

```csharp
using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Security.KeyVault.Secrets;

public class SecureService
{
    private readonly BlobServiceClient _blobClient;
    private readonly SecretClient _secretClient;

    public SecureService()
    {
        // DefaultAzureCredential automatically uses managed identity in Azure
        var credential = new DefaultAzureCredential();

        _blobClient = new BlobServiceClient(
            new Uri("https://mystorage.blob.core.windows.net"),
            credential);

        _secretClient = new SecretClient(
            new Uri("https://mykeyvault.vault.azure.net"),
            credential);
    }

    public async Task<string> GetSecretAsync(string secretName)
    {
        var secret = await _secretClient.GetSecretAsync(secretName);
        return secret.Value.Value;
    }

    public async Task UploadBlobAsync(string container, string blobName, Stream content)
    {
        var containerClient = _blobClient.GetBlobContainerClient(container);
        await containerClient.UploadBlobAsync(blobName, content);
    }
}
```

### Python

```python
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient
from azure.keyvault.secrets import SecretClient

class SecureService:
    def __init__(self):
        # Automatically uses managed identity in Azure
        self.credential = DefaultAzureCredential()

        self.blob_client = BlobServiceClient(
            account_url="https://mystorage.blob.core.windows.net",
            credential=self.credential
        )

        self.secret_client = SecretClient(
            vault_url="https://mykeyvault.vault.azure.net",
            credential=self.credential
        )

    def get_secret(self, secret_name: str) -> str:
        secret = self.secret_client.get_secret(secret_name)
        return secret.value

    def upload_blob(self, container: str, blob_name: str, data: bytes):
        container_client = self.blob_client.get_container_client(container)
        container_client.upload_blob(blob_name, data)
```

## SQL Database with Managed Identity

```csharp
// Connection string without password
var connectionString = "Server=myserver.database.windows.net;Database=mydb;";

// Use Azure AD authentication
using var connection = new SqlConnection(connectionString);
connection.AccessToken = await GetAccessToken();
await connection.OpenAsync();

private async Task<string> GetAccessToken()
{
    var credential = new DefaultAzureCredential();
    var token = await credential.GetTokenAsync(
        new TokenRequestContext(new[] { "https://database.windows.net/.default" }));
    return token.Token;
}
```

SQL Server configuration:

```sql
-- In Azure SQL Database
CREATE USER [myapp-identity] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [myapp-identity];
ALTER ROLE db_datawriter ADD MEMBER [myapp-identity];
```

## Azure Functions Configuration

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage__accountName": "mystorage",
    "KeyVaultUri": "https://mykeyvault.vault.azure.net",
    "ServiceBusConnection__fullyQualifiedNamespace": "myservicebus.servicebus.windows.net"
  }
}
```

```csharp
// Function using managed identity bindings
[FunctionName("ProcessMessage")]
public async Task Run(
    [ServiceBusTrigger("myqueue", Connection = "ServiceBusConnection")] string message,
    ILogger log)
{
    // ServiceBus binding uses managed identity automatically
    log.LogInformation($"Processing: {message}");
}
```

## Best Practices

1. **Prefer system-assigned** - Automatic lifecycle management
2. **Use user-assigned for sharing** - When multiple resources need same identity
3. **Apply least privilege** - Only grant necessary permissions
4. **Use RBAC over access policies** - More granular control
5. **Test locally with DefaultAzureCredential** - Works with Azure CLI auth

Managed identities are the foundation of a zero-secrets architecture in Azure.
