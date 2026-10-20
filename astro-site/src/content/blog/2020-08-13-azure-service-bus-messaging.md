---
title: "Replacing a Fragile HTTP Call with an Azure Service Bus Queue"
description: "Why an HTTP call between two services drops work, and how a Service Bus queue with peek-lock, duplicate detection and a watched dead-letter queue fixes it."
author: Michael John Peña
draft: false
date: 2020-08-13
tags:
  - Azure
  - Service Bus
  - Messaging
  - .NET
  - Integration
---

Two services that work perfectly in isolation, plus a synchronous HTTP call between them, equals a system that occasionally drops orders. The caller times out, the callee restarts mid-request, a deployment recycles the app pool, and an order that the customer saw as "placed" never reaches fulfilment. The fix is rarely "make HTTP more reliable". It's "stop using HTTP for the work that has to survive a restart."

Azure Service Bus is the boring, reliable answer to that problem. What makes the hand-off reliable isn't the queue itself but four settings and habits: peek-lock settlement, duplicate detection, delivery limits and a dead-letter queue that somebody looks at.

## Why the HTTP call loses work

A synchronous call couples three things that shouldn't be coupled: the caller's availability, the callee's availability and the network between them. When any of them blips, the caller has to decide on the spot whether to retry, give up or tell the user it failed. Most code does a quick retry and then logs an error nobody reads.

A queue separates "I have accepted this work" from "this work is done". The sender only needs the broker to be up. The receiver can be down, deploying or overloaded, and the message waits. That's the whole value, and it's why I reach for a queue whenever the receiving side does something that must eventually happen but doesn't need to happen inside the user's request.

It's also why I don't use a queue when the caller genuinely needs the answer right now, such as a price lookup or a validation check. Turning a request/response interaction into a message plus a reply queue adds latency and moving parts for no reliability gain. Keep HTTP for queries; use messaging for commands that must not be lost.

## Service Bus or Storage queues

Azure has two queueing services, and the choice matters more than people expect. Microsoft's [comparison of Storage queues and Service Bus queues](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted) is worth reading in full, but the short version is:

| Need | Storage queues | Service Bus queues |
|---|---|---|
| Max message size | 64 KB | 256 KB (Standard), 1 MB (Premium) |
| Dead-lettering | Do it yourself with `DequeueCount` | Built in |
| Duplicate detection | No | Yes |
| Ordering (FIFO) | No guarantee | Yes, with sessions |
| Topics and subscriptions | No | Yes (Standard and Premium) |
| Cost model | Pay per operation (billed per 10,000) plus storage | Standard: base charge plus per-million operations; Premium: per messaging unit per hour |

If the message is a cheap, idempotent nudge ("thumbnail this blob"), Storage queues are fine and cheaper. If it's a business command like an order, where a duplicate charges someone twice and a lost message loses revenue, I want the broker features. That's Service Bus, on the Standard tier at minimum, because Basic supports neither duplicate detection nor topics, and this design depends on the first and will soon want the second.

## Set up the queue for failure, not the happy path

The settings that matter are decided when you create the queue, so it's worth being deliberate:

```bash
az servicebus namespace create \
    --resource-group rg-messaging \
    --name <your-namespace-name> \
    --location australiaeast \
    --sku Standard

az servicebus queue create \
    --resource-group rg-messaging \
    --namespace-name <your-namespace-name> \
    --name orders \
    --lock-duration PT1M \
    --max-delivery-count 5 \
    --enable-duplicate-detection true \
    --duplicate-detection-history-time-window PT1H \
    --enable-dead-lettering-on-message-expiration true
```

What each of those buys you:

