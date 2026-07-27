---
title: "Building Resilient Microservices with Azure Service Bus"
author: Michael John Peña
draft: false
date: 2025-12-16
tags:
  - Microservices
  - Azure
  - Service-Bus
  - Messaging
  - Architecture
---

Reliable messaging is the backbone of microservices architecture. Azure Service Bus provides enterprise-grade messaging, but using it effectively requires understanding its patterns. Here's what I've learned building production systems in 2025.

## Core Patterns

### 1. Competing Consumers

Multiple instances process messages from the same queue:

```csharp
using Azure.Messaging.ServiceBus;

public class OrderProcessor : BackgroundService
{
    private readonly ServiceBusClient _client;
    private ServiceBusProcessor _processor;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _processor = _client.CreateProcessor("orders-queue", new ServiceBusProcessorOptions
        {
            MaxConcurrentCalls = 10,
            AutoCompleteMessages = false,
            PrefetchCount = 20
        });

        _processor.ProcessMessageAsync += ProcessOrderAsync;
        _processor.ProcessErrorAsync += HandleErrorAsync;

        await _processor.StartProcessingAsync(stoppingToken);
    }

    private async Task ProcessOrderAsync(ProcessMessageEventArgs args)
    {
        var order = args.Message.Body.ToObjectFromJson<Order>();

        try
        {
            await ProcessOrder(order);
            await args.CompleteMessageAsync(args.Message);
        }
        catch (TransientException)
        {
            // Will be retried automatically
            await args.AbandonMessageAsync(args.Message);
        }
        catch (PermanentException ex)
        {
            // Move to dead letter queue
            await args.DeadLetterMessageAsync(args.Message,
                deadLetterReason: "ProcessingFailed",
                deadLetterErrorDescription: ex.Message);
        }
    }
}
```

### 2. Publish-Subscribe with Topics

```csharp
public class EventPublisher
{
    private readonly ServiceBusSender _sender;

    public async Task PublishOrderCreatedAsync(Order order)
    {
        var message = new ServiceBusMessage(BinaryData.FromObjectAsJson(order))
        {
            Subject = "OrderCreated",
            ContentType = "application/json",
            MessageId = order.OrderId,
            CorrelationId = order.CustomerId,
            ApplicationProperties =
            {
                ["OrderType"] = order.Type,
                ["Region"] = order.Region,
                ["Priority"] = order.Priority
            }
        };

        await _sender.SendMessageAsync(message);
    }
}
```

Subscribers filter with SQL rules:

```csharp
await adminClient.CreateSubscriptionAsync(
    new CreateSubscriptionOptions("orders-topic", "high-priority-processor"),
    new CreateRuleOptions("HighPriorityFilter", new SqlRuleFilter("Priority = 'High'"))
);
```

### 3. Request-Reply Pattern

```csharp
public class RequestReplyClient
{
    private readonly ServiceBusSender _requestSender;
    private readonly ServiceBusReceiver _replyReceiver;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<ServiceBusReceivedMessage>> _pending;

    public async Task<TResponse> SendRequestAsync<TRequest, TResponse>(
        TRequest request,
        TimeSpan timeout)
    {
        var correlationId = Guid.NewGuid().ToString();
        var tcs = new TaskCompletionSource<ServiceBusReceivedMessage>();
        _pending[correlationId] = tcs;

        var message = new ServiceBusMessage(BinaryData.FromObjectAsJson(request))
        {
            CorrelationId = correlationId,
            ReplyTo = "reply-queue",
            TimeToLive = timeout
        };

        await _requestSender.SendMessageAsync(message);

        using var cts = new CancellationTokenSource(timeout);
        cts.Token.Register(() => tcs.TrySetCanceled());

        var reply = await tcs.Task;
        return reply.Body.ToObjectFromJson<TResponse>();
    }
}
```

## Best Practices

1. **Always use sessions for ordered processing**
2. **Implement idempotent handlers** - messages may be delivered multiple times
3. **Monitor dead letter queues** - they indicate processing failures
4. **Use message deferral** for complex workflows
5. **Set appropriate TTL** to prevent queue bloat

## Monitoring Query

```kql
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.SERVICEBUS"
| summarize
    DeadLetteredMessages = countif(status_s == "DeadLettered"),
    CompletedMessages = countif(status_s == "Completed"),
    AbandonedMessages = countif(status_s == "Abandoned")
by bin(TimeGenerated, 1h), EntityName_s
| render timechart
```

Service Bus is reliable when used correctly. Invest time in understanding these patterns before building your microservices.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
