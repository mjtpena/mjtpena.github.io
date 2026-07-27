---
title: CosmosDB Change Feed Patterns for Event-Driven Architectures
author: Michael John Pena
draft: false
date: 2021-01-26
url: /blog/cosmosdb-change-feed-patterns/
tags:
  - Azure
  - CosmosDB
  - Change Feed
  - Event-Driven
  - Microservices
---

Cosmos DB Change Feed is the feature most teams discover six months after they've already hand-rolled a polling loop they'll regret. It's a sorted, persistent stream of every insert and update on a container, consumable from Functions, the SDK, or Synapse Link. Once you see it, you stop writing dual-write code paths. Today I'm walking through patterns I've shipped: materialised view rebuilds, downstream sync to a search index, event sourcing onto Service Bus, and the dead-letter handling that keeps it production-safe.

## Understanding Change Feed

Change Feed captures every insert and update operation in a Cosmos DB container. Key characteristics:
- Sorted by modification time within each logical partition
- Guaranteed at-least-once delivery
- Supports parallel processing across partitions
- Persistent cursor via continuation tokens

## Basic Change Feed Processing

### Using Azure Functions

The simplest way to process Change Feed is with Azure Functions:

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Host;
using Microsoft.Azure.Documents;
using Microsoft.Extensions.Logging;
using System.Collections.Generic;

public static class OrderProcessor
{
    [FunctionName("ProcessOrderChanges")]
    public static async Task Run(
        [CosmosDBTrigger(
            databaseName: "ecommerce",
            containerName: "orders",
            Connection = "CosmosDBConnection",
            LeaseContainerName = "leases",
            CreateLeaseContainerIfNotExists = true,
            StartFromBeginning = false,
            MaxItemsPerInvocation = 100)]
        IReadOnlyList<Order> orders,
        ILogger log)
    {
        if (orders == null || orders.Count == 0) return;

        foreach (var order in orders)
        {
            log.LogInformation($"Processing order {order.Id}, Status: {order.Status}");

            switch (order.Status)
            {
                case "Created":
                    await ProcessNewOrder(order);
                    break;
                case "Paid":
                    await InitiateShipment(order);
                    break;
                case "Shipped":
                    await NotifyCustomer(order);
                    break;
                case "Cancelled":
                    await ProcessRefund(order);
                    break;
            }
        }
    }

    private static async Task ProcessNewOrder(Order order)
    {
        // Validate inventory, calculate totals
    }

    private static async Task InitiateShipment(Order order)
    {
        // Create shipping label, notify warehouse
    }

    private static async Task NotifyCustomer(Order order)
    {
        // Send email/SMS notification
    }

    private static async Task ProcessRefund(Order order)
    {
        // Initiate refund, restore inventory
    }
}

public class Order
{
    public string Id { get; set; }
    public string CustomerId { get; set; }
    public string Status { get; set; }
    public decimal TotalAmount { get; set; }
    public List<OrderItem> Items { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
}
```

### Using Change Feed Processor

For more control, use the Change Feed Processor library:

```csharp
using Microsoft.Azure.Cosmos;

public class ChangeFeedService : IHostedService
{
    private readonly CosmosClient _cosmosClient;
    private ChangeFeedProcessor _processor;
    private readonly ILogger<ChangeFeedService> _logger;
    private readonly IServiceProvider _serviceProvider;

