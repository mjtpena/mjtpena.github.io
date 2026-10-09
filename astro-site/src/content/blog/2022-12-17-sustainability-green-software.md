---
title: "Green Software and Sustainability in Cloud Computing"
author: Michael John Peña
draft: false
date: 2022-12-17
tags:
  - Sustainability
  - Green Software
  - Cloud Computing
  - Azure
  - Carbon
---

## The Green Software Foundation Principles

1. **Carbon**: Reduce the carbon emissions of software
2. **Electricity**: Reduce the electricity consumption
3. **Carbon Intensity**: Run workloads when/where carbon intensity is lower
4. **Embodied Carbon**: Maximize hardware utilization
5. **Energy Proportionality**: Maximize energy efficiency
6. **Networking**: Reduce network data transfer
7. **Demand Shaping**: Shift workloads in time and space

## Azure Sustainability Features

### Carbon Dashboard

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.carbon import CarbonClient

def get_carbon_emissions(subscription_id: str, days: int = 30):
    """Get carbon emissions data for Azure resources."""

    credential = DefaultAzureCredential()
    client = CarbonClient(credential, subscription_id)

    # Query carbon emissions
    emissions = client.carbon_emissions.query(
        scope=f"/subscriptions/{subscription_id}",
        parameters={
            "dateRange": {
                "start": f"-{days}d",
                "end": "now"
            },
            "groupBy": ["resourceGroup", "serviceName"]
        }
    )

    return emissions
```

### Region Selection for Lower Carbon

```python
# Azure regions with lower carbon intensity
low_carbon_regions = {
    "swedencentral": {"carbon_intensity": "low", "renewable": "95%"},
    "norwayeast": {"carbon_intensity": "low", "renewable": "98%"},
    "francecentral": {"carbon_intensity": "low", "renewable": "90%"},
    "uksouth": {"carbon_intensity": "medium", "renewable": "40%"},
    "westeurope": {"carbon_intensity": "medium", "renewable": "35%"},
}

def select_greenest_region(required_services: list, latency_requirement: str) -> str:
    """Select the greenest region that meets requirements."""

    eligible_regions = []

    for region, data in low_carbon_regions.items():
        if check_service_availability(region, required_services):
            if check_latency_requirement(region, latency_requirement):
                eligible_regions.append((region, data["carbon_intensity"]))

    # Sort by carbon intensity (low first)
    eligible_regions.sort(key=lambda x: x[1])

    return eligible_regions[0][0] if eligible_regions else None
```

## Carbon-Aware Computing

### Time-Shifting Workloads

```csharp
using CarbonAware.Plugins;
using System;
using System.Threading.Tasks;

public class CarbonAwareScheduler
{
    private readonly ICarbonIntensityDataSource _carbonData;
    private readonly IJobQueue _jobQueue;

    public async Task<DateTime> ScheduleJobAsync(Job job, TimeSpan maxDelay)
    {
        // Get carbon intensity forecast
        var forecast = await _carbonData.GetForecastAsync(
            location: job.PreferredRegion,
            windowSize: maxDelay
        );

        // Find the lowest carbon intensity window
        var optimalWindow = forecast
            .OrderBy(f => f.CarbonIntensity)
            .First();

        // Schedule job for optimal time
        await _jobQueue.ScheduleAsync(job, optimalWindow.StartTime);

        return optimalWindow.StartTime;
    }
}

// Usage
var scheduler = new CarbonAwareScheduler(carbonData, jobQueue);

// Non-urgent batch job - can wait up to 24 hours
var scheduledTime = await scheduler.ScheduleJobAsync(
    new Job { Name = "NightlyReport", PreferredRegion = "westeurope" },
    maxDelay: TimeSpan.FromHours(24)
);

Console.WriteLine($"Job scheduled for {scheduledTime} (lowest carbon intensity)");
```

### Space-Shifting Workloads

```python
import requests
from typing import List, Tuple

class CarbonAwareLoadBalancer:
    def __init__(self, regions: List[str]):
        self.regions = regions
        self.carbon_api = "https://carbon-aware-api.azurewebsites.net"

    def get_carbon_intensities(self) -> List[Tuple[str, float]]:
        """Get current carbon intensity for all regions."""
        intensities = []

        for region in self.regions:
            response = requests.get(
                f"{self.carbon_api}/emissions/bylocation",
                params={"location": region}
            )
            data = response.json()
            intensities.append((region, data["rating"]))

        return sorted(intensities, key=lambda x: x[1])

    def get_greenest_region(self) -> str:
        """Get the region with lowest carbon intensity."""
        intensities = self.get_carbon_intensities()
        return intensities[0][0]

    def distribute_load(self, total_requests: int) -> dict:
        """Distribute load favoring greener regions."""
        intensities = self.get_carbon_intensities()

        # Inverse weighting - lower carbon gets more traffic
        total_inverse = sum(1/i[1] for i in intensities)
        distribution = {}

        for region, intensity in intensities:
            weight = (1/intensity) / total_inverse
            distribution[region] = int(total_requests * weight)

        return distribution
