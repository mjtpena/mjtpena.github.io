---
title: Azure Automation Runbooks for Infrastructure Management
author: Michael John Peña
draft: false
date: 2021-07-25
url: /blog/azure-automation-runbooks/
tags:
  - Azure
  - Automation
  - DevOps
  - PowerShell
  - Infrastructure

---

I wrote "2021-07-25-azure-automation-runbooks" to share practical, production-minded guidance on this topic.

# Creating an Automation Account

Set up Azure Automation:

```bash
# Create Automation Account
az automation account create \
    --resource-group rg-automation \
    --name automation-account-prod \
    --location eastus \
    --sku Basic

# Enable System Assigned Managed Identity
az automation account update \
    --resource-group rg-automation \
    --name automation-account-prod \
    --assign-identity

# Grant permissions to Managed Identity
IDENTITY_ID=$(az automation account show \
    --resource-group rg-automation \
    --name automation-account-prod \
    --query identity.principalId -o tsv)

az role assignment create \
    --assignee $IDENTITY_ID \
    --role "Contributor" \
    --scope /subscriptions/$SUBSCRIPTION_ID
```

# PowerShell Runbook Example

Create a runbook for VM management:

```powershell
# Runbook: Start-StopVMsByTag.ps1
<#
.SYNOPSIS
    Start or stop VMs based on tags

.DESCRIPTION
    This runbook starts or stops Azure VMs that have specific tags.
    Commonly used for cost optimization by shutting down dev/test VMs after hours.

.PARAMETER Action
    Either "Start" or "Stop"

.PARAMETER TagName
    The tag name to filter VMs

.PARAMETER TagValue
    The tag value to match
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("Start", "Stop")]
    [string]$Action,

    [Parameter(Mandatory=$true)]
    [string]$TagName,

    [Parameter(Mandatory=$true)]
    [string]$TagValue
)

# Connect using Managed Identity
try {
    Connect-AzAccount -Identity
    Write-Output "Successfully authenticated using Managed Identity"
}
catch {
    Write-Error "Failed to authenticate: $_"
    throw
}

# Get all VMs with the specified tag
$vms = Get-AzVM | Where-Object {
    $_.Tags[$TagName] -eq $TagValue
}

Write-Output "Found $($vms.Count) VMs with tag $TagName = $TagValue"

# Process each VM
$results = @()
foreach ($vm in $vms) {
    $vmName = $vm.Name
    $resourceGroup = $vm.ResourceGroupName

    Write-Output "Processing VM: $vmName in $resourceGroup"

    try {
        if ($Action -eq "Start") {
            $result = Start-AzVM -Name $vmName -ResourceGroupName $resourceGroup -NoWait
            $status = "Starting"
        }
        else {
            $result = Stop-AzVM -Name $vmName -ResourceGroupName $resourceGroup -Force -NoWait
            $status = "Stopping"
        }

        $results += [PSCustomObject]@{
            VMName = $vmName
            ResourceGroup = $resourceGroup
            Action = $Action
            Status = $status
            Success = $true
        }

        Write-Output "$Action initiated for $vmName"
    }
    catch {
        $results += [PSCustomObject]@{
            VMName = $vmName
            ResourceGroup = $resourceGroup
            Action = $Action
            Status = "Failed: $_"
            Success = $false
        }

        Write-Warning "Failed to $Action VM $vmName : $_"
    }
}

# Output summary
Write-Output "`nSummary:"
Write-Output "========="
$results | Format-Table -AutoSize

# Return results
return $results
```

# Python Runbook Example

Create a Python runbook for resource cleanup:

```python
#!/usr/bin/env python3
"""
Runbook: cleanup_unused_resources.py
Description: Clean up unused Azure resources to reduce costs
"""

import automationassets
from azure.identity import ManagedIdentityCredential
from azure.mgmt.compute import ComputeManagementClient
from azure.mgmt.network import NetworkManagementClient
from azure.mgmt.resource import ResourceManagementClient
from datetime import datetime, timedelta
import json

