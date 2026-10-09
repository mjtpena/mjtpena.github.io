---
title: Azure Cosmos DB Serverless - Pay Per Request Database
description: "We had a Cosmos DB Serverless conversation at the end of 2020 and I'm returning to it because the experience of using it in actual development over two…"
author: Michael John Pena
draft: false
date: 2021-03-07
url: /blog/cosmos-db-serverless/
tags:
  - Azure
  - Cosmos DB
  - Serverless
  - NoSQL
  - Database
---

We had a Cosmos DB Serverless conversation at the end of 2020 and I'm returning to it because the experience of using it in actual development over two months has sharpened my opinions. Consumption pricing—no minimum, pay per RU consumed—is the right model for dev/test, sporadic APIs, and anything in the "it works in production but traffic is unpredictable" category. The practical constraint is the 5,000 RU/s per container ceiling, which rules out Serverless for anything with burst-heavy workloads. Below I'm walking through three scenarios where Serverless wins and one where it definitively doesn't.

## Understanding Serverless vs Provisioned Throughput

| Aspect | Serverless | Provisioned Throughput |
|--------|------------|----------------------|
| Billing | Per request (RU/s consumed) | Per hour (RU/s reserved) |
| Max RU/s | 5,000 RU/s burst | Unlimited (manual scaling) |
| Best for | Intermittent workloads | Consistent high traffic |
| Scaling | Automatic | Manual or autoscale |
| Storage | Up to 50 GB per container | Unlimited |

## Creating a Serverless Account

```bash
# Create serverless Cosmos DB account
az cosmosdb create \
    --name mycosmosdb-serverless \
    --resource-group myResourceGroup \
    --locations regionName=eastus \
    --capabilities EnableServerless \
    --default-consistency-level Session

# Create database
az cosmosdb sql database create \
    --account-name mycosmosdb-serverless \
    --resource-group myResourceGroup \
    --name myDatabase

# Create container
az cosmosdb sql container create \
    --account-name mycosmosdb-serverless \
    --resource-group myResourceGroup \
    --database-name myDatabase \
    --name myContainer \
    --partition-key-path "/partitionKey"
```

## .NET SDK Integration

```csharp
// CosmosDbService.cs
using Microsoft.Azure.Cosmos;

public class CosmosDbService
{
    private readonly Container _container;

    public CosmosDbService(string connectionString, string databaseName, string containerName)
    {
        var cosmosClient = new CosmosClient(connectionString, new CosmosClientOptions
        {
            SerializerOptions = new CosmosSerializationOptions
            {
                PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase
            },
            ConnectionMode = ConnectionMode.Direct,
            MaxRetryAttemptsOnRateLimitedRequests = 9,
            MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30)
        });

        _container = cosmosClient.GetContainer(databaseName, containerName);
    }

    public async Task<T> CreateItemAsync<T>(T item, string partitionKey)
    {
        var response = await _container.CreateItemAsync(
            item,
            new PartitionKey(partitionKey));

        Console.WriteLine($"Request charge: {response.RequestCharge} RU");
        return response.Resource;
    }

    public async Task<T?> GetItemAsync<T>(string id, string partitionKey)
    {
        try
        {
            var response = await _container.ReadItemAsync<T>(
                id,
                new PartitionKey(partitionKey));

            Console.WriteLine($"Request charge: {response.RequestCharge} RU");
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return default;
        }
    }

    public async Task<IEnumerable<T>> QueryItemsAsync<T>(string query, string? partitionKey = null)
    {
        var queryDefinition = new QueryDefinition(query);
        var queryOptions = new QueryRequestOptions();

        if (partitionKey != null)
        {
            queryOptions.PartitionKey = new PartitionKey(partitionKey);
        }

        var results = new List<T>();
        double totalRU = 0;

        using var iterator = _container.GetItemQueryIterator<T>(queryDefinition, requestOptions: queryOptions);

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            totalRU += response.RequestCharge;
            results.AddRange(response);
        }

        Console.WriteLine($"Total request charge: {totalRU} RU");
        return results;
    }

    public async Task<T> UpsertItemAsync<T>(T item, string partitionKey)
    {
        var response = await _container.UpsertItemAsync(
            item,
            new PartitionKey(partitionKey));

        Console.WriteLine($"Request charge: {response.RequestCharge} RU");
        return response.Resource;
    }

    public async Task DeleteItemAsync(string id, string partitionKey)
    {
        var response = await _container.DeleteItemAsync<dynamic>(
            id,
            new PartitionKey(partitionKey));

        Console.WriteLine($"Request charge: {response.RequestCharge} RU");
    }
}
```

## Optimizing for Serverless

### 1. Efficient Partition Key Design

```csharp
// Good: Natural partition key with even distribution
public class Order
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string CustomerId { get; set; }  // Partition key
    public DateTime OrderDate { get; set; }
    public List<OrderItem> Items { get; set; } = new();
    public decimal Total { get; set; }
}

// Usage
var order = new Order
{
    CustomerId = "customer-123",
    OrderDate = DateTime.UtcNow,
    Items = new List<OrderItem> { /* items */ },
    Total = 99.99m
};

await cosmosService.CreateItemAsync(order, order.CustomerId);
```

### 2. Point Reads Over Queries

