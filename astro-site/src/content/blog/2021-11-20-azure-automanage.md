---
title: "Azure Automanage: Automated VM Management Best Practices"
author: Michael John Pena
draft: false
date: 2021-11-20
tags:
  - Azure
  - Automation
  - Virtual Machines
  - Management
  - Best Practices

---

I wrote "Azure Automanage: Automated VM Management Best Practices" to share practical, production-minded guidance on this topic.

## What is Azure Automanage?

Automanage provides automated:

- **Configuration**: Apply Microsoft best practices automatically
- **Updates**: Windows Update and Azure Update Management
- **Backup**: Azure Backup configuration
- **Monitoring**: Azure Monitor and diagnostics
- **Security**: Microsoft Defender for Cloud

## Enabling Automanage

### Azure Portal / CLI

```bash
# Enable Automanage for a VM
az automanage configuration-profile-assignment create \
    --resource-group rg-vms \
    --vm-name vm-web-01 \
    --configuration-profile Production

# Enable for multiple VMs
vms=("vm-web-01" "vm-web-02" "vm-app-01")
for vm in "${vms[@]}"; do
    az automanage configuration-profile-assignment create \
        --resource-group rg-vms \
        --vm-name $vm \
        --configuration-profile Production
done

# Check status
az automanage configuration-profile-assignment show \
    --resource-group rg-vms \
    --vm-name vm-web-01
```

### Bicep Template

```bicep
param vmName string
param location string = resourceGroup().location
param profile string = 'Production'

resource vm 'Microsoft.Compute/virtualMachines@2021-07-01' existing = {
  name: vmName
}

resource automanageAssignment 'Microsoft.Automanage/configurationProfileAssignments@2021-04-30-preview' = {
  name: 'default'
  scope: vm
  properties: {
    configurationProfile: '/providers/Microsoft.Automanage/bestPractices/${profile}'
  }
}
```

### At Scale with Azure Policy

```json
{
  "mode": "Indexed",
  "policyRule": {
    "if": {
      "allOf": [
        {
          "field": "type",
          "equals": "Microsoft.Compute/virtualMachines"
        },
        {
          "field": "tags.Environment",
          "equals": "Production"
        },
        {
          "anyOf": [
            {
              "field": "Microsoft.Compute/virtualMachines/storageProfile.imageReference.offer",
              "like": "WindowsServer*"
            },
            {
              "field": "Microsoft.Compute/virtualMachines/storageProfile.imageReference.offer",
              "like": "*-LTS"
            }
          ]
        }
      ]
    },
    "then": {
      "effect": "deployIfNotExists",
      "details": {
        "type": "Microsoft.Automanage/configurationProfileAssignments",
        "name": "default",
        "existenceCondition": {
          "field": "Microsoft.Automanage/configurationProfileAssignments/configurationProfile",
          "equals": "/providers/Microsoft.Automanage/bestPractices/AzureBestPracticesProduction"
        },
        "roleDefinitionIds": [
          "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c"
        ],
        "deployment": {
          "properties": {
            "mode": "incremental",
            "template": {
              "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
              "contentVersion": "1.0.0.0",
              "parameters": {
                "vmName": {
                  "type": "string"
                },
                "location": {
                  "type": "string"
                }
              },
              "resources": [
                {
                  "type": "Microsoft.Compute/virtualMachines/providers/configurationProfileAssignments",
                  "apiVersion": "2021-04-30-preview",
                  "name": "[concat(parameters('vmName'), '/Microsoft.Automanage/default')]",
                  "properties": {
                    "configurationProfile": "/providers/Microsoft.Automanage/bestPractices/AzureBestPracticesProduction"
                  }
                }
              ]
            },
            "parameters": {
              "vmName": {
                "value": "[field('name')]"
              },
              "location": {
                "value": "[field('location')]"
              }
            }
          }
        }
      }
    }
  }
}
```

## Custom Configuration Profiles

### Create Custom Profile

