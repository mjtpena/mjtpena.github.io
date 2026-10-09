---
title: Implementing the Azure Well-Architected Framework
description: "The Azure Well-Architected Framework is the document I send to clients at the start of every architecture engagement and the checklist I review before every…"
author: Michael John Peña
draft: false
date: 2021-06-19
url: /blog/well-architected-framework/
tags:
  - Azure
  - Architecture
  - Best Practices
  - Well-Architected
---

The Azure Well-Architected Framework is the document I send to clients at the start of every architecture engagement and the checklist I review before every production go-live. Five pillars: Reliability (the system recovers from failures), Security (protect the system from threats), Cost Optimisation (eliminate waste, right-size resources), Operational Excellence (the team can operate and monitor the system), Performance Efficiency (the system scales to demand). The practical value is in the assessment: Microsoft's Well-Architected Review tool generates a scored profile across all five pillars and surfaces prioritised recommendations. I've used it to structure eight-week architecture improvement programmes and to make a principled case for investment in observability or DR capabilities that stakeholders initially deprioritised.

## The Five Pillars

### Pillar Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   Well-Architected Framework                     │
├─────────────┬─────────────┬─────────────┬──────────┬────────────┤
│    Cost     │ Operational │ Performance │Reliability│  Security  │
│Optimization │ Excellence  │ Efficiency  │          │            │
├─────────────┼─────────────┼─────────────┼──────────┼────────────┤
│ - Right-    │ - IaC       │ - Scaling   │ - HA     │ - Identity │
│   sizing    │ - CI/CD     │ - Caching   │ - DR     │ - Network  │
│ - Reserved  │ - Monitoring│ - CDN       │ - Backup │ - Data     │
│   instances │ - Automation│ - Async     │ - Health │ - App      │
│ - Budgets   │ - Testing   │ - Optimize  │ - Retry  │ - Govern   │
└─────────────┴─────────────┴─────────────┴──────────┴────────────┘
```

## Cost Optimization

### Right-Sizing Resources

```csharp
public class CostOptimizationService
{
    public async Task<RightSizingReport> AnalyzeVmSizingAsync()
    {
        var armClient = new ArmClient(new DefaultAzureCredential());
        var subscription = await armClient.GetDefaultSubscriptionAsync();

        var report = new RightSizingReport();

        await foreach (var vm in subscription.GetVirtualMachinesAsync())
        {
            var metrics = await GetVmMetricsAsync(vm);

            var recommendation = AnalyzeMetrics(vm, metrics);
            if (recommendation != null)
            {
                report.Recommendations.Add(recommendation);
            }
        }

        return report;
    }

    private SizingRecommendation? AnalyzeMetrics(
        VirtualMachineResource vm,
        VmMetrics metrics)
    {
        // Undersized if consistently above 80% CPU
        if (metrics.AvgCpuPercent > 80)
        {
            return new SizingRecommendation
            {
                VmName = vm.Data.Name,
                CurrentSize = vm.Data.HardwareProfile.VmSize.ToString(),
                Recommendation = "Consider scaling up",
                Reason = $"Average CPU: {metrics.AvgCpuPercent}%"
            };
        }

        // Oversized if consistently below 20% CPU
        if (metrics.AvgCpuPercent < 20 && metrics.MaxCpuPercent < 50)
        {
            return new SizingRecommendation
            {
                VmName = vm.Data.Name,
                CurrentSize = vm.Data.HardwareProfile.VmSize.ToString(),
                Recommendation = "Consider scaling down",
                Reason = $"Average CPU: {metrics.AvgCpuPercent}%, Max: {metrics.MaxCpuPercent}%"
            };
        }

        return null;
    }
}
```

### Reserved Instance Analysis

```csharp
public class ReservedInstanceAnalyzer
{
    public async Task<ReservationRecommendation> AnalyzeForReservationsAsync()
    {
        var usage = await GetUsageDataAsync(TimeSpan.FromDays(30));

        // Group by VM size and region
        var consistentUsage = usage
            .GroupBy(u => new { u.VmSize, u.Region })
            .Where(g => g.All(u => u.HoursRunning >= 720 * 0.8)) // 80% uptime
            .ToList();

        var recommendations = new List<ReservationSuggestion>();

        foreach (var group in consistentUsage)
        {
            var vmCount = group.Count();
            var currentMonthlyCost = group.Sum(g => g.MonthlyCost);
            var reservedCost = CalculateReservedCost(group.Key.VmSize, vmCount);
            var savings = currentMonthlyCost - reservedCost;

            if (savings > 0)
            {
                recommendations.Add(new ReservationSuggestion
                {
                    VmSize = group.Key.VmSize,
                    Region = group.Key.Region,
                    Quantity = vmCount,
                    CurrentMonthlyCost = currentMonthlyCost,
                    ReservedMonthlyCost = reservedCost,
                    MonthlySavings = savings,
                    AnnualSavings = savings * 12
                });
            }
        }

        return new ReservationRecommendation { Suggestions = recommendations };
    }
}
```

## Operational Excellence

### Infrastructure as Code

```bicep
// infrastructure/main.bicep
targetScope = 'subscription'

