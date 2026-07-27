---
title: "Azure Service Fabric: Microservices Platform"
author: Michael John Peña
draft: false
date: 2020-11-10
tags:
  - Azure
  - Service Fabric
  - Microservices
  - Containers

---

I wrote "Azure Service Fabric: Microservices Platform" to share practical, production-minded guidance on this topic.

## Service Types

### Stateless Services

```csharp
internal sealed class WebApi : StatelessService
{
    public WebApi(StatelessServiceContext context) : base(context) { }

    protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
    {
        return new[]
        {
            new ServiceInstanceListener(context =>
                new KestrelCommunicationListener(context, "ServiceEndpoint", (url, listener) =>
                    WebHost.CreateDefaultBuilder()
                        .UseStartup<Startup>()
                        .UseServiceFabricIntegration(listener, ServiceFabricIntegrationOptions.UseUniqueServiceUrl)
                        .UseUrls(url)
                        .Build()))
        };
    }
}
```

### Stateful Services

```csharp
internal sealed class OrderService : StatefulService
{
    public OrderService(StatefulServiceContext context) : base(context) { }

    protected override async Task RunAsync(CancellationToken cancellationToken)
    {
        var orders = await StateManager.GetOrAddAsync<IReliableDictionary<string, Order>>("orders");

        while (!cancellationToken.IsCancellationRequested)
        {
            using var tx = StateManager.CreateTransaction();

            var pendingOrders = await orders.CreateEnumerableAsync(tx);
            var enumerator = pendingOrders.GetAsyncEnumerator();

            while (await enumerator.MoveNextAsync(cancellationToken))
            {
                var order = enumerator.Current.Value;
                if (order.Status == OrderStatus.Pending)
                {
                    await ProcessOrder(order, tx);
                }
            }

            await tx.CommitAsync();
            await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
        }
    }
}
```

### Actor Model

```csharp
[ActorService(Name = "OrderActorService")]
[StatePersistence(StatePersistence.Persisted)]
public class OrderActor : Actor, IOrderActor
{
    public OrderActor(ActorService actorService, ActorId actorId)
        : base(actorService, actorId) { }

    public async Task<Order> GetOrderAsync()
    {
        return await StateManager.GetStateAsync<Order>("order");
    }

    public async Task UpdateStatusAsync(OrderStatus status)
    {
        var order = await StateManager.GetStateAsync<Order>("order");
        order.Status = status;
        await StateManager.SetStateAsync("order", order);
    }
}

// Client usage
var actorId = new ActorId(orderId);
var orderActor = ActorProxy.Create<IOrderActor>(actorId, new Uri("fabric:/MyApp/OrderActorService"));
await orderActor.UpdateStatusAsync(OrderStatus.Shipped);
```

## Application Manifest

```xml
<?xml version="1.0" encoding="utf-8"?>
<ApplicationManifest ApplicationTypeName="MyAppType" ApplicationTypeVersion="1.0.0">
  <Parameters>
    <Parameter Name="WebApi_InstanceCount" DefaultValue="-1" />
    <Parameter Name="OrderService_PartitionCount" DefaultValue="5" />
  </Parameters>
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="WebApiPkg" ServiceManifestVersion="1.0.0" />
  </ServiceManifestImport>
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="OrderServicePkg" ServiceManifestVersion="1.0.0" />
  </ServiceManifestImport>
  <DefaultServices>
    <Service Name="WebApi">
      <StatelessService ServiceTypeName="WebApiType" InstanceCount="[WebApi_InstanceCount]">
        <SingletonPartition />
      </StatelessService>
    </Service>
    <Service Name="OrderService">
      <StatefulService ServiceTypeName="OrderServiceType" TargetReplicaSetSize="3" MinReplicaSetSize="2">
        <UniformInt64Partition PartitionCount="[OrderService_PartitionCount]" LowKey="0" HighKey="100" />
      </StatefulService>
    </Service>
  </DefaultServices>
</ApplicationManifest>
```

## Deployment

```bash
# Connect to cluster
sfctl cluster select --endpoint https://mycluster.eastus.cloudapp.azure.com:19080

# Deploy application
sfctl application upload --path ./MyAppPackage
sfctl application provision --application-type-build-path MyAppPackage
sfctl application create --app-name fabric:/MyApp --app-type MyAppType --app-version 1.0.0
```

## Health Monitoring

```csharp
// Report health
var healthInfo = new HealthInformation("OrderService", "ProcessingStatus", HealthState.Ok)
{
    Description = "Processing orders normally",
    TimeToLive = TimeSpan.FromMinutes(5)
};
Partition.ReportInstanceHealth(healthInfo);
```

Service Fabric: enterprise microservices with built-in state management.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
