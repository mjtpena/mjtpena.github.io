---
title: "Hierarchical Partition Keys in Azure Cosmos DB"
author: "Michael John Peña"
draft: false
date: 2022-09-02
tags: ["Azure", "Cosmos DB", "Partitioning", "Data Modeling"]

---

I wrote "Hierarchical Partition Keys in Azure Cosmos DB" to share practical, production-minded guidance on this topic.

## Understanding Hierarchical Partition Keys

Traditional single partition keys can lead to hot partitions in scenarios where data is naturally hierarchical. Hierarchical partition keys solve this by allowing composite key paths.

### Creating a Container with Hierarchical Partition Keys

```csharp
using Microsoft.Azure.Cosmos;

var cosmosClient = new CosmosClient(connectionString);
var database = cosmosClient.GetDatabase("MultiTenantDB");

// Define hierarchical partition key paths
var containerProperties = new ContainerProperties
{
    Id = "Orders",
    PartitionKeyPaths = new List<string>
    {
        "/tenantId",
        "/region",
        "/customerId"
    }
};

// Create container with hierarchical partition keys
var container = await database.CreateContainerIfNotExistsAsync(
    containerProperties,
    ThroughputProperties.CreateAutoscaleThroughput(4000));
```

### Working with Hierarchical Partition Keys

```csharp
// Define the document structure
public class Order
{
    [JsonProperty("id")]
    public string Id { get; set; }

    [JsonProperty("tenantId")]
    public string TenantId { get; set; }

    [JsonProperty("region")]
    public string Region { get; set; }

    [JsonProperty("customerId")]
    public string CustomerId { get; set; }

    [JsonProperty("orderDate")]
    public DateTime OrderDate { get; set; }

    [JsonProperty("totalAmount")]
    public decimal TotalAmount { get; set; }

    [JsonProperty("items")]
    public List<OrderItem> Items { get; set; }
}

// Create a new order with hierarchical partition key
var order = new Order
{
    Id = Guid.NewGuid().ToString(),
    TenantId = "contoso",
    Region = "west-us",
    CustomerId = "cust-12345",
    OrderDate = DateTime.UtcNow,
    TotalAmount = 299.99m,
    Items = new List<OrderItem>
    {
        new OrderItem { ProductId = "prod-1", Quantity = 2, Price = 99.99m },
        new OrderItem { ProductId = "prod-2", Quantity = 1, Price = 100.01m }
    }
};

// Build the hierarchical partition key
var partitionKey = new PartitionKeyBuilder()
    .Add(order.TenantId)
    .Add(order.Region)
    .Add(order.CustomerId)
    .Build();

// Insert the document
var response = await container.CreateItemAsync(order, partitionKey);
Console.WriteLine($"Created order with RU charge: {response.RequestCharge}");
```

### Querying with Hierarchical Partition Keys

```csharp
// Query at different levels of the hierarchy

// Level 1: Query all orders for a tenant
var tenantQuery = new QueryDefinition(
    "SELECT * FROM c WHERE c.tenantId = @tenantId")
    .WithParameter("@tenantId", "contoso");

// Level 2: Query orders for a tenant in a specific region
var regionQuery = new QueryDefinition(
    "SELECT * FROM c WHERE c.tenantId = @tenantId AND c.region = @region")
    .WithParameter("@tenantId", "contoso")
    .WithParameter("@region", "west-us");

// Level 3: Query orders for a specific customer
var customerPartitionKey = new PartitionKeyBuilder()
    .Add("contoso")
    .Add("west-us")
    .Add("cust-12345")
    .Build();

var customerQuery = new QueryDefinition(
    "SELECT * FROM c WHERE c.tenantId = @tenantId AND c.region = @region AND c.customerId = @customerId")
    .WithParameter("@tenantId", "contoso")
    .WithParameter("@region", "west-us")
    .WithParameter("@customerId", "cust-12345");

var options = new QueryRequestOptions { PartitionKey = customerPartitionKey };

using var iterator = container.GetItemQueryIterator<Order>(customerQuery, requestOptions: options);
while (iterator.HasMoreResults)
{
    var results = await iterator.ReadNextAsync();
    foreach (var order in results)
    {
        Console.WriteLine($"Order {order.Id}: ${order.TotalAmount}");
    }
}
```

### Benefits of Hierarchical Partition Keys

```csharp
// Efficient prefix queries - no cross-partition queries needed
public async Task<List<Order>> GetTenantOrdersAsync(string tenantId)
{
    var partitionKey = new PartitionKeyBuilder()
        .Add(tenantId)
        .Build();

    var query = new QueryDefinition("SELECT * FROM c")
        .WithParameter("@tenantId", tenantId);

    var options = new QueryRequestOptions
    {
        PartitionKey = partitionKey,
        MaxItemCount = 100
    };

    var results = new List<Order>();
    using var iterator = container.GetItemQueryIterator<Order>(query, requestOptions: options);

    while (iterator.HasMoreResults)
    {
        var response = await iterator.ReadNextAsync();
        results.AddRange(response);
    }

    return results;
}
```

## Use Cases

1. **Multi-tenant SaaS applications** - Partition by tenant, then by region or service
2. **IoT scenarios** - Partition by device type, location, then device ID
3. **E-commerce** - Partition by category, subcategory, then product ID
4. **Gaming** - Partition by game, server region, then player ID

Hierarchical partition keys provide the flexibility needed for complex data models while maintaining excellent performance characteristics.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
