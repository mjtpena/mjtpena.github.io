---
title: "Azure Key Vault: Secrets Management Best Practices"
author: Michael John Peña
draft: false
date: 2020-09-13
tags:
  - Azure
  - Key Vault
  - Security
  - DevOps

---

I wrote "Azure Key Vault: Secrets Management Best Practices" to share practical, production-minded guidance on this topic.

## Basic Operations

```python
from azure.keyvault.secrets import SecretClient
from azure.identity import DefaultAzureCredential

vault_url = "https://myvault.vault.azure.net/"
credential = DefaultAzureCredential()
client = SecretClient(vault_url=vault_url, credential=credential)

# Set a secret
client.set_secret("database-password", "super-secret-value")

# Get a secret
secret = client.get_secret("database-password")
print(secret.value)

# List secrets
for secret_props in client.list_properties_of_secrets():
    print(secret_props.name)
```

## Access Patterns

### 1. Application Code

```python
# Using managed identity (recommended)
from azure.identity import ManagedIdentityCredential

credential = ManagedIdentityCredential()
client = SecretClient(vault_url=vault_url, credential=credential)
```

### 2. Azure Functions

```json
// local.settings.json (development)
{
  "Values": {
    "ConnectionString": "@Microsoft.KeyVault(SecretUri=https://myvault.vault.azure.net/secrets/connstring)"
  }
}
```

### 3. Kubernetes

```yaml
# Using CSI driver
apiVersion: v1
kind: Pod
spec:
  volumes:
    - name: secrets-store
      csi:
        driver: secrets-store.csi.k8s.io
        readOnly: true
        volumeAttributes:
          secretProviderClass: "azure-kvname"
```

## Best Practices

1. **Use managed identities** instead of service principals
2. **Separate vaults** for different environments
3. **Enable soft-delete** for recovery
4. **Enable purge protection** for critical secrets
5. **Audit access** with diagnostic settings

```bash
# Enable diagnostics
az monitor diagnostic-settings create \
    --name kv-diagnostics \
    --resource /subscriptions/.../Microsoft.KeyVault/vaults/myvault \
    --logs '[{"category":"AuditEvent","enabled":true}]' \
    --storage-account mystorageaccount
```

Secrets don't belong in code. Period.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
