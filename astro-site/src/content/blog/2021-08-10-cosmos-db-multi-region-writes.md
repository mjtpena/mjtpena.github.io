---
title: "Cosmos DB Multi-Region Writes: Active-Active Global Architecture"
description: "Multi-region writes enable true active-active architectures, but require careful design to handle the inevitable conflicts that arise from concurrent…"
author: "Michael John Peña"
draft: false
date: 2021-08-10
tags: ["Azure", "Cosmos DB", "Multi-Region", "Active-Active", "High Availability"]
---

## Enabling Multi-Region Writes

```bash
# Enable multi-region writes on existing account
az cosmosdb update \
    --resource-group myResourceGroup \
    --name mycosmosaccount \
    --enable-multiple-write-locations true

# Create new account with multi-region writes
az cosmosdb create \
    --resource-group myResourceGroup \
    --name mycosmosaccount \
    --enable-multiple-write-locations true \
    --locations regionName=eastus failoverPriority=0 \
    --locations regionName=westus failoverPriority=1 \
    --locations regionName=northeurope failoverPriority=2 \
    --default-consistency-level Session
```

Using ARM Template:

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "resources": [
        {
            "type": "Microsoft.DocumentDB/databaseAccounts",
            "apiVersion": "2021-04-15",
            "name": "mycosmosaccount",
            "location": "East US",
            "properties": {
                "databaseAccountOfferType": "Standard",
                "enableMultipleWriteLocations": true,
                "locations": [
                    {
                        "locationName": "East US",
                        "failoverPriority": 0
                    },
                    {
                        "locationName": "West US",
                        "failoverPriority": 1
                    },
                    {
                        "locationName": "North Europe",
                        "failoverPriority": 2
                    }
                ],
                "consistencyPolicy": {
                    "defaultConsistencyLevel": "Session"
                }
            }
        }
    ]
}
```

## SDK Configuration for Multi-Region Writes

```csharp
// C# - Configure client for multi-region writes
using Microsoft.Azure.Cosmos;

public class MultiRegionCosmosClient
{
    public static CosmosClient CreateMultiWriteClient(string userRegion)
    {
        var preferredRegions = GetPreferredRegionsForUser(userRegion);

        var options = new CosmosClientOptions
        {
            // Set the region closest to the user first
            ApplicationPreferredRegions = preferredRegions,

            // Enable content response on write (needed for conflict detection)
            EnableContentResponseOnWrite = true,

            // Connection optimizations
            ConnectionMode = ConnectionMode.Direct,

            // Retry policy for multi-region
            MaxRetryAttemptsOnRateLimitedRequests = 9,
            MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30)
        };

        return new CosmosClient(
            Environment.GetEnvironmentVariable("COSMOS_ENDPOINT"),
            Environment.GetEnvironmentVariable("COSMOS_KEY"),
            options
        );
    }

    private static List<string> GetPreferredRegionsForUser(string userRegion)
    {
        return userRegion switch
        {
            "US-East" => new List<string> { Regions.EastUS, Regions.WestUS, Regions.NorthEurope },
            "US-West" => new List<string> { Regions.WestUS, Regions.EastUS, Regions.NorthEurope },
            "Europe" => new List<string> { Regions.NorthEurope, Regions.EastUS, Regions.WestUS },
            _ => new List<string> { Regions.EastUS, Regions.WestUS, Regions.NorthEurope }
        };
    }
}
```

## Handling Write Conflicts

When the same document is modified in multiple regions simultaneously, conflicts occur:

```javascript
// JavaScript - Custom conflict resolution procedure
// Register this as a stored procedure in your container

