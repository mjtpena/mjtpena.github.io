---
title: "Hardening Azure Backup: Vault Decisions, Policy and Restore Drills"
description: "The Azure Backup settings you can't change once a vault holds data, how to enforce coverage with Azure Policy, and why a scripted restore drill matters most."
author: Michael John Pena
draft: false
date: 2021-01-29
url: /blog/azure-backup-best-practices/
tags:
  - Azure
  - Backup
  - Disaster Recovery
  - Azure Policy
  - Security
---

Backup configurations have a way of looking fine until the day you need to restore. Default policies, retention that doesn't match the actual RPO, soft delete nobody has checked, and (my personal favourite) a restore that has never once been tested. The portal will happily show green ticks on every one of those vaults, and none of them tell you whether you can get a server back by Monday.

I covered the basics of Recovery Services vaults, workloads and the `az backup` commands in [Azure Backup: Protect Your Data](/blog/2020-11-29-azure-backup/). This post is the next layer: the vault decisions you only get to make once, how to stop unprotected VMs from creeping in, how to watch the jobs, and the restore drill that turns backup from theatre into something you can rely on.

## Decide these before the first item is protected

The most expensive Azure Backup mistakes are made in the first ten minutes of a vault's life. Several settings on a Recovery Services vault are locked, or can't be undone, once any item is registered. Get them wrong and the fix is a new vault, a new policy assignment, and a period of running two vaults while old recovery points age out.

| Setting | When you can change it | My default |
|---|---|---|
| Backup storage redundancy (LRS or GRS) | Only before any item is protected | GRS for production, LRS for dev/test |
| Cross Region Restore (public preview) | Off to on any time on a GRS vault; can't be turned off again | On for vaults holding tier-1 workloads |
| Customer-managed keys | New vaults only, before items are registered; can't revert to platform keys | Only where policy or regulation demands it |
| Private endpoints | Create before items are registered | On where VM egress is locked down |

Storage redundancy is the one that hurts most to get wrong.

**Storage redundancy** is the big one. GRS is the default and costs more; LRS is cheaper and perfectly reasonable for non-production. What you can't do is switch a vault after you've started protecting VMs in it. That's why I'd rather have separate production and non-production vaults than one vault with a compromise setting.

**Cross Region Restore** is still in public preview for Azure VMs as of this month. It lets you restore from the secondary (paired) region whenever you choose, rather than waiting for Microsoft to declare a regional outage. For a Sydney workload in Australia East, that means restoring into Australia Southeast. Two trade-offs: replication to the secondary region lags the primary by hours, so your cross-region RPO is worse than your in-region RPO; and once CRR is enabled on a vault you can't disable it. Read the [Cross Region Restore section of the VM restore docs](https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms#cross-region-restore) before you flip it on, and treat it as a preview feature in your DR runbook, not your only plan.

**Customer-managed keys** for Recovery Services vaults are now generally available, and the [CMK setup guide](https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk) walks through the managed identity and key vault permissions. Backup data is always encrypted with platform-managed keys, so CMK is about who controls the key, not whether data is encrypted. It only applies to new vaults with nothing registered, the key vault must be in the same region, and you can't go back to platform-managed keys afterwards. If your security team needs to revoke access to backup data independently of Microsoft, use it. If nobody is asking for it, I'd leave it off. A key vault that gets deleted, or a key someone forgets to rotate correctly, is one more way to lose your backups.

