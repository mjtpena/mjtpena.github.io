---
title: Event Sourcing Patterns with Azure Cosmos DB
author: Michael John Peña
draft: false
date: 2021-06-23
url: /blog/event-sourcing-patterns/
tags:
  - Azure
  - Event Sourcing
  - Cosmos DB
  - Architecture

---

I wrote "2021-06-23-event-sourcing-patterns" to share practical, production-minded guidance on this topic.

## Event Sourcing Fundamentals

### Event Store Structure

```csharp
// Base event class
public abstract record DomainEvent
{
    public Guid EventId { get; init; } = Guid.NewGuid();
    public string EventType => GetType().Name;
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;
    public int Version { get; init; }
}

// Stored event envelope
public class StoredEvent
{
    [JsonPropertyName("id")]
    public string Id { get; set; }  // {StreamId}:{Version}

    [JsonPropertyName("streamId")]
    public string StreamId { get; set; }

    [JsonPropertyName("version")]
    public int Version { get; set; }

    [JsonPropertyName("eventType")]
    public string EventType { get; set; }

    [JsonPropertyName("data")]
    public JsonDocument Data { get; set; }

    [JsonPropertyName("metadata")]
    public EventMetadata Metadata { get; set; }

    [JsonPropertyName("timestamp")]
    public DateTime Timestamp { get; set; }
}

public class EventMetadata
{
    public string CorrelationId { get; set; }
    public string CausationId { get; set; }
    public string UserId { get; set; }
}
```

### Domain Events

```csharp
// Order aggregate events
public record OrderCreatedEvent(
    Guid OrderId,
    Guid CustomerId,
    string CustomerName) : DomainEvent;

public record OrderItemAddedEvent(
    Guid OrderId,
    Guid ProductId,
    string ProductName,
    int Quantity,
    decimal UnitPrice) : DomainEvent;

public record OrderItemRemovedEvent(
    Guid OrderId,
    Guid ProductId) : DomainEvent;

public record OrderSubmittedEvent(
    Guid OrderId,
    decimal TotalAmount) : DomainEvent;

public record OrderShippedEvent(
    Guid OrderId,
    string TrackingNumber,
    DateTime ShippedAt) : DomainEvent;

public record OrderCancelledEvent(
    Guid OrderId,
    string Reason) : DomainEvent;
```

## Aggregate Implementation

### Event-Sourced Aggregate

