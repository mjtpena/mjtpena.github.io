---
title: "Azure Cosmos DB Best Practices for 2022"
author: Michael John Peña
draft: false
date: 2022-11-26
tags:
  - Azure
  - Cosmos DB
  - NoSQL
  - Database
  - Performance
---

## Partition Key Strategy

The partition key decision is crucial and difficult to change later:

```csharp
// Good: High cardinality, evenly distributed
public class Order
{
    [JsonProperty("id")]
    public string Id { get; set; }

    [JsonProperty("partitionKey")]
    public string CustomerId { get; set; }  // Good partition key

    public DateTime OrderDate { get; set; }
    public List<OrderItem> Items { get; set; }
}

// For write-heavy scenarios, consider synthetic partition keys
public class TelemetryEvent
{
    [JsonProperty("id")]
    public string Id { get; set; }

    [JsonProperty("partitionKey")]
    public string PartitionKey => $"{DeviceId}_{DateTime.UtcNow:yyyyMMddHH}";

    public string DeviceId { get; set; }
    public DateTime Timestamp { get; set; }
    public double Value { get; set; }
}
```

## Hierarchical Partition Keys (Preview)

New in 2022 - partition up to 3 levels:

```csharp
// Enable hierarchical partition keys for multi-tenant scenarios
var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPaths = new List<string>
    {
        "/tenantId",
        "/year",
        "/customerId"
    }
};

await database.CreateContainerAsync(containerProperties);

// Query efficiently at any level
var query = container.GetItemQueryIterator<Order>(
    "SELECT * FROM c WHERE c.tenantId = 'tenant1' AND c.year = 2022"
);
```

## Indexing Strategy

Optimize indexing for your query patterns:

```json
{
  "indexingMode": "consistent",
  "automatic": true,
  "includedPaths": [
    {
      "path": "/customerId/*"
    },
    {
      "path": "/orderDate/*"
    },
    {
      "path": "/status/*"
    }
  ],
  "excludedPaths": [
    {
      "path": "/items/*"
    },
    {
      "path": "/metadata/*"
    },
    {
      "path": "/_etag/?"
    }
  ],
  "compositeIndexes": [
    [
      { "path": "/customerId", "order": "ascending" },
      { "path": "/orderDate", "order": "descending" }
    ],
    [
      { "path": "/status", "order": "ascending" },
      { "path": "/orderDate", "order": "descending" }
    ]
  ]
}
```

## Efficient Queries

Write queries that leverage indexes:

```csharp
// Good: Uses partition key and indexed fields
var query = new QueryDefinition(
    "SELECT c.id, c.orderDate, c.total " +
    "FROM c " +
    "WHERE c.customerId = @customerId " +
    "AND c.orderDate >= @startDate " +
    "ORDER BY c.orderDate DESC")
    .WithParameter("@customerId", customerId)
    .WithParameter("@startDate", DateTime.UtcNow.AddDays(-30));

// Bad: Cross-partition query without filter
// var query = "SELECT * FROM c ORDER BY c.orderDate DESC";

// Use pagination for large result sets
var iterator = container.GetItemQueryIterator<Order>(
    query,
    requestOptions: new QueryRequestOptions
    {
        MaxItemCount = 100,
        PartitionKey = new PartitionKey(customerId)
    }
);

var results = new List<Order>();
while (iterator.HasMoreResults)
{
    var response = await iterator.ReadNextAsync();
    results.AddRange(response.Resource);

    // Track RU consumption
    Console.WriteLine($"Request charge: {response.RequestCharge} RUs");
}
```

## Bulk Operations

For high-throughput scenarios:

```csharp
public class BulkOperations
{
    private readonly Container _container;

    public BulkOperations(Container container)
    {
        _container = container;
    }

    public async Task BulkInsertAsync(IEnumerable<Order> orders)
    {
        var tasks = new List<Task>();

        foreach (var order in orders)
        {
            tasks.Add(_container.CreateItemAsync(
                order,
                new PartitionKey(order.CustomerId),
                new ItemRequestOptions { EnableContentResponseOnWrite = false }
            ));
        }

        // Execute in parallel
        await Task.WhenAll(tasks);
    }

    // Use AllowBulkExecution for even better performance
    public async Task BulkInsertWithBatchingAsync(IEnumerable<Order> orders)
    {
        // Enable bulk execution in client options
        var clientOptions = new CosmosClientOptions
        {
            AllowBulkExecution = true,
            MaxRetryAttemptsOnRateLimitedRequests = 9,
            MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30)
        };

        var tasks = orders.Select(order =>
            _container.CreateItemAsync(
                order,
                new PartitionKey(order.CustomerId)
            ));

        await Task.WhenAll(tasks);
    }
}
```

