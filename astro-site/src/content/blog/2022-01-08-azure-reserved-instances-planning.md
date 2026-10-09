---
title: "Azure Reserved Instances Planning: Strategic Cost Reduction"
description: "RIs provide a billing discount in exchange for a commitment (1 or 3 years). They don't allocate capacity - they provide a discount on capacity you're…"
author: Michael John Peña
draft: false
date: 2022-01-08
url: /blog/azure-reserved-instances-planning/
tags:
  - Azure
  - cost-optimization
  - reserved-instances
  - FinOps
---

## Understanding Reserved Instances

RIs provide a billing discount in exchange for a commitment (1 or 3 years). They don't allocate capacity - they provide a discount on capacity you're already using.

## Analyzing Your Usage

Before purchasing RIs, analyze your current usage:

```kusto
// Azure Resource Graph query - VM usage analysis
Resources
| where type == "microsoft.compute/virtualmachines"
| extend vmSize = properties.hardwareProfile.vmSize
| summarize Count = count() by tostring(vmSize), location
| order by Count desc
```

Use Cost Management to identify stable workloads:

```powershell
# Get VM utilization for the past 90 days
$vms = Get-AzVM
$metrics = @()

foreach ($vm in $vms) {
    $cpuMetric = Get-AzMetric -ResourceId $vm.Id `
        -MetricName "Percentage CPU" `
        -TimeGrain 01:00:00 `
        -StartTime (Get-Date).AddDays(-90) `
        -AggregationType Average

    $avgCpu = ($cpuMetric.Data | Measure-Object -Property Average -Average).Average

    $metrics += [PSCustomObject]@{
        VMName = $vm.Name
        Size = $vm.HardwareProfile.VmSize
        Location = $vm.Location
        AvgCPU = [math]::Round($avgCpu, 2)
        Candidate = if ($avgCpu -gt 20) { "Good" } else { "Review" }
    }
}

$metrics | Sort-Object AvgCPU -Descending | Format-Table
```

## Reservation Recommendations API

Use Azure's recommendations:

```python
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://management.azure.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

# Get reservation recommendations
subscription_id = "your-subscription-id"
url = f"https://management.azure.com/subscriptions/{subscription_id}/providers/Microsoft.Consumption/reservationRecommendations?api-version=2021-10-01"

params = {
    "$filter": "properties/scope eq 'Single' and properties/lookBackPeriod eq 'Last30Days'"
}

response = requests.get(url, headers=headers, params=params)
recommendations = response.json()

for rec in recommendations.get("value", []):
    props = rec["properties"]
    print(f"SKU: {props['skuProperties'][0]['value']}")
    print(f"Recommended Quantity: {props['recommendedQuantity']}")
    print(f"Net Savings: ${props['netSavings']:.2f}")
    print(f"Total Cost With RI: ${props['totalCostWithReservedInstances']:.2f}")
    print("---")
```

## Instance Size Flexibility

Use instance size flexibility for better coverage:

```bicep
// Reservations apply to the same VM family
// A D4s_v3 reservation covers:
// - 1x D4s_v3
// - 2x D2s_v3
// - 0.5x D8s_v3

// Example: If you have mixed sizes
var vmSizes = {
  'Standard_D2s_v3': 4   // 4 VMs = 2 RI units
  'Standard_D4s_v3': 2   // 2 VMs = 2 RI units
  'Standard_D8s_v3': 1   // 1 VM = 2 RI units
}
// Total needed: 6 RI units of D4s_v3 equivalent
```

## Hybrid Approach: RIs + Spot + Pay-As-You-Go

```bicep
// Production baseline - Reserved
resource prodVMSS 'Microsoft.Compute/virtualMachineScaleSets@2021-11-01' = {
  name: 'prod-vmss'
  properties: {
    virtualMachineProfile: {
      priority: 'Regular'  // Covered by RIs
    }
    sku: {
      capacity: 5  // Stable baseline
    }
  }
}

// Burst capacity - Spot
resource spotVMSS 'Microsoft.Compute/virtualMachineScaleSets@2021-11-01' = {
  name: 'spot-vmss'
  properties: {
    virtualMachineProfile: {
      priority: 'Spot'
    }
    sku: {
      capacity: 10  // Variable burst
    }
  }
}

// Peak overflow - Pay-as-you-go (no commitment needed)
// Handled by autoscale rules
```

## Monitoring RI Utilization

```kusto
// Monitor reservation utilization
AzureActivity
| where CategoryValue == "Administrative"
| where OperationNameValue contains "reservation"
| summarize count() by bin(TimeGenerated, 1d), OperationNameValue
```

## RI Purchase Checklist

1. **Analyze 90+ days of usage** - Ensure workloads are stable
2. **Consider instance flexibility** - Buy at the right VM family level
3. **Start with 1-year terms** - Lower risk for first purchases
4. **Use shared scope** - Maximize utilization across subscriptions
5. **Review monthly** - Ensure utilization stays high
6. **Plan for changes** - RIs can be exchanged if needs change

Reserved Instances are a powerful tool for cost optimization, but they require careful planning to maximize value.
