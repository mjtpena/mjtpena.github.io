---
title: "Event-Driven Architecture with Azure Event Grid"
description: "There's a recurring confusion among teams new to Azure: which messaging service do I use? Service Bus, Event Hubs, Event Grid, Storage Queues — they all…"
author: Michael John Peña
draft: false
date: 2020-08-19
tags:
  - Azure
  - Event Grid
  - Event-Driven
  - Serverless
---

There's a recurring confusion among teams new to Azure: which messaging service do I use? Service Bus, Event Hubs, Event Grid, Storage Queues — they all sound like they do the same thing. Event Grid is specifically the one for *reactive* glue: "when X happens in Azure, do Y." Blob uploaded → trigger a function. Resource Group changed → notify ops. It's not for ordered work-queues (that's Service Bus) or for telemetry firehoses (that's Event Hubs). Here's where it shines, and the patterns that actually hold up in production.

## Understanding Event Grid

Event Grid connects event sources to event handlers:

- **Publishers** - Azure services or custom applications
- **Topics** - Endpoints for publishing events
- **Subscriptions** - Routes events to handlers
- **Event Handlers** - Azure Functions, Logic Apps, Webhooks, etc.

## Creating a Custom Topic

```bash
# Create a custom topic
az eventgrid topic create \
    --name events-myapp \
    --resource-group rg-events \
    --location australiaeast

# Get the endpoint
az eventgrid topic show \
    --name events-myapp \
    --resource-group rg-events \
    --query endpoint

# Get the access key
az eventgrid topic key list \
    --name events-myapp \
    --resource-group rg-events
```

## Publishing Events

```csharp
using Azure.Messaging.EventGrid;

public class EventPublisher
{
    private readonly EventGridPublisherClient _client;

    public EventPublisher(string topicEndpoint, string accessKey)
    {
        var credential = new AzureKeyCredential(accessKey);
        _client = new EventGridPublisherClient(new Uri(topicEndpoint), credential);
    }

    public async Task PublishOrderCreatedAsync(Order order)
    {
        var events = new List<EventGridEvent>
        {
            new EventGridEvent(
                subject: $"orders/{order.Id}",
                eventType: "Order.Created",
                dataVersion: "1.0",
                data: new OrderCreatedEvent
                {
                    OrderId = order.Id,
                    CustomerId = order.CustomerId,
                    TotalAmount = order.TotalAmount,
                    Items = order.Items.Select(i => new OrderItemEvent
                    {
                        ProductId = i.ProductId,
                        Quantity = i.Quantity,
                        Price = i.Price
                    }).ToList()
                })
        };

        await _client.SendEventsAsync(events);
    }

    public async Task PublishBatchAsync<T>(string eventType, IEnumerable<T> items)
    {
        var events = items.Select(item => new EventGridEvent(
            subject: $"{eventType.ToLower()}/{Guid.NewGuid()}",
            eventType: eventType,
            dataVersion: "1.0",
            data: item
        )).ToList();

        // Event Grid supports up to 1MB per request
        await _client.SendEventsAsync(events);
    }
}

public class OrderCreatedEvent
{
    public string OrderId { get; set; }
    public string CustomerId { get; set; }
    public decimal TotalAmount { get; set; }
    public List<OrderItemEvent> Items { get; set; }
}
```

## Creating Event Subscriptions

### Azure Function Handler

```bash
# Create subscription to Azure Function
az eventgrid event-subscription create \
    --name order-processor-sub \
    --source-resource-id "/subscriptions/{sub}/resourceGroups/rg-events/providers/Microsoft.EventGrid/topics/events-myapp" \
    --endpoint "/subscriptions/{sub}/resourceGroups/rg-functions/providers/Microsoft.Web/sites/order-processor-func/functions/ProcessOrder" \
    --endpoint-type azurefunction \
    --event-delivery-schema eventgridschema
```

### Webhook Handler

```bash
# Create subscription to webhook
az eventgrid event-subscription create \
    --name webhook-sub \
    --source-resource-id "/subscriptions/{sub}/resourceGroups/rg-events/providers/Microsoft.EventGrid/topics/events-myapp" \
    --endpoint "https://myapi.azurewebsites.net/api/events" \
    --endpoint-type webhook \
    --included-event-types "Order.Created" "Order.Updated"
```

## Azure Function Event Handler

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.EventGrid;
using Azure.Messaging.EventGrid;

public class OrderEventFunctions
{
    private readonly IOrderService _orderService;
    private readonly ILogger<OrderEventFunctions> _logger;

    public OrderEventFunctions(IOrderService orderService, ILogger<OrderEventFunctions> logger)
    {
        _orderService = orderService;
        _logger = logger;
    }

