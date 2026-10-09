---
title: "Implementing Conflict Resolution Policies in Cosmos DB"
description: "Proper conflict resolution is essential for multi-region write scenarios. Choose the right strategy based on your data semantics and ensure thorough testing…"
author: "Michael John Peña"
draft: false
date: 2021-08-11
tags: ["Azure", "Cosmos DB", "Conflict Resolution", "Multi-Region", "Distributed Systems"]
---

## Conflict Resolution Modes

Cosmos DB offers two conflict resolution modes:
1. **Last Writer Wins (LWW)** - Default, based on a configurable path
2. **Custom** - User-defined stored procedure

## Configuring Last Writer Wins

```bash
# Create container with LWW conflict resolution
az cosmosdb sql container create \
    --resource-group myResourceGroup \
    --account-name mycosmosaccount \
    --database-name mydb \
    --name mycontainer \
    --partition-key-path "/partitionKey" \
    --conflict-resolution-policy-mode "LastWriterWins" \
    --conflict-resolution-policy-path "/_ts"
```

Using custom timestamp path:

```csharp
// C# - Create container with custom LWW path
public async Task CreateContainerWithLWW()
{
    var containerProperties = new ContainerProperties
    {
        Id = "orders",
        PartitionKeyPath = "/customerId",
        ConflictResolutionPolicy = new ConflictResolutionPolicy
        {
            Mode = ConflictResolutionMode.LastWriterWins,
            ResolutionPath = "/modifiedAt"  // Custom timestamp field
        }
    };

    await _database.CreateContainerIfNotExistsAsync(containerProperties);
}
```

## Custom Conflict Resolution Procedure

```javascript
// Stored procedure for custom conflict resolution
function resolveConflictCustom(incomingItem, existingItem, isTombstone, conflictingItems) {
    var context = getContext();
    var response = context.getResponse();

    // Handle delete conflicts
    if (isTombstone && existingItem) {
        // Incoming is a delete, existing still exists
        // Custom logic: if existing has "protected" flag, don't delete
        if (existingItem.protected === true) {
            response.setBody(existingItem);
            return;
        }
        response.setBody(null);  // Accept the delete
        return;
    }

    // Handle create/update conflicts
    var winner = incomingItem;
    var allItems = [incomingItem, existingItem].concat(conflictingItems || []);

    // Remove nulls and tombstones
    allItems = allItems.filter(item => item && !item._isDeleted);

    // Custom resolution: Priority-based with merge
    winner = resolveByPriority(allItems);

    // Merge non-conflicting fields
    winner = mergeNonConflictingFields(winner, allItems);

    // Update conflict resolution metadata
    winner._conflictResolved = true;
    winner._conflictTimestamp = new Date().toISOString();
    winner._conflictCount = allItems.length;

    response.setBody(winner);
}

function resolveByPriority(items) {
    // Sort by priority, then by timestamp
    items.sort((a, b) => {
        if (a.priority !== b.priority) {
            return (b.priority || 0) - (a.priority || 0);
        }
        return (b._ts || 0) - (a._ts || 0);
    });
    return items[0];
}

function mergeNonConflictingFields(winner, allItems) {
    // Merge array fields (e.g., tags)
    var allTags = new Set();
    allItems.forEach(item => {
        if (item.tags && Array.isArray(item.tags)) {
            item.tags.forEach(tag => allTags.add(tag));
        }
    });
    winner.tags = Array.from(allTags);

    // Take highest value for numeric aggregates
    var maxQuantity = Math.max(...allItems.map(i => i.quantity || 0));
    winner.quantity = maxQuantity;

    return winner;
}
```

## Registering Custom Resolver

```csharp
// C# - Create container with custom conflict resolver
public async Task CreateContainerWithCustomResolver()
{
    var containerProperties = new ContainerProperties
    {
        Id = "orders",
        PartitionKeyPath = "/customerId",
        ConflictResolutionPolicy = new ConflictResolutionPolicy
        {
            Mode = ConflictResolutionMode.Custom,
            ResolutionProcedure = "dbs/mydb/colls/orders/sprocs/resolveConflictCustom"
        }
    };

    var container = await _database.CreateContainerIfNotExistsAsync(containerProperties);

    // Register the stored procedure
    var sprocProperties = new StoredProcedureProperties
    {
        Id = "resolveConflictCustom",
        Body = File.ReadAllText("conflictResolver.js")
    };

    await container.Container.Scripts.CreateStoredProcedureAsync(sprocProperties);
}
```

