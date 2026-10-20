---
title: "Service Bus Sessions, Transactions and DLQs in the New .NET SDK"
description: "How to use Azure Service Bus sessions, session state, transactions and dead-letter queues with the Azure.Messaging.ServiceBus 7.0 SDK, and when not to bother."
author: Michael John Peña
draft: false
date: 2021-01-12
tags:
  - Azure
  - Service Bus
  - Messaging
  - Integration
  - .NET
---

Service Bus is the message broker I most often pull off the shelf in 2021, and it's the advanced features, not the basic queue, that earn it the spot: sessions for per-key ordering, transactions for settling and recording progress together, and dead-letter queues someone actually reads. Once you internalise those three, Service Bus stops being "fancier Storage Queues" and starts being a real integration tool.

I've covered the basics before: sending, receiving, filters and scheduled messages in [Building Reliable Messaging with Azure Service Bus](/blog/2020-08-13-azure-service-bus-messaging/), and the queue vs topic decision in [Queues and Topics Patterns](/blog/2020-09-20-azure-service-bus-queues-topics/). This post is about correctness: keeping related messages in order, keeping state and settlement consistent, and dealing with what fails. All the code uses the new `Azure.Messaging.ServiceBus` package, which reached its first stable release (7.0.0) in November 2020. If you're starting something new, start there rather than on `Microsoft.Azure.ServiceBus`.

## Sessions: ordering per business key, not per queue

A plain queue is broadly first-in, first-out, but it isn't a guarantee (partitioned entities, abandons and multiple consumers all break it). Most systems don't need global ordering anyway. They need "all events for order 123 are processed in sequence", while order 124 can be handled in parallel on another instance.

