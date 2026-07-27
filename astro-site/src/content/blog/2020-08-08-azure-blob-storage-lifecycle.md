---
title: "Managing Data with Azure Blob Storage Lifecycle Policies"
author: Michael John Peña
draft: false
date: 2020-08-08
tags:
  - Azure
  - Storage
  - Data Management
  - Cost Optimization
---

Storage bills creep. They never spike, they never alert, they just slowly become a line item somebody at finance asks about, and by then you've got several terabytes of three-year-old log files at Hot tier rates. Lifecycle policies are the answer, and they cost nothing to set up — but I keep meeting accounts that don't have any. Walking through how I configure them, and the gotchas that have caught me out.

## Storage Tiers Overview

Azure Blob Storage offers three access tiers:

- **Hot** - Frequently accessed data, highest storage cost, lowest access cost
- **Cool** - Infrequently accessed data (30+ days), lower storage cost, higher access cost
- **Archive** - Rarely accessed data (180+ days), lowest storage cost, highest access cost

## Creating a Lifecycle Policy

Using Azure CLI:

```bash
# Create a storage account with blob versioning
az storage account create \
    --name mystorageaccount2020 \
    --resource-group rg-storage \
    --location australiaeast \
    --sku Standard_LRS \
    --kind StorageV2 \
    --access-tier Hot

# Enable blob versioning
az storage account blob-service-properties update \
    --account-name mystorageaccount2020 \
    --enable-versioning true
```

## Policy Definition

Create a policy file `lifecycle-policy.json`:

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "move-to-cool",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "tierToCool": {
              "daysAfterModificationGreaterThan": 30
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["logs/", "data/"]
        }
      }
    },
    {
      "enabled": true,
      "name": "archive-old-data",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "tierToArchive": {
              "daysAfterModificationGreaterThan": 90
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["archive/"]
        }
      }
    },
    {
      "enabled": true,
      "name": "delete-old-logs",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "delete": {
              "daysAfterModificationGreaterThan": 365
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["logs/"]
        }
      }
    }
  ]
}
```

Apply the policy:

```bash
az storage account management-policy create \
    --account-name mystorageaccount2020 \
    --policy @lifecycle-policy.json
```

## Managing Versions and Snapshots

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "version-management",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "version": {
            "tierToCool": {
              "daysAfterCreationGreaterThan": 30
            },
            "tierToArchive": {
              "daysAfterCreationGreaterThan": 90
            },
            "delete": {
              "daysAfterCreationGreaterThan": 365
            }
          },
          "snapshot": {
            "tierToCool": {
              "daysAfterCreationGreaterThan": 30
            },
            "delete": {
              "daysAfterCreationGreaterThan": 180
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"]
        }
      }
    }
  ]
}
```

## Using .NET SDK

```csharp
using Azure.Storage.Management;
using Azure.Storage.Management.Models;

public class LifecycleManager
{
    public async Task CreatePolicyAsync(string resourceGroup, string accountName)
    {
        var credential = new DefaultAzureCredential();
        var client = new StorageManagementClient(subscriptionId, credential);

        var policy = new ManagementPolicy
        {
            Rules = new List<ManagementPolicyRule>
            {
                new ManagementPolicyRule
                {
                    Name = "move-to-cool",
                    Enabled = true,
                    Type = "Lifecycle",
                    Definition = new ManagementPolicyDefinition
                    {
                        Actions = new ManagementPolicyAction
                        {
                            BaseBlob = new ManagementPolicyBaseBlob
                            {
                                TierToCool = new DateAfterModification
                                {
                                    DaysAfterModificationGreaterThan = 30
                                }
                            }
                        },
                        Filters = new ManagementPolicyFilter
                        {
                            BlobTypes = new List<string> { "blockBlob" },
                            PrefixMatch = new List<string> { "data/" }
                        }
                    }
                }
            }
        };

        await client.ManagementPolicies.CreateOrUpdateAsync(
            resourceGroup,
            accountName,
            policy);
    }
}
```

## Monitoring Policy Execution

Lifecycle policies run once per day. Monitor execution through:

```bash
# Check last execution
az storage account management-policy show \
    --account-name mystorageaccount2020 \
    --query 'policy.rules[].definition.actions'

# View metrics in Azure Monitor
az monitor metrics list \
    --resource /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{account} \
    --metric "BlobCount" \
    --interval PT1H
```

## Cost Estimation

Before implementing policies, estimate savings:

| Tier | Storage (per GB/month) | Operations |
|------|----------------------|------------|
| Hot | ~$0.0184 | Low cost |
| Cool | ~$0.01 | Higher cost |
| Archive | ~$0.00099 | Highest cost |

## Things I've been burned by

- **Archive tier rehydration is slow and not free.** Standard rehydration is up to 15 hours; high-priority is faster but costs more. If "rare access" turns out to mean "a couple of times a quarter from a Power BI report nobody told me about," Archive will hurt.
- **"Days after modification" is exact, not approximate.** I once tiered files to Archive at 30 days only to discover a downstream process was reading them weekly. Every read pulled the file back to Hot — which meant the tier transition counted as "modification" and reset the clock. Net effect: paying tiering costs in both directions, every week.
- **Policies run once per day, on Microsoft's schedule.** Don't expect immediate transitions when you create a policy. It can take 24-48 hours for the first run.
- **Test with a non-critical container first.** Once Archive happens, undoing it is a rehydrate, which costs money and time.

For most clients, just moving anything older than 90 days into Cool produces visible savings within a billing cycle. Start there. Get fancier when you actually understand your access patterns.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