    public ChangeFeedService(
        CosmosClient cosmosClient,
        ILogger<ChangeFeedService> logger,
        IServiceProvider serviceProvider)
    {
        _cosmosClient = cosmosClient;
        _logger = logger;
        _serviceProvider = serviceProvider;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var database = _cosmosClient.GetDatabase("ecommerce");
        var sourceContainer = database.GetContainer("orders");
        var leaseContainer = database.GetContainer("leases");

        _processor = sourceContainer
            .GetChangeFeedProcessorBuilder<Order>(
                processorName: "OrderProcessor",
                onChangesDelegate: HandleChangesAsync)
            .WithInstanceName(Environment.MachineName)
            .WithLeaseContainer(leaseContainer)
            .WithStartTime(DateTime.UtcNow.AddDays(-1)) // Start from yesterday
            .WithMaxItems(50)
            .WithPollInterval(TimeSpan.FromSeconds(5))
            .WithLeaseConfiguration(
                acquireInterval: TimeSpan.FromSeconds(10),
                expirationInterval: TimeSpan.FromSeconds(60),
                renewInterval: TimeSpan.FromSeconds(20))
            .Build();

        await _processor.StartAsync();
        _logger.LogInformation("Change Feed Processor started");
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _processor.StopAsync();
        _logger.LogInformation("Change Feed Processor stopped");
    }

    private async Task HandleChangesAsync(
        ChangeFeedProcessorContext context,
        IReadOnlyCollection<Order> changes,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            $"Processing {changes.Count} changes from partition {context.LeaseToken}");

        using var scope = _serviceProvider.CreateScope();
        var eventPublisher = scope.ServiceProvider.GetRequiredService<IEventPublisher>();

        var tasks = changes.Select(async order =>
        {
            try
            {
                var @event = new OrderChangedEvent
                {
                    OrderId = order.Id,
                    Status = order.Status,
                    CustomerId = order.CustomerId,
                    Timestamp = order.ModifiedAt
                };

                await eventPublisher.PublishAsync(@event);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Failed to process order {order.Id}");
                // Implement retry or dead-letter logic
            }
        });

        await Task.WhenAll(tasks);
    }
}
```

## Event Sourcing Pattern

Use Change Feed to implement event sourcing:

```csharp
public class EventStore
{
    private readonly Container _eventsContainer;
    private readonly Container _snapshotsContainer;

    public async Task AppendEventAsync<TEvent>(
        string aggregateId,
        TEvent @event,
        int expectedVersion) where TEvent : DomainEvent
    {
        var eventDocument = new EventDocument
        {
            Id = Guid.NewGuid().ToString(),
            AggregateId = aggregateId,
            EventType = typeof(TEvent).Name,
            EventData = JsonSerializer.Serialize(@event),
            Version = expectedVersion + 1,
            Timestamp = DateTime.UtcNow,
            PartitionKey = aggregateId
        };

        // Optimistic concurrency check
        var query = new QueryDefinition(
            "SELECT VALUE MAX(c.Version) FROM c WHERE c.AggregateId = @aggregateId")
            .WithParameter("@aggregateId", aggregateId);

        var iterator = _eventsContainer.GetItemQueryIterator<int?>(query);
        var response = await iterator.ReadNextAsync();
        var currentVersion = response.Resource.FirstOrDefault() ?? 0;

        if (currentVersion != expectedVersion)
        {
            throw new ConcurrencyException(
                $"Expected version {expectedVersion}, but current is {currentVersion}");
        }

        await _eventsContainer.CreateItemAsync(
            eventDocument,
            new PartitionKey(aggregateId));
    }

    public async Task<TAggregate> RehydrateAsync<TAggregate>(string aggregateId)
        where TAggregate : AggregateRoot, new()
    {
        // Try to load from snapshot first
        var snapshot = await LoadSnapshotAsync<TAggregate>(aggregateId);
        var aggregate = snapshot?.Aggregate ?? new TAggregate();
        var fromVersion = snapshot?.Version ?? 0;

        // Load events since snapshot
        var query = new QueryDefinition(
            "SELECT * FROM c WHERE c.AggregateId = @aggregateId AND c.Version > @version ORDER BY c.Version")
            .WithParameter("@aggregateId", aggregateId)
            .WithParameter("@version", fromVersion);

        var events = new List<DomainEvent>();
        var iterator = _eventsContainer.GetItemQueryIterator<EventDocument>(query);

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            foreach (var doc in response.Resource)
            {
                var eventType = Type.GetType($"MyApp.Events.{doc.EventType}");
                var @event = (DomainEvent)JsonSerializer.Deserialize(
                    doc.EventData, eventType);
                events.Add(@event);
            }
        }

