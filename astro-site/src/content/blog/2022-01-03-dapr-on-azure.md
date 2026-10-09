---
title: "Dapr on Azure: Building Distributed Applications Made Easy"
description: "Dapr on Azure simplifies building resilient, scalable microservices while leveraging Azure's managed services. The combination provides both portability and…"
author: Michael John Peña
draft: false
date: 2022-01-03
url: /blog/dapr-on-azure/
tags:
  - Azure
  - Dapr
  - Microservices
  - distributed-systems
---

## What is Dapr?

Dapr provides a set of building blocks that abstract common distributed system challenges:
- Service-to-service invocation
- State management
- Pub/sub messaging
- Bindings to external systems
- Actors
- Observability
- Secrets management

## Setting Up Dapr on Azure Kubernetes Service

First, let's install Dapr on AKS:

```bash
# Install Dapr CLI
wget -q https://raw.githubusercontent.com/dapr/cli/master/install/install.sh -O - | /bin/bash

# Initialize Dapr on your Kubernetes cluster
dapr init -k

# Verify installation
dapr status -k
```

## Configuring Azure Components

Dapr components connect your application to Azure services. Here's a state store using Azure Cosmos DB:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: statestore
  namespace: default
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
    value: "daprdb"
  - name: collection
    value: "daprstate"
```

## Pub/Sub with Azure Service Bus

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: pubsub
  namespace: default
spec:
  type: pubsub.azure.servicebus
  version: v1
  metadata:
  - name: connectionString
    secretKeyRef:
      name: servicebus-secret
      key: connectionString
```

## Using Dapr in Your Application

Here's a C# example using the Dapr SDK:

```csharp
using Dapr.Client;

public class OrderService
{
    private readonly DaprClient _daprClient;

    public OrderService(DaprClient daprClient)
    {
        _daprClient = daprClient;
    }

    public async Task<Order> GetOrderAsync(string orderId)
    {
        // Get state from Cosmos DB via Dapr
        var order = await _daprClient.GetStateAsync<Order>("statestore", orderId);
        return order;
    }

    public async Task SaveOrderAsync(Order order)
    {
        // Save state to Cosmos DB via Dapr
        await _daprClient.SaveStateAsync("statestore", order.Id, order);
    }

    public async Task PublishOrderCreatedAsync(Order order)
    {
        // Publish to Service Bus via Dapr
        await _daprClient.PublishEventAsync("pubsub", "orders", order);
    }

    public async Task<InventoryResponse> CheckInventoryAsync(string productId)
    {
        // Service-to-service invocation
        var response = await _daprClient.InvokeMethodAsync<InventoryRequest, InventoryResponse>(
            "inventory-service",
            "check",
            new InventoryRequest { ProductId = productId }
        );
        return response;
    }
}
```

## Secrets Management with Azure Key Vault

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: azurekeyvault
  namespace: default
spec:
  type: secretstores.azure.keyvault
  version: v1
  metadata:
  - name: vaultName
    value: "mykeyvault"
  - name: azureTenantId
    value: "[TENANT_ID]"
  - name: azureClientId
    value: "[CLIENT_ID]"
  - name: azureClientSecret
    secretKeyRef:
      name: kv-secret
      key: clientSecret
```

## Observability with Azure Monitor

Dapr integrates seamlessly with Azure Monitor for distributed tracing:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Configuration
metadata:
  name: daprConfig
spec:
  tracing:
    samplingRate: "1"
    zipkin:
      endpointAddress: "http://zipkin.default.svc.cluster.local:9411/api/v2/spans"
```

Dapr on Azure simplifies building resilient, scalable microservices while leveraging Azure's managed services. The combination provides both portability and deep cloud integration.
