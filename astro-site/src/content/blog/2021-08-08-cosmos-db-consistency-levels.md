---
title: "Understanding Cosmos DB Consistency Levels: Tradeoffs and Best Practices"
author: "Michael John Peña"
draft: false
date: 2021-08-08
tags: ["Azure", "Cosmos DB", "Consistency", "Distributed Systems", "NoSQL"]

---

I wrote "Understanding Cosmos DB Consistency Levels: Tradeoffs and Best Practices" to share practical, production-minded guidance on this topic.

## The Five Consistency Levels

From strongest to weakest:
1. **Strong** - Linearizable reads, always returns most recent committed write
2. **Bounded Staleness** - Reads lag behind writes by at most K versions or T time
3. **Session** - Consistent within a session, eventual across sessions
4. **Consistent Prefix** - Reads never see out-of-order writes
5. **Eventual** - No ordering guarantee, maximum availability

## Setting Default Consistency

```bash
# Set account-level default consistency
az cosmosdb update \
    --resource-group myResourceGroup \
    --name mycosmosaccount \
    --default-consistency-level Session

# For bounded staleness, specify bounds
az cosmosdb update \
    --resource-group myResourceGroup \
    --name mycosmosaccount \
    --default-consistency-level BoundedStaleness \
    --max-staleness-prefix 100 \
    --max-interval 5
```

## Per-Request Consistency Override

```javascript
// JavaScript SDK - override consistency per request
const { CosmosClient, ConsistencyLevel } = require("@azure/cosmos");

const client = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    consistencyLevel: ConsistencyLevel.Session  // Default
});

const container = client.database("mydb").container("mycontainer");

// Strong consistency for critical read
async function getCriticalData(id, partitionKey) {
    const { resource } = await container.item(id, partitionKey).read({
        consistencyLevel: ConsistencyLevel.Strong
    });
    return resource;
}

// Eventual consistency for non-critical analytics
async function getAnalyticsData() {
    const { resources } = await container.items
        .query("SELECT * FROM c WHERE c.type = 'analytics'", {
            consistencyLevel: ConsistencyLevel.Eventual
        })
        .fetchAll();
    return resources;
}
```

## Session Consistency Implementation

```csharp
// C# - Maintaining session consistency across requests
public class CosmosSessionManager
{
    private readonly Container _container;
    private string _sessionToken;

    public CosmosSessionManager(Container container)
    {
        _container = container;
    }

    public async Task<T> CreateItemAsync<T>(T item, string partitionKey)
    {
        var response = await _container.CreateItemAsync(
            item,
            new PartitionKey(partitionKey),
            new ItemRequestOptions { SessionToken = _sessionToken }
        );

        // Store session token for subsequent reads
        _sessionToken = response.Headers.Session;
        return response.Resource;
    }

    public async Task<T> ReadItemAsync<T>(string id, string partitionKey)
    {
        var response = await _container.ReadItemAsync<T>(
            id,
            new PartitionKey(partitionKey),
            new ItemRequestOptions { SessionToken = _sessionToken }
        );

        _sessionToken = response.Headers.Session;
        return response.Resource;
    }

    public async Task<List<T>> QueryItemsAsync<T>(string query, string partitionKey)
    {
        var queryDefinition = new QueryDefinition(query);
        var queryRequestOptions = new QueryRequestOptions
        {
            PartitionKey = new PartitionKey(partitionKey),
            SessionToken = _sessionToken
        };

        var results = new List<T>();
        using var iterator = _container.GetItemQueryIterator<T>(
            queryDefinition,
            requestOptions: queryRequestOptions
        );

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            _sessionToken = response.Headers.Session;
            results.AddRange(response);
        }

        return results;
    }
}
```

## Bounded Staleness Configuration

```python
# Python - Working with bounded staleness
from azure.cosmos import CosmosClient, ConsistencyLevel
from datetime import datetime, timedelta

def configure_bounded_staleness():
    """
    Bounded staleness guarantees:
    - max_staleness_prefix: Maximum versions behind (K)
    - max_interval_in_seconds: Maximum time behind (T)
    """

    client = CosmosClient(
        url=COSMOS_ENDPOINT,
        credential=COSMOS_KEY,
        consistency_level=ConsistencyLevel.BoundedStaleness
    )

    # With bounded staleness, you get:
    # - Consistent reads within a region (in order)
    # - Cross-region reads may lag by configured bounds
    # - Better latency than Strong
    # - Predictable staleness window

    return client

def demonstrate_staleness_impact():
    """
    In a multi-region setup with bounded staleness:

    Write Region (West US) -> Read Region (East US)

    If max_interval = 5 seconds:
    - Write at T=0 in West US
    - Read in East US at T=3 might not see the write
    - Read in East US at T=6 will definitely see the write
    """
    pass
```

## Consistency Level Selection Guide

```typescript
// TypeScript - Consistency level selector based on use case
interface ConsistencyConfig {
    level: string;
    useCase: string;
    latencyImpact: string;
    costImpact: string;
}

const consistencyGuide: Record<string, ConsistencyConfig> = {
    "financialTransactions": {
        level: "Strong",
        useCase: "Bank transfers, inventory counts",
        latencyImpact: "Higher (cross-region sync)",
        costImpact: "2x RU consumption"
    },
    "socialMediaFeed": {
        level: "ConsistentPrefix",
        useCase: "Social feeds, activity streams",
        latencyImpact: "Low",
        costImpact: "Standard"
    },
    "shoppingCart": {
        level: "Session",
        useCase: "User sessions, shopping carts",
        latencyImpact: "Low within session",
        costImpact: "Standard"
    },
    "analyticsData": {
        level: "Eventual",
        useCase: "Analytics, recommendations",
        latencyImpact: "Lowest",
        costImpact: "Lowest"
    },
    "multiRegionCritical": {
        level: "BoundedStaleness",
        useCase: "Global apps needing predictable lag",
        latencyImpact: "Medium",
        costImpact: "Slightly higher"
    }
};

function selectConsistencyLevel(scenario: string): string {
    const config = consistencyGuide[scenario];
    if (!config) {
        // Default to Session for unknown scenarios
        return "Session";
    }
    return config.level;
}
```

## Monitoring Consistency

```sql
-- Check consistency-related metrics via diagnostic logs
-- In Log Analytics workspace

// Request latency by consistency level
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| where Category == "DataPlaneRequests"
| summarize
    avgLatency = avg(duration_s),
    p99Latency = percentile(duration_s, 99),
    count = count()
by consistencyLevel_s, bin(TimeGenerated, 1h)

// RU consumption by consistency level
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| where Category == "DataPlaneRequests"
| summarize
    totalRU = sum(requestCharge_s),
    avgRU = avg(requestCharge_s)
by consistencyLevel_s, operationType_s
```

## Best Practices

1. **Start with Session**: It's the default for good reason
2. **Use Strong sparingly**: Reserve for truly critical operations
3. **Pass session tokens**: Maintain consistency in distributed systems
4. **Monitor RU impact**: Strong consistency doubles read costs
5. **Test multi-region behavior**: Understand latency implications

Consistency levels in Cosmos DB give you fine-grained control over the CAP theorem tradeoffs, enabling you to optimize for your specific application requirements.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
