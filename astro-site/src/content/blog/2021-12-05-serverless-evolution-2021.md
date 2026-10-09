---
title: "The Serverless Evolution: Where We Landed in 2021"
description: "Serverless in 2021 proved it's not just for simple APIs. Complex, stateful, event-driven applications are running successfully in production. The technology…"
author: Michael John Pena
draft: false
date: 2021-12-05
tags:
  - Serverless
  - Azure Functions
  - Event-Driven
  - Cloud
  - FaaS
---

## Azure Functions Durable Entities

Stateful serverless became practical with Durable Entities:

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.DurableTask;
using System.Threading.Tasks;

// Define a counter entity
[FunctionName("Counter")]
public static void Counter([EntityTrigger] IDurableEntityContext ctx)
{
    switch (ctx.OperationName.ToLowerInvariant())
    {
        case "add":
            ctx.SetState(ctx.GetState<int>() + ctx.GetInput<int>());
            break;
        case "reset":
            ctx.SetState(0);
            break;
        case "get":
            ctx.Return(ctx.GetState<int>());
            break;
    }
}

// Orchestrator using the entity
[FunctionName("ProcessOrderOrchestrator")]
public static async Task<string> ProcessOrder(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var order = context.GetInput<Order>();
    var entityId = new EntityId("Counter", $"orders-{order.CustomerId}");

    // Increment order count atomically
    await context.CallEntityAsync(entityId, "add", 1);

    // Get current count
    var count = await context.CallEntityAsync<int>(entityId, "get");

    if (count >= 10)
    {
        // Apply loyalty discount
        await context.CallActivityAsync("ApplyLoyaltyDiscount", order);
    }

    return $"Order processed. Customer has {count} orders.";
}
```

## The Serverless Data Processing Pattern

Processing data at scale without managing infrastructure:

```python
import azure.functions as func
import json
from azure.storage.blob import BlobServiceClient
import pandas as pd
import io

def main(event: func.EventHubEvent, outputBlob: func.Out[bytes]):
    """Process IoT events and write aggregated results"""

    events = []
    for e in event:
        body = e.get_body().decode('utf-8')
        data = json.loads(body)
        events.append({
            'device_id': data['deviceId'],
            'temperature': data['temperature'],
            'humidity': data['humidity'],
            'timestamp': data['timestamp'],
            'partition_key': e.partition_key
        })

    # Create DataFrame for processing
    df = pd.DataFrame(events)

    # Aggregate by device
    aggregated = df.groupby('device_id').agg({
        'temperature': ['mean', 'min', 'max'],
        'humidity': ['mean', 'min', 'max'],
        'timestamp': 'count'
    }).round(2)

    aggregated.columns = ['_'.join(col).strip() for col in aggregated.columns]
    aggregated = aggregated.reset_index()

    # Output to blob storage
    output = io.BytesIO()
    aggregated.to_parquet(output, index=False)
    outputBlob.set(output.getvalue())
```

## Serverless Containers with Azure Container Apps

The gap between functions and containers narrowed:

```yaml
# Azure Container Apps - serverless containers
apiVersion: 2022-01-01-preview
kind: ContainerApp
metadata:
  name: api-service
spec:
  configuration:
    activeRevisionsMode: Multiple
    ingress:
      external: true
      targetPort: 8080
      traffic:
        - latestRevision: true
          weight: 80
        - revisionName: api-service--v1
          weight: 20
    secrets:
      - name: connection-string
        value: ${CONNECTION_STRING}
    dapr:
      enabled: true
      appId: api-service
      appPort: 8080
  template:
    containers:
      - name: api
        image: myregistry.azurecr.io/api:latest
        resources:
          cpu: 0.5
          memory: 1Gi
        env:
          - name: DB_CONNECTION
            secretRef: connection-string
    scale:
      minReplicas: 0
      maxReplicas: 10
      rules:
        - name: http-scaling
          http:
            metadata:
              concurrentRequests: "100"
        - name: queue-scaling
          azureQueue:
            queueName: orders
            queueLength: 50
