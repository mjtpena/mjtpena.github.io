---
title: "Azure App Configuration: Centralized Settings Management"
description: "\"Why is the staging environment talking to the production database?\" is a sentence I never want to hear again, and yet—when configuration lives in…"
author: Michael John Peña
draft: false
date: 2020-12-13
tags:
  - Azure
  - App Configuration
  - Configuration
  - DevOps
---

"Why is the staging environment talking to the production database?" is a sentence I never want to hear again, and yet—when configuration lives in `appsettings.{env}.json` files scattered across services, it's a question of when, not if. App Configuration centralises it. Settings, feature flags, and secret references (backed by Key Vault) in one place, with change notifications you can hook into for hot reload. The cost is trivial; the operational sanity is enormous.

## Creating App Configuration

```bash
az appconfig create \
    --name my-app-config \
    --resource-group myRG \
    --location eastus \
    --sku Standard
```

## Setting Configuration Values

```bash
# Set key-value
az appconfig kv set \
    --name my-app-config \
    --key "Settings:ApiEndpoint" \
    --value "https://api.example.com"

# Set with label (for environments)
az appconfig kv set \
    --name my-app-config \
    --key "Settings:ConnectionString" \
    --value "Server=dev-server" \
    --label "Development"

az appconfig kv set \
    --name my-app-config \
    --key "Settings:ConnectionString" \
    --value "Server=prod-server" \
    --label "Production"

# Reference Key Vault secret
az appconfig kv set-keyvault \
    --name my-app-config \
    --key "Settings:DatabasePassword" \
    --secret-identifier "https://myvault.vault.azure.net/secrets/db-password"
```

## .NET Integration

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Add App Configuration
builder.Configuration.AddAzureAppConfiguration(options =>
{
    options.Connect(builder.Configuration["ConnectionStrings:AppConfig"])
        .Select(KeyFilter.Any, LabelFilter.Null)
        .Select(KeyFilter.Any, builder.Environment.EnvironmentName)
        .ConfigureKeyVault(kv => kv.SetCredential(new DefaultAzureCredential()))
        .ConfigureRefresh(refresh =>
        {
            refresh.Register("Settings:RefreshToken", refreshAll: true)
                   .SetCacheExpiration(TimeSpan.FromSeconds(30));
        })
        .UseFeatureFlags(flags =>
        {
            flags.CacheExpirationInterval = TimeSpan.FromMinutes(5);
        });
});

// Add middleware for refresh
builder.Services.AddAzureAppConfiguration();

var app = builder.Build();
app.UseAzureAppConfiguration();
```

```csharp
// Inject configuration
public class MyService
{
    private readonly IConfiguration _config;

    public MyService(IConfiguration config)
    {
        _config = config;
    }

    public string GetApiEndpoint()
    {
        return _config["Settings:ApiEndpoint"];
    }
}
```

## Feature Flags

```bash
# Create feature flag
az appconfig feature set \
    --name my-app-config \
    --feature "BetaFeature" \
    --label "Production"

# Enable/disable
az appconfig feature enable --name my-app-config --feature "BetaFeature"
az appconfig feature disable --name my-app-config --feature "BetaFeature"
```

### Feature Flag Filters

```json
{
    "id": "BetaFeature",
    "enabled": true,
    "conditions": {
        "client_filters": [
            {
                "name": "Percentage",
                "parameters": {
                    "Value": 25
                }
            },
            {
                "name": "Targeting",
                "parameters": {
                    "Audience": {
                        "Users": ["user1@company.com"],
                        "Groups": [
                            { "Name": "BetaTesters", "RolloutPercentage": 100 }
                        ],
                        "DefaultRolloutPercentage": 10
                    }
                }
            }
        ]
    }
}
```

### Using Feature Flags

```csharp
public class HomeController : Controller
{
    private readonly IFeatureManager _featureManager;

    public HomeController(IFeatureManager featureManager)
    {
        _featureManager = featureManager;
    }

    public async Task<IActionResult> Index()
    {
        if (await _featureManager.IsEnabledAsync("BetaFeature"))
        {
            return View("BetaIndex");
        }
        return View();
    }
}
```

```razor
<!-- In Razor views -->
<feature name="BetaFeature">
    <div class="beta-content">
        New Beta Feature!
    </div>
</feature>
```

## Configuration Snapshots

```bash
# Create snapshot
az appconfig snapshot create \
    --name my-app-config \
    --snapshot-name "release-v1.0" \
    --filters '{key="Settings:*", label="Production"}'

# List snapshots
az appconfig snapshot list --name my-app-config

# Archive snapshot
az appconfig snapshot archive \
    --name my-app-config \
    --snapshot-name "release-v1.0"
```

## Event Grid Integration

```bash
# Subscribe to configuration changes
az eventgrid event-subscription create \
    --name config-changes \
    --source-resource-id /subscriptions/.../appconfig/my-app-config \
    --endpoint https://myapp.com/webhook \
    --included-event-types Microsoft.AppConfiguration.KeyValueModified
```

App Configuration: dynamic settings without redeployment.
