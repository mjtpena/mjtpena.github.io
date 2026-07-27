---
title: "Cost Optimization Strategies for Azure Workloads"
author: Michael John Pena
draft: false
date: 2021-12-17
tags:
  - Cost Optimization
  - Azure
  - FinOps
  - Cloud Economics
  - Best Practices

---

I wrote "Cost Optimization Strategies for Azure Workloads" to share practical, production-minded guidance on this topic.

## Understanding Your Costs

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.costmanagement import CostManagementClient
from datetime import datetime, timedelta
import pandas as pd

class CostAnalyzer:
    def __init__(self, subscription_id: str):
        self.credential = DefaultAzureCredential()
        self.client = CostManagementClient(self.credential)
        self.scope = f"/subscriptions/{subscription_id}"

    def get_cost_by_service(self, days: int = 30) -> pd.DataFrame:
        """Get costs grouped by service"""
        query = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "timePeriod": {
                "from": (datetime.utcnow() - timedelta(days=days)).isoformat(),
                "to": datetime.utcnow().isoformat()
            },
            "dataset": {
                "granularity": "Daily",
                "aggregation": {
                    "totalCost": {
                        "name": "Cost",
                        "function": "Sum"
                    }
                },
                "grouping": [
                    {"type": "Dimension", "name": "ServiceName"},
                    {"type": "Dimension", "name": "ResourceGroup"}
                ]
            }
        }

        result = self.client.query.usage(scope=self.scope, parameters=query)

        # Convert to DataFrame
        columns = [col.name for col in result.columns]
        data = [row for row in result.rows]

        return pd.DataFrame(data, columns=columns)

    def identify_waste(self) -> dict:
        """Identify potential cost waste"""
        waste = {
            "unattached_disks": self._find_unattached_disks(),
            "idle_vms": self._find_idle_vms(),
            "oversized_resources": self._find_oversized_resources(),
            "unused_public_ips": self._find_unused_public_ips()
        }

        return waste

    def _find_unattached_disks(self) -> list:
        from azure.mgmt.compute import ComputeManagementClient
        compute_client = ComputeManagementClient(self.credential, self.subscription_id)

        unattached = []
        for disk in compute_client.disks.list():
            if disk.disk_state == "Unattached":
                unattached.append({
                    "name": disk.name,
                    "size_gb": disk.disk_size_gb,
                    "sku": disk.sku.name,
                    "estimated_monthly_cost": self._estimate_disk_cost(disk)
                })

        return unattached

    def _find_idle_vms(self) -> list:
        """Find VMs with low CPU utilization"""
        from azure.mgmt.monitor import MonitorManagementClient
        monitor_client = MonitorManagementClient(self.credential, self.subscription_id)

        idle_vms = []
        # Query metrics for each VM
        # VMs with < 5% avg CPU over 7 days are candidates
        return idle_vms

# Usage
analyzer = CostAnalyzer("your-subscription-id")
costs = analyzer.get_cost_by_service(30)
waste = analyzer.identify_waste()

print(f"Total potential savings: ${sum(w['estimated_monthly_cost'] for w in waste['unattached_disks']):.2f}/month from unattached disks")
```

## Right-Sizing Recommendations

```python
from azure.mgmt.advisor import AdvisorManagementClient

def get_rightsizing_recommendations(subscription_id: str):
    """Get Azure Advisor right-sizing recommendations"""
    credential = DefaultAzureCredential()
    advisor_client = AdvisorManagementClient(credential, subscription_id)

    recommendations = []
    for rec in advisor_client.recommendations.list():
        if rec.category == "Cost" and "right-size" in rec.short_description.solution.lower():
            recommendations.append({
                "resource_id": rec.resource_metadata.resource_id,
                "current_sku": rec.extended_properties.get("currentSku"),
                "recommended_sku": rec.extended_properties.get("targetSku"),
                "annual_savings": rec.extended_properties.get("annualSavingsAmount"),
                "impact": rec.impact
            })

    return sorted(recommendations, key=lambda x: x["annual_savings"] or 0, reverse=True)

