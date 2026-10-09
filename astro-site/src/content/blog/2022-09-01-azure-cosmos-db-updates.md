---
title: "Azure Cosmos DB Updates - September 2022"
description: "The latest updates bring significant performance enhancements to Cosmos DB, including optimized query execution and improved throughput management."
author: "Michael John Peña"
draft: false
date: 2022-09-01
tags: ["Azure", "Cosmos DB", "NoSQL", "Database"]
---

## Key Updates Overview

### Performance Improvements

The latest updates bring significant performance enhancements to Cosmos DB, including optimized query execution and improved throughput management.

```csharp
using Microsoft.Azure.Cosmos;

// Initialize Cosmos Client with latest SDK
var cosmosClient = new CosmosClient(
    connectionString,
    new CosmosClientOptions
    {
        ApplicationName = "MyApp",
        ConnectionMode = ConnectionMode.Direct,
        ConsistencyLevel = ConsistencyLevel.Session
    });

// Create database with autoscale throughput
var database = await cosmosClient.CreateDatabaseIfNotExistsAsync(
    "ProductsDB",
    ThroughputProperties.CreateAutoscaleThroughput(4000));

// Create container with optimized indexing
var containerProperties = new ContainerProperties("Items", "/categoryId")
{
    IndexingPolicy = new IndexingPolicy
    {
        Automatic = true,
        IndexingMode = IndexingMode.Consistent,
        IncludedPaths = { new IncludedPath { Path = "/*" } },
        ExcludedPaths = { new ExcludedPath { Path = "/largeTextField/?" } }
    }
};

var container = await database.CreateContainerIfNotExistsAsync(containerProperties);
```

### SDK Improvements

The .NET SDK has been updated with better diagnostics and retry policies:

```csharp
// Enhanced diagnostics
var response = await container.ReadItemAsync<Product>(
    id: "product-123",
    partitionKey: new PartitionKey("electronics"));

// Access detailed diagnostics
Console.WriteLine($"Request charge: {response.RequestCharge} RUs");
Console.WriteLine($"Diagnostics: {response.Diagnostics}");

// Custom retry policy
var options = new CosmosClientOptions
{
    MaxRetryAttemptsOnRateLimitedRequests = 9,
    MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30)
};
```

### Query Optimization Tips

Take advantage of the new query plan caching:

```csharp
// Use parameterized queries for better caching
var queryDefinition = new QueryDefinition(
    "SELECT * FROM c WHERE c.categoryId = @categoryId AND c.price > @minPrice")
    .WithParameter("@categoryId", "electronics")
    .WithParameter("@minPrice", 100);

var queryOptions = new QueryRequestOptions
{
    MaxItemCount = 100,
    PartitionKey = new PartitionKey("electronics")
};

using var resultSetIterator = container.GetItemQueryIterator<Product>(
    queryDefinition,
    requestOptions: queryOptions);

while (resultSetIterator.HasMoreResults)
{
    var response = await resultSetIterator.ReadNextAsync();
    foreach (var product in response)
    {
        Console.WriteLine($"Product: {product.Name}, Price: {product.Price}");
    }
}
```

## Best Practices

1. **Use the latest SDK** - Always keep your SDK updated for the latest optimizations
2. **Monitor RU consumption** - Use Azure Monitor to track Request Unit usage
3. **Optimize partition keys** - Choose partition keys that distribute data evenly
4. **Enable diagnostics** - Use built-in diagnostics for troubleshooting

These updates make Cosmos DB an even more powerful choice for globally distributed applications requiring low latency and high availability.
