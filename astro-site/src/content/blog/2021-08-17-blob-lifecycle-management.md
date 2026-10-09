---
title: "Azure Blob Lifecycle Management: Automating Data Tiering and Deletion"
description: "Lifecycle management policies automate the tedious work of data tiering and retention, ensuring compliance while optimizing storage costs without manual…"
author: "Michael John Peña"
draft: false
date: 2021-08-17
tags: ["Azure", "Blob Storage", "Lifecycle Management", "Automation", "Cost Optimization"]
---

## Creating Lifecycle Management Policies

```bash
# Create lifecycle policy JSON file
cat > lifecycle-policy.json << 'EOF'
{
  "rules": [
    {
      "enabled": true,
      "name": "move-to-cool-after-30-days",
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
          "prefixMatch": ["data/"]
        }
      }
    },
    {
      "enabled": true,
      "name": "archive-after-90-days",
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
          "prefixMatch": ["logs/", "backups/"]
        }
      }
    },
    {
      "enabled": true,
      "name": "delete-after-365-days",
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
          "prefixMatch": ["temp/"]
        }
      }
    }
  ]
}
EOF

# Apply lifecycle policy
az storage account management-policy create \
    --account-name mystorageaccount \
    --resource-group myResourceGroup \
    --policy @lifecycle-policy.json
```

## Advanced Policy Rules

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "comprehensive-lifecycle",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "tierToCool": {
              "daysAfterModificationGreaterThan": 30
            },
            "tierToArchive": {
              "daysAfterModificationGreaterThan": 90
            },
            "delete": {
              "daysAfterModificationGreaterThan": 2555
            }
          },
          "snapshot": {
            "tierToCool": {
              "daysAfterCreationGreaterThan": 7
            },
            "delete": {
              "daysAfterCreationGreaterThan": 30
            }
          },
          "version": {
            "tierToCool": {
              "daysAfterCreationGreaterThan": 30
            },
            "delete": {
              "daysAfterCreationGreaterThan": 90
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["documents/"],
          "blobIndexMatch": [
            {
              "name": "Project",
              "op": "==",
              "value": "Contoso"
            }
          ]
        }
      }
    }
  ]
}
```

## Implementing via C#

```csharp
// C# - Programmatically manage lifecycle policies
using Azure.ResourceManager.Storage;
using Azure.ResourceManager.Storage.Models;

public class LifecyclePolicyManager
{
    private readonly StorageAccountResource _storageAccount;

    public async Task CreateComprehensivePolicyAsync()
    {
        var policy = new ManagementPolicyData
        {
            Policy = new ManagementPolicySchema
            {
                Rules =
                {
                    CreateTieringRule(),
                    CreateLogRetentionRule(),
                    CreateSnapshotCleanupRule(),
                    CreateVersionCleanupRule()
                }
            }
        };

        await _storageAccount.GetManagementPolicy()
            .CreateOrUpdateAsync(WaitUntil.Completed, policy);
    }

    private ManagementPolicyRule CreateTieringRule()
    {
        return new ManagementPolicyRule
        {
            Name = "auto-tier-data",
            Enabled = true,
            RuleType = ManagementPolicyRuleType.Lifecycle,
            Definition = new ManagementPolicyDefinition
            {
                Actions = new ManagementPolicyAction
                {
                    BaseBlob = new ManagementPolicyBaseBlob
                    {
                        TierToCool = new DateAfterModification
                        {
                            DaysAfterModificationGreaterThan = 30
                        },
                        TierToArchive = new DateAfterModification
                        {
                            DaysAfterModificationGreaterThan = 90
                        }
                    }
                },
                Filters = new ManagementPolicyFilter
                {
                    BlobTypes = { "blockBlob" },
                    PrefixMatch = { "data/", "reports/" }
                }
            }
        };
    }

    private ManagementPolicyRule CreateLogRetentionRule()
    {
        return new ManagementPolicyRule
        {
            Name = "log-retention",
            Enabled = true,
            RuleType = ManagementPolicyRuleType.Lifecycle,
            Definition = new ManagementPolicyDefinition
            {
                Actions = new ManagementPolicyAction
                {
                    BaseBlob = new ManagementPolicyBaseBlob
                    {
                        TierToArchive = new DateAfterModification
                        {
                            DaysAfterModificationGreaterThan = 30
                        },
                        Delete = new DateAfterModification
                        {
                            DaysAfterModificationGreaterThan = 365
                        }
                    }
                },
                Filters = new ManagementPolicyFilter
                {
                    BlobTypes = { "blockBlob" },
                    PrefixMatch = { "logs/" }
                }
            }
        };
    }

