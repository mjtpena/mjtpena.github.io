---
title: "Dapr vs Service Mesh: Choosing the Right Approach"
author: Michael John Peña
draft: false
date: 2022-06-17
tags:
  - dapr
  - service-mesh
  - microservices
  - kubernetes

---

I wrote "Dapr vs Service Mesh: Choosing the Right Approach" to share practical, production-minded guidance on this topic.

## Key Differences

| Aspect | Dapr | Service Mesh |
|--------|------|--------------|
| Focus | Application building blocks | Network infrastructure |
| mTLS | Via mesh integration | Native |
| State Management | Built-in | Not provided |
| Pub/Sub | Built-in | Not provided |
| Retries | Application-level | Network-level |

## When to Use Dapr

```yaml
# Dapr provides application capabilities
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    metadata:
      annotations:
        dapr.io/enabled: "true"
        dapr.io/app-id: "order-service"
    spec:
      containers:
      - name: order-service
        image: order-service:v1
```

Dapr usage:
```csharp
// State management
await daprClient.SaveStateAsync("statestore", "order-1", order);

// Pub/sub
await daprClient.PublishEventAsync("pubsub", "orders", order);

// Service invocation
var result = await daprClient.InvokeMethodAsync<Order>("payment-service", "process", order);
```

## When to Use Service Mesh

```yaml
# Service mesh provides network capabilities
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: order-service
spec:
  hosts:
  - order-service
  http:
  - timeout: 10s
    retries:
      attempts: 3
    route:
    - destination:
        host: order-service
```

## Using Both Together

Dapr can run with a service mesh for comprehensive capabilities:

```yaml
annotations:
  dapr.io/enabled: "true"
  sidecar.istio.io/inject: "true"
```

## Summary

Use Dapr for application building blocks, service mesh for network security and traffic management. They complement each other well.


