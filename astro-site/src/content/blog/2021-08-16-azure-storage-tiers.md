---
title: "Azure Storage Tiers: Optimizing Costs with Hot, Cool, and Archive"
description: "Azure Storage tiers provide a powerful mechanism for balancing performance and cost, enabling organizations to store massive amounts of data economically…"
author: "Michael John Peña"
draft: false
date: 2021-08-16
tags: ["Azure", "Storage", "Blob Storage", "Cost Optimization", "Data Management"]
---

## Understanding Access Tiers

| Tier | Storage Cost | Access Cost | Retrieval Time | Use Case |
|------|--------------|-------------|----------------|----------|
| Hot | Highest | Lowest | Immediate | Frequently accessed data |
| Cool | Medium | Medium | Immediate | Infrequently accessed (30+ days) |
| Archive | Lowest | Highest | Hours | Rarely accessed (180+ days) |

## Setting Blob Access Tier

```bash
# Upload blob to specific tier
az storage blob upload \
    --account-name mystorageaccount \
    --container-name mycontainer \
    --name myblob.txt \
    --file ./myfile.txt \
    --tier Cool

# Change existing blob tier
az storage blob set-tier \
    --account-name mystorageaccount \
    --container-name mycontainer \
    --name myblob.txt \
    --tier Archive
```

Using C#:

```csharp
// C# - Managing blob tiers
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

public class BlobTierManager
{
    private readonly BlobContainerClient _containerClient;

    public async Task UploadWithTierAsync(
        string blobName,
        Stream content,
        AccessTier tier)
    {
        var blobClient = _containerClient.GetBlobClient(blobName);

        var options = new BlobUploadOptions
        {
            AccessTier = tier,
            Metadata = new Dictionary<string, string>
            {
                { "originalTier", tier.ToString() },
                { "uploadedAt", DateTime.UtcNow.ToString("o") }
            }
        };

        await blobClient.UploadAsync(content, options);
    }

    public async Task ChangeTierAsync(string blobName, AccessTier newTier)
    {
        var blobClient = _containerClient.GetBlobClient(blobName);
        await blobClient.SetAccessTierAsync(newTier);
    }

    public async Task<AccessTier?> GetCurrentTierAsync(string blobName)
    {
        var blobClient = _containerClient.GetBlobClient(blobName);
        var properties = await blobClient.GetPropertiesAsync();
        return properties.Value.AccessTier;
    }

    public async Task BulkChangeTierAsync(
        IEnumerable<string> blobNames,
        AccessTier newTier)
    {
        var tasks = blobNames.Select(async name =>
        {
            var blobClient = _containerClient.GetBlobClient(name);
            await blobClient.SetAccessTierAsync(newTier);
        });

        await Task.WhenAll(tasks);
    }
}
```

## Working with Archive Tier

```python
# Python - Archive tier operations
from azure.storage.blob import BlobServiceClient, StandardBlobTier
from datetime import datetime, timedelta
import time

class ArchiveTierManager:
    def __init__(self, connection_string):
        self.blob_service = BlobServiceClient.from_connection_string(
            connection_string
        )

    def archive_blob(self, container_name, blob_name):
        """Move blob to archive tier"""
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        # Set metadata before archiving
        blob_client.set_blob_metadata({
            'archivedAt': datetime.utcnow().isoformat(),
            'previousTier': blob_client.get_blob_properties().blob_tier
        })

        blob_client.set_standard_blob_tier(StandardBlobTier.ARCHIVE)
        print(f"Archived: {blob_name}")

    def rehydrate_blob(self, container_name, blob_name,
                       target_tier=StandardBlobTier.HOT,
                       priority='Standard'):
        """
        Rehydrate archived blob.
        Priority options:
        - 'Standard': Up to 15 hours
        - 'High': Under 1 hour (higher cost)
        """
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        # Check current status
        properties = blob_client.get_blob_properties()

        if properties.blob_tier != 'Archive':
            print(f"Blob is not archived (current tier: {properties.blob_tier})")
            return

        # Start rehydration
        blob_client.set_standard_blob_tier(
            target_tier,
            rehydrate_priority=priority
        )

        print(f"Rehydration started for {blob_name}")
        print(f"Priority: {priority}, Target: {target_tier}")

    def check_rehydration_status(self, container_name, blob_name):
        """Check if blob is still rehydrating"""
        blob_client = self.blob_service.get_blob_client(
            container_name, blob_name
        )

        properties = blob_client.get_blob_properties()

        return {
            'blob_name': blob_name,
            'current_tier': properties.blob_tier,
            'archive_status': properties.archive_status,
            'is_rehydrating': properties.archive_status == 'rehydrate-pending-to-hot' or
                              properties.archive_status == 'rehydrate-pending-to-cool'
        }

    def wait_for_rehydration(self, container_name, blob_name,
                             timeout_hours=15):
        """Wait for rehydration to complete"""
        start_time = datetime.utcnow()
        timeout = timedelta(hours=timeout_hours)

        while datetime.utcnow() - start_time < timeout:
            status = self.check_rehydration_status(container_name, blob_name)

            if not status['is_rehydrating']:
                print(f"Rehydration complete. New tier: {status['current_tier']}")
                return True

            print(f"Still rehydrating... ({status['archive_status']})")
            time.sleep(300)  # Check every 5 minutes

        print("Rehydration timeout")
        return False
```

