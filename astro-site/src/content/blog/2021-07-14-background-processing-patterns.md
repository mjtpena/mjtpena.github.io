---
title: Background Processing Patterns in Azure
author: Michael John Peña
draft: false
date: 2021-07-14
url: /blog/background-processing-patterns/
tags:
  - Azure
  - Architecture
  - Patterns
  - Messaging
  - Cloud

---

I wrote "2021-07-14-background-processing-patterns" to share practical, production-minded guidance on this topic.

# Queue-Based Load Leveling

Use queues to handle variable load:

```csharp
// Producer - Web API
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly QueueClient _queueClient;

    public OrdersController(QueueClient queueClient)
    {
        _queueClient = queueClient;
    }

    [HttpPost]
    public async Task<IActionResult> CreateOrder([FromBody] OrderRequest request)
    {
        // Validate request immediately
        if (!ModelState.IsValid)
            return BadRequest(ModelState);

        // Create order record with "Pending" status
        var order = new Order
        {
            Id = Guid.NewGuid().ToString(),
            CustomerId = request.CustomerId,
            Items = request.Items,
            Status = OrderStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        await _orderRepository.SaveAsync(order);

        // Queue for background processing
        var message = new OrderProcessingMessage
        {
            OrderId = order.Id,
            Priority = request.Priority,
            RequestedAt = DateTime.UtcNow
        };

        await _queueClient.SendMessageAsync(
            JsonSerializer.Serialize(message),
            timeToLive: TimeSpan.FromHours(24));

        // Return immediately with order ID
        return Accepted(new { OrderId = order.Id, Status = "Pending" });
    }
}

// Consumer - Azure Function
public class OrderProcessor
{
    [Function("ProcessOrder")]
    public async Task ProcessOrder(
        [QueueTrigger("orders", Connection = "StorageConnection")]
        OrderProcessingMessage message,
        FunctionContext context)
    {
        var logger = context.GetLogger<OrderProcessor>();
        logger.LogInformation("Processing order {OrderId}", message.OrderId);

        // Long-running processing
        var order = await _orderRepository.GetAsync(message.OrderId);

        // Process payment
        var paymentResult = await _paymentService.ProcessAsync(order);

        // Update inventory
        await _inventoryService.ReserveAsync(order.Items);

        // Send notifications
        await _notificationService.SendOrderConfirmationAsync(order);

        // Update order status
        order.Status = OrderStatus.Confirmed;
        await _orderRepository.SaveAsync(order);
    }
}
```

# Competing Consumers Pattern

Scale processing with multiple consumers:

```csharp
// Azure Function with parallel processing
public class ParallelProcessor
{
    [Function("ProcessMessages")]
    public async Task ProcessMessages(
        [QueueTrigger("work-items", Connection = "StorageConnection")]
        QueueMessage[] messages,
        FunctionContext context)
    {
        var logger = context.GetLogger<ParallelProcessor>();
        logger.LogInformation("Processing batch of {Count} messages", messages.Length);

        // Process in parallel
        var tasks = messages.Select(async message =>
        {
            try
            {
                var workItem = JsonSerializer.Deserialize<WorkItem>(message.MessageText);
                await ProcessWorkItemAsync(workItem);
                return (Success: true, MessageId: message.MessageId);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to process message {MessageId}", message.MessageId);
                return (Success: false, MessageId: message.MessageId);
            }
        });

        var results = await Task.WhenAll(tasks);

        var succeeded = results.Count(r => r.Success);
        logger.LogInformation("Batch complete: {Succeeded}/{Total} succeeded",
            succeeded, messages.Length);
    }
}

// host.json for scaling configuration
{
    "version": "2.0",
    "extensions": {
        "queues": {
            "batchSize": 16,
            "maxDequeueCount": 5,
            "newBatchThreshold": 8
        }
    }
}
```

# Priority Queue Pattern

Process high-priority items first:

