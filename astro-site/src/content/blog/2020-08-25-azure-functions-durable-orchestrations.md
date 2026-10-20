---
title: "Durable Functions Orchestrators: Replay, Determinism and Compensation"
description: "How Durable Functions orchestrators replay from history, the determinism rules that follow, and how to build retries and compensation into a C# workflow."
author: Michael John Peña
draft: false
date: 2020-08-25
tags:
  - Azure
  - Azure Functions
  - Durable Functions
  - Serverless
  - C#
---

Durable Functions orchestrators look like ordinary `async` C#, and that's exactly why people get burned by them. The code runs many times, on different machines, and gets rebuilt from a history table every time it wakes up. If you don't understand that replay model, you'll write an orchestrator that works on your laptop and then loses track of itself in production. The fix is to understand three things: replay, determinism, and explicit compensation.

## Where Durable Functions stands today

Durable Functions 2.0 went GA in November 2019 and runs on Azure Functions v2 and v3 (I use v3). As of this month, the current NuGet release of `Microsoft.Azure.WebJobs.Extensions.DurableTask` is 2.2.2. C# and JavaScript are GA. Python support shipped in June as a public preview. Sub-orchestrations arrived in the [1.0.0b7 release](https://github.com/Azure/azure-functions-durable-python/releases) in early August, but entities still aren't supported, so I wouldn't put it on a critical path yet. If you want to try it, the [Python quickstart](https://learn.microsoft.com/azure/azure-functions/durable/quickstart-python-vscode) is the place to start.

The extension gives you four function types: orchestrators (the workflow), activities (the actual work), entities (small pieces of addressable state, new in 2.0), and clients (anything that starts, queries or signals an instance). I'll stay with orchestrators here, because that's where most of the mistakes happen.

## How an orchestrator actually runs

Underneath the extension is the Durable Task Framework, using an Azure Storage account as its backend. Each task hub gets a set of queues, an Instances table, and a History table. When your orchestrator awaits `CallActivityAsync`, it doesn't sit in memory waiting. The framework records a "task scheduled" event, puts a message on the work-item queue, and unloads the orchestrator.

When the activity finishes, its result goes back as a message. The orchestrator then **starts again from the top**. Every `await` that already has a result in the History table returns that result straight away, without calling the activity again. Execution only goes past the last recorded point when it reaches an `await` that has no history yet. That's event sourcing applied to your control flow. The [orchestrations documentation](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-orchestrations) has a good table showing the history rows a simple function chain writes.

Two consequences matter in practice:

1. **Waiting is cheap.** An orchestrator waiting on a 24-hour approval timer uses no compute and, on the Consumption plan, isn't billed while it waits. You pay for storage transactions and for replays.
2. **Your orchestrator code must give the same answer every time it runs.** If a replay takes a different branch than the original run did, the history no longer matches the code and the instance fails with a non-deterministic orchestration error. Or, worse, it quietly does the wrong thing.

## The determinism rules

Every rule on the [code constraints page](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-code-constraints) follows from replay. Here are the ones I check in every code review, plus the replay-safe logging rule:

| Don't do this in an orchestrator | Do this instead |
|---|---|
| `DateTime.Now` / `DateTime.UtcNow` | `context.CurrentUtcDateTime` |
| `Guid.NewGuid()` | `context.NewGuid()` |
| `Random`, reading environment variables or config | Pass values in as input, or read them in an activity |
| `HttpClient`, database clients, input/output bindings | Call an activity, or use `context.CallHttpAsync` |
| `Task.Delay`, `Thread.Sleep` | `context.CreateTimer` |
| `Task.Run`, `ConfigureAwait(false)`, your own threads | Only await tasks that come from the context |
| `log.LogInformation` directly | `context.CreateReplaySafeLogger(log)` |
| `while (true)` | `context.ContinueAsNew` for eternal workflows |

The logging rule causes the most confusion in Application Insights. Without a replay-safe logger, an orchestrator logs "step 1 started" once per replay, six times for a five-step chain, and someone opens an incident because they think the activity ran six times.

The extension package depends on the Durable Functions Roslyn analyzer, so Visual Studio flags many of these violations at build time. Treat its warnings as errors. It won't catch everything, though: a helper method that reads the clock three calls deep still gets through.

## A workflow with retries and compensation

Order processing makes a good example because it has the three things that make orchestration worth using: a sequence, a step that fails transiently (payment), and a step that has to be undone when a later one fails (an inventory reservation).

