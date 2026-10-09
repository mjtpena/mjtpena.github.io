---
title: Microservices Patterns on Azure
author: Michael John Peña
draft: false
date: 2021-06-21
url: /blog/microservices-patterns-azure/
tags:
  - Azure
  - Microservices
  - Architecture
  - Patterns
---

## Service Decomposition

### Domain-Driven Design Approach

```csharp
// Bounded Context: Orders
namespace OrderService.Domain
{
    public class Order : AggregateRoot
    {
        public Guid Id { get; private set; }
        public Guid CustomerId { get; private set; }
        public OrderStatus Status { get; private set; }
        public Money Total { get; private set; }
        private readonly List<OrderItem> _items = new();
        public IReadOnlyCollection<OrderItem> Items => _items.AsReadOnly();

        public static Order Create(Guid customerId)
        {
            var order = new Order
            {
                Id = Guid.NewGuid(),
                CustomerId = customerId,
                Status = OrderStatus.Draft
            };

            order.AddDomainEvent(new OrderCreatedEvent(order.Id, customerId));
            return order;
        }

        public void AddItem(Guid productId, int quantity, Money price)
        {
            var item = new OrderItem(productId, quantity, price);
            _items.Add(item);
            RecalculateTotal();
        }

        public void Submit()
        {
            if (!_items.Any())
                throw new DomainException("Cannot submit empty order");

            Status = OrderStatus.Submitted;
            AddDomainEvent(new OrderSubmittedEvent(Id, CustomerId, Total));
        }
    }
}

// Bounded Context: Inventory
namespace InventoryService.Domain
{
    public class InventoryItem : AggregateRoot
    {
        public Guid ProductId { get; private set; }
        public int QuantityOnHand { get; private set; }
        public int ReservedQuantity { get; private set; }

        public int AvailableQuantity => QuantityOnHand - ReservedQuantity;

        public void Reserve(int quantity)
        {
            if (quantity > AvailableQuantity)
                throw new InsufficientInventoryException(ProductId, quantity, AvailableQuantity);

            ReservedQuantity += quantity;
            AddDomainEvent(new InventoryReservedEvent(ProductId, quantity));
        }

        public void ReleaseReservation(int quantity)
        {
            ReservedQuantity = Math.Max(0, ReservedQuantity - quantity);
            AddDomainEvent(new InventoryReleasedEvent(ProductId, quantity));
        }
    }
}
```

## Service Communication Patterns

### Synchronous Communication via HTTP

```csharp
// Resilient HTTP client configuration
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddMicroserviceClients(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Inventory Service Client
        services.AddHttpClient<IInventoryClient, InventoryClient>(client =>
        {
            client.BaseAddress = new Uri(configuration["Services:Inventory:BaseUrl"]);
        })
        .AddPolicyHandler(GetRetryPolicy())
        .AddPolicyHandler(GetCircuitBreakerPolicy());

        // Payment Service Client
        services.AddHttpClient<IPaymentClient, PaymentClient>(client =>
        {
            client.BaseAddress = new Uri(configuration["Services:Payment:BaseUrl"]);
        })
        .AddPolicyHandler(GetRetryPolicy())
        .AddPolicyHandler(GetCircuitBreakerPolicy());

        return services;
    }

    private static IAsyncPolicy<HttpResponseMessage> GetRetryPolicy()
    {
        return HttpPolicyExtensions
            .HandleTransientHttpError()
            .WaitAndRetryAsync(3, retryAttempt =>
                TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)));
    }

    private static IAsyncPolicy<HttpResponseMessage> GetCircuitBreakerPolicy()
    {
        return HttpPolicyExtensions
            .HandleTransientHttpError()
            .CircuitBreakerAsync(5, TimeSpan.FromSeconds(30));
    }
}
```

### Asynchronous Communication via Service Bus

```csharp
// Message publisher
public class ServiceBusPublisher : IEventPublisher
{
    private readonly ServiceBusSender _sender;

    public ServiceBusPublisher(ServiceBusClient client, string topicName)
    {
        _sender = client.CreateSender(topicName);
    }

    public async Task PublishAsync<T>(T @event) where T : IntegrationEvent
    {
        var message = new ServiceBusMessage(
            JsonSerializer.SerializeToUtf8Bytes(@event))
        {
            MessageId = @event.Id.ToString(),
            Subject = typeof(T).Name,
            ContentType = "application/json",
            CorrelationId = Activity.Current?.Id
        };

        // Add metadata for routing
        message.ApplicationProperties["EventType"] = typeof(T).FullName;
        message.ApplicationProperties["Timestamp"] = @event.Timestamp;

        await _sender.SendMessageAsync(message);
    }
}

// Message consumer (Azure Function)
public class OrderEventsConsumer
{
    private readonly IOrderService _orderService;
    private readonly ILogger<OrderEventsConsumer> _logger;

    [Function("ProcessInventoryReserved")]
    public async Task ProcessInventoryReserved(
        [ServiceBusTrigger("inventory-events", "order-service")]
        ServiceBusReceivedMessage message,
        ServiceBusMessageActions messageActions)
    {
        try
        {
            var eventType = message.ApplicationProperties["EventType"]?.ToString();

            if (eventType == typeof(InventoryReservedEvent).FullName)
            {
                var @event = JsonSerializer.Deserialize<InventoryReservedEvent>(
                    message.Body.ToArray());

                await _orderService.HandleInventoryReservedAsync(@event);
            }

            await messageActions.CompleteMessageAsync(message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing message {MessageId}", message.MessageId);

            if (message.DeliveryCount >= 3)
            {
                await messageActions.DeadLetterMessageAsync(message,
                    deadLetterReason: "ProcessingFailed",
                    deadLetterErrorDescription: ex.Message);
            }
            else
            {
                throw; // Retry
            }
        }
    }
}
```

## API Gateway Pattern

### Azure API Management Configuration

```bicep
// api-management.bicep
resource apim 'Microsoft.ApiManagement/service@2021-08-01' = {
  name: 'apim-microservices'
  location: location
  sku: {
    name: 'Developer'
    capacity: 1
  }
  properties: {
    publisherEmail: 'admin@company.com'
    publisherName: 'Company'
  }
}

// Orders API
resource ordersApi 'Microsoft.ApiManagement/service/apis@2021-08-01' = {
  parent: apim
  name: 'orders-api'
  properties: {
    displayName: 'Orders API'
    path: 'orders'
    protocols: ['https']
    serviceUrl: 'https://order-service.azurewebsites.net'
    subscriptionRequired: true
  }
}

// Rate limiting policy
resource rateLimitPolicy 'Microsoft.ApiManagement/service/policies@2021-08-01' = {
  parent: apim
  name: 'policy'
  properties: {
    format: 'xml'
    value: '''
      <policies>
        <inbound>
          <rate-limit calls="100" renewal-period="60" />
          <quota calls="10000" renewal-period="86400" />
          <cors allow-credentials="true">
            <allowed-origins>
              <origin>https://app.company.com</origin>
            </allowed-origins>
          </cors>
        </inbound>
      </policies>
    '''
  }
}
```

## Service Discovery

### Using Azure Service Bus with Dapr

```yaml
# dapr-components/pubsub.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: order-pubsub
spec:
  type: pubsub.azure.servicebus
  version: v1
  metadata:
    - name: connectionString
      secretKeyRef:
        name: servicebus-secret
        key: connectionString
```
