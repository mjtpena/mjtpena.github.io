---
title: "A Christmas Gift: Azure Automation Scripts for the New Year"
author: Michael John Peña
draft: false
date: 2022-12-25
tags:
  - Azure
  - Automation
  - PowerShell
  - Scripts
  - Holidays
---

## The Gift: Ready-to-Use Scripts

### 1. Resource Cleanup Script

```powershell
# cleanup-unused-resources.ps1
# Find and optionally remove unused Azure resources

param(
    [Parameter(Mandatory=$true)]
    [string]$SubscriptionId,

    [Parameter(Mandatory=$false)]
    [switch]$WhatIf = $true,  # Safe by default

    [Parameter(Mandatory=$false)]
    [int]$DaysUnused = 30
)

Connect-AzAccount
Set-AzContext -SubscriptionId $SubscriptionId

$report = @()

# Find unattached disks
Write-Host "Checking for unattached disks..." -ForegroundColor Cyan
$unattachedDisks = Get-AzDisk | Where-Object {
    $_.DiskState -eq 'Unattached' -and
    $_.TimeCreated -lt (Get-Date).AddDays(-$DaysUnused)
}

foreach ($disk in $unattachedDisks) {
    $report += [PSCustomObject]@{
        ResourceType = "Disk"
        Name = $disk.Name
        ResourceGroup = $disk.ResourceGroupName
        SizeGB = $disk.DiskSizeGB
        Created = $disk.TimeCreated
        EstimatedMonthlyCost = [math]::Round($disk.DiskSizeGB * 0.05, 2)  # Rough estimate
    }

    if (-not $WhatIf) {
        Write-Host "Removing disk: $($disk.Name)" -ForegroundColor Yellow
        Remove-AzDisk -ResourceGroupName $disk.ResourceGroupName -DiskName $disk.Name -Force
    }
}

# Find unattached public IPs
Write-Host "Checking for unattached public IPs..." -ForegroundColor Cyan
$unattachedIPs = Get-AzPublicIpAddress | Where-Object {
    $_.IpConfiguration -eq $null
}

foreach ($ip in $unattachedIPs) {
    $report += [PSCustomObject]@{
        ResourceType = "PublicIP"
        Name = $ip.Name
        ResourceGroup = $ip.ResourceGroupName
        SizeGB = "N/A"
        Created = "N/A"
        EstimatedMonthlyCost = 3.65  # Static IP cost
    }

    if (-not $WhatIf) {
        Write-Host "Removing public IP: $($ip.Name)" -ForegroundColor Yellow
        Remove-AzPublicIpAddress -ResourceGroupName $ip.ResourceGroupName -Name $ip.Name -Force
    }
}

# Find stopped VMs (still incurring disk costs)
Write-Host "Checking for stopped VMs..." -ForegroundColor Cyan
$stoppedVMs = Get-AzVM -Status | Where-Object {
    $_.PowerState -eq "VM deallocated"
}

foreach ($vm in $stoppedVMs) {
    $report += [PSCustomObject]@{
        ResourceType = "StoppedVM"
        Name = $vm.Name
        ResourceGroup = $vm.ResourceGroupName
        SizeGB = "Check disks"
        Created = "N/A"
        EstimatedMonthlyCost = "Disk costs only"
    }
}

# Find empty resource groups
Write-Host "Checking for empty resource groups..." -ForegroundColor Cyan
$resourceGroups = Get-AzResourceGroup
foreach ($rg in $resourceGroups) {
    $resources = Get-AzResource -ResourceGroupName $rg.ResourceGroupName
    if ($resources.Count -eq 0) {
        $report += [PSCustomObject]@{
            ResourceType = "EmptyResourceGroup"
            Name = $rg.ResourceGroupName
            ResourceGroup = $rg.ResourceGroupName
            SizeGB = "N/A"
            Created = "N/A"
            EstimatedMonthlyCost = 0
        }

        if (-not $WhatIf) {
            Write-Host "Removing resource group: $($rg.ResourceGroupName)" -ForegroundColor Yellow
            Remove-AzResourceGroup -Name $rg.ResourceGroupName -Force
        }
    }
}

# Output report
Write-Host "`n=== Cleanup Report ===" -ForegroundColor Green
$report | Format-Table -AutoSize

$totalSavings = ($report | Where-Object { $_.EstimatedMonthlyCost -ne "N/A" -and $_.EstimatedMonthlyCost -ne "Disk costs only" } |
    Measure-Object -Property EstimatedMonthlyCost -Sum).Sum

Write-Host "`nTotal estimated monthly savings: `$$([math]::Round($totalSavings, 2))" -ForegroundColor Green

