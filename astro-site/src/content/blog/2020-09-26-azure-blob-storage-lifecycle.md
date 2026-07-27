---
title: "Azure Blob Storage Lifecycle Management"
author: Michael John Peña
draft: false
date: 2020-09-26
tags:
  - Azure
  - Storage
  - Cost Optimization
  - Lifecycle

---

I wrote "Azure Blob Storage Lifecycle Management" to share practical, production-minded guidance on this topic.

## Storage Tiers

| Tier | Access | Cost (per GB) | Use Case |
|------|--------|---------------|----------|
| Hot | Frequent | $0.0184 | Active data |
| Cool | Infrequent | $0.01 | Backup, 30+ days |
| Archive | Rare | $0.00099 | Compliance, years |

## Lifecycle Policy

```json
{
  "rules": [
    {
      "name": "MoveToArchive",
      "enabled": true,
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["logs/", "backups/"]
        },
        "actions": {
          "baseBlob": {
            "tierToCool": {"daysAfterModificationGreaterThan": 30},
            "tierToArchive": {"daysAfterModificationGreaterThan": 90},
            "delete": {"daysAfterModificationGreaterThan": 365}
          }
        }
      }
    },
    {
      "name": "DeleteOldSnapshots",
      "enabled": true,
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"]
        },
        "actions": {
          "snapshot": {
            "delete": {"daysAfterCreationGreaterThan": 90}
          }
        }
      }
    }
  ]
}
```

## Applying the Policy

```bash
az storage account management-policy create \
    --account-name mystorageaccount \
    --resource-group myrg \
    --policy @lifecycle-policy.json
```

## Cost Savings Example

1TB of logs per month:
- All Hot: $184/month × 12 = $2,208/year
- With lifecycle (30d hot, 60d cool, archive): ~$500/year

Savings: **$1,700/year** for 1TB

## Considerations

- **Archive retrieval**: Takes hours, costs extra
- **Cool minimum**: 30-day minimum storage duration
- **Version considerations**: Policies can apply to versions too

Set up lifecycle policies on day one. Future you will thank past you for the cost savings.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
