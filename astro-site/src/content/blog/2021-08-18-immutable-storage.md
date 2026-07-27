---
title: "Azure Immutable Storage: WORM Compliance for Regulatory Requirements"
author: "Michael John Peña"
draft: false
date: 2021-08-18
tags: ["Azure", "Blob Storage", "Immutable Storage", "WORM", "Compliance"]

---

I wrote "Azure Immutable Storage: WORM Compliance for Regulatory Requirements" to share practical, production-minded guidance on this topic.

## Understanding Immutability Policies

Azure supports two types of immutability policies:
- **Time-based retention**: Data cannot be modified or deleted for a set period
- **Legal hold**: Data cannot be modified or deleted until hold is removed

## Creating Time-Based Retention Policy

```bash
# Create container with immutability policy
az storage container immutability-policy create \
    --account-name mystorageaccount \
    --container-name compliance-data \
    --period 365 \
    --allow-protected-append-writes true

# Lock the policy (irreversible!)
az storage container immutability-policy lock \
    --account-name mystorageaccount \
    --container-name compliance-data \
    --if-match $(az storage container immutability-policy show \
        --account-name mystorageaccount \
        --container-name compliance-data \
        --query etag -o tsv)
```

Using C#:

```csharp
// C# - Managing immutability policies
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

public class ImmutableStorageManager
{
    private readonly BlobServiceClient _blobServiceClient;

    public async Task CreateImmutableContainerAsync(
        string containerName,
        int retentionDays)
    {
        // Create container
        var containerClient = await _blobServiceClient
            .CreateBlobContainerAsync(containerName);

        // Set immutability policy
        var immutabilityPolicy = new BlobImmutabilityPolicy
        {
            ExpiresOn = DateTimeOffset.UtcNow.AddDays(retentionDays),
            PolicyMode = BlobImmutabilityPolicyMode.Unlocked
        };

        // Apply at container level
        await containerClient.Value.SetImmutabilityPolicyAsync(
            immutabilityPolicy);
    }

    public async Task UploadImmutableBlobAsync(
        string containerName,
        string blobName,
        Stream content,
        int retentionDays)
    {
        var containerClient = _blobServiceClient
            .GetBlobContainerClient(containerName);
        var blobClient = containerClient.GetBlobClient(blobName);

        // Upload blob
        await blobClient.UploadAsync(content);

        // Set blob-level immutability
        var immutabilityPolicy = new BlobImmutabilityPolicy
        {
            ExpiresOn = DateTimeOffset.UtcNow.AddDays(retentionDays),
            PolicyMode = BlobImmutabilityPolicyMode.Unlocked
        };

        await blobClient.SetImmutabilityPolicyAsync(immutabilityPolicy);
    }

    public async Task LockImmutabilityPolicyAsync(
        string containerName,
        string blobName)
    {
        var containerClient = _blobServiceClient
            .GetBlobContainerClient(containerName);
        var blobClient = containerClient.GetBlobClient(blobName);

        var properties = await blobClient.GetPropertiesAsync();

        // Lock the policy - this is IRREVERSIBLE
        var lockedPolicy = new BlobImmutabilityPolicy
        {
            ExpiresOn = properties.Value.ImmutabilityPolicy.ExpiresOn,
            PolicyMode = BlobImmutabilityPolicyMode.Locked
        };

        await blobClient.SetImmutabilityPolicyAsync(lockedPolicy);
    }
}
```

## Implementing Legal Holds

```python
# Python - Managing legal holds
from azure.storage.blob import BlobServiceClient, BlobClient
from azure.storage.blob._models import BlobImmutabilityPolicyMode
from datetime import datetime

class LegalHoldManager:
    def __init__(self, connection_string):
        self.blob_service = BlobServiceClient.from_connection_string(
            connection_string
        )

    def set_legal_hold(self, container_name, blob_name, hold_tags):
        """Apply legal hold to a blob"""
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        # Set legal hold tags
        blob_client.set_legal_hold(hold_tags)

        print(f"Legal hold applied to {blob_name}")
        print(f"Hold tags: {hold_tags}")

    def clear_legal_hold(self, container_name, blob_name, hold_tags):
        """Remove legal hold from a blob"""
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        # Clear specific legal hold tags
        blob_client.set_legal_hold([], clear_legal_hold=True)

        print(f"Legal hold cleared from {blob_name}")

    def get_legal_hold_status(self, container_name, blob_name):
        """Check legal hold status"""
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        properties = blob_client.get_blob_properties()

        return {
            'has_legal_hold': properties.has_legal_hold,
            'legal_hold_tags': properties.legal_hold,
            'immutability_policy': {
                'expiry': properties.immutability_policy.expiry_time,
                'mode': properties.immutability_policy.policy_mode
            } if properties.immutability_policy else None
        }

    def apply_litigation_hold(self, container_name, case_id, blob_names):
        """Apply litigation hold to multiple blobs for a case"""
        hold_tags = [f"case-{case_id}", f"applied-{datetime.utcnow().date()}"]

        for blob_name in blob_names:
            self.set_legal_hold(container_name, blob_name, hold_tags)

        return {
            'case_id': case_id,
            'blobs_held': len(blob_names),
            'hold_tags': hold_tags
        }
```

