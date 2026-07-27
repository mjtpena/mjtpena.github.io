---
title: Azure Update Management for Patch Compliance
author: Michael John Peña
draft: false
date: 2021-07-26
url: /blog/azure-update-management/
tags:
  - Azure
  - Automation
  - Security
  - DevOps
  - Patching

---

I wrote "2021-07-26-azure-update-management" to share practical, production-minded guidance on this topic.

# Enabling Update Management

Set up Update Management for your VMs:

```bash
# Create Log Analytics workspace (if not exists)
az monitor log-analytics workspace create \
    --resource-group rg-automation \
    --workspace-name log-analytics-updates \
    --location eastus

# Create Automation Account
az automation account create \
    --resource-group rg-automation \
    --name automation-updates \
    --location eastus

# Link Automation Account to Log Analytics
WORKSPACE_ID=$(az monitor log-analytics workspace show \
    --resource-group rg-automation \
    --workspace-name log-analytics-updates \
    --query id -o tsv)

az automation account update \
    --resource-group rg-automation \
    --name automation-updates \
    --tags "linkedWorkspace=$WORKSPACE_ID"
```

# Enabling VMs for Update Management

Onboard VMs to Update Management:

```python
from azure.mgmt.automation import AutomationClient
from azure.mgmt.compute import ComputeManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
compute_client = ComputeManagementClient(credential, subscription_id)
automation_client = AutomationClient(credential, subscription_id)

def enable_update_management_for_vm(vm_name, resource_group, workspace_id):
    """Enable Update Management for a VM by installing the necessary extensions."""

    vm = compute_client.virtual_machines.get(resource_group, vm_name)
    os_type = vm.storage_profile.os_disk.os_type

    if os_type == "Windows":
        # Install Microsoft Monitoring Agent for Windows
        extension = compute_client.virtual_machine_extensions.begin_create_or_update(
            resource_group,
            vm_name,
            "MicrosoftMonitoringAgent",
            {
                "location": vm.location,
                "publisher": "Microsoft.EnterpriseCloud.Monitoring",
                "type_properties_type": "MicrosoftMonitoringAgent",
                "type_handler_version": "1.0",
                "auto_upgrade_minor_version": True,
                "settings": {
                    "workspaceId": workspace_id
                },
                "protected_settings": {
                    "workspaceKey": workspace_key
                }
            }
        ).result()
    else:
        # Install OMS Agent for Linux
        extension = compute_client.virtual_machine_extensions.begin_create_or_update(
            resource_group,
            vm_name,
            "OmsAgentForLinux",
            {
                "location": vm.location,
                "publisher": "Microsoft.EnterpriseCloud.Monitoring",
                "type_properties_type": "OmsAgentForLinux",
                "type_handler_version": "1.13",
                "auto_upgrade_minor_version": True,
                "settings": {
                    "workspaceId": workspace_id
                },
                "protected_settings": {
                    "workspaceKey": workspace_key
                }
            }
        ).result()

    print(f"Enabled Update Management for {vm_name}")
    return extension

# Enable for all VMs in a resource group
vms = compute_client.virtual_machines.list(resource_group_name="rg-production")
for vm in vms:
    try:
        enable_update_management_for_vm(vm.name, "rg-production", workspace_id)
    except Exception as e:
        print(f"Failed to enable for {vm.name}: {e}")
```

# Creating Update Deployments

Schedule update deployments:

```python
from datetime import datetime, timedelta
import uuid

def create_update_deployment(automation_account, resource_group, deployment_config):
    """Create a software update configuration."""

    config = automation_client.software_update_configurations.create(
        resource_group_name=resource_group,
        automation_account_name=automation_account,
        software_update_configuration_name=deployment_config["name"],
        parameters={
            "properties": {
                "updateConfiguration": {
                    "operatingSystem": deployment_config["os"],
                    "windows": {
                        "includedUpdateClassifications": deployment_config.get("classifications", "Critical, Security"),
                        "excludedKbNumbers": deployment_config.get("excluded_kb", []),
                        "includedKbNumbers": deployment_config.get("included_kb", []),
                        "rebootSetting": deployment_config.get("reboot", "IfRequired")
                    } if deployment_config["os"] == "Windows" else None,
                    "linux": {
                        "includedPackageClassifications": deployment_config.get("classifications", "Critical, Security"),
                        "excludedPackageNameMasks": deployment_config.get("excluded_packages", []),
                        "includedPackageNameMasks": deployment_config.get("included_packages", []),
                        "rebootSetting": deployment_config.get("reboot", "IfRequired")
                    } if deployment_config["os"] == "Linux" else None,
                    "targets": {
                        "azureQueries": [{
                            "scope": [f"/subscriptions/{subscription_id}/resourceGroups/{rg}"
                                     for rg in deployment_config["target_resource_groups"]],
                            "tagSettings": {
                                "tags": deployment_config.get("target_tags", {}),
                                "filterOperator": "All"
                            }
                        }]
                    },
                    "duration": deployment_config.get("duration", "PT2H")
                },
                "scheduleInfo": {
                    "frequency": deployment_config["frequency"],
                    "interval": deployment_config.get("interval", 1),
                    "startTime": deployment_config["start_time"],
                    "timeZone": deployment_config.get("timezone", "UTC"),
                    "advancedSchedule": deployment_config.get("advanced_schedule")
                },
                "tasks": {
                    "preTask": deployment_config.get("pre_task"),
                    "postTask": deployment_config.get("post_task")
                }
            }
        }
    )

    return config

# Create Windows critical updates deployment
windows_critical = create_update_deployment(
    "automation-updates",
    "rg-automation",
    {
        "name": "windows-critical-weekly",
        "os": "Windows",
        "classifications": "Critical, Security",
        "target_resource_groups": ["rg-production", "rg-staging"],
        "target_tags": {"Environment": "Production"},
        "frequency": "Week",
        "interval": 1,
        "start_time": (datetime.utcnow() + timedelta(days=1)).replace(hour=2, minute=0).isoformat() + "Z",
        "timezone": "UTC",
        "advanced_schedule": {
            "weekDays": ["Saturday"]
        },
        "duration": "PT3H",
        "reboot": "IfRequired",
        "pre_task": {
            "source": "preUpdateScript",
            "parameters": {}
        },
        "post_task": {
            "source": "postUpdateScript",
            "parameters": {}
        }
    }
)

# Create Linux security updates deployment
linux_security = create_update_deployment(
    "automation-updates",
    "rg-automation",
    {
        "name": "linux-security-weekly",
        "os": "Linux",
        "classifications": "Critical, Security",
        "target_resource_groups": ["rg-production", "rg-staging"],
        "frequency": "Week",
        "interval": 1,
        "start_time": (datetime.utcnow() + timedelta(days=1)).replace(hour=3, minute=0).isoformat() + "Z",
        "advanced_schedule": {
            "weekDays": ["Sunday"]
        },
        "duration": "PT2H",
        "reboot": "IfRequired"
    }
)
```

# Pre and Post Scripts

Create maintenance scripts:

```powershell
# Pre-Update Script: pre-update-tasks.ps1
<#
.SYNOPSIS
    Pre-update maintenance tasks

.DESCRIPTION
    This script runs before updates are applied.
    - Stops non-essential services
    - Creates VM snapshot
    - Notifies stakeholders
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$SoftwareUpdateConfigurationRunId
)

# Connect using Managed Identity
Connect-AzAccount -Identity

# Get VMs in this update deployment
$context = Get-AzContext
Write-Output "Running pre-update tasks for deployment: $SoftwareUpdateConfigurationRunId"

# Function to create VM snapshot
function New-VMSnapshot {
    param([string]$VMName, [string]$ResourceGroup)

    $vm = Get-AzVM -ResourceGroupName $ResourceGroup -Name $VMName
    $osDisk = $vm.StorageProfile.OsDisk

    $snapshotConfig = New-AzSnapshotConfig `
        -SourceUri $osDisk.ManagedDisk.Id `
        -Location $vm.Location `
        -CreateOption Copy

    $snapshotName = "$VMName-pre-update-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

    $snapshot = New-AzSnapshot `
        -Snapshot $snapshotConfig `
        -SnapshotName $snapshotName `
        -ResourceGroupName $ResourceGroup

    Write-Output "Created snapshot: $snapshotName"
    return $snapshot
}

# Function to stop non-essential services
function Stop-NonEssentialServices {
    param([string]$VMName)

    # Define services to stop before patching
    $servicesToStop = @("MyAppService", "BackgroundProcessService")

    foreach ($service in $servicesToStop) {
        try {
            # Use Run Command to stop services
            $result = Invoke-AzVMRunCommand -ResourceGroupName $ResourceGroup -VMName $VMName `
                -CommandId 'RunPowerShellScript' `
                -ScriptString "Stop-Service -Name '$service' -Force -ErrorAction SilentlyContinue"

            Write-Output "Stopped service $service on $VMName"
        }
        catch {
            Write-Warning "Could not stop $service on $VMName : $_"
        }
    }
}

# Send notification
function Send-PreUpdateNotification {
    param([string]$DeploymentId)

    $webhookUrl = Get-AutomationVariable -Name "TeamsWebhookUrl"

    $body = @{
        "@type" = "MessageCard"
        "summary" = "Update Deployment Starting"
        "themeColor" = "0076D7"
        "sections" = @(
            @{
                "activityTitle" = "Pre-Update Tasks Completed"
                "facts" = @(
                    @{ "name" = "Deployment ID"; "value" = $DeploymentId }
                    @{ "name" = "Time"; "value" = (Get-Date).ToString() }
                )
            }
        )
    }

    Invoke-RestMethod -Uri $webhookUrl -Method Post -Body ($body | ConvertTo-Json -Depth 10) -ContentType "application/json"
}

# Execute pre-update tasks
try {
    # Get list of VMs (from tags or resource group)
    $vms = Get-AzVM -ResourceGroupName "rg-production" | Where-Object { $_.Tags["PatchGroup"] -eq "Group1" }

    foreach ($vm in $vms) {
        Write-Output "Processing VM: $($vm.Name)"

        # Create snapshot
        New-VMSnapshot -VMName $vm.Name -ResourceGroup $vm.ResourceGroupName

        # Stop services
        Stop-NonEssentialServices -VMName $vm.Name
    }

    # Send notification
    Send-PreUpdateNotification -DeploymentId $SoftwareUpdateConfigurationRunId

    Write-Output "Pre-update tasks completed successfully"
}
catch {
    Write-Error "Pre-update tasks failed: $_"
    throw
}
```

# Monitoring Update Compliance

Query update compliance status:

```kusto
// KQL Query: Get update compliance summary
Update
| where TimeGenerated > ago(1d)
| summarize UpdatesNeeded = countif(UpdateState == "Needed"),
            UpdatesInstalled = countif(UpdateState == "Installed"),
            UpdatesFailed = countif(UpdateState == "Failed")
            by Computer, OSType
| order by UpdatesNeeded desc

// Get missing critical updates
Update
| where TimeGenerated > ago(1d)
| where UpdateState == "Needed"
| where Classification has "Critical" or Classification has "Security"
| project Computer, Title, Classification, PublishedDate, KBID
| order by Computer, PublishedDate desc

// Update deployment history
UpdateSummary
| where TimeGenerated > ago(30d)
| project TimeGenerated, Computer, CriticalUpdatesMissing, SecurityUpdatesMissing, OtherUpdatesMissing, TotalUpdatesMissing
| order by TimeGenerated desc

// Failed updates analysis
UpdateRunProgress
| where TimeGenerated > ago(7d)
| where InstallationStatus == "Failed"
| project TimeGenerated, Computer, Title, InstallationStatus, ErrorMessage
| order by TimeGenerated desc
```