def get_automation_variable(name):
    """Get automation variable."""
    return automationassets.get_automation_variable(name)

def main():
    # Get subscription ID from automation variable
    subscription_id = get_automation_variable("SubscriptionId")

    # Authenticate using Managed Identity
    credential = ManagedIdentityCredential()

    # Initialize clients
    compute_client = ComputeManagementClient(credential, subscription_id)
    network_client = NetworkManagementClient(credential, subscription_id)

    cleanup_results = {
        "unattached_disks": [],
        "unused_nics": [],
        "unused_public_ips": [],
        "empty_resource_groups": []
    }

    # Find unattached managed disks
    print("Checking for unattached managed disks...")
    disks = compute_client.disks.list()
    for disk in disks:
        if disk.disk_state == "Unattached":
            # Check if disk has been unattached for more than 30 days
            if disk.time_created < datetime.now(disk.time_created.tzinfo) - timedelta(days=30):
                cleanup_results["unattached_disks"].append({
                    "name": disk.name,
                    "resource_group": disk.id.split("/")[4],
                    "size_gb": disk.disk_size_gb,
                    "created": disk.time_created.isoformat()
                })
                print(f"  Found unattached disk: {disk.name}")

    # Find unused NICs (not attached to any VM)
    print("\nChecking for unused network interfaces...")
    nics = network_client.network_interfaces.list_all()
    for nic in nics:
        if nic.virtual_machine is None:
            cleanup_results["unused_nics"].append({
                "name": nic.name,
                "resource_group": nic.id.split("/")[4],
                "location": nic.location
            })
            print(f"  Found unused NIC: {nic.name}")

    # Find unused public IPs
    print("\nChecking for unused public IPs...")
    public_ips = network_client.public_ip_addresses.list_all()
    for pip in public_ips:
        if pip.ip_configuration is None:
            cleanup_results["unused_public_ips"].append({
                "name": pip.name,
                "resource_group": pip.id.split("/")[4],
                "ip_address": pip.ip_address
            })
            print(f"  Found unused public IP: {pip.name}")

    # Generate report
    print("\n" + "="*50)
    print("CLEANUP REPORT")
    print("="*50)
    print(f"Unattached Disks: {len(cleanup_results['unattached_disks'])}")
    print(f"Unused NICs: {len(cleanup_results['unused_nics'])}")
    print(f"Unused Public IPs: {len(cleanup_results['unused_public_ips'])}")

    # Calculate potential savings
    disk_cost = len(cleanup_results['unattached_disks']) * 10  # Estimated $10/disk/month
    print(f"\nEstimated monthly savings: ${disk_cost}")

    # Output JSON for further processing
    print("\nDetailed Results:")
    print(json.dumps(cleanup_results, indent=2, default=str))

    return cleanup_results

if __name__ == "__main__":
    main()
```

# Scheduling Runbooks

Create schedules for automated execution:

```python
from azure.mgmt.automation import AutomationClient
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta

credential = DefaultAzureCredential()
automation_client = AutomationClient(credential, subscription_id)

def create_schedule(automation_account, resource_group, schedule_name, start_time, frequency, interval):
    """Create a schedule for runbook execution."""

    schedule = automation_client.schedule.create_or_update(
        resource_group_name=resource_group,
        automation_account_name=automation_account,
        schedule_name=schedule_name,
        parameters={
            "name": schedule_name,
            "properties": {
                "description": f"Schedule for {frequency} execution",
                "startTime": start_time.isoformat(),
                "frequency": frequency,
                "interval": interval,
                "timeZone": "UTC"
            }
        }
    )

    return schedule

def link_schedule_to_runbook(automation_account, resource_group, runbook_name, schedule_name, parameters=None):
    """Link a schedule to a runbook."""

    job_schedule = automation_client.job_schedule.create(
        resource_group_name=resource_group,
        automation_account_name=automation_account,
        job_schedule_id=str(uuid.uuid4()),
        parameters={
            "properties": {
                "schedule": {"name": schedule_name},
                "runbook": {"name": runbook_name},
                "parameters": parameters or {}
            }
        }
    )

    return job_schedule

