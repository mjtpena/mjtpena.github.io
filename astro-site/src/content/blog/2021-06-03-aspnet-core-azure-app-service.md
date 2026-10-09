---
title: ASP.NET Core Best Practices on Azure App Service
description: "ASP.NET Core on Azure App Service is the combination I've deployed more than any other in the past three years, and the relationship between the .NET…"
author: Michael John Peña
draft: false
date: 2021-06-03
url: /blog/aspnet-core-azure-app-service/
tags:
  - Azure
  - ASP.NET Core
  - App Service
  - .NET
---

ASP.NET Core on Azure App Service is the combination I've deployed more than any other in the past three years, and the relationship between the .NET version, the App Service runtime stack, and the deployment approach still trips people up more than it should. The "just deploy it" path works fine for greenfield projects. The complexity arrives with: slot swap deployments and connection string management, scaling rules that interact with session affinity settings, custom startup configuration for dependency injection at host level, and health check configuration that doesn't interfere with warm-up. This post is the production setup that I've settled on for App Service-hosted .NET APIs.

## Setting Up Your ASP.NET Core Application

### Creating a Production-Ready Project

```bash
dotnet new webapi -o ProductionApi
cd ProductionApi
```

### Essential NuGet Packages

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.ApplicationInsights.AspNetCore" Version="2.17.0" />
  <PackageReference Include="Azure.Extensions.AspNetCore.Configuration.Secrets" Version="1.2.1" />
  <PackageReference Include="Microsoft.Extensions.Diagnostics.HealthChecks.Abstractions" Version="6.0.0-preview.4" />
</ItemGroup>
```

## Configuring for Azure App Service

### Program.cs Setup

```csharp
using Azure.Identity;

var builder = WebApplication.CreateBuilder(args);

// Configure Azure Key Vault
if (builder.Environment.IsProduction())
{
    var keyVaultEndpoint = new Uri(
        Environment.GetEnvironmentVariable("AZURE_KEYVAULT_ENDPOINT")!);

    builder.Configuration.AddAzureKeyVault(
        keyVaultEndpoint,
        new DefaultAzureCredential());
}

// Add services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure Application Insights
builder.Services.AddApplicationInsightsTelemetry();

// Add Health Checks
builder.Services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("database")
    .AddCheck<ExternalApiHealthCheck>("external-api");

var app = builder.Build();

// Configure middleware pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();

// Map endpoints
app.MapControllers();
app.MapHealthChecks("/health");

app.Run();
```

### Health Check Implementation

```csharp
public class DatabaseHealthCheck : IHealthCheck
{
    private readonly IDbConnection _connection;

    public DatabaseHealthCheck(IDbConnection connection)
    {
        _connection = connection;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var command = _connection.CreateCommand();
            command.CommandText = "SELECT 1";
            await command.ExecuteScalarAsync(cancellationToken);

            return HealthCheckResult.Healthy("Database connection successful");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy(
                "Database connection failed",
                exception: ex);
        }
    }
}
```

## Deployment Strategies

### GitHub Actions Deployment

```yaml
name: Deploy to Azure App Service

on:
  push:
    branches: [main]

env:
  AZURE_WEBAPP_NAME: production-api
  DOTNET_VERSION: '6.0.x'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2

    - name: Setup .NET
      uses: actions/setup-dotnet@v1
      with:
        dotnet-version: ${{ env.DOTNET_VERSION }}
        include-prerelease: true

    - name: Restore dependencies
      run: dotnet restore

    - name: Build
      run: dotnet build --configuration Release --no-restore

    - name: Test
      run: dotnet test --no-restore --verbosity normal

    - name: Publish
      run: dotnet publish -c Release -o ./publish

    - name: Deploy to Azure Web App
      uses: azure/webapps-deploy@v2
      with:
        app-name: ${{ env.AZURE_WEBAPP_NAME }}
        publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
        package: ./publish
```

### Azure DevOps Pipeline

```yaml
trigger:
  branches:
    include:
    - main

pool:
  vmImage: 'ubuntu-latest'

variables:
  buildConfiguration: 'Release'
  dotnetVersion: '6.0.x'

stages:
- stage: Build
  jobs:
  - job: BuildJob
    steps:
    - task: UseDotNet@2
      inputs:
        packageType: 'sdk'
        version: '$(dotnetVersion)'
        includePreviewVersions: true

    - task: DotNetCoreCLI@2
      displayName: 'Restore'
      inputs:
        command: 'restore'
        projects: '**/*.csproj'

    - task: DotNetCoreCLI@2
      displayName: 'Build'
      inputs:
        command: 'build'
        projects: '**/*.csproj'
        arguments: '--configuration $(buildConfiguration)'

    - task: DotNetCoreCLI@2
      displayName: 'Publish'
      inputs:
        command: 'publish'
        publishWebProjects: true
        arguments: '--configuration $(buildConfiguration) --output $(Build.ArtifactStagingDirectory)'
        zipAfterPublish: true

    - task: PublishBuildArtifacts@1
      inputs:
        PathtoPublish: '$(Build.ArtifactStagingDirectory)'
        ArtifactName: 'drop'