```csharp
public class PriorityQueueProcessor
{
    private readonly QueueClient _highPriorityQueue;
    private readonly QueueClient _normalPriorityQueue;
    private readonly QueueClient _lowPriorityQueue;

    // Separate functions for different priorities
    [Function("ProcessHighPriority")]
    public async Task ProcessHighPriority(
        [QueueTrigger("tasks-high", Connection = "StorageConnection")]
        TaskMessage message)
    {
        await ProcessTaskAsync(message, Priority.High);
    }

    [Function("ProcessNormalPriority")]
    public async Task ProcessNormalPriority(
        [QueueTrigger("tasks-normal", Connection = "StorageConnection")]
        TaskMessage message)
    {
        await ProcessTaskAsync(message, Priority.Normal);
    }

    [Function("ProcessLowPriority")]
    public async Task ProcessLowPriority(
        [QueueTrigger("tasks-low", Connection = "StorageConnection")]
        TaskMessage message)
    {
        await ProcessTaskAsync(message, Priority.Low);
    }

    // Producer routes to appropriate queue
    public async Task EnqueueTaskAsync(TaskRequest request)
    {
        var message = new TaskMessage
        {
            TaskId = Guid.NewGuid().ToString(),
            Payload = request.Payload,
            Priority = request.Priority,
            CreatedAt = DateTime.UtcNow
        };

        var serialized = JsonSerializer.Serialize(message);

        var queue = request.Priority switch
        {
            Priority.High => _highPriorityQueue,
            Priority.Low => _lowPriorityQueue,
            _ => _normalPriorityQueue
        };

        await queue.SendMessageAsync(serialized);
    }
}
```

# Saga Pattern for Distributed Transactions

Coordinate long-running business processes:

```csharp
// Using Durable Functions for saga orchestration
public class OrderSaga
{
    [Function("OrderSagaOrchestrator")]
    public async Task<OrderResult> RunOrchestrator(
        [OrchestrationTrigger] TaskOrchestrationContext context)
    {
        var order = context.GetInput<Order>();
        var result = new OrderResult { OrderId = order.Id };

        try
        {
            // Step 1: Reserve inventory
            var inventoryReserved = await context.CallActivityAsync<bool>(
                "ReserveInventory", order);

            if (!inventoryReserved)
            {
                result.Status = OrderStatus.Failed;
                result.Reason = "Insufficient inventory";
                return result;
            }

            // Step 2: Process payment
            var paymentResult = await context.CallActivityAsync<PaymentResult>(
                "ProcessPayment", order);

            if (!paymentResult.Success)
            {
                // Compensate: Release inventory
                await context.CallActivityAsync("ReleaseInventory", order);

                result.Status = OrderStatus.Failed;
                result.Reason = paymentResult.Error;
                return result;
            }

            // Step 3: Ship order
            var shipmentResult = await context.CallActivityAsync<ShipmentResult>(
                "CreateShipment", order);

            if (!shipmentResult.Success)
            {
                // Compensate: Refund and release inventory
                await context.CallActivityAsync("RefundPayment", paymentResult.TransactionId);
                await context.CallActivityAsync("ReleaseInventory", order);

                result.Status = OrderStatus.Failed;
                result.Reason = "Shipment failed";
                return result;
            }

            // Step 4: Send confirmation
            await context.CallActivityAsync("SendConfirmation", order);

            result.Status = OrderStatus.Completed;
            result.TrackingNumber = shipmentResult.TrackingNumber;
            return result;
        }
        catch (Exception ex)
        {
            // Handle unexpected failures with compensation
            await CompensateAsync(context, order, result);
            throw;
        }
    }

    [Function("ReserveInventory")]
    public async Task<bool> ReserveInventory(
        [ActivityTrigger] Order order)
    {
        return await _inventoryService.ReserveAsync(order.Items);
    }

    [Function("ProcessPayment")]
    public async Task<PaymentResult> ProcessPayment(
        [ActivityTrigger] Order order)
    {
        return await _paymentService.ChargeAsync(order);
    }

    [Function("CreateShipment")]
    public async Task<ShipmentResult> CreateShipment(
        [ActivityTrigger] Order order)
    {
        return await _shippingService.CreateShipmentAsync(order);
    }
}
```

# Event-Driven Processing

React to events asynchronously:

