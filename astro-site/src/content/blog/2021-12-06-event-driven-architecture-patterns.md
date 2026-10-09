---
title: "Event-Driven Architecture Patterns for Modern Applications"
description: "Event-driven architecture in 2021 moved from architectural pattern to practical implementation. The tools support it, the patterns are proven, and the…"
author: Michael John Pena
draft: false
date: 2021-12-06
tags:
  - Event-Driven
  - Architecture
  - Azure
  - Messaging
  - Microservices
---

## Event Sourcing Done Right

Storing events as the source of truth enables powerful patterns:

```csharp
// Event sourcing with Cosmos DB
public interface IEvent
{
    string EventId { get; }
    string AggregateId { get; }
    DateTime Timestamp { get; }
    int Version { get; }
}

public record OrderCreated(
    string EventId,
    string AggregateId,
    DateTime Timestamp,
    int Version,
    string CustomerId,
    List<OrderItem> Items
) : IEvent;

public record OrderShipped(
    string EventId,
    string AggregateId,
    DateTime Timestamp,
    int Version,
    string TrackingNumber,
    DateTime ShippedAt
) : IEvent;

public class OrderAggregate
{
    public string Id { get; private set; }
    public string CustomerId { get; private set; }
    public List<OrderItem> Items { get; private set; } = new();
    public OrderStatus Status { get; private set; }
    public int Version { get; private set; }

    private readonly List<IEvent> _uncommittedEvents = new();

    public void Apply(IEvent @event)
    {
        switch (@event)
        {
            case OrderCreated created:
                Id = created.AggregateId;
                CustomerId = created.CustomerId;
                Items = created.Items;
                Status = OrderStatus.Created;
                break;
            case OrderShipped shipped:
                Status = OrderStatus.Shipped;
                break;
        }
        Version = @event.Version;
    }

    public IReadOnlyList<IEvent> GetUncommittedEvents() => _uncommittedEvents;
}

public class EventStore
{
    private readonly Container _container;

    public async Task SaveEventsAsync(string aggregateId, IEnumerable<IEvent> events, int expectedVersion)
    {
        var batch = _container.CreateTransactionalBatch(new PartitionKey(aggregateId));

        foreach (var @event in events)
        {
            batch.CreateItem(@event);
        }

        var response = await batch.ExecuteAsync();
        if (!response.IsSuccessStatusCode)
        {
            throw new ConcurrencyException($"Conflict saving aggregate {aggregateId}");
        }
    }

    public async Task<List<IEvent>> GetEventsAsync(string aggregateId)
    {
        var query = _container.GetItemQueryIterator<IEvent>(
            new QueryDefinition("SELECT * FROM c WHERE c.AggregateId = @id ORDER BY c.Version")
                .WithParameter("@id", aggregateId),
            requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(aggregateId) }
        );

        var events = new List<IEvent>();
        while (query.HasMoreResults)
        {
            var response = await query.ReadNextAsync();
            events.AddRange(response);
        }
        return events;
    }
}
```

## CQRS Implementation

Command Query Responsibility Segregation paired naturally with event sourcing:

```csharp
// Command side
public class CreateOrderCommandHandler : IRequestHandler<CreateOrderCommand, OrderResult>
{
    private readonly EventStore _eventStore;
    private readonly IEventPublisher _publisher;

    public async Task<OrderResult> Handle(CreateOrderCommand command, CancellationToken ct)
    {
        var orderId = Guid.NewGuid().ToString();
        var @event = new OrderCreated(
            EventId: Guid.NewGuid().ToString(),
            AggregateId: orderId,
            Timestamp: DateTime.UtcNow,
            Version: 1,
            CustomerId: command.CustomerId,
            Items: command.Items
        );

        await _eventStore.SaveEventsAsync(orderId, new[] { @event }, 0);
        await _publisher.PublishAsync(@event);

        return new OrderResult(orderId, true);
    }
}

// Query side with materialized view
public class OrderReadModel
{
    public string OrderId { get; set; }
    public string CustomerId { get; set; }
    public decimal TotalAmount { get; set; }
    public string Status { get; set; }
    public DateTime LastUpdated { get; set; }
}

public class OrderProjection : IEventHandler<OrderCreated>, IEventHandler<OrderShipped>
{
    private readonly Container _readModelContainer;

    public async Task HandleAsync(OrderCreated @event)
    {
        var readModel = new OrderReadModel
        {
            OrderId = @event.AggregateId,
            CustomerId = @event.CustomerId,
            TotalAmount = @event.Items.Sum(i => i.Price * i.Quantity),
            Status = "Created",
            LastUpdated = @event.Timestamp
        };

        await _readModelContainer.CreateItemAsync(readModel, new PartitionKey(readModel.CustomerId));
    }

    public async Task HandleAsync(OrderShipped @event)
    {
        var response = await _readModelContainer.ReadItemAsync<OrderReadModel>(
            @event.AggregateId,
            new PartitionKey(@event.AggregateId)
        );

        var readModel = response.Resource;
        readModel.Status = "Shipped";
        readModel.LastUpdated = @event.Timestamp;

        await _readModelContainer.ReplaceItemAsync(readModel, readModel.OrderId, new PartitionKey(readModel.CustomerId));
    }
}
```