# Compliance Reporting

Generate compliance reports:

```python
from azure.monitor.query import LogsQueryClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
logs_client = LogsQueryClient(credential)

def get_compliance_report(workspace_id):
    """Generate update compliance report."""

    query = """
    Update
    | where TimeGenerated > ago(7d)
    | summarize
        TotalUpdates = count(),
        CriticalNeeded = countif(UpdateState == "Needed" and Classification has "Critical"),
        SecurityNeeded = countif(UpdateState == "Needed" and Classification has "Security"),
        OtherNeeded = countif(UpdateState == "Needed" and Classification !has "Critical" and Classification !has "Security"),
        Installed = countif(UpdateState == "Installed"),
        Failed = countif(UpdateState == "Failed")
        by Computer, OSType
    | extend ComplianceScore = round(100.0 * Installed / TotalUpdates, 2)
    | order by ComplianceScore asc
    """

    result = logs_client.query_workspace(workspace_id, query, timespan="P7D")

    report = {
        "generated_at": datetime.utcnow().isoformat(),
        "period": "7 days",
        "computers": []
    }

    for row in result.tables[0].rows:
        report["computers"].append({
            "name": row[0],
            "os_type": row[1],
            "total_updates": row[2],
            "critical_needed": row[3],
            "security_needed": row[4],
            "other_needed": row[5],
            "installed": row[6],
            "failed": row[7],
            "compliance_score": row[8]
        })

    # Calculate overall compliance
    total_computers = len(report["computers"])
    compliant = len([c for c in report["computers"] if c["critical_needed"] == 0 and c["security_needed"] == 0])
    report["overall_compliance"] = round(100.0 * compliant / total_computers, 2) if total_computers > 0 else 0

    return report

def generate_html_report(report):
    """Generate HTML compliance report."""

    html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            table {{ border-collapse: collapse; width: 100%; }}
            th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
            th {{ background-color: #4CAF50; color: white; }}
            .compliant {{ background-color: #90EE90; }}
            .non-compliant {{ background-color: #FFB6C1; }}
            .summary {{ margin-bottom: 20px; padding: 10px; background-color: #f0f0f0; }}
        </style>
    </head>
    <body>
        <h1>Update Compliance Report</h1>
        <div class="summary">
            <p><strong>Generated:</strong> {report['generated_at']}</p>
            <p><strong>Period:</strong> {report['period']}</p>
            <p><strong>Overall Compliance:</strong> {report['overall_compliance']}%</p>
        </div>
        <table>
            <tr>
                <th>Computer</th>
                <th>OS</th>
                <th>Critical</th>
                <th>Security</th>
                <th>Other</th>
                <th>Compliance</th>
            </tr>
    """

    for computer in report["computers"]:
        row_class = "compliant" if computer["critical_needed"] == 0 and computer["security_needed"] == 0 else "non-compliant"
        html += f"""
            <tr class="{row_class}">
                <td>{computer['name']}</td>
                <td>{computer['os_type']}</td>
                <td>{computer['critical_needed']}</td>
                <td>{computer['security_needed']}</td>
                <td>{computer['other_needed']}</td>
                <td>{computer['compliance_score']}%</td>
            </tr>
        """

    html += "</table></body></html>"
    return html

# Generate and save report
report = get_compliance_report(workspace_id)
html_report = generate_html_report(report)

with open("compliance_report.html", "w") as f:
    f.write(html_report)

print(f"Overall Compliance: {report['overall_compliance']}%")
```

# Conclusion

Azure Update Management simplifies patch management across hybrid environments. By automating update assessments and deployments, you maintain security compliance while minimizing operational overhead.

Key practices include creating maintenance windows that align with business requirements, using pre and post scripts for complex scenarios, and regularly reviewing compliance reports. Combined with proper testing in staging environments, Update Management helps you maintain secure, up-to-date infrastructure.

