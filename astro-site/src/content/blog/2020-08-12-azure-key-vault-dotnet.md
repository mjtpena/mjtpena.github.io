---
title: "Secure Secret Management with Azure Key Vault in .NET"
description: "A confession to start: I've shipped connection strings in appsettings.json more times than I'm proud of. The reasons are always the same — \"it's only dev\"…"
author: Michael John Peña
draft: false
date: 2020-08-12
tags:
  - Azure
  - Security
  - Key Vault
  - .NET Core
---

A confession to start: I've shipped connection strings in `appsettings.json` more times than I'm proud of. The reasons are always the same — "it's only dev", "we'll fix it before prod", "the repo is private." None of those reasons survive the first time a secret leaks. Key Vault is the cure, and once it's wired into your app correctly with managed identity, you stop touching secrets in code entirely. Here's the integration that I now reach for as the default.

## Creating a Key Vault

```bash
# Create a Key Vault
az keyvault create \
    --name kv-myapp-2020 \
    --resource-group rg-security \
    --location australiaeast \
    --enable-soft-delete true \
    --enable-purge-protection true

# Add a secret
az keyvault secret set \
    --vault-name kv-myapp-2020 \
    --name "DatabaseConnectionString" \
    --value "Server=tcp:myserver.database.windows.net..."

# Add another secret
az keyvault secret set \
    --vault-name kv-myapp-2020 \
    --name "ApiKey" \
    --value "your-api-key-here"
```

## Managed Identity Setup

Use managed identity for secure, credential-free access:

```bash
# Enable managed identity on App Service
az webapp identity assign \
    --name mywebapp \
    --resource-group rg-app

# Get the principal ID
principalId=$(az webapp identity show \
    --name mywebapp \
    --resource-group rg-app \
    --query principalId -o tsv)

# Grant access to Key Vault
az keyvault set-policy \
    --name kv-myapp-2020 \
    --object-id $principalId \
    --secret-permissions get list
```

## .NET Core Configuration Integration

Add the NuGet packages:

```bash
dotnet add package Azure.Extensions.AspNetCore.Configuration.Secrets
dotnet add package Azure.Identity
```

Configure in `Program.cs`:

```csharp
public class Program
{
    public static void Main(string[] args)
    {
        CreateHostBuilder(args).Build().Run();
    }

    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            .ConfigureAppConfiguration((context, config) =>
            {
                var builtConfig = config.Build();

                var keyVaultEndpoint = new Uri($"https://{builtConfig["KeyVaultName"]}.vault.azure.net/");

                config.AddAzureKeyVault(keyVaultEndpoint, new DefaultAzureCredential());
            })
            .ConfigureWebHostDefaults(webBuilder =>
            {
                webBuilder.UseStartup<Startup>();
            });
}
```

In `appsettings.json`:

```json
{
  "KeyVaultName": "kv-myapp-2020"
}
```

## Accessing Secrets

Secrets are available through standard configuration:

```csharp
public class MyService
{
    private readonly string _connectionString;
    private readonly string _apiKey;

    public MyService(IConfiguration configuration)
    {
        // Key Vault secret names use -- instead of : for hierarchy
        _connectionString = configuration["DatabaseConnectionString"];
        _apiKey = configuration["ApiKey"];
    }
}
```

## Direct Key Vault Client Usage

For more control, use the SDK directly:

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

public class KeyVaultService
{
    private readonly SecretClient _client;

    public KeyVaultService(string keyVaultName)
    {
        var keyVaultUri = new Uri($"https://{keyVaultName}.vault.azure.net/");
        _client = new SecretClient(keyVaultUri, new DefaultAzureCredential());
    }

    public async Task<string> GetSecretAsync(string secretName)
    {
        var secret = await _client.GetSecretAsync(secretName);
        return secret.Value.Value;
    }

    public async Task SetSecretAsync(string secretName, string value)
    {
        await _client.SetSecretAsync(secretName, value);
    }

    public async Task<List<string>> ListSecretsAsync()
    {
        var secrets = new List<string>();

        await foreach (var secret in _client.GetPropertiesOfSecretsAsync())
        {
            secrets.Add(secret.Name);
        }

        return secrets;
    }
}
```

## Working with Certificates

```csharp
using Azure.Security.KeyVault.Certificates;

public class CertificateService
{
    private readonly CertificateClient _client;

    public CertificateService(string keyVaultName)
    {
        var keyVaultUri = new Uri($"https://{keyVaultName}.vault.azure.net/");
        _client = new CertificateClient(keyVaultUri, new DefaultAzureCredential());
    }

    public async Task<X509Certificate2> GetCertificateAsync(string certificateName)
    {
        var certificate = await _client.GetCertificateAsync(certificateName);
        return new X509Certificate2(certificate.Value.Cer);
    }
}
```

## Caching Secrets

For performance, implement caching:

```csharp
public class CachedKeyVaultService
{
    private readonly SecretClient _client;
    private readonly IMemoryCache _cache;
    private readonly TimeSpan _cacheExpiration = TimeSpan.FromMinutes(5);

    public CachedKeyVaultService(SecretClient client, IMemoryCache cache)
    {
        _client = client;
        _cache = cache;
    }

    public async Task<string> GetSecretAsync(string secretName)
    {
        return await _cache.GetOrCreateAsync($"kv-{secretName}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = _cacheExpiration;
            var secret = await _client.GetSecretAsync(secretName);
            return secret.Value.Value;
        });
    }
}
```

## Local Development

For local development, use Azure CLI authentication:

```bash
# Login to Azure
az login

# Set your subscription
az account set --subscription "your-subscription"
```

The `DefaultAzureCredential` will automatically use your Azure CLI credentials locally.

## Secret Rotation

Implement secret rotation handling:

```csharp
public class RotatingSecretService
{
    private readonly SecretClient _client;
    private string _currentSecret;
    private DateTimeOffset _lastRefresh;
    private readonly TimeSpan _refreshInterval = TimeSpan.FromHours(1);

    public async Task<string> GetSecretAsync(string secretName)
    {
        if (_currentSecret == null ||
            DateTimeOffset.UtcNow - _lastRefresh > _refreshInterval)
        {
            var secret = await _client.GetSecretAsync(secretName);
            _currentSecret = secret.Value.Value;
            _lastRefresh = DateTimeOffset.UtcNow;
        }

        return _currentSecret;
    }
}
```

## Lessons learned the painful way

- **Soft-delete and purge protection should be on for any vault you care about.** Without them, a misconfigured Terraform run can wipe a vault, and "restore from backup" is not a thing for Key Vault data.
- **Use Managed Identity wherever possible.** The whole point of Key Vault is to not have credentials in your app — and then plenty of tutorials hand you a client secret to authenticate to Key Vault, which puts you back where you started.
- **RBAC roles are now preferred over access policies.** New vaults default to RBAC; existing vaults can be migrated. RBAC integrates with Privileged Identity Management, which you'll want once auditors get involved.
- **Don't read every secret on every request.** Cache (and refresh on a schedule), or use the Configuration Builder so secrets are loaded at startup.

Key Vault is not interesting technology. It's invisible-when-it-works infrastructure, like good plumbing. Set it up once, with managed identity, RBAC, soft-delete, and purge protection, and never think about it again.
