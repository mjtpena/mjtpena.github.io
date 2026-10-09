---
title: Multi-Tenant Management Patterns in Azure
description: "Multi-tenant Azure management is the architecture problem I've spent more time on this year than any other. The patterns matter because the wrong choice…"
author: Michael John Peña
draft: false
date: 2021-06-16
url: /blog/multi-tenant-management-patterns/
tags:
  - Azure
  - Multi-Tenant
  - Architecture
  - Governance
---

Multi-tenant Azure management is the architecture problem I've spent more time on this year than any other. The patterns matter because the wrong choice doesn't fail immediately—it fails when you're trying to apply a security policy to 50 tenants and realise your automation has no consistent permission model across them. Whether you're an enterprise with regional subsidiaries, an ISV with per-customer Entra tenants, or an MSP managing a customer portfolio, the fundamental questions are the same: how does your service principal authenticate into each tenant, where does the policy enforcement live, and how do you audit activity across boundaries? Today's post is the three patterns I've actually used in production and when each is appropriate.

## Multi-Tenant Architecture Patterns

### Pattern 1: Shared Management Tenant

```
┌─────────────────────────────────────────────────────────────────┐
│                    Management Tenant                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Automation  │  │  Monitoring │  │  Security   │             │
│  │  Account    │  │  Workspace  │  │   Center    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                          │                                       │
│              Azure Lighthouse Delegations                        │
└──────────────────────────┼───────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
   │Tenant A │       │Tenant B │       │Tenant C │
   │Customer │       │Customer │       │Customer │
   └─────────┘       └─────────┘       └─────────┘
```

### Pattern 2: Hub-and-Spoke Tenant Model

```csharp
public class HubSpokeManager
{
    private readonly ArmClient _armClient;
    private readonly ILogger<HubSpokeManager> _logger;

    public HubSpokeManager(ILogger<HubSpokeManager> logger)
    {
        _armClient = new ArmClient(new DefaultAzureCredential());
        _logger = logger;
    }

    public async Task<HubTenantInfo> GetHubTenantAsync()
    {
        // Hub tenant contains shared services
        var hubSubscription = await _armClient.GetDefaultSubscriptionAsync();

        return new HubTenantInfo
        {
            TenantId = hubSubscription.Data.TenantId,
            SubscriptionId = hubSubscription.Data.SubscriptionId,
            Services = await GetSharedServicesAsync(hubSubscription)
        };
    }

    public async IAsyncEnumerable<SpokeTenantInfo> GetSpokesAsync()
    {
        // Iterate through all delegated subscriptions (spokes)
        await foreach (var subscription in _armClient.GetSubscriptions())
        {
            var hub = await GetHubTenantAsync();
            if (subscription.Data.TenantId != hub.TenantId)
            {
                yield return new SpokeTenantInfo
                {
                    TenantId = subscription.Data.TenantId,
                    SubscriptionId = subscription.Data.SubscriptionId,
                    SubscriptionName = subscription.Data.DisplayName
                };
            }
        }
    }

    private async Task<SharedServices> GetSharedServicesAsync(
        SubscriptionResource subscription)
    {
        // Query shared services in hub
        return new SharedServices
        {
            LogAnalyticsWorkspace = await GetLogAnalyticsAsync(subscription),
            AutomationAccount = await GetAutomationAccountAsync(subscription),
            KeyVault = await GetKeyVaultAsync(subscription)
        };
    }
}
```

## Centralized Logging Architecture

### Log Analytics Workspace Setup

```bicep
// hub-logging.bicep
param location string = 'australiaeast'
param retentionDays int = 90

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2021-06-01' = {
  name: 'log-hub-central'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

// Data Collection Rule for cross-tenant logs
resource dataCollectionRule 'Microsoft.Insights/dataCollectionRules@2021-04-01' = {
  name: 'dcr-cross-tenant'
  location: location
  properties: {
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: logAnalytics.id
          name: 'centralWorkspace'
        }
      ]
    }
    dataFlows: [
      {
        streams: [
          'Microsoft-SecurityEvent'
          'Microsoft-Syslog'
          'Microsoft-Perf'
        ]
        destinations: [
          'centralWorkspace'
        ]
      }
    ]
  }
}

output workspaceId string = logAnalytics.id
output workspaceCustomerId string = logAnalytics.properties.customerId
```

### Cross-Tenant Log Forwarding

