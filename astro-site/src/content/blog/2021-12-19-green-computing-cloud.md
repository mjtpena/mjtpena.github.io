---
title: "Green Computing in the Cloud: Sustainability at Scale"
description: "Green computing in 2021 became a real consideration, not just marketing. Azure's commitment to carbon negative by 2030 provides the tools; it's up to us to…"
author: Michael John Pena
draft: false
date: 2021-12-19
tags:
  - Green Computing
  - Sustainability
  - Azure
  - Cloud
  - Carbon Footprint
---

## Understanding Cloud Carbon Footprint

```python
from azure.mgmt.carbon import CarbonClient
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta

class CarbonFootprintAnalyzer:
    def __init__(self, subscription_id: str):
        self.credential = DefaultAzureCredential()
        self.subscription_id = subscription_id

    def get_carbon_emissions(self, days: int = 30) -> dict:
        """Get carbon emissions data for Azure resources"""
        # Note: This uses the Microsoft Sustainability Calculator data
        # Available through Azure Portal or API

        emissions_data = {
            "period": {
                "start": (datetime.utcnow() - timedelta(days=days)).isoformat(),
                "end": datetime.utcnow().isoformat()
            },
            "total_emissions_kg_co2e": 0,
            "by_service": {},
            "by_region": {}
        }

        # Query emissions by service
        # Integration with Microsoft Emissions Impact Dashboard

        return emissions_data

    def estimate_vm_carbon_footprint(
        self,
        vm_size: str,
        region: str,
        hours_running: float
    ) -> dict:
        """Estimate carbon footprint for a VM"""

        # Power consumption estimates by VM size (watts)
        power_by_size = {
            "Standard_D2s_v3": 50,
            "Standard_D4s_v3": 100,
            "Standard_D8s_v3": 200,
            "Standard_E2s_v3": 60,
            "Standard_E4s_v3": 120,
            "Standard_NC6": 300,  # GPU instances have higher consumption
            "Standard_NC12": 600
        }

        # Carbon intensity by Azure region (gCO2/kWh)
        # Source: Azure sustainability documentation
        carbon_intensity = {
            "australiaeast": 700,  # Coal-heavy grid
            "australiasoutheast": 700,
            "westeurope": 300,  # More renewable
            "northeurope": 200,  # Very green (Sweden/Ireland)
            "westus2": 350,
            "eastus": 400,
            "uksouth": 250,
            "francecentral": 50,  # Nuclear
            "norwayeast": 20,  # Hydroelectric
        }

        power_watts = power_by_size.get(vm_size, 100)
        intensity = carbon_intensity.get(region, 400)

        # Calculate emissions
        energy_kwh = (power_watts * hours_running) / 1000
        emissions_g = energy_kwh * intensity
        emissions_kg = emissions_g / 1000

        return {
            "vm_size": vm_size,
            "region": region,
            "hours": hours_running,
            "energy_kwh": round(energy_kwh, 2),
            "carbon_intensity_g_kwh": intensity,
            "emissions_kg_co2e": round(emissions_kg, 3),
            "equivalent_km_driven": round(emissions_kg / 0.12, 1)  # Average car ~120g/km
        }

    def recommend_greener_region(self, current_region: str, workload_type: str) -> dict:
        """Recommend lower-carbon regions for workload"""

        # Regions ranked by carbon intensity (lower is better)
        green_regions = [
            ("norwayeast", 20),
            ("swedencentral", 25),
            ("francecentral", 50),
            ("uksouth", 250),
            ("northeurope", 200),
            ("westeurope", 300)
        ]

        current_intensity = self._get_region_intensity(current_region)

        recommendations = []
        for region, intensity in green_regions:
            if intensity < current_intensity:
                latency_impact = self._estimate_latency_impact(current_region, region)
                savings_pct = ((current_intensity - intensity) / current_intensity) * 100

                recommendations.append({
                    "region": region,
                    "carbon_intensity": intensity,
                    "emissions_reduction_pct": round(savings_pct, 1),
                    "latency_impact_ms": latency_impact
                })

        return {
            "current_region": current_region,
            "current_intensity": current_intensity,
            "recommendations": recommendations
        }
```

## Sustainable Architecture Patterns