## Reading from Conflicts Feed

```python
# Python - Monitor and process conflicts feed
from azure.cosmos import CosmosClient
from datetime import datetime
import logging

class ConflictFeedProcessor:
    def __init__(self, container):
        self.container = container
        self.logger = logging.getLogger(__name__)

    def process_conflicts_continuously(self, callback):
        """Continuously process conflicts from the feed"""

        continuation = None

        while True:
            conflicts, continuation = self.read_conflicts_batch(continuation)

            for conflict in conflicts:
                try:
                    self.logger.info(f"Processing conflict: {conflict['id']}")
                    resolved = callback(conflict)

                    if resolved:
                        self.apply_resolution(conflict, resolved)

                    self.delete_conflict(conflict)
                except Exception as e:
                    self.logger.error(f"Error processing conflict: {e}")

            if not conflicts:
                # No more conflicts, wait before checking again
                time.sleep(10)

    def read_conflicts_batch(self, continuation=None):
        """Read a batch of conflicts"""

        query = "SELECT * FROM c"

        results = list(self.container.conflicts.query_conflicts(
            query=query,
            max_item_count=100,
            continuation=continuation
        ))

        return results, continuation

    def apply_resolution(self, conflict, resolved_item):
        """Apply the resolved item to the container"""

        try:
            self.container.upsert_item(resolved_item)
            self.logger.info(f"Applied resolution for {conflict['id']}")
        except Exception as e:
            self.logger.error(f"Failed to apply resolution: {e}")

    def delete_conflict(self, conflict):
        """Remove processed conflict from feed"""

        self.container.conflicts.delete_conflict(
            conflict['id'],
            partition_key=conflict.get('partitionKey')
        )
```

## Conflict Resolution Patterns

```typescript
// TypeScript - Common conflict resolution patterns

interface ConflictResolution<T> {
    resolve(items: T[]): T;
}

// Pattern 1: Last Writer Wins
class LastWriterWins<T extends { _ts: number }> implements ConflictResolution<T> {
    resolve(items: T[]): T {
        return items.reduce((latest, item) =>
            item._ts > latest._ts ? item : latest
        );
    }
}

// Pattern 2: Merge All Changes
class MergeChanges<T extends Record<string, any>> implements ConflictResolution<T> {
    private readonly mergeFields: string[];

    constructor(mergeFields: string[]) {
        this.mergeFields = mergeFields;
    }

    resolve(items: T[]): T {
        const base = items[0];

        for (const field of this.mergeFields) {
            if (Array.isArray(base[field])) {
                // Merge arrays
                const merged = new Set<any>();
                items.forEach(item => {
                    (item[field] || []).forEach((v: any) => merged.add(v));
                });
                base[field] = Array.from(merged) as any;
            } else if (typeof base[field] === 'number') {
                // Sum numbers or take max
                base[field] = Math.max(...items.map(i => i[field] || 0)) as any;
            }
        }

        return base;
    }
}

// Pattern 3: Application-Specific Rules
class OrderConflictResolution implements ConflictResolution<Order> {
    resolve(items: Order[]): Order {
        // For orders: keep the one with highest status progression
        const statusOrder = ['created', 'processing', 'shipped', 'delivered'];

        return items.reduce((best, order) => {
            const bestIdx = statusOrder.indexOf(best.status);
            const orderIdx = statusOrder.indexOf(order.status);
            return orderIdx > bestIdx ? order : best;
        });
    }
}
```

## Monitoring Conflicts

```sql
-- KQL query for conflict monitoring in Log Analytics
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| where Category == "DataPlaneRequests"
| where OperationName == "ReadConflictFeed"
| summarize ConflictCount = count() by bin(TimeGenerated, 1h), databaseName_s
| render timechart
```

Proper conflict resolution is essential for multi-region write scenarios. Choose the right strategy based on your data semantics and ensure thorough testing of edge cases.