```powershell
# Deploy diagnostic settings across all tenants
function Set-CrossTenantDiagnostics {
    param(
        [string]$CentralWorkspaceId,
        [string[]]$ResourceTypes = @(
            'Microsoft.Compute/virtualMachines',
            'Microsoft.Web/sites',
            'Microsoft.Sql/servers'
        )
    )

    $subscriptions = Get-AzSubscription

    foreach ($sub in $subscriptions) {
        Set-AzContext -SubscriptionId $sub.Id

        foreach ($type in $ResourceTypes) {
            $resources = Get-AzResource -ResourceType $type

            foreach ($resource in $resources) {
                $diagName = "diag-central-$(Get-Random)"

                Set-AzDiagnosticSetting `
                    -ResourceId $resource.ResourceId `
                    -Name $diagName `
                    -WorkspaceId $CentralWorkspaceId `
                    -Enabled $true `
                    -Category @("AllMetrics")

                Write-Output "Enabled diagnostics for: $($resource.Name)"
            }
        }
    }
}
```

## Centralized Security Management

### Microsoft Defender for Cloud Configuration

```csharp
public class CrossTenantSecurityManager
{
    private readonly ArmClient _armClient;

    public CrossTenantSecurityManager()
    {
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task<SecurityOverview> GetSecurityOverviewAsync()
    {
        var overview = new SecurityOverview();

        await foreach (var subscription in _armClient.GetSubscriptions())
        {
            var securityCenter = subscription.GetSecurityCenterSubscriptionResource();

            // Get secure score
            var secureScore = await GetSecureScoreAsync(subscription);

            // Get security alerts
            var alerts = await GetSecurityAlertsAsync(subscription);

            // Get recommendations
            var recommendations = await GetRecommendationsAsync(subscription);

            overview.TenantScores.Add(new TenantSecurityScore
            {
                SubscriptionId = subscription.Data.SubscriptionId,
                SubscriptionName = subscription.Data.DisplayName,
                SecureScore = secureScore,
                AlertCount = alerts.Count,
                RecommendationCount = recommendations.Count
            });
        }

        return overview;
    }

    public async Task ApplySecurityBaselineAsync(
        string subscriptionId,
        SecurityBaseline baseline)
    {
        var subscription = await _armClient.GetSubscriptions()
            .GetAsync(subscriptionId);

        // Enable security features based on baseline
        foreach (var feature in baseline.RequiredFeatures)
        {
            await EnableSecurityFeatureAsync(subscription.Value, feature);
        }

        // Apply security policies
        foreach (var policy in baseline.Policies)
        {
            await ApplySecurityPolicyAsync(subscription.Value, policy);
        }
    }
}
```

## Unified Cost Management

### Cross-Tenant Cost Analysis

```csharp
public class CrossTenantCostManager
{
    public async Task<CostSummary> GetCostSummaryAsync(
        DateTime startDate,
        DateTime endDate)
    {
        var summary = new CostSummary
        {
            StartDate = startDate,
            EndDate = endDate,
            TenantCosts = new List<TenantCost>()
        };

        var armClient = new ArmClient(new DefaultAzureCredential());

        await foreach (var subscription in armClient.GetSubscriptions())
        {
            var costData = await GetSubscriptionCostAsync(
                subscription,
                startDate,
                endDate);

            summary.TenantCosts.Add(new TenantCost
            {
                SubscriptionId = subscription.Data.SubscriptionId,
                SubscriptionName = subscription.Data.DisplayName,
                TotalCost = costData.TotalCost,
                Currency = costData.Currency,
                CostByService = costData.ServiceCosts,
                CostByResourceGroup = costData.ResourceGroupCosts
            });
        }

        summary.TotalCost = summary.TenantCosts.Sum(t => t.TotalCost);

        return summary;
    }

    private async Task<SubscriptionCostData> GetSubscriptionCostAsync(
        SubscriptionResource subscription,
        DateTime startDate,
        DateTime endDate)
    {
        // Use Cost Management API
        var costManagement = new CostManagementClient(
            new DefaultAzureCredential());

        var query = new QueryDefinition
        {
            Type = ExportType.ActualCost,
            Timeframe = TimeframeType.Custom,
            TimePeriod = new QueryTimePeriod
            {
                From = startDate,
                To = endDate
            },
            Dataset = new QueryDataset
            {
                Granularity = GranularityType.Daily,
                Aggregation = new Dictionary<string, QueryAggregation>
                {
                    ["totalCost"] = new QueryAggregation
                    {
                        Name = "Cost",
                        Function = FunctionType.Sum
                    }
                },
                Grouping = new[]
                {
                    new QueryGrouping
                    {
                        Type = QueryColumnType.Dimension,
                        Name = "ServiceName"
                    }
                }
            }
        };

        var result = await costManagement.QueryUsageAsync(
            $"/subscriptions/{subscription.Data.SubscriptionId}",
            query);

        return ParseCostResult(result);
    }
}
```

## Automated Governance Enforcement

### Policy Compliance Checker

```csharp
public class GovernanceEnforcer
{
    private readonly ILogger _logger;
    private readonly ArmClient _armClient;

