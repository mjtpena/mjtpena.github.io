---
title: "Cosmos DB Change Feed in Production: Failures, Leases and Lag"
description: "Running Cosmos DB change feed consumers in production: Functions trigger vs processor, poison batches, dead-lettering, idempotency and lag estimation."
author: Michael John Pena
draft: false
date: 2021-01-26
url: /blog/cosmosdb-change-feed-patterns/
tags:
  - Azure
  - Cosmos DB
  - Change Feed
  - Event-Driven
  - .NET
---

Wiring up a Cosmos DB change feed consumer takes about ten minutes. Keeping it correct for a year is the hard part. The demo never shows the failure modes: a batch that throws on every attempt, a consumer that silently skips changes, a projection that drifts because a handler wasn't idempotent, and lag nobody notices until a customer does. If you want the basic patterns first (materialised views, replication, publishing to Event Hubs), start with my earlier [change feed patterns post](/blog/2020-08-29-cosmos-db-change-feed-patterns/).

## What the change feed actually promises

Most production bugs I see come from assuming the change feed guarantees more than it does. As of January 2021, on the Core (SQL) API, the [change feed](https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed) gives you:

- **Inserts and updates, not deletes.** A hard delete never appears. If downstream systems need to know about deletions, write a soft-delete flag (`isDeleted: true`) as an update, then let TTL remove the item later.
- **The latest version of each item, not every version.** If an item is updated three times between two reads, you may only see the final state. Don't build an audit log on the assumption that every intermediate write shows up.
- **Ordering per partition key value only.** Changes to one logical partition arrive in modification order. There is no global order across partition keys.
- **At-least-once delivery.** A batch can be delivered again after a crash, a lease handover or a retry. Every handler must tolerate duplicates.

That last point drives most of the design below. If a handler can't safely process the same change twice, it isn't production-ready, however well it does everything else.

## Functions trigger or the change feed processor?

There are two mainstream ways to consume the feed in .NET today. Both use leases stored in a separate container to track progress per partition range, and both spread those leases across instances.

| | Azure Functions Cosmos DB trigger | Change feed processor (.NET SDK v3) |
|---|---|---|
| Hosting | Functions (Consumption, Premium or Dedicated) | Anything that runs .NET: App Service, AKS, a VM, a worker service |
| SDK underneath | v2 SDK (extension 3.0.x) | `Microsoft.Azure.Cosmos` 3.16.0 |
| Behaviour on an unhandled exception | Batch is **not** retried by default; the lease moves on | Batch is retried from the last checkpoint, indefinitely |
| Scaling | Platform-managed | You decide the instance count |
| Best fit | Lightweight reactions, fan-out to queues | Long-running projections, sustained high throughput, tight control |

