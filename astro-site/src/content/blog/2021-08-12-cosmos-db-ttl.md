---
title: "Time-To-Live (TTL) in Azure Cosmos DB: Automatic Data Expiration"
description: "TTL is a powerful feature for automatic data lifecycle management, reducing storage costs and ensuring compliance with data retention policies without…"
author: "Michael John Peña"
draft: false
date: 2021-08-12
tags: ["Azure", "Cosmos DB", "TTL", "Data Management", "NoSQL"]
---

## Enabling TTL on a Container

```bash
# Enable TTL on container with default expiration
az cosmosdb sql container update \
    --resource-group myResourceGroup \
    --account-name mycosmosaccount \
    --database-name mydb \
    --name sessions \
    --ttl 3600  # Default 1 hour in seconds

# Enable TTL without default (per-item only)
az cosmosdb sql container update \
    --resource-group myResourceGroup \
    --account-name mycosmosaccount \
    --database-name mydb \
    --name mycontainer \
    --ttl -1  # No default, items must specify TTL
```

Using C#:

```csharp
// Create container with TTL enabled
public async Task CreateContainerWithTTL()
{
    var containerProperties = new ContainerProperties
    {
        Id = "sessions",
        PartitionKeyPath = "/userId",
        DefaultTimeToLive = 3600  // 1 hour default
    };

    await _database.CreateContainerIfNotExistsAsync(containerProperties);
}

// Create container with TTL enabled but no default
public async Task CreateContainerWithItemLevelTTL()
{
    var containerProperties = new ContainerProperties
    {
        Id = "events",
        PartitionKeyPath = "/eventType",
        DefaultTimeToLive = -1  // Per-item TTL only
    };

    await _database.CreateContainerIfNotExistsAsync(containerProperties);
}
```

## Setting TTL on Individual Items

```javascript
// JavaScript - Creating items with TTL
const { CosmosClient } = require("@azure/cosmos");

class SessionManager {
    constructor(container) {
        this.container = container;
    }

    async createSession(userId, sessionData, durationMinutes = 60) {
        const session = {
            id: `session_${Date.now()}`,
            userId: userId,
            data: sessionData,
            createdAt: new Date().toISOString(),
            ttl: durationMinutes * 60  // TTL in seconds
        };

        const { resource } = await this.container.items.create(session);
        return resource;
    }

    async extendSession(sessionId, userId, additionalMinutes) {
        const { resource: session } = await this.container
            .item(sessionId, userId)
            .read();

        // Extend TTL by updating the item
        session.ttl = session.ttl + (additionalMinutes * 60);
        session.extendedAt = new Date().toISOString();

        const { resource: updated } = await this.container
            .item(sessionId, userId)
            .replace(session);

        return updated;
    }

    async createPersistentSession(userId, sessionData) {
        // TTL of -1 means never expire (overrides container default)
        const session = {
            id: `persistent_${Date.now()}`,
            userId: userId,
            data: sessionData,
            createdAt: new Date().toISOString(),
            ttl: -1
        };

        const { resource } = await this.container.items.create(session);
        return resource;
    }
}
```

## TTL Patterns for Different Use Cases

```python
# Python - Different TTL patterns
from azure.cosmos import CosmosClient
from datetime import datetime, timedelta

class TTLPatterns:
    def __init__(self, container):
        self.container = container

    def create_audit_log(self, action, user_id, details, retention_days=90):
        """Audit logs with configurable retention"""
        log = {
            'id': f"audit_{datetime.utcnow().timestamp()}",
            'partitionKey': f"{datetime.utcnow().strftime('%Y-%m')}",
            'action': action,
            'userId': user_id,
            'details': details,
            'timestamp': datetime.utcnow().isoformat(),
            'ttl': retention_days * 24 * 60 * 60
        }
        return self.container.create_item(log)

    def create_cache_entry(self, key, value, cache_seconds=300):
        """Short-lived cache entries"""
        entry = {
            'id': key,
            'partitionKey': 'cache',
            'value': value,
            'cachedAt': datetime.utcnow().isoformat(),
            'ttl': cache_seconds
        }
        return self.container.upsert_item(entry)

    def create_rate_limit_window(self, client_id, limit=100, window_seconds=60):
        """Rate limiting with TTL-based windows"""
        window = {
            'id': f"ratelimit_{client_id}_{int(datetime.utcnow().timestamp() / window_seconds)}",
            'partitionKey': client_id,
            'count': 1,
            'limit': limit,
            'windowStart': datetime.utcnow().isoformat(),
            'ttl': window_seconds * 2  # Keep slightly longer than window
        }
        return self.container.upsert_item(window)

    def create_scheduled_task(self, task_id, execute_at, task_data):
        """Tasks that auto-delete after execution window"""
        execution_time = datetime.fromisoformat(execute_at)
        now = datetime.utcnow()

        # Calculate TTL to expire 1 hour after scheduled execution
        ttl_seconds = int((execution_time - now).total_seconds()) + 3600

        task = {
            'id': task_id,
            'partitionKey': 'scheduled_tasks',
            'executeAt': execute_at,
            'taskData': task_data,
            'status': 'pending',
            'ttl': max(ttl_seconds, 3600)  # Minimum 1 hour
        }
        return self.container.create_item(task)
```

