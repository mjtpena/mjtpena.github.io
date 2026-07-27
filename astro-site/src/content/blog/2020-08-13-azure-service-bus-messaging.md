---
title: "Building Reliable Messaging with Azure Service Bus"
author: Michael John Peña
draft: false
date: 2020-08-13
tags:
  - Azure
  - Service Bus
  - Messaging
  - Microservices
---

Two services that worked perfectly in isolation, plus an HTTP call between them, equals a system that occasionally drops orders. Every consultant has been called in to debug that exact pattern. The fix is rarely "make HTTP more reliable" — it's "stop using HTTP for the bits that need to survive a restart." Service Bus is the boring, reliable answer. Queues for one-to-one work, topics for fan-out, dead-letter queues for the inevitable poison messages. A working setup with the patterns I actually use in production.

## Creating Service Bus Resources

```bash
# Create a Service Bus namespace
az servicebus namespace create \
    --resource-group rg-messaging \
    --name sb-myapp-2020 \
    --location australiaeast \
    --sku Standard

# Create a queue
az servicebus queue create \
    --resource-group rg-messaging \
    --namespace-name sb-myapp-2020 \
    --name orders-queue \
    --max-size 1024

# Create a topic with subscription
az servicebus topic create \
    --resource-group rg-messaging \
    --namespace-name sb-myapp-2020 \
    --name events-topic

az servicebus topic subscription create \
    --resource-group rg-messaging \
    --namespace-name sb-myapp-2020 \
    --topic-name events-topic \
    --name email-subscription
```

## .NET SDK Setup

```bash
dotnet add package Azure.Messaging.ServiceBus
```

## Sending Messages

```csharp
using Azure.Messaging.ServiceBus;

public class OrderPublisher
{
    private readonly ServiceBusClient _client;
    private readonly ServiceBusSender _sender;

    public OrderPublisher(string connectionString)
    {
        _client = new ServiceBusClient(connectionString);
        _sender = _client.CreateSender("orders-queue");
    }

    public async Task SendOrderAsync(Order order)
    {
        var body = JsonSerializer.Serialize(order);
        var message = new ServiceBusMessage(body)
        {
            ContentType = "application/json",
            MessageId = order.Id.ToString(),
            Subject = "NewOrder",
            ApplicationProperties =
            {
                { "OrderType", order.Type },
                { "Priority", order.Priority }
            }
        };

        await _sender.SendMessageAsync(message);
    }

    public async Task SendBatchAsync(IEnumerable<Order> orders)
    {
        using var batch = await _sender.CreateMessageBatchAsync();

        foreach (var order in orders)
        {
            var body = JsonSerializer.Serialize(order);
            var message = new ServiceBusMessage(body);

            if (!batch.TryAddMessage(message))
            {
                // Batch is full, send it and create a new one
                await _sender.SendMessagesAsync(batch);
                batch = await _sender.CreateMessageBatchAsync();
                batch.TryAddMessage(message);
            }
        }

        if (batch.Count > 0)
        {
            await _sender.SendMessagesAsync(batch);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _sender.DisposeAsync();
        await _client.DisposeAsync();
    }
}
```

## Receiving Messages

```csharp
public class OrderProcessor
{
    private readonly ServiceBusClient _client;
    private readonly ServiceBusProcessor _processor;

    public OrderProcessor(string connectionString)
    {
        _client = new ServiceBusClient(connectionString);

        _processor = _client.CreateProcessor("orders-queue", new ServiceBusProcessorOptions
        {
            MaxConcurrentCalls = 10,
            AutoCompleteMessages = false,
            PrefetchCount = 20
        });

        _processor.ProcessMessageAsync += ProcessMessageAsync;
        _processor.ProcessErrorAsync += ProcessErrorAsync;
    }

    public async Task StartAsync()
    {
        await _processor.StartProcessingAsync();
    }

    public async Task StopAsync()
    {
        await _processor.StopProcessingAsync();
    }

    private async Task ProcessMessageAsync(ProcessMessageEventArgs args)
    {
        var body = args.Message.Body.ToString();
        var order = JsonSerializer.Deserialize<Order>(body);

        try
        {
            await ProcessOrderAsync(order);

            // Complete the message
            await args.CompleteMessageAsync(args.Message);
        }
        catch (Exception ex)
        {
            // Log the error
            Console.WriteLine($"Error processing order {order.Id}: {ex.Message}");

            // Abandon to retry later or dead-letter if max retries exceeded
            await args.AbandonMessageAsync(args.Message);
        }
    }

    private Task ProcessErrorAsync(ProcessErrorEventArgs args)
    {
        Console.WriteLine($"Error: {args.Exception.Message}");
        return Task.CompletedTask;
    }

    private async Task ProcessOrderAsync(Order order)
    {
        // Process the order
        await Task.Delay(100); // Simulate work
    }
}
```

