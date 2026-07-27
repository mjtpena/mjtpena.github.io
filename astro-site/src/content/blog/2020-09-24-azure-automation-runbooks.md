---
title: "Azure Automation Runbooks for Cloud Operations"
author: Michael John Peña
draft: false
date: 2020-09-24
tags:
  - Azure
  - Automation
  - DevOps
  - PowerShell
---

Every cloud team eventually accumulates a folder full of "scripts I run monthly" — clean up old resource groups, rotate certificates, scale down dev environments at 6pm. Azure Automation is where those scripts go to live a slightly more dignified life: scheduled, logged, with managed identity instead of a service principal whose secret expired six months ago. Not glamorous, very useful.

## Creating a Runbook

```powershell
# Start-StoppedVMs.ps1
param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory=$false)]
    [string]$TagName = "AutoStart",

    [Parameter(Mandatory=$false)]
    [string]$TagValue = "true"
)

# Connect using managed identity
Connect-AzAccount -Identity

# Get VMs with auto-start tag
$vms = Get-AzVM -ResourceGroupName $ResourceGroupName |
    Where-Object { $_.Tags[$TagName] -eq $TagValue }

foreach ($vm in $vms) {
    $status = (Get-AzVM -ResourceGroupName $ResourceGroupName -Name $vm.Name -Status).Statuses |
        Where-Object { $_.Code -like "PowerState/*" }

    if ($status.Code -eq "PowerState/deallocated") {
        Write-Output "Starting VM: $($vm.Name)"
        Start-AzVM -ResourceGroupName $ResourceGroupName -Name $vm.Name
    }
}
```

## Scheduling

```powershell
# Create schedule
$schedule = New-AzAutomationSchedule `
    -AutomationAccountName "myAutomation" `
    -ResourceGroupName "automation-rg" `
    -Name "DailyStart" `
    -StartTime "2020-09-25T07:00:00" `
    -TimeZone "AUS Eastern Standard Time" `
    -DayInterval 1

# Link to runbook
Register-AzAutomationScheduledRunbook `
    -AutomationAccountName "myAutomation" `
    -ResourceGroupName "automation-rg" `
    -RunbookName "Start-StoppedVMs" `
    -ScheduleName "DailyStart" `
    -Parameters @{ResourceGroupName = "production-rg"}
```

## Webhook Trigger

```powershell
# Create webhook
$webhook = New-AzAutomationWebhook `
    -AutomationAccountName "myAutomation" `
    -ResourceGroupName "automation-rg" `
    -RunbookName "Process-Alert" `
    -Name "AlertWebhook" `
    -IsEnabled $true `
    -ExpiryTime (Get-Date).AddYears(1)

# Webhook URL (save this - shown only once)
$webhook.WebhookURI

# Call from external system
Invoke-RestMethod -Uri $webhookUri -Method POST -Body $alertData
```

## Common Use Cases

1. **VM Start/Stop** - Cost savings after hours
2. **Certificate Rotation** - Auto-renew before expiry
3. **Backup Verification** - Test restores regularly
4. **Resource Cleanup** - Delete orphaned resources
5. **Alert Response** - Auto-remediate common issues

Azure Automation is the workhorse of cloud operations.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
