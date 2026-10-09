---
title: Azure Service Fabric for Microservices
author: Michael John Peña
draft: false
date: 2021-06-26
url: /blog/azure-service-fabric/
tags:
  - Azure
  - Service Fabric
  - Microservices
  - Containers
---

## Service Fabric Programming Models

### Reliable Services

```csharp
// Stateless Service
public class OrderApiService : StatelessService
{
    public OrderApiService(StatelessServiceContext context)
        : base(context)
    {
    }

    protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
    {
        return new[]
        {
            new ServiceInstanceListener(serviceContext =>
                new KestrelCommunicationListener(serviceContext, "ServiceEndpoint", (url, listener) =>
                {
                    return new WebHostBuilder()
                        .UseKestrel()
                        .ConfigureServices(services =>
                        {
                            services.AddSingleton(serviceContext);
                            services.AddControllers();
                        })
                        .UseServiceFabricIntegration(listener, ServiceFabricIntegrationOptions.UseUniqueServiceUrl)
                        .UseUrls(url)
                        .Build();
                }))
        };
    }

    protected override async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            ServiceEventSource.Current.ServiceMessage(Context, "Working...");
            await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
        }
    }
}
```

### Stateful Service with Reliable Collections

```csharp
public class ShoppingCartService : StatefulService
{
    public ShoppingCartService(StatefulServiceContext context)
        : base(context)
    {
    }

    protected override IEnumerable<ServiceReplicaListener> CreateServiceReplicaListeners()
    {
        return new[]
        {
            new ServiceReplicaListener(context =>
                new ServiceRemotingListener<IShoppingCartService>(context, this))
        };
    }

    public async Task<Cart> GetCartAsync(string userId)
    {
        var carts = await StateManager.GetOrAddAsync<IReliableDictionary<string, Cart>>("carts");

        using var tx = StateManager.CreateTransaction();
        var result = await carts.TryGetValueAsync(tx, userId);
        return result.HasValue ? result.Value : new Cart { UserId = userId };
    }

    public async Task AddItemAsync(string userId, CartItem item)
    {
        var carts = await StateManager.GetOrAddAsync<IReliableDictionary<string, Cart>>("carts");

        using var tx = StateManager.CreateTransaction();

        var result = await carts.TryGetValueAsync(tx, userId);
        var cart = result.HasValue ? result.Value : new Cart { UserId = userId };

        cart.Items.Add(item);
        cart.UpdatedAt = DateTime.UtcNow;

        await carts.SetAsync(tx, userId, cart);
        await tx.CommitAsync();
    }

    public async Task<bool> RemoveItemAsync(string userId, Guid itemId)
    {
        var carts = await StateManager.GetOrAddAsync<IReliableDictionary<string, Cart>>("carts");

        using var tx = StateManager.CreateTransaction();

        var result = await carts.TryGetValueAsync(tx, userId);
        if (!result.HasValue)
            return false;

        var cart = result.Value;
        var removed = cart.Items.RemoveAll(i => i.Id == itemId) > 0;

        if (removed)
        {
            await carts.SetAsync(tx, userId, cart);
            await tx.CommitAsync();
        }

        return removed;
    }

    public async Task ClearCartAsync(string userId)
    {
        var carts = await StateManager.GetOrAddAsync<IReliableDictionary<string, Cart>>("carts");

        using var tx = StateManager.CreateTransaction();
        await carts.TryRemoveAsync(tx, userId);
        await tx.CommitAsync();
    }
}
```

## Reliable Actors

### Actor Implementation