- **Lock duration.** In peek-lock mode a received message is locked, not deleted, for this long. The default is one minute and the maximum is five. If your processing can take longer, renew the lock rather than reaching for a huge value, because a long lock also means a crashed consumer holds the message hostage for that long.
- **Max delivery count.** Every abandon or lock expiry increments the message's delivery count. When it passes this limit the message moves to the dead-letter queue with the reason `MaxDeliveryCountExceeded`. The default is 10; I usually lower it, because ten attempts at a message that fails deterministically is just ten log entries. A low count is aimed at those deterministic failures; outages need a different answer, covered below.
- **Duplicate detection.** Service Bus drops any message whose `MessageId` it has already seen within the history window. The [window defaults to 10 minutes](https://learn.microsoft.com/en-us/azure/service-bus-messaging/duplicate-detection) and can go up to seven days. Turn it on when you create the queue: it can't be enabled on an existing queue, so adding it later means creating a new queue and moving senders and receivers across.
- **Dead-letter on expiry.** Without it, a message that sits past its time-to-live simply disappears. With it, the message lands in the dead-letter queue where you can see it.

## Sending: make retries safe

Here's the sender, using `Microsoft.Azure.ServiceBus` 4.1.x, the current GA .NET client, on .NET Core 3.1. The publisher and processor classes are library code; a small `Program.cs` after the processor hosts them in a console app, and they drop into a worker service or ASP.NET Core app the same way.

```bash
dotnet add package Microsoft.Azure.ServiceBus --version 4.1.3
```

```csharp
using System;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.ServiceBus;

public class Order
{
    public Guid Id { get; set; }
    public string CustomerId { get; set; }
    public decimal Total { get; set; }
}

public sealed class OrderPublisher : IAsyncDisposable
{
    private readonly QueueClient _queueClient;

    public OrderPublisher(string connectionString)
    {
        _queueClient = new QueueClient(connectionString, "orders");
    }

    public Task SendAsync(Order order)
    {
        var message = new Message(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(order)))
        {
            // Same order, same MessageId: duplicate detection drops resends.
            MessageId = order.Id.ToString(),
            ContentType = "application/json",
            Label = "OrderPlaced"
        };

        return _queueClient.SendAsync(message);
    }

    public async ValueTask DisposeAsync() => await _queueClient.CloseAsync();
}
```

The line that matters is `MessageId = order.Id.ToString()`. The client already retries transient failures, and your own code should retry too when a send throws. But a send can succeed on the broker and still time out on the way back, so the sender can't tell "it failed" from "it worked and I didn't hear about it". With a business key as the `MessageId` and duplicate detection on, resending is safe. Leave `MessageId` as the default random value and duplicate detection does nothing for you.

Duplicate detection only covers the sending side within the window, though. The receiver can still see a message more than once, because Service Bus gives you at-least-once delivery in peek-lock mode. The handler has to be idempotent: check whether the order was already fulfilled before fulfilling it.

## Receiving: settle explicitly, and classify failures

```csharp
using System;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.ServiceBus;

public sealed class OrderProcessor : IAsyncDisposable
{
    private readonly QueueClient _queueClient;

    public OrderProcessor(string connectionString)
    {
        _queueClient = new QueueClient(connectionString, "orders", ReceiveMode.PeekLock);
    }

    public void Start()
    {
        var options = new MessageHandlerOptions(OnErrorAsync)
        {
            AutoComplete = false,
            MaxConcurrentCalls = 8,
            MaxAutoRenewDuration = TimeSpan.FromMinutes(5)
        };

        _queueClient.RegisterMessageHandler(HandleAsync, options);
    }

    private async Task HandleAsync(Message message, CancellationToken token)
    {
        Order order;
        try
        {
            order = JsonSerializer.Deserialize<Order>(Encoding.UTF8.GetString(message.Body));
        }
        catch (JsonException ex)
        {
            // Retrying won't fix a malformed payload, so dead-letter it now.
            await _queueClient.DeadLetterAsync(
                message.SystemProperties.LockToken, "MalformedPayload", ex.Message);
            return;
        }

        // A body of "null" deserialises to null, and a missing Id to Guid.Empty.
        if (order == null || order.Id == Guid.Empty)
        {
            await _queueClient.DeadLetterAsync(
                message.SystemProperties.LockToken, "MalformedPayload", "Body has no order or no order Id.");
            return;
        }

        try
        {
            await FulfilOrderAsync(order, token); // must be idempotent
            await _queueClient.CompleteAsync(message.SystemProperties.LockToken);
        }
        catch (MessageLockLostException ex)
        {
            // The lock expired before we settled. Nothing to abandon: the message will be
            // redelivered, and the idempotent handler will find the order already fulfilled.
            Console.Error.WriteLine($"Lock lost for {message.MessageId}: {ex.Message}");
        }
        catch (OrderRejectedException ex)
        {
            // A business rule failure fails the same way every time, so dead-letter it now.
            await _queueClient.DeadLetterAsync(
                message.SystemProperties.LockToken, "OrderRejected", ex.Message);
        }
        // Let cancellation reach the pump: it logs the exception and abandons the message (or the lock expires if the receiver is already closed).
        catch (Exception ex) when (!(ex is OperationCanceledException))
        {
            // Probably transient: release the lock so it's redelivered.
            await _queueClient.AbandonAsync(message.SystemProperties.LockToken);
        }
    }

    private static Task FulfilOrderAsync(Order order, CancellationToken token)
    {
        // Check whether this order was already fulfilled, then do the work.
        return Task.CompletedTask;
    }

    private static Task OnErrorAsync(ExceptionReceivedEventArgs args)
    {
        Console.Error.WriteLine(
            $"{args.ExceptionReceivedContext.Action} on {args.ExceptionReceivedContext.EntityPath}: {args.Exception.Message}");
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await _queueClient.CloseAsync();
}

// Thrown by FulfilOrderAsync for failures that retrying can't fix,
// such as an unknown customer or a total that fails validation.
public sealed class OrderRejectedException : Exception
{
    public OrderRejectedException(string message) : base(message) { }
}
```

And the host, which reads the connection string from an environment variable and runs until Ctrl+C:

```csharp
using System;
using System.Threading.Tasks;

public static class Program
{
    public static async Task Main()
    {
        var connectionString = Environment.GetEnvironmentVariable("SERVICEBUS_CONNECTION_STRING")
            ?? throw new InvalidOperationException("Set SERVICEBUS_CONNECTION_STRING.");

        var shutdown = new TaskCompletionSource<bool>();
        Console.CancelKeyPress += (sender, e) =>
        {
            e.Cancel = true; // keep the process alive so DisposeAsync can close the client
            shutdown.TrySetResult(true);
        };

        await using var processor = new OrderProcessor(connectionString);
        processor.Start();

        Console.WriteLine("Processing orders. Press Ctrl+C to stop.");
        await shutdown.Task;
    }
}
```

Four decisions are baked into that handler.

**`AutoComplete = false`.** With auto-complete on, the message pump completes the message as soon as your callback returns without throwing. That's convenient, but explicit settlement makes the "done" moment obvious in code review, and it forces you to decide what each failure path does.

**Poison messages skip the retry loop.** A payload that can't be deserialised, or a business rule the order breaks, will fail the same way every time. Dead-lettering it immediately with a clear reason beats burning through the delivery count and ending up in the same place with the less useful reason `MaxDeliveryCountExceeded`.

**Transient failures are abandoned.** Abandoning makes the message available again straight away. That's an immediate retry with no back-off. If the database is down for a minute or more, five deliveries are used up in seconds and every in-flight order lands in the dead-letter queue as `MaxDeliveryCountExceeded`, which is the opposite of what the queue was supposed to give you. The low delivery count is there for deterministic failures, not outages. For an outage, stop pulling messages: a circuit breaker that closes the `QueueClient` after a run of dependency failures, and creates a fresh one once a health check passes, leaves orders safely in the queue. For per-message back-off, send a copy with `ScheduledEnqueueTimeUtc` set a little in the future, using the same `MessageId` plus an attempt suffix (`<order-id>-retry-1`) so duplicate detection doesn't drop it, then complete the original. And if an outage has already dead-lettered a batch, replay it from the DLQ once the dependency is back. What I wouldn't do is raise the delivery count to 100 and hope.

**A lost lock isn't a failure to handle.** If the lock expires before `CompleteAsync`, the complete throws `MessageLockLostException`, and abandoning on that lost lock would throw too. Logging it is enough; the message comes back and idempotency takes care of the rest.

`MaxAutoRenewDuration` keeps renewing the lock while the handler runs, up to that limit, so a slow message isn't redelivered to another consumer mid-processing.

## Watch the dead-letter queue

My rule: dead-letter queues are not a failure mode, they're a feature. A message in the DLQ is a message the system has explicitly told you it couldn't handle. The [documentation is blunt](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) that there's no automatic cleanup: messages stay there until someone receives and completes them. A growing DLQ is a quiet incident, the kind that's been broken for three weeks before anyone notices.

So inspect it, and alert on it. A count per queue is cheap to get:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.Azure.ServiceBus;
using Microsoft.Azure.ServiceBus.Core;
using Microsoft.Azure.ServiceBus.Management;

public static class DeadLetterInspector
{
    public static async Task ReportAsync(string connectionString, string queueName)
    {
        var management = new ManagementClient(connectionString);
        var info = await management.GetQueueRuntimeInfoAsync(queueName);
        Console.WriteLine($"{queueName}: {info.MessageCountDetails.DeadLetterMessageCount} dead-lettered");
        await management.CloseAsync();

        // Peek, don't receive: inspecting must not remove anything.
        var receiver = new MessageReceiver(
            connectionString, EntityNameHelper.FormatDeadLetterPath(queueName));
        var messages = await receiver.PeekAsync(20);

        foreach (var message in messages)
        {
            message.UserProperties.TryGetValue("DeadLetterReason", out var reason);
            message.UserProperties.TryGetValue("DeadLetterErrorDescription", out var description);
            Console.WriteLine($"{message.MessageId}: {reason} - {description}");
        }

        await receiver.CloseAsync();
    }
}
```

The runtime-info call needs a SAS policy with Manage rights; give the processor a Listen-only policy and the publisher a Send-only one. Build a small admin page or a scheduled job around that count per queue and subscription, and you'll catch integration bugs days before your customers do. Peeking matters here: a diagnostic tool that receives and completes dead-lettered messages is a tool that quietly deletes evidence. Replaying a message should be a deliberate act: fix the cause, resend a copy to the main queue, then complete the dead-lettered original.

## A note on the client library

There's a new .NET client, `Azure.Messaging.ServiceBus`, following the new Azure SDK guidelines. It's still in preview: [7.0.0-preview.5 shipped on 11 August 2020](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/servicebus/Azure.Messaging.ServiceBus/CHANGELOG.md), and recent previews have renamed types and methods between releases. It's the direction of travel and worth prototyping against, but for production code today I'm staying on `Microsoft.Azure.ServiceBus` 4.x. The concepts in this post (peek-lock, delivery count, duplicate detection, dead-lettering) belong to the broker, not the SDK, so they carry over unchanged.

Also, keep the connection string out of `appsettings.json`. I covered pulling secrets from Key Vault with managed identity in [the previous post](/blog/2020-08-12-azure-key-vault-dotnet/).

## When to reach for this

Replace the HTTP call with a Service Bus queue when the receiving work must eventually happen, can tolerate seconds of delay and would cost real money if lost or duplicated. Make it reliable by doing four things: give every message a business-key `MessageId` with duplicate detection on, settle explicitly, dead-letter what can't succeed instead of retrying it, and put the dead-letter count somewhere a human will see it. Skip it when the caller needs an answer inside the request, or when a cheap, idempotent Storage queue message would do the job.
