---
title: CQRS Pattern Implementation with Azure Services
author: Michael John Peña
draft: false
date: 2021-06-22
url: /blog/cqrs-azure-implementation/
tags:
  - Azure
  - CQRS
  - Architecture
  - Patterns

---

I wrote "2021-06-22-cqrs-azure-implementation" to share practical, production-minded guidance on this topic.

## CQRS Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         API Gateway                               │
└───────────────────┬──────────────────┬───────────────────────────┘
                    │                  │
         ┌──────────▼──────────┐ ┌────▼─────────────┐
         │   Command Side      │ │   Query Side     │
         │                     │ │                  │
         │  ┌───────────────┐  │ │ ┌──────────────┐ │
         │  │ Command       │  │ │ │ Query        │ │
         │  │ Handlers      │  │ │ │ Handlers     │ │
         │  └───────┬───────┘  │ │ └──────┬───────┘ │
         │          │          │ │        │         │
         │  ┌───────▼───────┐  │ │ ┌──────▼───────┐ │
         │  │ Domain        │  │ │ │ Read         │ │
         │  │ Model         │  │ │ │ Models       │ │
         │  └───────┬───────┘  │ │ └──────┬───────┘ │
         │          │          │ │        │         │
         │  ┌───────▼───────┐  │ │ ┌──────▼───────┐ │
         │  │ Write DB      │  │ │ │ Read DB      │ │
         │  │ (SQL Server)  │  │ │ │ (Cosmos DB)  │ │
         │  └───────┬───────┘  │ │ └──────────────┘ │
         └──────────┼──────────┘ └──────────▲───────┘
                    │                       │
                    │    ┌──────────────┐   │
                    └───►│ Event Grid   ├───┘
                         │ / Service Bus│
                         └──────────────┘
```

## Command Side Implementation

### Commands and Handlers

```csharp
// Commands
public record CreateOrderCommand(
    Guid CustomerId,
    List<OrderItemDto> Items,
    ShippingAddressDto ShippingAddress) : ICommand<Guid>;

public record AddOrderItemCommand(
    Guid OrderId,
    Guid ProductId,
    int Quantity) : ICommand;

public record SubmitOrderCommand(Guid OrderId) : ICommand;

// Command Handler
public class CreateOrderCommandHandler : ICommandHandler<CreateOrderCommand, Guid>
{
    private readonly IOrderRepository _orderRepository;
    private readonly IEventPublisher _eventPublisher;

    public async Task<Guid> Handle(
        CreateOrderCommand command,
        CancellationToken cancellationToken)
    {
        // Create domain aggregate
        var order = Order.Create(
            command.CustomerId,
            ShippingAddress.FromDto(command.ShippingAddress));

        // Add items
        foreach (var item in command.Items)
        {
            order.AddItem(item.ProductId, item.Quantity, item.Price);
        }

        // Persist to write store
        await _orderRepository.SaveAsync(order, cancellationToken);

        // Publish domain events
        foreach (var domainEvent in order.DomainEvents)
        {
            await _eventPublisher.PublishAsync(domainEvent, cancellationToken);
        }

        return order.Id;
    }
}
```

### Write Side Repository

```csharp
public class SqlOrderRepository : IOrderRepository
{
    private readonly OrderDbContext _context;

    public async Task SaveAsync(Order order, CancellationToken cancellationToken)
    {
        var existingOrder = await _context.Orders
            .Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == order.Id, cancellationToken);

