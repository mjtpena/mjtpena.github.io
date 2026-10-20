---
title: "Key Vault in ASP.NET Core 3.1 with Azure.Identity and Managed Identity"
description: "Wiring Azure Key Vault into ASP.NET Core 3.1 config with Azure.Identity 1.2, managed identity and access policies, plus the trade-offs to know before you ship."
author: Michael John Peña
draft: false
date: 2020-08-12
tags:
  - Azure
  - Security
  - Key Vault
  - .NET Core
  - C#
---

A confession to start: I've shipped connection strings in `appsettings.json` more times than I'm proud of. The reasons are always the same: "it's only dev", "we'll fix it before prod", "the repo is private". None of those reasons survive the first time a secret leaks. Azure Key Vault fixes the storage problem, but only if the app reaches the vault without a credential of its own. With managed identity and this month's `Azure.Identity` release, ASP.NET Core 3.1 finally gets one code path that works on a laptop and in App Service with no secrets anywhere.

## Which package, and why it changed

There are two Key Vault configuration providers on NuGet right now, and most tutorials still show the old one. The new one, `Azure.Extensions.AspNetCore.Configuration.Secrets`, went GA in June. Its credential library, `Azure.Identity` 1.2.0, [went GA on 10 August 2020](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/identity/Azure.Identity/CHANGELOG.md), and `DefaultAzureCredential` now officially walks through Azure CLI, Visual Studio and VS Code sign-ins as well as managed identity.

| | Old provider | New provider |
|---|---|---|
| Package | `Microsoft.Extensions.Configuration.AzureKeyVault` | `Azure.Extensions.AspNetCore.Configuration.Secrets` 1.0.0 |
| Underlying SDK | `Microsoft.Azure.KeyVault` (track 1) | `Azure.Security.KeyVault.Secrets` 4.x (track 2) |
| Authentication | `KeyVaultClient` callbacks, `AzureServiceTokenProvider`, or client ID + secret | Any `TokenCredential`, typically `DefaultAzureCredential` |
| Status | Maintained, but not where new work happens | GA, the current recommendation |