## Change Feed for Event Processing

```csharp
public class OrderChangeFeedProcessor
{
    public async Task StartProcessorAsync(Container container, Container leaseContainer)
    {
        var processor = container
            .GetChangeFeedProcessorBuilder<Order>("orderProcessor", HandleChangesAsync)
            .WithInstanceName(Environment.MachineName)
            .WithLeaseContainer(leaseContainer)
            .WithStartTime(DateTime.UtcNow.AddHours(-1))
            .WithPollInterval(TimeSpan.FromSeconds(1))
            .Build();

        await processor.StartAsync();
    }

    private async Task HandleChangesAsync(
        ChangeFeedProcessorContext context,
        IReadOnlyCollection<Order> changes,
        CancellationToken cancellationToken)
    {
        foreach (var order in changes)
        {
            // Process each change
            Console.WriteLine($"Order {order.Id} changed in partition {context.LeaseToken}");

            // Trigger downstream actions
            await ProcessOrderChangeAsync(order);
        }
    }

    private async Task ProcessOrderChangeAsync(Order order)
    {
        // Send to Event Hub for analytics
        // Update search index
        // Trigger notifications
    }
}
```

## Serverless for Variable Workloads

```bicep
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2022-08-15' = {
  name: 'cosmos-serverless'
  location: location
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }
}
```

## Autoscale for Predictable Workloads

```csharp
// Create container with autoscale
var containerProperties = new ContainerProperties("orders", "/customerId");

var autoscaleThroughput = ThroughputProperties.CreateAutoscaleThroughput(10000);

await database.CreateContainerAsync(
    containerProperties,
    autoscaleThroughput
);

// Monitor and adjust based on usage
var throughput = await container.ReadThroughputAsync();
Console.WriteLine($"Current throughput: {throughput.Resource.Throughput}");

// Scale up for expected load
await container.ReplaceThroughputAsync(
    ThroughputProperties.CreateAutoscaleThroughput(20000)
);
```

## Global Distribution

```bicep
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2022-08-15' = {
  name: 'cosmos-global'
  location: 'eastus'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableMultipleWriteLocations: true
    locations: [
      {
        locationName: 'eastus'
        failoverPriority: 0
        isZoneRedundant: true
      }
      {
        locationName: 'westeurope'
        failoverPriority: 1
        isZoneRedundant: true
      }
      {
        locationName: 'southeastasia'
        failoverPriority: 2
        isZoneRedundant: true
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
  }
}
```

## Connection Best Practices

```csharp
public class CosmosDbFactory
{
    private static CosmosClient? _client;
    private static readonly object _lock = new();

    public static CosmosClient GetClient(string connectionString)
    {
        if (_client == null)
        {
            lock (_lock)
            {
                _client ??= new CosmosClient(connectionString, new CosmosClientOptions
                {
                    ApplicationName = "MyApp",
                    ConnectionMode = ConnectionMode.Direct,
                    MaxRetryAttemptsOnRateLimitedRequests = 9,
                    MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30),
                    EnableContentResponseOnWrite = false,
                    SerializerOptions = new CosmosSerializationOptions
                    {
                        PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase
                    }
                });
            }
        }
        return _client;
    }
}

// In ASP.NET Core, use DI
services.AddSingleton(sp =>
{
    var connectionString = configuration["CosmosDb:ConnectionString"];
    return CosmosDbFactory.GetClient(connectionString);
});
```

## Monitoring and Diagnostics

```csharp
// Enable diagnostics for troubleshooting
var response = await container.ReadItemAsync<Order>(
    id,
    new PartitionKey(customerId),
    new ItemRequestOptions { EnableContentResponseOnWrite = false }
);

// Log diagnostics for slow requests
if (response.Diagnostics.GetClientElapsedTime() > TimeSpan.FromSeconds(1))
{
    logger.LogWarning(
        "Slow Cosmos DB operation: {Diagnostics}",
        response.Diagnostics.ToString()
    );
}

// Track RU consumption
var requestCharge = response.RequestCharge;
metrics.TrackMetric("CosmosDB_RU", requestCharge);
```

## Conclusion

Cosmos DB success depends on thoughtful design decisions around partition keys, indexing, and query patterns. The new hierarchical partition keys and continued serverless improvements make it more flexible than ever. Invest time in understanding your access patterns before building - it pays dividends in performance and cost.

## Resources

- [Cosmos DB Best Practices](https://docs.microsoft.com/en-us/azure/cosmos-db/best-practice)
- [Partition Key Selection](https://docs.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [Indexing Policies](https://docs.microsoft.com/en-us/azure/cosmos-db/index-policy)
- [Change Feed](https://docs.microsoft.com/en-us/azure/cosmos-db/change-feed)