```yaml
# Sustainable workload design principles
# architecture/sustainability-principles.yaml

principles:
  - name: "Right-size resources"
    description: "Use only the resources you need"
    implementation:
      - Use autoscaling to match demand
      - Implement aggressive scale-to-zero
      - Choose smaller VM sizes and scale horizontally
    metrics:
      - Average CPU utilization > 40%
      - Memory utilization > 50%

  - name: "Choose efficient regions"
    description: "Deploy to regions with cleaner energy"
    implementation:
      - Prioritize regions with low carbon intensity
      - Use Azure region carbon data in deployment decisions
      - Consider multi-region for carbon optimization
    metrics:
      - Average carbon intensity < 300g CO2/kWh

  - name: "Optimize data storage"
    description: "Store data efficiently"
    implementation:
      - Use compression
      - Implement data lifecycle policies
      - Delete unused data
      - Use appropriate storage tiers
    metrics:
      - Storage efficiency ratio
      - Data deduplication rate

  - name: "Reduce data transfer"
    description: "Minimize network traffic"
    implementation:
      - Cache aggressively
      - Use CDN for static content
      - Compress API responses
      - Co-locate compute and storage
    metrics:
      - Cache hit rate > 80%
      - Network egress per request
```

## Implementing Carbon-Aware Workloads

```csharp
// Carbon-aware job scheduler
using System;
using System.Threading.Tasks;

public class CarbonAwareScheduler
{
    private readonly ICarbonIntensityService _carbonService;
    private readonly IJobQueue _jobQueue;

    public CarbonAwareScheduler(
        ICarbonIntensityService carbonService,
        IJobQueue jobQueue)
    {
        _carbonService = carbonService;
        _jobQueue = jobQueue;
    }

    public async Task ScheduleJob(Job job, SchedulingOptions options)
    {
        if (job.IsDeferrable && options.OptimizeForCarbon)
        {
            // Get carbon forecast for next 24 hours
            var forecast = await _carbonService.GetForecastAsync(
                options.Region,
                TimeSpan.FromHours(24)
            );

            // Find the lowest carbon window
            var optimalWindow = forecast
                .Where(f => f.Timestamp >= DateTime.UtcNow)
                .Where(f => f.Timestamp <= job.Deadline)
                .OrderBy(f => f.CarbonIntensity)
                .FirstOrDefault();

            if (optimalWindow != null &&
                optimalWindow.CarbonIntensity < forecast.First().CarbonIntensity * 0.7)
            {
                // Defer to lower carbon period
                job.ScheduledTime = optimalWindow.Timestamp;
                await _jobQueue.EnqueueAsync(job);

                Console.WriteLine(
                    $"Deferred job {job.Id} to {optimalWindow.Timestamp} " +
                    $"(intensity: {optimalWindow.CarbonIntensity} vs current: {forecast.First().CarbonIntensity})"
                );
                return;
            }
        }

        // Run immediately if not deferrable or no better window
        await _jobQueue.EnqueueAsync(job);
    }

    public async Task<string> SelectOptimalRegion(
        Job job,
        IEnumerable<string> availableRegions)
    {
        var regionIntensities = await Task.WhenAll(
            availableRegions.Select(async region => new
            {
                Region = region,
                Intensity = await _carbonService.GetCurrentIntensityAsync(region)
            })
        );

        // Select region with lowest current carbon intensity
        // that meets latency requirements
        var optimal = regionIntensities
            .Where(r => MeetsLatencyRequirements(r.Region, job.LatencyRequirements))
            .OrderBy(r => r.Intensity)
            .First();

        return optimal.Region;
    }
}

// Carbon intensity data service
public interface ICarbonIntensityService
{
    Task<double> GetCurrentIntensityAsync(string region);
    Task<IEnumerable<CarbonForecast>> GetForecastAsync(string region, TimeSpan duration);
}

public class WattTimeCarbonService : ICarbonIntensityService
{
    // Integration with WattTime or Electricity Maps API
    private readonly HttpClient _client;

    public async Task<double> GetCurrentIntensityAsync(string region)
    {
        var response = await _client.GetAsync($"/v2/index?region={region}");
        var data = await response.Content.ReadFromJsonAsync<WattTimeResponse>();
        return data.CarbonIntensity;
    }
}
```

## Measuring Sustainability