- stage: Deploy
  dependsOn: Build
  jobs:
  - deployment: DeployToAppService
    environment: 'production'
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureWebApp@1
            inputs:
              azureSubscription: 'Azure-Production'
              appName: 'production-api'
              package: '$(Pipeline.Workspace)/drop/*.zip'
```

## App Service Configuration

### Application Settings via ARM Template

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "webAppName": {
      "type": "string"
    },
    "appServicePlanName": {
      "type": "string"
    }
  },
  "resources": [
    {
      "type": "Microsoft.Web/sites",
      "apiVersion": "2021-02-01",
      "name": "[parameters('webAppName')]",
      "location": "[resourceGroup().location]",
      "properties": {
        "serverFarmId": "[resourceId('Microsoft.Web/serverfarms', parameters('appServicePlanName'))]",
        "siteConfig": {
          "netFrameworkVersion": "v6.0",
          "alwaysOn": true,
          "http20Enabled": true,
          "minTlsVersion": "1.2",
          "ftpsState": "Disabled",
          "appSettings": [
            {
              "name": "ASPNETCORE_ENVIRONMENT",
              "value": "Production"
            },
            {
              "name": "ApplicationInsights__InstrumentationKey",
              "value": "[reference(resourceId('Microsoft.Insights/components', 'app-insights')).InstrumentationKey]"
            }
          ]
        },
        "httpsOnly": true
      }
    }
  ]
}
```

### Slot Configuration

```bash
# Create deployment slot
az webapp deployment slot create \
  --name production-api \
  --resource-group api-rg \
  --slot staging

# Configure slot-specific settings
az webapp config appsettings set \
  --name production-api \
  --resource-group api-rg \
  --slot staging \
  --settings ASPNETCORE_ENVIRONMENT=Staging

# Swap slots
az webapp deployment slot swap \
  --name production-api \
  --resource-group api-rg \
  --slot staging \
  --target-slot production
```

## Auto-Scaling Configuration

### Scale Rules

```json
{
  "type": "Microsoft.Insights/autoscalesettings",
  "apiVersion": "2015-04-01",
  "name": "api-autoscale",
  "location": "[resourceGroup().location]",
  "properties": {
    "profiles": [
      {
        "name": "DefaultProfile",
        "capacity": {
          "minimum": "2",
          "maximum": "10",
          "default": "2"
        },
        "rules": [
          {
            "metricTrigger": {
              "metricName": "CpuPercentage",
              "metricResourceUri": "[resourceId('Microsoft.Web/serverfarms', 'app-service-plan')]",
              "timeGrain": "PT1M",
              "statistic": "Average",
              "timeWindow": "PT5M",
              "timeAggregation": "Average",
              "operator": "GreaterThan",
              "threshold": 70
            },
            "scaleAction": {
              "direction": "Increase",
              "type": "ChangeCount",
              "value": "1",
              "cooldown": "PT5M"
            }
          },
          {
            "metricTrigger": {
              "metricName": "CpuPercentage",
              "metricResourceUri": "[resourceId('Microsoft.Web/serverfarms', 'app-service-plan')]",
              "timeGrain": "PT1M",
              "statistic": "Average",
              "timeWindow": "PT5M",
              "timeAggregation": "Average",
              "operator": "LessThan",
              "threshold": 30
            },
            "scaleAction": {
              "direction": "Decrease",
              "type": "ChangeCount",
              "value": "1",
              "cooldown": "PT10M"
            }
          }
        ]
      }
    ],
    "targetResourceUri": "[resourceId('Microsoft.Web/serverfarms', 'app-service-plan')]"
  }
}
```

## Logging and Monitoring

### Structured Logging with Serilog

```csharp
// Program.cs
using Serilog;
using Serilog.Events;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Information)
    .Enrich.FromLogContext()
    .Enrich.WithMachineName()
    .WriteTo.Console()
    .WriteTo.ApplicationInsights(
        TelemetryConfiguration.Active,
        TelemetryConverter.Traces)
    .CreateLogger();

builder.Host.UseSerilog();
```

### Custom Telemetry

```csharp
public class ApiTelemetryInitializer : ITelemetryInitializer
{
    public void Initialize(ITelemetry telemetry)
    {
        telemetry.Context.Cloud.RoleName = "ProductionApi";
        telemetry.Context.GlobalProperties["Environment"] =
            Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
    }
}
```

## Security Best Practices

### Configure CORS

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("Production", policy =>
    {
        policy.WithOrigins("https://myapp.com", "https://www.myapp.com")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

app.UseCors("Production");
```

### Rate Limiting

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.User.Identity?.Name ?? context.Request.Headers.Host.ToString(),
            factory: partition => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 100,
                QueueLimit = 0,
                Window = TimeSpan.FromMinutes(1)
            }));
});
```

## Conclusion

Deploying ASP.NET Core applications to Azure App Service requires understanding configuration, deployment pipelines, scaling strategies, and monitoring. By following these best practices, you ensure your application is production-ready, secure, and performant. The combination of App Service features with ASP.NET Core capabilities provides a robust foundation for enterprise applications.

## References

- [Azure App Service Documentation](https://docs.microsoft.com/en-us/azure/app-service/)
- [ASP.NET Core Documentation](https://docs.microsoft.com/en-us/aspnet/core/)
