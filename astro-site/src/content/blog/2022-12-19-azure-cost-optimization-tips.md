---
title: "Azure Cost Optimization Tips for 2023"
author: Michael John Peña
draft: false
date: 2022-12-19
tags:
  - Azure
  - Cost Optimization
  - Cloud Economics
  - Best Practices
  - FinOps
---

## Quick Wins

### 1. Stop Unused Resources

```bash
# Find and deallocate stopped VMs that are still incurring charges
az vm list --query "[?powerState!='VM running'].{Name:name, RG:resourceGroup, State:powerState}" -o table

# Deallocate to stop charges
az vm deallocate --resource-group $RG --name $VM_NAME

# Delete unused disks
az disk list --query "[?diskState=='Unattached'].{Name:name, RG:resourceGroup, Size:diskSizeGb}" -o table

# Delete unattached public IPs
az network public-ip list --query "[?ipConfiguration==null].{Name:name, RG:resourceGroup}" -o table
```

### 2. Right-Size VMs

```python
from azure.mgmt.monitor import MonitorManagementClient
from azure.mgmt.compute import ComputeManagementClient

def get_rightsizing_recommendations(subscription_id: str):
    """Analyze VMs and suggest right-sizing."""

    compute_client = ComputeManagementClient(credential, subscription_id)
    monitor_client = MonitorManagementClient(credential, subscription_id)

    recommendations = []

    for vm in compute_client.virtual_machines.list_all():
        # Get CPU metrics
        cpu_metrics = monitor_client.metrics.list(
            vm.id,
            metricnames="Percentage CPU",
            aggregation="Average",
            timespan="P7D"
        )

        avg_cpu = calculate_average(cpu_metrics)
        current_size = vm.hardware_profile.vm_size

        if avg_cpu < 20:
            recommendations.append({
                "vm": vm.name,
                "current_size": current_size,
                "avg_cpu": f"{avg_cpu:.1f}%",
                "recommendation": "Downsize or use B-series",
                "potential_savings": "40-60%"
            })

    return recommendations
```

### 3. Use Spot VMs for Fault-Tolerant Workloads

```bicep
resource spotVmss 'Microsoft.Compute/virtualMachineScaleSets@2022-03-01' = {
  name: 'spot-vmss'
  location: location
  sku: {
    name: 'Standard_D4s_v3'
    tier: 'Standard'
    capacity: 10
  }
  properties: {
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Deallocate'
      billingProfile: {
        maxPrice: -1  // Pay up to on-demand price
      }
    }
    // ... other config
  }
}
```

## Storage Optimization

### Use Appropriate Tiers

```python
# Storage tier recommendations based on access patterns
def recommend_storage_tier(
    access_frequency: str,
    retention_days: int
) -> str:
    """Recommend storage tier based on access patterns."""

    if access_frequency == "frequent":
        return "Hot"
    elif access_frequency == "monthly":
        if retention_days > 30:
            return "Cool"
        return "Hot"
    elif access_frequency == "quarterly":
        return "Cool"
    elif access_frequency == "yearly" or retention_days > 180:
        return "Archive"
    else:
        return "Cool"

# Lifecycle management policy
lifecycle_policy = {
    "rules": [
        {
            "name": "moveToCoool",
            "enabled": True,
            "type": "Lifecycle",
            "definition": {
                "filters": {"blobTypes": ["blockBlob"]},
                "actions": {
                    "baseBlob": {
                        "tierToCool": {"daysAfterModificationGreaterThan": 30},
                        "tierToArchive": {"daysAfterModificationGreaterThan": 90},
                        "delete": {"daysAfterModificationGreaterThan": 365}
                    }
                }
            }
        }
    ]
}
```

### Optimize Cosmos DB

```csharp
// Use serverless for variable workloads
var cosmosClientOptions = new CosmosClientOptions
{
    // Enable content response on write = false to reduce RU consumption
    EnableContentResponseOnWrite = false,

    // Use Direct mode for better performance
    ConnectionMode = ConnectionMode.Direct
};

// Efficient queries reduce RU consumption
var query = new QueryDefinition(
    "SELECT c.id, c.name FROM c WHERE c.partitionKey = @pk")
    .WithParameter("@pk", partitionKey);

// Use point reads when possible (1 RU vs query cost)
var response = await container.ReadItemAsync<Item>(id, new PartitionKey(pk));
```

## Reserved Instances

