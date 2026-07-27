---
title: Leveraging Azure Architecture Center Reference Architectures
author: Michael John Peña
draft: false
date: 2021-06-20
url: /blog/azure-architecture-center/
tags:
  - Azure
  - Architecture
  - Reference Architectures
  - Best Practices
---

The Azure Architecture Center is the reference resource I bookmark more than any other when I need to move from "I know what I want to build" to "I know the proven pattern for building it on Azure." Reference architectures for microservices, event-driven systems, data analytics pipelines, and hybrid connectivity—each with architecture diagrams, component choices explained, and cost and reliability considerations. What I value most is the design patterns library: retry, circuit breaker, CQRS, event sourcing, saga, competing consumers—cloud-agnostic patterns with Azure-specific implementation notes. When a client's design review surfaces an architectural concern, the Architecture Center usually has the canonical response backed by Microsoft engineering guidance.

## Key Reference Architectures

### Web Application Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Azure Front Door                         │
│                    (Global Load Balancing + WAF)                │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
   ┌────▼────┐                              ┌────▼────┐
   │ Region 1│                              │ Region 2│
   │ Primary │                              │Secondary│
   └────┬────┘                              └────┬────┘
        │                                         │
   ┌────▼────────────────┐                 ┌────▼────────────────┐
   │   App Service       │                 │   App Service       │
   │   (Web + API)       │                 │   (Web + API)       │
   └────┬────────────────┘                 └────┬────────────────┘
        │                                         │
   ┌────▼────────────────┐                 ┌────▼────────────────┐
   │   Azure SQL         │◄───Geo-Repl────►│   Azure SQL         │
   │   (Primary)         │                 │   (Secondary)       │
   └─────────────────────┘                 └─────────────────────┘
```

### Implementing Multi-Region Architecture

```bicep
// multi-region-webapp.bicep
param primaryRegion string = 'australiaeast'
param secondaryRegion string = 'australiasoutheast'
param appName string

// Primary Region Resources
module primaryApp 'modules/webapp-region.bicep' = {
  name: 'primary-region'
  params: {
    location: primaryRegion
    appName: '${appName}-primary'
    isPrimary: true
  }
}

// Secondary Region Resources
module secondaryApp 'modules/webapp-region.bicep' = {
  name: 'secondary-region'
  params: {
    location: secondaryRegion
    appName: '${appName}-secondary'
    isPrimary: false
  }
}

// Azure Front Door
resource frontDoor 'Microsoft.Cdn/profiles@2021-06-01' = {
  name: 'fd-${appName}'
  location: 'Global'
  sku: {
    name: 'Premium_AzureFrontDoor'
  }
}

resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2021-06-01' = {
  parent: frontDoor
  name: appName
  location: 'Global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2021-06-01' = {
  parent: frontDoor
  name: 'webapp-origins'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/health'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 30
    }
  }
}

resource primaryOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2021-06-01' = {
  parent: originGroup
  name: 'primary'
  properties: {
    hostName: primaryApp.outputs.hostname
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}

resource secondaryOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2021-06-01' = {
  parent: originGroup
  name: 'secondary'
  properties: {
    hostName: secondaryApp.outputs.hostname
    httpPort: 80
    httpsPort: 443
    priority: 2
    weight: 1000
    enabledState: 'Enabled'
  }
}
```

## Microservices Reference Architecture

### Service Mesh with Azure Kubernetes Service

```yaml
# aks-microservices.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  labels:
    app: order-service
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
    spec:
      containers:
      - name: order-service
        image: myregistry.azurecr.io/order-service:latest
        ports:
        - containerPort: 80
        env:
        - name: ASPNETCORE_ENVIRONMENT
          value: "Production"
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 80
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: order-service
spec:
  selector:
    app: order-service
  ports:
  - port: 80
    targetPort: 80
```

### API Gateway Pattern

```csharp
// API Gateway using YARP
public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        builder.Services.AddReverseProxy()
            .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.Authority = builder.Configuration["AzureAd:Authority"];
                options.Audience = builder.Configuration["AzureAd:Audience"];
            });

        builder.Services.AddRateLimiter(options =>
        {
            options.AddFixedWindowLimiter("api", opt =>
            {
                opt.Window = TimeSpan.FromMinutes(1);
                opt.PermitLimit = 100;
                opt.QueueLimit = 10;
            });
        });

        var app = builder.Build();

        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();

        app.MapReverseProxy();

        app.Run();
    }
}
```

```json
// appsettings.json - YARP configuration
{
  "ReverseProxy": {
    "Routes": {
      "orders-route": {
        "ClusterId": "orders-cluster",
        "Match": {
          "Path": "/api/orders/{**catch-all}"
        },
        "Transforms": [
          { "PathRemovePrefix": "/api/orders" }
        ]
      },
      "products-route": {
        "ClusterId": "products-cluster",
        "Match": {
          "Path": "/api/products/{**catch-all}"
        },
        "Transforms": [
          { "PathRemovePrefix": "/api/products" }
        ]
      }
    },
    "Clusters": {
      "orders-cluster": {
        "Destinations": {
          "destination1": {
            "Address": "http://order-service/"
          }
        },
        "HealthCheck": {
          "Active": {
            "Enabled": true,
            "Interval": "00:00:10",
            "Path": "/health"
          }
        }
      },
      "products-cluster": {
        "Destinations": {
          "destination1": {
            "Address": "http://product-service/"
          }
        }
      }
    }
  }
}
```

## Event-Driven Architecture

### Event Grid with Azure Functions

```csharp
// Event publisher
public class OrderService
{
    private readonly EventGridPublisherClient _eventGridClient;

