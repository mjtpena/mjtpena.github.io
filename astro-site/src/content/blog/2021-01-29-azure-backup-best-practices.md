---
title: Azure Backup Best Practices and Automation
description: "Backup configurations have a way of looking fine until the day you need to restore. Default policies, retention that doesn't match the actual RPO…"
author: Michael John Pena
draft: false
date: 2021-01-29
url: /blog/azure-backup-best-practices/
tags:
  - Azure
  - Backup
  - Disaster Recovery
  - Data Protection
  - Automation
---

Backup configurations have a way of looking fine until the day you need to restore. Default policies, retention that doesn't match the actual RPO, soft-delete left at defaults, and—my personal favourite—nobody has ever actually run a restore drill. Today's post is the practical best practices I've earned through other people's incidents: vault-level immutability against ransomware, cross-region restore for the workloads that need it, automated policy assignment via Azure Policy, and the quarterly restore drill that turns backup from theatre into reliability.

## Understanding Azure Backup Components

Azure Backup consists of:
- **Recovery Services Vault**: Stores backup data and configuration
- **Backup Policies**: Define retention and schedule
- **Protected Items**: Resources being backed up
- **Recovery Points**: Point-in-time snapshots

## Creating a Recovery Services Vault

```bicep
// Bicep: Recovery Services Vault with best practices

resource recoveryVault 'Microsoft.RecoveryServices/vaults@2021-08-01' = {
  name: 'rsv-${projectName}-${environment}'
  location: location
  sku: {
    name: 'RS0'
    tier: 'Standard'
  }
  properties: {
    publicNetworkAccess: 'Disabled'  // Use private endpoints
  }
  identity: {
    type: 'SystemAssigned'
  }
}

// Enable soft delete and security features
resource vaultConfig 'Microsoft.RecoveryServices/vaults/backupconfig@2021-08-01' = {
  parent: recoveryVault
  name: 'vaultconfig'
  properties: {
    enhancedSecurityState: 'Enabled'
    softDeleteFeatureState: 'Enabled'
    isSoftDeleteFeatureStateEditable: false
  }
}

// Private endpoint for vault access
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2021-05-01' = {
  name: 'pe-${recoveryVault.name}'
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'backup-connection'
        properties: {
          privateLinkServiceId: recoveryVault.id
          groupIds: ['AzureBackup']
        }
      }
    ]
  }
}
```

## Backup Policies

### VM Backup Policy

```json
{
  "name": "vm-backup-policy-production",
  "properties": {
    "backupManagementType": "AzureIaasVM",
    "instantRpRetentionRangeInDays": 5,
    "schedulePolicy": {
      "schedulePolicyType": "SimpleSchedulePolicy",
      "scheduleRunFrequency": "Daily",
      "scheduleRunTimes": ["2021-01-01T02:00:00Z"],
      "scheduleWeeklyFrequency": 0
    },
    "retentionPolicy": {
      "retentionPolicyType": "LongTermRetentionPolicy",
      "dailySchedule": {
        "retentionTimes": ["2021-01-01T02:00:00Z"],
        "retentionDuration": {
          "count": 30,
          "durationType": "Days"
        }
      },
      "weeklySchedule": {
        "daysOfTheWeek": ["Sunday"],
        "retentionTimes": ["2021-01-01T02:00:00Z"],
        "retentionDuration": {
          "count": 12,
          "durationType": "Weeks"
        }
      },
      "monthlySchedule": {
        "retentionScheduleFormatType": "Weekly",
        "retentionScheduleWeekly": {
          "daysOfTheWeek": ["Sunday"],
          "weeksOfTheMonth": ["First"]
        },
        "retentionTimes": ["2021-01-01T02:00:00Z"],
        "retentionDuration": {
          "count": 12,
          "durationType": "Months"
        }
      },
      "yearlySchedule": {
        "retentionScheduleFormatType": "Weekly",
        "monthsOfYear": ["January"],
        "retentionScheduleWeekly": {
          "daysOfTheWeek": ["Sunday"],
          "weeksOfTheMonth": ["First"]
        },
        "retentionTimes": ["2021-01-01T02:00:00Z"],
        "retentionDuration": {
          "count": 7,
          "durationType": "Years"
        }
      }
    },
    "tieringPolicy": {
      "ArchivedRP": {
        "tieringMode": "TierAfter",
        "duration": 180,
        "durationType": "Days"
      }
    }
  }
}
```

