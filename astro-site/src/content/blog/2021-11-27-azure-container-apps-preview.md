---
title: "Azure Container Apps Preview: Serverless Containers Made Simple"
author: Michael John Pena
draft: false
date: 2021-11-27
tags:
  - Azure
  - Containers
  - Kubernetes
  - Serverless
  - KEDA
  - Dapr

---

I wrote "Azure Container Apps Preview: Serverless Containers Made Simple" to share practical, production-minded guidance on this topic.

## What is Azure Container Apps?

Container Apps provides:

- **Serverless containers**: No cluster management
- **Autoscaling**: Scale to zero and scale on events with KEDA
- **Microservices**: Built-in Dapr for service invocation, state, pub/sub
- **Revisions**: Traffic splitting and blue-green deployments
- **Ingress**: HTTP ingress with SSL termination

## Creating a Container App

### Azure CLI

```bash
# Create resource group
az group create --name rg-containerapps --location eastus

# Create Container Apps environment
az containerapp env create \
    --name my-environment \
    --resource-group rg-containerapps \
    --location eastus

# Create container app from image
az containerapp create \
    --name my-api \
    --resource-group rg-containerapps \
    --environment my-environment \
    --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
    --target-port 80 \
    --ingress external \
    --query properties.configuration.ingress.fqdn

# Create with custom configuration
az containerapp create \
    --name my-api \
    --resource-group rg-containerapps \
    --environment my-environment \
    --image myregistry.azurecr.io/myapi:v1 \
    --registry-server myregistry.azurecr.io \
    --registry-username $ACR_USERNAME \
    --registry-password $ACR_PASSWORD \
    --target-port 8080 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 10 \
    --cpu 0.5 \
    --memory 1Gi \
    --env-vars "DATABASE_URL=secretref:db-connection" \
    --secrets "db-connection=Server=myserver;Database=mydb"
```

### Bicep Template

```bicep
param location string = resourceGroup().location
param environmentName string
param appName string
param containerImage string
param containerPort int = 80

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
        targetPort: containerPort
        transport: 'auto'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        {
          server: 'myregistry.azurecr.io'
          username: acrUsername
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'db-connection'
          value: dbConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: 'db-connection'
            }
            {
              name: 'ASPNETCORE_ENVIRONMENT'
              value: 'Production'
            }
          ]
          probes: [
            {
              type: 'liveness'
              httpGet: {
                path: '/health'
                port: containerPort
              }
              initialDelaySeconds: 10
              periodSeconds: 10
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/ready'
                port: containerPort
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
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2021-06-01' = {
  name: '${environmentName}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
```

## Event-Driven Scaling with KEDA

### Scale on HTTP

```yaml
# container-app.yaml
properties:
  template:
    scale:
      minReplicas: 0
      maxReplicas: 20
      rules:
        - name: http-rule
          http:
            metadata:
              concurrentRequests: "100"
```

### Scale on Azure Queue

```bicep
resource queueWorker 'Microsoft.App/containerApps@2022-03-01' = {
  name: 'queue-worker'
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      secrets: [
        {
          name: 'queue-connection'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: 'myregistry.azurecr.io/worker:v1'
          env: [
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING'
              secretRef: 'queue-connection'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 30
        rules: [
          {
            name: 'queue-rule'
            azureQueue: {
              queueName: 'work-items'
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

### Scale on Service Bus

```bicep
scale: {
  minReplicas: 0
  maxReplicas: 50
  rules: [
    {
      name: 'servicebus-rule'
      custom: {
        type: 'azure-servicebus'
        metadata: {
          queueName: 'orders'
          messageCount: '5'
        }
        auth: [
          {
            secretRef: 'sb-connection'
            triggerParameter: 'connection'
          }
        ]
      }
    }
  ]
}
```

## Dapr Integration

### Enable Dapr

```bicep
resource daprApp 'Microsoft.App/containerApps@2022-03-01' = {
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
          image: 'myregistry.azurecr.io/order-service:v1'
        }
      ]
    }
  }
}
```

### Dapr State Store

```yaml
# dapr-components/statestore.yaml
componentType: state.azure.cosmosdb
version: v1
metadata:
  - name: url
    value: https://mycosmosaccount.documents.azure.com:443/
  - name: database
    value: orders
  - name: collection
    value: state
  - name: masterKey
    secretRef: cosmos-key