That is exactly what [message sessions](https://learn.microsoft.com/azure/service-bus-messaging/message-sessions) give you. Every message carries a `SessionId`. A receiver that accepts a session gets an exclusive lock on it, so only one consumer at a time sees that session's messages, in order. Other consumers work on other sessions concurrently. You get ordering where it matters and parallelism everywhere else.

A few constraints decide whether sessions are right for you:

- Sessions need the Standard or Premium tier. Basic doesn't support them (or transactions).
- You enable sessions when you create the queue or subscription. Once it's session-enabled, every message must have a `SessionId`. A sender that forgets to set one is a bug you'll find in testing.
- A hot session is a bottleneck by design. If 90% of your traffic shares one session ID, you've rebuilt a single-threaded consumer and paid for sessions to do it.
- Throughput scales with the number of active sessions, not the number of consumers. Pick a key with plenty of distinct values: order ID, customer ID, device ID.

Create the queue with sessions on:

```bash
az servicebus queue create \
  --resource-group <your-resource-group> \
  --namespace-name <your-namespace> \
  --name orders \
  --enable-session true \
  --max-delivery-count 10 \
  --lock-duration PT1M
```

### Processing sessions with the session processor

You can drive sessions by hand with `AcceptNextSessionAsync`, but for a long-running worker I'd use `ServiceBusSessionProcessor`. It accepts sessions, renews locks, and moves on to the next session when one goes quiet. `MaxConcurrentSessions` is the knob that matters: it's how many business keys you process in parallel on this instance.

```csharp
// .NET 5 console app: dotnet add package Azure.Messaging.ServiceBus --version 7.0.0
using System;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Messaging.ServiceBus;

var connectionString = Environment.GetEnvironmentVariable("SERVICEBUS_CONNECTION_STRING");
await using var client = new ServiceBusClient(connectionString);

// Send three ordered steps for one order
await using var sender = client.CreateSender("orders");
await sender.SendMessagesAsync(new[]
{
    new ServiceBusMessage("created")  { SessionId = "order-123", Subject = "OrderEvent" },
    new ServiceBusMessage("paid")     { SessionId = "order-123", Subject = "OrderEvent" },
    new ServiceBusMessage("shipped")  { SessionId = "order-123", Subject = "OrderEvent" }
});

await using var processor = client.CreateSessionProcessor("orders", new ServiceBusSessionProcessorOptions
{
    MaxConcurrentSessions = 8,
    AutoCompleteMessages = false
});

processor.ProcessMessageAsync += async args =>
{
    // Session state survives restarts and lock loss; use it to resume a workflow
    var stateData = await args.GetSessionStateAsync();
    var state = stateData is null
        ? new OrderState(0)
        : JsonSerializer.Deserialize<OrderState>(stateData.ToArray());

    Console.WriteLine($"{args.SessionId}: step {state.Step + 1} = {args.Message.Body}");

    await args.SetSessionStateAsync(
        new BinaryData(JsonSerializer.SerializeToUtf8Bytes(state with { Step = state.Step + 1 })));
    await args.CompleteMessageAsync(args.Message);
};

processor.ProcessErrorAsync += args =>
{
    Console.WriteLine($"Error from {args.ErrorSource}: {args.Exception.Message}");
    return Task.CompletedTask;
};

await processor.StartProcessingAsync();
Console.WriteLine("Processing. Press Enter to stop.");
Console.ReadLine();
await processor.StopProcessingAsync();

record OrderState(int Step);
```

### Session state is underrated

Session state is an opaque blob stored on the broker against the session, limited to the maximum message size for your tier (256 KB on Standard). It's the cleanest place to keep "where am I up to in this workflow" without standing up a database just for that. Two habits keep it healthy: keep it small, and set it to `null` when a session's workflow is finished, because it stays (and counts against the entity's quota) until you clear it.

Notice the gap in the processor example, though. The state update and the completion are two separate calls. If the process dies between them, the message is redelivered and the step runs twice. That's what transactions are for.

## Transactions: settle and record progress atomically

[Service Bus transactions](https://learn.microsoft.com/azure/service-bus-messaging/service-bus-transactions) group operations so they all commit or none do. The operations that can take part are send, complete, abandon, dead-letter, defer and lock renewal, and the SDK sample also shows setting session state inside one. Receive is *not* one of them. The pattern is: receive in peek-lock mode, open a `TransactionScope`, settle the message and do your follow-up work inside it, then commit.

Here's the session example with the gap closed. Completing the message and advancing the session state happen as one unit:

```csharp
// .NET 5 console app: dotnet add package Azure.Messaging.ServiceBus --version 7.0.0
using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Transactions;
using Azure.Messaging.ServiceBus;

var connectionString = Environment.GetEnvironmentVariable("SERVICEBUS_CONNECTION_STRING");
await using var client = new ServiceBusClient(connectionString);

// Lock the next session that has messages waiting. If none is available within
// the client's try timeout, this throws a ServiceBusException with
// Reason == ServiceBusFailureReason.ServiceTimeout, so catch that in a real worker.
await using ServiceBusSessionReceiver receiver = await client.AcceptNextSessionAsync("orders");

var stateData = await receiver.GetSessionStateAsync();
var state = stateData is null
    ? new OrderState(0)
    : JsonSerializer.Deserialize<OrderState>(stateData.ToArray());

ServiceBusReceivedMessage message = await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(10));
if (message is not null)
{
    using (var ts = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled))
    {
        await receiver.CompleteMessageAsync(message);
        await receiver.SetSessionStateAsync(
            new BinaryData(JsonSerializer.SerializeToUtf8Bytes(state with { Step = state.Step + 1 })));
        ts.Complete();
    }
    Console.WriteLine($"{receiver.SessionId}: committed step {state.Step + 1}");
}

record OrderState(int Step);
```

`TransactionScopeAsyncFlowOption.Enabled` is not optional. Without it the ambient transaction doesn't flow across the `await`s and the operations run outside it.

Know the limits before you design around transactions:

- **Two-minute timeout.** The clock starts at the first operation in the transaction. Keep slow work (HTTP calls, database writes) outside the scope.
- **Service Bus only.** Your SQL database is not enlisted. This is not a distributed transaction, so "complete the message and write the row atomically" still needs an idempotent consumer or an outbox.
- **No retries inside a transaction.** If an operation fails, the whole scope fails and you handle it.
- **Cross-entity transactions.** Receiving from one queue and sending to a different one atomically uses the broker's "send via" transfer mechanism. The service supports it, but the 7.0 SDK's [transaction sample](https://github.com/Azure/azure-sdk-for-net/blob/Azure.Messaging.ServiceBus_7.0.0/sdk/servicebus/Azure.Messaging.ServiceBus/samples/Sample06_Transactions.md) only covers operations against a single entity, and the client has no option yet to opt in to spanning entities. If you need it today, test it carefully against your exact entities before you rely on it, or keep the hand-off idempotent instead.

My rule of thumb: use a transaction when the operations already live on the same entity (complete plus session state, complete plus send back to the same queue for the next step). Don't contort your topology to fit inside one.

## Dead-letter queues: somebody has to read them

Every queue and subscription has a [dead-letter queue](https://learn.microsoft.com/azure/service-bus-messaging/service-bus-dead-letter-queues) (DLQ). The broker moves messages there on its own for a handful of reasons, most commonly `MaxDeliveryCountExceeded` (the default max delivery count is 10) and `TTLExpiredException` when dead-lettering on expiry is enabled. Your code can also dead-letter a message explicitly, which is the right call for a message that can never succeed, such as one that fails validation. Retrying a poison message ten times just delays the inevitable and burns lock time.

The part teams miss: nothing ever cleans up the DLQ, and time-to-live doesn't apply to it. A DLQ nobody reads is silent data loss with a storage bill.

```csharp
// .NET 5 console app: dotnet add package Azure.Messaging.ServiceBus --version 7.0.0
using System;
using Azure.Messaging.ServiceBus;

var connectionString = Environment.GetEnvironmentVariable("SERVICEBUS_CONNECTION_STRING");
await using var client = new ServiceBusClient(connectionString);

// The DLQ of a session-enabled queue is not itself session-enabled,
// so a plain receiver works here
await using var dlqReceiver = client.CreateReceiver("orders",
    new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter });
await using var sender = client.CreateSender("orders");

var messages = await dlqReceiver.ReceiveMessagesAsync(maxMessages: 50, maxWaitTime: TimeSpan.FromSeconds(5));
foreach (ServiceBusReceivedMessage dead in messages)
{
    Console.WriteLine($"{dead.MessageId} session={dead.SessionId} reason={dead.DeadLetterReason} " +
                      $"detail={dead.DeadLetterErrorDescription} deliveries={dead.DeliveryCount}");

    if (dead.DeadLetterReason == "MaxDeliveryCountExceeded")
    {
        // Likely transient (a downstream outage): resubmit a copy
        await sender.SendMessageAsync(new ServiceBusMessage(dead));
        await dlqReceiver.CompleteMessageAsync(dead);
    }
    else
    {
        // Validation failures and the like: leave for a human, release the lock
        await dlqReceiver.AbandonMessageAsync(dead);
    }
}
```

When you dead-letter explicitly, give the next person something to work with:

```csharp
// Fragment: inside a message handler where `receiver` and `message` are in scope
await receiver.DeadLetterMessageAsync(message,
    deadLetterReason: "ValidationFailed",
    deadLetterErrorDescription: "Order total is negative");
```

Two cautions on resubmitting. First, a resubmitted message goes to the back of its session, so it loses its original order relative to the other messages for that key. If ordering really matters, the consumer has to cope with that (session state helps here). Second, automate resubmission only for reasons you're confident are transient. For everything else, alert on DLQ depth in Azure Monitor and have a person decide. Third, the copy keeps the original `MessageId`; if duplicate detection is on, set a new `MessageId` or the broker will discard the resubmit as a duplicate.

## Deferral: when the message arrives before it's useful

Sometimes a message is valid but early: a "payment captured" event lands before "order created". [Deferral](https://learn.microsoft.com/azure/service-bus-messaging/message-deferral) sets it aside on the broker; you keep its sequence number and fetch it later by that number.

```csharp
// Fragment: `receiver` is a ServiceBusReceiver (or session receiver) on the same entity
long sequenceNumber = message.SequenceNumber;
await receiver.DeferMessageAsync(message);
// Persist sequenceNumber (session state is a good place), then later:
ServiceBusReceivedMessage deferred = await receiver.ReceiveDeferredMessageAsync(sequenceNumber);
await receiver.CompleteMessageAsync(deferred);
```

The catch is that a deferred message only comes back if you ask for it by sequence number. Lose the number and the message sits there indefinitely: deferred messages aren't expired or dead-lettered until someone asks for them by sequence number. You can still find them by peeking the entity, but that's a recovery job, not a design.

Don't expect sessions to solve this for you. A session keeps the order messages *arrived* in, not the business order. If the payment service and the order service publish independently and the payment event wins the race, the session hands it over first. The fix is to defer the early message inside the session and keep its sequence number in session state, then fetch it once the event it was waiting for has been processed.

## Which of these do you actually need?

| Requirement | Use | Skip it when |
|---|---|---|
| Ordered processing per key | Sessions | Your consumers are idempotent and order-insensitive |
| Workflow progress per key | Session state | You already keep that state in a database |
| Settle + record atomically | Transactions | The other side is a database, not Service Bus |
| Poison message handling | Explicit dead-lettering plus a DLQ reader | Never; every queue needs a DLQ plan |
| Out-of-order arrivals | Deferral | A single publisher already enqueues events in business order |

Design for redelivery first. Sessions, transactions and DLQs reduce how often things go wrong, but an idempotent consumer is what makes the remaining cases harmless. Add sessions when ordering is a business rule, add transactions when the operations already sit on one entity, and put a DLQ reader and an alert on every queue from day one.