```

## Event-Driven Patterns Solidified

The combination of Event Grid, Functions, and Logic Apps became powerful:

```csharp
using Azure.Messaging.EventGrid;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.EventGrid;
using Microsoft.Extensions.Logging;

public static class OrderEventProcessor
{
    [FunctionName("ProcessOrderCreated")]
    public static async Task ProcessOrderCreated(
        [EventGridTrigger] EventGridEvent eventGridEvent,
        [CosmosDB(
            databaseName: "orders",
            collectionName: "events",
            ConnectionStringSetting = "CosmosDBConnection")] IAsyncCollector<dynamic> documents,
        [ServiceBus(
            "notifications",
            Connection = "ServiceBusConnection")] IAsyncCollector<string> notifications,
        ILogger log)
    {
        var data = eventGridEvent.Data.ToObjectFromJson<OrderCreatedEvent>();

        // Store event for event sourcing
        await documents.AddAsync(new
        {
            id = eventGridEvent.Id,
            eventType = eventGridEvent.EventType,
            subject = eventGridEvent.Subject,
            data = data,
            timestamp = eventGridEvent.EventTime,
            partitionKey = data.CustomerId
        });

        // Trigger downstream notifications
        if (data.TotalAmount > 1000)
        {
            await notifications.AddAsync(JsonSerializer.Serialize(new
            {
                Type = "HighValueOrder",
                OrderId = data.OrderId,
                CustomerId = data.CustomerId,
                Amount = data.TotalAmount
            }));
        }

        log.LogInformation($"Processed order {data.OrderId} for ${data.TotalAmount}");
    }
}
```

## Cold Start Optimization

Cold starts remained a challenge, but we found solutions:

```csharp
// Premium plan with pre-warmed instances
// host.json configuration
{
    "version": "2.0",
    "extensions": {
        "http": {
            "routePrefix": "api",
            "maxOutstandingRequests": 200,
            "maxConcurrentRequests": 100
        }
    },
    "functionTimeout": "00:10:00",
    "logging": {
        "applicationInsights": {
            "samplingSettings": {
                "isEnabled": true,
                "maxTelemetryItemsPerSecond": 20
            }
        }
    }
}
```

```typescript
// Minimize cold start with lazy loading
import { AzureFunction, Context, HttpRequest } from "@azure/functions";

// Only import what's needed at module level
let cosmosClient: CosmosClient | null = null;

const getCosmosClient = async () => {
    if (!cosmosClient) {
        const { CosmosClient } = await import("@azure/cosmos");
        cosmosClient = new CosmosClient(process.env.COSMOS_CONNECTION!);
    }
    return cosmosClient;
};

const httpTrigger: AzureFunction = async function (
    context: Context,
    req: HttpRequest
): Promise<void> {
    const client = await getCosmosClient();
    const { database } = await client.databases.createIfNotExists({ id: "mydb" });
    const { container } = await database.containers.createIfNotExists({ id: "items" });

    const { resources } = await container.items.query({
        query: "SELECT * FROM c WHERE c.status = @status",
        parameters: [{ name: "@status", value: req.query.status || "active" }]
    }).fetchAll();

    context.res = {
        body: resources
    };
};

export default httpTrigger;
```

## Lessons from 2021

1. **Serverless Isn't Always Cheaper**: At scale, the cost model can flip
2. **Cold Starts Matter**: For latency-sensitive workloads, plan accordingly
3. **Stateful Patterns Work**: Durable Functions and entities are production-ready
4. **Vendor Lock-in is Real**: Abstract where possible, accept where necessary

## Looking to 2022

- More sophisticated scaling algorithms
- Better tooling for local development
- Improved observability and debugging
- Serverless databases gaining traction

Serverless in 2021 proved it's not just for simple APIs. Complex, stateful, event-driven applications are running successfully in production. The technology has matured - now it's about choosing the right tool for each job.

## Resources

- [Azure Functions Documentation](https://docs.microsoft.com/en-us/azure/azure-functions/)
- [Durable Functions Patterns](https://docs.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-overview)
- [Azure Container Apps](https://docs.microsoft.com/en-us/azure/container-apps/)