First, the package reference. I pin it, for the same reasons I gave in [my Functions v3 setup post](/blog/2020-08-01-azure-functions-v3-dotnet-core/):

```xml
<!-- Fragment: add to the ItemGroup in your Functions v3 .csproj -->
<PackageReference Include="Microsoft.Azure.WebJobs.Extensions.DurableTask" Version="2.2.2" />
```

The orchestrator, its activities and the HTTP starter fit in one file. The activity bodies are placeholders for your real inventory, payment and shipping calls:

```csharp
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.DurableTask;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.Extensions.Logging;

public class OrderLine { public string Sku { get; set; } public int Quantity { get; set; } }
public class Order { public string Id { get; set; } public string CustomerId { get; set; } public OrderLine[] Lines { get; set; } }
public class PaymentRequest { public Order Order { get; set; } public string IdempotencyKey { get; set; } }

public static class OrderWorkflow
{
    [FunctionName("OrderOrchestrator")]
    public static async Task<string> RunOrchestrator(
        [OrchestrationTrigger] IDurableOrchestrationContext context,
        ILogger log)
    {
        log = context.CreateReplaySafeLogger(log);
        var order = context.GetInput<Order>();

        if (!await context.CallActivityAsync<bool>("ValidateOrder", order))
        {
            return "Rejected";
        }

        await context.CallActivityAsync("ReserveInventory", order);

        var paymentRetry = new RetryOptions(TimeSpan.FromSeconds(5), maxNumberOfAttempts: 4)
        {
            BackoffCoefficient = 2.0,
            MaxRetryInterval = TimeSpan.FromMinutes(1),
            Handle = ex => !(ex is InvalidOperationException || ex.InnerException is InvalidOperationException)
        };

        try
        {
            // Derived from the order, so it survives replays and instance restarts alike.
            var key = $"payment-{order.Id}";
            await context.CallActivityWithRetryAsync(
                "ChargePayment", paymentRetry, new PaymentRequest { Order = order, IdempotencyKey = key });
        }
        catch (FunctionFailedException ex)
        {
            log.LogWarning(ex, "Payment failed for order {OrderId}; releasing inventory", order.Id);
            await context.CallActivityAsync("ReleaseInventory", order);
            return "PaymentFailed";
        }

        // Not shown: if CreateShipment fails after a successful charge, nothing is undone.
        // A production saga wraps it too and compensates in reverse: refund, then release.
        await context.CallActivityAsync("CreateShipment", order);
        return "Completed";
    }

    [FunctionName("ValidateOrder")]
    public static bool ValidateOrder([ActivityTrigger] Order order) =>
        !string.IsNullOrEmpty(order.CustomerId) && order.Lines != null && order.Lines.Any();

    [FunctionName("ReserveInventory")]
    public static void ReserveInventory([ActivityTrigger] Order order, ILogger log) =>
        log.LogInformation("Reserving {Count} lines for {OrderId}", order.Lines.Length, order.Id);

    [FunctionName("ReleaseInventory")]
    public static void ReleaseInventory([ActivityTrigger] Order order, ILogger log) =>
        log.LogInformation("Releasing reservation for {OrderId}", order.Id);

    [FunctionName("ChargePayment")]
    public static void ChargePayment([ActivityTrigger] PaymentRequest request, ILogger log) =>
        log.LogInformation("Charging {OrderId} with key {Key}", request.Order.Id, request.IdempotencyKey);

    [FunctionName("CreateShipment")]
    public static void CreateShipment([ActivityTrigger] Order order, ILogger log) =>
        log.LogInformation("Creating shipment for {OrderId}", order.Id);

    [FunctionName("OrderOrchestrator_HttpStart")]
    public static async Task<HttpResponseMessage> HttpStart(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestMessage req,
        [DurableClient] IDurableOrchestrationClient client)
    {
        var order = await req.Content.ReadAsAsync<Order>();
        if (order == null || string.IsNullOrEmpty(order.Id))
        {
            return new HttpResponseMessage(HttpStatusCode.BadRequest);
        }

        // Don't overwrite an order workflow that is queued, running or already done.
        var existing = await client.GetStatusAsync(order.Id);
        if (existing != null &&
            (existing.RuntimeStatus == OrchestrationRuntimeStatus.Pending ||
             existing.RuntimeStatus == OrchestrationRuntimeStatus.Running ||
             existing.RuntimeStatus == OrchestrationRuntimeStatus.Completed))
        {
            return new HttpResponseMessage(HttpStatusCode.Conflict);
        }

        var instanceId = await client.StartNewAsync("OrderOrchestrator", order.Id, order);
        return client.CreateCheckStatusResponse(req, instanceId);
    }
}
```

