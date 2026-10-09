---
title: Advanced Azure Key Vault Patterns
description: "\"Put it in Key Vault\" is the easy advice. The advanced game is rotation, lifecycle, and access patterns that don't break under pressure. Managed identity…"
author: Michael John Pena
draft: false
date: 2021-01-25
url: /blog/azure-key-vault-advanced-patterns/
tags:
  - Azure
  - Key Vault
  - Security
  - Secrets Management
  - Encryption
---

"Put it in Key Vault" is the easy advice. The advanced game is rotation, lifecycle, and access patterns that don't break under pressure. Managed identity references over connection strings, soft-delete and purge protection so a misclick isn't catastrophic, RBAC permissions instead of access policies (yes, RBAC for Key Vault is the right default now), and an automated rotation pipeline for the secrets that matter—database passwords, signing keys, third-party API tokens. Today's post is the patterns I wish someone had handed me three years ago.

## Key Vault Architecture Decisions

### Vault per Environment vs Shared Vault

```hcl
# Terraform: Separate vaults per environment
locals {
  environments = ["dev", "staging", "prod"]
}

resource "azurerm_key_vault" "env_vault" {
  for_each = toset(local.environments)

  name                = "kv-${var.project}-${each.key}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  purge_protection_enabled   = each.key == "prod" ? true : false
  soft_delete_retention_days = each.key == "prod" ? 90 : 7

  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    ip_rules                   = var.allowed_ip_ranges[each.key]
    virtual_network_subnet_ids = var.allowed_subnet_ids[each.key]
  }

  tags = {
    Environment = each.key
  }
}
```

## Access Policies vs RBAC

Azure Key Vault supports both access policies and Azure RBAC. Here is when to use each:

### Access Policies (Classic)

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using Azure.ResourceManager;
using Azure.ResourceManager.KeyVault;

public class KeyVaultPolicyManager
{
    private readonly ArmClient _armClient;

