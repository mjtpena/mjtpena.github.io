---
title: "HashiCorp Vault on Azure: Enterprise Secrets Management"
author: Michael John Peña
draft: false
date: 2022-02-18
url: /blog/hashicorp-vault-azure/
tags:
  - azure
  - hashicorp
  - vault
  - secrets

---

I wrote "HashiCorp Vault on Azure: Enterprise Secrets Management" to share practical, production-minded guidance on this topic.

## Why HashiCorp Vault?

Vault offers:
- Dynamic secrets (generated on-demand)
- Secret engines for various backends
- Advanced policies
- Multi-cloud support
- Encryption as a service

## Deploying Vault on AKS

```yaml
# helm values for Vault
server:
  ha:
    enabled: true
    replicas: 3
    raft:
      enabled: true
      setNodeId: true
      config: |
        ui = true

        listener "tcp" {
          tls_disable = 0
          address = "[::]:8200"
          cluster_address = "[::]:8201"
          tls_cert_file = "/vault/userconfig/tls/tls.crt"
          tls_key_file = "/vault/userconfig/tls/tls.key"
        }

        storage "raft" {
          path = "/vault/data"
          retry_join {
            leader_api_addr = "https://vault-0.vault-internal:8200"
          }
          retry_join {
            leader_api_addr = "https://vault-1.vault-internal:8200"
          }
          retry_join {
            leader_api_addr = "https://vault-2.vault-internal:8200"
          }
        }

        seal "azurekeyvault" {
          tenant_id = "${AZURE_TENANT_ID}"
          vault_name = "${AZURE_KEY_VAULT_NAME}"
          key_name = "vault-unseal-key"
        }

        service_registration "kubernetes" {}

  extraEnvironmentVars:
    AZURE_TENANT_ID: "${TENANT_ID}"
    AZURE_CLIENT_ID: "${CLIENT_ID}"

  extraVolumes:
    - type: secret
      name: tls-certs
      path: /vault/userconfig/tls

ui:
  enabled: true
  serviceType: LoadBalancer
```

```bash
# Deploy Vault
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install vault hashicorp/vault -f values.yaml -n vault --create-namespace

# Initialize Vault
kubectl exec -n vault vault-0 -- vault operator init -format=json > init-keys.json

# Unseal (auto-unseal with Azure Key Vault)
```

## Azure Auth Method

```bash
# Enable Azure auth
vault auth enable azure

# Configure Azure auth
vault write auth/azure/config \
  tenant_id="${TENANT_ID}" \
  resource="https://management.azure.com/" \
  client_id="${CLIENT_ID}" \
  client_secret="${CLIENT_SECRET}"

# Create role for Azure VMs
vault write auth/azure/role/webapp \
  policies="webapp-policy" \
  bound_subscription_ids="${SUBSCRIPTION_ID}" \
  bound_resource_groups="rg-production" \
  bound_scale_sets="vmss-webapp"

# Create role for managed identity
vault write auth/azure/role/function-app \
  policies="function-policy" \
  bound_subscription_ids="${SUBSCRIPTION_ID}" \
  bound_service_principal_ids="${FUNCTION_MSI_OBJECT_ID}"
```

## Dynamic Azure Secrets

```bash
# Enable Azure secrets engine
vault secrets enable azure

# Configure Azure secrets
vault write azure/config \
  subscription_id="${SUBSCRIPTION_ID}" \
  tenant_id="${TENANT_ID}" \
  client_id="${CLIENT_ID}" \
  client_secret="${CLIENT_SECRET}"

# Create role for dynamic credentials
vault write azure/roles/contributor \
  ttl=1h \
  max_ttl=24h \
  azure_roles=-<<EOF
[
  {
    "role_name": "Contributor",
    "scope": "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-app"
  }
]
EOF

# Generate dynamic credentials
vault read azure/creds/contributor
```

## Database Dynamic Secrets

```bash
# Enable database secrets engine
vault secrets enable database

# Configure Azure SQL
vault write database/config/azure-sql \
  plugin_name=mssql-database-plugin \
  connection_url="sqlserver://{{username}}:{{password}}@sql.database.windows.net:1433?database=mydb" \
  allowed_roles="app-role" \
  username="vault-admin" \
  password="${SQL_ADMIN_PASSWORD}"

# Create role for dynamic credentials
vault write database/roles/app-role \
  db_name=azure-sql \
  creation_statements="CREATE LOGIN [{{name}}] WITH PASSWORD = '{{password}}'; \
    CREATE USER [{{name}}] FOR LOGIN [{{name}}]; \
    ALTER ROLE db_datareader ADD MEMBER [{{name}}]; \
    ALTER ROLE db_datawriter ADD MEMBER [{{name}}];" \
  revocation_statements="DROP USER IF EXISTS [{{name}}]; DROP LOGIN IF EXISTS [{{name}}];" \
  default_ttl="1h" \
  max_ttl="24h"
```

## Application Integration

```csharp
using VaultSharp;
using VaultSharp.V1.AuthMethods.Azure;

public class VaultSecretService
{
    private readonly IVaultClient _vaultClient;

    public VaultSecretService(string vaultAddress)
    {
        // Authenticate using Azure managed identity
        var authMethod = new AzureAuthMethodInfo(
            roleName: "webapp",
            jwt: GetManagedIdentityToken());

        var vaultClientSettings = new VaultClientSettings(
            vaultAddress,
            authMethod);

        _vaultClient = new VaultClient(vaultClientSettings);
    }

    public async Task<Dictionary<string, object>> GetSecretsAsync(string path)
    {
        var secret = await _vaultClient.V1.Secrets.KeyValue.V2
            .ReadSecretAsync(path);

        return secret.Data.Data;
    }

    public async Task<DatabaseCredentials> GetDatabaseCredentialsAsync()
    {
        var secret = await _vaultClient.V1.Secrets.Database
            .GetCredentialsAsync("app-role");

        return new DatabaseCredentials
        {
            Username = secret.Data.Username,
            Password = secret.Data.Password,
            LeaseDuration = secret.LeaseDurationSeconds
        };
    }

    private string GetManagedIdentityToken()
    {
        var credential = new DefaultAzureCredential();
        var token = credential.GetToken(
            new TokenRequestContext(new[] { "https://management.azure.com/.default" }));
        return token.Token;
    }
}
```

## Policies

```hcl
# webapp-policy.hcl
path "secret/data/webapp/*" {
  capabilities = ["read"]
}

path "database/creds/app-role" {
  capabilities = ["read"]
}

path "azure/creds/contributor" {
  capabilities = ["read"]
}

# Deny access to sensitive paths
path "secret/data/admin/*" {
  capabilities = ["deny"]
}
```

## Monitoring

```bash
# Enable audit logging
vault audit enable file file_path=/vault/logs/audit.log

# Send to Azure Log Analytics
# Configure fluentd/fluent-bit to ship logs
```

HashiCorp Vault provides enterprise-grade secrets management with dynamic credentials and multi-cloud support.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