## Publish-Subscribe with Topics

```csharp
public class EventPublisher
{
    private readonly ServiceBusSender _sender;

    public EventPublisher(ServiceBusClient client)
    {
        _sender = client.CreateSender("events-topic");
    }

    public async Task PublishEventAsync<T>(T eventData, string eventType)
    {
        var body = JsonSerializer.Serialize(eventData);
        var message = new ServiceBusMessage(body)
        {
            Subject = eventType,
            ContentType = "application/json"
        };

        await _sender.SendMessageAsync(message);
    }
}

public class EventSubscriber
{
    private readonly ServiceBusProcessor _processor;

    public EventSubscriber(ServiceBusClient client, string subscriptionName)
    {
        _processor = client.CreateProcessor("events-topic", subscriptionName);
        _processor.ProcessMessageAsync += HandleMessageAsync;
        _processor.ProcessErrorAsync += HandleErrorAsync;
    }

    private async Task HandleMessageAsync(ProcessMessageEventArgs args)
    {
        var eventType = args.Message.Subject;
        var body = args.Message.Body.ToString();

        switch (eventType)
        {
            case "OrderCreated":
                await HandleOrderCreatedAsync(body);
                break;
            case "OrderShipped":
                await HandleOrderShippedAsync(body);
                break;
        }

        await args.CompleteMessageAsync(args.Message);
    }
}
```

## Message Filters

Create subscription filters:

```bash
# SQL filter
az servicebus topic subscription rule create \
    --resource-group rg-messaging \
    --namespace-name sb-myapp-2020 \
    --topic-name events-topic \
    --subscription-name priority-subscription \
    --name priority-filter \
    --filter-sql-expression "Priority = 'High'"

# Correlation filter
az servicebus topic subscription rule create \
    --resource-group rg-messaging \
    --namespace-name sb-myapp-2020 \
    --topic-name events-topic \
    --subscription-name region-subscription \
    --name region-filter \
    --correlation-filter subject=OrderCreated label=APAC
```

## Scheduled Messages

```csharp
public async Task ScheduleMessageAsync(Order order, DateTimeOffset scheduledTime)
{
    var body = JsonSerializer.Serialize(order);
    var message = new ServiceBusMessage(body)
    {
        ScheduledEnqueueTime = scheduledTime
    };

    var sequenceNumber = await _sender.ScheduleMessageAsync(message, scheduledTime);

    // Can cancel if needed
    // await _sender.CancelScheduledMessageAsync(sequenceNumber);
}
```

## Dead Letter Queue Processing

```csharp
public class DeadLetterProcessor
{
    private readonly ServiceBusReceiver _receiver;

    public DeadLetterProcessor(ServiceBusClient client)
    {
        _receiver = client.CreateReceiver("orders-queue",
            new ServiceBusReceiverOptions
            {
                SubQueue = SubQueue.DeadLetter
            });
    }

    public async Task ProcessDeadLettersAsync()
    {
        while (true)
        {
            var message = await _receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5));
            if (message == null) break;

            Console.WriteLine($"Dead letter: {message.MessageId}");
            Console.WriteLine($"Reason: {message.DeadLetterReason}");
            Console.WriteLine($"Description: {message.DeadLetterErrorDescription}");

            // Process or log the failed message
            await _receiver.CompleteMessageAsync(message);
        }
    }
}
```

Azure Service Bus provides the reliability and features needed for enterprise messaging scenarios.

The thing I drill into junior devs: dead-letter queues are not a failure mode, they're a feature. Inspect them. Alert on them. A growing DLQ is a quiet incident — the kind that's been broken for three weeks before anyone notices. Build a small admin page that surfaces DLQ message counts per subscription, and you'll catch integration bugs days before your customers do.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
