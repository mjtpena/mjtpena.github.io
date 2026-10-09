---
title: "Cosmos DB Integrated Cache: Reducing RU Costs at Scale"
description: "The Cosmos DB integrated cache is the feature I've been waiting for since the first time I watched a read-heavy application burn through its RU budget…"
author: Michael John Peña
draft: false
date: 2021-05-07
tags:
  - Azure
  - Cosmos DB
  - Caching
  - Data
  - Performance
---

The Cosmos DB integrated cache is the feature I've been waiting for since the first time I watched a read-heavy application burn through its RU budget querying the same hot documents repeatedly. The dedicated gateway hosts an in-memory cache keyed on query text and partition key; repeated queries return cached results without consuming RUs from the container. The cost is the dedicated gateway nodes (separate billing from the Cosmos account), so the break-even depends on your read volume and RU pricing tier. For applications where the top 10% of queries account for 80% of reads—browse pages, product catalogues, reference data endpoints—the RU savings typically justify the gateway cost within weeks.

## The Problem It Solves

Before integrated cache, the pattern for reducing Cosmos DB costs was:
1. Deploy Redis or another cache
2. Implement cache-aside pattern in application code
3. Handle cache invalidation
4. Manage another service

This works but adds complexity. The integrated cache handles all of this at the database level.

## How It Works

The integrated cache is a dedicated gateway that:
- Caches frequently accessed items
- Serves reads from cache when possible
- Automatically invalidates on writes
- Integrates with existing SDK

```
Application -> Dedicated Gateway (Cache) -> Cosmos DB
```

You don't change your application code - just the connection mode.

## Enabling Integrated Cache

First, create a dedicated gateway for your Cosmos account:

```bash
az cosmosdb create \
    --name mycosmosaccount \
    --resource-group myresourcegroup \
    --default-consistency-level Session \
    --enable-dedicated-gateway true \
    --dedicated-gateway-size "CosmosDb.D4s"

# Or add to existing account
az cosmosdb update \
    --name mycosmosaccount \
    --resource-group myresourcegroup \
    --enable-dedicated-gateway true \
    --dedicated-gateway-size "CosmosDb.D4s"
```

## Connecting Through the Gateway

Update your connection to use gateway mode:

```csharp
// C# SDK example
using Microsoft.Azure.Cosmos;

var options = new CosmosClientOptions
{
    ConnectionMode = ConnectionMode.Gateway,
    // Use the dedicated gateway endpoint
    ApplicationPreferredRegions = new List<string> { "East US" }
};

// Use the dedicated gateway connection string
var client = new CosmosClient(
    "https://myaccount-eastus.sql.cosmos.azure.com:443/",
    "<your-key>",
    options
);

// Configure item request options for caching
var requestOptions = new ItemRequestOptions
{
    DedicatedGatewayRequestOptions = new DedicatedGatewayRequestOptions
    {
        MaxIntegratedCacheStaleness = TimeSpan.FromMinutes(5)
    }
};

// This read can be served from cache
var response = await container.ReadItemAsync<Product>(
    id: "product-123",
    partitionKey: new PartitionKey("electronics"),
    requestOptions: requestOptions
);

Console.WriteLine($"Cache hit: {response.Diagnostics.GetCacheDiagnostics().CacheHit}");
```

## Python SDK Usage

```python
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient

# Synchronous client
client = CosmosClient(
    url="https://myaccount-eastus.sql.cosmos.azure.com:443/",
    credential="<your-key>"
)

database = client.get_database_client("mydb")
container = database.get_container_client("products")

# Read with cache settings
response = container.read_item(
    item="product-123",
    partition_key="electronics",
    max_integrated_cache_staleness_in_ms=300000  # 5 minutes
)

# Query with caching
query = "SELECT * FROM c WHERE c.category = @category"
parameters = [{"name": "@category", "value": "electronics"}]

items = container.query_items(
    query=query,
    parameters=parameters,
    max_integrated_cache_staleness_in_ms=300000
)

for item in items:
    print(item)
```

## Cache Staleness Configuration

The `MaxIntegratedCacheStaleness` setting controls how long cached data is valid:

```csharp
// Different staleness for different operations
public class CacheConfiguration
{
    // Product catalog - can be stale for longer
    public static readonly TimeSpan ProductCacheDuration = TimeSpan.FromMinutes(15);

    // Inventory levels - need fresher data
    public static readonly TimeSpan InventoryCacheDuration = TimeSpan.FromSeconds(30);

    // Pricing - real-time required
    public static readonly TimeSpan PricingCacheDuration = TimeSpan.Zero;
}

// Apply per request
var options = new ItemRequestOptions
{
    DedicatedGatewayRequestOptions = new DedicatedGatewayRequestOptions
    {
        MaxIntegratedCacheStaleness = CacheConfiguration.ProductCacheDuration
    }
};
```

