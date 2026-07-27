---
title: "Azure Cosmos DB Partition Strategies for Optimal Performance"
author: "Michael John Peña"
draft: false
date: 2021-08-07
tags: ["Azure", "Cosmos DB", "Partitioning", "NoSQL", "Performance"]

---

I wrote "Azure Cosmos DB Partition Strategies for Optimal Performance" to share practical, production-minded guidance on this topic.

## Understanding Partitions

Cosmos DB uses two types of partitions:
- **Logical partitions**: Groups of items with the same partition key value
- **Physical partitions**: Internal resources that store logical partitions

```javascript
// Example document with partition key
{
    "id": "order-12345",
    "customerId": "cust-789",  // Potential partition key
    "orderDate": "2021-08-07",
    "items": [
        { "productId": "prod-1", "quantity": 2, "price": 29.99 },
        { "productId": "prod-2", "quantity": 1, "price": 49.99 }
    ],
    "total": 109.97,
    "status": "processing"
}
```

## Partition Key Selection Criteria

### High Cardinality Pattern

```javascript
// Good: Using customerId for customer-centric queries
const container = database.container("orders");

// Efficient point read
const { resource: order } = await container.item(
    "order-12345",
    "cust-789"  // Partition key value
).read();

// Efficient query within partition
const { resources: customerOrders } = await container.items
    .query({
        query: "SELECT * FROM c WHERE c.customerId = @customerId",
        parameters: [{ name: "@customerId", value: "cust-789" }]
    })
    .fetchAll();
```

### Composite Partition Keys

```javascript
// Using synthetic partition key for time-series data
function createDocument(sensorId, timestamp, reading) {
    const date = new Date(timestamp);
    const partitionKey = `${sensorId}_${date.getFullYear()}_${date.getMonth() + 1}`;

    return {
        id: `${sensorId}_${timestamp}`,
        partitionKey: partitionKey,  // Synthetic key
        sensorId: sensorId,
        timestamp: timestamp,
        reading: reading
    };
}

// Query within time range for a sensor
async function getSensorReadings(sensorId, year, month) {
    const partitionKey = `${sensorId}_${year}_${month}`;

    const { resources } = await container.items
        .query({
            query: "SELECT * FROM c WHERE c.partitionKey = @pk ORDER BY c.timestamp",
            parameters: [{ name: "@pk", value: partitionKey }]
        })
        .fetchAll();

    return resources;
}
```

## Avoiding Hot Partitions

```python
# Python example: Detecting hot partitions
from azure.cosmos import CosmosClient
from collections import Counter

def analyze_partition_distribution(container):
    """Analyze document distribution across partitions"""

    partition_counts = Counter()

    # Sample documents to analyze distribution
    query = "SELECT c.partitionKey FROM c"
    items = container.query_items(query=query, enable_cross_partition_query=True)

    for item in items:
        partition_counts[item['partitionKey']] += 1

    total_docs = sum(partition_counts.values())
    partition_count = len(partition_counts)

    # Calculate statistics
    avg_per_partition = total_docs / partition_count if partition_count > 0 else 0
    max_count = max(partition_counts.values()) if partition_counts else 0
    min_count = min(partition_counts.values()) if partition_counts else 0

    # Identify hot partitions (>2x average)
    hot_partitions = [
        (pk, count) for pk, count in partition_counts.items()
        if count > avg_per_partition * 2
    ]

    return {
        'total_documents': total_docs,
        'partition_count': partition_count,
        'average_per_partition': avg_per_partition,
        'max_partition_size': max_count,
        'min_partition_size': min_count,
        'hot_partitions': hot_partitions
    }
```

## Hierarchical Partition Keys (Preview)

```csharp
// C# using hierarchical partition keys
using Microsoft.Azure.Cosmos;

public class CosmosService
{
    private readonly Container _container;

    public async Task CreateContainerWithHierarchicalKeys()
    {
        var containerProperties = new ContainerProperties
        {
            Id = "orders",
            PartitionKeyPaths = new Collection<string>
            {
                "/tenantId",
                "/userId",
                "/sessionId"
            }
        };

        var container = await _database.CreateContainerIfNotExistsAsync(
            containerProperties,
            throughput: 10000
        );
    }

    public async Task<ItemResponse<Order>> CreateOrder(Order order)
    {
        var partitionKey = new PartitionKeyBuilder()
            .Add(order.TenantId)
            .Add(order.UserId)
            .Add(order.SessionId)
            .Build();

        return await _container.CreateItemAsync(order, partitionKey);
    }

    public async Task<FeedResponse<Order>> GetTenantOrders(string tenantId)
    {
        // Query at tenant level - spans all users and sessions
        var partitionKey = new PartitionKeyBuilder()
            .Add(tenantId)
            .Build();

        var query = new QueryDefinition("SELECT * FROM c")
            .WithParameter("@tenantId", tenantId);

        using var iterator = _container.GetItemQueryIterator<Order>(
            query,
            requestOptions: new QueryRequestOptions
            {
                PartitionKey = partitionKey
            }
        );

        return await iterator.ReadNextAsync();
    }
}
```

## Multi-Tenant Partition Strategies

```csharp
// Strategy 1: Tenant per partition
public class TenantPerPartitionStrategy
{
    public string GetPartitionKey(string tenantId, string entityId)
    {
        return tenantId;  // All tenant data in same partition
    }
}

// Strategy 2: Tenant + Entity Type
public class TenantEntityStrategy
{
    public string GetPartitionKey(string tenantId, string entityType)
    {
        return $"{tenantId}_{entityType}";  // Separate partitions per entity type
    }
}

// Strategy 3: Tenant + Time bucketing
public class TenantTimeBucketStrategy
{
    public string GetPartitionKey(string tenantId, DateTime timestamp)
    {
        var bucket = timestamp.ToString("yyyy-MM");
        return $"{tenantId}_{bucket}";  // Monthly buckets per tenant
    }
}
```

## Monitoring Partition Metrics

```bash
# Azure CLI to get partition key statistics
az cosmosdb sql container show \
    --resource-group myResourceGroup \
    --account-name mycosmosaccount \
    --database-name mydb \
    --name mycontainer \
    --query "resource.partitionKey"

# Get partition throughput distribution
az monitor metrics list \
    --resource /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DocumentDB/databaseAccounts/{account} \
    --metric "NormalizedRUConsumption" \
    --dimension "PartitionKeyRangeId" \
    --interval PT1H
```

Proper partition key design is fundamental to Cosmos DB success. Take time to analyze your access patterns and data distribution before finalizing your partition strategy.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
