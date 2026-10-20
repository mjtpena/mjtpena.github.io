---
title: "Cosmos DB Change Feed: Functions Trigger or Change Feed Processor?"
description: "How to choose between the Azure Functions trigger and the .NET SDK v3 change feed processor, and the leases, retries and delete gaps that decide it."
author: Michael John Peña
draft: false
date: 2020-08-29
tags:
  - Azure
  - Cosmos DB
  - Change Feed
  - Azure Functions
  - Event-Driven
---

The Cosmos DB change feed is the cleanest way to react to writes without dual-writing from your application. Picking it is the easy part. The decision that actually matters is *which consumer* reads it, and in August 2020 that means the Azure Functions Cosmos DB trigger or the change feed processor in the .NET SDK v3. The consumer decides what happens when your code throws, how you scale out, and whether you notice when you fall behind.

## What the change feed gives you, and what it doesn't

The [change feed](https://learn.microsoft.com/azure/cosmos-db/change-feed) is a persistent, ordered record of inserts and updates on a container. It's on by default for every SQL API container, and you pay only for the request units used to read it. Three properties shape every design built on it:

- **Ordering is per partition key, not global.** Changes to items with the same logical partition key arrive in the order they were made. Across partition keys there is no ordering guarantee, so anything that needs a global sequence has to build one.
- **You get the latest version, not every version.** If an item is updated three times between two reads of the feed, you may only see the final state. The change feed is a "this item changed" signal, not an audit log.
- **Deletes don't appear.** A hard delete simply vanishes. If a downstream system needs to know about deletions, write a soft-delete flag first, let that update flow through the feed, and then remove the item later with a per-item `ttl`. Per-item TTL only takes effect when the container has a default TTL set (`-1` turns it on without expiring anything by default).

That second point catches people building event sourcing on top of the feed. If every intermediate state matters, model each state change as its own item (an append-only event container) rather than overwriting one document. Then the feed's "latest version" behaviour costs you nothing, because each event is written once and never updated.

## The two consumers

Both consumers are built on the same idea: a separate **lease container** stores one lease document per partition range of the monitored container, recording a continuation point (the checkpoint) and which instance currently owns the range. Instances divide the leases between themselves, which is how they scale out and recover from crashes. If the lease container is partitioned, and new ones should be, the partition key must be `/id`.

| | Functions Cosmos DB trigger | Change feed processor (.NET SDK v3) |
|---|---|---|
| Package (Aug 2020) | `Microsoft.Azure.WebJobs.Extensions.CosmosDB` 3.0.7, built on the v2 SDK | `Microsoft.Azure.Cosmos` 3.12.0 |
| Hosting | Consumption, Premium or Dedicated plan | Anything that runs .NET: App Service WebJob, AKS, a VM, a Windows service |
| Scaling | Platform-managed | You add instances; leases rebalance automatically |
| Exception in your code | Batch is **not** retried; the checkpoint still moves on | Lease isn't checkpointed; the batch is retried |
| Start position on a new lease container | "Now", unless `StartFromBeginning = true` | "Now", unless you call `WithStartTime(DateTime.MinValue.ToUniversalTime())` (from the beginning) or `WithStartTime(<utc time>)` |
| Lag monitoring | Not built in; run an estimator against its leases | Built-in estimator |
| Effort | Lowest | You own hosting and lifecycle |

The row that should drive most decisions is the exception row. The start-position row is the one that surprises people on first deployment. Both consumers begin from the current point in the feed when no leases exist, so existing items are not processed unless you ask for it. If the point of the deployment is to backfill a search index or build a materialised view from existing data, set the start position before the first run, because it's ignored once leases have been written. Note that the v3 builder in 3.12.0 has no public start-from-beginning method; passing `DateTime.MinValue` to `WithStartTime` is how you ask for the whole feed.

### Functions trigger: simple, but failures are yours to catch

The Functions trigger is the fastest way to get running, and for fan-out work (publish to Event Hubs, update a search index, send a notification) it's what I'd reach for first. The catch is how it handles failure. In the current 3.x extension, if your function throws an unhandled exception, that batch is not retried. The [troubleshooting guidance](https://learn.microsoft.com/azure/cosmos-db/nosql/troubleshoot-changefeed-functions) puts it plainly: when changes are missing at the destination, the usual cause is that your function failed to process them.

So a production trigger function needs per-item error handling and somewhere to put failures. Here's the shape I'd use: each change is sent with `EventHubProducerClient` from `Azure.Messaging.EventHubs` 5.x (GA since January 2020) inside the `try`, so a failed send is caught against the right document, and failed items go to a Storage queue so they can be replayed. It targets Functions runtime v3 and references `Microsoft.Azure.WebJobs.Extensions.CosmosDB` 3.0.7, `Azure.Messaging.EventHubs` 5.x and `Microsoft.Azure.WebJobs.Extensions.Storage` 3.x:

```csharp
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Azure.Messaging.EventHubs;
using Azure.Messaging.EventHubs.Producer;
using Microsoft.Azure.Documents;
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;

public static class PublishOrderChanges
{
    // One client per host instance; it's thread-safe and expensive to create.
    private static readonly EventHubProducerClient Producer = new EventHubProducerClient(
        Environment.GetEnvironmentVariable("EventHubConnection"), "order-events");

    [FunctionName("PublishOrderChanges")]
    public static async Task Run(
        [CosmosDBTrigger(
            databaseName: "orders",
            collectionName: "order-items",
            ConnectionStringSetting = "CosmosConnection",
            LeaseCollectionName = "leases",
            LeaseCollectionPrefix = "publish-",
            CreateLeaseCollectionIfNotExists = true,
            MaxItemsPerInvocation = 100)] IReadOnlyList<Document> changes,
        [Queue("order-changes-failed", Connection = "AzureWebJobsStorage")] IAsyncCollector<string> failed,
        ILogger log)
    {
        foreach (Document doc in changes)
        {
            try
            {
                var data = new EventData(Encoding.UTF8.GetBytes(doc.ToString()));
                var options = new SendEventOptions { PartitionKey = doc.GetPropertyValue<string>("orderId") };
                await Producer.SendAsync(new[] { data }, options);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Failed to publish change for {Id}", doc.Id);
                await failed.AddAsync(doc.ToString());
            }
        }
    }
}
```

Two details in that attribute are easy to miss. `LeaseCollectionPrefix` lets several functions share one lease container while each keeps its own checkpoints; without it, a second function pointed at the same monitored container and lease container would compete for the same leases instead of each seeing every change. And `collectionName` and `LeaseCollectionName` are the 3.x extension's names, because it still uses the v2 SDK's "collection" terminology.

I deliberately didn't use the Event Hubs output binding here. Its `IAsyncCollector` batches sends and flushes when the function returns, so a send failure usually surfaces after the loop rather than inside the `try`, fails the whole invocation, and under the 3.x trigger that batch is gone. Sending one event per call costs throughput; if volume demands batching, build an `EventDataBatch` and dead-letter the whole batch on failure. Using the order ID as the partition key keeps per-order ordering intact in Event Hubs. If the dead-letter write itself throws, the invocation still fails, so keep that path simple.

The trigger has no lag metric of its own, but its leases are ordinary lease documents, so you can monitor it from outside. Run a change feed estimator (the v2 change feed processor library's, or the SDK v3 one, which understands v2-format leases and since 3.12.0 also preserves the v2 `PartitionId` field when it writes them, so the trigger isn't affected) against the trigger's lease container, using the trigger's `LeaseCollectionPrefix` as the lease prefix.

### Change feed processor: more work, better guarantees

The [change feed processor](https://learn.microsoft.com/azure/cosmos-db/nosql/change-feed-processor) in the .NET SDK v3 behaves the other way round. If your delegate throws, the lease isn't checkpointed and the same batch comes back. That's true at-least-once delivery, with the obvious consequence that a poison item will be retried forever and stall its partition range. You still want a dead-letter path, but you choose when to give up instead of the platform choosing for you. SDK 3.12.0 has no error-notification hook, so the give-up logic lives inside `HandleChangesAsync`: catch per item, count attempts in your own state (a tracking document, say), and after N failures write the item to a dead-letter container or queue. Then return normally so the lease checkpoints; rethrowing is how you ask for a retry, and swallowing is how you move on.

Here is a complete console host for the processor plus the estimator. It needs a .NET Core 3.1 console project (the `using` declaration is C# 8) that references `Microsoft.Azure.Cosmos` 3.12.0; the `[JsonProperty]` attributes map the camelCase JSON to PascalCase properties through Newtonsoft.Json, the v3 SDK's default serialiser:

```csharp
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using Newtonsoft.Json;

public class OrderItem
{
    [JsonProperty("id")]
    public string Id { get; set; }

    [JsonProperty("orderId")]
    public string OrderId { get; set; }

    [JsonProperty("amount")]
    public decimal Amount { get; set; }
}

public static class Program
{
    public static async Task Main()
    {
        using CosmosClient client = new CosmosClient(
            Environment.GetEnvironmentVariable("COSMOS_CONNECTION_STRING"));

        Container monitored = client.GetContainer("orders", "order-items");
        Container leases = client.GetContainer("orders", "leases");

        ChangeFeedProcessor processor = monitored
            .GetChangeFeedProcessorBuilder<OrderItem>("order-summaries", HandleChangesAsync)
            .WithInstanceName(Environment.MachineName)
            .WithLeaseContainer(leases)
            .WithMaxItems(100)
            .Build();

        ChangeFeedProcessor estimator = monitored
            .GetChangeFeedEstimatorBuilder("order-summaries", HandleEstimationAsync, TimeSpan.FromSeconds(30))
            .WithLeaseContainer(leases)
            .Build();

        await processor.StartAsync();
        await estimator.StartAsync();

        Console.WriteLine("Processing. Press Enter to stop.");
        Console.ReadLine();

        await estimator.StopAsync();
        await processor.StopAsync();
    }

    private static Task HandleChangesAsync(
        IReadOnlyCollection<OrderItem> changes, CancellationToken cancellationToken)
    {
        foreach (OrderItem item in changes)
        {
            Console.WriteLine($"Order {item.OrderId}: item {item.Id} changed ({item.Amount})");
        }
        return Task.CompletedTask;
    }

    private static Task HandleEstimationAsync(
        long estimatedPendingChanges, CancellationToken cancellationToken)
    {
        Console.WriteLine($"Estimated pending changes: {estimatedPendingChanges}");
        return Task.CompletedTask;
    }
}
```

The estimator is the underrated part. It reads the same leases and reports how far behind the processor is. Send that number to Application Insights and alert on it, and you'll know about a stuck partition before your users do. The processor name passed to both builders must match, or the estimator measures nothing.

Scaling works by running more instances with different instance names against the same lease container. The ceiling is the number of leases, which tracks the number of physical partitions; a container with four physical partitions gives you at most four busy instances, and a fifth sits idle. If you're moving from the v2 `DocumentClient` world, I covered the SDK v3 client patterns in [moving to the Cosmos DB .NET SDK v3](/blog/2020-08-02-cosmos-db-sdk-v3/).

There is a third option on the horizon: a pull model, where you read the feed with an iterator and manage continuation tokens yourself. As of August 2020 it's only in the preview releases of the .NET SDK, and the API has already had breaking changes (3.13.0-preview reshaped how start positions are specified), so I wouldn't build on it yet.

## Design rules that apply to both

**Make the handler idempotent.** Even the Functions trigger can redeliver after a host restart or lease rebalance between processing and checkpointing. Upserts keyed on the source item's `id`, or a stored version or `_etag` compared before writing, make duplicates harmless.

**Budget RUs for the lease container.** Every checkpoint and lease renewal is a write. On a busy feed with many partitions, a lease container with too little throughput throttles, and throttled checkpoints show up as lag and duplicates. Give it its own throughput rather than squeezing it into a shared database allowance.

**Don't use the feed for things Cosmos DB already does.** I see teams wiring up the change feed to "replicate" data to a second region. If the target is just another region, add the region to the account and let global distribution handle replication and failover (and, with multi-region writes, conflict resolution). The change feed earns its place when the target is *different*: a container with another partition key, a materialised view, a search index, or a different store entirely.

**Don't use it as your analytics pipeline if you can avoid it.** Streaming every change into a warehouse with custom code is a lot of moving parts. Azure Synapse Link for Azure Cosmos DB, [announced in public preview in May 2020](https://learn.microsoft.com/azure/cosmos-db/synapse-link), is aimed squarely at that case. It's preview, so weigh it accordingly, but it's worth testing before you build a bespoke pipeline.

## Choosing

My default is the Functions trigger for stateless fan-out where losing an occasional item to a bug is recoverable from a dead-letter queue, and the change feed processor for anything where a missed change is a correctness problem: materialised views, balances, inventory, or anything feeding another system of record. If you choose the trigger, treat the try/catch and the failure queue as mandatory. If you choose the processor, wire up the estimator on day one.

Either way, decide up front how deletes and intermediate versions will be represented, because the feed won't do it for you. The [change feed design patterns](https://learn.microsoft.com/azure/cosmos-db/nosql/change-feed-design-patterns) page is a good checklist for that conversation.
