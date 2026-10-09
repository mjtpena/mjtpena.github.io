---
title: "Building Event-Driven Architectures with Azure Event Grid and Functions"
description: "Event-driven architecture requires careful design but delivers superior scalability and resilience for distributed systems."
author: Michael John Peña
draft: false
date: 2025-12-11
tags:
  - Event-Driven
  - Azure
  - Event-Grid
  - Functions
  - Architecture
---

## Architecture Overview

```
Source Events -> Event Grid Topic -> Subscriptions -> Azure Functions -> Downstream Services
                                        |
                              Dead Letter Storage
                                        |
                              Retry Handler
```

## Defining Custom Events

```csharp
public record OrderPlacedEvent
{
    public string EventType => "Order.Placed";
    public string Subject => $"/orders/{OrderId}";
    public required string OrderId { get; init; }
    public required string CustomerId { get; init; }
    public required decimal TotalAmount { get; init; }
    public required List<OrderItem> Items { get; init; }
    public DateTime OccurredAt { get; init; } = DateTime.UtcNow;
}

public record OrderItem
{
    public required string ProductId { get; init; }
    public required int Quantity { get; init; }
    public required decimal UnitPrice { get; init; }
}
```

## Publishing Events

```csharp
using Azure.Messaging.EventGrid;

public class EventPublisher
{
    private readonly EventGridPublisherClient _client;

    public EventPublisher(string topicEndpoint, string topicKey)
    {
        _client = new EventGridPublisherClient(
            new Uri(topicEndpoint),
            new AzureKeyCredential(topicKey));
    }

    public async Task PublishOrderPlacedAsync(OrderPlacedEvent orderEvent)
    {
        var cloudEvent = new CloudEvent(
            source: "/orders/service",
            type: orderEvent.EventType,
            jsonSerializableData: orderEvent)
        {
            Subject = orderEvent.Subject,
            Time = orderEvent.OccurredAt
        };

        await _client.SendEventAsync(cloudEvent);
    }
}
```

## Event Handler Function

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class OrderEventHandlers
{
    private readonly ILogger<OrderEventHandlers> _logger;
    private readonly IInventoryService _inventory;
    private readonly INotificationService _notifications;

    public OrderEventHandlers(
        ILogger<OrderEventHandlers> logger,
        IInventoryService inventory,
        INotificationService notifications)
    {
        _logger = logger;
        _inventory = inventory;
        _notifications = notifications;
    }

    [Function("ProcessOrderPlaced")]
    public async Task ProcessOrderPlaced(
        [EventGridTrigger] CloudEvent cloudEvent)
    {
        var order = cloudEvent.Data.ToObjectFromJson<OrderPlacedEvent>();

        _logger.LogInformation("Processing order {OrderId}", order.OrderId);

        // Reserve inventory
        foreach (var item in order.Items)
        {
            await _inventory.ReserveAsync(item.ProductId, item.Quantity);
        }

        // Send confirmation
        await _notifications.SendOrderConfirmationAsync(
            order.CustomerId,
            order.OrderId);

        _logger.LogInformation("Order {OrderId} processed successfully", order.OrderId);
    }
}
```

## Dead Letter Handling

```csharp
[Function("ProcessDeadLetter")]
public async Task ProcessDeadLetter(
    [BlobTrigger("deadletter/{name}", Connection = "StorageConnection")]
    Stream deadLetterBlob,
    string name,
    ILogger logger)
{
    using var reader = new StreamReader(deadLetterBlob);
    var content = await reader.ReadToEndAsync();
    var failedEvent = JsonSerializer.Deserialize<CloudEvent>(content);

    logger.LogWarning(
        "Dead letter event: {EventType}, Subject: {Subject}",
        failedEvent?.Type,
        failedEvent?.Subject);

    // Analyze failure and take action
    await AlertOperationsTeam(failedEvent);
}
```

## Best Practices

1. **Use CloudEvents format** for interoperability
2. **Implement idempotency** - events may be delivered multiple times
3. **Set appropriate retry policies** based on handler complexity
4. **Monitor dead letter queues** actively
5. **Version your events** to support evolution

Event-driven architecture requires careful design but delivers superior scalability and resilience for distributed systems.
