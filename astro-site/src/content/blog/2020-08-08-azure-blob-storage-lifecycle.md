---
title: "Azure Blob Lifecycle Policies: Tiering and Deletion Without Surprises"
description: "How I design Azure Blob Storage lifecycle policies to move data to Cool and Archive and delete it, plus the early-deletion and rehydration traps to avoid."
author: Michael John Peña
draft: false
date: 2020-08-08
tags:
  - Azure
  - Blob Storage
  - Data Management
  - Cost Optimization
---

Storage bills creep. They never spike and they never alert; they just slowly become a line item somebody in finance asks about, and by then you've got several terabytes of three-year-old log files sitting at Hot tier rates. Lifecycle management policies fix this, and they cost nothing to configure, yet plenty of storage accounts don't have one. Here's how I design them, and the traps worth knowing about before you let a policy loose on production data.

## What lifecycle management actually does

[Lifecycle management](https://learn.microsoft.com/azure/storage/blobs/lifecycle-management-overview) has been [generally available since March 2019](https://azure.microsoft.com/blog/azure-blob-storage-lifecycle-management-now-generally-available/) on general-purpose v2 and Blob Storage accounts. It's a single JSON policy per storage account containing up to 100 rules. Each rule has a filter (which blobs) and actions (what to do with them once they're old enough). The platform evaluates the policy roughly once a day and does the work for you: no Azure Functions, no Data Factory pipelines, no scheduled scripts that quietly stop working when somebody rotates a key.

It now works on accounts with a hierarchical namespace too. [Lifecycle management for Data Lake Storage Gen2 went GA at the end of July](https://azure.microsoft.com/updates/lifecycle-management-for-azure-data-lake-storage-is-now-generally-available/), a month after the Archive tier did, so it's new enough that I'd test it on a non-critical zone first. The examples below are written for a standard flat-namespace GPv2 account, but the same rules apply to a `raw/` zone in a Gen2 data lake.

As of today, the actions are:

- **Base blobs:** `tierToCool`, `tierToArchive` and `delete`, triggered by `daysAfterModificationGreaterThan`.
- **Snapshots:** `delete`, triggered by `daysAfterCreationGreaterThan`.

Filters are `blobTypes` (block blobs are the ones that matter here) and `prefixMatch`, which takes up to 10 prefixes per rule. A prefix always starts with the container name, so `logs/app/` means "blobs in the `logs` container whose names start with `app/`".

There are two newer pieces worth knowing about, but both are in preview right now. [Blob index tags](https://azure.microsoft.com/blog/manage-and-find-data-with-blob-index-for-azure-storage-now-in-preview/) add a `blobIndexMatch` filter, which lets you target blobs by tag (say `Status = Processed`) instead of by path. [Blob versioning](https://azure.microsoft.com/updates/azure-blob-versioning-public-preview-now-available/) has also been in public preview since May. I wouldn't build production retention on either one until they reach GA, but tag-based filtering is the one I'm most interested in. Prefixes force you to encode lifecycle into your folder structure, and that's a design constraint I'd rather not have.

## Tiers and minimum durations

| Tier | Good for | Minimum duration | Reading the data |
|---|---|---|---|
| Hot | Data read or written often | None | Cheapest per operation |
| Cool | Data you rarely touch but need straight away | 30 days | Online, higher per-operation and per-GB retrieval cost |
| Archive | Data you're keeping for compliance or "just in case" | 180 days | Offline; must be rehydrated first |

Storage gets cheaper as you go down the table, while access gets more expensive and, in Archive's case, slower. I'm deliberately not quoting per-GB prices here because they vary by region and redundancy. Pull the numbers for your own region from the [Azure Blob Storage pricing page](https://azure.microsoft.com/pricing/details/storage/blobs/) before you model savings.

The minimum durations are the part people skip. Move a blob to Cool and delete it or move it again within 30 days, and you pay an early deletion charge for the rest of those 30 days. Archive works the same way with a 180-day window. A policy that sends data to Cool at day 30 and Archive at day 45 isn't saving what you think it is.

Archive also isn't available on every redundancy option: it works with LRS, GRS and RA-GRS accounts, not ZRS or GZRS. Check the account's SKU before you write a rule that depends on it.

## Designing the rules

My starting point is to group data by **how it's read**, not by what it is. Application logs, raw ingestion files and exported reports often have completely different access patterns even when they live in the same account. One rule per access pattern is easier to reason about than one giant rule with ten prefixes.

Here's a policy that covers three common cases:

- Raw ingestion files go to Cool after 30 days and Archive after 180, and are deleted after roughly seven years.
- Application logs go to Cool after 30 days and are deleted after a year. They never go to Archive, because when you need old logs you need them in minutes, not hours.
- Manual snapshots in the `backups` container are deleted 90 days after creation.

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "rawIngestionRetention",
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["raw/"]
        },
        "actions": {
          "baseBlob": {
            "tierToCool": { "daysAfterModificationGreaterThan": 30 },
            "tierToArchive": { "daysAfterModificationGreaterThan": 180 },
            "delete": { "daysAfterModificationGreaterThan": 2555 }
          }
        }
      }
    },
    {
      "enabled": true,
      "name": "appLogRetention",
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["logs/app/", "logs/web/"]
        },
        "actions": {
          "baseBlob": {
            "tierToCool": { "daysAfterModificationGreaterThan": 30 },
            "delete": { "daysAfterModificationGreaterThan": 365 }
          }
        }
      }
    },
    {
      "enabled": true,
      "name": "backupSnapshotCleanup",
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["backups/"]
        },
        "actions": {
          "snapshot": {
            "delete": { "daysAfterCreationGreaterThan": 90 }
          }
        }
      }
    }
  ]
}
```

Notice that raw files stay in Cool until day 180, a 150-day gap before Archive. Anything past 30 days avoids the Cool early-deletion charge, so the length of the gap isn't about fees. It's about access: raw files tend to get re-processed now and then during the first six months (a schema fix, a backfill, a new downstream model), and I want that to be a normal read, not a rehydration request. Set the Archive threshold to the point where you're genuinely confident nobody will reach for the data in a hurry.

When more than one action on the same blob is due in the same run, the platform applies the cheapest one: delete wins over Archive, and Archive wins over Cool. That means you can stack tiering and deletion in a single rule without worrying about ordering.

Snapshots also need some thought. A blob that still has snapshots can't be deleted on its own. If a container uses snapshots, give them a lifecycle rule as well, or old base blobs will hang around longer than your policy suggests.

## Applying it

The policy replaces the whole existing policy every time. There's no "add a rule" call, so keep the JSON in source control and treat it like any other infrastructure definition.

```bash
az storage account management-policy create \
    --account-name <your-storage-account> \
    --resource-group <your-resource-group> \
    --policy @lifecycle-policy.json

