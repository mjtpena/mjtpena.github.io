---
title: Cost Optimization with Azure Advisor
description: "\"Where is the money going?\" is the most expensive question in cloud. Azure Advisor is the free service that answers a surprising amount of it for you.…"
author: Michael John Pena
draft: false
date: 2021-01-22
url: /blog/azure-advisor-cost-optimization/
tags:
  - Azure
  - Azure Advisor
  - Cost Optimization
  - FinOps
  - Cloud Management
---

"Where is the money going?" is the most expensive question in cloud. Azure Advisor is the free service that answers a surprising amount of it for you. Right-sizing recommendations, idle resources, reserved instance suggestions, and the small embarrassments like "you have a Premium SSD attached to a stopped VM." Today I'm focusing on the cost recommendations specifically, plus a Logic App pattern I use to auto-remediate the safe ones (deallocate dev VMs after hours, delete orphan disks) without a human in the loop.

## Understanding Azure Advisor

Azure Advisor analyzes your resource configurations and usage telemetry to provide actionable recommendations. For cost optimization, it identifies:

- Idle and underutilized resources
- Right-sizing opportunities
- Reserved Instance recommendations
- Unassociated resources (orphaned disks, IPs)

## Accessing Advisor Recommendations via API

Here is how to programmatically retrieve cost recommendations:

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.advisor import AdvisorManagementClient
import pandas as pd

credential = DefaultAzureCredential()
subscription_id = "your-subscription-id"

client = AdvisorManagementClient(credential, subscription_id)

def get_cost_recommendations():
    """
    Retrieve all cost-related recommendations from Azure Advisor.
    """
    recommendations = []

    # Filter for cost category
    for rec in client.recommendations.list(filter="Category eq 'Cost'"):
        recommendations.append({
            "id": rec.id,
            "name": rec.name,
            "resource_id": rec.resource_metadata.resource_id if rec.resource_metadata else None,
            "problem": rec.short_description.problem,
            "solution": rec.short_description.solution,
            "impact": rec.impact,
            "impacted_value": rec.extended_properties.get("annualSavingsAmount", "N/A"),
            "currency": rec.extended_properties.get("savingsCurrency", "USD"),
            "recommendation_type": rec.recommendation_type_id,
            "last_updated": rec.last_updated
        })

    return pd.DataFrame(recommendations)

# Get and display recommendations
df = get_cost_recommendations()
print(f"Total cost recommendations: {len(df)}")
print(f"\nEstimated annual savings: ${df['impacted_value'].sum():,.2f}")
print(df.to_string())
```

## Common Cost Optimization Scenarios

### 1. Virtual Machine Right-Sizing

```csharp
using Azure.ResourceManager;
using Azure.ResourceManager.Advisor;
using Azure.ResourceManager.Compute;

public class VmRightSizingService
{
    private readonly ArmClient _armClient;

    public VmRightSizingService(ArmClient armClient)
    {
        _armClient = armClient;
    }

    public async Task<List<VmRecommendation>> GetVmSizingRecommendationsAsync(
        string subscriptionId)
    {
        var recommendations = new List<VmRecommendation>();
        var subscription = _armClient.GetSubscriptionResource(
            new ResourceIdentifier($"/subscriptions/{subscriptionId}")
        );

        await foreach (var advisor in subscription.GetAdvisorRecommendations()
            .GetAllAsync(filter: "Category eq 'Cost'"))
        {
            if (advisor.Data.RecommendationTypeId ==
                "e10b1381-5f0a-47ff-8c7b-37bd13d7c974") // VM right-sizing
            {
                var extProps = advisor.Data.ExtendedProperties;

                recommendations.Add(new VmRecommendation
                {
                    VmName = extProps["vmName"],
                    CurrentSize = extProps["currentSku"],
                    RecommendedSize = extProps["targetSku"],
                    CurrentCost = decimal.Parse(extProps["currentCost"]),
                    ProjectedCost = decimal.Parse(extProps["targetCost"]),
                    AnnualSavings = decimal.Parse(extProps["annualSavingsAmount"]),
                    CpuP95 = double.Parse(extProps["cpuP95"]),
                    MemoryP95 = double.Parse(extProps["memoryP95"])
                });
            }
        }

        return recommendations;
    }

    public async Task ApplyRecommendationAsync(VmRecommendation recommendation)
    {
        // Note: This requires VM restart - implement with caution
        var vmResource = _armClient.GetVirtualMachineResource(
            new ResourceIdentifier(recommendation.ResourceId)
        );

        var vm = await vmResource.GetAsync();
        var vmData = vm.Value.Data;

        // Update the VM size
        vmData.HardwareProfile.VmSize = recommendation.RecommendedSize;

        // Deallocate first (required for size changes)
        await vmResource.DeallocateAsync(WaitUntil.Completed);

        // Update the VM
        await vmResource.UpdateAsync(WaitUntil.Completed,
            new VirtualMachinePatch { HardwareProfile = vmData.HardwareProfile });

        // Start the VM
        await vmResource.PowerOnAsync(WaitUntil.Completed);
    }
}