**Private endpoints** keep backup traffic for SQL Server and SAP HANA in Azure VMs, and MARS agent traffic, on your virtual network. Like CMK, they need to be in place before you register items. The [private endpoints overview](https://learn.microsoft.com/en-us/azure/backup/private-endpoints-overview) has the DNS zones you'll need; budget time for the DNS, because that's where these deployments usually stall.

Here's the part you can script today with Azure CLI 2.18:

```bash
# Create a production vault and set redundancy before anything is protected
az backup vault create \
  --name rsv-<workload>-prod-aue \
  --resource-group rg-<workload>-backup \
  --location australiaeast

az backup vault backup-properties set \
  --name rsv-<workload>-prod-aue \
  --resource-group rg-<workload>-backup \
  --backup-storage-redundancy GeoRedundant \
  --soft-delete-feature-state Enable
```

## Soft delete is your ransomware control, so protect it

Soft delete keeps deleted backup data for 14 additional days at no extra cost. It has been on by default for Azure VM backups for a while, and soft delete is also available for [SQL Server and SAP HANA in Azure VMs](https://learn.microsoft.com/en-us/azure/backup/soft-delete-sql-saphana-in-azure-vm). Someone who compromises an admin account and deletes your backups still leaves you two weeks to undelete them.

The weakness is that soft delete is just a vault property. Anyone with enough rights on the vault can turn it off, wait, and then delete. So the real control is access:

- Give day-to-day operators the built-in **Backup Operator** role, which can run backups and restores but can't remove protection or delete data.
- Keep **Backup Contributor** and **Contributor** on the vault for a small group, ideally through just-in-time elevation rather than standing access.
- Create Activity Log alerts on two operations: `Microsoft.RecoveryServices/vaults/backupconfig/write`, the vault backup config change that switches soft delete off, and `Microsoft.RecoveryServices/vaults/backupFabrics/protectionContainers/protectedItems/delete`, which is what stop protection with delete data looks like. Either one should page someone.

If you remember one thing from this section: a vault where every engineer is Owner doesn't really have soft delete.

## Make coverage the default with Azure Policy

The second most common failure I see is the VM nobody protected. Someone deploys a new server from a pipeline, the backup step was in a different pipeline, and nobody notices until they need it. Azure Policy fixes this better than any checklist.

The [built-in definitions for VM backup](https://learn.microsoft.com/en-us/azure/backup/backup-azure-auto-enable-backup) available right now:

| Built-in definition | Effect |
|---|---|
| Azure Backup should be enabled for Virtual Machines | AuditIfNotExists |
| Configure backup on VMs without a given tag to an existing recovery services vault in the same location | DeployIfNotExists |
| Configure backup on VMs with a given tag to an existing recovery services vault in the same location | DeployIfNotExists |
| Configure backup on VMs without a given tag to a new recovery services vault with a default policy | DeployIfNotExists |
| Configure backup on VMs with a given tag to a new recovery services vault with a default policy | DeployIfNotExists |

Some of these are still marked preview, and that status changes as Microsoft updates the definitions. Check the "(Preview)" suffix and the `preview` flag in each definition's metadata in the portal before you build a production assignment on it.

My preferred pattern is to assign the audit policy at the management group so coverage shows up in compliance reports everywhere, then assign the "without a given tag" existing-vault DeployIfNotExists policy per subscription and region, pointing at the central vault and policy for that region. The exclusion tag is the escape hatch for VMs that genuinely don't need backup (stateless scale-out nodes, build agents), and it makes those exceptions visible instead of silent.

Two things to know. DeployIfNotExists only acts on new or updated resources; existing VMs need a remediation task. And the policy needs a managed identity with rights on both the VM and the vault, so check its role assignments if remediation fails quietly.

Writing your own `deployIfNotExists` definition is possible, but I wouldn't start there. The built-ins already deal with the awkward bits, like the protected item naming convention and VM SKUs that Azure Backup doesn't support.

## Policies that match the RPO you promised

The default VM policy (daily backup, 30-day retention) is a starting point, not a design. Write down the RPO and retention your business actually needs, then build the policy from those numbers. The easiest way with the CLI is to start from the default and edit it:

```bash
# Export the default VM policy as a template
az backup policy get-default-for-vm \
  --vault-name rsv-<workload>-prod-aue \
  --resource-group rg-<workload>-backup > vm-policy.json

# After editing retention in vm-policy.json, create the production policy
az backup policy create \
  --vault-name rsv-<workload>-prod-aue \
  --resource-group rg-<workload>-backup \
  --name pol-vm-prod-daily \
  --backup-management-type AzureIaasVM \
  --policy vm-policy.json
```

The sections of `vm-policy.json` you'll edit most are the schedule and the retention policy. These keys sit under the exported file's `properties` object; leave the rest of the file as exported. A fragment for a daily 15:00 UTC backup with 30 dailies, 12 weeklies and 12 monthlies, plus 5 days of instant restore snapshots:

```json
{
  "schedulePolicy": {
    "schedulePolicyType": "SimpleSchedulePolicy",
    "scheduleRunFrequency": "Daily",
    "scheduleRunTimes": ["2021-01-29T15:00:00Z"]
  },
  "instantRpRetentionRangeInDays": 5,
  "retentionPolicy": {
    "retentionPolicyType": "LongTermRetentionPolicy",
    "dailySchedule": {
      "retentionTimes": ["2021-01-29T15:00:00Z"],
      "retentionDuration": { "count": 30, "durationType": "Days" }
    },
    "weeklySchedule": {
      "daysOfTheWeek": ["Sunday"],
      "retentionTimes": ["2021-01-29T15:00:00Z"],
      "retentionDuration": { "count": 12, "durationType": "Weeks" }
    },
    "monthlySchedule": {
      "retentionScheduleFormatType": "Weekly",
      "retentionScheduleWeekly": {
        "daysOfTheWeek": ["Sunday"],
        "weeksOfTheMonth": ["First"]
      },
      "retentionTimes": ["2021-01-29T15:00:00Z"],
      "retentionDuration": { "count": 12, "durationType": "Months" }
    }
  }
}
```

The retention times must match `scheduleRunTimes`, which is why the fragment sets both; change one without the other and `az backup policy create` rejects the policy. 15:00 UTC is 2am in Sydney during daylight saving. Instant restore snapshots (1 to 5 days) are what make recent restores fast, but you pay for the snapshot storage, so don't max it out on every policy.

Be honest about yearly retention. Seven years of VM recovery points is expensive, and restoring a seven-year-old VM image is rarely what an auditor actually wants. Long-term records usually belong in the application's data store or an archive, not in VM snapshots. For SQL Server in Azure VMs, use a workload policy with log backups (every 15 minutes at the most frequent) rather than relying on VM-level backup. That's the only way to get point-in-time restore for the database.

## Watch the jobs, not the dashboard

A backup job failing quietly for three weeks is how teams find out they've lost data. The built-in email notifications on the vault are fine for a single vault, but they don't scale. Send the vault's diagnostics to a Log Analytics workspace using the resource-specific tables. There's a built-in policy for that too: *Deploy Diagnostic Settings for Recovery Services Vault to Log Analytics workspace for resource specific categories*. Then alert on a query:

```kusto
// Failed backup jobs in the last 24 hours, one row per item
AddonAzureBackupJobs
| where TimeGenerated > ago(24h)
| where JobOperation == "Backup" and JobStatus == "Failed"
| summarize FailedJobs = count(), LastFailure = max(JobStartDateTime),
            FailureCodes = make_set(JobFailureCode)
    by BackupItemUniqueId, VaultUniqueId
| order by LastFailure desc
```

The same workspace powers Backup Reports, which is where I'd look for trends in storage growth and items whose last good recovery point is getting old. Backup Center, currently in preview, gives you the cross-vault operational view on top.

## The restore drill

None of the above matters if restores don't work. I'd run a drill at least quarterly for every tier-1 workload, and script it so it's cheap enough that people actually do it:

```bash
VAULT=rsv-<workload>-prod-aue
VAULT_RG=rg-<workload>-backup
VM=<vm-name>
# Staging storage account for the restore; it must be in Australia East, the vault's region
STAGING_SA=<staging-storage-account>

# Isolated resource group for the restored disks
az group create --name rg-restore-drill --location australiaeast

# Latest recovery point for the VM
RP=$(az backup recoverypoint list \
  --vault-name $VAULT --resource-group $VAULT_RG \
  --container-name $VM --item-name $VM \
  --backup-management-type AzureIaasVM \
  --query "sort_by([], &properties.recoveryPointTime)[-1].name" --output tsv)

# Restore managed disks into an isolated drill resource group
JOB=$(az backup restore restore-disks \
  --vault-name $VAULT --resource-group $VAULT_RG \
  --container-name $VM --item-name $VM \
  --rp-name $RP \
  --storage-account $STAGING_SA \
  --target-resource-group rg-restore-drill \
  --query name --output tsv)

# Block until the restore job finishes, then show its result
az backup job wait --vault-name $VAULT --resource-group $VAULT_RG --name $JOB
az backup job show --vault-name $VAULT --resource-group $VAULT_RG --name $JOB \
  --query "properties.status"
```

Restoring disks rather than a full VM is deliberate. You can attach them to a VM on an isolated virtual network, check the application starts and the data is current, and then delete the lot, without the restored server ever seeing production. Record the wall-clock time from "start" to "application verified". That number is your real RTO. It's almost always longer than the one in the DR plan.

## Where I'd draw the line

Not everything needs this treatment. Stateless VMs rebuilt from images or infrastructure as code don't need VM backup at all; exclude them by tag and back up the pipeline instead. PaaS databases such as Azure SQL Database aren't an Azure Backup workload at all; their built-in point-in-time restore and long-term retention are the tools there. Cross Region Restore and customer-managed keys add cost and irreversible settings, so turn them on because a requirement asks for them, not because a checklist says so.

For everything else, the order I'd work in is: get the vault settings right before anything is protected, lock down who can turn off soft delete, let Azure Policy enforce coverage, alert on failed jobs from Log Analytics, and prove all of it with a restore drill you've timed.