# Implement right-sizing
def apply_rightsizing(resource_id: str, new_sku: str, dry_run: bool = True):
    """Apply right-sizing recommendation"""
    if dry_run:
        print(f"Would resize {resource_id} to {new_sku}")
        return

    # Parse resource ID
    parts = resource_id.split("/")
    resource_group = parts[parts.index("resourceGroups") + 1]
    resource_type = parts[-2]
    resource_name = parts[-1]

    if resource_type == "virtualMachines":
        from azure.mgmt.compute import ComputeManagementClient
        compute = ComputeManagementClient(credential, subscription_id)

        # Deallocate VM
        compute.virtual_machines.begin_deallocate(resource_group, resource_name).wait()

        # Update size
        vm = compute.virtual_machines.get(resource_group, resource_name)
        vm.hardware_profile.vm_size = new_sku
        compute.virtual_machines.begin_create_or_update(resource_group, resource_name, vm).wait()

        # Start VM
        compute.virtual_machines.begin_start(resource_group, resource_name).wait()
```

## Reserved Instances Strategy

```python
def analyze_reservation_opportunity(subscription_id: str, resource_type: str):
    """Analyze opportunity for reserved instances"""
    from azure.mgmt.reservations import AzureReservationAPI

    credential = DefaultAzureCredential()
    reservation_client = AzureReservationAPI(credential)

    # Get current usage
    cost_client = CostManagementClient(credential)

    usage_query = {
        "type": "ActualCost",
        "timeframe": "MonthToDate",
        "dataset": {
            "granularity": "Daily",
            "aggregation": {
                "totalCost": {"name": "Cost", "function": "Sum"},
                "usageQuantity": {"name": "UsageQuantity", "function": "Sum"}
            },
            "filter": {
                "dimensions": {
                    "name": "MeterCategory",
                    "operator": "In",
                    "values": [resource_type]
                }
            },
            "grouping": [
                {"type": "Dimension", "name": "MeterSubCategory"},
                {"type": "Dimension", "name": "MeterName"}
            ]
        }
    }

    # Calculate potential savings
    # 1-year RI: ~30-40% savings
    # 3-year RI: ~50-60% savings

    return {
        "resource_type": resource_type,
        "current_monthly_spend": current_spend,
        "recommended_ri_quantity": recommended_quantity,
        "1_year_ri_savings": current_spend * 0.35,
        "3_year_ri_savings": current_spend * 0.55,
        "break_even_months": 7  # Typical break-even for 1-year RI
    }
```

## Automated Shutdown Policies

```bicep
// Auto-shutdown for dev/test VMs
resource autoShutdown 'Microsoft.DevTestLab/schedules@2018-09-15' = {
  name: 'shutdown-computevm-${vmName}'
  location: resourceGroup().location
  properties: {
    status: 'Enabled'
    taskType: 'ComputeVmShutdownTask'
    dailyRecurrence: {
      time: '1900'  // 7 PM
    }
    timeZoneId: 'AUS Eastern Standard Time'
    targetResourceId: vm.id
    notificationSettings: {
      status: 'Enabled'
      timeInMinutes: 30
      emailRecipient: 'team@company.com'
      notificationLocale: 'en'
    }
  }
}

// Start VMs on schedule using Automation
resource startSchedule 'Microsoft.Automation/automationAccounts/schedules@2020-01-13-preview' = {
  parent: automationAccount
  name: 'start-dev-vms'
  properties: {
    startTime: '2021-12-17T07:00:00+11:00'
    frequency: 'Day'
    interval: 1
    timeZone: 'AUS Eastern Standard Time'
  }
}

resource startRunbook 'Microsoft.Automation/automationAccounts/runbooks@2019-06-01' = {
  parent: automationAccount
  name: 'Start-DevVMs'
  location: resourceGroup().location
  properties: {
    runbookType: 'PowerShell'
    publishContentLink: {
      uri: 'https://raw.githubusercontent.com/company/automation/main/Start-DevVMs.ps1'
    }
  }
}
```

```powershell
# Start-DevVMs.ps1
param(
    [string]$ResourceGroupName = "dev-resources",
    [string]$TagName = "AutoStart",
    [string]$TagValue = "true"
)

Connect-AzAccount -Identity

$vms = Get-AzVM -ResourceGroupName $ResourceGroupName |
    Where-Object { $_.Tags[$TagName] -eq $TagValue }