    [FunctionName("ProcessOrderCreated")]
    public async Task ProcessOrderCreated(
        [EventGridTrigger] EventGridEvent eventGridEvent)
    {
        _logger.LogInformation("Processing event: {EventType}, Subject: {Subject}",
            eventGridEvent.EventType, eventGridEvent.Subject);

        var orderEvent = eventGridEvent.Data.ToObjectFromJson<OrderCreatedEvent>();

        await _orderService.ProcessNewOrderAsync(orderEvent);
    }

    [FunctionName("ProcessOrderEvents")]
    public async Task ProcessOrderEvents(
        [EventGridTrigger] EventGridEvent[] events)
    {
        foreach (var eventGridEvent in events)
        {
            switch (eventGridEvent.EventType)
            {
                case "Order.Created":
                    await HandleOrderCreatedAsync(eventGridEvent);
                    break;
                case "Order.Shipped":
                    await HandleOrderShippedAsync(eventGridEvent);
                    break;
                default:
                    _logger.LogWarning("Unknown event type: {EventType}", eventGridEvent.EventType);
                    break;
            }
        }
    }
}
```

## Webhook Handler (ASP.NET Core)

```csharp
[ApiController]
[Route("api/[controller]")]
public class EventsController : ControllerBase
{
    private readonly ILogger<EventsController> _logger;

    public EventsController(ILogger<EventsController> logger)
    {
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> HandleEvent()
    {
        using var reader = new StreamReader(Request.Body);
        var requestBody = await reader.ReadToEndAsync();

        var events = JsonSerializer.Deserialize<EventGridEvent[]>(requestBody);

        foreach (var eventGridEvent in events)
        {
            // Handle subscription validation
            if (eventGridEvent.EventType == "Microsoft.EventGrid.SubscriptionValidationEvent")
            {
                var validationData = eventGridEvent.Data.ToObjectFromJson<SubscriptionValidationEventData>();
                return Ok(new { validationResponse = validationData.ValidationCode });
            }

            // Handle actual events
            await ProcessEventAsync(eventGridEvent);
        }

        return Ok();
    }

    private async Task ProcessEventAsync(EventGridEvent eventGridEvent)
    {
        _logger.LogInformation("Received event: {EventType}", eventGridEvent.EventType);

        switch (eventGridEvent.EventType)
        {
            case "Order.Created":
                var orderData = eventGridEvent.Data.ToObjectFromJson<OrderCreatedEvent>();
                // Process order
                break;
        }
    }
}
```

## Event Filtering

Apply advanced filters:

```bash
az eventgrid event-subscription create \
    --name filtered-sub \
    --source-resource-id "/subscriptions/{sub}/resourceGroups/rg-events/providers/Microsoft.EventGrid/topics/events-myapp" \
    --endpoint "https://myapi.azurewebsites.net/api/events" \
    --advanced-filter data.totalAmount NumberGreaterThan 1000 \
    --advanced-filter data.customerId StringContains "premium"
```

## System Topics for Azure Events

React to Azure resource events:

```bash
# Create system topic for blob storage events
az eventgrid system-topic create \
    --name blob-events-topic \
    --resource-group rg-events \
    --source "/subscriptions/{sub}/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/mystore" \
    --topic-type Microsoft.Storage.StorageAccounts \
    --location australiaeast

# Subscribe to blob created events
az eventgrid system-topic event-subscription create \
    --name blob-created-sub \
    --system-topic-name blob-events-topic \
    --resource-group rg-events \
    --endpoint "/subscriptions/{sub}/resourceGroups/rg-functions/providers/Microsoft.Web/sites/blob-processor/functions/ProcessBlob" \
    --endpoint-type azurefunction \
    --included-event-types Microsoft.Storage.BlobCreated
```

## Dead Letter Configuration

Handle failed deliveries:

```bash
az eventgrid event-subscription create \
    --name resilient-sub \
    --source-resource-id "/subscriptions/{sub}/resourceGroups/rg-events/providers/Microsoft.EventGrid/topics/events-myapp" \
    --endpoint "https://myapi.azurewebsites.net/api/events" \
    --deadletter-endpoint "/subscriptions/{sub}/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/mystore/blobServices/default/containers/deadletters" \
    --max-delivery-attempts 10 \
    --event-ttl 1440
```

My one strong opinion on Event Grid: always configure dead-lettering, even in dev. Events are fire-and-forget by design — if a handler is down or buggy, those events are gone unless they land in DLQ storage. The first time a downstream system ate poison events for a week before anyone noticed is the last time you ship Event Grid without DLQ.