```python
# Sustainability metrics dashboard
from dataclasses import dataclass
from typing import List
import pandas as pd

@dataclass
class SustainabilityMetrics:
    period: str
    total_emissions_kg: float
    emissions_per_request: float
    pue_efficiency: float  # Power Usage Effectiveness
    renewable_energy_pct: float
    carbon_offset_kg: float

class SustainabilityReporter:
    def generate_report(self, subscription_id: str, period: str) -> dict:
        """Generate sustainability report"""

        # Collect metrics
        energy_data = self._get_energy_consumption(subscription_id, period)
        emissions_data = self._calculate_emissions(energy_data)
        efficiency_data = self._calculate_efficiency(subscription_id, period)

        report = {
            "period": period,
            "summary": {
                "total_energy_kwh": energy_data["total_kwh"],
                "total_emissions_kg_co2e": emissions_data["total_kg"],
                "renewable_percentage": self._get_renewable_pct(subscription_id),
                "pue": efficiency_data["pue"]
            },
            "by_service": self._breakdown_by_service(subscription_id, period),
            "by_region": self._breakdown_by_region(subscription_id, period),
            "trends": self._calculate_trends(subscription_id),
            "recommendations": self._generate_recommendations(
                energy_data, emissions_data, efficiency_data
            )
        }

        return report

    def _generate_recommendations(self, energy, emissions, efficiency) -> List[dict]:
        """Generate actionable recommendations"""
        recommendations = []

        # Check for inefficient regions
        high_carbon_regions = [
            r for r in emissions["by_region"]
            if r["intensity"] > 400
        ]
        if high_carbon_regions:
            recommendations.append({
                "priority": "high",
                "category": "region_optimization",
                "title": "Migrate workloads to lower-carbon regions",
                "description": f"Consider moving workloads from {', '.join([r['region'] for r in high_carbon_regions])} to lower-carbon regions",
                "potential_reduction_pct": 30
            })

        # Check resource utilization
        if efficiency["avg_cpu_utilization"] < 30:
            recommendations.append({
                "priority": "medium",
                "category": "right_sizing",
                "title": "Right-size underutilized resources",
                "description": "Average CPU utilization is below 30%. Consider smaller instance sizes.",
                "potential_reduction_pct": 20
            })

        # Check for always-on dev resources
        if efficiency["dev_resources_24x7"]:
            recommendations.append({
                "priority": "medium",
                "category": "scheduling",
                "title": "Implement shutdown schedules for dev/test",
                "description": "Dev resources running 24/7 could be scheduled for business hours only",
                "potential_reduction_pct": 60
            })

        return recommendations
```

## Sustainable Data Practices

```python
# Data sustainability - reduce storage and transfer
class SustainableDataManager:
    def optimize_storage_footprint(self, storage_account: str):
        """Implement sustainable data practices"""

        optimizations = []

        # 1. Enable compression
        # 2. Implement deduplication
        # 3. Set lifecycle policies
        # 4. Remove orphaned data

        lifecycle_policy = {
            "rules": [
                {
                    "name": "archive-old-data",
                    "enabled": True,
                    "type": "Lifecycle",
                    "definition": {
                        "filters": {"blobTypes": ["blockBlob"]},
                        "actions": {
                            "baseBlob": {
                                "tierToCool": {"daysAfterLastAccessTimeGreaterThan": 30},
                                "tierToArchive": {"daysAfterLastAccessTimeGreaterThan": 90},
                                "delete": {"daysAfterLastAccessTimeGreaterThan": 365}
                            }
                        }
                    }
                }
            ]
        }

        optimizations.append({
            "action": "lifecycle_policy",
            "config": lifecycle_policy,
            "estimated_storage_reduction_pct": 40
        })

        return optimizations

    def estimate_transfer_impact(
        self,
        data_size_gb: float,
        source_region: str,
        dest_region: str
    ) -> dict:
        """Estimate carbon impact of data transfer"""

        # Network energy: ~0.06 kWh per GB transferred
        network_energy_per_gb = 0.06

        # Add regional grid carbon intensity
        avg_intensity = 350  # g CO2/kWh average

        energy_kwh = data_size_gb * network_energy_per_gb
        emissions_g = energy_kwh * avg_intensity

        return {
            "data_size_gb": data_size_gb,
            "energy_kwh": round(energy_kwh, 3),
            "emissions_g_co2e": round(emissions_g, 1),
            "recommendation": "Co-locate compute with data" if emissions_g > 100 else "Transfer acceptable"
        }
```

## Key Sustainability Practices

1. **Measure Your Footprint**: Use Microsoft Sustainability Calculator
2. **Choose Green Regions**: Deploy to low-carbon regions when possible
3. **Right-Size Everything**: Idle resources waste energy
4. **Optimize Data**: Less storage and transfer means less energy
5. **Shift Flexible Workloads**: Run batch jobs when grid is cleanest

Green computing in 2021 became a real consideration, not just marketing. Azure's commitment to carbon negative by 2030 provides the tools; it's up to us to use them wisely.

## Resources

- [Microsoft Sustainability Calculator](https://www.microsoft.com/en-us/sustainability/emissions-impact-dashboard)
- [Azure Sustainability](https://azure.microsoft.com/en-us/global-infrastructure/sustainability/)
- [Green Software Foundation](https://greensoftware.foundation/)