```csharp
public abstract class EventSourcedAggregate
{
    private readonly List<DomainEvent> _uncommittedEvents = new();

    public Guid Id { get; protected set; }
    public int Version { get; protected set; } = -1;

    public IReadOnlyList<DomainEvent> UncommittedEvents => _uncommittedEvents.AsReadOnly();

    protected void Apply(DomainEvent @event)
    {
        When(@event);
        Version++;
        _uncommittedEvents.Add(@event with { Version = Version });
    }

    protected abstract void When(DomainEvent @event);

    public void Load(IEnumerable<DomainEvent> events)
    {
        foreach (var @event in events)
        {
            When(@event);
            Version++;
        }
    }

    public void ClearUncommittedEvents() => _uncommittedEvents.Clear();
}

public class Order : EventSourcedAggregate
{
    public Guid CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public decimal TotalAmount { get; private set; }
    private readonly Dictionary<Guid, OrderItem> _items = new();
    public IReadOnlyCollection<OrderItem> Items => _items.Values.ToList();

    // Factory method
    public static Order Create(Guid orderId, Guid customerId, string customerName)
    {
        var order = new Order();
        order.Apply(new OrderCreatedEvent(orderId, customerId, customerName));
        return order;
    }

    public void AddItem(Guid productId, string productName, int quantity, decimal unitPrice)
    {
        if (Status != OrderStatus.Draft)
            throw new InvalidOperationException("Cannot add items to non-draft order");

        Apply(new OrderItemAddedEvent(Id, productId, productName, quantity, unitPrice));
    }

    public void RemoveItem(Guid productId)
    {
        if (!_items.ContainsKey(productId))
            throw new InvalidOperationException("Item not found");

        Apply(new OrderItemRemovedEvent(Id, productId));
    }

    public void Submit()
    {
        if (Status != OrderStatus.Draft)
            throw new InvalidOperationException("Order already submitted");

        if (!_items.Any())
            throw new InvalidOperationException("Cannot submit empty order");

        Apply(new OrderSubmittedEvent(Id, TotalAmount));
    }

    public void Ship(string trackingNumber)
    {
        if (Status != OrderStatus.Submitted)
            throw new InvalidOperationException("Order must be submitted before shipping");

        Apply(new OrderShippedEvent(Id, trackingNumber, DateTime.UtcNow));
    }

    public void Cancel(string reason)
    {
        if (Status == OrderStatus.Shipped)
            throw new InvalidOperationException("Cannot cancel shipped order");

        Apply(new OrderCancelledEvent(Id, reason));
    }

    protected override void When(DomainEvent @event)
    {
        switch (@event)
        {
            case OrderCreatedEvent e:
                Id = e.OrderId;
                CustomerId = e.CustomerId;
                Status = OrderStatus.Draft;
                break;

            case OrderItemAddedEvent e:
                var item = new OrderItem(e.ProductId, e.ProductName, e.Quantity, e.UnitPrice);
                _items[e.ProductId] = item;
                RecalculateTotal();
                break;

            case OrderItemRemovedEvent e:
                _items.Remove(e.ProductId);
                RecalculateTotal();
                break;

            case OrderSubmittedEvent e:
                Status = OrderStatus.Submitted;
                TotalAmount = e.TotalAmount;
                break;

            case OrderShippedEvent:
                Status = OrderStatus.Shipped;
                break;

            case OrderCancelledEvent:
                Status = OrderStatus.Cancelled;
                break;
        }
    }

    private void RecalculateTotal()
    {
        TotalAmount = _items.Values.Sum(i => i.Quantity * i.UnitPrice);
    }
}
```

## Event Store Implementation

### Cosmos DB Event Store

```csharp
public class CosmosEventStore : IEventStore
{
    private readonly Container _container;
    private readonly IEventSerializer _serializer;

    public CosmosEventStore(CosmosClient client, IEventSerializer serializer)
    {
        _container = client.GetContainer("event-store", "events");
        _serializer = serializer;
    }

    public async Task<IEnumerable<DomainEvent>> GetEventsAsync(
        string streamId,
        int fromVersion = 0,
        CancellationToken cancellationToken = default)
    {
        var query = new QueryDefinition(
            "SELECT * FROM c WHERE c.streamId = @streamId AND c.version >= @fromVersion ORDER BY c.version")
            .WithParameter("@streamId", streamId)
            .WithParameter("@fromVersion", fromVersion);

        var events = new List<DomainEvent>();

        using var iterator = _container.GetItemQueryIterator<StoredEvent>(query);
        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync(cancellationToken);
            foreach (var stored in response)
            {
                var @event = _serializer.Deserialize(stored.EventType, stored.Data);
                events.Add(@event);
            }
        }

        return events;
    }

    public async Task AppendEventsAsync(
        string streamId,
        int expectedVersion,
        IEnumerable<DomainEvent> events,
        EventMetadata metadata,
        CancellationToken cancellationToken = default)
    {
        var batch = _container.CreateTransactionalBatch(new PartitionKey(streamId));

        var currentVersion = expectedVersion;

        foreach (var @event in events)
        {
            currentVersion++;

            var storedEvent = new StoredEvent
            {
                Id = $"{streamId}:{currentVersion}",
                StreamId = streamId,
                Version = currentVersion,
                EventType = @event.EventType,
                Data = _serializer.Serialize(@event),
                Metadata = metadata,
                Timestamp = @event.Timestamp
            };

            batch.CreateItem(storedEvent);
        }

        var response = await batch.ExecuteAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                throw new ConcurrencyException(streamId, expectedVersion);
            }

            throw new EventStoreException($"Failed to append events: {response.StatusCode}");
        }
    }
}
```

### Event Serialization

