---
title: "Azure Backup: Protect Your Data"
author: Michael John Peña
draft: false
date: 2020-11-29
tags:
  - Azure
  - Backup
  - Disaster Recovery
  - Business Continuity
---

Every backup conversation I've ever had eventually circles back to a story about someone restoring a tape only to discover it was empty. Azure Backup is the modern alternative that's hard to mess up: agent-based for VMs, native for Azure SQL/Files, and centralised through Recovery Services Vault with soft-delete and immutable vaults to defeat ransomware. Default recovery point retention covers the basics—for compliance retention, plan deliberately, because storage adds up.

## Supported Workloads

| Workload | Agent/Method |
|----------|--------------|
| Azure VMs | Agentless |
| On-premises VMs | MARS agent |
| SQL Server | Backup extension |
| SAP HANA | Backup extension |
| Azure Files | Native integration |
| Azure Blobs | Native integration |

## Recovery Services Vault

```bash
# Create vault
az backup vault create \
    --name my-backup-vault \
    --resource-group myRG \
    --location eastus

# Enable soft delete
az backup vault backup-properties set \
    --name my-backup-vault \
    --resource-group myRG \
    --soft-delete-feature-state Enable
```

## Azure VM Backup

```bash
# Enable backup on VM
az backup protection enable-for-vm \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --vm myVM \
    --policy-name DefaultPolicy
```

## Backup Policies

```json
{
    "name": "DailyBackupPolicy",
    "properties": {
        "backupManagementType": "AzureIaasVM",
        "schedulePolicy": {
            "schedulePolicyType": "SimpleSchedulePolicy",
            "scheduleRunFrequency": "Daily",
            "scheduleRunTimes": ["2020-11-29T02:00:00Z"]
        },
        "retentionPolicy": {
            "retentionPolicyType": "LongTermRetentionPolicy",
            "dailySchedule": {
                "retentionTimes": ["2020-11-29T02:00:00Z"],
                "retentionDuration": {
                    "count": 30,
                    "durationType": "Days"
                }
            },
            "weeklySchedule": {
                "daysOfTheWeek": ["Sunday"],
                "retentionTimes": ["2020-11-29T02:00:00Z"],
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
                "retentionDuration": {
                    "count": 7,
                    "durationType": "Years"
                }
            }
        }
    }
}
```

## SQL Server Backup

```bash
# Register SQL VM
az backup container register \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --backup-management-type AzureWorkload \
    --workload-type MSSQL \
    --container-name "VMAppContainer;Compute;myRG;sqlvm"

# Enable protection
az backup protection enable-for-azurewl \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --policy-name HourlyLogBackup \
    --protectable-item-name "sqldatabase;mssqlserver;mydatabase" \
    --protectable-item-type SQLDataBase \
    --server-name sqlvm \
    --workload-type MSSQL
```

## On-Demand Backup

```bash
# Trigger immediate backup
az backup protection backup-now \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --container-name "iaasvmcontainer;iaasvmcontainerv2;myRG;myVM" \
    --item-name myVM \
    --backup-management-type AzureIaasVM \
    --retain-until 2021-01-29
```

## Restore VM

```bash
# Get recovery points
az backup recoverypoint list \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --container-name "iaasvmcontainer;iaasvmcontainerv2;myRG;myVM" \
    --item-name myVM \
    --backup-management-type AzureIaasVM

# Restore VM
az backup restore restore-disks \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --container-name "iaasvmcontainer;iaasvmcontainerv2;myRG;myVM" \
    --item-name myVM \
    --rp-name recoverypoint123 \
    --storage-account mystorageaccount \
    --target-resource-group restore-rg
```

## File Recovery

```bash
# Mount recovery point as drive
az backup restore files mount-rp \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --container-name "iaasvmcontainer;..." \
    --item-name myVM \
    --rp-name recoverypoint123

# Unmount after copying files
az backup restore files unmount-rp \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --container-name "iaasvmcontainer;..." \
    --item-name myVM \
    --rp-name recoverypoint123
```

## Monitoring

```bash
# Check backup jobs
az backup job list \
    --resource-group myRG \
    --vault-name my-backup-vault \
    --output table
```

Azure Backup: simple protection for complex environments.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
