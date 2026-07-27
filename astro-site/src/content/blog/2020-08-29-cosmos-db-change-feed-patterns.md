---
title: "Azure Cosmos DB Change Feed Patterns"
author: Michael John Peña
draft: false
date: 2020-08-29
tags:
  - Azure
  - Cosmos DB
  - Change Feed
  - Event-Driven

---

I wrote "Azure Cosmos DB Change Feed Patterns" to share practical, production-minded guidance on this topic.

## Common Patterns

### 1. Real-Time Materialized Views

```csharp
[FunctionName("UpdateMaterializedView")]
public static async Task Run(
    [CosmosDBTrigger(
        databaseName: "orders",
        collectionName: "order-items",
        ConnectionStringSetting = "CosmosConnection",
        LeaseCollectionName = "leases")] IReadOnlyList<Document> documents,
    [CosmosDB(
        databaseName: "orders",
        collectionName: "order-summaries",
        ConnectionStringSetting = "CosmosConnection")] IAsyncCollector<OrderSummary> summaries)
{
    foreach (var doc in documents)
    {
        var item = JsonConvert.DeserializeObject<OrderItem>(doc.ToString());
        var summary = await CalculateSummary(item.OrderId);
        await summaries.AddAsync(summary);
    }
}
```

### 2. Cross-Region Replication Logic

```csharp
// Replicate to secondary region with transformation
[FunctionName("ReplicateToSecondary")]
public static async Task ReplicateToSecondary(
    [CosmosDBTrigger(...)] IReadOnlyList<Document> documents,
    [CosmosDB(
        databaseName: "orders-secondary",
        collectionName: "orders",
        ConnectionStringSetting = "CosmosSecondary")] IAsyncCollector<Order> output)
{
    foreach (var doc in documents)
    {
        var order = JsonConvert.DeserializeObject<Order>(doc.ToString());
        order.Region = "secondary";  // Mark as replicated
        await output.AddAsync(order);
    }
}
```

### 3. Event Sourcing Integration

Push changes to Event Hubs for downstream processing:

```csharp
[FunctionName("PublishToEventHub")]
public static async Task PublishToEventHub(
    [CosmosDBTrigger(...)] IReadOnlyList<Document> documents,
    [EventHub("order-events", Connection = "EventHubConnection")] IAsyncCollector<string> eventHub)
{
    foreach (var doc in documents)
    {
        await eventHub.AddAsync(doc.ToString());
    }
}
```

## Key Considerations

- Change Feed doesn't capture deletes (use soft deletes or TTL)
- Ordering is guaranteed within a partition, not globally
- Use lease collection to track progress and enable scaling

Change Feed transforms Cosmos DB from a database into a real-time event platform.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