secrets:
  - name: cosmos-key
    value: ${COSMOS_KEY}
scopes:
  - order-service
```

Deploy Dapr component:

```bash
az containerapp env dapr-component set \
    --name my-environment \
    --resource-group rg-containerapps \
    --dapr-component-name statestore \
    --yaml dapr-components/statestore.yaml
```

### Service Invocation

```csharp
// Order Service calling Inventory Service via Dapr
public class OrderService
{
    private readonly DaprClient _daprClient;

    public OrderService(DaprClient daprClient)
    {
        _daprClient = daprClient;
    }

    public async Task<Order> CreateOrderAsync(CreateOrderRequest request)
    {
        // Check inventory via Dapr service invocation
        var inventory = await _daprClient.InvokeMethodAsync<InventoryRequest, InventoryResponse>(
            "inventory-service",
            "check",
            new InventoryRequest { ProductId = request.ProductId, Quantity = request.Quantity }
        );

        if (!inventory.Available)
        {
            throw new InvalidOperationException("Insufficient inventory");
        }

        // Save state via Dapr state store
        var order = new Order
        {
            Id = Guid.NewGuid().ToString(),
            ProductId = request.ProductId,
            Quantity = request.Quantity,
            Status = "Created"
        };

        await _daprClient.SaveStateAsync("statestore", order.Id, order);

        // Publish event via Dapr pub/sub
        await _daprClient.PublishEventAsync("pubsub", "orders", new OrderCreatedEvent
        {
            OrderId = order.Id,
            ProductId = order.ProductId
        });

        return order;
    }
}
```

### Pub/Sub Component

```yaml
# dapr-components/pubsub.yaml
componentType: pubsub.azure.servicebus
version: v1
metadata:
  - name: connectionString
    secretRef: sb-connection
secrets:
  - name: sb-connection
    value: ${SERVICE_BUS_CONNECTION}
scopes:
  - order-service
  - notification-service
```

## Traffic Splitting and Revisions

### Blue-Green Deployment

```bash
# Deploy new revision
az containerapp update \
    --name my-api \
    --resource-group rg-containerapps \
    --image myregistry.azurecr.io/myapi:v2

# Split traffic
az containerapp ingress traffic set \
    --name my-api \
    --resource-group rg-containerapps \
    --revision-weight my-api--v1=80 my-api--v2=20

# Roll forward
az containerapp ingress traffic set \
    --name my-api \
    --resource-group rg-containerapps \
    --revision-weight my-api--v2=100

# Rollback
az containerapp ingress traffic set \
    --name my-api \
    --resource-group rg-containerapps \
    --revision-weight my-api--v1=100
```

### Revision Mode Configuration

```bicep
configuration: {
  activeRevisionsMode: 'multiple'
  ingress: {
    external: true
    targetPort: 8080
    traffic: [
      {
        revisionName: '${appName}--v1'
        weight: 80
      }
      {
        revisionName: '${appName}--v2'
        weight: 20
      }
    ]
  }
}
```

## GitHub Actions Deployment

```yaml
name: Deploy to Container Apps

on:
  push:
    branches: [main]

env:
  REGISTRY: myregistry.azurecr.io
  IMAGE_NAME: myapi

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Login to ACR
        uses: docker/login-action@v2
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and push
        uses: docker/build-push-action@v3
        with:
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Container Apps
        uses: azure/container-apps-deploy-action@v1
        with:
          resourceGroup: rg-containerapps
          containerAppName: my-api
          imageToDeploy: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
```

Azure Container Apps provides a sweet spot between serverless functions and full Kubernetes - the power of containers without the operational complexity of managing clusters.

## Resources

- [Container Apps Documentation](https://docs.microsoft.com/en-us/azure/container-apps/)
- [KEDA Scalers](https://keda.sh/docs/scalers/)
- [Dapr Documentation](https://docs.dapr.io/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
