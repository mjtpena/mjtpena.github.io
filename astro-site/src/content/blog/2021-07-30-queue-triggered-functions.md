---
title: Building Reliable Queue-Triggered Azure Functions
author: Michael John Peña
draft: false
date: 2021-07-30
url: /blog/queue-triggered-functions/
tags:
  - Azure
  - Serverless
  - Azure Functions
  - Queues
  - Messaging
---

Queue-triggered Azure Functions are the pattern I recommend most often for decoupling work that doesn't need to happen synchronously. The model is simple and reliable: a message arrives in a Storage Queue or Service Bus queue, the Functions runtime picks it up, invokes the function, and removes the message on successful completion. Failed executions put the message back in the queue for retry (up to a configurable maximum), then move it to the dead-letter queue for investigation. The scale-out behaviour is automatic—the runtime adds function instances based on queue depth, with no configuration required beyond the trigger binding. The choice between Storage Queue and Service Bus: Storage Queue for high-volume simple scenarios (cheap, 64KB message limit, at-least-once delivery); Service Bus for ordered messages, sessions, larger payloads, or dead-letter queue semantics you need to control precisely.

# Storage Queue Trigger

Basic queue-triggered function:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class QueueFunctions
{
    private readonly ILogger<QueueFunctions> _logger;
    private readonly IOrderService _orderService;

    public QueueFunctions(
        ILogger<QueueFunctions> logger,
        IOrderService orderService)
    {
        _logger = logger;
        _orderService = orderService;
    }

    [Function("ProcessOrder")]
    public async Task ProcessOrder(
        [QueueTrigger("orders", Connection = "StorageConnection")] OrderMessage message)
    {
        _logger.LogInformation("Processing order {OrderId}", message.OrderId);

        try
        {
            var order = await _orderService.GetOrderAsync(message.OrderId);

            if (order == null)
            {
                _logger.LogWarning("Order {OrderId} not found", message.OrderId);
                return;
            }

            await _orderService.ProcessAsync(order);

            _logger.LogInformation("Order {OrderId} processed successfully", message.OrderId);
        }
        catch (TransientException ex)
        {
            _logger.LogWarning(ex, "Transient error processing order {OrderId}", message.OrderId);
            throw; // Retry
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process order {OrderId}", message.OrderId);
            throw; // Will go to poison queue after max retries
        }
    }
}

public class OrderMessage
{
    public string OrderId { get; set; }
    public string CustomerId { get; set; }
    public DateTime CreatedAt { get; set; }
    public string Priority { get; set; }
}
```

# Service Bus Queue Trigger

Using Service Bus for advanced scenarios:

```csharp
using Azure.Messaging.ServiceBus;

public class ServiceBusFunctions
{
    private readonly ILogger<ServiceBusFunctions> _logger;
    private readonly IPaymentProcessor _paymentProcessor;

    public ServiceBusFunctions(
        ILogger<ServiceBusFunctions> logger,
        IPaymentProcessor paymentProcessor)
    {
        _logger = logger;
        _paymentProcessor = paymentProcessor;
    }

