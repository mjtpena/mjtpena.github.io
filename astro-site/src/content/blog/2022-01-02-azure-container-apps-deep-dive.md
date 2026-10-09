---
title: "Azure Container Apps Deep Dive: The Future of Serverless Containers"
description: "Azure Container Apps is a fully managed serverless container service that enables you to run microservices and containerized applications without managing…"
author: Michael John Peña
draft: false
date: 2022-01-02
url: /blog/azure-container-apps-deep-dive/
tags:
  - Azure
  - Containers
  - Serverless
  - Kubernetes
---

## What Are Azure Container Apps?

Azure Container Apps is a fully managed serverless container service that enables you to run microservices and containerized applications without managing infrastructure. It's built on top of Kubernetes and Dapr but abstracts away the complexity.

## Architecture Overview

Container Apps run within a Container Apps Environment, which provides a secure boundary for your applications. Multiple apps can share the same environment and communicate securely.

```bicep
resource environment 'Microsoft.App/managedEnvironments@2022-01-01-preview' = {
  name: 'my-container-environment'
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
```

## Creating Your First Container App

Here's a complete example of deploying a container app with HTTP ingress:

```bicep
resource containerApp 'Microsoft.App/containerApps@2022-01-01-preview' = {
  name: 'api-service'
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: 8080
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: [
        {
          name: 'connection-string'
          value: connectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: 'myregistry.azurecr.io/api:v1'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'CONNECTION_STRING'
              secretRef: 'connection-string'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 30
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

## Scaling with KEDA

Container Apps use KEDA (Kubernetes Event-Driven Autoscaling) under the hood. You can scale based on various triggers:

```bicep
scale: {
  minReplicas: 0
  maxReplicas: 100
  rules: [
    {
      name: 'queue-scaling'
      custom: {
        type: 'azure-servicebus'
        metadata: {
          queueName: 'orders'
          messageCount: '50'
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

## Dapr Integration

One of the most powerful features is built-in Dapr support:

```bicep
template: {
  containers: [...]
  dapr: {
    enabled: true
    appId: 'my-app'
    appPort: 8080
    appProtocol: 'http'
  }
}
```

## When to Use Container Apps

- Microservices that need to scale to zero
- Event-driven applications
- Background processing jobs
- APIs and web applications
- When you want Kubernetes benefits without the complexity

Azure Container Apps represents a significant step forward in making containerization accessible to all developers, not just Kubernetes experts.