if ($WhatIf) {
    Write-Host "`nThis was a dry run. Use -WhatIf:`$false to actually remove resources." -ForegroundColor Yellow
}

# Export report
$report | Export-Csv -Path "cleanup-report-$(Get-Date -Format 'yyyyMMdd').csv" -NoTypeInformation
Write-Host "Report exported to cleanup-report-$(Get-Date -Format 'yyyyMMdd').csv"
```

### 2. Tag Compliance Checker

```powershell
# check-tag-compliance.ps1
# Audit resources for required tags

param(
    [string]$SubscriptionId,
    [string[]]$RequiredTags = @("Environment", "Owner", "CostCenter", "Application")
)

Connect-AzAccount
Set-AzContext -SubscriptionId $SubscriptionId

$nonCompliantResources = @()

$resources = Get-AzResource

foreach ($resource in $resources) {
    $missingTags = @()

    foreach ($tag in $RequiredTags) {
        if (-not $resource.Tags -or -not $resource.Tags.ContainsKey($tag)) {
            $missingTags += $tag
        }
    }

    if ($missingTags.Count -gt 0) {
        $nonCompliantResources += [PSCustomObject]@{
            Name = $resource.Name
            Type = $resource.ResourceType
            ResourceGroup = $resource.ResourceGroupName
            MissingTags = ($missingTags -join ", ")
        }
    }
}

# Report
Write-Host "`n=== Tag Compliance Report ===" -ForegroundColor Green
Write-Host "Required tags: $($RequiredTags -join ', ')"
Write-Host "Total resources checked: $($resources.Count)"
Write-Host "Non-compliant resources: $($nonCompliantResources.Count)"
Write-Host "Compliance rate: $([math]::Round((1 - $nonCompliantResources.Count / $resources.Count) * 100, 1))%`n"

$nonCompliantResources | Format-Table -AutoSize

# Export
$nonCompliantResources | Export-Csv -Path "tag-compliance-$(Get-Date -Format 'yyyyMMdd').csv" -NoTypeInformation
```

### 3. Cost Anomaly Detector

```python
# cost_anomaly_detector.py
# Detect unusual spending patterns

from azure.identity import DefaultAzureCredential
from azure.mgmt.costmanagement import CostManagementClient
from datetime import datetime, timedelta
import statistics

def detect_anomalies(subscription_id: str, threshold_std: float = 2.0):
    """Detect cost anomalies using standard deviation."""

    credential = DefaultAzureCredential()
    client = CostManagementClient(credential)
    scope = f"/subscriptions/{subscription_id}"

    # Get last 30 days of costs
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=30)

    query = {
        "type": "ActualCost",
        "timeframe": "Custom",
        "timePeriod": {
            "from": start_date.strftime("%Y-%m-%d"),
            "to": end_date.strftime("%Y-%m-%d")
        },
        "dataset": {
            "granularity": "Daily",
            "aggregation": {
                "totalCost": {"name": "Cost", "function": "Sum"}
            }
        }
    }

    result = client.query.usage(scope, query)

    # Calculate statistics
    daily_costs = [row[0] for row in result.rows]
    mean_cost = statistics.mean(daily_costs)
    std_dev = statistics.stdev(daily_costs)

    # Detect anomalies
    anomalies = []
    for i, row in enumerate(result.rows):
        cost = row[0]
        date = row[1] if len(row) > 1 else f"Day {i}"

        if abs(cost - mean_cost) > threshold_std * std_dev:
            anomalies.append({
                "date": date,
                "cost": cost,
                "deviation": (cost - mean_cost) / std_dev,
                "type": "High" if cost > mean_cost else "Low"
            })

    # Report
    print(f"\n=== Cost Anomaly Report ===")
    print(f"Period: {start_date.date()} to {end_date.date()}")
    print(f"Mean daily cost: ${mean_cost:.2f}")
    print(f"Standard deviation: ${std_dev:.2f}")
    print(f"Anomalies detected: {len(anomalies)}\n")

    for anomaly in anomalies:
        print(f"  {anomaly['date']}: ${anomaly['cost']:.2f} "
              f"({anomaly['deviation']:.1f} std dev - {anomaly['type']})")

    return anomalies

if __name__ == "__main__":
    import sys
    subscription_id = sys.argv[1] if len(sys.argv) > 1 else input("Subscription ID: ")
    detect_anomalies(subscription_id)
```

### 4. Dev/Test Scheduler

```powershell
# schedule-devtest-resources.ps1
# Start/stop dev resources on schedule

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("Start", "Stop")]
    [string]$Action,

    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupPattern,  # e.g., "*-dev-*" or "*-test-*"

    [string]$SubscriptionId
)