```bash
# Create custom profile
az automanage configuration-profile create \
    --name "CustomWebServerProfile" \
    --resource-group rg-automanage \
    --configuration '{
        "Antimalware/Enable": true,
        "Antimalware/RealtimeProtectionEnabled": true,
        "AzureSecurityCenter/Enable": true,
        "Backup/Enable": true,
        "Backup/Policy": "DefaultPolicy",
        "Backup/SchedulePolicy": {
            "scheduleRunFrequency": "Daily",
            "scheduleRunTimes": ["2021-11-20T02:00:00Z"]
        },
        "Backup/RetentionPolicy": {
            "retentionPolicyType": "LongTermRetentionPolicy",
            "dailySchedule": {
                "retentionDuration": {
                    "count": 30,
                    "durationType": "Days"
                }
            }
        },
        "BootDiagnostics/Enable": true,
        "ChangeTrackingAndInventory/Enable": true,
        "GuestConfiguration/Enable": true,
        "LogAnalytics/Enable": true,
        "UpdateManagement/Enable": true,
        "VMInsights/Enable": true
    }'

# Assign to VM
az automanage configuration-profile-assignment create \
    --resource-group rg-vms \
    --vm-name vm-web-01 \
    --configuration-profile "/subscriptions/.../providers/Microsoft.Automanage/configurationProfiles/CustomWebServerProfile"
```

### Profile Configuration Options

```json
{
  "Antimalware": {
    "Enable": true,
    "RealtimeProtectionEnabled": true,
    "ScheduledScanSettings": {
      "isEnabled": true,
      "day": "7",
      "time": "120",
      "scanType": "Quick"
    },
    "Exclusions": {
      "Extensions": ".log;.ldf",
      "Paths": "D:\\Data",
      "Processes": "sqlservr.exe"
    }
  },
  "AzureSecurityCenter": {
    "Enable": true
  },
  "Backup": {
    "Enable": true,
    "Policy": {
      "schedulePolicy": {
        "schedulePolicyType": "SimpleSchedulePolicy",
        "scheduleRunFrequency": "Daily",
        "scheduleRunTimes": ["2021-11-20T02:00:00Z"]
      },
      "retentionPolicy": {
        "retentionPolicyType": "LongTermRetentionPolicy",
        "dailySchedule": {
          "retentionDuration": {
            "count": 30,
            "durationType": "Days"
          }
        },
        "weeklySchedule": {
          "daysOfTheWeek": ["Sunday"],
          "retentionDuration": {
            "count": 12,
            "durationType": "Weeks"
          }
        }
      }
    }
  },
  "ChangeTrackingAndInventory": {
    "Enable": true,
    "fileChangeTrackingEnabled": true,
    "registryChangeTrackingEnabled": true,
    "softwareInventoryEnabled": true
  },
  "GuestConfiguration": {
    "Enable": true,
    "AssignmentType": "ApplyAndAutoCorrect"
  },
  "LogAnalytics": {
    "Enable": true,
    "WorkspaceId": "/subscriptions/.../workspaces/my-workspace"
  },
  "UpdateManagement": {
    "Enable": true,
    "MaintenanceWindow": {
      "duration": "PT2H",
      "startTime": "2021-11-20T03:00:00Z",
      "timeZone": "UTC"
    },
    "Windows": {
      "includedKbNumbers": [],
      "excludedKbNumbers": [],
      "includedUpdateClassifications": "Critical,Security,UpdateRollup"
    }
  },
  "VMInsights": {
    "Enable": true
  }
}
```

## Monitoring Automanage Status

### PowerShell Reporting

```powershell
# Get all Automanage assignments
$assignments = Get-AzAutomanageConfigurationProfileAssignment

# Generate status report
$report = foreach ($assignment in $assignments) {
    $vm = Get-AzVM -ResourceId $assignment.TargetId

    [PSCustomObject]@{
        VMName = $vm.Name
        ResourceGroup = $vm.ResourceGroupName
        Profile = $assignment.ConfigurationProfile.Split('/')[-1]
        Status = $assignment.Status
        LastModified = $assignment.SystemData.LastModifiedAt
    }
}

$report | Format-Table -AutoSize

# Export to CSV
$report | Export-Csv -Path "automanage-status.csv" -NoTypeInformation
```

### Azure Resource Graph

```bash
# Query Automanage status
az graph query -q "
    Resources
    | where type == 'microsoft.automanage/configurationprofileassignments'
    | extend vmId = properties.targetId
    | extend status = properties.status
    | extend profile = properties.configurationProfile
    | join kind=leftouter (
        Resources
        | where type == 'microsoft.compute/virtualmachines'
        | project vmId = id, vmName = name, vmRG = resourceGroup
    ) on vmId
    | project vmName, vmRG, status, profile
"
```

