---
title: "Azure Service Bus Advanced Patterns: Sessions, Transactions, and Dead-lettering"
author: Michael John Peña
draft: false
date: 2021-01-12
tags:
  - Azure
  - Service Bus
  - Messaging
  - Integration
---

Service Bus is the message broker I most often pull off the shelf in 2021, and it's the advanced patterns—not the basic queue—that earn it the spot. Sessions when ordering matters within a business key. Transactions when "two messages must commit together or neither does" is a real requirement. Dead-letter queues you actually inspect rather than the ones nobody set up. Once you internalise those, Service Bus stops being "fancier Storage Queues" and starts being a real integration tool.

## Message Sessions

Sessions guarantee FIFO ordering for related messages.

```csharp
using Azure.Messaging.ServiceBus;

// Create session-enabled queue
// az servicebus queue create --name orders-queue --enable-sessions true

var client = new ServiceBusClient(connectionString);

// Send messages with session ID
var sender = client.CreateSender("orders-queue");

var messages = new[]
{
    new ServiceBusMessage("Order step 1") { SessionId = "order-123" },
    new ServiceBusMessage("Order step 2") { SessionId = "order-123" },
    new ServiceBusMessage("Order step 3") { SessionId = "order-123" }
};

await sender.SendMessagesAsync(messages);

// Receive session messages
var sessionReceiver = await client.AcceptNextSessionAsync("orders-queue");
Console.WriteLine($"Processing session: {sessionReceiver.SessionId}");

await foreach (var message in sessionReceiver.ReceiveMessagesAsync())
{
    Console.WriteLine($"Message: {message.Body}");
    await sessionReceiver.CompleteMessageAsync(message);
}
```

## Session State

```csharp
// Store session state
var state = new OrderState { Step = 2, LastUpdated = DateTime.UtcNow };
var stateBytes = JsonSerializer.SerializeToUtf8Bytes(state);
await sessionReceiver.SetSessionStateAsync(new BinaryData(stateBytes));

// Retrieve session state
var retrievedState = await sessionReceiver.GetSessionStateAsync();
if (retrievedState != null)
{
    var orderState = JsonSerializer.Deserialize<OrderState>(retrievedState);
    Console.WriteLine($"Resume from step: {orderState.Step}");
}
```

## Transactions

```csharp
using var client = new ServiceBusClient(connectionString);
var sender = client.CreateSender("orders-queue");
var receiver = client.CreateReceiver("incoming-queue");

// Receive message
var message = await receiver.ReceiveMessageAsync();

using (var ts = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled))
{
    // Complete received message
    await receiver.CompleteMessageAsync(message);

    // Send new message
    await sender.SendMessageAsync(new ServiceBusMessage("Processed order"));

    // Commit transaction
    ts.Complete();
}
```

## Cross-Entity Transactions

```csharp
// Send to multiple queues in single transaction
var client = new ServiceBusClient(connectionString);
var sender1 = client.CreateSender("queue1");
var sender2 = client.CreateSender("queue2");

using (var ts = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled))
{
    await sender1.SendMessageAsync(new ServiceBusMessage("Message 1"));
    await sender2.SendMessageAsync(new ServiceBusMessage("Message 2"));
    ts.Complete();
}
```

## Dead-Letter Queue

```csharp
// Messages go to DLQ after max delivery attempts or explicit dead-lettering

// Explicitly dead-letter a message
await receiver.DeadLetterMessageAsync(message,
    deadLetterReason: "ValidationFailed",
    deadLetterErrorDescription: "Order amount exceeds limit");

// Read from dead-letter queue
var dlqReceiver = client.CreateReceiver("orders-queue",
    new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter });

await foreach (var dlqMessage in dlqReceiver.ReceiveMessagesAsync())
{
    Console.WriteLine($"Dead letter reason: {dlqMessage.DeadLetterReason}");
    Console.WriteLine($"Error: {dlqMessage.DeadLetterErrorDescription}");
    Console.WriteLine($"Original body: {dlqMessage.Body}");

    // Reprocess or archive
    await dlqReceiver.CompleteMessageAsync(dlqMessage);
}
```

## Message Deferral

```csharp
// Defer message for later processing
var message = await receiver.ReceiveMessageAsync();

if (!ReadyToProcess(message))
{
    // Defer the message
    await receiver.DeferMessageAsync(message);
    Console.WriteLine($"Deferred message: {message.SequenceNumber}");
}

// Later: receive deferred message by sequence number
var deferredMessage = await receiver.ReceiveDeferredMessageAsync(sequenceNumber);
await receiver.CompleteMessageAsync(deferredMessage);
```

## Scheduled Messages

```csharp
// Schedule message for future delivery
var message = new ServiceBusMessage("Future order");
var scheduledTime = DateTimeOffset.UtcNow.AddHours(2);

var sequenceNumber = await sender.ScheduleMessageAsync(message, scheduledTime);
Console.WriteLine($"Scheduled message: {sequenceNumber}");

// Cancel scheduled message
await sender.CancelScheduledMessageAsync(sequenceNumber);
```

## Message Batching

```csharp
// Create batch with size limits
using var batch = await sender.CreateMessageBatchAsync();

foreach (var order in orders)
{
    var message = new ServiceBusMessage(JsonSerializer.Serialize(order));

    if (!batch.TryAddMessage(message))
    {
        // Batch is full, send it
        await sender.SendMessagesAsync(batch);

        // Create new batch
        batch = await sender.CreateMessageBatchAsync();
        batch.TryAddMessage(message);
    }
}

// Send remaining messages
if (batch.Count > 0)
{
    await sender.SendMessagesAsync(batch);
}
```

## Topic Subscriptions with Filters

```csharp
// SQL filter
az servicebus topic subscription rule create \
    --name high-value-orders \
    --topic-name orders \
    --subscription-name premium-processor \
    --filter-sql-expression "amount > 1000"

// Correlation filter
az servicebus topic subscription rule create \
    --name priority-orders \
    --topic-name orders \
    --subscription-name priority-processor \
    --correlation-filter label=priority
```

Service Bus: enterprise messaging patterns made simple.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