Note that row about exceptions. The two options fail in **opposite directions**. The Functions trigger [doesn't retry a batch by default](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/troubleshoot-changefeed-functions) when your code throws, so an unhandled exception means silently lost changes. The processor library retries the failed batch from the last checkpoint, which means one poison document can stall that partition range forever. Neither default is safe on its own. You have to choose what happens to a failing change, explicitly, in your own code.

My rule of thumb: start with Functions if your handler mostly forwards changes somewhere else (Service Bus, Event Hubs, a search index). Move to the processor when you need predictable throughput, long-running work per batch, or hosting outside Functions. Functions retry policies, which arrived in preview in November 2020, can soften the Functions default. I'd still catch and route failures myself rather than rely on a preview feature for data integrity.

## Pattern 1: catch, dead-letter, keep moving

The goal is that no single bad document can either disappear or block everything behind it. Catch failures **per item**, write the failing item and the error to a dead-letter container, and let the rest of the batch complete.

Here is the Functions version, written against the 3.0.x Cosmos DB extension that is current at the time of writing. That version still uses `collectionName` and `ConnectionStringSetting`, and binds to the v2 SDK's `Document` type.

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Azure.Documents;
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;

public static class OrderChangeHandler
{
    [FunctionName("OrderChangeHandler")]
    public static async Task Run(
        [CosmosDBTrigger(
            databaseName: "ecommerce",
            collectionName: "orders",
            ConnectionStringSetting = "CosmosDBConnection",
            LeaseCollectionName = "leases",
            LeaseCollectionPrefix = "order-handler-",
            CreateLeaseCollectionIfNotExists = true)]
        IReadOnlyList<Document> changes,
        [CosmosDB(
            databaseName: "ecommerce",
            collectionName: "orders-deadletter",
            ConnectionStringSetting = "CosmosDBConnection")]
        IAsyncCollector<object> deadLetters,
        ILogger log)
    {
        foreach (var doc in changes)
        {
            try
            {
                await ProcessOrderAsync(doc);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Failed to process order {OrderId}", doc.Id);

                // Deterministic id: a redelivered batch overwrites the same
                // dead-letter record (the output binding upserts) instead of adding another.
                var etag = doc.ETag.Trim('"');
                try
                {
                    await deadLetters.AddAsync(new
                    {
                        id = $"{doc.Id}-{etag}",
                        sourceId = doc.Id,
                        sourceEtag = etag,
                        error = ex.Message,
                        failedAtUtc = DateTime.UtcNow,
                        payload = doc
                    });
                }
                catch (Exception dlEx)
                {
                    // The trigger won't retry, so this log line is the last copy of the change.
                    log.LogCritical(dlEx, "Dead-letter write failed for order {OrderId}: {Payload}",
                        doc.Id, doc.ToString());
                }
            }
        }
    }

    private static Task ProcessOrderAsync(Document doc)
    {
        // Fragment: forward the change to your downstream system here.
        return Task.CompletedTask;
    }
}
```

Two details worth calling out. First, `LeaseCollectionPrefix` lets several functions share one lease container without competing for the same leases. Without it, two functions pointed at the same source and lease container split the changes between them instead of both seeing all of them. Second, the dead-letter record carries the source `_etag`, so when you replay it you can tell whether the item has changed since it failed.

The dead-letter write has to follow the same at-least-once rule as everything else. A random `Guid` as the id means every redelivery of the batch creates another record for the same failure. Building the id from the source id and `_etag` means a redelivery overwrites the record it already wrote, while a later version of the same document that also fails gets its own entry.

And the dead-letter write can fail too. Don't swallow that. In the Functions version an exception from `AddAsync` would escape the function, and because the trigger doesn't retry, every change after it in the batch would be lost along with the failed one. That's why it sits in its own `try`/`catch` that logs the full payload at `Critical` level, which should page someone. Once you've enabled and tested Functions retry policies, rethrowing is the better choice.

The dead-letter container needs an owner and a replay process. I've seen dead-letter stores used as a place where problems go to be forgotten. Put an alert on its item count, and treat anything in it as an open incident.

## Pattern 2: the processor as a hosted service

With the change feed processor, the same principle applies, but you're defending against the opposite failure. If the delegate throws, the [processor retries that batch from the last checkpoint](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/change-feed-processor), which is what you want for a transient network error and what you don't want for a malformed document. The documentation recommends the same answer: catch inside the delegate and write failures to an errored-message store.

This uses the `ChangesHandler<T>` delegate signature from `Microsoft.Azure.Cosmos` 3.16.0, which receives the changes and a cancellation token.

```csharp
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

public class Order
{
    public string id { get; set; }

    [JsonProperty("_etag")]
    public string etag { get; set; }

    public string customerId { get; set; }
    public string status { get; set; }
    public decimal totalAmount { get; set; }
}

public class OrderProjectionService : IHostedService
{
    private readonly CosmosClient _client;
    private readonly ILogger<OrderProjectionService> _logger;
    private readonly Container _summaries;
    private readonly Container _deadLetters;
    private ChangeFeedProcessor _processor;

    public OrderProjectionService(CosmosClient client, ILogger<OrderProjectionService> logger)
    {
        _client = client;
        _logger = logger;
        var db = client.GetDatabase("ecommerce");
        _summaries = db.GetContainer("customer-order-summaries");
        _deadLetters = db.GetContainer("orders-deadletter");
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var db = _client.GetDatabase("ecommerce");

        _processor = db.GetContainer("orders")
            .GetChangeFeedProcessorBuilder<Order>("order-projection", HandleChangesAsync)
            .WithInstanceName(Environment.MachineName)
            .WithLeaseContainer(db.GetContainer("leases"))
            .WithMaxItems(100)
            .Build();

        await _processor.StartAsync();
    }

    public Task StopAsync(CancellationToken cancellationToken) => _processor.StopAsync();

    private async Task HandleChangesAsync(
        IReadOnlyCollection<Order> changes,
        CancellationToken cancellationToken)
    {
        foreach (var order in changes)
        {
            try
            {
                // Idempotent: the projection's id is the order id, so a redelivered
                // change overwrites the same document instead of creating a duplicate.
                await _summaries.UpsertItemAsync(
                    new { id = order.id, customerId = order.customerId, order.status, order.totalAmount },
                    new PartitionKey(order.customerId),
                    cancellationToken: cancellationToken);
            }
            catch (CosmosException ex) when ((int)ex.StatusCode == 429 || (int)ex.StatusCode >= 500)
            {
                // Transient: rethrow so the processor retries the batch from the checkpoint.
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Dead-lettering order {OrderId}", order.id);

                // Deterministic id plus upsert: if a later item rethrows a transient error,
                // the whole batch is redelivered and this write must not create a second record.
                // No catch here: if the dead-letter write fails, the batch is retried.
                await _deadLetters.UpsertItemAsync(
                    new
                    {
                        id = $"{order.id}-{order.etag.Trim('"')}",
                        sourceId = order.id,
                        error = ex.Message,
                        failedAtUtc = DateTime.UtcNow,
                        payload = order
                    },
                    cancellationToken: cancellationToken);
            }
        }
    }
}
```

The split between transient and permanent failures is the design decision here. A validation error or a null reference will fail the same way forever, so it goes to the dead-letter container. Server errors deserve a retry, and rethrowing gets you one from the checkpoint.

Be honest with yourself about what a 429 in that handler means, though. The v3 SDK already retries throttled requests internally, by default up to 9 times within 30 seconds of cumulative wait (`MaxRetryAttemptsOnRateLimitedRequests` and `MaxRetryWaitTimeOnRateLimitedRequests` on [`CosmosClientOptions`](https://learn.microsoft.com/en-us/dotnet/api/microsoft.azure.cosmos.cosmosclientoptions)). A 429 that reaches your code means sustained throttling, and rethrowing re-runs the whole batch against a container that is still throttled. The rethrow is a backstop so nothing is lost. The fix is more RU/s on the target container or a smaller batch through `WithMaxItems`.

Because a rethrow redelivers the whole batch, items earlier in it run again, including any that were already dead-lettered. That's why the dead-letter write is an upsert with a deterministic id, and why, unlike the Functions version, a failed dead-letter write is allowed to throw: the processor retries the batch rather than losing it. Note that the dead-letter container is assumed to be partitioned on `/id`; adjust if yours isn't.

A few settings to know about:

- **`WithInstanceName`** must be unique per running instance. Machine name works on VMs and App Service; in containers, use the pod name.
- **Scale-out stops at the lease count.** Leases map to partition ranges, so running more instances than leases leaves the extras idle. Ten instances on a container with four physical partitions buys you nothing.
- **`WithStartTime` only applies the first time.** Once leases exist, the processor resumes from them. To reprocess from a point in time, use a new processor name (or a fresh lease container), not a new start time.
- **The lease container uses `/id` as its partition key.** Give it its own throughput budget in your capacity planning; lease renewals and checkpoints consume RUs continuously.

## Pattern 3: watch lag, not just errors

A consumer that's healthy but slow looks fine on an error dashboard. The signal you need is how far behind the feed it is. The SDK's [change feed estimator](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-use-change-feed-estimator) reads the same lease container and reports an estimate of pending changes.

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

public class OrderProjectionLagMonitor : IHostedService
{
    private readonly CosmosClient _client;
    private readonly ILogger<OrderProjectionLagMonitor> _logger;
    private ChangeFeedProcessor _estimator;

    public OrderProjectionLagMonitor(CosmosClient client, ILogger<OrderProjectionLagMonitor> logger)
    {
        _client = client;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var db = _client.GetDatabase("ecommerce");

        // The processor name must match the processor you are monitoring.
        _estimator = db.GetContainer("orders")
            .GetChangeFeedEstimatorBuilder(
                "order-projection",
                ReportLagAsync,
                TimeSpan.FromMinutes(1))
            .WithLeaseContainer(db.GetContainer("leases"))
            .Build();

        await _estimator.StartAsync();
    }

    public Task StopAsync(CancellationToken cancellationToken) => _estimator.StopAsync();

    private Task ReportLagAsync(long estimatedPendingChanges, CancellationToken cancellationToken)
    {
        _logger.LogInformation("order-projection pending changes: {Pending}", estimatedPendingChanges);
        return Task.CompletedTask;
    }
}
```

Ship that number to whatever monitoring you already use and alert on the **trend**, not a single threshold. A backlog of 50,000 that is draining is fine after a bulk import. A backlog of 500 that has grown every minute for an hour is a stuck partition. The estimate is a total across all leases in the GA 3.16.0 package; a per-lease breakdown exists only in preview packages as I write this, so when the total grows, check your logs for the partition range that keeps retrying.

The Functions trigger has no built-in lag metric, which matters because I've told you to start there. The v3 estimator can, in principle, read the Functions trigger's leases: the 3.16.0 source builds lease ids from the processor name, account host and container resource ids in the same format the v2 library uses, and it handles leases created by v2. Point it at the Functions lease container with the processor name set to the `LeaseCollectionPrefix` (`order-handler-` above). That pairing isn't documented for Functions, so check that it returns sensible numbers in a test environment before you alert on it. A cruder metric that needs no extra moving parts: log the `_ts` of the last document in each batch against UTC now. If that gap keeps growing, the function is falling behind.

## When not to use the change feed

The change feed is the right tool for reacting to state changes in a container you own. It is the wrong tool when:

- **You need deletes or every intermediate version.** Use soft deletes, or write explicit, immutable domain events to their own container and treat that container as the source of truth.
- **You need a global order across entities.** Per-partition ordering is all you get. If the business process depends on cross-partition order, model it with a queue that provides it.
- **Consumers are outside your team's control.** Handing external teams read access to your container and lease configuration couples them to your schema. Publish an integration event to Service Bus or Event Hubs from your own consumer and let them subscribe to that contract.
- **The work is analytical.** For aggregate queries over operational data, [Azure Synapse Link for Cosmos DB](/blog/2020-09-28-azure-synapse-link-cosmos/) (still in preview as I write this) is a better long-term direction than a hand-built ETL consumer.

## The decision in short

Pick the Functions trigger for lightweight forwarding and the change feed processor for projections you need to control. Then, whichever you pick, make three things explicit before it goes live: what happens to a change that fails permanently (dead-letter it, never drop it, never retry it forever), why each handler is safe to run twice, and which metric tells you the consumer is falling behind. If you can't answer all three, it isn't ready for production.