### Log Analytics Queries

```kql
// Automanage configuration changes
AzureActivity
| where OperationNameValue contains "Microsoft.Automanage"
| project TimeGenerated, Caller, OperationNameValue, ActivityStatusValue
| order by TimeGenerated desc

// VMs without Automanage
Resources
| where type == "microsoft.compute/virtualmachines"
| where tags.Environment == "Production"
| join kind=leftanti (
    Resources
    | where type == "microsoft.automanage/configurationprofileassignments"
    | project vmId = tostring(properties.targetId)
) on $left.id == $right.vmId
| project name, resourceGroup, location

// Update compliance status
UpdateSummary
| where Computer in (
    Resources
    | where type == "microsoft.automanage/configurationprofileassignments"
    | extend vmName = tostring(split(properties.targetId, '/')[-1])
    | project vmName
)
| project Computer, CriticalUpdatesMissing, SecurityUpdatesMissing, TotalUpdatesMissing
```

## Machine Configuration (Guest Configuration)

### Create Custom Configuration

```powershell
# Install required modules
Install-Module -Name GuestConfiguration
Install-Module -Name PSDesiredStateConfiguration

# Create DSC configuration
Configuration SecureWebServer {
    Import-DscResource -ModuleName 'PSDscResources'
    Import-DscResource -ModuleName 'SecurityPolicyDsc'

    Node localhost {
        WindowsFeature IIS {
            Ensure = "Present"
            Name = "Web-Server"
        }

        WindowsFeature ASPNET {
            Ensure = "Present"
            Name = "Web-Asp-Net45"
            DependsOn = "[WindowsFeature]IIS"
        }

        SecurityOption AccountPolicy {
            Name = "AccountPolicy"
            Accounts_Rename_guest_account = "NoGuest"
            Accounts_Rename_administrator_account = "AdminRenamed"
        }

        Registry TLS12Only {
            Ensure = "Present"
            Key = "HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\SCHANNEL\Protocols\TLS 1.2\Server"
            ValueName = "Enabled"
            ValueType = "Dword"
            ValueData = "1"
        }
    }
}

# Compile configuration
SecureWebServer -OutputPath .\SecureWebServer

# Create package
New-GuestConfigurationPackage `
    -Name 'SecureWebServer' `
    -Configuration .\SecureWebServer\localhost.mof `
    -Type AuditAndSet `
    -Force

# Publish to Azure
$package = Publish-GuestConfigurationPackage `
    -Path .\SecureWebServer.zip `
    -ResourceGroupName "rg-guest-config" `
    -StorageAccountName "stguestconfig"

# Create policy
New-GuestConfigurationPolicy `
    -PolicyId (New-Guid) `
    -ContentUri $package.ContentUri `
    -DisplayName "Secure Web Server Configuration" `
    -Description "Ensures web servers meet security requirements" `
    -Path .\policies `
    -Platform Windows `
    -Mode ApplyAndAutoCorrect
```

## Troubleshooting

### Common Issues

```powershell
# Check extension status
Get-AzVMExtension -ResourceGroupName "rg-vms" -VMName "vm-web-01" |
    Where-Object { $_.Publisher -like "*Automanage*" } |
    Select-Object Name, ProvisioningState, StatusMessage

# View detailed logs
$vm = Get-AzVM -ResourceGroupName "rg-vms" -Name "vm-web-01"
Get-AzVMDiagnosticsExtension -ResourceGroupName $vm.ResourceGroupName -VMName $vm.Name

# Reset Automanage
az automanage configuration-profile-assignment delete \
    --resource-group rg-vms \
    --vm-name vm-web-01

az automanage configuration-profile-assignment create \
    --resource-group rg-vms \
    --vm-name vm-web-01 \
    --configuration-profile Production
```

Azure Automanage transforms VM management from a series of manual tasks into an automated, best-practice-driven process. It's ideal for organizations that want consistent, secure VM configurations without the operational overhead.

## Resources

- [Azure Automanage Documentation](https://docs.microsoft.com/en-us/azure/automanage/)
- [Best Practices Profiles](https://docs.microsoft.com/en-us/azure/automanage/automanage-virtual-machines#configuration-profiles)
- [Machine Configuration](https://docs.microsoft.com/en-us/azure/governance/machine-configuration/overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