### Why it's shaped this way

**Retry belongs on the activity, not around it.** `CallActivityWithRetryAsync` records every attempt and every back-off delay in history, so the retry schedule survives a host restart. If you wrap a plain call in a `for` loop with `Task.Delay`, you break the determinism rules and lose that durability. The `Handle` predicate stops retries for failures that will never succeed. In this sketch, a payment activity that throws `InvalidOperationException` for a declined card fails straight away instead of being retried four times. Inside `Handle`, the activity's exception arrives wrapped (as the inner exception of a task-failure exception), so the predicate checks `InnerException` as well as the outer exception. Once retries run out, the orchestrator sees a `FunctionFailedException`, which is what the `catch` block handles.

**The idempotency key comes from the order ID.** Activities run *at least once*. If the host dies after the payment provider charges the card but before the result is written to history, the activity runs again. Passing a key the provider can de-duplicate on is the only real protection. Generating the key inside the orchestrator with `Guid.NewGuid()` would be worse than useless: it produces a new value on every replay. `context.NewGuid()` fixes that, but it is only replay-safe, not restart-safe. Its value is derived from the instance ID and the orchestration's start time, so a restarted or overwritten instance (which this starter deliberately allows for Failed and Terminated orders) gets a new key and can charge the card twice. A key built from the business identifier, `payment-{order.Id}`, stays the same across replays, restarts and duplicate requests.

**Compensation is explicit.** Durable Functions doesn't roll anything back for you. The `catch` block is a saga written as ordinary code: undo the reservation, return a terminal status. The sample only compensates a payment failure. If `CreateShipment` fails after the charge succeeds, the orchestration fails with the card charged and the stock still reserved. In a real workflow, each later step needs its own `try`/`catch` that undoes the earlier steps in reverse order: refund the payment, then release the inventory. Every compensating activity has to be idempotent as well, for the same at-least-once reason.

**The instance ID is the order ID.** Passing `order.Id` to `StartNewAsync` means a duplicate HTTP request targets the same instance ID instead of creating a parallel workflow under a random one. That alone isn't de-duplication. In 2.x, calling `StartNewAsync` with an ID that already exists can overwrite that instance and run every step again from the start, including the payment. So the starter calls `GetStatusAsync` first and returns 409 Conflict if the instance is Pending, Running or Completed. Failed and Terminated instances are allowed through, because restarting those is usually what you want. The check narrows the window but isn't a lock: two requests arriving together can both see no instance and both start one. That's why the payment key comes from `order.Id`, so the provider is the real backstop against a double charge.

## Versioning is the problem nobody plans for

Replay has one more consequence that teams usually find out about in their second month. If you deploy a change that reorders, adds or removes `await` calls while instances are still in flight, those instances replay old history against new code and fail. There's no built-in versioning. The [versioning guidance](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-versioning) gives you three options: accept the failures, drain or terminate in-flight instances before deploying, or deploy side by side with a new task hub name or new orchestrator function names.

My rule of thumb: if instances finish in minutes, drain before you deploy. If they live for days, like approvals, plan for side-by-side deployment from the first release, and keep orchestrators short by moving logic into activities and sub-orchestrations, which you can change more freely.

Long waits have one more limit. With the Azure Storage backend, a single durable timer can't be longer than seven days. If you need a longer wait, call `CreateTimer` in a loop.

## When I wouldn't reach for this

- **A single hand-off.** HTTP to a queue to a worker doesn't need an orchestrator. A storage or Service Bus queue is simpler and cheaper.
- **High-throughput, low-latency pipelines.** Every step costs queue and table transactions, so per-step latency is measured in tens or hundreds of milliseconds. For streams of millions of small events, use Event Hubs and stateless functions.
- **Workflows owned by non-developers.** If the people changing the steps are integration analysts, Logic Apps' designer and connectors are a better fit than C# they can't review.
- **Teams who won't learn the constraints.** Durable Functions punishes code that looks right, so a team that treats it as normal async code will ship non-deterministic orchestrators that fail in ways that are hard to debug.

## The takeaway

Think of an orchestrator as a deterministic script that gets replayed, not as a long-running method. Keep it free of I/O, the clock and randomness. Put retries on activities, make every activity idempotent, write compensation explicitly, and decide on a versioning strategy before the first deployment. Do those five things and Durable Functions is the cleanest way I know to run multi-step, failure-prone workflows on Azure without managing workers or state stores yourself.