## Version-Level Immutability

```csharp
// C# - Version-level immutability for fine-grained control
public class VersionImmutabilityManager
{
    private readonly BlobContainerClient _containerClient;

    public async Task EnableVersionLevelImmutabilityAsync()
    {
        // Enable versioning on storage account first
        // Then enable version-level immutability on container

        var properties = await _containerClient.GetPropertiesAsync();

        // Container must have immutability policy enabled
        Console.WriteLine($"Immutable storage enabled: {properties.Value.HasImmutableStorageWithVersioning}");
    }

    public async Task<string> UploadWithVersionImmutabilityAsync(
        string blobName,
        Stream content,
        int retentionDays)
    {
        var blobClient = _containerClient.GetBlobClient(blobName);

        // Upload creates a new version
        var response = await blobClient.UploadAsync(content, overwrite: true);
        var versionId = response.Value.VersionId;

        // Set immutability on specific version
        var versionedBlobClient = blobClient.WithVersion(versionId);

        var policy = new BlobImmutabilityPolicy
        {
            ExpiresOn = DateTimeOffset.UtcNow.AddDays(retentionDays),
            PolicyMode = BlobImmutabilityPolicyMode.Unlocked
        };

        await versionedBlobClient.SetImmutabilityPolicyAsync(policy);

        return versionId;
    }

    public async Task<List<VersionInfo>> GetAllVersionsWithPoliciesAsync(
        string blobName)
    {
        var versions = new List<VersionInfo>();

        await foreach (var item in _containerClient.GetBlobsAsync(
            states: BlobStates.Version,
            prefix: blobName))
        {
            versions.Add(new VersionInfo
            {
                VersionId = item.VersionId,
                CreatedOn = item.Properties.CreatedOn,
                ImmutabilityExpiry = item.Properties.ImmutabilityPolicy?.ExpiresOn,
                PolicyMode = item.Properties.ImmutabilityPolicy?.PolicyMode?.ToString(),
                HasLegalHold = item.Properties.HasLegalHold
            });
        }

        return versions.OrderByDescending(v => v.CreatedOn).ToList();
    }
}
```

## Compliance Reporting

```python
# Python - Generate compliance report
from azure.storage.blob import BlobServiceClient
from datetime import datetime, timedelta
import json

class ComplianceReporter:
    def __init__(self, connection_string):
        self.blob_service = BlobServiceClient.from_connection_string(
            connection_string
        )

    def generate_compliance_report(self, container_name):
        """Generate comprehensive compliance report"""
        container_client = self.blob_service.get_container_client(
            container_name
        )

        report = {
            'container': container_name,
            'generated_at': datetime.utcnow().isoformat(),
            'summary': {
                'total_blobs': 0,
                'immutable_blobs': 0,
                'legal_holds': 0,
                'expiring_soon': 0,
                'locked_policies': 0
            },
            'blobs': []
        }

        for blob in container_client.list_blobs(
            include=['immutabilitypolicy', 'legalhold', 'metadata']
        ):
            report['summary']['total_blobs'] += 1

            blob_info = {
                'name': blob.name,
                'size': blob.size,
                'created': blob.creation_time.isoformat() if blob.creation_time else None
            }

            # Check immutability
            if blob.immutability_policy:
                report['summary']['immutable_blobs'] += 1
                blob_info['immutability'] = {
                    'expiry': blob.immutability_policy.expiry_time.isoformat()
                        if blob.immutability_policy.expiry_time else None,
                    'mode': str(blob.immutability_policy.policy_mode)
                }

                # Check if locked
                if str(blob.immutability_policy.policy_mode) == 'Locked':
                    report['summary']['locked_policies'] += 1

                # Check if expiring within 30 days
                if blob.immutability_policy.expiry_time:
                    days_until_expiry = (
                        blob.immutability_policy.expiry_time - datetime.utcnow()
                    ).days
                    if days_until_expiry <= 30:
                        report['summary']['expiring_soon'] += 1

            # Check legal hold
            if blob.has_legal_hold:
                report['summary']['legal_holds'] += 1
                blob_info['legal_hold'] = True

            report['blobs'].append(blob_info)

        return report

    def export_audit_trail(self, container_name, output_path):
        """Export audit trail for compliance"""
        report = self.generate_compliance_report(container_name)

        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2)

        return output_path
```

## Best Practices

1. **Test before locking**: Locked policies cannot be shortened
2. **Use legal holds for investigations**: More flexible than time-based
3. **Enable versioning**: For version-level immutability
4. **Document policy decisions**: Maintain compliance records
5. **Set up monitoring**: Alert on policy expirations

Immutable storage in Azure provides the strong data protection guarantees required for regulatory compliance, ensuring your critical data remains tamper-proof throughout its required retention period.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