    [Function("ProcessPayment")]
    public async Task ProcessPayment(
        [ServiceBusTrigger("payments", Connection = "ServiceBusConnection")]
        ServiceBusReceivedMessage message,
        ServiceBusMessageActions messageActions)
    {
        var payment = message.Body.ToObjectFromJson<PaymentMessage>();

        _logger.LogInformation(
            "Processing payment {PaymentId}, attempt {DeliveryCount}",
            payment.PaymentId,
            message.DeliveryCount);

        try
        {
            var result = await _paymentProcessor.ProcessAsync(payment);

            if (result.Success)
            {
                await messageActions.CompleteMessageAsync(message);
                _logger.LogInformation("Payment {PaymentId} completed", payment.PaymentId);
            }
            else if (result.ShouldRetry)
            {
                // Schedule for retry with delay
                await messageActions.AbandonMessageAsync(message, new Dictionary<string, object>
                {
                    ["RetryReason"] = result.ErrorMessage
                });
            }
            else
            {
                // Dead letter for manual investigation
                await messageActions.DeadLetterMessageAsync(message,
                    deadLetterReason: "ProcessingFailed",
                    deadLetterErrorDescription: result.ErrorMessage);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing payment {PaymentId}", payment.PaymentId);

            if (message.DeliveryCount >= 5)
            {
                await messageActions.DeadLetterMessageAsync(message,
                    deadLetterReason: "MaxRetriesExceeded",
                    deadLetterErrorDescription: ex.Message);
            }
            else
            {
                throw; // Let Service Bus handle retry
            }
        }
    }

    // Process dead letter queue
    [Function("ProcessDeadLetterPayments")]
    public async Task ProcessDeadLetterPayments(
        [ServiceBusTrigger("payments/$DeadLetterQueue", Connection = "ServiceBusConnection")]
        ServiceBusReceivedMessage message,
        ServiceBusMessageActions messageActions)
    {
        var payment = message.Body.ToObjectFromJson<PaymentMessage>();

        _logger.LogWarning(
            "Processing dead letter payment {PaymentId}, reason: {Reason}",
            payment.PaymentId,
            message.DeadLetterReason);

        // Log for investigation
        await LogDeadLetterAsync(payment, message);

        // Notify support team
        await NotifySupportAsync(payment, message);

        // Complete to remove from dead letter queue
        await messageActions.CompleteMessageAsync(message);
    }
}
```

# Batch Processing

Process multiple messages in batches:

```csharp
public class BatchProcessingFunctions
{
    [Function("ProcessOrderBatch")]
    public async Task ProcessOrderBatch(
        [QueueTrigger("orders-batch", Connection = "StorageConnection")]
        QueueMessage[] messages,
        FunctionContext context)
    {
        var logger = context.GetLogger<BatchProcessingFunctions>();

        logger.LogInformation("Processing batch of {Count} orders", messages.Length);

        var tasks = messages.Select(async message =>
        {
            try
            {
                var order = JsonSerializer.Deserialize<OrderMessage>(message.MessageText);
                await ProcessSingleOrderAsync(order);
                return (Order: order, Success: true, Error: null as Exception);
            }
            catch (Exception ex)
            {
                return (Order: null, Success: false, Error: ex);
            }
        });

        var results = await Task.WhenAll(tasks);

        var succeeded = results.Count(r => r.Success);
        var failed = results.Count(r => !r.Success);

        logger.LogInformation(
            "Batch complete: {Succeeded} succeeded, {Failed} failed",
            succeeded, failed);

        // Handle failures
        foreach (var failure in results.Where(r => !r.Success))
        {
            logger.LogError(failure.Error, "Failed to process order in batch");
        }
    }
}

// host.json configuration for batching
{
    "version": "2.0",
    "extensions": {
        "queues": {
            "batchSize": 16,
            "newBatchThreshold": 8,
            "maxPollingInterval": "00:00:02",
            "visibilityTimeout": "00:05:00",
            "maxDequeueCount": 5
        }
    }
}
```

# Poison Message Handling

Handle messages that repeatedly fail:

```csharp
public class PoisonMessageHandler
{
    private readonly ILogger<PoisonMessageHandler> _logger;
    private readonly IAlertService _alertService;
    private readonly TableClient _poisonLogTable;

