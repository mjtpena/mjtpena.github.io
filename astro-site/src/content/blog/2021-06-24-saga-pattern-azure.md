---
title: Implementing the Saga Pattern with Azure Services
description: "The Saga pattern is how you handle distributed transactions—operations that span multiple microservices and need consistency guarantees—without two-phase…"
author: Michael John Peña
draft: false
date: 2021-06-24
url: /blog/saga-pattern-azure/
tags:
  - Azure
  - Saga Pattern
  - Distributed Transactions
  - Microservices
---

The Saga pattern is how you handle distributed transactions—operations that span multiple microservices and need consistency guarantees—without two-phase commit. Traditional distributed transactions don't scale, and the failures are ugly. Sagas break the operation into local transactions with compensating transactions for rollback. The two variants have different tradeoffs: orchestration (a central coordinator, naturally Durable Functions for Azure implementations) is easier to reason about and debug; choreography (services react to each other's events via Service Bus) is more loosely coupled but harder to trace when things go wrong. I default to orchestration for most implementations because the observability of a Durable Functions orchestration—the built-in instance history, the Azure Portal monitoring view—is worth the coupling trade-off.

## Saga Approaches

### Orchestration vs Choreography

```
Orchestration (Centralized):
┌─────────────────────────────────────────────────────────┐
│                    Saga Orchestrator                     │
│              (Azure Durable Functions)                   │
└────┬────────────┬────────────┬────────────┬─────────────┘
     │            │            │            │
     ▼            ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│ Order  │  │Inventory│  │Payment │  │Shipping│
│Service │  │ Service │  │Service │  │Service │
└────────┘  └────────┘  └────────┘  └────────┘

Choreography (Decentralized):
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
│ Order  │───►│Inventory│───►│Payment │───►│Shipping│
│Service │◄───│ Service │◄───│Service │◄───│Service │
└────────┘    └────────┘    └────────┘    └────────┘
                    │
              Azure Service Bus
```

## Orchestration with Durable Functions

### Saga Orchestrator

```csharp
public class OrderSagaOrchestrator
{
    [Function("OrderSaga")]
    public static async Task<SagaResult> RunOrchestrator(
        [OrchestrationTrigger] TaskOrchestrationContext context)
    {
        var input = context.GetInput<CreateOrderSagaInput>();
        var logger = context.CreateReplaySafeLogger<OrderSagaOrchestrator>();

        var sagaState = new SagaState();

        try
        {
            // Step 1: Create Order
            logger.LogInformation("Creating order...");
            var orderId = await context.CallActivityAsync<Guid>(
                "CreateOrder",
                input.OrderDetails);
            sagaState.OrderId = orderId;
            sagaState.Steps.Add(SagaStep.OrderCreated);

            // Step 2: Reserve Inventory
            logger.LogInformation("Reserving inventory...");
            var inventoryReservation = await context.CallActivityAsync<InventoryReservation>(
                "ReserveInventory",
                new ReserveInventoryInput(orderId, input.OrderDetails.Items));
            sagaState.InventoryReservationId = inventoryReservation.Id;
            sagaState.Steps.Add(SagaStep.InventoryReserved);

            // Step 3: Process Payment
            logger.LogInformation("Processing payment...");
            var paymentResult = await context.CallActivityAsync<PaymentResult>(
                "ProcessPayment",
                new ProcessPaymentInput(orderId, input.OrderDetails.TotalAmount, input.PaymentInfo));
            sagaState.PaymentTransactionId = paymentResult.TransactionId;
            sagaState.Steps.Add(SagaStep.PaymentProcessed);

            // Step 4: Confirm Order
            logger.LogInformation("Confirming order...");
            await context.CallActivityAsync(
                "ConfirmOrder",
                orderId);
            sagaState.Steps.Add(SagaStep.OrderConfirmed);

            // Step 5: Schedule Shipping
            logger.LogInformation("Scheduling shipping...");
            var shipmentId = await context.CallActivityAsync<Guid>(
                "ScheduleShipping",
                new ScheduleShippingInput(orderId, input.ShippingAddress));
            sagaState.ShipmentId = shipmentId;
            sagaState.Steps.Add(SagaStep.ShippingScheduled);

            return SagaResult.Success(sagaState);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Saga failed, starting compensation...");

            // Run compensating transactions
            await CompensateAsync(context, sagaState, logger);

            return SagaResult.Failed(sagaState, ex.Message);
        }
    }

    private static async Task CompensateAsync(
        TaskOrchestrationContext context,
        SagaState state,
        ILogger logger)
    {
        // Compensate in reverse order
        var steps = state.Steps.ToList();
        steps.Reverse();

        foreach (var step in steps)
        {
            try
            {
                switch (step)
                {
                    case SagaStep.ShippingScheduled:
                        logger.LogInformation("Cancelling shipment...");
                        await context.CallActivityAsync(
                            "CancelShipment",
                            state.ShipmentId);
                        break;

                    case SagaStep.OrderConfirmed:
                        logger.LogInformation("Reverting order confirmation...");
                        await context.CallActivityAsync(
                            "RevertOrderConfirmation",
                            state.OrderId);
                        break;

                    case SagaStep.PaymentProcessed:
                        logger.LogInformation("Refunding payment...");
                        await context.CallActivityAsync(
                            "RefundPayment",
                            state.PaymentTransactionId);
                        break;

                    case SagaStep.InventoryReserved:
                        logger.LogInformation("Releasing inventory...");
                        await context.CallActivityAsync(
                            "ReleaseInventory",
                            state.InventoryReservationId);
                        break;

                    case SagaStep.OrderCreated:
                        logger.LogInformation("Cancelling order...");
                        await context.CallActivityAsync(
                            "CancelOrder",
                            state.OrderId);
                        break;
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Compensation failed for step {Step}", step);
                // Log for manual intervention
            }
        }
    }
}
```

