---
title: Dapr on Azure for Cloud-Native Applications
author: Michael John Peña
draft: false
date: 2021-06-27
url: /blog/dapr-azure-integration/
tags:
  - Azure
  - Dapr
  - Microservices
  - Cloud-Native

---

I wrote "2021-06-27-dapr-azure-integration" to share practical, production-minded guidance on this topic.

## Dapr Building Blocks

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      Dapr Sidecar                            │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│   Service   │    State    │   Pub/Sub   │     Bindings      │
│  Invocation │ Management  │  Messaging  │   (Input/Output)  │
├─────────────┼─────────────┼─────────────┼───────────────────┤
│   Actors    │   Secrets   │Observability│  Configuration    │
└─────────────┴─────────────┴─────────────┴───────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    Azure Services                            │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│  │ Cosmos DB │ │Service Bus│ │  Blob     │ │ Key Vault │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Setting Up Dapr Components

### State Store with Cosmos DB

```yaml
# components/statestore.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: statestore
spec:
  type: state.azure.cosmosdb
  version: v1
  metadata:
    - name: url
      value: "https://mycosmosdb.documents.azure.com:443/"
    - name: masterKey
      secretKeyRef:
        name: cosmos-secret
        key: masterKey
    - name: database
      value: "dapr-state"
    - name: collection
      value: "state"
    - name: actorStateStore
      value: "true"
```

### Pub/Sub with Service Bus

```yaml
# components/pubsub.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: orderpubsub
spec:
  type: pubsub.azure.servicebus
  version: v1
  metadata:
    - name: connectionString
      secretKeyRef:
        name: servicebus-secret
        key: connectionString
    - name: consumerID
      value: "order-processor"
```

### Secrets with Key Vault

```yaml
# components/secretstore.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: azurekeyvault
spec:
  type: secretstores.azure.keyvault
  version: v1
  metadata:
    - name: vaultName
      value: "mykeyvault"
    - name: azureTenantId
      value: "tenant-id"
    - name: azureClientId
      value: "client-id"
    - name: azureClientSecret
      secretKeyRef:
        name: azure-secret
        key: clientSecret
```

## Service Invocation

### Calling Services with Dapr SDK

```csharp
public class OrderService
{
    private readonly DaprClient _daprClient;

    public OrderService(DaprClient daprClient)
    {
        _daprClient = daprClient;
    }

    public async Task<Order> CreateOrderAsync(CreateOrderRequest request)
    {
        // Check inventory via service invocation
        var inventoryCheck = await _daprClient.InvokeMethodAsync<InventoryRequest, InventoryResponse>(
            "inventory-service",
            "check",
            new InventoryRequest { Items = request.Items });

        if (!inventoryCheck.AllAvailable)
        {
            throw new InsufficientInventoryException(inventoryCheck.UnavailableItems);
        }

        // Create order
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CustomerId = request.CustomerId,
            Items = request.Items,
            Status = OrderStatus.Created,
            CreatedAt = DateTime.UtcNow
        };

        // Save to state store
        await _daprClient.SaveStateAsync("statestore", order.Id.ToString(), order);

        // Publish order created event
        await _daprClient.PublishEventAsync("orderpubsub", "orders", new OrderCreatedEvent
        {
            OrderId = order.Id,
            CustomerId = request.CustomerId,
            Items = request.Items
        });

        return order;
    }

    public async Task<Order?> GetOrderAsync(Guid orderId)
    {
        return await _daprClient.GetStateAsync<Order>("statestore", orderId.ToString());
    }
}
```

### ASP.NET Core Integration

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDaprClient();
builder.Services.AddControllers().AddDapr();

var app = builder.Build();

app.UseCloudEvents();
app.MapSubscribeHandler();
app.MapControllers();

