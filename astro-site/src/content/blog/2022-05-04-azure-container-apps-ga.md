---
title: "Azure Container Apps GA: Serverless Containers Made Simple"
author: Michael John Peña
draft: false
date: 2022-05-04
tags:
  - azure
  - container-apps
  - serverless
  - kubernetes

---

I wrote "Azure Container Apps GA: Serverless Containers Made Simple" to share practical, production-minded guidance on this topic.

## What Makes Container Apps Different?

Unlike AKS where you manage the cluster, Container Apps abstracts away the infrastructure. You focus on your containers while Azure handles scaling, load balancing, and orchestration.

## Getting Started

Deploy your first container app:

```bash
# Create resource group
az group create --name container-apps-rg --location eastus

# Create Container Apps environment
az containerapp env create \
    --name my-environment \
    --resource-group container-apps-rg \
    --location eastus

# Deploy a container app
az containerapp create \
    --name my-api \
    --resource-group container-apps-rg \
    --environment my-environment \
    --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
    --target-port 80 \
    --ingress 'external' \
    --min-replicas 0 \
    --max-replicas 10
```

## Bicep Deployment

Deploy infrastructure as code:

```bicep
@description('Container Apps Environment name')
param environmentName string

@description('Location for resources')
param location string = resourceGroup().location

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2021-12-01-preview' = {
  name: '${environmentName}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

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

resource apiApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'api-service'
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'db-connection'
          value: 'Server=myserver;Database=mydb;'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: 'myregistry.azurecr.io/api:latest'
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

output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
```

## Building a Microservices Application

Create a complete microservices solution:

```csharp
// OrderService/Program.cs
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHttpClient<IInventoryService, InventoryService>(client =>
{
    client.BaseAddress = new Uri(
        Environment.GetEnvironmentVariable("INVENTORY_SERVICE_URL")
        ?? "http://inventory-service");
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.MapPost("/orders", async (Order order, IInventoryService inventory) =>
{
    // Check inventory
    var available = await inventory.CheckAvailabilityAsync(order.ProductId, order.Quantity);
    if (!available)
    {
        return Results.BadRequest("Insufficient inventory");
    }

    // Reserve inventory
    await inventory.ReserveAsync(order.ProductId, order.Quantity);

    // Create order
    order.Id = Guid.NewGuid();
    order.Status = "Created";
    order.CreatedAt = DateTime.UtcNow;

    return Results.Created($"/orders/{order.Id}", order);
});

app.MapGet("/orders/{id}", (Guid id) =>
{
    // Retrieve order from database
    return Results.Ok(new Order { Id = id, Status = "Processing" });
});

app.Run();

public record Order
{
    public Guid Id { get; set; }
    public string ProductId { get; set; }
    public int Quantity { get; set; }
    public string Status { get; set; }
    public DateTime CreatedAt { get; set; }
}

public interface IInventoryService
{
    Task<bool> CheckAvailabilityAsync(string productId, int quantity);
    Task ReserveAsync(string productId, int quantity);
}

public class InventoryService : IInventoryService
{
    private readonly HttpClient _httpClient;

    public InventoryService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<bool> CheckAvailabilityAsync(string productId, int quantity)
    {
        var response = await _httpClient.GetAsync($"/inventory/{productId}");
        if (response.IsSuccessStatusCode)
        {
            var inventory = await response.Content.ReadFromJsonAsync<InventoryItem>();
            return inventory?.Quantity >= quantity;
        }
        return false;
    }

    public async Task ReserveAsync(string productId, int quantity)
    {
        await _httpClient.PostAsJsonAsync("/inventory/reserve",
            new { ProductId = productId, Quantity = quantity });
    }
}

public record InventoryItem(string ProductId, int Quantity);
```

## KEDA-Based Autoscaling

Configure advanced scaling rules:

```yaml
# container-app.yaml
properties:
  template:
    scale:
      minReplicas: 0
      maxReplicas: 30
      rules:
        - name: azure-servicebus-queue
          custom:
            type: azure-servicebus
            metadata:
              queueName: orders
              messageCount: "5"
            auth:
              - secretRef: servicebus-connection
                triggerParameter: connection
        - name: cpu-scaling
          custom:
            type: cpu
            metadata:
              type: Utilization
              value: "70"
```

## Dapr Integration

Enable Dapr for service-to-service communication:

```bicep
resource orderService 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'order-service'
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

Using Dapr in your application:

```csharp
using Dapr.Client;

public class OrderProcessor
{
    private readonly DaprClient _daprClient;

    public OrderProcessor(DaprClient daprClient)
    {
        _daprClient = daprClient;
    }

    public async Task ProcessOrderAsync(Order order)
    {
        // Invoke inventory service via Dapr
        var inventoryResponse = await _daprClient.InvokeMethodAsync<InventoryRequest, InventoryResponse>(
            "inventory-service",
            "check-inventory",
            new InventoryRequest(order.ProductId, order.Quantity));

        if (inventoryResponse.Available)
        {
            // Publish event to message broker
            await _daprClient.PublishEventAsync(
                "pubsub",
                "order-created",
                order);

            // Save state
            await _daprClient.SaveStateAsync("statestore", order.Id.ToString(), order);
        }
    }
}
```

## Revisions and Traffic Splitting

Deploy new versions with traffic splitting:

```bash
# Create a new revision
az containerapp update \
    --name my-api \
    --resource-group container-apps-rg \
    --image myregistry.azurecr.io/api:v2 \
    --revision-suffix v2

# Split traffic between revisions
az containerapp ingress traffic set \
    --name my-api \
    --resource-group container-apps-rg \
    --revision-weight my-api--v1=80 my-api--v2=20
```

## Summary

Azure Container Apps provides:

- Serverless container hosting without cluster management
- Built-in autoscaling with KEDA
- Native Dapr integration for microservices patterns
- Traffic splitting for blue-green deployments
- Pay-per-use pricing model

It is ideal for microservices, APIs, event-driven applications, and background processing jobs.