### Activity Functions

```csharp
public class SagaActivities
{
    private readonly IOrderService _orderService;
    private readonly IInventoryService _inventoryService;
    private readonly IPaymentService _paymentService;
    private readonly IShippingService _shippingService;

    [Function("CreateOrder")]
    public async Task<Guid> CreateOrder(
        [ActivityTrigger] OrderDetails orderDetails)
    {
        var order = await _orderService.CreateAsync(orderDetails);
        return order.Id;
    }

    [Function("ReserveInventory")]
    public async Task<InventoryReservation> ReserveInventory(
        [ActivityTrigger] ReserveInventoryInput input)
    {
        return await _inventoryService.ReserveAsync(input.OrderId, input.Items);
    }

    [Function("ReleaseInventory")]
    public async Task ReleaseInventory(
        [ActivityTrigger] Guid reservationId)
    {
        await _inventoryService.ReleaseReservationAsync(reservationId);
    }

    [Function("ProcessPayment")]
    public async Task<PaymentResult> ProcessPayment(
        [ActivityTrigger] ProcessPaymentInput input)
    {
        return await _paymentService.ProcessAsync(
            input.OrderId,
            input.Amount,
            input.PaymentInfo);
    }

    [Function("RefundPayment")]
    public async Task RefundPayment(
        [ActivityTrigger] string transactionId)
    {
        await _paymentService.RefundAsync(transactionId);
    }

    [Function("ConfirmOrder")]
    public async Task ConfirmOrder(
        [ActivityTrigger] Guid orderId)
    {
        await _orderService.ConfirmAsync(orderId);
    }

    [Function("CancelOrder")]
    public async Task CancelOrder(
        [ActivityTrigger] Guid orderId)
    {
        await _orderService.CancelAsync(orderId);
    }

    [Function("ScheduleShipping")]
    public async Task<Guid> ScheduleShipping(
        [ActivityTrigger] ScheduleShippingInput input)
    {
        return await _shippingService.ScheduleAsync(input.OrderId, input.Address);
    }

    [Function("CancelShipment")]
    public async Task CancelShipment(
        [ActivityTrigger] Guid shipmentId)
    {
        await _shippingService.CancelAsync(shipmentId);
    }
}
```

