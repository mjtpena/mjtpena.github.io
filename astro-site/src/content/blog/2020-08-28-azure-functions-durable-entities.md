---
title: "Durable Entities as Inventory Counters: Signals, Calls and Limits"
description: "Using Durable Functions 2.x entities to hold per-SKU stock counts: when to signal and when to call, how reads work, and where an entity is the wrong tool."
author: Michael John Peña
draft: false
date: 2020-08-28
tags:
  - Azure
  - Azure Functions
  - Durable Functions
  - Durable Entities
  - Serverless
---

We needed to track real-time inventory across multiple warehouses, and every obvious option had a catch. A database with row locking was too slow under contention, a Redis cache added another piece of infrastructure to run, and event sourcing was more machinery than the problem deserved. Durable Entities gave us a middle ground. They're also easy to get subtly wrong, because the API makes a one-way message look a lot like a method call.

## What an entity actually gives you

Durable Entities arrived with the [Durable Functions v2.0.0 GA release](https://github.com/Azure/azure-functions-durable-extension/releases/tag/v2.0.0) in November 2019 (the [entities overview](https://learn.microsoft.com/azure/durable-task/common/durable-task-entities) is the reference), and they're the actor-style part of the extension. An entity is a small piece of state with an identity (`EntityId` = entity name + key). The runtime saves that state in your task hub storage and runs operations against it **one at a time**. Two warehouses decrementing the same SKU can't interleave. The second operation waits until the first one has finished. State is persisted after each batch of operations, so the two can never interleave.

That single-threaded guarantee is what you're really buying. You don't write locks, retries for optimistic concurrency, or compare-and-swap loops. Each entity is its own serialisation point, and different entities run in parallel across the task hub's partitions.

As of August 2020, entities are supported in C# (the `Microsoft.Azure.WebJobs.Extensions.DurableTask` 2.x package) and JavaScript (the `durable-functions` npm package). Python support has been in public preview since mid-2020, but it doesn't support entities yet, so this is C# or JavaScript only for now. The examples below are C# on Functions v3.

## Model one entity per thing that must be consistent

The first design decision is the key. One entity per warehouse looks tidy, but every SKU in that warehouse then shares one queue, and a busy warehouse turns into a bottleneck. My rule of thumb is to key by the unit of consistency, so here that's `{warehouse}|{sku}`, because the consistency rule is "don't oversell this SKU at this site". Nothing needs to be atomic across SKUs.

If you do need a rule that spans entities (moving stock between warehouses, say), that's a job for an orchestration that locks both entities. More on that below.

## The entity

This is the function-based syntax. The class-based syntax is nicer for large entities, but for three operations a switch is easier to read. It opens the `InventoryFunctions` class that every later snippet belongs to.

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.DurableTask;
using Microsoft.Azure.WebJobs.Extensions.Http;

namespace Inventory
{
    public class InventoryState
    {
        public int Quantity { get; set; }
    }

    public class ReserveRequest
    {
        public string Warehouse { get; set; }
        public string Sku { get; set; }
        public int Quantity { get; set; }
    }

    public static class InventoryFunctions
    {
        [FunctionName("InventoryEntity")]
        public static void InventoryEntity([EntityTrigger] IDurableEntityContext ctx)
        {
            switch (ctx.OperationName.ToLowerInvariant())
            {
                case "add":
                    var state = ctx.GetState(() => new InventoryState());
                    var addQty = ctx.GetInput<int>();
                    if (addQty > 0)
                    {
                        state.Quantity += addQty;
                    }
                    break;

                case "tryreserve":
                    var requested = ctx.GetInput<int>();
                    var current = ctx.HasState ? ctx.GetState<InventoryState>() : null;
                    var reserved = current != null && requested > 0 && current.Quantity >= requested;
                    if (reserved)
                    {
                        current.Quantity -= requested;
                    }
                    ctx.Return(reserved);
                    break;

                case "get":
                    ctx.Return(ctx.HasState ? ctx.GetState<InventoryState>().Quantity : 0);
                    break;

                default:
                    throw new InvalidOperationException($"Unknown operation {ctx.OperationName}");
            }
        }

        // Helper: '|' can't appear in the warehouse or SKU IDs, so keys stay unambiguous.
        private static EntityId StockId(string warehouse, string sku) =>
            new EntityId("InventoryEntity", $"{warehouse}|{sku}");
```

Only `add` touches `GetState` with a factory, so it's the only operation that can bring a SKU into existence. It also drops a zero or negative quantity defensively, but the HTTP endpoint below rejects that input before it gets this far, so bad input fails visibly at the edge. `get` and `tryreserve` check `HasState` first, so asking about a SKU nobody has stocked returns zero or `false` without creating state for it. Unknown operation names throw, so a typo in a caller shows up as a failure in the logs, not a silent no-op. `get` is there for orchestrations that need the live, in-memory value through `CallEntityAsync<int>(id, "get")`, which queues behind pending operations, unlike the storage read covered later.

The block above deliberately leaves the class and namespace open, and the final snippet closes them.

The tempting version of this entity has a `remove` operation that throws `InvalidOperationException` when stock runs short. Don't build it that way. Why comes down to how the caller talks to the entity.

## Signal or call: the decision that matters most

There are two ways to send an entity an operation, and they behave very differently.

| | Signal (`SignalEntityAsync` from clients, `SignalEntity` from orchestrations and entities) | Call (`CallEntityAsync`) |
|---|---|---|
| Who can do it | Clients, orchestrations, other entities | Orchestrations only |
| Waits for the result | No, fire-and-forget | Yes, and gets the return value |
| Sees exceptions | No | Yes, rethrown in the orchestration |
| Typical latency | Time to enqueue a message | Queue round trip plus orchestration replay |

A signal from an HTTP trigger returns as soon as the message is in the queue. If that operation throws "insufficient inventory", nobody finds out. The HTTP caller already has its 202 and the entity just logs a failure. So signals suit operations that **can't fail for business reasons**: receiving stock and adjustments. Anything that can be refused (reserving stock for an order) needs a call, so the caller learns the answer.

Calls come with a constraint: a client function can't call an entity directly, only an orchestration can. So the reserve path goes through a short orchestrator. `tryreserve` returns `false` instead of throwing. A refusal is a normal business outcome, not an exception, and a boolean is easier to handle than an exception crossing the entity–orchestration boundary.

Add these to the same `InventoryFunctions` class:

```csharp
        [FunctionName("ReserveStock")]
        public static async Task<bool> ReserveStock(
            [OrchestrationTrigger] IDurableOrchestrationContext context)
        {
            var request = context.GetInput<ReserveRequest>();
            return await context.CallEntityAsync<bool>(
                StockId(request.Warehouse, request.Sku), "tryreserve", request.Quantity);
        }

        [FunctionName("ReserveStockHttp")]
        public static async Task<IActionResult> ReserveStockHttp(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "reserve")] HttpRequest req,
            [DurableClient] IDurableOrchestrationClient client)
        {
            var body = await new System.IO.StreamReader(req.Body).ReadToEndAsync();
            var request = Newtonsoft.Json.JsonConvert.DeserializeObject<ReserveRequest>(body);
            if (request?.Warehouse == null || request.Sku == null || request.Quantity <= 0)
            {
                return new BadRequestResult();
            }

            var instanceId = await client.StartNewAsync("ReserveStock", request);

            // Wait briefly for the answer; fall back to the async status endpoint if it is slow.
            return await client.WaitForCompletionOrCreateCheckStatusResponseAsync(
                req, instanceId, TimeSpan.FromSeconds(5));
        }

        [FunctionName("AddStockHttp")]
        public static async Task<IActionResult> AddStockHttp(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "stock/{warehouse}/{sku}/{quantity:int}")] HttpRequest req,
            string warehouse, string sku, int quantity,
            [DurableClient] IDurableEntityClient client)
        {
            if (quantity <= 0)
            {
                return new BadRequestResult();
            }

            await client.SignalEntityAsync(StockId(warehouse, sku), "add", quantity);
            return new AcceptedResult();
        }
