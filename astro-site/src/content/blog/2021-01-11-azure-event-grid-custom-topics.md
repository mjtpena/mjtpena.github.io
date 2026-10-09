---
title: "Azure Event Grid Custom Topics: Event-Driven Architecture"
description: "Service Bus is fine for service-to-service messaging, but when you want \"anything in the system can listen for the order created event,\" Service Bus topics…"
author: Michael John Peña
draft: false
date: 2021-01-11
tags:
  - Azure
  - Event Grid
  - Events
  - Serverless
---

Service Bus is fine for service-to-service messaging, but when you want "anything in the system can listen for the order created event," Service Bus topics get awkward. Event Grid custom topics fit that shape natively—publish your domain events, let consumers subscribe with filters, and let Event Grid handle delivery (retries, dead-lettering, throughput). I keep recommending it as the backbone for event-driven architectures where the publisher shouldn't know the consumer list.

## Event Grid Concepts

- **Topic**: Endpoint where events are sent
- **Event Subscription**: Routes events to handlers
- **Event Handler**: Service that receives events
- **Event Schema**: Structure of event data

## Create Custom Topic

```bash
# Create Event Grid topic
az eventgrid topic create \
    --name my-custom-topic \
    --resource-group myRG \
    --location eastus

# Get topic endpoint and key
az eventgrid topic show \
    --name my-custom-topic \
    --resource-group myRG \
    --query endpoint

az eventgrid topic key list \
    --name my-custom-topic \
    --resource-group myRG \
    --query key1
```

## Event Schema

```json
[
    {
        "id": "unique-event-id",
        "eventType": "Order.Created",
        "subject": "/orders/12345",
        "eventTime": "2021-01-11T10:30:00Z",
        "data": {
            "orderId": "12345",
            "customerId": "cust-789",
            "amount": 299.99,
            "items": [
                { "productId": "prod-1", "quantity": 2 }
            ]
        },
        "dataVersion": "1.0"
    }
]
```

## Publish Events (.NET)

```csharp
using Azure;
using Azure.Messaging.EventGrid;

var endpoint = new Uri("https://my-custom-topic.eastus-1.eventgrid.azure.net/api/events");
var credential = new AzureKeyCredential("your-key");
var client = new EventGridPublisherClient(endpoint, credential);

// Create event
var orderEvent = new EventGridEvent(
    subject: "/orders/12345",
    eventType: "Order.Created",
    dataVersion: "1.0",
    data: new
    {
        OrderId = "12345",
        CustomerId = "cust-789",
        Amount = 299.99m,
        CreatedAt = DateTime.UtcNow
    }
);

// Publish event
await client.SendEventAsync(orderEvent);
Console.WriteLine("Event published");

// Publish batch
var events = new List<EventGridEvent>
{
    new EventGridEvent("/orders/123", "Order.Created", "1.0", orderData1),
    new EventGridEvent("/orders/124", "Order.Created", "1.0", orderData2),
    new EventGridEvent("/orders/125", "Order.Shipped", "1.0", orderData3)
};

await client.SendEventsAsync(events);
```

## Create Event Subscription

```bash
# Subscribe Azure Function to topic
az eventgrid event-subscription create \
    --name order-processor-subscription \
    --source-resource-id /subscriptions/.../topics/my-custom-topic \
    --endpoint-type azurefunction \
    --endpoint /subscriptions/.../functions/ProcessOrder

# Subscribe webhook
az eventgrid event-subscription create \
    --name webhook-subscription \
    --source-resource-id /subscriptions/.../topics/my-custom-topic \
    --endpoint https://myapi.com/webhooks/eventgrid

# Subscribe with filters
az eventgrid event-subscription create \
    --name filtered-subscription \
    --source-resource-id /subscriptions/.../topics/my-custom-topic \
    --endpoint https://myapi.com/webhooks/orders \
    --event-types Order.Created Order.Updated \
    --subject-begins-with /orders/ \
    --subject-ends-with /priority
```

## Handle Events (Azure Function)

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.EventGrid;
using Azure.Messaging.EventGrid;

public static class OrderProcessor
{
    [FunctionName("ProcessOrder")]
    public static async Task Run(
        [EventGridTrigger] EventGridEvent eventGridEvent,
        ILogger log)
    {
        log.LogInformation($"Event type: {eventGridEvent.EventType}");
        log.LogInformation($"Subject: {eventGridEvent.Subject}");
        log.LogInformation($"Data: {eventGridEvent.Data}");

        // Deserialize event data
        var orderData = eventGridEvent.Data.ToObjectFromJson<OrderCreatedData>();

        // Process the order
        await ProcessOrderAsync(orderData);
    }
}

public record OrderCreatedData(
    string OrderId,
    string CustomerId,
    decimal Amount,
    DateTime CreatedAt
);
```

## Advanced Filtering

```bash
# Advanced filter with multiple conditions
az eventgrid event-subscription create \
    --name advanced-filtered \
    --source-resource-id /subscriptions/.../topics/my-custom-topic \
    --endpoint https://myapi.com/webhooks \
    --advanced-filter data.amount NumberGreaterThan 100 \
    --advanced-filter data.priority StringIn high critical
```

## Dead-lettering

```bash
# Enable dead-letter destination
az eventgrid event-subscription create \
    --name with-deadletter \
    --source-resource-id /subscriptions/.../topics/my-custom-topic \
    --endpoint https://myapi.com/webhooks \
    --deadletter-endpoint /subscriptions/.../storageAccounts/mystorage/blobServices/default/containers/deadletter
```

## CloudEvents Schema

```csharp
// Use CloudEvents format
var cloudEvent = new CloudEvent(
    source: "/myapp/orders",
    type: "order.created",
    data: new { OrderId = "12345", Amount = 99.99 }
);

var client = new EventGridPublisherClient(endpoint, credential);
await client.SendEventAsync(cloudEvent);
```

Event Grid: reliable event delivery at massive scale.