    private ManagementPolicyRule CreateSnapshotCleanupRule()
    {
        return new ManagementPolicyRule
        {
            Name = "snapshot-cleanup",
            Enabled = true,
            RuleType = ManagementPolicyRuleType.Lifecycle,
            Definition = new ManagementPolicyDefinition
            {
                Actions = new ManagementPolicyAction
                {
                    Snapshot = new ManagementPolicySnapShot
                    {
                        TierToCool = new DateAfterCreation
                        {
                            DaysAfterCreationGreaterThan = 7
                        },
                        Delete = new DateAfterCreation
                        {
                            DaysAfterCreationGreaterThan = 90
                        }
                    }
                },
                Filters = new ManagementPolicyFilter
                {
                    BlobTypes = { "blockBlob" }
                }
            }
        };
    }
}
```

## Using Blob Index Tags for Policies

```python
# Python - Managing blobs with index tags for lifecycle targeting
from azure.storage.blob import BlobServiceClient, BlobClient

class TagBasedLifecycle:
    def __init__(self, connection_string):
        self.blob_service = BlobServiceClient.from_connection_string(
            connection_string
        )

    def upload_with_lifecycle_tags(self, container_name, blob_name,
                                    data, retention_days):
        """Upload blob with tags for lifecycle management"""
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        tags = {
            'RetentionPolicy': self._get_retention_policy(retention_days),
            'DataClassification': 'Internal',
            'Project': 'DataAnalytics'
        }

        blob_client.upload_blob(data, tags=tags)
        return blob_client.url

    def _get_retention_policy(self, days):
        if days <= 30:
            return 'ShortTerm'
        elif days <= 90:
            return 'MediumTerm'
        elif days <= 365:
            return 'LongTerm'
        else:
            return 'Archive'

    def query_by_retention(self, container_name, policy):
        """Find all blobs with specific retention policy"""
        container_client = self.blob_service.get_container_client(
            container_name
        )

        filter_expression = f"\"RetentionPolicy\" = '{policy}'"

        blobs = container_client.find_blobs_by_tags(filter_expression)
        return [blob.name for blob in blobs]

    def update_lifecycle_tags(self, container_name, blob_name, new_policy):
        """Update blob tags to change lifecycle behavior"""
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        current_tags = blob_client.get_blob_tags() or {}
        current_tags['RetentionPolicy'] = new_policy
        current_tags['ModifiedAt'] = datetime.utcnow().isoformat()

        blob_client.set_blob_tags(current_tags)
```

## Lifecycle Policy for Compliance

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "gdpr-compliance",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "delete": {
              "daysAfterModificationGreaterThan": 1095
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "blobIndexMatch": [
            {
              "name": "DataType",
              "op": "==",
              "value": "PersonalData"
            }
          ]
        }
      }
    },
    {
      "enabled": true,
      "name": "financial-records-retention",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "tierToArchive": {
              "daysAfterModificationGreaterThan": 365
            },
            "delete": {
              "daysAfterModificationGreaterThan": 2555
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "blobIndexMatch": [
            {
              "name": "Category",
              "op": "==",
              "value": "FinancialRecords"
            }
          ]
        }
      }
    }
  ]
}
```

## Monitoring Lifecycle Policy Execution

```bash
# Check policy status
az storage account management-policy show \
    --account-name mystorageaccount \
    --resource-group myResourceGroup

# View diagnostic logs for lifecycle actions
az monitor diagnostic-settings create \
    --name lifecycle-logs \
    --resource /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{account} \
    --logs '[{"category": "StorageDelete", "enabled": true}]' \
    --workspace {log-analytics-workspace-id}
```

## Best Practices

1. **Test policies in dev first**: Verify behavior before production
2. **Use prefix matching**: Target specific folders/paths
3. **Leverage blob index tags**: For granular control
4. **Monitor policy execution**: Set up alerts for unexpected deletions
5. **Document retention requirements**: Map policies to compliance needs

Lifecycle management policies automate the tedious work of data tiering and retention, ensuring compliance while optimizing storage costs without manual intervention.
