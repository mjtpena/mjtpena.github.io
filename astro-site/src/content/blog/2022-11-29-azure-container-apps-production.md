---
title: "Azure Container Apps for Production Workloads"
author: Michael John Peña
draft: false
date: 2022-11-29
tags:
  - Azure
  - Container Apps
  - Kubernetes
  - Serverless
  - Cloud Native
---

## Why Container Apps?

Container Apps sits between App Service and AKS:

- **Simpler than AKS**: No cluster management, no node pools
- **More flexible than App Service**: Any container, any language
- **Event-driven**: Built-in scaling based on HTTP, queues, and events
- **Cost-effective**: Scale to zero for dev/test workloads

## Deploying Your First App

```bicep
// container-app.bicep
param location string = resourceGroup().location
param environmentName string
param appName string
param containerImage string

resource environment 'Microsoft.App/managedEnvironments@2022-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      secrets: [
        {
          name: 'db-connection'
          value: databaseConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'main'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'DATABASE_CONNECTION'
              secretRef: 'db-connection'
            }
            {
              name: 'ASPNETCORE_ENVIRONMENT'
              value: 'Production'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health/live'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health/ready'
                port: 8080
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
            name: 'http-scaling'
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

## Event-Driven Scaling

Scale based on various event sources:

```bicep
// Queue-based scaling
resource queueProcessor 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'queue-processor'
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      secrets: [
        {
          name: 'queue-connection'
          value: queueConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'processor'
          image: 'myregistry.azurecr.io/queue-processor:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'QUEUE_CONNECTION'
              secretRef: 'queue-connection'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0  // Scale to zero when no messages
        maxReplicas: 30
        rules: [
          {
            name: 'queue-scaling'
            azureQueue: {
              queueName: 'orders'
              queueLength: 10
              auth: [
                {
                  secretRef: 'queue-connection'
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

## Dapr Integration

Container Apps has built-in Dapr support:

```bicep
resource daprApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'dapr-app'
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      dapr: {
        enabled: true
        appId: 'order-service'
        appPort: 8080
        appProtocol: 'http'
      }
    }
    template: {
      containers: [
        {
          name: 'order-service'
          image: 'myregistry.azurecr.io/order-service:latest'
        }
      ]
    }
  }
}
```

Using Dapr in your code:

```csharp
using Dapr.Client;

public class OrderService
{
    private readonly DaprClient _daprClient;

    public OrderService(DaprClient daprClient)
    {
        _daprClient = daprClient;
    }

    // Service invocation
    public async Task<Inventory> GetInventoryAsync(string productId)
    {
        return await _daprClient.InvokeMethodAsync<Inventory>(
            "inventory-service",
            $"inventory/{productId}"
        );
    }

    // State management
    public async Task SaveOrderAsync(Order order)
    {
        await _daprClient.SaveStateAsync(
            "statestore",
            order.Id,
            order
        );
    }

    // Pub/sub
    public async Task PublishOrderCreatedAsync(Order order)
    {
        await _daprClient.PublishEventAsync(
            "pubsub",
            "orders",
            new OrderCreatedEvent(order)
        );
    }
}
```

## Blue-Green Deployments

```bicep
resource containerApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'my-app'
  location: location
  properties: {
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        traffic: [
          {
            revisionName: 'my-app--v1'
            weight: 90
            label: 'stable'
          }
          {
            revisionName: 'my-app--v2'
            weight: 10
            label: 'canary'
          }
        ]
      }
      activeRevisionsMode: 'Multiple'
    }
  }
}
```

CLI for traffic management:

```bash
# Create new revision
az containerapp update \
    --name my-app \
    --resource-group rg-production \
    --image myregistry.azurecr.io/my-app:v2

# Gradually shift traffic
az containerapp ingress traffic set \
    --name my-app \
    --resource-group rg-production \
    --revision-weight my-app--v1=80 my-app--v2=20

# Full cutover
az containerapp ingress traffic set \
    --name my-app \
    --resource-group rg-production \
    --revision-weight my-app--v2=100
```

## Connecting to Azure Services

### Managed Identity

```bicep
resource containerApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'my-app'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    template: {
      containers: [
        {
          name: 'app'
          image: containerImage
          env: [
            {
              name: 'AZURE_CLIENT_ID'
              value: ''  // Uses system-assigned identity
            }
          ]
        }
      ]
    }
  }
}

// Grant access to Key Vault
resource keyVaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, containerApp.id, 'KeyVaultSecretsUser')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

### Virtual Network Integration

```bicep
resource vnet 'Microsoft.Network/virtualNetworks@2022-07-01' = {
  name: 'vnet-apps'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.0.0.0/16']
    }
    subnets: [
      {
        name: 'container-apps'
        properties: {
          addressPrefix: '10.0.0.0/23'  // Min /23 for Container Apps
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.0.2.0/24'
        }
      }
    ]
  }
}

resource environment 'Microsoft.App/managedEnvironments@2022-03-01' = {
  name: 'env-production'
  location: location
  properties: {
    vnetConfiguration: {
      internal: true
      infrastructureSubnetId: vnet.properties.subnets[0].id
    }
  }
}
```

## Monitoring and Observability

```csharp
// Application with structured logging
var builder = WebApplication.CreateBuilder(args);

// Add Application Insights
builder.Services.AddApplicationInsightsTelemetry();

// Add health checks
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy())
    .AddAzureBlobStorage(
        builder.Configuration["Storage:ConnectionString"],
        name: "storage")
    .AddSqlServer(
        builder.Configuration["Database:ConnectionString"],
        name: "database");

var app = builder.Build();

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false  // Just check if app responds
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
});

app.Run();
```

```kusto
// Query logs in Log Analytics
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "my-app"
| where Log_s contains "error"
| project TimeGenerated, Log_s, RevisionName_s
| order by TimeGenerated desc
| take 100
```

## Cost Optimization

```bicep
// Development environment - scale to zero
resource devApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'my-app-dev'
  properties: {
    template: {
      scale: {
        minReplicas: 0  // Scale to zero
        maxReplicas: 2
      }
    }
  }
}

// Production - maintain minimum replicas
resource prodApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'my-app-prod'
  properties: {
    template: {
      scale: {
        minReplicas: 2  // Always running
        maxReplicas: 20
      }
    }
  }
}
```

## Conclusion

Azure Container Apps provides a compelling platform for containerized workloads that need the flexibility of containers without the complexity of Kubernetes. With built-in Dapr support, event-driven scaling, and straightforward deployments, it's an excellent choice for microservices and event-driven architectures.

## Resources

- [Container Apps Documentation](https://docs.microsoft.com/en-us/azure/container-apps/)
- [Dapr Integration](https://docs.microsoft.com/en-us/azure/container-apps/dapr-overview)
- [Scaling Rules](https://docs.microsoft.com/en-us/azure/container-apps/scale-app)
- [Networking](https://docs.microsoft.com/en-us/azure/container-apps/networking)