foreach ($vm in $vms) {
    $status = (Get-AzVM -ResourceGroupName $vm.ResourceGroupName -Name $vm.Name -Status).Statuses |
        Where-Object { $_.Code -like "PowerState/*" }

    if ($status.Code -eq "PowerState/deallocated") {
        Write-Output "Starting VM: $($vm.Name)"
        Start-AzVM -ResourceGroupName $vm.ResourceGroupName -Name $vm.Name -NoWait
    }
}
```

## Storage Tier Optimization

```python
from azure.storage.blob import BlobServiceClient
from datetime import datetime, timedelta

def optimize_storage_tiers(storage_account_url: str, container_name: str):
    """Move blobs to appropriate tiers based on access patterns"""

    credential = DefaultAzureCredential()
    blob_service = BlobServiceClient(storage_account_url, credential)
    container = blob_service.get_container_client(container_name)

    tier_changes = []

    for blob in container.list_blobs(include=['metadata']):
        # Get last access time
        last_accessed = blob.last_accessed_on or blob.last_modified
        days_since_access = (datetime.utcnow() - last_accessed.replace(tzinfo=None)).days

        current_tier = blob.blob_tier

        # Determine optimal tier
        if days_since_access > 180 and current_tier != "Archive":
            new_tier = "Archive"
        elif days_since_access > 30 and current_tier == "Hot":
            new_tier = "Cool"
        elif days_since_access <= 7 and current_tier in ["Cool", "Archive"]:
            new_tier = "Hot"
        else:
            continue

        tier_changes.append({
            "blob_name": blob.name,
            "current_tier": current_tier,
            "recommended_tier": new_tier,
            "days_since_access": days_since_access,
            "size_bytes": blob.size
        })

    return tier_changes

def apply_tier_changes(storage_account_url: str, container_name: str, changes: list):
    """Apply storage tier changes"""
    credential = DefaultAzureCredential()
    blob_service = BlobServiceClient(storage_account_url, credential)
    container = blob_service.get_container_client(container_name)

    for change in changes:
        blob_client = container.get_blob_client(change["blob_name"])
        blob_client.set_standard_blob_tier(change["recommended_tier"])
        print(f"Moved {change['blob_name']} from {change['current_tier']} to {change['recommended_tier']}")
```

## Cost Alerts and Budgets

```bicep
// Create budget with alerts
resource budget 'Microsoft.Consumption/budgets@2021-10-01' = {
  name: 'monthly-budget'
  properties: {
    category: 'Cost'
    amount: 10000
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '2021-12-01'
      endDate: '2022-12-31'
    }
    filter: {
      dimensions: {
        name: 'ResourceGroupName'
        operator: 'In'
        values: [
          'production-rg'
          'staging-rg'
        ]
      }
    }
    notifications: {
      actual80Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: [
          'finops@company.com'
        ]
        thresholdType: 'Actual'
      }
      actual100Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: [
          'finops@company.com'
          'engineering-leads@company.com'
        ]
        contactRoles: [
          'Owner'
        ]
        thresholdType: 'Actual'
      }
      forecasted110Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 110
        contactEmails: [
          'finops@company.com'
        ]
        thresholdType: 'Forecasted'
      }
    }
  }
}
```

## Cost Optimization Checklist

| Category | Action | Typical Savings |
|----------|--------|-----------------|
| Compute | Right-size VMs | 20-40% |
| Compute | Reserved Instances | 30-60% |
| Compute | Spot VMs for batch | 60-90% |
| Storage | Lifecycle policies | 30-50% |
| Storage | Reserved capacity | 20-30% |
| Network | Remove unused IPs | 100% of waste |
| Database | Right-size DTUs/vCores | 20-40% |
| Dev/Test | Auto-shutdown | 50-70% |

## Key Principles

1. **Visibility First**: You can't optimize what you can't see
2. **Continuous Optimization**: Not a one-time exercise
3. **Shared Responsibility**: Engineers must understand cost impact
4. **Automate Policies**: Manual processes don't scale
5. **Balance Cost and Performance**: Cheapest isn't always best

Cost optimization in 2021 became a core cloud competency. The tools are powerful; success requires discipline and cultural change.

## Resources

- [Azure Cost Management](https://docs.microsoft.com/en-us/azure/cost-management-billing/)
- [Azure Advisor](https://docs.microsoft.com/en-us/azure/advisor/)
- [FinOps Foundation](https://www.finops.org/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