    [Function("ProcessPoisonOrders")]
    public async Task ProcessPoisonOrders(
        [QueueTrigger("orders-poison", Connection = "StorageConnection")]
        QueueMessage message,
        FunctionContext context)
    {
        _logger.LogWarning("Processing poison message: {MessageId}", message.MessageId);

        // Parse the original message
        OrderMessage order;
        try
        {
            order = JsonSerializer.Deserialize<OrderMessage>(message.MessageText);
        }
        catch (JsonException)
        {
            _logger.LogError("Could not deserialize poison message");
            order = null;
        }

        // Log to table storage for investigation
        await _poisonLogTable.AddEntityAsync(new PoisonMessageLog
        {
            PartitionKey = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            RowKey = message.MessageId,
            QueueName = "orders",
            MessageContent = message.MessageText,
            InsertedTime = message.InsertedOn,
            DequeueCount = message.DequeueCount,
            OrderId = order?.OrderId
        });

        // Send alert
        await _alertService.SendAlertAsync(new Alert
        {
            Severity = AlertSeverity.High,
            Title = "Poison Message in Orders Queue",
            Description = $"Order {order?.OrderId ?? "unknown"} failed after max retries",
            Metadata = new Dictionary<string, string>
            {
                ["MessageId"] = message.MessageId,
                ["DequeueCount"] = message.DequeueCount.ToString()
            }
        });

        // Optionally attempt manual recovery
        if (order != null)
        {
            try
            {
                await AttemptManualRecoveryAsync(order);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Manual recovery failed for order {OrderId}", order.OrderId);
            }
        }
    }
}
```

# Scaling Configuration

Configure function scaling for queues:

```json
// host.json
{
    "version": "2.0",
    "extensions": {
        "queues": {
            "maxPollingInterval": "00:00:02",
            "visibilityTimeout": "00:05:00",
            "batchSize": 16,
            "maxDequeueCount": 5,
            "newBatchThreshold": 8,
            "messageEncoding": "base64"
        },
        "serviceBus": {
            "prefetchCount": 100,
            "messageHandlerOptions": {
                "autoComplete": false,
                "maxConcurrentCalls": 16,
                "maxAutoRenewDuration": "00:25:00"
            },
            "sessionHandlerOptions": {
                "autoComplete": false,
                "messageWaitTimeout": "00:00:30",
                "maxConcurrentSessions": 16,
                "maxConcurrentCallsPerSession": 1
            },
            "batchOptions": {
                "maxMessageCount": 100,
                "operationTimeout": "00:01:00",
                "autoComplete": false
            }
        }
    },
    "functionTimeout": "00:10:00"
}
```

# Output Bindings

Chain queue processing with output bindings:

```csharp
public class ChainedProcessing
{
    [Function("ValidateOrder")]
    [QueueOutput("validated-orders", Connection = "StorageConnection")]
    public async Task<ValidatedOrder> ValidateOrder(
        [QueueTrigger("new-orders", Connection = "StorageConnection")]
        OrderMessage order,
        FunctionContext context)
    {
        var logger = context.GetLogger<ChainedProcessing>();

        logger.LogInformation("Validating order {OrderId}", order.OrderId);

        // Validate the order
        var validationResult = await ValidateAsync(order);

        if (!validationResult.IsValid)
        {
            logger.LogWarning("Order {OrderId} failed validation: {Errors}",
                order.OrderId, string.Join(", ", validationResult.Errors));

            // Output to error queue instead
            return null;
        }

        // Return validated order to output queue
        return new ValidatedOrder
        {
            OrderId = order.OrderId,
            CustomerId = order.CustomerId,
            ValidatedAt = DateTime.UtcNow,
            ValidationScore = validationResult.Score
        };
    }

    [Function("ProcessValidatedOrder")]
    [QueueOutput("completed-orders", Connection = "StorageConnection")]
    public async Task<CompletedOrder> ProcessValidatedOrder(
        [QueueTrigger("validated-orders", Connection = "StorageConnection")]
        ValidatedOrder order,
        FunctionContext context)
    {
        var logger = context.GetLogger<ChainedProcessing>();

        logger.LogInformation("Processing validated order {OrderId}", order.OrderId);

        // Process the order
        var result = await ProcessAsync(order);

        return new CompletedOrder
        {
            OrderId = order.OrderId,
            ProcessedAt = DateTime.UtcNow,
            ConfirmationNumber = result.ConfirmationNumber
        };
    }
}
```

# Monitoring Queue Functions

Monitor queue depth and processing:

```python
from azure.storage.queue import QueueServiceClient
from azure.mgmt.monitor import MonitorManagementClient

def monitor_queue_health(storage_connection, queue_name):
    """Monitor queue depth and alert if too high."""

    queue_service = QueueServiceClient.from_connection_string(storage_connection)
    queue_client = queue_service.get_queue_client(queue_name)

    properties = queue_client.get_queue_properties()
    message_count = properties.approximate_message_count

    print(f"Queue {queue_name}: {message_count} messages")

    # Alert if queue is backing up
    if message_count > 1000:
        send_alert(f"Queue {queue_name} has {message_count} messages")

    return message_count

def get_function_metrics(function_app_name, function_name):
    """Get execution metrics for a queue function."""

    monitor_client = MonitorManagementClient(credential, subscription_id)

    resource_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-functions/providers/Microsoft.Web/sites/{function_app_name}"

    metrics = monitor_client.metrics.list(
        resource_uri=resource_id,
        metricnames="FunctionExecutionCount,FunctionExecutionUnits",
        timespan="PT1H",
        interval="PT5M",
        aggregation="Total,Average"
    )

    for metric in metrics.value:
        print(f"{metric.name.value}:")
        for ts in metric.timeseries:
            for data in ts.data[-5:]:
                print(f"  {data.time_stamp}: {data.total or data.average}")
```

# Conclusion

Queue-triggered Azure Functions provide a reliable foundation for asynchronous processing. By properly handling retries, poison messages, and scaling, you can build systems that gracefully handle failures and variable loads.

Key practices include implementing idempotent processing, using appropriate visibility timeouts, monitoring queue depth, and having a strategy for poison messages. Whether using Storage Queues for simple scenarios or Service Bus for advanced features like sessions and dead lettering, queue triggers enable scalable, resilient architectures.