### SQL Database Backup Policy

```json
{
  "name": "sql-backup-policy",
  "properties": {
    "backupManagementType": "AzureWorkload",
    "workLoadType": "SQLDataBase",
    "settings": {
      "timeZone": "UTC",
      "issqlcompression": true,
      "isCompression": true
    },
    "subProtectionPolicy": [
      {
        "policyType": "Full",
        "schedulePolicy": {
          "schedulePolicyType": "SimpleSchedulePolicy",
          "scheduleRunFrequency": "Weekly",
          "scheduleRunDays": ["Sunday"],
          "scheduleRunTimes": ["2021-01-01T02:00:00Z"]
        },
        "retentionPolicy": {
          "retentionPolicyType": "LongTermRetentionPolicy",
          "weeklySchedule": {
            "daysOfTheWeek": ["Sunday"],
            "retentionTimes": ["2021-01-01T02:00:00Z"],
            "retentionDuration": {
              "count": 12,
              "durationType": "Weeks"
            }
          }
        }
      },
      {
        "policyType": "Differential",
        "schedulePolicy": {
          "schedulePolicyType": "SimpleSchedulePolicy",
          "scheduleRunFrequency": "Weekly",
          "scheduleRunDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
          "scheduleRunTimes": ["2021-01-01T02:00:00Z"]
        },
        "retentionPolicy": {
          "retentionPolicyType": "SimpleRetentionPolicy",
          "retentionDuration": {
            "count": 30,
            "durationType": "Days"
          }
        }
      },
      {
        "policyType": "Log",
        "schedulePolicy": {
          "schedulePolicyType": "LogSchedulePolicy",
          "scheduleFrequencyInMins": 15
        },
        "retentionPolicy": {
          "retentionPolicyType": "SimpleRetentionPolicy",
          "retentionDuration": {
            "count": 15,
            "durationType": "Days"
          }
        }
      }
    ]
  }
}
```

## Automating Backup Configuration

### Python SDK for Backup Management

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.recoveryservicesbackup import RecoveryServicesBackupClient
from azure.mgmt.recoveryservicesbackup.models import (
    ProtectionContainerResource,
    AzureIaaSVMProtectedItem,
    ProtectedItemResource
)

credential = DefaultAzureCredential()
subscription_id = os.environ["SUBSCRIPTION_ID"]

backup_client = RecoveryServicesBackupClient(credential, subscription_id)

def enable_vm_backup(vault_name, resource_group, vm_name, vm_resource_group, policy_name):
    """
    Enable backup for a VM with the specified policy.
    """
    # Get the VM resource ID
    vm_resource_id = f"/subscriptions/{subscription_id}/resourceGroups/{vm_resource_group}/providers/Microsoft.Compute/virtualMachines/{vm_name}"

    # Container name format
    container_name = f"IaasVMContainer;iaasvmcontainerv2;{vm_resource_group};{vm_name}"
    protected_item_name = f"VM;iaasvmcontainerv2;{vm_resource_group};{vm_name}"

    # Get the policy
    policy = backup_client.protection_policies.get(
        vault_name=vault_name,
        resource_group_name=resource_group,
        policy_name=policy_name
    )

    # Create protection request
    protected_item = ProtectedItemResource(
        properties=AzureIaaSVMProtectedItem(
            policy_id=policy.id,
            source_resource_id=vm_resource_id
        )
    )

    # Enable protection
    result = backup_client.protected_items.create_or_update(
        vault_name=vault_name,
        resource_group_name=resource_group,
        fabric_name="Azure",
        container_name=container_name,
        protected_item_name=protected_item_name,
        parameters=protected_item
    )

    print(f"Backup enabled for VM {vm_name}")
    return result

def trigger_backup(vault_name, resource_group, vm_name, vm_resource_group):
    """
    Trigger an on-demand backup.
    """
    container_name = f"IaasVMContainer;iaasvmcontainerv2;{vm_resource_group};{vm_name}"
    protected_item_name = f"VM;iaasvmcontainerv2;{vm_resource_group};{vm_name}"

    # Trigger backup
    result = backup_client.backups.trigger(
        vault_name=vault_name,
        resource_group_name=resource_group,
        fabric_name="Azure",
        container_name=container_name,
        protected_item_name=protected_item_name,
        parameters={}
    )

    print(f"Backup triggered for VM {vm_name}")
    return result

