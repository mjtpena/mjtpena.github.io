---
title: Centralized Configuration Management with Azure App Configuration
author: Michael John Pena
draft: false
date: 2021-03-04
url: /blog/azure-app-configuration/
tags:
  - Azure
  - Configuration
  - Feature Flags
  - .NET
  - DevOps

---

I wrote "2021-03-04-azure-app-configuration" to share practical, production-minded guidance on this topic.

## Why Azure App Configuration?

Traditional configuration approaches using appsettings.json or environment variables have limitations:
- No central management
- Requires redeployment for changes
- Difficult to maintain consistency across services
- No built-in feature flag support

Azure App Configuration solves these problems with:
- Centralized configuration store
- Real-time configuration updates
- Feature flag management
- Key Vault integration for secrets
- Configuration snapshots and versioning

## Setting Up Azure App Configuration

```bash
# Create App Configuration store
az appconfig create \
    --name myappconfig \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard

# Add configuration values
az appconfig kv set \
    --name myappconfig \
    --key "Settings:ServiceEndpoint" \
    --value "https://api.example.com" \
    --yes

az appconfig kv set \
    --name myappconfig \
    --key "Settings:MaxRetries" \
    --value "3" \
    --yes

# Add labeled configurations for different environments
az appconfig kv set \
    --name myappconfig \
    --key "Settings:ServiceEndpoint" \
    --value "https://api-dev.example.com" \
    --label "Development" \
    --yes

az appconfig kv set \
    --name myappconfig \
    --key "Settings:ServiceEndpoint" \
    --value "https://api-prod.example.com" \
    --label "Production" \
    --yes
```

## .NET Core Integration

Add the required packages:

```bash
dotnet add package Microsoft.Azure.AppConfiguration.AspNetCore
dotnet add package Microsoft.FeatureManagement.AspNetCore
```

Configure in Program.cs:

```csharp
// Program.cs
using Microsoft.FeatureManagement;

var builder = WebApplication.CreateBuilder(args);

// Add Azure App Configuration
var connectionString = builder.Configuration.GetConnectionString("AppConfig");

builder.Configuration.AddAzureAppConfiguration(options =>
{
    options.Connect(connectionString)
        // Load all keys with no label
        .Select(KeyFilter.Any, LabelFilter.Null)
        // Load keys for current environment
        .Select(KeyFilter.Any, builder.Environment.EnvironmentName)
        // Enable dynamic configuration refresh
        .ConfigureRefresh(refresh =>
        {
            refresh.Register("Settings:Sentinel", refreshAll: true)
                   .SetCacheExpiration(TimeSpan.FromSeconds(30));
        })
        // Load feature flags
        .UseFeatureFlags(featureFlags =>
        {
            featureFlags.CacheExpirationInterval = TimeSpan.FromMinutes(5);
        });
});

builder.Services.AddAzureAppConfiguration();
builder.Services.AddFeatureManagement();

var app = builder.Build();

// Enable dynamic configuration
app.UseAzureAppConfiguration();

app.MapGet("/", () => "Hello World!");

app.Run();
```

Configuration model:

```csharp
// Settings.cs
public class Settings
{
    public string ServiceEndpoint { get; set; }
    public int MaxRetries { get; set; }
    public TimeSpan Timeout { get; set; }
}

// Configure in startup
builder.Services.Configure<Settings>(
    builder.Configuration.GetSection("Settings"));
```

Using configuration in a service:

```csharp
// MyService.cs
public class MyService
{
    private readonly IOptionsSnapshot<Settings> _settings;
    private readonly ILogger<MyService> _logger;

    public MyService(IOptionsSnapshot<Settings> settings, ILogger<MyService> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public async Task<string> CallExternalServiceAsync()
    {
        var endpoint = _settings.Value.ServiceEndpoint;
        var maxRetries = _settings.Value.MaxRetries;

        _logger.LogInformation("Calling {Endpoint} with {MaxRetries} retries",
            endpoint, maxRetries);

        // Your implementation here
        using var client = new HttpClient();
        var response = await client.GetStringAsync(endpoint);
        return response;
    }
}
```