```csharp
public class JsonEventSerializer : IEventSerializer
{
    private readonly Dictionary<string, Type> _eventTypes;

    public JsonEventSerializer()
    {
        // Register all event types
        _eventTypes = typeof(DomainEvent).Assembly
            .GetTypes()
            .Where(t => t.IsSubclassOf(typeof(DomainEvent)) && !t.IsAbstract)
            .ToDictionary(t => t.Name, t => t);
    }

    public JsonDocument Serialize(DomainEvent @event)
    {
        var json = JsonSerializer.Serialize(@event, @event.GetType());
        return JsonDocument.Parse(json);
    }

    public DomainEvent Deserialize(string eventType, JsonDocument data)
    {
        if (!_eventTypes.TryGetValue(eventType, out var type))
        {
            throw new UnknownEventTypeException(eventType);
        }

        return (DomainEvent)JsonSerializer.Deserialize(data.RootElement.GetRawText(), type)!;
    }
}
```

## Aggregate Repository

```csharp
public class EventSourcedRepository<T> : IRepository<T> where T : EventSourcedAggregate, new()
{
    private readonly IEventStore _eventStore;
    private readonly IEventPublisher _eventPublisher;

    public async Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var streamId = $"{typeof(T).Name}-{id}";
        var events = await _eventStore.GetEventsAsync(streamId, cancellationToken: cancellationToken);

        if (!events.Any())
            return null;

        var aggregate = new T();
        aggregate.Load(events);
        return aggregate;
    }

    public async Task SaveAsync(T aggregate, EventMetadata metadata, CancellationToken cancellationToken = default)
    {
        var streamId = $"{typeof(T).Name}-{aggregate.Id}";
        var uncommittedEvents = aggregate.UncommittedEvents.ToList();

        if (!uncommittedEvents.Any())
            return;

        var expectedVersion = aggregate.Version - uncommittedEvents.Count;

        await _eventStore.AppendEventsAsync(
            streamId,
            expectedVersion,
            uncommittedEvents,
            metadata,
            cancellationToken);

        // Publish events after successful persistence
        foreach (var @event in uncommittedEvents)
        {
            await _eventPublisher.PublishAsync(@event, cancellationToken);
        }

        aggregate.ClearUncommittedEvents();
    }
}
```

## Projections with Change Feed

### Change Feed Processor

```csharp
public class ProjectionProcessor : IHostedService
{
    private readonly Container _eventContainer;
    private readonly Container _leaseContainer;
    private readonly IServiceProvider _serviceProvider;
    private ChangeFeedProcessor? _processor;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _processor = _eventContainer
            .GetChangeFeedProcessorBuilder<StoredEvent>(
                "projections",
                HandleChangesAsync)
            .WithInstanceName(Environment.MachineName)
            .WithLeaseContainer(_leaseContainer)
            .WithStartTime(DateTime.MinValue.ToUniversalTime())
            .Build();

        await _processor.StartAsync();
    }

    private async Task HandleChangesAsync(
        IReadOnlyCollection<StoredEvent> changes,
        CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var projectionHandlers = scope.ServiceProvider
            .GetServices<IProjectionHandler>();

        foreach (var storedEvent in changes)
        {
            var @event = DeserializeEvent(storedEvent);

            foreach (var handler in projectionHandlers)
            {
                if (handler.CanHandle(@event))
                {
                    await handler.HandleAsync(@event, cancellationToken);
                }
            }
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_processor != null)
        {
            await _processor.StopAsync();
        }
    }
}
```

### Read Model Projections

