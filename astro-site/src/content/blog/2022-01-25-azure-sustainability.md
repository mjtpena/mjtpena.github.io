---
title: "Azure Sustainability: Building a Greener Cloud"
description: "Microsoft has committed to being carbon negative by 2030. Azure regions are increasingly powered by renewable energy, and new tools help customers measure…"
author: Michael John Peña
draft: false
date: 2022-01-25
url: /blog/azure-sustainability/
tags:
  - Azure
  - Sustainability
  - green-computing
  - Cloud
---

## Microsoft's Sustainability Commitment

Microsoft has committed to being carbon negative by 2030. Azure regions are increasingly powered by renewable energy, and new tools help customers measure and reduce their impact.

## Carbon Footprint Tracking

Access your emissions data through the Emissions Impact Dashboard:

```powershell
# Get carbon emissions data via API
$token = (Get-AzAccessToken -ResourceUrl "https://management.azure.com").Token

$headers = @{
    'Authorization' = "Bearer $token"
    'Content-Type' = 'application/json'
}

$uri = "https://management.azure.com/subscriptions/$subscriptionId/providers/Microsoft.Carbon/carbonEmissionReports?api-version=2021-01-01-preview"

$emissions = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get

$emissions.value | ForEach-Object {
    [PSCustomObject]@{
        Period = $_.properties.reportingPeriod
        TotalEmissions = "$($_.properties.totalCarbonEmissions) kg CO2e"
        ScopeOneTwo = "$($_.properties.scopeOneTwoEmissions) kg CO2e"
        ScopeThree = "$($_.properties.scopeThreeEmissions) kg CO2e"
    }
}
```

## Sustainable Architecture Patterns

### Right-Sizing for Efficiency

```bicep
// Efficient VM sizing
resource vm 'Microsoft.Compute/virtualMachines@2021-11-01' = {
  name: 'vm-efficient'
  location: location
  properties: {
    hardwareProfile: {
      // Use ARM-based VMs for better power efficiency
      vmSize: 'Standard_D4pls_v5'  // ARM64-based, more efficient
    }
    // Enable hibernation to reduce power when idle
    additionalCapabilities: {
      hibernationEnabled: true
    }
  }
}
```

### Serverless First

```bicep
// Serverless reduces idle resource consumption
resource functionApp 'Microsoft.Web/sites@2021-03-01' = {
  name: 'func-sustainable'
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: consumptionPlan.id
    siteConfig: {
      linuxFxVersion: 'DOTNET|6.0'
    }
  }
}

resource consumptionPlan 'Microsoft.Web/serverfarms@2021-03-01' = {
  name: 'plan-consumption'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'  // Consumption plan - only runs when needed
    tier: 'Dynamic'
  }
}
```

### Choosing Green Regions

```csharp
// Select regions with higher renewable energy percentage
public class GreenRegionSelector
{
    // Azure regions with high renewable energy usage
    private static readonly Dictionary<string, double> RegionRenewablePercentage = new()
    {
        { "swedencentral", 100 },      // Sweden - 100% renewable
        { "norwayeast", 100 },          // Norway - 100% renewable
        { "westeurope", 95 },           // Netherlands - high renewable
        { "northeurope", 90 },          // Ireland - high renewable
        { "canadaeast", 85 },           // Quebec - hydro power
        { "australiaeast", 70 }         // Growing renewable capacity
    };

    public string SelectGreenestRegion(IEnumerable<string> availableRegions, double latencyRequirement)
    {
        return availableRegions
            .Where(r => RegionRenewablePercentage.ContainsKey(r))
            .OrderByDescending(r => RegionRenewablePercentage[r])
            .FirstOrDefault();
    }
}
```

## Optimizing Data Storage

```bicep
// Efficient storage tiering
resource storageAccount 'Microsoft.Storage/storageAccounts@2021-08-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'  // Consider LRS over GRS for lower footprint
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Cool'  // Cool tier for infrequently accessed data
  }
}

// Lifecycle management for automatic tiering
resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2021-08-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'archive-old-data'
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
            }
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: 30
                }
                tierToArchive: {
                  daysAfterModificationGreaterThan: 90
                }
                delete: {
                  daysAfterModificationGreaterThan: 365
                }
              }
            }
          }
        }
      ]
    }
  }
}
```

## Carbon-Aware Computing

```python
# Schedule workloads during low-carbon periods
import requests
from datetime import datetime, timedelta

class CarbonAwareScheduler:
    def __init__(self, region: str):
        self.region = region
        self.api_url = "https://api.carbonintensity.org.uk/intensity"

    def get_carbon_intensity(self) -> dict:
        """Get current and forecasted carbon intensity."""
        response = requests.get(f"{self.api_url}/fw48h")
        return response.json()

    def find_optimal_window(self, duration_hours: int) -> datetime:
        """Find the best time window for running a workload."""
        forecast = self.get_carbon_intensity()
        data = forecast['data']

        # Find lowest average intensity window
        best_start = None
        best_intensity = float('inf')

        for i in range(len(data) - duration_hours):
            window = data[i:i + duration_hours]
            avg_intensity = sum(d['intensity']['forecast'] for d in window) / duration_hours

            if avg_intensity < best_intensity:
                best_intensity = avg_intensity
                best_start = datetime.fromisoformat(window[0]['from'].replace('Z', '+00:00'))

        return best_start

# Usage
scheduler = CarbonAwareScheduler("australiaeast")
optimal_time = scheduler.find_optimal_window(duration_hours=4)
print(f"Schedule batch job at: {optimal_time}")
```

## Sustainability Metrics Dashboard

```kusto
// Log Analytics query for resource efficiency
AzureMetrics
| where ResourceProvider == "MICROSOFT.COMPUTE"
| where MetricName == "Percentage CPU"
| summarize AvgCPU = avg(Average), MaxCPU = max(Maximum) by Resource, bin(TimeGenerated, 1h)
| where AvgCPU < 10  // Identify underutilized resources
| project Resource, AvgCPU, MaxCPU, WastedCapacity = 100 - AvgCPU
| order by WastedCapacity desc
```

## Sustainable Development Practices

1. **Scale to zero** - Use serverless and auto-scaling
2. **Choose efficient regions** - Consider renewable energy percentages
3. **Optimize data** - Use appropriate storage tiers
4. **Right-size resources** - Avoid over-provisioning
5. **Monitor and measure** - Track carbon impact
6. **Batch workloads** - Run during low-carbon periods

Building sustainable cloud solutions is not just good for the planet - it often results in cost savings and operational efficiency.
