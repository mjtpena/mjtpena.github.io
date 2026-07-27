---
title: Azure Container Apps Concepts and Architecture
author: Michael John Peña
draft: false
date: 2021-06-28
url: /blog/azure-container-apps-concepts/
tags:
  - Azure
  - Container Apps
  - Containers
  - Serverless

---

I wrote "2021-06-28-azure-container-apps-concepts" to share practical, production-minded guidance on this topic.

## Container Apps Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Azure Container Apps Environment              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     KEDA Autoscaling                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Container App   │  │  Container App   │  │ Container App│  │
│  │    (Web API)     │  │   (Worker)       │  │  (Frontend)  │  │
│  │  ┌───────────┐   │  │  ┌───────────┐   │  │ ┌──────────┐ │  │
│  │  │ Revision  │   │  │  │ Revision  │   │  │ │ Revision │ │  │
│  │  │   v1      │   │  │  │   v2      │   │  │ │   v1     │ │  │
│  │  └───────────┘   │  │  └───────────┘   │  │ └──────────┘ │  │
│  │  ┌───────────┐   │  │                   │  │              │  │
│  │  │ Dapr      │   │  │  ┌───────────┐   │  │              │  │
│  │  │ Sidecar   │   │  │  │ Dapr      │   │  │              │  │
│  │  └───────────┘   │  │  │ Sidecar   │   │  │              │  │
│  └──────────────────┘  │  └───────────┘   │  └──────────────┘  │
│                        └──────────────────┘                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Managed Virtual Network                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Container App Environment

```bicep
// container-app-environment.bicep
resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2022-03-01' = {
  name: 'cae-myapp'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      internal: false
      infrastructureSubnetId: infrastructureSubnet.id
      runtimeSubnetId: runtimeSubnet.id
    }
    daprAIInstrumentationKey: appInsights.properties.InstrumentationKey
  }
}
```

### Container App Definition

```bicep
// container-app.bicep
resource containerApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'ca-api'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
        traffic: [
          {
            weight: 80
            latestRevision: false
            revisionName: 'ca-api--v1'
          }
          {
            weight: 20
            latestRevision: true
          }
        ]
      }
      secrets: [
        {
          name: 'connection-string'
          value: cosmosConnectionString
        }
      ]
      registries: [
        {
          server: containerRegistry.properties.loginServer
          username: containerRegistry.listCredentials().username
          passwordSecretRef: 'registry-password'
        }
      ]
      dapr: {
        enabled: true
        appId: 'api'
        appPort: 80
        appProtocol: 'http'
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${containerRegistry.properties.loginServer}/api:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'ASPNETCORE_ENVIRONMENT'
              value: 'Production'
            }
            {
              name: 'ConnectionStrings__Cosmos'
              secretRef: 'connection-string'
            }
          ]
          probes: [
            {
              type: 'liveness'
              httpGet: {
                path: '/health/live'
                port: 80
              }
              initialDelaySeconds: 30
              periodSeconds: 10
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/health/ready'
                port: 80
              }
              initialDelaySeconds: 5
              periodSeconds: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}
```

## Scaling Patterns

### HTTP-Based Scaling

```bicep
scale: {
  minReplicas: 1
  maxReplicas: 30
  rules: [
    {
      name: 'http-requests'
      http: {
        metadata: {
          concurrentRequests: '50'
        }
      }
    }
  ]
}
```

### Queue-Based Scaling (KEDA)

```bicep
scale: {
  minReplicas: 0
  maxReplicas: 20
  rules: [
    {
      name: 'queue-scale'
      azureQueue: {
        queueName: 'orders'
        queueLength: 10
        auth: [
          {
            secretRef: 'storage-connection'
            triggerParameter: 'connection'
          }
        ]
      }
    }
  ]
}
```

### Service Bus Scaling

```bicep
scale: {
  minReplicas: 0
  maxReplicas: 50
  rules: [
    {
      name: 'servicebus-scale'
      custom: {
        type: 'azure-servicebus'
        metadata: {
          queueName: 'order-queue'
          messageCount: '5'
        }
        auth: [
          {
            secretRef: 'servicebus-connection'
            triggerParameter: 'connection'
          }
        ]
      }
    }
  ]
}
```

## Revision Management

### Traffic Splitting

```csharp
// CLI example for traffic splitting
// az containerapp ingress traffic set \
//   --name ca-api \
//   --resource-group rg-myapp \
//   --revision-weight ca-api--v1=80 ca-api--v2=20

// Programmatic approach
public class RevisionManager
{
    private readonly ArmClient _armClient;

    public async Task SetTrafficWeightsAsync(
        string resourceGroupName,
        string containerAppName,
        Dictionary<string, int> weights)
    {
        var containerApp = await GetContainerAppAsync(resourceGroupName, containerAppName);

        var trafficWeights = weights.Select(kvp => new TrafficWeight
        {
            RevisionName = kvp.Key,
            Weight = kvp.Value
        }).ToList();

        containerApp.Data.Configuration.Ingress.Traffic = trafficWeights;

        await containerApp.UpdateAsync(
            WaitUntil.Completed,
            containerApp.Data);
    }
}
```