My recommendation is the new one for anything you start today. The track-2 libraries share one credential model (`Azure.Identity`), one retry and diagnostics pipeline, and one set of conventions across Storage, Service Bus and Key Vault. The old stack made you learn a different auth story per service. The [new package's README](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/extensions.aspnetcore.configuration.secrets-readme) covers its API.

## Create the vault with recovery turned on

```bash
az keyvault create \
    --name <your-vault-name> \
    --resource-group <your-resource-group> \
    --location australiaeast \
    --enable-soft-delete true \
    --enable-purge-protection true

az keyvault secret set \
    --vault-name <your-vault-name> \
    --name "ConnectionStrings--Default" \
    --value "<your-connection-string>"
```

Two decisions are hiding in that command.

**Soft-delete** keeps a deleted vault or secret recoverable for the retention period, 90 days by default (configurable from 7 to 90 days at creation with `--retention-days`). Microsoft announced at the end of July that soft-delete will be [turned on for all key vaults by the end of 2020](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-change) with no opt-out. Turn it on now so you find out early if any of your automation deletes and recreates vaults with the same name. That pattern breaks once soft-delete is on, because the name stays reserved until the deleted vault is purged.

**Purge protection** stops anyone, including a subscription owner, from permanently deleting the vault or its objects before the retention period ends. It can't be turned off again once enabled. I want it on every production vault. For throwaway dev vaults that a pipeline tears down every night, I leave it off, because otherwise you're waiting out the full retention period before you can reuse the name. If you must have purge protection there, create dev vaults with `--retention-days 7`.

Note the secret name. Key Vault secret names allow only letters, numbers and dashes, so the provider maps `--` to the `:` that .NET configuration uses for hierarchy. `ConnectionStrings--Default` becomes `ConnectionStrings:Default`, which `GetConnectionString("Default")` reads.

## Give the app an identity, not a password

```bash
az webapp identity assign \
    --name <your-app-name> \
    --resource-group <your-resource-group>

principalId=$(az webapp identity show \
    --name <your-app-name> \
    --resource-group <your-resource-group> \
    --query principalId -o tsv)

az keyvault set-policy \
    --name <your-vault-name> \
    --object-id "$principalId" \
    --secret-permissions get list
```

A system-assigned managed identity is a service principal in Azure Active Directory whose lifecycle is tied to the web app. Azure rotates its credentials, and nobody ever sees them. The access policy grants only `get` and `list` on secrets. The configuration provider needs `list` to enumerate secrets at startup. If you only ever call `GetSecretAsync` by name, drop `list`.

Access policies are vault-wide for each object type. A principal with `get` on secrets can read *every* secret in that vault. Access policies are the only GA data-plane permission model today, so the vault itself is the boundary: one vault per application per environment. Sharing a vault across apps means sharing secrets across apps, whatever the naming convention says.

## Wire it into Program.cs

```bash
dotnet add package Azure.Extensions.AspNetCore.Configuration.Secrets --version 1.0.0
dotnet add package Azure.Identity --version 1.2.0
```

```csharp
using System;
using Azure.Identity;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace MyApp
{
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
                    var vaultName = builtConfig["KeyVaultName"];

                    if (!string.IsNullOrEmpty(vaultName))
                    {
                        var vaultUri = new Uri($"https://{vaultName}.vault.azure.net/");
                        config.AddAzureKeyVault(vaultUri, new DefaultAzureCredential());
                    }
                })
                .ConfigureWebHostDefaults(webBuilder =>
                {
                    webBuilder.UseStartup<Startup>();
                });
    }
}
```

```json
{
  "KeyVaultName": "<your-vault-name>"
}
```

Because the provider is added last, Key Vault values override anything with the same key in `appsettings.json` or environment variables. Code that reads configuration doesn't change at all:

```csharp
using Microsoft.Extensions.Configuration;

public class OrdersRepository
{
    private readonly string _connectionString;

    public OrdersRepository(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("Default");
    }
}
```

That is the main reason I prefer the configuration provider over calling `SecretClient` everywhere. The rest of the codebase doesn't know Key Vault exists, and unit tests just pass in an in-memory configuration.

## Local development without a shared secret

On a developer machine there's no managed identity, so `DefaultAzureCredential` moves down its chain: environment variables, managed identity, the shared token cache, Visual Studio, VS Code, then the Azure CLI. As of 1.2.0, a developer who has run `az login`, or signed in to Visual Studio, just works. Grant each developer (or better, an Azure AD group) its own access policy on the dev vault:

```bash
az login
az keyvault set-policy \
    --name <your-dev-vault-name> \
    --upn <your-upn@your-domain.com> \
    --secret-permissions get list

# Or, for a group of developers
az keyvault set-policy \
    --name <your-dev-vault-name> \
    --object-id <your-group-object-id> \
    --secret-permissions get list
```

The chain has a cost. When something fails, the exception lists every credential it tried, and on a machine with several tenants the CLI or Visual Studio can pick the wrong account. When that happens I stop guessing and construct the specific credential (`new AzureCliCredential()` or `new ManagedIdentityCredential()`) so the failure points at one thing.

Two links in the chain cause most of the local pain. `ManagedIdentityCredential` probes the instance metadata endpoint first, which can add a noticeable delay to every startup on a laptop. `SharedTokenCacheCredential` often finds a stale or wrong account before Visual Studio or the CLI get a turn. For local runs, I switch both off with `new DefaultAzureCredential(new DefaultAzureCredentialOptions { ExcludeManagedIdentityCredential = true, ExcludeSharedTokenCacheCredential = true })`, gated on `context.HostingEnvironment.IsDevelopment()`. Developers who work across tenants can set `VisualStudioTenantId` or `SharedTokenCacheTenantId` on the same options object instead.

## Trade-offs to know before you ship

**Secrets are read once, at startup.** The 1.0.0 provider lists and loads every secret when the host builds and doesn't refresh them. If you rotate a database password, running instances keep the old value until they restart. For most connection strings that's acceptable, and a slot swap or restart becomes part of your rotation runbook. If a secret rotates often, read it on demand through `SecretClient` and cache it for a short, deliberate period:

```csharp
using System;
using System.Threading.Tasks;
using Azure.Security.KeyVault.Secrets;
using Microsoft.Extensions.Caching.Memory;

public class SecretReader
{
    private readonly SecretClient _client;
    private readonly IMemoryCache _cache;
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);

    public SecretReader(SecretClient client, IMemoryCache cache)
    {
        _client = client;
        _cache = cache;
    }

    public Task<string> GetAsync(string name) =>
        _cache.GetOrCreateAsync($"kv:{name}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            KeyVaultSecret secret = await _client.GetSecretAsync(name);
            return secret.Value;
        });
}
```

Register one credential and one `SecretClient` as singletons, so the chain is walked once and the token cache is shared. This is a fragment of `Startup.ConfigureServices`, which needs `using Azure.Core;`, `using Azure.Identity;` and `using Azure.Security.KeyVault.Secrets;` alongside the `using System;` the default 3.1 template already includes:

```csharp
// Fragment: inside Startup.ConfigureServices(IServiceCollection services)
var vaultName = Configuration["KeyVaultName"];
if (string.IsNullOrEmpty(vaultName))
{
    throw new InvalidOperationException(
        "KeyVaultName is not configured. Set it in appsettings.json or an environment variable.");
}

var credential = new DefaultAzureCredential();
services.AddSingleton<TokenCredential>(credential);
services.AddSingleton(new SecretClient(
    new Uri($"https://{vaultName}.vault.azure.net/"),
    credential));
services.AddMemoryCache();
services.AddSingleton<SecretReader>();
```

Don't fetch secrets on every request without a cache. Key Vault throttles each vault per region, and a busy API with no cache will hit that limit, then fail in ways that look like random 429s.

**Startup now depends on Key Vault.** If the vault is unreachable or the identity lacks permission, the app fails to start. I think that's correct, because failing fast beats running with missing configuration. Still, make sure your health checks and deployment slots surface the error instead of letting a bad deployment swap into production.

**Every secret in the vault gets loaded.** With one vault per app this doesn't matter. If you are stuck with a shared vault, subclass `KeyVaultSecretManager`, override `Load(SecretProperties)` to filter by a prefix, override `GetKey(KeyVaultSecret)` to strip it, and pass the manager to the `AddAzureKeyVault` overload that accepts one.

## When not to use the configuration provider at all

If the app runs on App Service or Azure Functions and you only need a handful of values, [Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references) (GA since October 2019) may be simpler. You set an app setting to `@Microsoft.KeyVault(SecretUri=https://<your-vault-name>.vault.azure.net/secrets/<secret-name>/<version>)`, and the platform resolves it with the app's managed identity. The app sees an ordinary environment variable and needs no SDK at all. The catch is that the reference pins a specific secret version, so rotation means updating the setting. You also lose the local-development story, since your laptop doesn't resolve references.

I'd also skip Key Vault for values that aren't secret. Feature flags, URLs and timeouts belong in `appsettings.json` or Azure App Configuration. Putting them in the vault widens who needs vault access and adds operations you pay for.

## What I'd set up on day one

For a new ASP.NET Core 3.1 service on Azure, I'd do this:

- Create one vault per app per environment, with soft-delete on, and purge protection on in production.
- Assign a system-assigned managed identity with an access policy limited to `get` and `list` on secrets.
- Use `Azure.Extensions.AspNetCore.Configuration.Secrets` with `DefaultAzureCredential`, so the same code runs locally and in Azure.
- Accept startup-time loading for stable secrets, and use `SecretClient` plus a short cache for the few that rotate.
- Never add a client secret to "authenticate to Key Vault". If a tutorial tells you to, you've moved the problem rather than solved it.

Rotation still needs a restart or a short cache, but nobody on the team ever handles a vault credential again.