```

## Efficient Code Practices

### Resource-Efficient Algorithms

```python
# Memory-efficient data processing
def process_large_file_efficiently(file_path: str) -> dict:
    """Process large file with minimal memory footprint."""

    # Bad: Load entire file into memory
    # with open(file_path) as f:
    #     data = json.load(f)
    #     results = process_all(data)

    # Good: Stream processing
    results = {"count": 0, "sum": 0}

    with open(file_path) as f:
        for line in f:  # Process line by line
            record = json.loads(line)
            results["count"] += 1
            results["sum"] += record.get("value", 0)

    return results

# CPU-efficient caching
from functools import lru_cache

@lru_cache(maxsize=1000)
def expensive_computation(input_hash: str) -> dict:
    """Cache results of expensive computations."""
    # Computation only runs once per unique input
    return perform_heavy_calculation(input_hash)
```

### Efficient API Design

```csharp
// Pagination to reduce data transfer
[HttpGet("items")]
public async Task<ActionResult<PagedResult<Item>>> GetItems(
    [FromQuery] int page = 1,
    [FromQuery] int pageSize = 20,
    [FromQuery] string? fields = null)  // Field selection
{
    // Only fetch requested fields
    var query = _context.Items.AsQueryable();

    if (!string.IsNullOrEmpty(fields))
    {
        // Dynamic projection based on requested fields
        query = query.Select(BuildProjection(fields));
    }

    var totalCount = await query.CountAsync();
    var items = await query
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync();

    return new PagedResult<Item>
    {
        Items = items,
        TotalCount = totalCount,
        Page = page,
        PageSize = pageSize
    };
}

// Response compression
services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
```

## Measuring Carbon Footprint

```python
class CarbonFootprintCalculator:
    # Approximate values - actual values vary by region and time
    CARBON_INTENSITY = {
        "compute_kwh_per_hour": {
            "Standard_D2s_v3": 0.075,
            "Standard_D4s_v3": 0.15,
            "Standard_D8s_v3": 0.30,
        },
        "storage_kwh_per_gb_month": 0.001,
        "network_kwh_per_gb": 0.001,
    }

    GRID_CARBON_INTENSITY = {
        "westeurope": 300,  # gCO2/kWh
        "swedencentral": 20,
        "eastus": 400,
    }

    def calculate_vm_carbon(
        self,
        vm_size: str,
        hours: float,
        region: str
    ) -> float:
        """Calculate carbon emissions for VM usage."""
        kwh = self.CARBON_INTENSITY["compute_kwh_per_hour"][vm_size] * hours
        carbon_intensity = self.GRID_CARBON_INTENSITY[region]
        return kwh * carbon_intensity  # gCO2

    def calculate_storage_carbon(
        self,
        gb_months: float,
        region: str
    ) -> float:
        """Calculate carbon emissions for storage."""
        kwh = self.CARBON_INTENSITY["storage_kwh_per_gb_month"] * gb_months
        carbon_intensity = self.GRID_CARBON_INTENSITY[region]
        return kwh * carbon_intensity

    def generate_report(self, usage_data: dict) -> dict:
        """Generate carbon footprint report."""
        total_carbon = 0
        breakdown = {}

        for resource_type, usage in usage_data.items():
            if resource_type == "vms":
                carbon = sum(
                    self.calculate_vm_carbon(vm["size"], vm["hours"], vm["region"])
                    for vm in usage
                )
            elif resource_type == "storage":
                carbon = self.calculate_storage_carbon(
                    usage["gb_months"],
                    usage["region"]
                )

            breakdown[resource_type] = carbon
            total_carbon += carbon

        return {
            "total_carbon_grams": total_carbon,
            "total_carbon_kg": total_carbon / 1000,
            "breakdown": breakdown,
            "equivalent_car_miles": total_carbon / 400  # ~400g CO2 per mile
        }
```

## Sustainability Checklist

```yaml
sustainability_checklist:
  architecture:
    - [ ] Selected low-carbon regions where possible
    - [ ] Implemented caching to reduce compute
    - [ ] Used serverless for variable workloads
    - [ ] Optimized data storage tiers

  code:
    - [ ] Efficient algorithms implemented
    - [ ] Memory usage optimized
    - [ ] Network calls minimized
    - [ ] Response compression enabled

  operations:
    - [ ] Auto-scaling configured
    - [ ] Dev/test resources scheduled
    - [ ] Unused resources cleaned up
    - [ ] Carbon monitoring enabled

  culture:
    - [ ] Team trained on green practices
    - [ ] Sustainability in design reviews
    - [ ] Carbon metrics in dashboards
    - [ ] Green goals in OKRs
```

## Conclusion

Building sustainable software requires intentional design choices. Azure provides tools to measure and reduce carbon footprint, but the biggest impact comes from efficient architecture and code. Every optimization that reduces compute, storage, or network usage also reduces environmental impact.

## Resources

- [Green Software Foundation](https://greensoftware.foundation/)
- [Azure Sustainability](https://azure.microsoft.com/en-us/global-infrastructure/sustainability/)
- [Carbon Aware SDK](https://github.com/Green-Software-Foundation/carbon-aware-sdk)
- [Principles of Green Software](https://principles.green/)