### Blue-Green Deployments

```bicep
// Blue revision (current production)
var blueRevisionName = 'ca-api--blue'
// Green revision (new version)
var greenRevisionName = 'ca-api--green'

resource containerApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'ca-api'
  properties: {
    configuration: {
      ingress: {
        traffic: [
          {
            revisionName: blueRevisionName
            weight: 100
            label: 'blue'
          }
          {
            revisionName: greenRevisionName
            weight: 0
            label: 'green'
          }
        ]
      }
    }
  }
}
```

## Dapr Integration

### State Management

```csharp
public class OrderService
{
    private readonly DaprClient _daprClient;

    public async Task<Order> CreateOrderAsync(CreateOrderRequest request)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CustomerId = request.CustomerId,
            Items = request.Items,
            CreatedAt = DateTime.UtcNow
        };

        // Save state using Dapr
        await _daprClient.SaveStateAsync("statestore", order.Id.ToString(), order);

        // Publish event
        await _daprClient.PublishEventAsync("pubsub", "orders", new OrderCreatedEvent
        {
            OrderId = order.Id,
            CustomerId = order.CustomerId
        });

        return order;
    }
}
```

### Service Invocation

```csharp
public class PaymentService
{
    private readonly DaprClient _daprClient;

    public async Task<PaymentResult> ProcessPaymentAsync(Guid orderId, decimal amount)
    {
        // Call payment processor via Dapr service invocation
        var result = await _daprClient.InvokeMethodAsync<PaymentRequest, PaymentResult>(
            "payment-processor",
            "process",
            new PaymentRequest
            {
                OrderId = orderId,
                Amount = amount
            });

        return result;
    }
}
```

## Worker Containers

### Background Processing

```bicep
resource workerApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'ca-worker'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      // No ingress - worker doesn't receive HTTP traffic
      dapr: {
        enabled: true
        appId: 'order-worker'
        appPort: 80
      }
      secrets: [
        {
          name: 'servicebus-connection'
          value: serviceBusConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: '${containerRegistry.properties.loginServer}/worker:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 10
        rules: [
          {
            name: 'queue-trigger'
            azureQueue: {
              queueName: 'order-processing'
              queueLength: 5
              auth: [
                {
                  secretRef: 'servicebus-connection'
                  triggerParameter: 'connection'
                }
              ]
            }
          }
        ]
      }
    }
  }
}
```

### Worker Implementation

```csharp
public class OrderProcessor : BackgroundService
{
    private readonly IServiceBusClient _serviceBusClient;
    private readonly IOrderService _orderService;
    private readonly ILogger<OrderProcessor> _logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var processor = _serviceBusClient.CreateProcessor("order-processing");

        processor.ProcessMessageAsync += async args =>
        {
            var order = args.Message.Body.ToObjectFromJson<Order>();

            _logger.LogInformation("Processing order: {OrderId}", order.Id);

            await _orderService.ProcessAsync(order);

            await args.CompleteMessageAsync(args.Message);
        };

        processor.ProcessErrorAsync += args =>
        {
            _logger.LogError(args.Exception, "Error processing message");
            return Task.CompletedTask;
        };

        await processor.StartProcessingAsync(stoppingToken);

        await Task.Delay(Timeout.Infinite, stoppingToken);

        await processor.StopProcessingAsync();
    }
}
```

## Observability

### Application Insights Integration

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddApplicationInsightsTelemetry();
builder.Services.AddDaprClient();

// Custom telemetry for Container Apps
builder.Services.AddSingleton<ITelemetryInitializer>(sp =>
{
    return new ContainerAppTelemetryInitializer(
        Environment.GetEnvironmentVariable("CONTAINER_APP_NAME"),
        Environment.GetEnvironmentVariable("CONTAINER_APP_REVISION"));
});
```

## Conclusion

Azure Container Apps combines the simplicity of serverless with the power of containers. With built-in Dapr integration, KEDA scaling, and revision management, it provides an excellent platform for modern microservices. As the service matures, it will become an increasingly attractive option for teams wanting Kubernetes capabilities without the operational complexity.

## References

- [Azure Container Apps Documentation](https://docs.microsoft.com/en-us/azure/container-apps/)
- [KEDA Scalers](https://keda.sh/docs/scalers/)

