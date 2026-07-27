---
title: "Azure Storage Account Security Best Practices"
author: Michael John Peña
draft: false
date: 2020-12-30
tags:
  - Azure
  - Storage
  - Security
  - Best Practices
---

Storage accounts are deceptively easy to deploy and easy to misconfigure into a leak. Public blob containers are still the most common "how did this get exposed?" finding I see. The hardening checklist isn't long—disable public network access, force HTTPS, scope SAS tokens narrowly, prefer managed identities over keys, encrypt with customer-managed keys when compliance demands, and turn on diagnostic logs. None of it is exotic. All of it gets skipped under deadline pressure, and that's exactly when it matters most.

## Network Security

### Private Endpoints

```bash
# Create private endpoint
az network private-endpoint create \
    --name storage-endpoint \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet private-endpoints \
    --private-connection-resource-id $(az storage account show -n mystorageaccount -g myRG --query id -o tsv) \
    --group-id blob \
    --connection-name storage-connection
```

### Service Endpoints

```bash
# Enable service endpoint
az network vnet subnet update \
    --resource-group myRG \
    --vnet-name myVNet \
    --name default \
    --service-endpoints Microsoft.Storage

# Restrict storage to subnet
az storage account network-rule add \
    --account-name mystorageaccount \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet default
```

### Firewall Rules

```bash
# Deny all by default
az storage account update \
    --name mystorageaccount \
    --resource-group myRG \
    --default-action Deny

# Allow specific IPs
az storage account network-rule add \
    --account-name mystorageaccount \
    --resource-group myRG \
    --ip-address 203.0.113.0/24
```

## Encryption

### Customer-Managed Keys

```bash
# Create key in Key Vault
az keyvault key create \
    --vault-name mykeyvault \
    --name storage-key \
    --kty RSA \
    --size 2048

# Configure storage with CMK
az storage account update \
    --name mystorageaccount \
    --resource-group myRG \
    --encryption-key-vault https://mykeyvault.vault.azure.net \
    --encryption-key-name storage-key \
    --encryption-key-source Microsoft.Keyvault
```

### Infrastructure Encryption

```bash
# Double encryption
az storage account create \
    --name mystorageaccount \
    --resource-group myRG \
    --require-infrastructure-encryption true
```

## Access Control

### Azure AD Authentication

```csharp
// Use managed identity
var credential = new DefaultAzureCredential();
var blobClient = new BlobServiceClient(
    new Uri("https://mystorageaccount.blob.core.windows.net"),
    credential
);
```

### RBAC Roles

```bash
# Assign roles
az role assignment create \
    --assignee user@company.com \
    --role "Storage Blob Data Reader" \
    --scope /subscriptions/.../storageAccounts/mystorageaccount

# Common roles:
# - Storage Blob Data Reader
# - Storage Blob Data Contributor
# - Storage Blob Data Owner
# - Storage Queue Data Contributor
```

### Shared Access Signatures

```csharp
// User delegation SAS (Azure AD backed)
var userDelegationKey = await blobServiceClient.GetUserDelegationKeyAsync(
    DateTimeOffset.UtcNow,
    DateTimeOffset.UtcNow.AddHours(1)
);

var sasBuilder = new BlobSasBuilder
{
    BlobContainerName = "container",
    Resource = "c",
    StartsOn = DateTimeOffset.UtcNow,
    ExpiresOn = DateTimeOffset.UtcNow.AddHours(1)
};
sasBuilder.SetPermissions(BlobContainerSasPermissions.Read);

var sasToken = sasBuilder.ToSasQueryParameters(userDelegationKey, accountName);
```

### Stored Access Policies

```bash
# Create policy on container
az storage container policy create \
    --container-name mycontainer \
    --account-name mystorageaccount \
    --name read-only-policy \
    --permissions r \
    --expiry 2021-12-31
```

## Monitoring

### Diagnostic Logs

```bash
az monitor diagnostic-settings create \
    --name storage-diagnostics \
    --resource /subscriptions/.../storageAccounts/mystorageaccount/blobServices/default \
    --logs '[{
        "category": "StorageRead",
        "enabled": true
    },{
        "category": "StorageWrite",
        "enabled": true
    },{
        "category": "StorageDelete",
        "enabled": true
    }]' \
    --workspace /subscriptions/.../workspaces/security-logs
```

### Alerts

```bash
# Alert on anonymous access
az monitor metrics alert create \
    --name anonymous-access-alert \
    --resource-group myRG \
    --scopes /subscriptions/.../storageAccounts/mystorageaccount \
    --condition "total transactions where Authentication=='Anonymous' > 0" \
    --action /subscriptions/.../actionGroups/security-team
```

## Security Checklist

- [ ] Disable public blob access
- [ ] Require secure transfer (HTTPS)
- [ ] Use private endpoints
- [ ] Enable soft delete
- [ ] Use Azure AD authentication
- [ ] Rotate access keys regularly
- [ ] Enable diagnostic logging
- [ ] Use customer-managed keys
- [ ] Configure firewall rules

Storage security: protect your data at every layer.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
