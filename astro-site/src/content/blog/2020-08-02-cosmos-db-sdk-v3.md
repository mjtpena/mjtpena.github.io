---
title: "Working with Azure Cosmos DB SDK v3 for .NET"
author: Michael John Peña
draft: false
date: 2020-08-02
tags:
  - Azure
  - Cosmos DB
  - .NET Core
  - NoSQL
---

SDK v3 has been out for about a year now and I've finally migrated all the Cosmos work I had on v2. The migration was less painful than I expected — the API surface is cleaner, the LINQ provider actually behaves, and the new fluent client options removed a class of "why is this not working" issues that I used to lose afternoons to. Notes from the patterns I keep reusing.

## Setting Up the SDK

```bash
dotnet add package Microsoft.Azure.Cosmos
```

## Creating the Cosmos Client

The SDK v3 uses a simplified client model:

```csharp
using Microsoft.Azure.Cosmos;

public class CosmosService
{
    private readonly CosmosClient _cosmosClient;
    private readonly Container _container;

    public CosmosService(string connectionString)
    {
        var options = new CosmosClientOptions
        {
            SerializerOptions = new CosmosSerializationOptions
            {
                PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase
            },
            ConnectionMode = ConnectionMode.Direct
        };

        _cosmosClient = new CosmosClient(connectionString, options);
        _container = _cosmosClient.GetContainer("MyDatabase", "MyContainer");
    }
}
```

## CRUD Operations

The repository pattern I keep ending up at — partition key passed explicitly, `NotFound` swallowed on read so callers get null instead of an exception:

```csharp
public class Product
{
    public string Id { get; set; }
    public string Category { get; set; }
    public string Name { get; set; }
    public decimal Price { get; set; }
}

public class ProductRepository
{
    private readonly Container _container;

    public ProductRepository(Container container)
    {
        _container = container;
    }

    // Create
    public async Task<Product> CreateAsync(Product product)
    {
        product.Id = Guid.NewGuid().ToString();
        var response = await _container.CreateItemAsync(
            product,
            new PartitionKey(product.Category));
        return response.Resource;
    }

    // Read
    public async Task<Product> GetAsync(string id, string category)
    {
        try
        {
            var response = await _container.ReadItemAsync<Product>(
                id,
                new PartitionKey(category));
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    // Update
    public async Task<Product> UpdateAsync(Product product)
    {
        var response = await _container.UpsertItemAsync(
            product,
            new PartitionKey(product.Category));
        return response.Resource;
    }

    // Delete
    public async Task DeleteAsync(string id, string category)
    {
        await _container.DeleteItemAsync<Product>(
            id,
            new PartitionKey(category));
    }
}
```

## Querying with LINQ

SDK v3 has excellent LINQ support:

```csharp
public async Task<List<Product>> GetProductsByCategoryAsync(string category)
{
    var query = _container.GetItemLinqQueryable<Product>()
        .Where(p => p.Category == category && p.Price > 10)
        .OrderBy(p => p.Name)
        .ToFeedIterator();

    var results = new List<Product>();
    while (query.HasMoreResults)
    {
        var response = await query.ReadNextAsync();
        results.AddRange(response);
    }
    return results;
}
```

## Using SQL Queries

For complex queries, you can use SQL directly:

```csharp
public async Task<List<Product>> SearchProductsAsync(string searchTerm)
{
    var queryDefinition = new QueryDefinition(
        "SELECT * FROM c WHERE CONTAINS(c.name, @searchTerm)")
        .WithParameter("@searchTerm", searchTerm);

    var query = _container.GetItemQueryIterator<Product>(queryDefinition);

    var results = new List<Product>();
    while (query.HasMoreResults)
    {
        var response = await query.ReadNextAsync();
        results.AddRange(response);
    }
    return results;
}
```

## Batch Operations

For better performance with multiple operations:

```csharp
public async Task CreateBatchAsync(List<Product> products, string category)
{
    var batch = _container.CreateTransactionalBatch(new PartitionKey(category));

    foreach (var product in products)
    {
        batch.CreateItem(product);
    }

    var response = await batch.ExecuteAsync();

    if (!response.IsSuccessStatusCode)
    {
        throw new Exception($"Batch operation failed: {response.StatusCode}");
    }
}
```

## Request Units Monitoring

Always monitor your RU consumption:

```csharp
var response = await _container.CreateItemAsync(product, new PartitionKey(product.Category));
Console.WriteLine($"Request charge: {response.RequestCharge} RUs");
```

## Things I learned the hard way

- **The CosmosClient is meant to be a singleton.** I once had a function that new'd up a client per invocation. The cold-start was awful and the connection pool churn made the whole thing flaky. Register it once in DI; reuse it everywhere.
- **Partition key choice is forever.** You cannot change it without rebuilding the container. Pick the value that distributes writes evenly *and* matches your most common read path. This is the single decision that drives your bill.
- **Direct mode + TCP** is meaningfully faster than Gateway mode in production, but be aware it needs outbound TCP on a wider port range — that has caught me out behind a corporate firewall before.
- **Watch the RU charge on every query.** `response.RequestCharge` is the number that tells you whether you've written a query you can afford to run a million times a day.

Cosmos isn't the right database for everything — it's expensive when misused and the consistency model trips people up — but for the workloads where it fits, SDK v3 is the first version where the developer experience finally matches the platform.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