## Saga Pattern for Distributed Transactions

Managing distributed transactions without two-phase commit:

```python
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional
import asyncio

class SagaStatus(Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    COMPENSATING = "compensating"
    COMPENSATED = "compensated"
    FAILED = "failed"

@dataclass
class SagaStep:
    name: str
    execute: callable
    compensate: callable
    status: SagaStatus = SagaStatus.PENDING

class OrderSaga:
    def __init__(self, order_id: str):
        self.order_id = order_id
        self.steps: List[SagaStep] = []
        self.completed_steps: List[SagaStep] = []

    def add_step(self, name: str, execute: callable, compensate: callable):
        self.steps.append(SagaStep(name, execute, compensate))

    async def execute(self):
        for step in self.steps:
            try:
                await step.execute()
                step.status = SagaStatus.COMPLETED
                self.completed_steps.append(step)
            except Exception as e:
                print(f"Step {step.name} failed: {e}")
                await self._compensate()
                raise SagaFailedException(f"Saga failed at step {step.name}")

    async def _compensate(self):
        for step in reversed(self.completed_steps):
            try:
                step.status = SagaStatus.COMPENSATING
                await step.compensate()
                step.status = SagaStatus.COMPENSATED
            except Exception as e:
                step.status = SagaStatus.FAILED
                print(f"Compensation failed for {step.name}: {e}")

# Usage
async def process_order(order: Order):
    saga = OrderSaga(order.id)

    saga.add_step(
        "reserve_inventory",
        lambda: inventory_service.reserve(order.items),
        lambda: inventory_service.release(order.items)
    )

    saga.add_step(
        "process_payment",
        lambda: payment_service.charge(order.customer_id, order.total),
        lambda: payment_service.refund(order.customer_id, order.total)
    )

    saga.add_step(
        "create_shipment",
        lambda: shipping_service.create(order),
        lambda: shipping_service.cancel(order.id)
    )

    await saga.execute()
```

## Event Mesh with Azure Event Grid

Connecting services through events:

```bicep
// Event Grid topic and subscriptions
resource eventGridTopic 'Microsoft.EventGrid/topics@2021-12-01' = {
  name: 'order-events'
  location: resourceGroup().location
  properties: {
    inputSchema: 'CloudEventSchemaV1_0'
  }
}

resource orderCreatedSubscription 'Microsoft.EventGrid/eventSubscriptions@2021-12-01' = {
  name: 'order-created-to-inventory'
  scope: eventGridTopic
  properties: {
    destination: {
      endpointType: 'AzureFunction'
      properties: {
        resourceId: inventoryFunction.id
      }
    }
    filter: {
      includedEventTypes: [
        'Order.Created'
      ]
    }
    eventDeliverySchema: 'CloudEventSchemaV1_0'
    retryPolicy: {
      maxDeliveryAttempts: 30
      eventTimeToLiveInMinutes: 1440
    }
    deadLetterDestination: {
      endpointType: 'StorageBlob'
      properties: {
        resourceId: storageAccount.id
        blobContainerName: 'deadletters'
      }
    }
  }
}
```

## Dead Letter Handling

Robust error handling for async systems:

```csharp
public class DeadLetterProcessor
{
    private readonly ServiceBusClient _client;
    private readonly ILogger<DeadLetterProcessor> _logger;

    public async Task ProcessDeadLettersAsync(string queueName)
    {
        var dlqPath = $"{queueName}/$deadletterqueue";
        var receiver = _client.CreateReceiver(dlqPath);

        await foreach (var message in receiver.ReceiveMessagesAsync())
        {
            _logger.LogWarning(
                "Dead letter: {MessageId}, Reason: {Reason}, Description: {Description}",
                message.MessageId,
                message.DeadLetterReason,
                message.DeadLetterErrorDescription
            );

            // Analyze and potentially retry
            var retryCount = message.ApplicationProperties.TryGetValue("RetryCount", out var count)
                ? (int)count : 0;

            if (retryCount < 3 && IsRetryable(message.DeadLetterReason))
            {
                // Requeue with incremented retry count
                var sender = _client.CreateSender(queueName);
                var newMessage = new ServiceBusMessage(message.Body)
                {
                    ApplicationProperties = { ["RetryCount"] = retryCount + 1 }
                };
                await sender.SendMessageAsync(newMessage);
            }
            else
            {
                // Store for manual inspection
                await StoreForManualReviewAsync(message);
            }

            await receiver.CompleteMessageAsync(message);
        }
    }
}
```

## Key Learnings from 2021

1. **Events Should Be Immutable Facts**: Don't update events, only append
2. **Idempotency Is Essential**: Design handlers to be safely re-run
3. **Observability Is Critical**: You need distributed tracing
4. **Schema Evolution Matters**: Plan for event versioning from day one

Event-driven architecture in 2021 moved from architectural pattern to practical implementation. The tools support it, the patterns are proven, and the benefits are clear.

## Resources

- [Azure Event Grid Documentation](https://docs.microsoft.com/en-us/azure/event-grid/)
- [Event Sourcing Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [CQRS Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/cqrs)
