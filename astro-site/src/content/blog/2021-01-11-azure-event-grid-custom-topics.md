---
title: "Designing Domain Events for Azure Event Grid Custom Topics"
description: "How to design the event contract, topic boundaries, filters and consumers for Azure Event Grid custom topics, and which .NET SDK to use in January 2021."
author: Michael John Peña
draft: false
date: 2021-01-11
tags:
  - Azure
  - Event Grid
  - Event-Driven
  - Architecture
  - .NET
---

Creating an Event Grid custom topic takes one CLI command. Designing what goes through it is the hard part. Once five teams subscribe to your `Order.Created` event, its shape, its subject format and its delivery semantics become a public contract that is expensive to change. Most of the pain I see with custom topics comes from treating them as a fire-and-forget pipe when they are really an API.

I've covered the mechanics before in [Event-Driven Architecture with Azure Event Grid](/blog/2020-08-19-azure-event-grid-integration/) and [Azure Event Grid: Event-Driven Architecture Made Simple](/blog/2020-10-17-azure-event-grid-fundamentals/). This post is about the design decisions: what to put in the event, how to draw topic boundaries, how consumers should filter, and which .NET SDK to use right now.

## What a custom topic gives you, and what it doesn't

A custom topic is an HTTPS endpoint you publish your own events to. Subscribers register event subscriptions against it, each with its own filter, handler endpoint, retry policy and optional dead-letter container. Event Grid pushes each matching event to each subscriber. The publisher never knows who is listening, which is the whole point.

It's worth being precise about what you are buying:

- **Push delivery, at least once.** Event Grid retries failed deliveries with exponential backoff. By default it keeps trying for up to 30 attempts or 1,440 minutes (24 hours), whichever comes first, and you can lower both per subscription. The [delivery and retry docs](https://learn.microsoft.com/azure/event-grid/delivery-and-retry) cover the schedule and which response codes skip retries.
- **No ordering guarantee.** `Order.Shipped` can arrive before `Order.Created`. If a consumer can't cope with that, it needs to check state, not trust arrival order.
- **Duplicates happen.** At-least-once means your handler will occasionally see the same event twice. Use the event `id` as an idempotency key.
- **Pay per operation.** The Basic tier charges per million operations, with the first 100,000 operations each month free. Every 64 KB chunk of an event counts as a separate operation, which is one more reason to keep events small.

If you need ordered processing, sessions, transactions or a consumer that pulls at its own pace, that is Service Bus territory. If you need to replay a high-volume stream, that's Event Hubs. Event Grid is for "something happened, and whoever cares should react to it".

## Design the event as a notification, not a document

The question I push teams to answer first is: does the event carry the state, or just announce the change?

| Approach | Payload | Good for | Watch out for |
|---|---|---|---|
| Thin notification | IDs plus a few routing fields | Many consumers with different needs; data that changes often | Consumers call back to the source API, which then has to handle the load |
| Fat event (state transfer) | Full entity snapshot | Consumers that must not depend on the source being up | Larger events cost more, leak internal models, and get harder to version |

My default is a thin-ish event: the identifiers, the fields consumers commonly filter on (status, region, amount band, tier), and nothing else. It keeps the contract small and makes advanced filtering useful without turning every event into a database row.

A few rules that save trouble later:

- **`eventType` is a verb in the past tense, namespaced.** `Contoso.Orders.OrderCreated` reads better in a year than `created`.
- **`subject` is a path you can filter on.** Event Grid's built-in subject filters are prefix and suffix matches, so design it deliberately: `/tenants/<tenant-id>/orders/<order-id>` lets one subscriber take a single tenant and another take everything.
- **`dataVersion` is there to be used.** When you make a breaking change to `data`, bump it and publish both versions side by side until consumers move over. Don't change the meaning of an existing field silently.
- **Never put secrets or personal data you wouldn't log into an event.** Payloads end up in dead-letter blobs, function logs and webhook request logs.

## Choose the schema when you create the topic

Event Grid accepts its own Event Grid schema, [CloudEvents v1.0](https://learn.microsoft.com/azure/event-grid/cloud-event-schema), or a custom schema mapped onto Event Grid fields with [input mappings](https://learn.microsoft.com/azure/event-grid/input-mappings) (`--input-schema customeventschema` plus `--input-mapping-fields` and `--input-mapping-default-values`). You choose the input schema when you create the topic, and you can't change it afterwards. A topic created with the default schema rejects CloudEvents, and the reverse is also true. Mappings are useful for an existing producer you can't change, but they're a poor default for a new contract: you end up maintaining a translation layer instead of an event design.

The decision is less final on the consumer side. Each subscription sets its own delivery schema, so a topic that takes the Event Grid schema can still deliver CloudEvents to one subscriber with `--event-delivery-schema cloudeventschemav1_0`. What you can't do is change what publishers send.

I lean towards CloudEvents for new topics that might cross a platform boundary, because it is a CNCF specification rather than an Azure format. The Event Grid schema is still a reasonable choice if everything consuming it is Azure Functions and Logic Apps, and it is what most samples and the Functions trigger use today. The bigger mistake is not deciding and ending up with a mix.

```bash
# Topic using the Event Grid schema (the default)
az eventgrid topic create \
    --name orders-events \
    --resource-group <your-resource-group> \
    --location australiaeast

# Topic using CloudEvents v1.0
az eventgrid topic create \
    --name orders-cloudevents \
    --resource-group <your-resource-group> \
    --location australiaeast \
    --input-schema cloudeventschemav1_0
```

## Draw topic boundaries around ownership

One custom topic per bounded context, owned by the team that owns the data, is the shape that holds up best. "Orders" publishes to the orders topic. "Billing" publishes to its own. Avoid one company-wide topic that everyone writes to: nobody owns the contract, and one bad publisher's malformed events become everyone's problem.

The quotas push you the same way. A custom topic supports up to 500 event subscriptions and a publish rate of 5,000 events or 1 MB per second, whichever comes first, and an Azure subscription can hold 100 custom topics in total ([quotas and limits](https://learn.microsoft.com/azure/event-grid/quotas-limits)). If you are building a multitenant SaaS and want one topic per customer, that's what [event domains](https://learn.microsoft.com/azure/event-grid/event-domains) are for. Don't script hundreds of custom topics.

## Publishing from .NET in January 2021

There are two SDKs, and the choice matters:

- **`Microsoft.Azure.EventGrid` 3.2.0** is the GA library. It uses `EventGridClient` and `TopicCredentials`, and it's what the Azure Functions Event Grid extension (2.1.0) binds to.
- **`Azure.Messaging.EventGrid`** is the new track-2 library, built on `Azure.Core` with `EventGridPublisherClient` and CloudEvents support. It is still in beta (4.0.0-beta.4 at the time of writing), and its API is still changing between betas.

For production code today I'd use the GA package and plan to move once the new library reaches GA. This is a complete console app targeting .NET Core 3.1:

```csharp
// dotnet add package Microsoft.Azure.EventGrid --version 3.2.0
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Azure.EventGrid;
using Microsoft.Azure.EventGrid.Models;

class Program
{
    static async Task Main()
    {
        // e.g. https://orders-events.australiaeast-1.eventgrid.azure.net/api/events
        var topicEndpoint = Environment.GetEnvironmentVariable("EVENTGRID_TOPIC_ENDPOINT");
        var topicKey = Environment.GetEnvironmentVariable("EVENTGRID_TOPIC_KEY");
        var topicHostname = new Uri(topicEndpoint).Host;

        var orderId = "<order-id>";
        var events = new List<EventGridEvent>
        {
            new EventGridEvent
            {
                Id = Guid.NewGuid().ToString(),
                EventType = "Contoso.Orders.OrderCreated",
                Subject = $"/tenants/<tenant-id>/orders/{orderId}",
                EventTime = DateTime.UtcNow,
                DataVersion = "1.0",
                Data = new
                {
                    orderId,
                    customerId = "<customer-id>",
                    totalAmount = 299.99m,
                    priority = "high"
                }
            }
        };

        using var client = new EventGridClient(new TopicCredentials(topicKey));
        await client.PublishEventsAsync(topicHostname, events);
        Console.WriteLine($"Published {events.Count} event(s) to {topicHostname}");
    }
}
```

Publishing is authenticated with the topic's access key (or a SAS token generated from it). Treat that key like a connection string: keep it in Key Vault or app settings, never in source, and rotate using the two keys (`key1` and `key2`) so publishers can switch without downtime.

## Let consumers filter, not the publisher

Each subscription filters on event type, subject prefix and suffix, and advanced filters on fields in the event, including fields inside `data`. Push filtering to the subscription so handlers only wake up for events they care about. That cuts cost and noise.

```bash
TOPIC_ID=$(az eventgrid topic show \
    --name orders-events \
    --resource-group <your-resource-group> \
    --query id --output tsv)

az eventgrid event-subscription create \
    --name high-value-orders \
    --source-resource-id "$TOPIC_ID" \
    --endpoint-type azurefunction \
    --endpoint "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.Web/sites/<function-app>/functions/OrderCreatedHandler" \
    --included-event-types Contoso.Orders.OrderCreated \
    --subject-begins-with /tenants/<tenant-id>/orders/ \
    --advanced-filter data.totalAmount NumberGreaterThan 100 \
    --advanced-filter data.priority StringIn high critical \
    --max-delivery-attempts 10 \
    --event-ttl 120 \
    --deadletter-endpoint "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.Storage/storageAccounts/<storage-account>/blobServices/default/containers/deadletter"
```

Advanced filters are capped per subscription (five filters, sharing a pool of 25 values across them), so they can't replace routing logic entirely. If a consumer needs something more complex, give it a broader subscription and filter in code.

The retry and dead-letter settings deserve more thought than they usually get. A shorter `--event-ttl` and fewer `--max-delivery-attempts` suit consumers where a stale event is worse than a missing one, such as a notification email. The dead-letter container is where undeliverable events land. If nobody monitors it, at-least-once quietly becomes at-most-once.

## Write the handler to expect duplicates

With the GA Functions extension, the trigger binds to the `Microsoft.Azure.EventGrid.Models.EventGridEvent` type, and `Data` arrives as a `JObject`. The handler below records `eventGridEvent.Id` in a Table Storage table before doing any work. Table inserts fail with HTTP 409 when the row already exists, so a duplicate delivery is skipped. If the work itself fails, the marker is deleted and the exception rethrown, so Event Grid's retry gets a clean attempt rather than being skipped as a "duplicate":

```csharp
// Azure Functions v3
// dotnet add package Microsoft.Azure.WebJobs.Extensions.EventGrid --version 2.1.0
// dotnet add package Microsoft.Azure.Cosmos.Table --version 1.0.8
// Create the table once: az storage table create --name processedevents --account-name <storage-account>
using System;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos.Table;
using Microsoft.Azure.EventGrid.Models;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.EventGrid;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

public class OrderCreated
{
    public string OrderId { get; set; }
    public string CustomerId { get; set; }
    public decimal TotalAmount { get; set; }
    public string Priority { get; set; }
}

public static class OrderCreatedHandler
{
    // App setting holding the storage connection string for the dedupe table
    private static readonly CloudTable ProcessedEvents = CloudStorageAccount
        .Parse(Environment.GetEnvironmentVariable("DEDUPE_STORAGE_CONNECTION"))
        .CreateCloudTableClient()
        .GetTableReference("processedevents");

    [FunctionName("OrderCreatedHandler")]
    public static async Task Run([EventGridTrigger] EventGridEvent eventGridEvent, ILogger log)
    {
        var marker = new TableEntity("OrderCreated", eventGridEvent.Id);
        try
        {
            await ProcessedEvents.ExecuteAsync(TableOperation.Insert(marker));
        }
        catch (StorageException ex) when (ex.RequestInformation.HttpStatusCode == 409)
        {
            log.LogInformation("Event {EventId} already processed, skipping", eventGridEvent.Id);
            return;
        }

        try
        {
            var order = ((JObject)eventGridEvent.Data).ToObject<OrderCreated>();
            log.LogInformation(
                "Event {EventId} ({DataVersion}): order {OrderId} for {Amount}",
                eventGridEvent.Id, eventGridEvent.DataVersion, order.OrderId, order.TotalAmount);

            // Side effects go here: send the email, update the read model, and so on.
        }
        catch
        {
            await ProcessedEvents.ExecuteAsync(TableOperation.Delete(new TableEntity(marker.PartitionKey, marker.RowKey) { ETag = "*" }));
            throw;
        }
    }
}
```

This narrows the duplicate window rather than closing it: a crash between the side effect and the end of the function can still leave work half done. If the side effect is a database write, putting the event ID in the same transaction as the write is the stronger option.

The `azurefunction` endpoint type handles Event Grid's subscription validation for you. A plain webhook endpoint has to answer the validation handshake itself, which is the most common reason a new webhook subscription fails to create ([endpoint validation](https://learn.microsoft.com/azure/event-grid/end-point-validation-event-grid-events-schema)). Throwing from the function returns a failure, and Event Grid retries according to the subscription's policy, so only throw for errors where a retry could succeed.

## When I wouldn't use a custom topic

- **Commands, not events.** "Charge this card" has exactly one intended recipient and needs a reliable outcome. Use a Service Bus queue.
- **Strict ordering or workflow state.** Event Grid won't keep order, and it has no sessions.
- **Telemetry streams.** Millions of small readings a minute belong in Event Hubs, where consumers can replay.
- **Two services, one consumer, forever.** A direct call or a queue is simpler. Pub/sub pays off when the consumer list is open-ended.

## The takeaway

The topic takes minutes to create. The contract lasts for years. Decide the schema before you create the topic, give each bounded context its own topic, keep events thin with a subject you can filter on, and version through `dataVersion`. Build handlers that are idempotent and tolerate events arriving out of order, and actually watch the dead-letter container. For .NET, use `Microsoft.Azure.EventGrid` in production until `Azure.Messaging.EventGrid` reaches GA. Then migrate one publisher at a time, because the event on the wire doesn't change.