    public GovernanceEnforcer(ILogger<GovernanceEnforcer> logger)
    {
        _logger = logger;
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task<ComplianceReport> CheckComplianceAsync()
    {
        var report = new ComplianceReport();

        await foreach (var subscription in _armClient.GetSubscriptions())
        {
            var tenantCompliance = new TenantCompliance
            {
                SubscriptionId = subscription.Data.SubscriptionId,
                SubscriptionName = subscription.Data.DisplayName
            };

            // Check tag compliance
            tenantCompliance.TagCompliance = await CheckTagComplianceAsync(subscription);

            // Check network compliance
            tenantCompliance.NetworkCompliance = await CheckNetworkComplianceAsync(subscription);

            // Check security compliance
            tenantCompliance.SecurityCompliance = await CheckSecurityComplianceAsync(subscription);

            report.TenantComplianceResults.Add(tenantCompliance);
        }

        return report;
    }

    private async Task<TagComplianceResult> CheckTagComplianceAsync(
        SubscriptionResource subscription)
    {
        var requiredTags = new[] { "Environment", "CostCenter", "Owner" };
        var nonCompliantResources = new List<string>();

        await foreach (var rg in subscription.GetResourceGroups())
        {
            await foreach (var resource in rg.GetGenericResourcesAsync())
            {
                var missingTags = requiredTags
                    .Where(t => !resource.Data.Tags?.ContainsKey(t) ?? true)
                    .ToList();

                if (missingTags.Any())
                {
                    nonCompliantResources.Add(
                        $"{resource.Data.Name} (missing: {string.Join(", ", missingTags)})");
                }
            }
        }

        return new TagComplianceResult
        {
            IsCompliant = nonCompliantResources.Count == 0,
            NonCompliantResources = nonCompliantResources
        };
    }
}
```

## Deployment Orchestration

### Multi-Tenant Deployment Pipeline

```yaml
# azure-pipelines-multi-tenant.yml
trigger:
  - main

parameters:
  - name: tenants
    type: object
    default:
      - name: 'CustomerA'
        subscriptionId: 'sub-a-id'
        environment: 'production'
      - name: 'CustomerB'
        subscriptionId: 'sub-b-id'
        environment: 'production'
      - name: 'CustomerC'
        subscriptionId: 'sub-c-id'
        environment: 'staging'

stages:
  - stage: Build
    jobs:
      - job: BuildArtifacts
        steps:
          - task: DotNetCoreCLI@2
            inputs:
              command: 'publish'
              arguments: '-c Release -o $(Build.ArtifactStagingDirectory)'
          - publish: $(Build.ArtifactStagingDirectory)
            artifact: drop

  - ${{ each tenant in parameters.tenants }}:
    - stage: Deploy_${{ tenant.name }}
      dependsOn: Build
      jobs:
        - deployment: Deploy
          environment: ${{ tenant.environment }}
          strategy:
            runOnce:
              deploy:
                steps:
                  - download: current
                    artifact: drop

                  - task: AzureCLI@2
                    displayName: 'Deploy to ${{ tenant.name }}'
                    inputs:
                      azureSubscription: 'Lighthouse-Connection'
                      scriptType: 'bash'
                      scriptLocation: 'inlineScript'
                      inlineScript: |
                        # Set context to customer subscription
                        az account set --subscription ${{ tenant.subscriptionId }}

                        # Deploy resources
                        az deployment group create \
                          --resource-group rg-app-${{ tenant.environment }} \
                          --template-file $(Pipeline.Workspace)/drop/template.json \
                          --parameters environment=${{ tenant.environment }}
```

## Conclusion

Multi-tenant management in Azure requires thoughtful architecture that balances operational efficiency with tenant isolation. Azure Lighthouse provides the foundation, while centralized logging, security, and governance tools enable consistent management. By implementing these patterns, you can scale operations across hundreds of tenants while maintaining security and compliance.

## References

- [Azure Architecture Center - Multi-tenant Solutions](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/)
- [Azure Lighthouse Best Practices](https://docs.microsoft.com/en-us/azure/lighthouse/concepts/recommended-security-practices)