    public async Task PublishOrderCreatedAsync(Order order)
    {
        var cloudEvent = new CloudEvent(
            source: "/orders",
            type: "Order.Created",
            data: new OrderCreatedEvent
            {
                OrderId = order.Id,
                CustomerId = order.CustomerId,
                TotalAmount = order.TotalAmount,
                CreatedAt = DateTime.UtcNow
            });

        await _eventGridClient.SendEventAsync(cloudEvent);
    }
}

// Event handler (Azure Function)
public class OrderEventHandler
{
    [Function("HandleOrderCreated")]
    public async Task Run(
        [EventGridTrigger] CloudEvent cloudEvent,
        FunctionContext context)
    {
        var logger = context.GetLogger<OrderEventHandler>();
        var orderEvent = cloudEvent.Data.ToObjectFromJson<OrderCreatedEvent>();

        logger.LogInformation("Processing order: {OrderId}", orderEvent.OrderId);

        // Process the order
        await ProcessOrderAsync(orderEvent);
    }
}
```

## Data Architecture Patterns

### Data Lake Architecture

```bicep
// data-lake.bicep
param location string = 'australiaeast'
param dataLakeName string

// Data Lake Storage Gen2
resource dataLake 'Microsoft.Storage/storageAccounts@2021-06-01' = {
  name: dataLakeName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    isHnsEnabled: true
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// Containers for medallion architecture
resource bronzeContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-06-01' = {
  name: '${dataLake.name}/default/bronze'
  properties: {
    publicAccess: 'None'
  }
}

resource silverContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-06-01' = {
  name: '${dataLake.name}/default/silver'
  properties: {
    publicAccess: 'None'
  }
}

resource goldContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-06-01' = {
  name: '${dataLake.name}/default/gold'
  properties: {
    publicAccess: 'None'
  }
}

// Azure Synapse Analytics
resource synapse 'Microsoft.Synapse/workspaces@2021-06-01' = {
  name: 'synapse-${dataLakeName}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    defaultDataLakeStorage: {
      accountUrl: 'https://${dataLake.name}.dfs.core.windows.net'
      filesystem: 'synapse'
    }
  }
}
```

## Hub-Spoke Network Topology

```bicep
// hub-spoke-network.bicep

// Hub VNet
resource hubVnet 'Microsoft.Network/virtualNetworks@2021-03-01' = {
  name: 'vnet-hub'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.0.0.0/16']
    }
    subnets: [
      {
        name: 'GatewaySubnet'
        properties: {
          addressPrefix: '10.0.0.0/24'
        }
      }
      {
        name: 'AzureFirewallSubnet'
        properties: {
          addressPrefix: '10.0.1.0/24'
        }
      }
      {
        name: 'SharedServices'
        properties: {
          addressPrefix: '10.0.2.0/24'
        }
      }
    ]
  }
}

// Spoke VNets
resource spokeVnet1 'Microsoft.Network/virtualNetworks@2021-03-01' = {
  name: 'vnet-spoke-prod'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.1.0.0/16']
    }
    subnets: [
      {
        name: 'app'
        properties: {
          addressPrefix: '10.1.1.0/24'
        }
      }
      {
        name: 'data'
        properties: {
          addressPrefix: '10.1.2.0/24'
        }
      }
    ]
  }
}

// VNet Peering
resource hubToSpoke1Peering 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2021-03-01' = {
  parent: hubVnet
  name: 'hub-to-spoke-prod'
  properties: {
    remoteVirtualNetwork: {
      id: spokeVnet1.id
    }
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    allowGatewayTransit: true
  }
}

resource spoke1ToHubPeering 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2021-03-01' = {
  parent: spokeVnet1
  name: 'spoke-prod-to-hub'
  properties: {
    remoteVirtualNetwork: {
      id: hubVnet.id
    }
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    useRemoteGateways: true
  }
}
```

## Architecture Decision Records

```markdown
# ADR-001: Use Azure Front Door for Global Load Balancing

## Status
Accepted

## Context
We need to distribute traffic across multiple regions for our web application
to ensure low latency for global users and high availability.

## Decision
We will use Azure Front Door Premium for:
- Global load balancing with latency-based routing
- Web Application Firewall (WAF) protection
- SSL offloading at the edge
- Health probes for automatic failover

## Consequences
- Additional cost for Front Door Premium SKU
- Need to configure proper health endpoints
- SSL certificates managed at Front Door level
- Reduced latency for users globally

## Alternatives Considered
- Azure Traffic Manager: DNS-based only, no WAF
- Application Gateway: Regional only
- Third-party CDN: Additional vendor management
```

## Conclusion

The Azure Architecture Center provides invaluable guidance for building cloud solutions. By following reference architectures and adapting them to your specific needs, you can avoid common pitfalls and implement proven patterns. Always consider the trade-offs of each architectural decision and document them for future reference.

## References

- [Azure Architecture Center](https://docs.microsoft.com/en-us/azure/architecture/)
- [Reference Architectures](https://docs.microsoft.com/en-us/azure/architecture/architectures/)
- [Cloud Design Patterns](https://docs.microsoft.com/en-us/azure/architecture/patterns/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