public class VmRecommendation
{
    public string ResourceId { get; set; }
    public string VmName { get; set; }
    public string CurrentSize { get; set; }
    public string RecommendedSize { get; set; }
    public decimal CurrentCost { get; set; }
    public decimal ProjectedCost { get; set; }
    public decimal AnnualSavings { get; set; }
    public double CpuP95 { get; set; }
    public double MemoryP95 { get; set; }
}
```

### 2. Identifying Orphaned Resources

```python
from azure.mgmt.compute import ComputeManagementClient
from azure.mgmt.network import NetworkManagementClient

def find_orphaned_disks(credential, subscription_id):
    """
    Find managed disks not attached to any VM.
    """
    compute_client = ComputeManagementClient(credential, subscription_id)

    orphaned_disks = []
    total_cost = 0

    for disk in compute_client.disks.list():
        if disk.managed_by is None and disk.disk_state == "Unattached":
            # Calculate monthly cost based on disk size and type
            monthly_cost = calculate_disk_cost(disk.disk_size_gb, disk.sku.name)
            total_cost += monthly_cost

            orphaned_disks.append({
                "name": disk.name,
                "resource_group": disk.id.split("/")[4],
                "size_gb": disk.disk_size_gb,
                "sku": disk.sku.name,
                "created": disk.time_created,
                "monthly_cost_estimate": monthly_cost
            })

    print(f"Found {len(orphaned_disks)} orphaned disks")
    print(f"Estimated monthly cost: ${total_cost:,.2f}")

    return orphaned_disks

def find_orphaned_public_ips(credential, subscription_id):
    """
    Find public IP addresses not associated with any resource.
    """
    network_client = NetworkManagementClient(credential, subscription_id)

    orphaned_ips = []

    for ip in network_client.public_ip_addresses.list_all():
        if ip.ip_configuration is None:
            orphaned_ips.append({
                "name": ip.name,
                "resource_group": ip.id.split("/")[4],
                "ip_address": ip.ip_address,
                "sku": ip.sku.name,
                "allocation_method": ip.public_ip_allocation_method
            })

    return orphaned_ips

def calculate_disk_cost(size_gb, sku_name):
    """
    Estimate monthly cost for a managed disk.
    Prices are approximate and vary by region.
    """
    price_per_gb = {
        "Standard_LRS": 0.05,
        "StandardSSD_LRS": 0.075,
        "Premium_LRS": 0.15,
        "UltraSSD_LRS": 0.25
    }
    return size_gb * price_per_gb.get(sku_name, 0.05)
```

### 3. Reserved Instance Analysis

```python
import requests
from datetime import datetime, timedelta

def analyze_ri_recommendations(credential, subscription_id):
    """
    Analyze Reserved Instance purchase recommendations.
    """
    token = credential.get_token("https://management.azure.com/.default").token

    # Get RI recommendations from Advisor
    url = f"https://management.azure.com/subscriptions/{subscription_id}/providers/Microsoft.Advisor/recommendations"
    params = {
        "api-version": "2020-01-01",
        "$filter": "Category eq 'Cost' and RecommendationTypeId eq 'reserve-vm-instances'"
    }

    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(url, params=params, headers=headers)
    recommendations = response.json().get("value", [])

    ri_analysis = []

    for rec in recommendations:
        props = rec.get("properties", {}).get("extendedProperties", {})

        ri_analysis.append({
            "vm_family": props.get("vmFamily"),
            "region": props.get("region"),
            "term": props.get("term"),
            "recommended_quantity": int(props.get("qty", 0)),
            "current_hourly_cost": float(props.get("currentHourlyCost", 0)),
            "ri_hourly_cost": float(props.get("riHourlyCost", 0)),
            "annual_savings": float(props.get("annualSavingsAmount", 0)),
            "savings_percentage": float(props.get("savingsPercent", 0))
        })

    return ri_analysis