```csharp
// Efficient: Point read (1 RU for 1KB document)
var order = await cosmosService.GetItemAsync<Order>("order-id", "customer-123");

// Less efficient: Query (higher RU cost)
var orders = await cosmosService.QueryItemsAsync<Order>(
    "SELECT * FROM c WHERE c.id = 'order-id'");
```

### 3. Batch Operations

```csharp
public async Task<List<T>> CreateBatchAsync<T>(
    IEnumerable<T> items,
    Func<T, string> partitionKeySelector) where T : class
{
    var results = new List<T>();

    // Group items by partition key for transactional batch
    var groups = items.GroupBy(partitionKeySelector);

    foreach (var group in groups)
    {
        var batch = _container.CreateTransactionalBatch(new PartitionKey(group.Key));

        foreach (var item in group)
        {
            batch.CreateItem(item);
        }

        using var response = await batch.ExecuteAsync();

        if (response.IsSuccessStatusCode)
        {
            for (int i = 0; i < response.Count; i++)
            {
                results.Add(response.GetOperationResultAtIndex<T>(i).Resource);
            }
        }

        Console.WriteLine($"Batch request charge: {response.RequestCharge} RU");
    }

    return results;
}
```

### 4. Projection Queries

```csharp
// Return only needed fields to reduce RU cost
public async Task<IEnumerable<OrderSummary>> GetOrderSummariesAsync(string customerId)
{
    var query = @"
        SELECT c.id, c.orderDate, c.total
        FROM c
        WHERE c.customerId = @customerId";

    var queryDefinition = new QueryDefinition(query)
        .WithParameter("@customerId", customerId);

    var results = new List<OrderSummary>();

    using var iterator = _container.GetItemQueryIterator<OrderSummary>(
        queryDefinition,
        requestOptions: new QueryRequestOptions
        {
            PartitionKey = new PartitionKey(customerId)
        });

    while (iterator.HasMoreResults)
    {
        var response = await iterator.ReadNextAsync();
        results.AddRange(response);
    }

    return results;
}

public record OrderSummary(string Id, DateTime OrderDate, decimal Total);
```

## Azure Functions Integration

Perfect pairing for serverless architecture:

```csharp
// OrderFunction.cs
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

public class OrderFunction
{
    private readonly CosmosDbService _cosmosService;

    public OrderFunction(CosmosDbService cosmosService)
    {
        _cosmosService = cosmosService;
    }

    [Function("CreateOrder")]
    public async Task<HttpResponseData> CreateOrder(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        var order = await req.ReadFromJsonAsync<Order>();

        if (order == null)
        {
            var badRequest = req.CreateResponse(System.Net.HttpStatusCode.BadRequest);
            return badRequest;
        }

        order.Id = Guid.NewGuid().ToString();
        var created = await _cosmosService.CreateItemAsync(order, order.CustomerId);

        var response = req.CreateResponse(System.Net.HttpStatusCode.Created);
        await response.WriteAsJsonAsync(created);
        return response;
    }

    [Function("GetOrder")]
    public async Task<HttpResponseData> GetOrder(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "orders/{customerId}/{orderId}")]
        HttpRequestData req,
        string customerId,
        string orderId)
    {
        var order = await _cosmosService.GetItemAsync<Order>(orderId, customerId);

        if (order == null)
        {
            return req.CreateResponse(System.Net.HttpStatusCode.NotFound);
        }

        var response = req.CreateResponse(System.Net.HttpStatusCode.OK);
        await response.WriteAsJsonAsync(order);
        return response;
    }

    [Function("ProcessOrderChanges")]
    public void ProcessChanges(
        [CosmosDBTrigger(
            databaseName: "myDatabase",
            containerName: "orders",
            Connection = "CosmosDbConnection",
            LeaseContainerName = "leases",
            CreateLeaseContainerIfNotExists = true)]
        IReadOnlyList<Order> changes)
    {
        foreach (var order in changes)
        {
            Console.WriteLine($"Order changed: {order.Id}, Total: {order.Total}");
            // Process the change (send notifications, update analytics, etc.)
        }
    }
}
```

## Cost Optimization Tips

1. **Monitor RU consumption**: Use Azure Monitor to track usage patterns
2. **Optimize queries**: Always use partition keys in queries
3. **Consider provisioned throughput**: If consistent >$50/month, evaluate switching
4. **Use TTL**: Automatically delete old data to save storage costs

```csharp
// Enable TTL at container level
var containerProperties = new ContainerProperties
{
    Id = "myContainer",
    PartitionKeyPath = "/partitionKey",
    DefaultTimeToLive = -1  // Enables TTL, items need ttl property
};

// Set TTL on individual items
public class LogEntry
{
    public string Id { get; set; }
    public string PartitionKey { get; set; }
    public string Message { get; set; }

    [JsonPropertyName("ttl")]
    public int TimeToLive { get; set; } = 86400; // 24 hours
}
```

## Conclusion

Cosmos DB serverless is excellent for:
- Development and testing environments
- Applications with unpredictable or bursty traffic
- Microservices with low, intermittent throughput
- Event-driven architectures with Azure Functions

The consumption model eliminates capacity planning and reduces costs for workloads that don't need constant throughput. Combined with Azure Functions, it creates a truly serverless data tier.