## Choreography with Service Bus

### Event-Driven Saga

```csharp
// Order Service - Starts the saga
public class OrderService
{
    private readonly IEventPublisher _eventPublisher;
    private readonly IOrderRepository _orderRepository;

    public async Task<Order> CreateOrderAsync(CreateOrderRequest request)
    {
        var order = Order.Create(request.CustomerId, request.Items);
        order.SetStatus(OrderStatus.Pending);

        await _orderRepository.SaveAsync(order);

        // Publish event to start saga
        await _eventPublisher.PublishAsync(new OrderCreatedEvent
        {
            OrderId = order.Id,
            CustomerId = order.CustomerId,
            Items = order.Items.Select(i => new OrderItemDto
            {
                ProductId = i.ProductId,
                Quantity = i.Quantity,
                UnitPrice = i.UnitPrice
            }).ToList(),
            TotalAmount = order.TotalAmount,
            CorrelationId = Guid.NewGuid().ToString()
        });

        return order;
    }
}

// Inventory Service - Handles order created event
public class InventoryEventHandler
{
    [Function("HandleOrderCreated")]
    public async Task HandleOrderCreated(
        [ServiceBusTrigger("order-events", "inventory-handler")]
        OrderCreatedEvent @event)
    {
        try
        {
            var reservation = await _inventoryService.ReserveAsync(
                @event.OrderId,
                @event.Items);

            await _eventPublisher.PublishAsync(new InventoryReservedEvent
            {
                OrderId = @event.OrderId,
                ReservationId = reservation.Id,
                CorrelationId = @event.CorrelationId
            });
        }
        catch (InsufficientInventoryException ex)
        {
            await _eventPublisher.PublishAsync(new InventoryReservationFailedEvent
            {
                OrderId = @event.OrderId,
                Reason = ex.Message,
                CorrelationId = @event.CorrelationId
            });
        }
    }

    [Function("HandlePaymentFailed")]
    public async Task HandlePaymentFailed(
        [ServiceBusTrigger("payment-events", "inventory-compensation")]
        PaymentFailedEvent @event)
    {
        // Compensating transaction
        await _inventoryService.ReleaseReservationAsync(@event.OrderId);

        await _eventPublisher.PublishAsync(new InventoryReleasedEvent
        {
            OrderId = @event.OrderId,
            CorrelationId = @event.CorrelationId
        });
    }
}

// Payment Service - Handles inventory reserved event
public class PaymentEventHandler
{
    [Function("HandleInventoryReserved")]
    public async Task HandleInventoryReserved(
        [ServiceBusTrigger("inventory-events", "payment-handler")]
        InventoryReservedEvent @event)
    {
        try
        {
            var order = await _orderService.GetByIdAsync(@event.OrderId);
            var result = await _paymentService.ProcessAsync(order);

            await _eventPublisher.PublishAsync(new PaymentProcessedEvent
            {
                OrderId = @event.OrderId,
                TransactionId = result.TransactionId,
                CorrelationId = @event.CorrelationId
            });
        }
        catch (PaymentFailedException ex)
        {
            await _eventPublisher.PublishAsync(new PaymentFailedEvent
            {
                OrderId = @event.OrderId,
                Reason = ex.Message,
                CorrelationId = @event.CorrelationId
            });
        }
    }
}

// Order Service - Final handler
public class OrderCompletionHandler
{
    [Function("HandlePaymentProcessed")]
    public async Task HandlePaymentProcessed(
        [ServiceBusTrigger("payment-events", "order-completion")]
        PaymentProcessedEvent @event)
    {
        await _orderService.ConfirmAsync(@event.OrderId);
    }

    [Function("HandleSagaFailed")]
    public async Task HandleSagaFailed(
        [ServiceBusTrigger("saga-events", "order-cancellation")]
        SagaFailedEvent @event)
    {
        await _orderService.CancelAsync(@event.OrderId, @event.Reason);
    }
}
```