        if (existingOrder == null)
        {
            _context.Orders.Add(order);
        }
        else
        {
            _context.Entry(existingOrder).CurrentValues.SetValues(order);

            // Handle items
            foreach (var item in order.Items)
            {
                var existingItem = existingOrder.Items
                    .FirstOrDefault(i => i.Id == item.Id);

                if (existingItem == null)
                    existingOrder.Items.Add(item);
                else
                    _context.Entry(existingItem).CurrentValues.SetValues(item);
            }
        }

        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<Order?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        return await _context.Orders
            .Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
    }
}
```

## Query Side Implementation

### Read Models

```csharp
// Optimized read models stored in Cosmos DB
public class OrderReadModel
{
    public string Id { get; set; }  // Same as OrderId
    public string CustomerId { get; set; }
    public string CustomerName { get; set; }  // Denormalized
    public string Status { get; set; }
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; }
    public List<OrderItemReadModel> Items { get; set; }
    public ShippingAddressReadModel ShippingAddress { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class OrderItemReadModel
{
    public string ProductId { get; set; }
    public string ProductName { get; set; }  // Denormalized
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TotalPrice { get; set; }
}

// Query for customer's order summary
public class CustomerOrderSummaryReadModel
{
    public string CustomerId { get; set; }
    public string CustomerName { get; set; }
    public int TotalOrders { get; set; }
    public decimal TotalSpent { get; set; }
    public DateTime LastOrderDate { get; set; }
    public List<RecentOrderReadModel> RecentOrders { get; set; }
}
```

### Query Handlers

```csharp
public class GetOrderByIdQueryHandler : IQueryHandler<GetOrderByIdQuery, OrderReadModel?>
{
    private readonly CosmosClient _cosmosClient;
    private readonly Container _container;

    public GetOrderByIdQueryHandler(CosmosClient cosmosClient)
    {
        _cosmosClient = cosmosClient;
        _container = _cosmosClient.GetContainer("orders-db", "orders");
    }

    public async Task<OrderReadModel?> Handle(
        GetOrderByIdQuery query,
        CancellationToken cancellationToken)
    {
        try
        {
            var response = await _container.ReadItemAsync<OrderReadModel>(
                query.OrderId.ToString(),
                new PartitionKey(query.CustomerId.ToString()),
                cancellationToken: cancellationToken);

            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }
}

public class GetCustomerOrdersQueryHandler
    : IQueryHandler<GetCustomerOrdersQuery, PagedResult<OrderReadModel>>
{
    private readonly Container _container;

    public async Task<PagedResult<OrderReadModel>> Handle(
        GetCustomerOrdersQuery query,
        CancellationToken cancellationToken)
    {
        var queryDefinition = new QueryDefinition(
            "SELECT * FROM c WHERE c.CustomerId = @customerId ORDER BY c.CreatedAt DESC OFFSET @offset LIMIT @limit")
            .WithParameter("@customerId", query.CustomerId.ToString())
            .WithParameter("@offset", query.Skip)
            .WithParameter("@limit", query.Take);

        var results = new List<OrderReadModel>();

        using var iterator = _container.GetItemQueryIterator<OrderReadModel>(queryDefinition);

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync(cancellationToken);
            results.AddRange(response);
        }

        return new PagedResult<OrderReadModel>
        {
            Items = results,
            TotalCount = await GetTotalCountAsync(query.CustomerId, cancellationToken)
        };
    }
}
```

## Event-Based Synchronization

### Domain Events

```csharp
public record OrderCreatedEvent(
    Guid OrderId,
    Guid CustomerId,
    List<OrderItemDto> Items,
    ShippingAddressDto ShippingAddress,
    DateTime CreatedAt) : IDomainEvent;

public record OrderSubmittedEvent(
    Guid OrderId,
    Guid CustomerId,
    decimal TotalAmount,
    DateTime SubmittedAt) : IDomainEvent;

public record OrderCompletedEvent(
    Guid OrderId,
    DateTime CompletedAt) : IDomainEvent;
```

### Event Handlers for Read Model Updates

```csharp
// Azure Function triggered by Service Bus
public class OrderProjectionHandler
{
    private readonly Container _ordersContainer;
    private readonly ICustomerService _customerService;

    [Function("ProjectOrderCreated")]
    public async Task HandleOrderCreated(
        [ServiceBusTrigger("order-events", "read-model-projection")]
        OrderCreatedEvent @event)
    {
        // Get customer details for denormalization
        var customer = await _customerService.GetByIdAsync(@event.CustomerId);

        var readModel = new OrderReadModel
        {
            Id = @event.OrderId.ToString(),
            CustomerId = @event.CustomerId.ToString(),
            CustomerName = customer.Name,
            Status = "Created",
            Items = @event.Items.Select(i => new OrderItemReadModel
            {
                ProductId = i.ProductId.ToString(),
                ProductName = i.ProductName,
                Quantity = i.Quantity,
                UnitPrice = i.UnitPrice,
                TotalPrice = i.Quantity * i.UnitPrice
            }).ToList(),
            TotalAmount = @event.Items.Sum(i => i.Quantity * i.UnitPrice),
            ShippingAddress = new ShippingAddressReadModel
            {
                Street = @event.ShippingAddress.Street,
                City = @event.ShippingAddress.City,
                PostalCode = @event.ShippingAddress.PostalCode
            },
            CreatedAt = @event.CreatedAt
        };

        await _ordersContainer.UpsertItemAsync(
            readModel,
            new PartitionKey(readModel.CustomerId));
    }

    [Function("ProjectOrderSubmitted")]
    public async Task HandleOrderSubmitted(
        [ServiceBusTrigger("order-events", "read-model-projection")]
        OrderSubmittedEvent @event)
    {
        // Patch the existing read model
        var operations = new List<PatchOperation>
        {
            PatchOperation.Set("/Status", "Submitted"),
            PatchOperation.Set("/TotalAmount", @event.TotalAmount),
            PatchOperation.Set("/SubmittedAt", @event.SubmittedAt)
        };

        await _ordersContainer.PatchItemAsync<OrderReadModel>(
            @event.OrderId.ToString(),
            new PartitionKey(@event.CustomerId.ToString()),
            operations);
    }
}
```

## API Layer

### Minimal API Implementation

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddMediatR(typeof(Program));
builder.Services.AddCosmosClient(builder.Configuration);
builder.Services.AddSqlServer(builder.Configuration);

var app = builder.Build();

// Command endpoints
app.MapPost("/api/orders", async (
    CreateOrderCommand command,
    IMediator mediator) =>
{
    var orderId = await mediator.Send(command);
    return Results.Created($"/api/orders/{orderId}", new { OrderId = orderId });
});

app.MapPost("/api/orders/{orderId}/items", async (
    Guid orderId,
    AddOrderItemCommand command,
    IMediator mediator) =>
{
    await mediator.Send(command with { OrderId = orderId });
    return Results.NoContent();
});

app.MapPost("/api/orders/{orderId}/submit", async (
    Guid orderId,
    IMediator mediator) =>
{
    await mediator.Send(new SubmitOrderCommand(orderId));
    return Results.NoContent();
});

// Query endpoints
app.MapGet("/api/orders/{orderId}", async (
    Guid orderId,
    Guid customerId,
    IMediator mediator) =>
{
    var order = await mediator.Send(new GetOrderByIdQuery(orderId, customerId));
    return order is not null ? Results.Ok(order) : Results.NotFound();
});

app.MapGet("/api/customers/{customerId}/orders", async (
    Guid customerId,
    int skip,
    int take,
    IMediator mediator) =>
{
    var orders = await mediator.Send(new GetCustomerOrdersQuery(customerId, skip, take));
    return Results.Ok(orders);
});

app.Run();
```

## Infrastructure Setup

### Bicep Deployment

```bicep
// cqrs-infrastructure.bicep
param location string = 'australiaeast'
param environment string

// Write Store - Azure SQL
resource sqlServer 'Microsoft.Sql/servers@2021-05-01-preview' = {
  name: 'sql-orders-write-${environment}'
  location: location
  properties: {
    administratorLogin: 'sqladmin'
    administratorLoginPassword: sqlPassword
  }

  resource database 'databases' = {
    name: 'orders-write'
    location: location
    sku: {
      name: 'S2'
      tier: 'Standard'
    }
  }
}

// Read Store - Cosmos DB
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2021-06-15' = {
  name: 'cosmos-orders-read-${environment}'
  location: location
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }

  resource database 'sqlDatabases' = {
    name: 'orders-db'
    properties: {
      resource: { id: 'orders-db' }
    }

    resource container 'containers' = {
      name: 'orders'
      properties: {
        resource: {
          id: 'orders'
          partitionKey: {
            paths: ['/CustomerId']
            kind: 'Hash'
          }
          indexingPolicy: {
            automatic: true
            indexingMode: 'consistent'
          }
        }
        options: {
          throughput: 400
        }
      }
    }
  }
}

// Event Bus - Service Bus
resource serviceBus 'Microsoft.ServiceBus/namespaces@2021-06-01-preview' = {
  name: 'sb-orders-${environment}'
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }

  resource topic 'topics' = {
    name: 'order-events'
    properties: {}

    resource subscription 'subscriptions' = {
      name: 'read-model-projection'
      properties: {}
    }
  }
}
```

## Conclusion

CQRS with Azure services enables building highly scalable applications with optimized read and write paths. Azure SQL provides transactional guarantees for the write side, while Cosmos DB delivers low-latency reads. Service Bus ensures reliable event delivery for synchronization. This separation allows independent scaling and optimization of each concern.

## References

- [CQRS Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [Event Sourcing Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)