    public KeyVaultPolicyManager()
    {
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task GrantSecretAccessAsync(
        string vaultName,
        string resourceGroup,
        string objectId,
        string[] permissions)
    {
        var subscription = await _armClient.GetDefaultSubscriptionAsync();
        var vault = await subscription
            .GetResourceGroups()
            .Get(resourceGroup)
            .Value
            .GetKeyVaults()
            .GetAsync(vaultName);

        var vaultData = vault.Value.Data;

        // Add new access policy
        vaultData.Properties.AccessPolicies.Add(new KeyVaultAccessPolicy(
            tenantId: vaultData.Properties.TenantId,
            objectId: objectId,
            permissions: new IdentityAccessPermissions
            {
                Secrets = permissions.Select(p =>
                    Enum.Parse<IdentityAccessSecretPermission>(p, true)).ToList()
            }
        ));

        await vault.Value.UpdateAsync(WaitUntil.Completed, vaultData);
    }
}
```

### Azure RBAC (Recommended)

```bicep
// Bicep: Key Vault with RBAC
resource keyVault 'Microsoft.KeyVault/vaults@2021-06-01-preview' = {
  name: 'kv-${projectName}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true  // Enable RBAC
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

// Role assignment for secrets reader
resource secretsReaderRole 'Microsoft.Authorization/roleAssignments@2020-10-01-preview' = {
  name: guid(keyVault.id, appIdentity.id, 'SecretsReader')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Automatic Secret Rotation

Implement automatic rotation for database credentials:

```python
import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from azure.mgmt.sql import SqlManagementClient
import secrets
import string

def main(mytimer: func.TimerRequest) -> None:
    """
    Azure Function triggered on schedule to rotate SQL credentials.
    """
    vault_url = os.environ["KEY_VAULT_URL"]
    subscription_id = os.environ["SUBSCRIPTION_ID"]

    credential = DefaultAzureCredential()
    secret_client = SecretClient(vault_url=vault_url, credential=credential)
    sql_client = SqlManagementClient(credential, subscription_id)

    # Get current configuration
    config = get_rotation_config(secret_client)

    for db_config in config["databases"]:
        rotate_database_password(
            secret_client,
            sql_client,
            db_config
        )

def generate_secure_password(length=32):
    """Generate a cryptographically secure password."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def rotate_database_password(secret_client, sql_client, db_config):
    """
    Rotate password for an Azure SQL database.
    """
    server_name = db_config["server"]
    resource_group = db_config["resource_group"]
    secret_name = db_config["secret_name"]

    # Generate new password
    new_password = generate_secure_password()

    try:
        # Update password in Azure SQL
        sql_client.servers.update(
            resource_group_name=resource_group,
            server_name=server_name,
            parameters={
                "administratorLoginPassword": new_password
            }
        )

        # Store new password in Key Vault
        secret_client.set_secret(
            secret_name,
            new_password,
            tags={
                "rotated_at": datetime.utcnow().isoformat(),
                "server": server_name
            }
        )

        # Keep previous version for rollback
        # (Key Vault automatically versions secrets)

        logging.info(f"Successfully rotated password for {server_name}")

    except Exception as e:
        logging.error(f"Failed to rotate password for {server_name}: {e}")
        raise

def get_rotation_config(secret_client):
    """Get rotation configuration from Key Vault."""
    config_secret = secret_client.get_secret("rotation-config")
    return json.loads(config_secret.value)
```

## Certificate Management

### Auto-Renewing Certificates

```csharp
using Azure.Security.KeyVault.Certificates;

public class CertificateManager
{
    private readonly CertificateClient _client;

    public CertificateManager(string vaultUrl)
    {
        _client = new CertificateClient(
            new Uri(vaultUrl),
            new DefaultAzureCredential()
        );
    }

    public async Task<KeyVaultCertificateWithPolicy> CreateAutoRenewingCertificateAsync(
        string certificateName,
        string subject,
        int validityInMonths = 12)
    {
        var policy = new CertificatePolicy("Self", subject)
        {
            KeyType = CertificateKeyType.Rsa,
            KeySize = 4096,
            ReuseKey = false,
            ValidityInMonths = validityInMonths,
            ContentType = CertificateContentType.Pkcs12,

            // Auto-renewal settings
            LifetimeActions =
            {
                new LifetimeAction(CertificatePolicyAction.AutoRenew)
                {
                    DaysBeforeExpiry = 30
                },
                new LifetimeAction(CertificatePolicyAction.EmailContacts)
                {
                    DaysBeforeExpiry = 60
                }
            },

            // Key usage
            KeyUsage =
            {
                CertificateKeyUsage.DigitalSignature,
                CertificateKeyUsage.KeyEncipherment
            },

            // Enhanced key usage
            EnhancedKeyUsage =
            {
                "1.3.6.1.5.5.7.3.1", // Server Authentication
                "1.3.6.1.5.5.7.3.2"  // Client Authentication
            }
        };

        var operation = await _client.StartCreateCertificateAsync(
            certificateName,
            policy
        );

        return await operation.WaitForCompletionAsync();
    }

    public async Task<byte[]> ExportCertificateAsync(string certificateName)
    {
        var certificate = await _client.GetCertificateAsync(certificateName);
        var secret = await new SecretClient(
            _client.VaultUri,
            new DefaultAzureCredential()
        ).GetSecretAsync(certificate.Value.SecretId.AbsoluteUri.Split('/').Last());

        return Convert.FromBase64String(secret.Value.Value);
    }
}
```

## Encryption with Customer-Managed Keys

### Cosmos DB with CMK

```bicep
// Customer-managed key for Cosmos DB
resource cosmosKey 'Microsoft.KeyVault/vaults/keys@2021-06-01-preview' = {
  parent: keyVault
  name: 'cosmos-cmk'
  properties: {
    kty: 'RSA'
    keySize: 2048
    keyOps: [
      'wrapKey'
      'unwrapKey'
    ]
  }
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2021-06-15' = {
  name: 'cosmos-${projectName}'
  location: location
  kind: 'GlobalDocumentDB'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    databaseAccountOfferType: 'Standard'
    keyVaultKeyUri: cosmosKey.properties.keyUriWithVersion
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }
}

// Grant Cosmos DB access to the key
resource cosmosKeyAccess 'Microsoft.Authorization/roleAssignments@2020-10-01-preview' = {
  name: guid(keyVault.id, cosmosAccount.id, 'KeyVaultCryptoUser')
  scope: cosmosKey
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12338af0-0e69-4776-bea7-57ae8d297424') // Key Vault Crypto User
    principalId: cosmosAccount.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Application Integration Patterns

### Configuration Provider for .NET

```csharp
// Program.cs
using Azure.Identity;
using Azure.Extensions.AspNetCore.Configuration.Secrets;

var builder = WebApplication.CreateBuilder(args);

// Add Key Vault configuration provider
var keyVaultEndpoint = builder.Configuration["KeyVaultEndpoint"];
if (!string.IsNullOrEmpty(keyVaultEndpoint))
{
    var credential = new DefaultAzureCredential();
    builder.Configuration.AddAzureKeyVault(
        new Uri(keyVaultEndpoint),
        credential,
        new AzureKeyVaultConfigurationOptions
        {
            // Custom secret name to configuration key mapping
            Manager = new CustomSecretManager("MyApp"),
            // Reload secrets every 5 minutes
            ReloadInterval = TimeSpan.FromMinutes(5)
        }
    );
}

// Custom secret manager to filter and transform secrets
public class CustomSecretManager : KeyVaultSecretManager
{
    private readonly string _prefix;

    public CustomSecretManager(string prefix)
    {
        _prefix = $"{prefix}--";
    }

    public override bool Load(SecretProperties secret)
    {
        // Only load secrets with our prefix
        return secret.Name.StartsWith(_prefix);
    }

    public override string GetKey(KeyVaultSecret secret)
    {
        // Transform "MyApp--ConnectionStrings--Database"
        // to "ConnectionStrings:Database"
        return secret.Name
            .Substring(_prefix.Length)
            .Replace("--", ":");
    }
}
```

### Kubernetes Secret Store CSI Driver

```yaml
# SecretProviderClass for Azure Key Vault
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: azure-keyvault-secrets
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    useVMManagedIdentity: "true"
    userAssignedIdentityID: "<managed-identity-client-id>"
    keyvaultName: "kv-myproject"
    objects: |
      array:
        - |
          objectName: database-connection-string
          objectType: secret
        - |
          objectName: api-key
          objectType: secret
        - |
          objectName: tls-certificate
          objectType: secret
    tenantId: "<tenant-id>"

  # Sync as Kubernetes secrets
  secretObjects:
    - data:
        - key: connection-string
          objectName: database-connection-string
        - key: api-key
          objectName: api-key
      secretName: app-secrets
      type: Opaque

---
# Pod using the secrets
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
    - name: app
      image: myapp:latest
      env:
        - name: DATABASE_CONNECTION
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: connection-string
      volumeMounts:
        - name: secrets-store
          mountPath: "/mnt/secrets"
          readOnly: true
  volumes:
    - name: secrets-store
      csi:
        driver: secrets-store.csi.k8s.io
        readOnly: true
        volumeAttributes:
          secretProviderClass: azure-keyvault-secrets
```

## Monitoring and Auditing

```kusto
// Key Vault diagnostic logs query
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where TimeGenerated > ago(24h)
| summarize
    Operations = count(),
    SuccessfulOps = countif(ResultType == "Success"),
    FailedOps = countif(ResultType != "Success")
    by OperationName, CallerIPAddress, identity_claim_upn_s
| order by Operations desc

// Detect unusual access patterns
let threshold = 100;
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where TimeGenerated > ago(1h)
| summarize AccessCount = count() by CallerIPAddress, bin(TimeGenerated, 5m)
| where AccessCount > threshold
| project TimeGenerated, CallerIPAddress, AccessCount
```

## Best Practices

1. **Use Managed Identities**: Avoid storing credentials to access Key Vault
2. **Enable Soft Delete**: Protect against accidental deletion
3. **Enable Purge Protection**: Required for CMK scenarios
4. **Network Isolation**: Use private endpoints in production
5. **Separate by Environment**: Use different vaults for dev/staging/prod
6. **Monitor Access**: Enable diagnostic logging and alerts
7. **Version Secrets**: Leverage automatic versioning for audit trails

Azure Key Vault is essential for secure secrets management in modern cloud architectures. Implementing these advanced patterns ensures your sensitive data remains protected while maintaining operational flexibility.