def list_recovery_points(vault_name, resource_group, vm_name, vm_resource_group):
    """
    List available recovery points for a VM.
    """
    container_name = f"IaasVMContainer;iaasvmcontainerv2;{vm_resource_group};{vm_name}"
    protected_item_name = f"VM;iaasvmcontainerv2;{vm_resource_group};{vm_name}"

    recovery_points = backup_client.recovery_points.list(
        vault_name=vault_name,
        resource_group_name=resource_group,
        fabric_name="Azure",
        container_name=container_name,
        protected_item_name=protected_item_name
    )

    for rp in recovery_points:
        print(f"Recovery Point: {rp.name}")
        print(f"  Time: {rp.properties.recovery_point_time}")
        print(f"  Type: {rp.properties.recovery_point_type}")
        print(f"  Tier: {rp.properties.recovery_point_tier_details}")

    return list(recovery_points)
```

### Azure Policy for Backup Compliance

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
          "field": "tags['Environment']",
          "equals": "Production"
        }
      ]
    },
    "then": {
      "effect": "deployIfNotExists",
      "details": {
        "type": "Microsoft.RecoveryServices/backupprotecteditems",
        "existenceCondition": {
          "field": "Microsoft.RecoveryServices/backupprotecteditems/protectionStatus",
          "equals": "Healthy"
        },
        "roleDefinitionIds": [
          "/providers/Microsoft.Authorization/roleDefinitions/9980e02c-c2be-4d73-94e8-173b1dc7cf3c"
        ],
        "deployment": {
          "properties": {
            "mode": "incremental",
            "template": {
              "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
              "contentVersion": "1.0.0.0",
              "parameters": {
                "vmName": {"type": "string"},
                "vmResourceGroup": {"type": "string"},
                "vaultName": {"type": "string"},
                "vaultResourceGroup": {"type": "string"},
                "policyName": {"type": "string"}
              },
              "resources": [
                {
                  "type": "Microsoft.RecoveryServices/vaults/backupFabrics/protectionContainers/protectedItems",
                  "apiVersion": "2021-08-01",
                  "name": "[concat(parameters('vaultName'), '/Azure/iaasvmcontainer;iaasvmcontainerv2;', parameters('vmResourceGroup'), ';', parameters('vmName'), '/vm;iaasvmcontainerv2;', parameters('vmResourceGroup'), ';', parameters('vmName'))]",
                  "properties": {
                    "protectedItemType": "Microsoft.Compute/virtualMachines",
                    "policyId": "[resourceId(parameters('vaultResourceGroup'), 'Microsoft.RecoveryServices/vaults/backupPolicies', parameters('vaultName'), parameters('policyName'))]",
                    "sourceResourceId": "[resourceId(parameters('vmResourceGroup'), 'Microsoft.Compute/virtualMachines', parameters('vmName'))]"
                  }
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

## Monitoring Backup Jobs

```csharp
using Azure.ResourceManager;
using Azure.ResourceManager.RecoveryServicesBackup;

public class BackupMonitoringService
{
    private readonly ArmClient _armClient;
    private readonly ILogger<BackupMonitoringService> _logger;

    public async Task<BackupHealthReport> GenerateHealthReportAsync(
        string vaultName,
        string resourceGroup)
    {
        var report = new BackupHealthReport
        {
            GeneratedAt = DateTime.UtcNow,
            VaultName = vaultName
        };

        var subscription = await _armClient.GetDefaultSubscriptionAsync();
        var vault = await subscription
            .GetResourceGroups()
            .Get(resourceGroup)
            .Value
            .GetRecoveryServicesVaults()
            .GetAsync(vaultName);

        // Get all backup jobs from last 24 hours
        var jobs = vault.Value.GetBackupJobs(
            filter: $"startTime ge '{DateTime.UtcNow.AddDays(-1):O}'"
        );

        await foreach (var job in jobs)
        {
            report.TotalJobs++;

            switch (job.Data.Properties.Status)
            {
                case "Completed":
                    report.SuccessfulJobs++;
                    break;
                case "Failed":
                    report.FailedJobs++;
                    report.FailedJobDetails.Add(new FailedJobInfo
                    {
                        JobId = job.Data.Name,
                        EntityName = job.Data.Properties.EntityFriendlyName,
                        ErrorMessage = job.Data.Properties.ErrorDetails?.FirstOrDefault()?.ErrorString,
                        StartTime = job.Data.Properties.StartTime,
                        Operation = job.Data.Properties.Operation
                    });
                    break;
                case "InProgress":
                    report.InProgressJobs++;
                    break;
            }
        }

        // Check for VMs without backup
        var protectedItems = vault.Value.GetBackupProtectedItems();
        var protectedVmIds = new HashSet<string>();

        await foreach (var item in protectedItems)
        {
            if (item.Data.Properties is AzureIaaSVMProtectedItem vmItem)
            {
                protectedVmIds.Add(vmItem.SourceResourceId.ToLowerInvariant());
            }
        }

        // Find unprotected VMs
        var vms = subscription.GetVirtualMachines();
        await foreach (var vm in vms)
        {
            if (vm.Data.Tags?.ContainsKey("BackupRequired") == true &&
                !protectedVmIds.Contains(vm.Id.ToString().ToLowerInvariant()))
            {
                report.UnprotectedResources.Add(new UnprotectedResource
                {
                    ResourceId = vm.Id.ToString(),
                    ResourceName = vm.Data.Name,
                    ResourceType = "VirtualMachine"
                });
            }
        }

        return report;
    }

