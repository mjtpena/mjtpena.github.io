---
title: "Azure Event Grid: Event-Driven Architecture Made Simple"
author: Michael John Peña
draft: false
date: 2020-10-17
tags:
  - Azure
  - Event Grid
  - Serverless
  - Events

---

I wrote "Azure Event Grid: Event-Driven Architecture Made Simple" to share practical, production-minded guidance on this topic.

## Core Concepts

- **Events**: What happened (small, lightweight)
- **Publishers**: Where events come from
- **Topics**: Endpoints for sending events
- **Subscriptions**: Routes events to handlers
- **Handlers**: Where events go (Functions, Logic Apps, webhooks)

## Event Schema

```json
{
    "id": "unique-event-id",
    "eventType": "MyApp.Orders.OrderPlaced",
    "subject": "/orders/12345",
    "eventTime": "2020-10-17T10:30:00Z",
    "data": {
        "orderId": "12345",
        "customerId": "cust-789",
        "total": 99.99
    },
    "dataVersion": "1.0"
}
```

## Creating a Custom Topic

```bash
# Create topic
az eventgrid topic create \
    --name myapp-events \
    --location eastus \
    --resource-group myRG

# Get endpoint and key
az eventgrid topic show --name myapp-events --resource-group myRG --query endpoint
az eventgrid topic key list --name myapp-events --resource-group myRG --query key1
```

## Publishing Events

```csharp
using Azure.Messaging.EventGrid;

var client = new EventGridPublisherClient(
    new Uri("https://myapp-events.eastus-1.eventgrid.azure.net/api/events"),
    new AzureKeyCredential("your-key")
);

var events = new List<EventGridEvent>
{
    new EventGridEvent(
        subject: "/orders/12345",
        eventType: "MyApp.Orders.OrderPlaced",
        dataVersion: "1.0",
        data: new { orderId = "12345", total = 99.99 }
    )
};

await client.SendEventsAsync(events);
```

## Creating Subscriptions

### Azure Function Handler

```bash
az eventgrid event-subscription create \
    --name order-processor \
    --source-resource-id /subscriptions/{sub}/resourceGroups/myRG/providers/Microsoft.EventGrid/topics/myapp-events \
    --endpoint /subscriptions/{sub}/resourceGroups/myRG/providers/Microsoft.Web/sites/myfunc/functions/ProcessOrder \
    --endpoint-type azurefunction
```

### Webhook Handler

```bash
az eventgrid event-subscription create \
    --name order-webhook \
    --source-resource-id /subscriptions/{sub}/resourceGroups/myRG/providers/Microsoft.EventGrid/topics/myapp-events \
    --endpoint https://myapi.com/webhooks/eventgrid \
    --endpoint-type webhook
```

## Azure Function Handler

```csharp
[FunctionName("ProcessOrder")]
public static async Task Run(
    [EventGridTrigger] EventGridEvent eventGridEvent,
    ILogger log)
{
    log.LogInformation($"Event type: {eventGridEvent.EventType}");
    log.LogInformation($"Subject: {eventGridEvent.Subject}");
    log.LogInformation($"Data: {eventGridEvent.Data}");

    var orderData = eventGridEvent.Data.ToObjectFromJson<OrderData>();
    // Process order...
}
```

## Event Filtering

```bash
# Filter by event type
az eventgrid event-subscription create \
    --name filtered-sub \
    --source-resource-id ... \
    --endpoint ... \
    --included-event-types MyApp.Orders.OrderPlaced MyApp.Orders.OrderShipped

# Advanced filtering
az eventgrid event-subscription create \
    --name advanced-sub \
    --source-resource-id ... \
    --endpoint ... \
    --advanced-filter data.total NumberGreaterThan 100
```

## System Topics (Azure Service Events)

```bash
# Subscribe to Blob Storage events
az eventgrid event-subscription create \
    --name blob-events \
    --source-resource-id /subscriptions/{sub}/resourceGroups/myRG/providers/Microsoft.Storage/storageAccounts/mystorageaccount \
    --endpoint /subscriptions/{sub}/resourceGroups/myRG/providers/Microsoft.Web/sites/myfunc/functions/ProcessBlob \
    --endpoint-type azurefunction \
    --included-event-types Microsoft.Storage.BlobCreated
```

## Dead Letter and Retry

```bash
# Configure dead letter destination
az eventgrid event-subscription update \
    --name my-sub \
    --source-resource-id ... \
    --deadletter-endpoint /subscriptions/{sub}/resourceGroups/myRG/providers/Microsoft.Storage/storageAccounts/mystorageaccount/blobServices/default/containers/deadletter
```

Event Grid enables reactive, event-driven architectures at scale.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