param environment string
param location string = 'australiaeast'

// Resource naming convention module
module naming 'modules/naming.bicep' = {
  name: 'naming'
  params: {
    environment: environment
    location: location
  }
}

// Networking module
module networking 'modules/networking.bicep' = {
  name: 'networking'
  scope: resourceGroup(naming.outputs.resourceGroupName)
  params: {
    naming: naming.outputs
  }
}

// Application module
module application 'modules/application.bicep' = {
  name: 'application'
  scope: resourceGroup(naming.outputs.resourceGroupName)
  params: {
    naming: naming.outputs
    subnetId: networking.outputs.appSubnetId
  }
}

// Monitoring module
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: resourceGroup(naming.outputs.resourceGroupName)
  params: {
    naming: naming.outputs
    applicationInsightsId: application.outputs.appInsightsId
  }
}
```

### Automated Deployment Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy Infrastructure

on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: Validate Bicep
        run: |
          az bicep build --file infrastructure/main.bicep
          az deployment sub validate \
            --location australiaeast \
            --template-file infrastructure/main.bicep \
            --parameters environment=dev

  deploy-dev:
    needs: validate
    runs-on: ubuntu-latest
    environment: development
    steps:
      - uses: actions/checkout@v2
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: Deploy to Dev
        run: |
          az deployment sub create \
            --location australiaeast \
            --template-file infrastructure/main.bicep \
            --parameters environment=dev

  deploy-prod:
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v2
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS_PROD }}
      - name: Deploy to Prod
        run: |
          az deployment sub create \
            --location australiaeast \
            --template-file infrastructure/main.bicep \
            --parameters environment=prod
```

## Performance Efficiency

### Auto-Scaling Configuration

```bicep
// autoscale.bicep
param appServicePlanId string
param minInstances int = 2
param maxInstances int = 10

resource autoScale 'Microsoft.Insights/autoscalesettings@2021-05-01-preview' = {
  name: 'autoscale-webapp'
  location: resourceGroup().location
  properties: {
    enabled: true
    targetResourceUri: appServicePlanId
    profiles: [
      {
        name: 'DefaultProfile'
        capacity: {
          minimum: string(minInstances)
          maximum: string(maxInstances)
          default: string(minInstances)
        }
        rules: [
          // Scale out on CPU
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: appServicePlanId
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 70
            }
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT5M'
            }
          }
          // Scale out on memory
          {
            metricTrigger: {
              metricName: 'MemoryPercentage'
              metricResourceUri: appServicePlanId
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 80
            }
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT5M'
            }
          }
          // Scale in
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: appServicePlanId
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT10M'
              timeAggregation: 'Average'
              operator: 'LessThan'
              threshold: 30
            }
            scaleAction: {
              direction: 'Decrease'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT10M'
            }
          }
        ]
      }
    ]
  }
}
```

### Caching Strategy

```csharp
public class CachingService
{
    private readonly IDistributedCache _cache;
    private readonly IDatabase _redis;

    public async Task<T?> GetOrSetAsync<T>(
        string key,
        Func<Task<T>> factory,
        CacheOptions options)
    {
        // Try L1 cache (in-memory)
        var cached = _memoryCache.Get<T>(key);
        if (cached != null) return cached;

        // Try L2 cache (Redis)
        var redisValue = await _redis.StringGetAsync(key);
        if (redisValue.HasValue)
        {
            var result = JsonSerializer.Deserialize<T>(redisValue!);
            _memoryCache.Set(key, result, options.LocalExpiry);
            return result;
        }

        // Fetch from source
        var value = await factory();

        // Set both caches
        var serialized = JsonSerializer.Serialize(value);
        await _redis.StringSetAsync(key, serialized, options.DistributedExpiry);
        _memoryCache.Set(key, value, options.LocalExpiry);

        return value;
    }
}
```