Connect-AzAccount
if ($SubscriptionId) {
    Set-AzContext -SubscriptionId $SubscriptionId
}

$matchingRGs = Get-AzResourceGroup | Where-Object { $_.ResourceGroupName -like $ResourceGroupPattern }

Write-Host "Found $($matchingRGs.Count) matching resource groups" -ForegroundColor Cyan

foreach ($rg in $matchingRGs) {
    Write-Host "`nProcessing: $($rg.ResourceGroupName)" -ForegroundColor Yellow

    # VMs
    $vms = Get-AzVM -ResourceGroupName $rg.ResourceGroupName

    foreach ($vm in $vms) {
        if ($Action -eq "Stop") {
            Write-Host "  Stopping VM: $($vm.Name)"
            Stop-AzVM -ResourceGroupName $rg.ResourceGroupName -Name $vm.Name -Force -NoWait
        }
        else {
            Write-Host "  Starting VM: $($vm.Name)"
            Start-AzVM -ResourceGroupName $rg.ResourceGroupName -Name $vm.Name -NoWait
        }
    }

    # AKS Clusters
    $aksClusters = Get-AzAksCluster -ResourceGroupName $rg.ResourceGroupName -ErrorAction SilentlyContinue

    foreach ($aks in $aksClusters) {
        if ($Action -eq "Stop") {
            Write-Host "  Stopping AKS: $($aks.Name)"
            Stop-AzAksCluster -ResourceGroupName $rg.ResourceGroupName -Name $aks.Name -NoWait
        }
        else {
            Write-Host "  Starting AKS: $($aks.Name)"
            Start-AzAksCluster -ResourceGroupName $rg.ResourceGroupName -Name $aks.Name -NoWait
        }
    }
}

Write-Host "`n$Action operation initiated for all matching resources" -ForegroundColor Green
```

### 5. Quick Health Check

```powershell
# quick-health-check.ps1
# Fast overview of subscription health

param([string]$SubscriptionId)

Connect-AzAccount
if ($SubscriptionId) { Set-AzContext -SubscriptionId $SubscriptionId }

Write-Host "`n=== Azure Subscription Health Check ===" -ForegroundColor Green
Write-Host "Subscription: $((Get-AzContext).Subscription.Name)`n"

# Resource counts
$resources = Get-AzResource
Write-Host "Total Resources: $($resources.Count)"
$resources | Group-Object ResourceType |
    Sort-Object Count -Descending |
    Select-Object -First 10 |
    Format-Table @{N="Resource Type";E={$_.Name}}, Count

# Advisor recommendations
Write-Host "`nAdvisor Recommendations:" -ForegroundColor Cyan
$recommendations = Get-AzAdvisorRecommendation
$recommendations | Group-Object Category | Format-Table Category, Count

# Recent activity
Write-Host "`nRecent Activity (last 24h):" -ForegroundColor Cyan
Get-AzActivityLog -StartTime (Get-Date).AddDays(-1) |
    Where-Object { $_.Status.Value -eq "Failed" } |
    Select-Object -First 5 |
    Format-Table EventTimestamp, OperationName, Status

Write-Host "`nHealth check complete!" -ForegroundColor Green
```

## Setting Up Automation

```yaml
# Schedule these scripts with Azure Automation
automation_runbooks:
  cleanup:
    schedule: "Weekly - Sunday 2am"
    script: cleanup-unused-resources.ps1
    parameters:
      WhatIf: false
      DaysUnused: 30

  tag_compliance:
    schedule: "Daily - 6am"
    script: check-tag-compliance.ps1
    alert_on: "Compliance < 95%"

  devtest_stop:
    schedule: "Weekdays - 7pm"
    script: schedule-devtest-resources.ps1
    parameters:
      Action: Stop
      ResourceGroupPattern: "*-dev-*"

  devtest_start:
    schedule: "Weekdays - 7am"
    script: schedule-devtest-resources.ps1
    parameters:
      Action: Start
      ResourceGroupPattern: "*-dev-*"
```

## Conclusion

These scripts are my gift to you for a more efficient 2023. Start with the cleanup script to reduce waste, then implement tag compliance and scheduling. Automation is the gift that keeps on giving!

Merry Christmas and happy automating!

## Resources

- [Azure PowerShell Documentation](https://docs.microsoft.com/powershell/azure/)
- [Azure Automation](https://docs.microsoft.com/azure/automation/)
- [Azure CLI](https://docs.microsoft.com/cli/azure/)