```csharp
// Actor Interface
public interface IOrderActor : IActor
{
    Task<Order> GetOrderAsync();
    Task CreateOrderAsync(OrderDetails details);
    Task AddItemAsync(OrderItem item);
    Task SubmitAsync();
    Task CancelAsync(string reason);
}

// Actor Implementation
[StatePersistence(StatePersistence.Persisted)]
public class OrderActor : Actor, IOrderActor, IRemindable
{
    private const string OrderStateName = "OrderState";
    private const string ExpirationReminderName = "OrderExpiration";

    public OrderActor(ActorService actorService, ActorId actorId)
        : base(actorService, actorId)
    {
    }

    protected override async Task OnActivateAsync()
    {
        ActorEventSource.Current.ActorMessage(this, "OrderActor activated: {0}", Id);

        // Initialize state if needed
        var state = await StateManager.TryGetStateAsync<Order>(OrderStateName);
        if (!state.HasValue)
        {
            await StateManager.SetStateAsync(OrderStateName, new Order
            {
                Id = Guid.Parse(Id.ToString()),
                Status = OrderStatus.New,
                CreatedAt = DateTime.UtcNow
            });
        }
    }

    public async Task<Order> GetOrderAsync()
    {
        return await StateManager.GetStateAsync<Order>(OrderStateName);
    }

    public async Task CreateOrderAsync(OrderDetails details)
    {
        var order = new Order
        {
            Id = Guid.Parse(Id.ToString()),
            CustomerId = details.CustomerId,
            Items = new List<OrderItem>(),
            Status = OrderStatus.Draft,
            CreatedAt = DateTime.UtcNow
        };

        await StateManager.SetStateAsync(OrderStateName, order);

        // Set reminder for order expiration (abandon if not submitted in 30 minutes)
        await RegisterReminderAsync(
            ExpirationReminderName,
            null,
            TimeSpan.FromMinutes(30),
            TimeSpan.FromMilliseconds(-1));  // One-time reminder
    }

    public async Task AddItemAsync(OrderItem item)
    {
        var order = await StateManager.GetStateAsync<Order>(OrderStateName);

        if (order.Status != OrderStatus.Draft)
            throw new InvalidOperationException("Cannot modify non-draft order");

        order.Items.Add(item);
        order.UpdatedAt = DateTime.UtcNow;

        await StateManager.SetStateAsync(OrderStateName, order);
    }

    public async Task SubmitAsync()
    {
        var order = await StateManager.GetStateAsync<Order>(OrderStateName);

        if (order.Status != OrderStatus.Draft)
            throw new InvalidOperationException("Order already submitted");

        if (!order.Items.Any())
            throw new InvalidOperationException("Cannot submit empty order");

        order.Status = OrderStatus.Submitted;
        order.SubmittedAt = DateTime.UtcNow;

        await StateManager.SetStateAsync(OrderStateName, order);

        // Cancel expiration reminder
        await UnregisterReminderAsync(
            GetReminder(ExpirationReminderName));

        // Publish event
        var eventProxy = GetEvent<IOrderEvents>();
        eventProxy.OrderSubmitted(order.Id, order.CustomerId, order.Items.Sum(i => i.TotalPrice));
    }

    public async Task CancelAsync(string reason)
    {
        var order = await StateManager.GetStateAsync<Order>(OrderStateName);

        if (order.Status == OrderStatus.Shipped)
            throw new InvalidOperationException("Cannot cancel shipped order");

        order.Status = OrderStatus.Cancelled;
        order.CancellationReason = reason;
        order.CancelledAt = DateTime.UtcNow;

        await StateManager.SetStateAsync(OrderStateName, order);
    }

    public async Task ReceiveReminderAsync(
        string reminderName,
        byte[] state,
        TimeSpan dueTime,
        TimeSpan period)
    {
        if (reminderName == ExpirationReminderName)
        {
            var order = await StateManager.GetStateAsync<Order>(OrderStateName);

            if (order.Status == OrderStatus.Draft)
            {
                await CancelAsync("Order expired - not submitted within time limit");
            }
        }
    }
}
```

## Service Communication

### Service Remoting

```csharp
// Client calling a service
public class OrderServiceClient : IOrderServiceClient
{
    private readonly IOrderService _orderService;

    public OrderServiceClient()
    {
        _orderService = ServiceProxy.Create<IOrderService>(
            new Uri("fabric:/MyApplication/OrderService"),
            new ServicePartitionKey(0));
    }

    public async Task<Order> GetOrderAsync(Guid orderId)
    {
        return await _orderService.GetOrderAsync(orderId);
    }
}

// Actor client
public class OrderActorClient
{
    public async Task<Order> GetOrderAsync(Guid orderId)
    {
        var actorId = new ActorId(orderId);
        var orderActor = ActorProxy.Create<IOrderActor>(
            actorId,
            new Uri("fabric:/MyApplication/OrderActorService"));

        return await orderActor.GetOrderAsync();
    }
}
```

### Reverse Proxy

```csharp
// HTTP call through Service Fabric reverse proxy
var client = new HttpClient();
var response = await client.GetAsync(
    "http://localhost:19081/MyApplication/OrderService/api/orders/123");
```

## Application Manifest