## Feature Flags

Create feature flags in App Configuration:

```bash
# Create a simple feature flag
az appconfig feature set \
    --name myappconfig \
    --feature Beta \
    --yes

# Create a feature flag with conditions
az appconfig feature set \
    --name myappconfig \
    --feature PremiumFeature \
    --yes

az appconfig feature filter add \
    --name myappconfig \
    --feature PremiumFeature \
    --filter-name Microsoft.Percentage \
    --filter-parameters Value=50
```

Using feature flags in code:

```csharp
// Controllers/HomeController.cs
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;

[ApiController]
[Route("[controller]")]
public class HomeController : ControllerBase
{
    private readonly IFeatureManager _featureManager;

    public HomeController(IFeatureManager featureManager)
    {
        _featureManager = featureManager;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        if (await _featureManager.IsEnabledAsync("Beta"))
        {
            return Ok("Welcome to the beta experience!");
        }

        return Ok("Welcome!");
    }

    // Use attribute-based feature flag
    [FeatureGate("PremiumFeature")]
    [HttpGet("premium")]
    public IActionResult GetPremium()
    {
        return Ok("Premium content here!");
    }
}
```

Custom feature filter:

```csharp
// UserTargetingFilter.cs
using Microsoft.FeatureManagement;

[FilterAlias("UserTargeting")]
public class UserTargetingFilter : IFeatureFilter
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public UserTargetingFilter(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
    {
        var settings = context.Parameters.Get<UserTargetingSettings>();
        var user = _httpContextAccessor.HttpContext?.User;

        if (user?.Identity?.IsAuthenticated == true)
        {
            var userId = user.FindFirst("sub")?.Value;
            return Task.FromResult(settings.AllowedUsers.Contains(userId));
        }

        return Task.FromResult(false);
    }
}

public class UserTargetingSettings
{
    public List<string> AllowedUsers { get; set; } = new();
}

// Register in Program.cs
builder.Services.AddFeatureManagement()
    .AddFeatureFilter<UserTargetingFilter>();
```

## Key Vault References

Store secrets in Key Vault and reference them from App Configuration:

```bash
# Create Key Vault and secret
az keyvault create \
    --name mykeyvault \
    --resource-group myResourceGroup \
    --location eastus

az keyvault secret set \
    --vault-name mykeyvault \
    --name "DatabasePassword" \
    --value "super-secret-password"

# Create Key Vault reference in App Configuration
az appconfig kv set-keyvault \
    --name myappconfig \
    --key "ConnectionStrings:Database:Password" \
    --secret-identifier "https://mykeyvault.vault.azure.net/secrets/DatabasePassword" \
    --yes
```

Configure the application to resolve Key Vault references:

```csharp
builder.Configuration.AddAzureAppConfiguration(options =>
{
    options.Connect(connectionString)
        .ConfigureKeyVault(kv =>
        {
            kv.SetCredential(new DefaultAzureCredential());
        });
});
```

## Configuration Snapshots

Create immutable snapshots for deployment consistency:

```bash
# Create a snapshot
az appconfig snapshot create \
    --name myappconfig \
    --snapshot-name "release-v1.0.0" \
    --filters '{\"key\":\"Settings:*\",\"label\":\"Production\"}'

# List snapshots
az appconfig snapshot list --name myappconfig

# Use snapshot in application
builder.Configuration.AddAzureAppConfiguration(options =>
{
    options.Connect(connectionString)
        .SelectSnapshot("release-v1.0.0");
});
```

## Conclusion

Azure App Configuration simplifies configuration management for modern applications. By centralizing settings and feature flags, you gain:

- Single source of truth for configuration
- Dynamic updates without redeployment
- Environment-specific settings with labels
- Secure secret management through Key Vault integration
- Powerful feature flag capabilities for progressive rollouts

Start with basic key-value storage and gradually adopt feature flags and Key Vault integration as your needs grow.