## Monitoring TTL Deletions

```csharp
// C# - Monitoring TTL using Change Feed
public class TTLMonitor
{
    private readonly Container _container;

    public async Task MonitorDeletions(CancellationToken cancellationToken)
    {
        var changeFeedProcessor = _container
            .GetChangeFeedProcessorBuilder<ExpandoObject>(
                "ttlMonitor",
                HandleChangesAsync)
            .WithInstanceName("instance1")
            .WithLeaseContainer(_leaseContainer)
            .Build();

        await changeFeedProcessor.StartAsync();
    }

    private async Task HandleChangesAsync(
        IReadOnlyCollection<ExpandoObject> changes,
        CancellationToken cancellationToken)
    {
        foreach (dynamic change in changes)
        {
            // Check for TTL deletion indicator
            if (change._deleted == true && change._ttlExpired == true)
            {
                Console.WriteLine($"Item {change.id} expired due to TTL");

                // Log or handle the expiration
                await LogExpiration(change.id, change._ts);
            }
        }
    }
}
```

## TTL with Different Data Tiers

```typescript
// TypeScript - Tiered data management with TTL
interface DataTierConfig {
    hot: number;    // TTL in seconds for hot data
    warm: number;   // TTL for warm data
    cold: number;   // TTL for cold data
}

class TieredDataManager {
    private container: Container;
    private tiers: DataTierConfig = {
        hot: 3600,         // 1 hour
        warm: 86400 * 7,   // 1 week
        cold: 86400 * 90   // 90 days
    };

    async createDataItem(data: any, tier: 'hot' | 'warm' | 'cold') {
        const item = {
            id: `${tier}_${Date.now()}`,
            partitionKey: data.category,
            tier: tier,
            data: data,
            createdAt: new Date().toISOString(),
            ttl: this.tiers[tier]
        };

        return await this.container.items.create(item);
    }

    async promoteToWarmer(itemId: string, partitionKey: string) {
        const { resource: item } = await this.container
            .item(itemId, partitionKey)
            .read();

        // Upgrade tier and extend TTL
        if (item.tier === 'cold') {
            item.tier = 'warm';
            item.ttl = this.tiers.warm;
        } else if (item.tier === 'warm') {
            item.tier = 'hot';
            item.ttl = this.tiers.hot;
        }

        item.promotedAt = new Date().toISOString();

        return await this.container
            .item(itemId, partitionKey)
            .replace(item);
    }

    async archiveItem(itemId: string, partitionKey: string) {
        const { resource: item } = await this.container
            .item(itemId, partitionKey)
            .read();

        // Set TTL to -1 for permanent storage
        item.tier = 'archived';
        item.ttl = -1;
        item.archivedAt = new Date().toISOString();

        return await this.container
            .item(itemId, partitionKey)
            .replace(item);
    }
}
```

## Best Practices

1. **Plan TTL values carefully**: Consider business requirements
2. **Use -1 for important data**: Prevent accidental deletion
3. **Monitor via Change Feed**: Track TTL deletions for audit
4. **Test expiration timing**: TTL isn't instantaneous
5. **Consider RU impact**: Deletions consume throughput

TTL is a powerful feature for automatic data lifecycle management, reducing storage costs and ensuring compliance with data retention policies without manual intervention.