```python
# Analyze reservation opportunities
def analyze_reservation_savings(usage_data: dict) -> dict:
    """Calculate potential savings from reserved instances."""

    vm_usage = usage_data.get("virtual_machines", [])

    recommendations = []
    total_savings = 0

    for vm in vm_usage:
        if vm["uptime_percentage"] > 70:  # Good candidate for reservation
            current_monthly = vm["monthly_cost"]

            # Reservation savings estimates
            one_year_savings = current_monthly * 0.20 * 12
            three_year_savings = current_monthly * 0.40 * 36

            recommendations.append({
                "vm_size": vm["size"],
                "quantity": vm["count"],
                "current_monthly": current_monthly,
                "1yr_reservation_monthly": current_monthly * 0.80,
                "3yr_reservation_monthly": current_monthly * 0.60,
                "1yr_total_savings": one_year_savings,
                "3yr_total_savings": three_year_savings
            })

            total_savings += three_year_savings

    return {
        "recommendations": recommendations,
        "total_potential_savings": total_savings
    }
```

## Dev/Test Optimization

```bicep
// Use Azure Dev/Test pricing for non-production
// Requires Visual Studio subscription

// Schedule resources to stop outside business hours
resource automationAccount 'Microsoft.Automation/automationAccounts@2021-06-22' = {
  name: 'automation-account'
  location: location
  properties: {
    sku: {
      name: 'Basic'
    }
  }
}

resource stopVmsSchedule 'Microsoft.Automation/automationAccounts/schedules@2021-06-22' = {
  parent: automationAccount
  name: 'stop-dev-vms'
  properties: {
    startTime: '2023-01-01T18:00:00Z'
    expiryTime: '2024-12-31T18:00:00Z'
    interval: 1
    frequency: 'Day'
    timeZone: 'Pacific Standard Time'
  }
}

resource startVmsSchedule 'Microsoft.Automation/automationAccounts/schedules@2021-06-22' = {
  parent: automationAccount
  name: 'start-dev-vms'
  properties: {
    startTime: '2023-01-01T08:00:00Z'
    expiryTime: '2024-12-31T08:00:00Z'
    interval: 1
    frequency: 'Day'
    advancedSchedule: {
      weekDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    }
    timeZone: 'Pacific Standard Time'
  }
}
```

## Network Optimization

```yaml
# Network cost reduction strategies
network_optimization:
  reduce_egress:
    - Use CDN for static content
    - Deploy resources in same region
    - Use private endpoints instead of public
    - Compress data before transfer

  use_azure_cdn:
    benefits:
      - Reduced egress from origin
      - Better performance
      - Lower latency

  private_endpoints:
    benefits:
      - No public IP costs
      - No egress through internet
      - Better security
```

## Monitoring and Alerting

```bicep
// Set up cost alerts
resource costAlert 'Microsoft.CostManagement/alerts@2022-10-01' = {
  name: 'daily-cost-spike'
  properties: {
    definition: {
      type: 'ActualCost'
      threshold: 1000
      timeframe: 'TheLastDay'
    }
    notification: {
      contactEmails: ['finops@company.com']
      contactRoles: ['Owner']
    }
  }
}

// Anomaly detection
resource anomalyAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'cost-anomaly-detection'
  location: location
  properties: {
    enabled: true
    evaluationFrequency: 'PT1H'
    windowSize: 'PT1H'
    criteria: {
      allOf: [
        {
          query: '''
            AzureDiagnostics
            | where Category == "Costs"
            | summarize HourlyCost = sum(Cost) by bin(TimeGenerated, 1h)
            | where HourlyCost > threshold_value
          '''
          timeAggregation: 'Total'
          threshold: 0
          operator: 'GreaterThan'
        }
      ]
    }
    actions: {
      actionGroups: [costAlertActionGroup.id]
    }
  }
}
```

## Cost Optimization Checklist

```yaml
weekly:
  - [ ] Review Azure Advisor recommendations
  - [ ] Check for unused resources
  - [ ] Monitor budget alerts

monthly:
  - [ ] Review cost by resource group/tag
  - [ ] Analyze VM utilization
  - [ ] Check storage tier usage
  - [ ] Review data transfer costs

quarterly:
  - [ ] Evaluate reservation opportunities
  - [ ] Review architectural efficiency
  - [ ] Assess new Azure pricing options
  - [ ] Benchmark against targets
```

## Conclusion

Cost optimization is an ongoing practice, not a one-time project. The combination of right-sizing, reservations, storage optimization, and operational discipline can reduce Azure spend by 30-50% without impacting performance. Make it a regular part of your cloud operations.

## Resources

- [Azure Cost Management](https://docs.microsoft.com/azure/cost-management-billing/)
- [Azure Advisor](https://docs.microsoft.com/azure/advisor/)
- [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/)
- [Reserved Instance Guidance](https://docs.microsoft.com/azure/cost-management-billing/reservations/)