```csharp
public class OrderReadModelProjection : IProjectionHandler
{
    private readonly Container _readModelContainer;

    public bool CanHandle(DomainEvent @event) =>
        @event is OrderCreatedEvent or
        OrderItemAddedEvent or
        OrderSubmittedEvent or
        OrderShippedEvent;

    public async Task HandleAsync(DomainEvent @event, CancellationToken cancellationToken)
    {
        switch (@event)
        {
            case OrderCreatedEvent e:
                await HandleOrderCreatedAsync(e, cancellationToken);
                break;
            case OrderItemAddedEvent e:
                await HandleItemAddedAsync(e, cancellationToken);
                break;
            case OrderSubmittedEvent e:
                await HandleOrderSubmittedAsync(e, cancellationToken);
                break;
            case OrderShippedEvent e:
                await HandleOrderShippedAsync(e, cancellationToken);
                break;
        }
    }

    private async Task HandleOrderCreatedAsync(
        OrderCreatedEvent @event,
        CancellationToken cancellationToken)
    {
        var readModel = new OrderReadModel
        {
            Id = @event.OrderId.ToString(),
            CustomerId = @event.CustomerId.ToString(),
            CustomerName = @event.CustomerName,
            Status = "Draft",
            Items = new List<OrderItemReadModel>(),
            TotalAmount = 0,
            CreatedAt = @event.Timestamp
        };

        await _readModelContainer.CreateItemAsync(
            readModel,
            new PartitionKey(readModel.CustomerId),
            cancellationToken: cancellationToken);
    }

    private async Task HandleItemAddedAsync(
        OrderItemAddedEvent @event,
        CancellationToken cancellationToken)
    {
        var operations = new List<PatchOperation>
        {
            PatchOperation.Add("/Items/-", new OrderItemReadModel
            {
                ProductId = @event.ProductId.ToString(),
                ProductName = @event.ProductName,
                Quantity = @event.Quantity,
                UnitPrice = @event.UnitPrice
            })
        };

        // Also update total
        var order = await GetOrderAsync(@event.OrderId, cancellationToken);
        var newTotal = order.TotalAmount + (@event.Quantity * @event.UnitPrice);
        operations.Add(PatchOperation.Set("/TotalAmount", newTotal));

        await _readModelContainer.PatchItemAsync<OrderReadModel>(
            @event.OrderId.ToString(),
            new PartitionKey(order.CustomerId),
            operations,
            cancellationToken: cancellationToken);
    }
}
```

## Snapshots

### Snapshot Strategy

```csharp
public class SnapshotRepository<T> : IRepository<T> where T : EventSourcedAggregate, new()
{
    private readonly IEventStore _eventStore;
    private readonly Container _snapshotContainer;
    private readonly int _snapshotFrequency;

    public async Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        var streamId = $"{typeof(T).Name}-{id}";

        // Try to load from snapshot first
        var snapshot = await LoadSnapshotAsync(streamId, cancellationToken);

        var fromVersion = snapshot?.Version ?? 0;
        var events = await _eventStore.GetEventsAsync(streamId, fromVersion, cancellationToken);

        if (snapshot == null && !events.Any())
            return null;

        var aggregate = new T();

        if (snapshot != null)
        {
            aggregate = JsonSerializer.Deserialize<T>(snapshot.State)!;
        }

        aggregate.Load(events);

        return aggregate;
    }

    public async Task SaveAsync(T aggregate, EventMetadata metadata, CancellationToken cancellationToken)
    {
        // Save events first
        await base.SaveAsync(aggregate, metadata, cancellationToken);

        // Create snapshot if needed
        if (aggregate.Version > 0 && aggregate.Version % _snapshotFrequency == 0)
        {
            await SaveSnapshotAsync(aggregate, cancellationToken);
        }
    }

    private async Task SaveSnapshotAsync(T aggregate, CancellationToken cancellationToken)
    {
        var snapshot = new Snapshot
        {
            Id = $"{typeof(T).Name}-{aggregate.Id}",
            StreamId = $"{typeof(T).Name}-{aggregate.Id}",
            Version = aggregate.Version,
            State = JsonSerializer.Serialize(aggregate),
            CreatedAt = DateTime.UtcNow
        };

        await _snapshotContainer.UpsertItemAsync(
            snapshot,
            new PartitionKey(snapshot.StreamId),
            cancellationToken: cancellationToken);
    }
}
```

## Conclusion

Event Sourcing with Azure Cosmos DB provides a robust foundation for building systems that require complete audit trails, temporal queries, and event-driven architectures. The change feed enables reactive projections, while snapshots optimize read performance for aggregates with many events. Start simple and add complexity as your domain requires.

## References

- [Event Sourcing Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [Cosmos DB Change Feed](https://docs.microsoft.com/en-us/azure/cosmos-db/change-feed)