# Create schedules
# Daily schedule for VM shutdown (6 PM)
create_schedule(
    "automation-account-prod",
    "rg-automation",
    "daily-6pm",
    datetime.now() + timedelta(days=1),
    "Day",
    1
)

# Link to VM stop runbook
link_schedule_to_runbook(
    "automation-account-prod",
    "rg-automation",
    "Start-StopVMsByTag",
    "daily-6pm",
    parameters={
        "Action": "Stop",
        "TagName": "AutoShutdown",
        "TagValue": "true"
    }
)

# Weekly schedule for cleanup (Sunday 2 AM)
create_schedule(
    "automation-account-prod",
    "rg-automation",
    "weekly-sunday-2am",
    datetime.now() + timedelta(days=(6 - datetime.now().weekday()) % 7),
    "Week",
    1
)

link_schedule_to_runbook(
    "automation-account-prod",
    "rg-automation",
    "cleanup_unused_resources",
    "weekly-sunday-2am"
)
```

# Webhook Triggers

Create webhooks for external triggering:

```python
def create_webhook(automation_account, resource_group, runbook_name, webhook_name, expiry_days=365):
    """Create a webhook for a runbook."""

    expiry_time = datetime.utcnow() + timedelta(days=expiry_days)

    webhook = automation_client.webhook.create_or_update(
        resource_group_name=resource_group,
        automation_account_name=automation_account,
        webhook_name=webhook_name,
        parameters={
            "name": webhook_name,
            "properties": {
                "isEnabled": True,
                "expiryTime": expiry_time.isoformat() + "Z",
                "runbook": {"name": runbook_name},
                "parameters": {}
            }
        }
    )

    # IMPORTANT: The webhook URI is only returned once at creation
    print(f"Webhook URI (save this!): {webhook.uri}")

    return webhook

# Create webhook
webhook = create_webhook(
    "automation-account-prod",
    "rg-automation",
    "Start-StopVMsByTag",
    "vm-control-webhook"
)
```

# Monitoring Runbook Jobs

Track runbook execution:

```python
def get_job_status(automation_account, resource_group, job_id):
    """Get status of a runbook job."""

    job = automation_client.job.get(
        resource_group_name=resource_group,
        automation_account_name=automation_account,
        job_name=job_id
    )

    return {
        "job_id": job.job_id,
        "runbook": job.runbook.name,
        "status": job.status,
        "start_time": job.start_time,
        "end_time": job.end_time,
        "exception": job.exception
    }

def get_recent_jobs(automation_account, resource_group, hours=24):
    """Get recent runbook jobs."""

    jobs = automation_client.job.list_by_automation_account(
        resource_group_name=resource_group,
        automation_account_name=automation_account
    )

    cutoff = datetime.utcnow() - timedelta(hours=hours)
    recent = []

    for job in jobs:
        if job.creation_time and job.creation_time > cutoff:
            recent.append({
                "job_id": job.job_id,
                "runbook": job.runbook.name if job.runbook else "Unknown",
                "status": job.status,
                "creation_time": job.creation_time
            })

    return recent

def get_job_output(automation_account, resource_group, job_id):
    """Get output streams from a job."""

    streams = automation_client.job_stream.list_by_job(
        resource_group_name=resource_group,
        automation_account_name=automation_account,
        job_name=job_id
    )

    output = []
    for stream in streams:
        output.append({
            "time": stream.time,
            "type": stream.stream_type,
            "summary": stream.summary
        })

    return output

# Check recent jobs
recent = get_recent_jobs("automation-account-prod", "rg-automation", hours=24)
print("Recent Jobs:")
for job in recent:
    print(f"  {job['runbook']}: {job['status']} ({job['creation_time']})")