        // Apply events to aggregate
        foreach (var @event in events)
        {
            aggregate.Apply(@event);
        }

        return aggregate;
    }
}

// Change Feed processor for projections
public class ProjectionProcessor
{
    private readonly Container _readModelContainer;

    public async Task ProcessEventsAsync(
        IReadOnlyCollection<EventDocument> events)
    {
        foreach (var eventDoc in events)
        {
            switch (eventDoc.EventType)
            {
                case "OrderCreated":
                    await ProjectOrderCreated(eventDoc);
                    break;
                case "OrderItemAdded":
                    await ProjectOrderItemAdded(eventDoc);
                    break;
                case "OrderShipped":
                    await ProjectOrderShipped(eventDoc);
                    break;
            }
        }
    }

    private async Task ProjectOrderCreated(EventDocument eventDoc)
    {
        var @event = JsonSerializer.Deserialize<OrderCreated>(eventDoc.EventData);

        var readModel = new OrderReadModel
        {
            Id = @event.OrderId,
            CustomerId = @event.CustomerId,
            Status = "Created",
            TotalAmount = 0,
            Items = new List<OrderItemReadModel>(),
            CreatedAt = @event.Timestamp
        };

        await _readModelContainer.UpsertItemAsync(
            readModel,
            new PartitionKey(readModel.CustomerId));
    }
}
```

## Materialized View Pattern

Create denormalized views for efficient reads:

```csharp
public class MaterializedViewBuilder
{
    private readonly Container _productsContainer;
    private readonly Container _categoriesContainer;
    private readonly Container _productCatalogView;

    // Process changes from products container
    public async Task ProcessProductChangesAsync(
        IReadOnlyCollection<Product> products)
    {
        foreach (var product in products)
        {
            // Fetch related category
            var category = await _categoriesContainer.ReadItemAsync<Category>(
                product.CategoryId,
                new PartitionKey(product.CategoryId));

            // Build denormalized view
            var catalogEntry = new ProductCatalogEntry
            {
                Id = product.Id,
                ProductId = product.Id,
                Name = product.Name,
                Description = product.Description,
                Price = product.Price,
                ImageUrl = product.ImageUrl,
                CategoryId = category.Resource.Id,
                CategoryName = category.Resource.Name,
                CategoryPath = category.Resource.Path,
                Tags = product.Tags,
                Attributes = product.Attributes,
                InStock = product.InventoryCount > 0,
                InventoryCount = product.InventoryCount,
                LastUpdated = DateTime.UtcNow,
                // Partition by category for efficient category browsing
                PartitionKey = category.Resource.Id
            };

            await _productCatalogView.UpsertItemAsync(
                catalogEntry,
                new PartitionKey(catalogEntry.PartitionKey));
        }
    }

    // Also process category changes to update all related products
    public async Task ProcessCategoryChangesAsync(
        IReadOnlyCollection<Category> categories)
    {
        foreach (var category in categories)
        {
            // Find all products in this category
            var query = new QueryDefinition(
                "SELECT * FROM c WHERE c.CategoryId = @categoryId")
                .WithParameter("@categoryId", category.Id);

            var iterator = _productCatalogView.GetItemQueryIterator<ProductCatalogEntry>(query);

            while (iterator.HasMoreResults)
            {
                var batch = await iterator.ReadNextAsync();
                var updates = batch.Resource.Select(entry =>
                {
                    entry.CategoryName = category.Name;
                    entry.CategoryPath = category.Path;
                    entry.LastUpdated = DateTime.UtcNow;
                    return _productCatalogView.UpsertItemAsync(
                        entry,
                        new PartitionKey(entry.PartitionKey));
                });

                await Task.WhenAll(updates);
            }
        }
    }
}
```

## Cross-Region Replication

Replicate data across regions using Change Feed:

```python
from azure.cosmos import CosmosClient
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient
import asyncio

