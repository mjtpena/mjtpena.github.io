---
title: "Azure Kubernetes Service: Simplifying Container Orchestration"
author: Michael John Peña
draft: false
date: 2021-01-06
tags:
  - Azure
  - Kubernetes
  - Containers
  - AKS

---

I wrote "Azure Kubernetes Service: Simplifying Container Orchestration" to share practical, production-minded guidance on this topic.

## Why AKS in 2021?

With containers becoming the standard deployment unit for modern applications, AKS provides:
- Managed control plane (no cluster management overhead)
- Integration with Azure services
- Enterprise-grade security and compliance
- Cost-effective scaling options

## AKS vs Other Container Options

| Feature | AKS | Container Instances | App Service |
|---------|-----|---------------------|-------------|
| Kubernetes | Full access | None | None |
| Scaling | Auto (HPA/KEDA) | Manual | Auto |
| Networking | Full control | Basic | Managed |
| Best for | Microservices | Simple containers | Web apps |

## Create AKS Cluster

```bash
# Create resource group
az group create --name myRG --location eastus

# Create AKS cluster
az aks create \
    --resource-group myRG \
    --name myAKSCluster \
    --node-count 3 \
    --enable-addons monitoring \
    --generate-ssh-keys

# Get credentials
az aks get-credentials --resource-group myRG --name myAKSCluster
```

## Deploying Applications

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-api
  template:
    metadata:
      labels:
        app: my-api
    spec:
      containers:
      - name: my-api
        image: myacr.azurecr.io/my-api:v1
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
        env:
        - name: CONNECTION_STRING
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: connection-string\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