```csharp
public class EventDrivenProcessor
{
    // Process events from Event Grid
    [Function("ProcessEvent")]
    public async Task ProcessEvent(
        [EventGridTrigger] EventGridEvent eventGridEvent,
        FunctionContext context)
    {
        var logger = context.GetLogger<EventDrivenProcessor>();

        logger.LogInformation(
            "Processing event {EventType} for subject {Subject}",
            eventGridEvent.EventType,
            eventGridEvent.Subject);

        switch (eventGridEvent.EventType)
        {
            case "Microsoft.Storage.BlobCreated":
                await HandleBlobCreatedAsync(eventGridEvent);
                break;

            case "Contoso.Orders.OrderCreated":
                await HandleOrderCreatedAsync(eventGridEvent);
                break;

            case "Contoso.Users.UserRegistered":
                await HandleUserRegisteredAsync(eventGridEvent);
                break;

            default:
                logger.LogWarning("Unknown event type: {EventType}", eventGridEvent.EventType);
                break;
        }
    }

    private async Task HandleOrderCreatedAsync(EventGridEvent evt)
    {
        var orderData = evt.Data.ToObjectFromJson<OrderCreatedEvent>();

        // Trigger downstream processes
        await _analyticsService.TrackOrderAsync(orderData);
        await _notificationService.SendOrderNotificationAsync(orderData);
        await _inventoryService.UpdateAsync(orderData);
    }
}
```

# Scheduled Background Processing

Run tasks on a schedule:

```csharp
public class ScheduledProcessing
{
    // Daily report generation
    [Function("DailyReportGeneration")]
    public async Task DailyReportGeneration(
        [TimerTrigger("0 0 6 * * *")] TimerInfo timer,
        FunctionContext context)
    {
        var logger = context.GetLogger<ScheduledProcessing>();
        logger.LogInformation("Starting daily report generation");

        var reportDate = DateTime.UtcNow.AddDays(-1).Date;

        // Generate various reports in parallel
        var tasks = new[]
        {
            GenerateSalesReportAsync(reportDate),
            GenerateInventoryReportAsync(reportDate),
            GenerateUserActivityReportAsync(reportDate)
        };

        await Task.WhenAll(tasks);

        // Send consolidated report
        await _emailService.SendDailyReportAsync(reportDate);

        logger.LogInformation("Daily report generation complete");
    }

    // Hourly data synchronization
    [Function("HourlyDataSync")]
    public async Task HourlyDataSync(
        [TimerTrigger("0 5 * * * *")] TimerInfo timer,
        FunctionContext context)
    {
        var logger = context.GetLogger<ScheduledProcessing>();

        // Sync data from external systems
        await SyncCustomerDataAsync();
        await SyncProductCatalogAsync();
        await SyncPricingDataAsync();
    }
}
```

# Circuit Breaker Pattern

Protect against cascading failures:

```csharp
public class ResilientProcessor
{
    private static readonly AsyncCircuitBreakerPolicy _circuitBreaker =
        Policy.Handle<HttpRequestException>()
              .Or<TimeoutException>()
              .CircuitBreakerAsync(
                  exceptionsAllowedBeforeBreaking: 5,
                  durationOfBreak: TimeSpan.FromMinutes(1),
                  onBreak: (ex, duration) =>
                  {
                      // Log circuit opened
                  },
                  onReset: () =>
                  {
                      // Log circuit closed
                  });

    [Function("ProcessWithCircuitBreaker")]
    public async Task ProcessWithCircuitBreaker(
        [QueueTrigger("external-calls")] ExternalCallRequest request)
    {
        try
        {
            await _circuitBreaker.ExecuteAsync(async () =>
            {
                await _externalService.CallAsync(request);
            });
        }
        catch (BrokenCircuitException)
        {
            // Circuit is open, handle gracefully
            await _fallbackService.HandleAsync(request);
        }
    }
}
```

# Conclusion

Background processing patterns are essential for building scalable, resilient applications. Azure provides multiple services including Storage Queues, Service Bus, Event Grid, and Azure Functions that enable implementing these patterns effectively.

Choose the right pattern based on your requirements: queue-based load leveling for variable loads, competing consumers for parallel processing, sagas for distributed transactions, and event-driven processing for reactive architectures. Combined with proper error handling and monitoring, these patterns help build robust cloud applications.

