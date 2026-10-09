---
title: "Azure Cosmos DB Serverless: Pay-Per-Request Pricing"
description: "Cosmos DB Serverless: scale-to-zero for your NoSQL workloads."
author: Michael John Peña
draft: false
date: 2021-01-09
tags:
  - Azure
  - Cosmos DB
  - Serverless
  - NoSQL
---

## Serverless vs Provisioned

| Aspect | Serverless | Provisioned |
|--------|------------|-------------|
| Pricing | Per request | Per hour |
| Scaling | Automatic | Manual/Auto |
| Best for | Sporadic traffic | Steady traffic |
| Max RU/s | 5,000 | Unlimited |

## Create Serverless Account

```bash
# Create serverless Cosmos DB account
az cosmosdb create \
    --name mycosmosdb \
    --resource-group myRG \
    --capabilities EnableServerless \
    --default-consistency-level Session \
    --locations regionName=eastus
```

## Create Database and Container

```csharp
using Microsoft.Azure.Cosmos;

// Connect to serverless account
var client = new CosmosClient(connectionString);

// Create database
var database = await client.CreateDatabaseIfNotExistsAsync("ecommerce");

// Create container (no throughput specification for serverless)
var container = await database.Database.CreateContainerIfNotExistsAsync(
    new ContainerProperties
    {
        Id = "orders",
        PartitionKeyPath = "/customerId"
    }
);
```

## CRUD Operations

```csharp
// Create item
var order = new Order
{
    Id = Guid.NewGuid().ToString(),
    CustomerId = "customer-123",
    Items = new[] { new OrderItem { ProductId = "prod-1", Quantity = 2 } },
    Total = 99.99m,
    CreatedAt = DateTime.UtcNow
};

var response = await container.CreateItemAsync(order, new PartitionKey(order.CustomerId));
Console.WriteLine($"Request charge: {response.RequestCharge} RUs");

// Read item
var readResponse = await container.ReadItemAsync<Order>(
    order.Id,
    new PartitionKey(order.CustomerId)
);
Console.WriteLine($"Read cost: {readResponse.RequestCharge} RUs");

// Query items
var query = new QueryDefinition("SELECT * FROM c WHERE c.customerId = @customerId")
    .WithParameter("@customerId", "customer-123");

var iterator = container.GetItemQueryIterator<Order>(query);
double totalRUs = 0;

while (iterator.HasMoreResults)
{
    var batch = await iterator.ReadNextAsync();
    totalRUs += batch.RequestCharge;
    foreach (var item in batch)
    {
        Console.WriteLine($"Order: {item.Id}");
    }
}
Console.WriteLine($"Query cost: {totalRUs} RUs");
```

## Optimize Request Units

```csharp
// Use point reads instead of queries when possible
// Point read: ~1 RU for 1KB document
var item = await container.ReadItemAsync<Order>(id, partitionKey);

// Query: 2.3+ RUs minimum
var query = container.GetItemQueryIterator<Order>(
    "SELECT * FROM c WHERE c.id = 'order-123'"
);

// Index only what you query
var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId",
    IndexingPolicy = new IndexingPolicy
    {
        IndexingMode = IndexingMode.Consistent,
        IncludedPaths = { new IncludedPath { Path = "/status/*" } },
        ExcludedPaths = { new ExcludedPath { Path = "/*" } }
    }
};
```

## Batch Operations

```csharp
// Transactional batch (same partition key)
var batch = container.CreateTransactionalBatch(new PartitionKey("customer-123"));

batch.CreateItem(order1);
batch.CreateItem(order2);
batch.UpsertItem(order3);

var batchResponse = await batch.ExecuteAsync();
Console.WriteLine($"Batch cost: {batchResponse.RequestCharge} RUs");
```

## When to Use Serverless

- Development and testing environments
- Applications with variable/unpredictable traffic
- New projects validating usage patterns
- Workloads with idle periods
- Low-throughput scenarios (<5,000 RU/s)

## Cost Example

```
Scenario: 1 million requests/month, 10GB storage

Serverless:
- Requests: 1M × $0.25/million = $0.25
- Storage: 10GB × $0.25/GB = $2.50
- Total: ~$2.75/month

Provisioned (400 RU/s):
- Throughput: 400 × $0.008/hour × 730 = ~$23.36
- Storage: 10GB × $0.25/GB = $2.50
- Total: ~$25.86/month
```

Cosmos DB Serverless: scale-to-zero for your NoSQL workloads.