function resolveConflict(incomingItem, existingItem, isTombstone, conflictingItems) {
    var context = getContext();
    var collection = context.getCollection();
    var response = context.getResponse();

    if (isTombstone) {
        // If existing item was deleted, accept incoming
        response.setBody(incomingItem);
        return;
    }

    // Custom merge logic - example: last writer wins based on timestamp
    var winner = incomingItem;

    if (existingItem._ts > incomingItem._ts) {
        winner = existingItem;
    }

    // For conflicting items array, find the most recent
    if (conflictingItems && conflictingItems.length > 0) {
        for (var i = 0; i < conflictingItems.length; i++) {
            if (conflictingItems[i]._ts > winner._ts) {
                winner = conflictingItems[i];
            }
        }
    }

    response.setBody(winner);
}
```

## Application-Level Conflict Resolution

```python
# Python - Read and resolve conflicts from conflicts feed
from azure.cosmos import CosmosClient
import json

class ConflictResolver:
    def __init__(self, client, database_name, container_name):
        self.container = client \
            .get_database_client(database_name) \
            .get_container_client(container_name)

    def process_conflicts(self):
        """Read and process conflicts from the conflicts feed"""

        conflicts_container = self.container.conflicts

        for conflict in conflicts_container.query_conflicts(
            query="SELECT * FROM c"
        ):
            resolved_item = self.resolve_conflict(conflict)

            if resolved_item:
                # Apply the resolved version
                self.container.upsert_item(resolved_item)

            # Delete the conflict record
            conflicts_container.delete_conflict(
                conflict['id'],
                partition_key=conflict['partitionKey']
            )

    def resolve_conflict(self, conflict):
        """
        Custom conflict resolution logic
        Returns the resolved item or None to discard
        """
        conflict_type = conflict['operationType']
        conflicting_items = conflict.get('content', [])

        if conflict_type == 'replace':
            # For updates, merge the changes
            return self.merge_updates(conflicting_items)
        elif conflict_type == 'delete':
            # For deletes, typically honor the delete
            return None
        else:
            # For inserts with same ID, keep the newest
            return max(conflicting_items, key=lambda x: x.get('_ts', 0))

    def merge_updates(self, items):
        """Merge conflicting updates intelligently"""
        if not items:
            return None

        # Start with the newest item as base
        base = max(items, key=lambda x: x.get('_ts', 0))

        # Merge specific fields from other versions
        for item in items:
            if item['id'] != base['id']:
                continue
            # Example: merge array fields
            if 'tags' in item and 'tags' in base:
                base['tags'] = list(set(base['tags'] + item['tags']))

        return base
```

## Monitoring Multi-Region Writes

```csharp
// C# - Monitor write region distribution
public class MultiRegionWriteMonitor
{
    private readonly CosmosClient _client;

    public async Task<WriteRegionStats> GetWriteStatistics()
    {
        var stats = new WriteRegionStats();

        // Get account properties to see all write regions
        var account = await _client.ReadAccountAsync();

        foreach (var region in account.WritableRegions)
        {
            stats.WriteRegions.Add(new RegionInfo
            {
                Name = region.Name,
                Endpoint = region.Endpoint
            });
        }

        return stats;
    }
}
```

## Best Practices for Multi-Region Writes

1. **Design for conflicts**: Assume conflicts will happen and plan resolution
2. **Use version vectors**: Track updates across regions
3. **Idempotent operations**: Make writes idempotent where possible
4. **Monitor conflict feed**: Set up alerts for high conflict rates
5. **Test failure scenarios**: Validate behavior during region outages

```csharp
// Example: Idempotent write with version tracking
public class IdempotentWrite<T> where T : IVersioned
{
    public async Task<T> SafeUpdateAsync(Container container, T item)
    {
        try
        {
            var response = await container.ReplaceItemAsync(
                item,
                item.Id,
                new PartitionKey(item.PartitionKey),
                new ItemRequestOptions { IfMatchEtag = item.ETag }
            );
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.PreconditionFailed)
        {
            // ETag mismatch - another region updated first
            // Fetch latest and retry or merge
            var latest = await container.ReadItemAsync<T>(
                item.Id,
                new PartitionKey(item.PartitionKey)
            );

            item = MergeChanges(item, latest.Resource);
            item.ETag = latest.ETag;

            return await SafeUpdateAsync(container, item);
        }
    }
}
```

Multi-region writes enable true active-active architectures, but require careful design to handle the inevitable conflicts that arise from concurrent modifications across regions.
