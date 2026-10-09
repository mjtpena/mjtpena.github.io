---
title: "Azure Container Apps Updates: Serverless Containers at Scale"
description: "Container Apps provides a powerful, serverless container platform. Tomorrow, I will cover Jobs in Container Apps in more detail."
author: Michael John Peña
draft: false
date: 2023-05-28
tags:
  - Azure Container Apps
  - Containers
  - Kubernetes
  - Serverless
  - Azure
---

## Azure Container Apps Overview

Container Apps provides a serverless container platform built on Kubernetes but without the complexity:

```
┌─────────────────────────────────────────────────────┐
│            Azure Container Apps                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │           Container Apps Environment            ││
│  │  ┌─────────────┐  ┌─────────────┐              ││
│  │  │  App 1      │  │  App 2      │              ││
│  │  │  (HTTP)     │  │  (Event)    │              ││
│  │  └─────────────┘  └─────────────┘              ││
│  │  ┌─────────────┐  ┌─────────────┐              ││
│  │  │  Job 1      │  │  Job 2      │              ││
│  │  │  (Cron)     │  │  (Manual)   │              ││
│  │  └─────────────┘  └─────────────┘              ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│                        ▼                            │
│  ┌─────────────────────────────────────────────────┐│
│  │     Managed Kubernetes (KEDA, Envoy, Dapr)     ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Creating Container Apps

### Basic HTTP App

```bash
# Create environment
az containerapp env create \
    --name my-environment \
    --resource-group container-rg \
    --location eastus

# Create app from container image
az containerapp create \
    --name my-api \
    --resource-group container-rg \
    --environment my-environment \
    --image myregistry.azurecr.io/my-api:v1 \
    --target-port 8080 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 10 \
    --cpu 0.5 \
    --memory 1.0Gi
```

### Using Bicep

```bicep
// container-app.bicep
param location string = resourceGroup().location
param environmentName string
param appName string
param containerImage string
param targetPort int = 8080

resource environment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: location
  properties: {
    zoneRedundant: true
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'http'
        corsPolicy: {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE']
        }
      }
      registries: [
        {
          server: 'myregistry.azurecr.io'
          identity: 'system'
        }
      ]
      secrets: [
        {
          name: 'db-connection'
          value: 'Server=...;Database=...'
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
              name: 'DB_CONNECTION'
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
                port: targetPort
              }
              initialDelaySeconds: 10
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health/ready'
                port: targetPort
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
            name: 'http-rule'
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
  identity: {
    type: 'SystemAssigned'
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
```

## Container Apps Jobs (New!)

Jobs are perfect for batch processing and scheduled tasks:

```bicep
// container-app-job.bicep
resource job 'Microsoft.App/jobs@2023-05-01' = {
  name: 'data-processing-job'
  location: location
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: '0 0 * * *'  // Daily at midnight
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 1800  // 30 minutes
      replicaRetryLimit: 3
      registries: [
        {
          server: 'myregistry.azurecr.io'
          identity: 'system'
        }
      ]
      secrets: [
        {
          name: 'storage-connection'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'processor'
          image: 'myregistry.azurecr.io/data-processor:v1'
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            {
              name: 'STORAGE_CONNECTION'
              secretRef: 'storage-connection'
            }
          ]
        }
      ]
    }
  }
}
```

### Event-Driven Jobs

```bicep
resource eventJob 'Microsoft.App/jobs@2023-05-01' = {
  name: 'queue-processor-job'
  location: location
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Event'
      eventTriggerConfig: {
        parallelism: 5
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 100
          pollingInterval: 30
          rules: [
            {
              name: 'azure-queue'
              type: 'azure-queue'
              metadata: {
                queueName: 'processing-queue'
                queueLength: '10'
              }
              auth: [
                {
                  secretRef: 'storage-connection'
                  triggerParameter: 'connection'
                }
              ]
            }
          ]
        }
      }
      replicaTimeout: 300
      replicaRetryLimit: 2
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: 'myregistry.azurecr.io/queue-worker:v1'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}
```

### Manual Jobs

```python
from azure.mgmt.appcontainers import ContainerAppsAPIClient
from azure.identity import DefaultAzureCredential

client = ContainerAppsAPIClient(
    credential=DefaultAzureCredential(),
    subscription_id=subscription_id
)

# Start a manual job execution
execution = client.jobs.begin_start(
    resource_group_name="container-rg",
    job_name="manual-job",
    body={
        "template": {
            "containers": [
                {
                    "name": "processor",
                    "image": "myregistry.azurecr.io/processor:v1",
                    "env": [
                        {"name": "INPUT_FILE", "value": "data/input.csv"},
                        {"name": "OUTPUT_FILE", "value": "data/output.csv"}
                    ]
                }
            ]
        }
    }
).result()

print(f"Job execution started: {execution.name}")
```

## Advanced Scaling

```bicep
// Custom scaling rules
scale: {
  minReplicas: 0
  maxReplicas: 30
  rules: [
    {
      name: 'http-scaling'
      http: {
        metadata: {
          concurrentRequests: '50'
        }
      }
    }
    {
      name: 'cpu-scaling'
      custom: {
        type: 'cpu'
        metadata: {
          type: 'Utilization'
          value: '70'
        }
      }
    }
    {
      name: 'memory-scaling'
      custom: {
        type: 'memory'
        metadata: {
          type: 'Utilization'
          value: '80'
        }
      }
    }
    {
      name: 'queue-scaling'
      custom: {
        type: 'azure-servicebus'
        metadata: {
          queueName: 'orders'
          messageCount: '100'
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

```bicep
// Enable Dapr sidecar
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  // ... other properties
  properties: {
    configuration: {
      dapr: {
        enabled: true
        appId: 'my-service'
        appPort: 8080
        appProtocol: 'http'
      }
    }
  }
}

// Dapr components
resource stateStore 'Microsoft.App/managedEnvironments/daprComponents@2023-05-01' = {
  parent: environment
  name: 'statestore'
  properties: {
    componentType: 'state.azure.cosmosdb'
    version: 'v1'
    secrets: [
      {
        name: 'cosmos-key'
        value: cosmosKey
      }
    ]
    metadata: [
      {
        name: 'url'
        value: cosmosEndpoint
      }
      {
        name: 'masterKey'
        secretRef: 'cosmos-key'
      }
      {
        name: 'database'
        value: 'mydb'
      }
      {
        name: 'collection'
        value: 'state'
      }
    ]
    scopes: ['my-service']
  }
}
```

## Traffic Splitting

```bash
# Deploy new revision
az containerapp update \
    --name my-api \
    --resource-group container-rg \
    --image myregistry.azurecr.io/my-api:v2

# Split traffic 80/20
az containerapp ingress traffic set \
    --name my-api \
    --resource-group container-rg \
    --revision-weight my-api--v1=80 my-api--v2=20

# Full cutover
az containerapp ingress traffic set \
    --name my-api \
    --resource-group container-rg \
    --revision-weight my-api--v2=100
```

Container Apps provides a powerful, serverless container platform. Tomorrow, I will cover Jobs in Container Apps in more detail.

## Resources

- [Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [Dapr Integration](https://learn.microsoft.com/en-us/azure/container-apps/dapr-overview)