## Cost-Based Tier Selection

```csharp
// C# - Intelligent tier selection based on access patterns
public class TierOptimizer
{
    private readonly IMetricsService _metrics;

    public AccessTier RecommendTier(string blobName, BlobProperties properties)
    {
        var accessCount = _metrics.GetAccessCount(blobName, TimeSpan.FromDays(30));
        var lastAccess = _metrics.GetLastAccessTime(blobName);
        var blobSize = properties.ContentLength;

        // Calculate cost for each tier
        var costs = new Dictionary<AccessTier, decimal>
        {
            [AccessTier.Hot] = CalculateHotCost(blobSize, accessCount),
            [AccessTier.Cool] = CalculateCoolCost(blobSize, accessCount),
            [AccessTier.Archive] = CalculateArchiveCost(blobSize, accessCount)
        };

        // Consider minimum storage duration requirements
        var daysSinceLastTierChange = (DateTime.UtcNow - GetLastTierChange(blobName)).TotalDays;

        // Cool tier has 30-day minimum, Archive has 180-day minimum
        if (daysSinceLastTierChange < 30)
        {
            costs.Remove(AccessTier.Cool);
        }
        if (daysSinceLastTierChange < 180)
        {
            costs.Remove(AccessTier.Archive);
        }

        return costs.OrderBy(c => c.Value).First().Key;
    }

    private decimal CalculateHotCost(long sizeBytes, int monthlyAccesses)
    {
        decimal sizeGB = sizeBytes / (1024m * 1024m * 1024m);

        // Hot tier pricing (example - actual prices vary by region)
        decimal storageCost = sizeGB * 0.0184m;  // per GB/month
        decimal accessCost = monthlyAccesses * 0.0000004m;  // per operation
        decimal retrievalCost = 0;  // Free retrieval

        return storageCost + accessCost + retrievalCost;
    }

    private decimal CalculateCoolCost(long sizeBytes, int monthlyAccesses)
    {
        decimal sizeGB = sizeBytes / (1024m * 1024m * 1024m);

        decimal storageCost = sizeGB * 0.01m;
        decimal accessCost = monthlyAccesses * 0.00001m;
        decimal retrievalCost = sizeGB * monthlyAccesses * 0.01m;

        return storageCost + accessCost + retrievalCost;
    }

    private decimal CalculateArchiveCost(long sizeBytes, int monthlyAccesses)
    {
        decimal sizeGB = sizeBytes / (1024m * 1024m * 1024m);

        decimal storageCost = sizeGB * 0.00099m;
        decimal accessCost = monthlyAccesses * 0.00005m;
        decimal retrievalCost = sizeGB * monthlyAccesses * 0.02m;
        decimal rehydrationCost = monthlyAccesses > 0 ? 5.0m : 0;  // High priority rehydration

        return storageCost + accessCost + retrievalCost + rehydrationCost;
    }
}
```

## Monitoring Tier Distribution

```bash
# Get blob count and size by tier
az storage blob list \
    --account-name mystorageaccount \
    --container-name mycontainer \
    --query "[].{name:name, tier:properties.blobTier, size:properties.contentLength}" \
    --output table
```

```python
# Python - Generate tier distribution report
def generate_tier_report(container_client):
    tier_stats = {
        'Hot': {'count': 0, 'size': 0},
        'Cool': {'count': 0, 'size': 0},
        'Archive': {'count': 0, 'size': 0}
    }

    for blob in container_client.list_blobs():
        tier = blob.blob_tier or 'Hot'  # Default to Hot if not set
        if tier in tier_stats:
            tier_stats[tier]['count'] += 1
            tier_stats[tier]['size'] += blob.size

    # Format report
    print("\n=== Blob Tier Distribution Report ===\n")
    for tier, stats in tier_stats.items():
        size_gb = stats['size'] / (1024**3)
        print(f"{tier}:")
        print(f"  Blobs: {stats['count']:,}")
        print(f"  Size:  {size_gb:.2f} GB")
        print()

    return tier_stats
```

## Best Practices

1. **Analyze access patterns**: Use metrics to inform tier decisions
2. **Consider minimum storage durations**: Avoid early deletion penalties
3. **Plan for archive retrieval**: Factor in rehydration time for workflows
4. **Automate tier transitions**: Use lifecycle management policies
5. **Monitor tier-related costs**: Track access and retrieval charges

Azure Storage tiers provide a powerful mechanism for balancing performance and cost, enabling organizations to store massive amounts of data economically while maintaining appropriate access times.