```

## Automating Remediation with Azure Functions

Create an automated workflow to act on recommendations:

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;
using Azure.ResourceManager;
using Azure.Identity;

public class AdvisorRemediationFunction
{
    [FunctionName("ProcessAdvisorRecommendations")]
    public async Task Run(
        [TimerTrigger("0 0 6 * * 1")] TimerInfo timer, // Weekly on Monday at 6 AM
        ILogger log)
    {
        log.LogInformation("Starting Advisor recommendation processing");

        var credential = new DefaultAzureCredential();
        var armClient = new ArmClient(credential);

        var subscriptionId = Environment.GetEnvironmentVariable("SUBSCRIPTION_ID");
        var subscription = armClient.GetSubscriptionResource(
            new ResourceIdentifier($"/subscriptions/{subscriptionId}")
        );

        // Process different recommendation types
        await ProcessOrphanedDisks(subscription, log);
        await ProcessIdleResources(subscription, log);
        await GenerateCostReport(subscription, log);
    }

    private async Task ProcessOrphanedDisks(
        SubscriptionResource subscription,
        ILogger log)
    {
        var disksToDelete = new List<string>();
        var threshold = TimeSpan.FromDays(30); // Delete if unattached for 30+ days

        await foreach (var rec in subscription.GetAdvisorRecommendations()
            .GetAllAsync(filter: "Category eq 'Cost'"))
        {
            if (rec.Data.RecommendationTypeId == "orphaned-disk-recommendation")
            {
                var lastUpdated = rec.Data.LastUpdated ?? DateTime.UtcNow;

                if (DateTime.UtcNow - lastUpdated > threshold)
                {
                    // Auto-delete old orphaned disks
                    var resourceId = rec.Data.ResourceMetadata.ResourceId;

                    // First, create a snapshot for safety
                    await CreateDiskSnapshot(resourceId, log);

                    // Then delete
                    disksToDelete.Add(resourceId);
                    log.LogInformation($"Queued disk for deletion: {resourceId}");
                }
                else
                {
                    // Send notification for recent orphans
                    await SendNotification(
                        $"Orphaned disk detected: {rec.Data.ResourceMetadata.ResourceId}",
                        log
                    );
                }
            }
        }

        foreach (var diskId in disksToDelete)
        {
            // Delete with confirmation
            await DeleteOrphanedDisk(diskId, log);
        }
    }

    private async Task GenerateCostReport(
        SubscriptionResource subscription,
        ILogger log)
    {
        var report = new StringBuilder();
        report.AppendLine("# Weekly Cost Optimization Report\n");

        decimal totalPotentialSavings = 0;

        await foreach (var rec in subscription.GetAdvisorRecommendations()
            .GetAllAsync(filter: "Category eq 'Cost'"))
        {
            var savings = decimal.Parse(
                rec.Data.ExtendedProperties.GetValueOrDefault("annualSavingsAmount", "0")
            );
            totalPotentialSavings += savings;

            report.AppendLine($"## {rec.Data.ShortDescription.Problem}");
            report.AppendLine($"**Solution:** {rec.Data.ShortDescription.Solution}");
            report.AppendLine($"**Annual Savings:** ${savings:N2}");
            report.AppendLine($"**Impact:** {rec.Data.Impact}");
            report.AppendLine();
        }

        report.AppendLine($"\n## Summary");
        report.AppendLine($"**Total Potential Annual Savings:** ${totalPotentialSavings:N2}");

        // Send report via email or Teams
        await SendCostReport(report.ToString(), log);
    }
}
```

## Suppressing Recommendations

Sometimes you need to dismiss recommendations that do not apply:

```bash
# Suppress a recommendation via CLI
az advisor recommendation disable \
    --ids "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm}/providers/Microsoft.Advisor/recommendations/{rec-id}"

# Suppress for a specific duration
az advisor recommendation postpone \
    --ids "/subscriptions/{sub}/resourceGroups/{rg}/providers/..." \
    --duration 30  # days
```

## Creating Custom Alerts

Set up alerts when new high-impact recommendations appear:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "resources": [
    {
      "type": "Microsoft.Insights/activityLogAlerts",
      "apiVersion": "2020-10-01",
      "name": "HighImpactCostRecommendation",
      "location": "global",
      "properties": {
        "enabled": true,
        "scopes": [
          "[subscription().id]"
        ],
        "condition": {
          "allOf": [
            {
              "field": "category",
              "equals": "Recommendation"
            },
            {
              "field": "operationName",
              "equals": "Microsoft.Advisor/recommendations/available/action"
            },
            {
              "field": "properties.recommendationCategory",
              "equals": "Cost"
            },
            {
              "field": "properties.recommendationImpact",
              "equals": "High"
            }
          ]
        },
        "actions": {
          "actionGroups": [
            {
              "actionGroupId": "[resourceId('Microsoft.Insights/actionGroups', 'FinOpsTeam')]"
            }
          ]
        }
      }
    }
  ]
}
```

## Best Practices

1. **Review Regularly**: Schedule weekly reviews of Advisor recommendations
2. **Automate Low-Risk Actions**: Auto-delete orphaned resources after a grace period
3. **Validate Before Acting**: Always verify recommendations make sense for your workload
4. **Track Savings**: Measure actual savings after implementing recommendations
5. **Integrate with FinOps**: Use Advisor data in your cost management dashboards

Azure Advisor is a valuable tool in your FinOps toolkit. Combined with automation, it helps maintain cost efficiency as your cloud environment grows and evolves.
