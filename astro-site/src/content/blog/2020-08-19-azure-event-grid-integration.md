---
title: "Azure Event Grid as Reactive Glue: Delivery, Retries and Dead-Letters"
description: "When to pick Event Grid over Service Bus or Event Hubs, and how to publish, handle, filter and dead-letter events so failed deliveries aren't silently lost."
author: Michael John Peña
draft: false
date: 2020-08-19
tags:
  - Azure
  - Event Grid
  - Event-Driven
  - Serverless
  - Messaging
---

Event Grid makes it easy to wire Azure events to handlers, and just as easy to lose events silently when a handler fails. Retries run out, nothing is dead-lettered, and no one notices until a downstream system is a week behind. Before you get to delivery, though, make sure Event Grid is the right service at all: Service Bus, Event Hubs, Event Grid and Storage Queues all sound like they do the same thing, and picking the wrong one is expensive to undo.

## Pick the right service first

Event Grid is a push-based event router. It doesn't hold work for you to pull, it doesn't guarantee order, and it isn't built to ingest telemetry at millions of events per second. Microsoft's [comparison of the messaging services](https://learn.microsoft.com/en-us/azure/service-bus-messaging/compare-messaging-services) draws the line between *events* (a notification that something happened) and *messages* (data the sender expects someone to act on). I find that distinction the most useful one to start with.

| Need | Use | Why |
|---|---|---|
| "Something happened", fan out to many handlers | Event Grid | Push delivery, filtering per subscription, pay per operation |
| A command that must be processed once, maybe in order | Service Bus | Sessions, transactions, duplicate detection, pull with locks |
| High-volume telemetry or a log stream | Event Hubs | Partitioned, replayable stream with consumer offsets |
| Simple background work in one app | Storage Queues | Cheap and simple, few features |

If the consumer needs to say "I'll take this work item when I'm ready", you want a queue, not Event Grid. I covered the queue side of that in [Azure Service Bus messaging](/blog/2020-08-13-azure-service-bus-messaging/). The two combine well: Event Grid can tell a system that something changed, and a Service Bus queue can hold the resulting work.

## The moving parts

An Event Grid setup has four pieces:

- **Publishers**: Azure services (Blob Storage, Resource Manager, IoT Hub and others) or your own code.
- **Topics**: the endpoint events are sent to. *System topics* represent an Azure service's events. *Custom topics* are yours.
- **Event subscriptions**: the routing rules. Each says which events to send to which handler, with what filter, retry policy and dead-letter location.
- **Handlers**: Azure Functions, Logic Apps, webhooks, Storage Queues, Event Hubs and Service Bus, among others.

The design decision that matters is that the subscription owns delivery behaviour, not the publisher. A publisher fires and forgets. Each subscriber decides its own filter, retries and dead-letter policy, so a slow or broken consumer can't hold up the others.

## A custom topic and a publisher

Creating a custom topic with the Azure CLI:

```bash
az eventgrid topic create \
    --name <your-topic-name> \
    --resource-group <your-resource-group> \
    --location australiaeast

az eventgrid topic show \
    --name <your-topic-name> \
    --resource-group <your-resource-group> \
    --query endpoint --output tsv

az eventgrid topic key list \
    --name <your-topic-name> \
    --resource-group <your-resource-group> \
    --query key1 --output tsv
```

For .NET, the stable publishing SDK right now is [`Microsoft.Azure.EventGrid`](https://www.nuget.org/packages/Microsoft.Azure.EventGrid/3.2.0) 3.2.0. You authenticate with the topic key through `TopicCredentials`, and you pass the topic's *host name* to `PublishEventsAsync`, not the full endpoint URL. That trips people up.

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Azure.EventGrid;
using Microsoft.Azure.EventGrid.Models;

public class OrderCreated
{
    public string OrderId { get; set; }
    public string CustomerId { get; set; }
    public decimal TotalAmount { get; set; }
}

public class OrderEventPublisher : IDisposable
{
    private readonly EventGridClient _client;
    private readonly string _topicHostname;

    public OrderEventPublisher(string topicEndpoint, string topicKey)
    {
        // "https://<your-topic-name>.australiaeast-1.eventgrid.azure.net/api/events" -> host name only
        _topicHostname = new Uri(topicEndpoint).Host;
        _client = new EventGridClient(new TopicCredentials(topicKey));
    }

    public Task PublishOrderCreatedAsync(OrderCreated order)
    {
        var events = new List<EventGridEvent>
        {
            new EventGridEvent(
                id: Guid.NewGuid().ToString(),
                subject: $"orders/{order.OrderId}",
                data: order,
                eventType: "Contoso.Orders.OrderCreated",
                eventTime: DateTime.UtcNow,
                dataVersion: "1.0")
        };

        return _client.PublishEventsAsync(_topicHostname, events);
    }

    public void Dispose() => _client.Dispose();
}
```

Keep event payloads small. Events up to 64 KB are covered by the GA SLA; support up to 1 MB is in public preview, and larger events are billed in 64 KB increments (the current maximums are on the [Event Grid quotas and limits page](https://learn.microsoft.com/en-us/azure/event-grid/quotas-limits)). My rule of thumb is to publish *that* something changed, plus the IDs a handler needs to fetch the rest. Don't send the whole entity. Fat events couple every subscriber to your internal model and go stale the moment they're delivered late.

A note on schemas: the stable 2020-06-01 API supports the [CloudEvents v1.0](https://learn.microsoft.com/en-us/azure/event-grid/cloud-event-schema) schema alongside the native Event Grid schema. You choose the schema per topic when you create it. If you expect non-Azure consumers or publishers, CloudEvents is worth choosing up front, because changing it later means touching every publisher and handler.

## Handling events in Azure Functions

The Event Grid trigger in `Microsoft.Azure.WebJobs.Extensions.EventGrid` 2.1.0 binds to the same `EventGridEvent` model. With the `azurefunction` endpoint type, the subscription validation handshake is done for you. `Data` arrives as a `JObject`, so you convert it yourself. The handler shares the `OrderCreated` contract class with the publisher, for example through a small shared contracts library:

```csharp
using System.Threading.Tasks;
using Microsoft.Azure.EventGrid.Models;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.EventGrid;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

public static class OrderCreatedHandler
{
    [FunctionName("OrderCreatedHandler")]
    public static Task Run(
        [EventGridTrigger] EventGridEvent eventGridEvent,
        ILogger log)
    {
        var order = ((JObject)eventGridEvent.Data).ToObject<OrderCreated>();

        log.LogInformation(
            "Order {OrderId} for {CustomerId} received (event {EventId})",
            order.OrderId, order.CustomerId, eventGridEvent.Id);

        // Make this idempotent: Event Grid delivers at least once.
        return Task.CompletedTask;
    }
}
```

That last comment matters more than anything else in the function. Event Grid guarantees [at-least-once delivery](https://learn.microsoft.com/en-us/azure/event-grid/delivery-and-retry), so the same event can arrive twice. Use the event `Id`, or a business key such as the order ID, to make handling safe to repeat.

Subscribing the function to the topic:

```bash
az eventgrid event-subscription create \
    --name order-created-to-func \
    --source-resource-id "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.EventGrid/topics/<your-topic-name>" \
    --endpoint "/subscriptions/<subscription-id>/resourceGroups/<your-function-rg>/providers/Microsoft.Web/sites/<your-function-app>/functions/OrderCreatedHandler" \
    --endpoint-type azurefunction \
    --included-event-types Contoso.Orders.OrderCreated
```

## Webhooks must prove they want the events

A plain HTTPS webhook has to complete a [validation handshake](https://learn.microsoft.com/en-us/azure/event-grid/end-point-validation-event-grid-events-schema) before Event Grid will deliver to it. Event Grid sends a `Microsoft.EventGrid.SubscriptionValidationEvent`, and your endpoint echoes back the validation code. If you forget to handle it, the subscription creation fails, which confuses people the first time. If you can't change the endpoint's code, Event Grid also sends a `validationUrl` you can GET within the validation window to confirm the subscription by hand. Here's an ASP.NET Core 3.1 controller that handles both the handshake and real events using `EventGridSubscriber` from the same SDK:

```csharp
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.EventGrid;
using Microsoft.Azure.EventGrid.Models;
using Microsoft.Extensions.Logging;

[ApiController]
[Route("api/events")]
public class EventsController : ControllerBase
{
    private const string OrderCreatedType = "Contoso.Orders.OrderCreated";
    private readonly ILogger<EventsController> _logger;
    private readonly EventGridSubscriber _subscriber = new EventGridSubscriber();

    public EventsController(ILogger<EventsController> logger)
    {
        _logger = logger;
        _subscriber.AddOrUpdateCustomEventMapping(OrderCreatedType, typeof(OrderCreated));
    }

    [HttpPost]
    public async Task<IActionResult> Post()
    {
        using var reader = new StreamReader(Request.Body);
        var body = await reader.ReadToEndAsync();
        var events = _subscriber.DeserializeEventGridEvents(body);

        foreach (var e in events)
        {
            if (e.Data is SubscriptionValidationEventData validation)
            {
                return Ok(new SubscriptionValidationResponse(validation.ValidationCode));
            }

            if (e.Data is OrderCreated order)
            {
                _logger.LogInformation("Order {OrderId} received", order.OrderId);
            }
        }

        return Ok();
    }
}
```

As written, this controller accepts a POST from anyone who finds the URL. Event Grid doesn't sign webhook deliveries, so add your own check: put a secret query-string parameter in the subscription's endpoint URL (for example `https://<your-app>.azurewebsites.net/api/events?code=<your-secret>`), have the controller compare it against a value from configuration, and return 401 when it's missing or wrong. Event Grid can also authenticate to the endpoint with Azure Active Directory if you'd rather validate a token than manage a shared secret.

Most non-success responses tell Event Grid to retry. A 400 or 413 skips the retries and goes straight to dead-letter (or is dropped if there's no dead-letter destination), so don't return 400 for a transient failure. Return 200 only once you've handled the event or safely handed it off. Event Grid waits up to 30 seconds for a response before it treats the delivery as failed and queues a retry, and an endpoint that keeps failing gets new deliveries delayed too, so one slow handler hurts every event headed its way. If processing takes more than a moment, write to a queue and return. Don't make Event Grid wait on your database.

## Filter at the subscription, not in the handler

Every event delivered to a handler costs an operation and an invocation. Event Grid [bills per operation](https://azure.microsoft.com/pricing/details/event-grid/): ingress, each advanced-filter match and each delivery attempt all count, with the first 100,000 operations a month free. So an advanced filter costs an operation per match, but that is still far cheaper than a delivery plus a function invocation for an event you then discard. Subject filters (`--subject-begins-with`, `--subject-ends-with`) and event type filters cover most cases. [Advanced filters](https://learn.microsoft.com/en-us/azure/event-grid/event-filtering) let you route on fields inside `data`:

```bash
az eventgrid event-subscription create \
    --name large-orders \
    --source-resource-id "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.EventGrid/topics/<your-topic-name>" \
    --endpoint "https://<your-app>.azurewebsites.net/api/events" \
    --included-event-types Contoso.Orders.OrderCreated \
    --advanced-filter data.TotalAmount NumberGreaterThan 1000
```

Make the key match the property name your publisher actually emits: the 3.x SDK serialises `TotalAmount` as written, not camelCase. Note that string *values* are compared case-insensitively. There are also hard limits: at the time of writing, a subscription can have at most 5 advanced filters and 25 filter values across all of them (the limit on the 2020-06-01 API; see the [event filtering docs](https://learn.microsoft.com/en-us/azure/event-grid/event-filtering#limitations), which show the current figure). If you find yourself writing complex routing logic in filters, that's a sign the logic belongs in code.

## System topics: reacting to Azure itself

For Azure service events, you don't create a topic. You subscribe to the resource, and Event Grid uses that service's system topic. Since June 2020, [system topics are visible as Azure resources](https://learn.microsoft.com/en-us/azure/event-grid/system-topics), so you can see and manage them in the portal instead of them being implicit.

```bash
az eventgrid event-subscription create \
    --name blob-created-to-func \
    --source-resource-id "/subscriptions/<subscription-id>/resourceGroups/<your-storage-rg>/providers/Microsoft.Storage/storageAccounts/<your-storage-account>" \
    --endpoint "/subscriptions/<subscription-id>/resourceGroups/<your-function-rg>/providers/Microsoft.Web/sites/<your-function-app>/functions/BlobCreatedHandler" \
    --endpoint-type azurefunction \
    --included-event-types Microsoft.Storage.BlobCreated \
    --subject-begins-with /blobServices/default/containers/uploads/
```

This is where Event Grid beats the old Blob trigger in Functions. The Blob trigger works by polling and can lag, especially on the Consumption plan. Event Grid pushes within seconds.

## Retries and dead-lettering: the part people skip

By default, Event Grid retries a failed delivery with exponential backoff for up to 30 attempts or 24 hours, whichever comes first. After that, the event is dropped, *unless* you've configured a dead-letter destination. Dead-lettering writes undeliverable events as blobs to a storage container you choose:

```bash
az eventgrid event-subscription create \
    --name order-created-resilient \
    --source-resource-id "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.EventGrid/topics/<your-topic-name>" \
    --endpoint "https://<your-app>.azurewebsites.net/api/events" \
    --deadletter-endpoint "/subscriptions/<subscription-id>/resourceGroups/<your-storage-rg>/providers/Microsoft.Storage/storageAccounts/<your-storage-account>/blobServices/default/containers/deadletters" \
    --max-delivery-attempts 10 \
    --event-ttl 120
```

Two choices to make deliberately:

- **Retry budget.** Two settings bound it: `--max-delivery-attempts` (1 to 30) and `--event-ttl`, the event's time-to-live in minutes (1 to 1440, default 1440). Delivery stops at whichever comes first, then the event goes to dead-letter. Lowering either gets failures into the dead-letter container sooner, where you can see them. Thirty attempts over a day is generous for a handler that is simply broken; here, two hours is the real limit, because the backoff schedule won't reach ten attempts inside it.
- **Who watches the container.** Dead-letter blobs no one looks at are just a slower way to lose data. Put an alert on the dead-letter metrics, or put an Event Grid subscription on the dead-letter container itself, so a dead-lettered event notifies someone.

My one strong opinion on Event Grid: always configure dead-lettering, even in dev. Delivery is fire-and-forget from the publisher's side. If a handler is down or buggy, those events are gone once the retries run out, unless they land in dead-letter storage. The first time a downstream system quietly drops a week of events because nobody noticed, you'll stop shipping Event Grid subscriptions without a dead-letter container.

## When not to use Event Grid

- **You need ordering.** Event Grid makes no ordering guarantee. Use Service Bus sessions or Event Hubs partitions.
- **The consumer controls the pace.** Push delivery means your handler takes the load as it comes. If the consumer must pull at its own rate, use a queue.
- **You're streaming telemetry.** High-volume, replayable streams belong in Event Hubs.
- **The handler can't be idempotent.** At-least-once delivery will eventually hand you a duplicate.

## The takeaway

Use Event Grid when the job is "tell interested parties that something happened" and each party can cope with duplicates and out-of-order arrival. Keep events thin, filter at the subscription, and treat the retry policy and dead-letter container as part of the design, not something you add after the first incident. If any of those constraints don't fit, that's your signal to reach for Service Bus or Event Hubs.