class CrossRegionReplicator:
    def __init__(self, source_connection, target_connection):
        self.source_client = CosmosClient.from_connection_string(source_connection)
        self.target_client = AsyncCosmosClient.from_connection_string(target_connection)

    async def replicate_changes(self, database_name, container_name):
        source_container = self.source_client \
            .get_database_client(database_name) \
            .get_container_client(container_name)

        target_container = self.target_client \
            .get_database_client(database_name) \
            .get_container_client(container_name)

        # Process change feed
        continuation_token = None

        while True:
            response = source_container.query_items_change_feed(
                is_start_from_beginning=continuation_token is None,
                continuation=continuation_token,
                max_item_count=100
            )

            changes = list(response)

            if changes:
                # Batch upsert to target
                tasks = [
                    target_container.upsert_item(item)
                    for item in changes
                ]
                await asyncio.gather(*tasks, return_exceptions=True)

                print(f"Replicated {len(changes)} items")

            continuation_token = response.continuation_token

            if not changes:
                await asyncio.sleep(5)  # Poll interval

    async def handle_conflicts(self, database_name, container_name):
        """
        Handle conflicts when using multi-master replication.
        """
        conflicts_container = self.source_client \
            .get_database_client(database_name) \
            .get_container_client("conflicts")

        for conflict in conflicts_container.query_items(
            query="SELECT * FROM c",
            enable_cross_partition_query=True
        ):
            # Custom conflict resolution
            if conflict["operationType"] == "create":
                # Keep the item with the latest timestamp
                await self.resolve_by_timestamp(conflict)
            elif conflict["operationType"] == "replace":
                # Merge changes
                await self.merge_documents(conflict)

            # Delete processed conflict
            await conflicts_container.delete_item(
                conflict["id"],
                partition_key=conflict["partitionKey"]
            )

    async def resolve_by_timestamp(self, conflict):
        current = conflict["content"]
        conflicting = conflict["conflictingResource"]

        winner = current if current["_ts"] > conflicting["_ts"] else conflicting

        target_container = self.target_client \
            .get_database_client(conflict["databaseName"]) \
            .get_container_client(conflict["containerName"])

        await target_container.upsert_item(winner)
```

## Change Feed Estimator

Monitor Change Feed processing lag:

```csharp
public class ChangeFeedMonitor : BackgroundService
{
    private readonly CosmosClient _cosmosClient;
    private readonly ILogger<ChangeFeedMonitor> _logger;
    private ChangeFeedProcessor _processor;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var database = _cosmosClient.GetDatabase("ecommerce");
        var sourceContainer = database.GetContainer("orders");
        var leaseContainer = database.GetContainer("leases");

        var estimator = sourceContainer
            .GetChangeFeedEstimatorBuilder(
                "OrderProcessor-Estimator",
                HandleEstimationAsync)
            .WithLeaseContainer(leaseContainer)
            .Build();

        await estimator.StartAsync();

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }

        await estimator.StopAsync();
    }

    private async Task HandleEstimationAsync(
        long estimatedPendingChanges,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            $"Estimated pending changes: {estimatedPendingChanges}");

        // Alert if lag is too high
        if (estimatedPendingChanges > 10000)
        {
            await SendAlertAsync(
                $"Change Feed lag critical: {estimatedPendingChanges} pending changes");
        }

        // Emit metric for monitoring
        TelemetryClient.TrackMetric("ChangeFeed.PendingChanges", estimatedPendingChanges);
    }
}
```

## Best Practices

1. **Partition Key Design**: Choose partition keys that distribute load evenly
2. **Idempotent Processing**: Design handlers to handle duplicate deliveries
3. **Error Handling**: Implement dead-letter patterns for failed processing
4. **Monitoring**: Use the Change Feed Estimator to track lag
5. **Lease Management**: Monitor lease container for partition distribution
6. **Batch Processing**: Process changes in batches for efficiency

Cosmos DB Change Feed enables powerful event-driven architectures. Combined with Azure Functions or the Change Feed Processor, you can build reactive systems that respond to data changes in real-time.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