```

If `ReserveStock` finishes within five seconds, the reserve endpoint returns 200 with a bare `true` or `false` body. Otherwise it returns 202 with status-query URLs, and the client polls those until the orchestration's output is `true` or `false`. Either way a refusal arrives as `false` in a successful response, not as a 409, so the client should treat it as "out of stock, tell the user or try another warehouse", not as an error to retry.

Starting an orchestration per reservation isn't free. Every order writes history rows, costs storage transactions, and replays the orchestrator as each step completes, on top of the latency. That's fine at order-level volumes. If you're reserving many lines at once (a whole basket, or a bulk allocation job), pass them to one orchestration and call the entities from there, not one orchestration per line.

`AddStockHttp` is the signal side: receiving stock can't be refused, so it validates the quantity, queues the `add` and returns 202 straight away.

The [.NET entities developer guide](https://learn.microsoft.com/azure/durable-task/durable-functions/durable-functions-dotnet-entities) covers the class-based alternative, with typed proxies through `SignalEntityAsync<TEntityInterface>`. Use it once an entity grows past a handful of operations.

## Reads are cheap and slightly stale

For a stock lookup you don't want to start an orchestration. `ReadEntityStateAsync` reads the saved state straight from storage. Add this last function to `InventoryFunctions`; it also closes the class and namespace:

```csharp
        [FunctionName("GetStockHttp")]
        public static async Task<IActionResult> GetStockHttp(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "stock/{warehouse}/{sku}")] HttpRequest req,
            string warehouse, string sku,
            [DurableClient] IDurableEntityClient client)
        {
            var result = await client.ReadEntityStateAsync<InventoryState>(StockId(warehouse, sku));

            return result.EntityExists
                ? (IActionResult)new OkObjectResult(result.EntityState)
                : new NotFoundResult();
        }
    }
}
```

The trade-off: the read bypasses the entity's queue. If signals are waiting to be processed, you get the last saved state, not the state after them. For a stock-level display that's fine. For "can I sell this?" it isn't, and that question has to go through `tryreserve`. An orchestration that needs the current number without changing it can call `get` instead.

Once this was in place, response times on our inventory updates dropped from around 200 ms to around 15 ms. To be straight about why: much of that gain comes from the update endpoint now signalling, so it returns once the message is queued, not once the write is committed. That's a real improvement for callers, but it changes the contract. The 202 means "accepted", not "done", and your clients need to understand that.

## Operations that span entities

Moving stock between warehouses means decrementing one entity and incrementing another so that no other operation can interleave with it (a `ReadEntityStateAsync` snapshot can still see the halfway state, because it doesn't queue behind the lock). Durable Functions handles this with critical sections. Inside an orchestration, `context.LockAsync(src, dst)` acquires both entities, then you call each one and release the lock by disposing it. This fragment sits inside a transfer orchestrator, with `src` and `dst` built by `StockId`:

```csharp
using (await context.LockAsync(src, dst))
{
    if (await context.CallEntityAsync<bool>(src, "tryreserve", qty))
    {
        await context.CallEntityAsync(dst, "add", qty);
    }
}
```

If the source refuses, `tryreserve` changes nothing and the `add` never runs, so both entities are left exactly as they were. Return that `false` to the caller the same way `ReserveStock` does. The entities overview documents the rules: locks are only available in orchestrations, critical sections can't be nested, and inside one you can only call the entities you've locked. It works, but it serialises everything that touches those entities, so use it for the rare transfer, not the common path.

## Where I wouldn't use entities

- **Very hot keys.** Operations are processed serially in batches, with a storage write per batch, so a single entity's throughput tops out well below a purpose-built counter store. If one SKU takes a burst of updates (a flash sale on one product), that entity's queue becomes the bottleneck. The [performance and scale guide](https://learn.microsoft.com/azure/durable-task/durable-functions/durable-functions-perf-and-scale) has an entity section on batching and throughput; check it against your peak before committing. Shard the counter or use a store built for it.
- **Ad-hoc querying.** "Show me all SKUs under reorder level" isn't an entity question. You can list entity instances through the instance query APIs, but that's a scan, not an index. Project changes into SQL or Cosmos DB if you need reporting.
- **Strict synchronous APIs.** If every caller must get a committed result in one HTTP request, the orchestration hop adds latency and the async fallback adds complexity. A database with a well-scoped transaction may be simpler.
- **Large state.** Entity state is serialised as JSON on every save. Keep it to counters and small documents, not growing lists.

The same guide explains how partitions and queue polling affect throughput. Read it before you size anything.

## The short version

Durable Entities are a good fit when you have many independent things that each need consistent, serialised updates, and you'd rather not run a lock manager or cache cluster to get that. Key them by the unit of consistency. Signal for operations that can't be refused, and go through an orchestration with `CallEntityAsync` for operations that can. Treat `ReadEntityStateAsync` as a stale-but-cheap view. If you're new to the orchestration side, my post on [orchestrator replay and determinism](/blog/2020-08-25-azure-functions-durable-orchestrations/) covers the rules your `ReserveStock` orchestrator has to follow.