app.Run();
```

## Pub/Sub Messaging

### Publishing Events

```csharp
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly DaprClient _daprClient;

    [HttpPost]
    public async Task<IActionResult> CreateOrder(CreateOrderRequest request)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CustomerId = request.CustomerId,
            Items = request.Items
        };

        // Publish to Service Bus topic
        await _daprClient.PublishEventAsync(
            "orderpubsub",
            "orders",
            order,
            new Dictionary<string, string>
            {
                ["cloudevent.type"] = "order.created",
                ["cloudevent.source"] = "order-service"
            });

        return Created($"/api/orders/{order.Id}", order);
    }
}
```

### Subscribing to Events

```csharp
[ApiController]
public class OrderEventsController : ControllerBase
{
    private readonly IOrderProcessor _processor;
    private readonly ILogger<OrderEventsController> _logger;

    [Topic("orderpubsub", "orders")]
    [HttpPost("/orders/events")]
    public async Task<IActionResult> HandleOrderEvent(Order order)
    {
        _logger.LogInformation("Received order event: {OrderId}", order.Id);

        await _processor.ProcessAsync(order);

        return Ok();
    }

    // Programmatic subscription
    [Topic("orderpubsub", "inventory-updates", "event.type == \"inventory.reserved\"", 1)]
    [HttpPost("/inventory/events")]
    public async Task<IActionResult> HandleInventoryReserved(InventoryReservedEvent @event)
    {
        await _processor.HandleInventoryReservedAsync(@event);
        return Ok();
    }
}
```

## State Management

### CRUD Operations

```csharp
public class ShoppingCartService
{
    private readonly DaprClient _daprClient;
    private const string StoreName = "statestore";

    public async Task<Cart> GetCartAsync(string userId)
    {
        var cart = await _daprClient.GetStateAsync<Cart>(StoreName, $"cart-{userId}");
        return cart ?? new Cart { UserId = userId, Items = new List<CartItem>() };
    }

    public async Task AddItemAsync(string userId, CartItem item)
    {
        var cart = await GetCartAsync(userId);
        cart.Items.Add(item);
        cart.UpdatedAt = DateTime.UtcNow;

        await _daprClient.SaveStateAsync(StoreName, $"cart-{userId}", cart);
    }

    public async Task ClearCartAsync(string userId)
    {
        await _daprClient.DeleteStateAsync(StoreName, $"cart-{userId}");
    }

    // Optimistic concurrency
    public async Task<bool> UpdateCartAsync(string userId, Cart cart)
    {
        var (currentCart, etag) = await _daprClient.GetStateAndETagAsync<Cart>(
            StoreName,
            $"cart-{userId}");

        try
        {
            await _daprClient.TrySaveStateAsync(
                StoreName,
                $"cart-{userId}",
                cart,
                etag);
            return true;
        }
        catch (DaprException)
        {
            return false; // Concurrency conflict
        }
    }
}
```

## Dapr Actors

### Actor Interface and Implementation

```csharp
// Actor Interface
public interface IOrderActor : IActor
{
    Task<Order> GetOrderAsync();
    Task CreateAsync(CreateOrderRequest request);
    Task AddItemAsync(OrderItem item);
    Task SubmitAsync();
    Task SetReminderAsync();
}

// Actor Implementation
public class OrderActor : Actor, IOrderActor, IRemindable
{
    private const string OrderStateName = "OrderState";

    public OrderActor(ActorHost host) : base(host)
    {
    }

    public async Task<Order> GetOrderAsync()
    {
        return await StateManager.GetStateAsync<Order>(OrderStateName);
    }

    public async Task CreateAsync(CreateOrderRequest request)
    {
        var order = new Order
        {
            Id = Guid.Parse(Id.GetId()),
            CustomerId = request.CustomerId,
            Items = new List<OrderItem>(),
            Status = OrderStatus.Draft,
            CreatedAt = DateTime.UtcNow
        };

        await StateManager.SetStateAsync(OrderStateName, order);
    }

    public async Task AddItemAsync(OrderItem item)
    {
        var order = await StateManager.GetStateAsync<Order>(OrderStateName);
        order.Items.Add(item);
        await StateManager.SetStateAsync(OrderStateName, order);
    }