    public async Task SendAlertForFailedJobsAsync(BackupHealthReport report)
    {
        if (report.FailedJobs > 0)
        {
            var alertMessage = $"Backup Alert: {report.FailedJobs} failed jobs in vault {report.VaultName}\n\n";

            foreach (var job in report.FailedJobDetails)
            {
                alertMessage += $"- {job.EntityName}: {job.ErrorMessage}\n";
            }

            await _alertService.SendAlertAsync(
                severity: AlertSeverity.High,
                title: "Backup Jobs Failed",
                message: alertMessage
            );
        }
    }
}

public class BackupHealthReport
{
    public DateTime GeneratedAt { get; set; }
    public string VaultName { get; set; }
    public int TotalJobs { get; set; }
    public int SuccessfulJobs { get; set; }
    public int FailedJobs { get; set; }
    public int InProgressJobs { get; set; }
    public List<FailedJobInfo> FailedJobDetails { get; set; } = new();
    public List<UnprotectedResource> UnprotectedResources { get; set; } = new();
}
```

## Restore Operations

```python
def restore_vm_to_new(
    vault_name, resource_group, vm_name, vm_resource_group,
    recovery_point_id, target_resource_group, target_vm_name,
    target_vnet, target_subnet, storage_account_id):
    """
    Restore a VM to a new VM from a recovery point.
    """
    container_name = f"IaasVMContainer;iaasvmcontainerv2;{vm_resource_group};{vm_name}"
    protected_item_name = f"VM;iaasvmcontainerv2;{vm_resource_group};{vm_name}"

    restore_request = IaasVMRestoreRequest(
        recovery_point_id=recovery_point_id,
        recovery_type="AlternateLocation",
        source_resource_id=f"/subscriptions/{subscription_id}/resourceGroups/{vm_resource_group}/providers/Microsoft.Compute/virtualMachines/{vm_name}",
        target_virtual_machine_id=f"/subscriptions/{subscription_id}/resourceGroups/{target_resource_group}/providers/Microsoft.Compute/virtualMachines/{target_vm_name}",
        target_resource_group_id=f"/subscriptions/{subscription_id}/resourceGroups/{target_resource_group}",
        storage_account_id=storage_account_id,
        virtual_network_id=target_vnet,
        subnet_id=target_subnet,
        create_new_cloud_service=False,
        original_storage_account_option=False,
        encryption_details=None
    )

    trigger_restore = RestoreRequestResource(properties=restore_request)

    result = backup_client.restores.trigger(
        vault_name=vault_name,
        resource_group_name=resource_group,
        fabric_name="Azure",
        container_name=container_name,
        protected_item_name=protected_item_name,
        recovery_point_id=recovery_point_id,
        parameters=trigger_restore
    )

    return result
```

## Best Practices Summary

1. **Vault Security**: Enable soft delete and purge protection
2. **Network Isolation**: Use private endpoints for vault access
3. **Policy Design**: Match retention to compliance requirements
4. **Tiering**: Use Archive tier for long-term retention to reduce costs
5. **Monitoring**: Set up alerts for failed backup jobs
6. **Testing**: Regularly test restore procedures
7. **Encryption**: Use customer-managed keys for sensitive workloads
8. **Cross-Region**: Configure cross-region restore for critical workloads

Azure Backup provides comprehensive data protection capabilities. With proper automation and monitoring, you can ensure your organization's data is protected and recoverable when needed.