# Confirm what's actually deployed
az storage account management-policy show \
    --account-name <your-storage-account> \
    --resource-group <your-resource-group>
```

The same policy can go into an ARM template as a `Microsoft.Storage/storageAccounts/managementPolicies` resource, which is how I'd ship it for anything beyond a one-off account.

Don't expect results immediately. Microsoft's guidance is that a new or changed policy can take up to 24 hours to go into effect, and the first run may take longer than that on large accounts. Wait at least a couple of days before you decide a rule "isn't working".

## Checking it worked

There's no lifecycle "run history" to look at, so I check the outcome instead: capacity by tier. The `BlobCapacity` metric in Azure Monitor can be split by the `BlobType` and `Tier` dimensions, which shows data moving out of Hot over the following days.

```bash
az monitor metrics list \
    --resource "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.Storage/storageAccounts/<your-storage-account>/blobServices/default" \
    --metric "BlobCapacity" \
    --dimension "Tier" \
    --offset 7d \
    --interval P1D \
    --aggregation Average
```

Capacity metrics are reported to Azure Monitor hourly, but the values only refresh about once a day, which is why the command above asks for daily points over the last seven days. Look at the trend over the week rather than expecting a step change after one run. Cost Management, filtered to the storage account and grouped by meter, is the other place to confirm savings once a billing cycle has passed.

## The traps

**Reading an archived blob doesn't bring it back.** People sometimes assume Archive behaves like a slower Cool. It doesn't. A read against an archived blob fails until you rehydrate it, either by setting the tier back to Hot or Cool or by copying it to a new blob in an online tier. Standard-priority rehydration can take up to 15 hours. [High-priority rehydration](https://azure.microsoft.com/blog/enhanced-features-in-azure-archive-storage-now-generally-available/), generally available since April, usually finishes in under an hour for blobs under 10 GB but costs more. If "rarely accessed" turns out to mean "a Power BI report nobody told you about reads it every Monday", that report breaks, and Archive is the wrong tier.

**Modification date isn't access date.** Rules trigger on last *modified* time, not last *read* time. A file that's written once and read daily looks exactly as "old" as a file nobody has opened in two years. You need to know the access pattern before you write the rule, which usually means a few weeks of storage analytics logs or a conversation with whoever owns the downstream jobs.

**Early deletion stacks with your rules.** A rule that deletes at 60 days anything it archived at 30 days pays 150 days of Archive storage it never used. Line up your tiering and deletion thresholds with the 30- and 180-day minimums.

**Soft delete keeps billing after a lifecycle delete.** If blob soft delete is enabled, a lifecycle delete only moves the blob into the soft-deleted state, and you keep paying for that data until the soft-delete retention period expires. Factor the retention window into your savings estimate. (Soft delete isn't yet supported on hierarchical namespace accounts, so this one only bites flat-namespace accounts for now.)

**Tiering millions of tiny blobs can cost more than it saves.** Each tier change is a billed write operation per blob, and write operations in Cool and Archive are priced higher than in Hot. Logs and IoT ingestion often produce millions of objects a few KB each, and for those the one-off transaction bill for moving them can outweigh months of storage savings. Check the average blob size before you write the rule: if most objects are tiny, batch them into larger files first or leave them in Hot.

**Test on something you can afford to get wrong.** Point a new rule at a non-critical prefix first and check the result. Once data is in Archive, undoing a mistake means paying for rehydration and waiting for it.

## When not to bother

If an account holds a few gigabytes, the savings won't cover the time you spend designing rules. If your data is genuinely hot, for example the working set of an analytics workload that scans everything daily, tiering it just adds per-read charges. And if retention is driven by a legal requirement that data must *not* be deleted or altered, use [immutable storage policies](https://learn.microsoft.com/azure/storage/blobs/immutable-storage-overview) for that guarantee. A lifecycle rule can be edited by anyone with the right role, so it's a cost tool, not a compliance control.

## Where I'd start

For most accounts, one rule that moves block blobs that haven't been modified in 90 days into Cool (after you've confirmed nothing reads them regularly) produces visible savings within a billing cycle and carries almost no risk. Add Archive and deletion only once you actually understand who reads the data and when, and keep the policy in source control so the next person can see why each rule exists.