## Saga State Management

### Saga State Store

```csharp
public class SagaStateStore
{
    private readonly Container _container;

    public async Task<SagaState> GetOrCreateAsync(string sagaId)
    {
        try
        {
            var response = await _container.ReadItemAsync<SagaState>(
                sagaId,
                new PartitionKey(sagaId));
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            var state = new SagaState
            {
                Id = sagaId,
                Status = SagaStatus.Started,
                StartedAt = DateTime.UtcNow
            };
            await _container.CreateItemAsync(state, new PartitionKey(sagaId));
            return state;
        }
    }

    public async Task UpdateAsync(SagaState state)
    {
        state.UpdatedAt = DateTime.UtcNow;
        await _container.UpsertItemAsync(state, new PartitionKey(state.Id));
    }

    public async Task<IEnumerable<SagaState>> GetStuckSagasAsync(TimeSpan timeout)
    {
        var cutoff = DateTime.UtcNow.Subtract(timeout);

        var query = new QueryDefinition(
            "SELECT * FROM c WHERE c.status = @status AND c.updatedAt < @cutoff")
            .WithParameter("@status", SagaStatus.InProgress.ToString())
            .WithParameter("@cutoff", cutoff);

        var results = new List<SagaState>();
        using var iterator = _container.GetItemQueryIterator<SagaState>(query);

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            results.AddRange(response);
        }

        return results;
    }
}
```

### Saga Recovery Service

```csharp
public class SagaRecoveryService : IHostedService, IDisposable
{
    private Timer? _timer;
    private readonly ISagaStateStore _stateStore;
    private readonly ISagaOrchestrator _orchestrator;
    private readonly ILogger<SagaRecoveryService> _logger;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _timer = new Timer(
            RecoverStuckSagas,
            null,
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(5));

        return Task.CompletedTask;
    }

    private async void RecoverStuckSagas(object? state)
    {
        try
        {
            var stuckSagas = await _stateStore.GetStuckSagasAsync(TimeSpan.FromMinutes(15));

            foreach (var saga in stuckSagas)
            {
                _logger.LogWarning("Recovering stuck saga {SagaId}", saga.Id);

                try
                {
                    await _orchestrator.CompensateAsync(saga);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to recover saga {SagaId}", saga.Id);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in saga recovery service");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _timer?.Change(Timeout.Infinite, 0);
        return Task.CompletedTask;
    }

    public void Dispose() => _timer?.Dispose();
}
```

## Monitoring and Observability

```csharp
public class SagaTelemetry
{
    private readonly TelemetryClient _telemetryClient;

    public void TrackSagaStarted(string sagaId, string sagaType)
    {
        _telemetryClient.TrackEvent("SagaStarted", new Dictionary<string, string>
        {
            ["SagaId"] = sagaId,
            ["SagaType"] = sagaType
        });
    }

    public void TrackSagaCompleted(string sagaId, TimeSpan duration, bool success)
    {
        _telemetryClient.TrackEvent("SagaCompleted", new Dictionary<string, string>
        {
            ["SagaId"] = sagaId,
            ["Success"] = success.ToString()
        }, new Dictionary<string, double>
        {
            ["DurationMs"] = duration.TotalMilliseconds
        });
    }

    public void TrackCompensation(string sagaId, string step, bool success)
    {
        _telemetryClient.TrackEvent("SagaCompensation", new Dictionary<string, string>
        {
            ["SagaId"] = sagaId,
            ["Step"] = step,
            ["Success"] = success.ToString()
        });
    }
}
```

## Conclusion

The Saga pattern is essential for maintaining data consistency in distributed systems. Azure Durable Functions provide excellent orchestration capabilities with built-in retry and state management. For event-driven architectures, Service Bus enables reliable choreography. Choose orchestration for complex flows requiring centralized control, and choreography for loosely coupled, event-driven systems.

## References

- [Saga Pattern](https://docs.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)
- [Durable Functions](https://docs.microsoft.com/en-us/azure/azure-functions/durable/)