## Reliability

### Health Checks Implementation

```csharp
// Program.cs
builder.Services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("database")
    .AddCheck<StorageHealthCheck>("storage")
    .AddCheck<ExternalApiHealthCheck>("external-api")
    .AddAzureBlobStorage(connectionString, name: "azure-blob")
    .AddRedis(redisConnectionString, name: "redis");

app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
});

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false // Just checks the app is running
});
```

### Retry Policies with Polly

```csharp
public static class ResilienceExtensions
{
    public static IServiceCollection AddResilientHttpClient(
        this IServiceCollection services,
        string name,
        string baseAddress)
    {
        services.AddHttpClient(name, client =>
        {
            client.BaseAddress = new Uri(baseAddress);
        })
        .AddTransientHttpErrorPolicy(policy =>
            policy.WaitAndRetryAsync(
                retryCount: 3,
                sleepDurationProvider: retryAttempt =>
                    TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)),
                onRetry: (outcome, timespan, retryAttempt, context) =>
                {
                    Log.Warning(
                        "Retry {RetryAttempt} after {Delay}s due to {Exception}",
                        retryAttempt,
                        timespan.TotalSeconds,
                        outcome.Exception?.Message);
                }))
        .AddTransientHttpErrorPolicy(policy =>
            policy.CircuitBreakerAsync(
                handledEventsAllowedBeforeBreaking: 5,
                durationOfBreak: TimeSpan.FromSeconds(30),
                onBreak: (outcome, breakDelay) =>
                {
                    Log.Error("Circuit breaker opened for {Delay}s", breakDelay.TotalSeconds);
                },
                onReset: () =>
                {
                    Log.Information("Circuit breaker reset");
                }));

        return services;
    }
}
```

## Security

### Defense in Depth

```bicep
// security.bicep

// Network Security Group
resource nsg 'Microsoft.Network/networkSecurityGroups@2021-03-01' = {
  name: 'nsg-app'
  location: location
  properties: {
    securityRules: [
      {
        name: 'AllowHTTPS'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// Key Vault with private endpoint
resource keyVault 'Microsoft.KeyVault/vaults@2021-06-01-preview' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Deny'
      virtualNetworkRules: [
        {
          id: appSubnetId
        }
      ]
    }
  }
}
```

## Well-Architected Review

### Assessment Automation

```csharp
public class WellArchitectedAssessment
{
    public async Task<AssessmentReport> RunAssessmentAsync()
    {
        var report = new AssessmentReport();

        report.CostOptimization = await AssessCostOptimizationAsync();
        report.OperationalExcellence = await AssessOperationalExcellenceAsync();
        report.PerformanceEfficiency = await AssessPerformanceEfficiencyAsync();
        report.Reliability = await AssessReliabilityAsync();
        report.Security = await AssessSecurityAsync();

        report.OverallScore = CalculateOverallScore(report);

        return report;
    }

    private async Task<PillarScore> AssessReliabilityAsync()
    {
        var checks = new List<CheckResult>();

        // Check for availability zones
        checks.Add(await CheckAvailabilityZonesAsync());

        // Check for backup configurations
        checks.Add(await CheckBackupConfigurationsAsync());

        // Check for health probes
        checks.Add(await CheckHealthProbesAsync());

        // Check for disaster recovery
        checks.Add(await CheckDisasterRecoveryAsync());

        return new PillarScore
        {
            Pillar = "Reliability",
            Score = checks.Average(c => c.Score),
            Checks = checks
        };
    }
}
```

## Conclusion

The Well-Architected Framework provides comprehensive guidance for building excellent cloud solutions. By systematically addressing each pillar, you create workloads that are cost-effective, operationally sound, performant, reliable, and secure. Regular assessments using the Well-Architected Review help identify areas for improvement.

## References

- [Azure Well-Architected Framework](https://docs.microsoft.com/en-us/azure/architecture/framework/)
- [Well-Architected Review](https://docs.microsoft.com/en-us/assessments/)