```xml
<!-- ApplicationManifest.xml -->
<?xml version="1.0" encoding="utf-8"?>
<ApplicationManifest ApplicationTypeName="ECommerceType" ApplicationTypeVersion="1.0.0"
                     xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>
    <Parameter Name="OrderService_InstanceCount" DefaultValue="-1" />
    <Parameter Name="ShoppingCartService_PartitionCount" DefaultValue="5" />
    <Parameter Name="ShoppingCartService_MinReplicaSetSize" DefaultValue="3" />
    <Parameter Name="ShoppingCartService_TargetReplicaSetSize" DefaultValue="3" />
  </Parameters>

  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="OrderServicePkg" ServiceManifestVersion="1.0.0" />
    <ConfigOverrides />
    <Policies>
      <RunAsPolicy CodePackageRef="Code" UserRef="SetupAdminUser" EntryPointType="Setup" />
    </Policies>
  </ServiceManifestImport>

  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="ShoppingCartServicePkg" ServiceManifestVersion="1.0.0" />
    <ConfigOverrides />
  </ServiceManifestImport>

  <DefaultServices>
    <Service Name="OrderService" ServicePackageActivationMode="ExclusiveProcess">
      <StatelessService ServiceTypeName="OrderServiceType" InstanceCount="[OrderService_InstanceCount]">
        <SingletonPartition />
      </StatelessService>
    </Service>
    <Service Name="ShoppingCartService" ServicePackageActivationMode="ExclusiveProcess">
      <StatefulService ServiceTypeName="ShoppingCartServiceType"
                       TargetReplicaSetSize="[ShoppingCartService_TargetReplicaSetSize]"
                       MinReplicaSetSize="[ShoppingCartService_MinReplicaSetSize]">
        <UniformInt64Partition PartitionCount="[ShoppingCartService_PartitionCount]"
                               LowKey="0" HighKey="100" />
      </StatefulService>
    </Service>
  </DefaultServices>

  <Principals>
    <Users>
      <User Name="SetupAdminUser">
        <MemberOf>
          <SystemGroup Name="Administrators" />
        </MemberOf>
      </User>
    </Users>
  </Principals>
</ApplicationManifest>
```

## Deployment with PowerShell

```powershell
# Connect to cluster
Connect-ServiceFabricCluster -ConnectionEndpoint "mycluster.australiaeast.cloudapp.azure.com:19000" `
    -X509Credential `
    -ServerCertThumbprint "1234567890ABCDEF" `
    -FindType FindByThumbprint `
    -FindValue "1234567890ABCDEF" `
    -StoreLocation CurrentUser `
    -StoreName My

# Copy application package
Copy-ServiceFabricApplicationPackage `
    -ApplicationPackagePath ".\pkg\Release" `
    -ApplicationPackagePathInImageStore "ECommerceV1" `
    -ImageStoreConnectionString "fabric:ImageStore"

# Register application type
Register-ServiceFabricApplicationType -ApplicationPathInImageStore "ECommerceV1"

# Create application instance
New-ServiceFabricApplication `
    -ApplicationName "fabric:/ECommerce" `
    -ApplicationTypeName "ECommerceType" `
    -ApplicationTypeVersion "1.0.0" `
    -ApplicationParameter @{
        "OrderService_InstanceCount" = "-1"
        "ShoppingCartService_PartitionCount" = "10"
    }
```

## Health Monitoring

```csharp
public class HealthReporter : IHostedService
{
    private readonly StatelessServiceContext _context;
    private Timer? _timer;

    protected override Task OnOpenAsync(CancellationToken cancellationToken)
    {
        _timer = new Timer(ReportHealth, null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
        return Task.CompletedTask;
    }

    private void ReportHealth(object? state)
    {
        var healthInfo = new HealthInformation("HealthReporter", "Connectivity", HealthState.Ok)
        {
            Description = "Service is healthy",
            TimeToLive = TimeSpan.FromMinutes(2),
            RemoveWhenExpired = true
        };

        _context.ServicePartition.ReportInstanceHealth(healthInfo);
    }
}
```

## Conclusion

Azure Service Fabric provides a mature platform for building microservices with built-in state management, service discovery, and health monitoring. While newer platforms like Kubernetes have gained popularity, Service Fabric remains a powerful choice, especially for stateful services and actor-based systems.

## References

- [Service Fabric Documentation](https://docs.microsoft.com/en-us/azure/service-fabric/)
- [Reliable Services Programming Model](https://docs.microsoft.com/en-us/azure/service-fabric/service-fabric-reliable-services-introduction)