## Query Caching

Queries are also cached:

```csharp
// This query result will be cached
var queryDefinition = new QueryDefinition(
    "SELECT * FROM c WHERE c.category = @category ORDER BY c.name")
    .WithParameter("@category", "electronics");

var queryOptions = new QueryRequestOptions
{
    PartitionKey = new PartitionKey("electronics"),
    DedicatedGatewayRequestOptions = new DedicatedGatewayRequestOptions
    {
        MaxIntegratedCacheStaleness = TimeSpan.FromMinutes(5)
    }
};

using var resultSet = container.GetItemQueryIterator<Product>(
    queryDefinition,
    requestOptions: queryOptions
);

while (resultSet.HasMoreResults)
{
    var response = await resultSet.ReadNextAsync();
    // First request hits DB, subsequent requests (within staleness window) hit cache
}
```

## Sizing the Dedicated Gateway

Choose gateway size based on your workload:

| Size | vCPUs | Memory | Cache Size | Price/hour |
|------|-------|--------|------------|------------|
| D4s | 4 | 16 GB | ~8 GB | ~$0.35 |
| D8s | 8 | 32 GB | ~16 GB | ~$0.70 |
| D16s | 16 | 64 GB | ~32 GB | ~$1.40 |

Estimate cache size needs:
```python
# Calculate approximate cache requirements
average_item_size_kb = 2  # KB per document
unique_items_accessed = 100000  # Items accessed in cache window
query_result_overhead = 1.5  # Queries store more than raw items

cache_needed_gb = (average_item_size_kb * unique_items_accessed * query_result_overhead) / (1024 * 1024)
print(f"Estimated cache needed: {cache_needed_gb:.2f} GB")
```

## Cache Invalidation

The cache is automatically invalidated on writes:

```csharp
// Write operation automatically invalidates cache
await container.UpsertItemAsync(updatedProduct, new PartitionKey(updatedProduct.Category));

// Next read will get fresh data from database
var fresh = await container.ReadItemAsync<Product>(
    updatedProduct.Id,
    new PartitionKey(updatedProduct.Category)
);
```

For cross-region scenarios, invalidation propagates across regions but with some delay.

## Monitoring Cache Performance

Track cache effectiveness with diagnostics:

```csharp
public class CacheMetrics
{
    public int CacheHits { get; set; }
    public int CacheMisses { get; set; }
    public double HitRatio => CacheHits + CacheMisses > 0
        ? (double)CacheHits / (CacheHits + CacheMisses)
        : 0;
}

public async Task<T> ReadWithMetrics<T>(Container container, string id, string partitionKey, CacheMetrics metrics)
{
    var response = await container.ReadItemAsync<T>(
        id,
        new PartitionKey(partitionKey),
        new ItemRequestOptions
        {
            DedicatedGatewayRequestOptions = new DedicatedGatewayRequestOptions
            {
                MaxIntegratedCacheStaleness = TimeSpan.FromMinutes(5)
            }
        }
    );

    var diagnostics = response.Diagnostics.ToString();
    if (diagnostics.Contains("\"CacheHit\":true"))
    {
        metrics.CacheHits++;
    }
    else
    {
        metrics.CacheMisses++;
    }

    return response.Resource;
}
```

## When to Use Integrated Cache

**Good fit:**
- Read-heavy workloads (>80% reads)
- Hot data patterns (same items read repeatedly)
- Point reads and simple queries
- Cost-sensitive applications

**Not ideal for:**
- Write-heavy workloads
- Unique reads (every read is different)
- Real-time requirements (can't tolerate staleness)
- Cross-partition queries

## Cost Analysis

Compare total costs with and without cache:

```
Without cache:
- 1M reads/day at 5 RU each = 5M RU/day
- At $0.10 per 100 RU/s/hour = ~$35/day

With cache (90% hit rate):
- 100K reads hit DB = 500K RU/day
- Gateway cost: D4s = ~$8.40/day
- Total: ~$5 + $8.40 = ~$13.40/day

Savings: ~$21.60/day = ~$650/month
```

The break-even depends on your read patterns and hit rate.

## Migration Strategy

Adopting integrated cache is low-risk:

1. Enable dedicated gateway on your account
2. Update connection strings in non-production
3. Test and measure cache hit rates
4. Adjust staleness settings based on requirements
5. Roll out to production
6. Monitor and optimize

If issues arise, simply revert to direct mode - no data changes required.

## Resources

- [Integrated Cache Documentation](https://docs.microsoft.com/en-us/azure/cosmos-db/integrated-cache)
- [Dedicated Gateway Overview](https://docs.microsoft.com/en-us/azure/cosmos-db/dedicated-gateway)
- [Cost Optimization Guide](https://docs.microsoft.com/en-us/azure/cosmos-db/plan-manage-costs)