```

# Error Handling and Notifications

Add robust error handling to runbooks:

```powershell
# Runbook: Robust-VMManagement.ps1

param(
    [Parameter(Mandatory=$true)]
    [string]$Action,

    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory=$true)]
    [string]$VMName
)

# Error handling setup
$ErrorActionPreference = "Stop"

# Function to send notification
function Send-Notification {
    param(
        [string]$Subject,
        [string]$Body,
        [string]$Severity = "Information"
    )

    # Get webhook URL from Automation variable
    $webhookUrl = Get-AutomationVariable -Name "TeamsWebhookUrl"

    $message = @{
        "@type" = "MessageCard"
        "@context" = "http://schema.org/extensions"
        "themeColor" = switch($Severity) {
            "Error" { "FF0000" }
            "Warning" { "FFA500" }
            default { "00FF00" }
        }
        "summary" = $Subject
        "sections" = @(
            @{
                "activityTitle" = $Subject
                "facts" = @(
                    @{ "name" = "VM"; "value" = $VMName }
                    @{ "name" = "Resource Group"; "value" = $ResourceGroupName }
                    @{ "name" = "Action"; "value" = $Action }
                    @{ "name" = "Time"; "value" = (Get-Date).ToString() }
                )
                "text" = $Body
            }
        )
    }

    try {
        Invoke-RestMethod -Uri $webhookUrl -Method Post -Body ($message | ConvertTo-Json -Depth 10) -ContentType "application/json"
    }
    catch {
        Write-Warning "Failed to send notification: $_"
    }
}

try {
    # Connect using Managed Identity
    Connect-AzAccount -Identity

    # Get VM
    $vm = Get-AzVM -ResourceGroupName $ResourceGroupName -Name $VMName -ErrorAction Stop

    if ($null -eq $vm) {
        throw "VM '$VMName' not found in resource group '$ResourceGroupName'"
    }

    # Execute action
    switch ($Action) {
        "Start" {
            Write-Output "Starting VM $VMName..."
            $result = Start-AzVM -ResourceGroupName $ResourceGroupName -Name $VMName

            if ($result.Status -eq "Succeeded") {
                Send-Notification -Subject "VM Started Successfully" -Body "The VM has been started."
                Write-Output "VM started successfully"
            }
            else {
                throw "Failed to start VM: $($result.Error)"
            }
        }
        "Stop" {
            Write-Output "Stopping VM $VMName..."
            $result = Stop-AzVM -ResourceGroupName $ResourceGroupName -Name $VMName -Force

            if ($result.Status -eq "Succeeded") {
                Send-Notification -Subject "VM Stopped Successfully" -Body "The VM has been stopped."
                Write-Output "VM stopped successfully"
            }
            else {
                throw "Failed to stop VM: $($result.Error)"
            }
        }
        "Restart" {
            Write-Output "Restarting VM $VMName..."
            $result = Restart-AzVM -ResourceGroupName $ResourceGroupName -Name $VMName

            if ($result.Status -eq "Succeeded") {
                Send-Notification -Subject "VM Restarted Successfully" -Body "The VM has been restarted."
                Write-Output "VM restarted successfully"
            }
            else {
                throw "Failed to restart VM: $($result.Error)"
            }
        }
        default {
            throw "Invalid action: $Action. Valid actions are: Start, Stop, Restart"
        }
    }
}
catch {
    $errorMessage = $_.Exception.Message
    Write-Error "Runbook failed: $errorMessage"

    Send-Notification -Subject "Runbook Failed" -Body $errorMessage -Severity "Error"

    throw
}
```

# Conclusion

Azure Automation runbooks provide a powerful way to automate repetitive tasks and operational procedures. Whether using PowerShell for Azure-native operations or Python for cross-platform scripts, runbooks enable consistent, auditable automation.

Key practices include using Managed Identities for authentication, implementing proper error handling with notifications, and scheduling runbooks for routine tasks. Combined with webhooks for external triggering, Azure Automation becomes a central hub for infrastructure management.