    public async Task SubmitAsync()
    {
        var order = await StateManager.GetStateAsync<Order>(OrderStateName);
        order.Status = OrderStatus.Submitted;
        order.SubmittedAt = DateTime.UtcNow;
        await StateManager.SetStateAsync(OrderStateName, order);
    }

    public async Task SetReminderAsync()
    {
        await RegisterReminderAsync(
            "OrderExpiration",
            null,
            TimeSpan.FromMinutes(30),
            TimeSpan.FromMilliseconds(-1));
    }

    public async Task ReceiveReminderAsync(
        string reminderName,
        byte[] state,
        TimeSpan dueTime,
        TimeSpan period)
    {
        if (reminderName == "OrderExpiration")
        {
            var order = await StateManager.GetStateAsync<Order>(OrderStateName);
            if (order.Status == OrderStatus.Draft)
            {
                order.Status = OrderStatus.Expired;
                await StateManager.SetStateAsync(OrderStateName, order);
            }
        }
    }
}
```

### Using Actors

```csharp
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    private readonly IActorProxyFactory _actorProxyFactory;

    public OrdersController(IActorProxyFactory actorProxyFactory)
    {
        _actorProxyFactory = actorProxyFactory;
    }

    [HttpPost]
    public async Task<IActionResult> CreateOrder(CreateOrderRequest request)
    {
        var orderId = Guid.NewGuid();
        var actorId = new ActorId(orderId.ToString());
        var proxy = _actorProxyFactory.CreateActorProxy<IOrderActor>(
            actorId,
            "OrderActor");

        await proxy.CreateAsync(request);
        await proxy.SetReminderAsync();

        return Created($"/api/orders/{orderId}", new { OrderId = orderId });
    }

    [HttpGet("{orderId}")]
    public async Task<IActionResult> GetOrder(Guid orderId)
    {
        var proxy = _actorProxyFactory.CreateActorProxy<IOrderActor>(
            new ActorId(orderId.ToString()),
            "OrderActor");

        var order = await proxy.GetOrderAsync();
        return Ok(order);
    }

    [HttpPost("{orderId}/items")]
    public async Task<IActionResult> AddItem(Guid orderId, OrderItem item)
    {
        var proxy = _actorProxyFactory.CreateActorProxy<IOrderActor>(
            new ActorId(orderId.ToString()),
            "OrderActor");

        await proxy.AddItemAsync(item);
        return NoContent();
    }
}
```

## Bindings for Azure Services

### Blob Storage Binding

```yaml
# components/blobstorage.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: blobstore
spec:
  type: bindings.azure.blobstorage
  version: v1
  metadata:
    - name: storageAccount
      value: "mystorageaccount"
    - name: storageAccessKey
      secretKeyRef:
        name: storage-secret
        key: accessKey
    - name: container
      value: "orders"
```

### Using Output Binding

```csharp
public class OrderExportService
{
    private readonly DaprClient _daprClient;

    public async Task ExportOrderAsync(Order order)
    {
        var json = JsonSerializer.Serialize(order);

        await _daprClient.InvokeBindingAsync(
            "blobstore",
            "create",
            json,
            new Dictionary<string, string>
            {
                ["blobName"] = $"orders/{order.Id}.json",
                ["contentType"] = "application/json"
            });
    }
}
```

## Kubernetes Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
      annotations:
        dapr.io/enabled: "true"
        dapr.io/app-id: "order-service"
        dapr.io/app-port: "80"
        dapr.io/log-level: "info"
    spec:
      containers:
        - name: order-service
          image: myacr.azurecr.io/order-service:latest
          ports:
            - containerPort: 80
          env:
            - name: ASPNETCORE_URLS
              value: "http://+:80"
```

## Conclusion

Dapr simplifies building cloud-native applications by providing consistent APIs for common microservices patterns. With native Azure integration, you can leverage Cosmos DB for state, Service Bus for messaging, and Key Vault for secrets, all through standardized Dapr APIs. This portability allows applications to run on any cloud or on-premises infrastructure.

## References

- [Dapr Documentation](https://docs.dapr.io/)
- [Dapr Azure Components](https://docs.dapr.io/reference/components-reference/)

