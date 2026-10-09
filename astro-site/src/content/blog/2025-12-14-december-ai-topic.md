---
title: "Azure Container Apps vs Azure Kubernetes Service: When to Use Each"
author: Michael John Peña
draft: false
date: 2025-12-14
tags:
  - Azure
  - container-apps
  - AKS
  - Kubernetes
  - Architecture
---

## Quick Decision Framework

**Choose Container Apps when:**
- You want managed infrastructure
- Your team lacks Kubernetes expertise
- You have event-driven or HTTP workloads
- You need rapid time-to-production

**Choose AKS when:**
- You need full Kubernetes control
- You have complex networking requirements
- Your team has Kubernetes experience
- You need specific Kubernetes features

## Feature Comparison

| Capability | Container Apps | AKS |
|------------|---------------|-----|
| Management Overhead | Low | High |
| Scaling | Built-in KEDA | Manual KEDA setup |
| Networking | Simplified | Full control |
| Service Mesh | Built-in Dapr | Install Istio/Linkerd |
| Cost Model | Per-request/vCPU | Per-node |
| Custom Resources | No | Yes |

## Container Apps Example

```yaml
# containerapp.yaml
name: api-service
properties:
  configuration:
    ingress:
      external: true
      targetPort: 8080
      traffic:
        - latestRevision: true
          weight: 100
    secrets:
      - name: db-connection
        value: ${DB_CONNECTION_STRING}
  template:
    containers:
      - name: api
        image: myregistry.azurecr.io/api:latest
        resources:
          cpu: 0.5
          memory: 1Gi
        env:
          - name: DATABASE_URL
            secretRef: db-connection
    scale:
      minReplicas: 1
      maxReplicas: 10
      rules:
        - name: http-scaling
          http:
            metadata:
              concurrentRequests: 100
```

```bash
# Deploy with Azure CLI
az containerapp create \
  --name api-service \
  --resource-group myRG \
  --environment myEnv \
  --yaml containerapp.yaml
```

## AKS Example

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-service
  template:
    metadata:
      labels:
        app: api-service
    spec:
      containers:
      - name: api
        image: myregistry.azurecr.io/api:latest
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: connection-string
```
