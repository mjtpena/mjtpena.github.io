---
title: "Enabling Remote Work with Azure Virtual Desktop"
author: Michael John Peña
draft: false
date: 2020-08-16
tags:
  - Azure
  - Virtual Desktop
  - Remote Work
  - COVID-19
---

In the first six months of the pandemic, "we need everyone working from home by Monday" became a sentence I heard from clients more times than I can count. For organisations with legacy Windows applications, custom line-of-business tools, or strict data-residency requirements, you can't just hand out laptops. AVD (still Windows Virtual Desktop in some docs at the time of writing) lets you deliver a managed Windows session from Azure to whatever device the user has at home. The setup is more involved than people expect, so here's what an actual production deployment looks like.

## Why Azure Virtual Desktop?

- **Rapid deployment** - Get employees working remotely quickly
- **Security** - Data stays in the cloud, not on personal devices
- **Scalability** - Add or remove users as needed
- **Cost efficiency** - Pay only for what you use
- **Multi-session Windows 10** - Unique to Azure

## Prerequisites

- Azure AD tenant
- Azure subscription
- Azure AD Domain Services or Active Directory
- Proper licensing (Microsoft 365 or Windows 10 Enterprise)

## Setting Up the Infrastructure

### Create the Host Pool

```bash
# Create resource group
az group create \
    --name rg-avd \
    --location australiaeast

# Create host pool
az desktopvirtualization hostpool create \
    --name hp-general \
    --resource-group rg-avd \
    --location australiaeast \
    --host-pool-type Pooled \
    --load-balancer-type BreadthFirst \
    --preferred-app-group-type Desktop \
    --max-session-limit 10 \
    --registration-info expiration-time="2020-08-30T00:00:00Z" registration-token-operation="Update"
```

### Create Application Group

```bash
# Create desktop application group
az desktopvirtualization applicationgroup create \
    --name ag-desktop \
    --resource-group rg-avd \
    --location australiaeast \
    --host-pool-arm-path "/subscriptions/{sub}/resourceGroups/rg-avd/providers/Microsoft.DesktopVirtualization/hostpools/hp-general" \
    --application-group-type Desktop
```

### Create Workspace

```bash
# Create workspace
az desktopvirtualization workspace create \
    --name ws-corporate \
    --resource-group rg-avd \
    --location australiaeast \
    --application-group-references "/subscriptions/{sub}/resourceGroups/rg-avd/providers/Microsoft.DesktopVirtualization/applicationgroups/ag-desktop"
```

## Deploying Session Hosts

Use an ARM template for session hosts:

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "vmNamePrefix": {
            "type": "string",
            "defaultValue": "avd-host"
        },
        "vmCount": {
            "type": "int",
            "defaultValue": 2
        },
        "vmSize": {
            "type": "string",
            "defaultValue": "Standard_D4s_v3"
        }
    },
    "resources": [
        {
            "type": "Microsoft.Compute/virtualMachines",
            "apiVersion": "2020-06-01",
            "name": "[concat(parameters('vmNamePrefix'), '-', copyIndex())]",
            "location": "[resourceGroup().location]",
            "copy": {
                "name": "vmCopy",
                "count": "[parameters('vmCount')]"
            },
            "properties": {
                "hardwareProfile": {
                    "vmSize": "[parameters('vmSize')]"
                },
                "storageProfile": {
                    "imageReference": {
                        "publisher": "MicrosoftWindowsDesktop",
                        "offer": "office-365",
                        "sku": "20h1-evd-o365pp",
                        "version": "latest"
                    },
                    "osDisk": {
                        "createOption": "FromImage",
                        "managedDisk": {
                            "storageAccountType": "Premium_LRS"
                        }
                    }
                }
            }
        }
    ]
}
```

## User Assignment

Assign users via Azure CLI:

```bash
# Get the application group resource ID
appGroupId=$(az desktopvirtualization applicationgroup show \
    --name ag-desktop \
    --resource-group rg-avd \
    --query id -o tsv)

# Assign users or groups
az role assignment create \
    --assignee "user@contoso.com" \
    --role "Desktop Virtualization User" \
    --scope $appGroupId
```

## FSLogix Profile Containers

Configure profile management for better performance:

```powershell
# On each session host
# Install FSLogix
# Configure registry settings

$regPath = "HKLM:\SOFTWARE\FSLogix\Profiles"
New-Item -Path $regPath -Force
Set-ItemProperty -Path $regPath -Name "Enabled" -Value 1
Set-ItemProperty -Path $regPath -Name "VHDLocations" -Value "\\storageaccount.file.core.windows.net\profiles"
Set-ItemProperty -Path $regPath -Name "DeleteLocalProfileWhenVHDShouldApply" -Value 1
Set-ItemProperty -Path $regPath -Name "FlipFlopProfileDirectoryName" -Value 1
```

## Azure Files for Profiles

```bash
# Create storage account for profiles
az storage account create \
    --name stavdprofiles2020 \
    --resource-group rg-avd \
    --location australiaeast \
    --sku Premium_LRS \
    --kind FileStorage

# Create file share
az storage share create \
    --name profiles \
    --account-name stavdprofiles2020 \
    --quota 100

# Enable AD authentication
az storage account update \
    --name stavdprofiles2020 \
    --enable-files-aadds true
```

## Scaling Automation

Create an automation account for scaling:

```powershell
# Scaling logic example
param(
    [Parameter(Mandatory=$true)]
    [string]$HostPoolName,
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    [int]$MinimumHosts = 2,
    [int]$SessionThreshold = 5
)

# Get current session count
$hostPool = Get-AzWvdHostPool -Name $HostPoolName -ResourceGroupName $ResourceGroupName
$sessions = Get-AzWvdUserSession -HostPoolName $HostPoolName -ResourceGroupName $ResourceGroupName

$sessionCount = $sessions.Count
$runningHosts = (Get-AzWvdSessionHost -HostPoolName $HostPoolName -ResourceGroupName $ResourceGroupName | Where-Object { $_.Status -eq "Available" }).Count

$sessionsPerHost = $sessionCount / [Math]::Max($runningHosts, 1)

if ($sessionsPerHost -gt $SessionThreshold) {
    # Scale up - start more hosts
    Write-Output "Scaling up: Sessions per host ($sessionsPerHost) exceeds threshold ($SessionThreshold)"
}
elseif ($runningHosts -gt $MinimumHosts -and $sessionsPerHost -lt ($SessionThreshold / 2)) {
    # Scale down - stop excess hosts
    Write-Output "Scaling down: Low utilization detected"
}
```

## Monitoring

```bash
# Enable diagnostics
az monitor diagnostic-settings create \
    --name avd-diagnostics \
    --resource "/subscriptions/{sub}/resourceGroups/rg-avd/providers/Microsoft.DesktopVirtualization/hostpools/hp-general" \
    --workspace "/subscriptions/{sub}/resourceGroups/rg-monitoring/providers/microsoft.operationalinsights/workspaces/la-avd" \
    --logs '[{"category":"Checkpoint","enabled":true},{"category":"Error","enabled":true},{"category":"Management","enabled":true},{"category":"Connection","enabled":true}]'
```

The cost mistake I see most often: leaving session hosts running 24/7 because nobody set up scaling plans. AVD is one of the few Azure services where careful auto-scale (start hosts on weekday morning, drain and stop on evening) genuinely halves the bill. Build the scaling plan on day one, not after the first invoice arrives.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
