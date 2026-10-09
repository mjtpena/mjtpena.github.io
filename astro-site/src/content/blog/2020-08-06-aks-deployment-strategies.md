---
title: "Deployment Strategies for Azure Kubernetes Service"
description: "\"How do we deploy a new version without downtime?\" That's the conversation that got me writing this post. AKS gives you the primitives, but the choice…"
author: Michael John Peña
draft: false
date: 2020-08-06
tags:
  - Azure
  - Kubernetes
  - AKS
  - DevOps
---

"How do we deploy a new version without downtime?" That's the conversation that got me writing this post. AKS gives you the primitives, but the choice between rolling, blue-green, and canary depends on what your application is willing to tolerate during the swap — and how much complexity your team is willing to operate. Notes on the three I actually use, and when I reach for which.

## Prerequisites

```bash
# Create an AKS cluster
az aks create \
    --resource-group rg-aks \
    --name aks-cluster \
    --node-count 3 \
    --enable-addons monitoring \
    --generate-ssh-keys

# Get credentials
az aks get-credentials --resource-group rg-aks --name aks-cluster
```

## Rolling Update (Default)

The default strategy replaces pods gradually:

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myregistry.azurecr.io/myapp:v1
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /health
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 80
            initialDelaySeconds: 15
            periodSeconds: 20
```

Deploy and update:

```bash
# Initial deployment
kubectl apply -f deployment.yaml

# Update the image
kubectl set image deployment/myapp myapp=myregistry.azurecr.io/myapp:v2

# Watch the rollout
kubectl rollout status deployment/myapp

# Rollback if needed
kubectl rollout undo deployment/myapp
```

## Blue-Green Deployment

Run two identical environments and switch traffic:

```yaml
# blue-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
    spec:
      containers:
        - name: myapp
          image: myregistry.azurecr.io/myapp:v1
          ports:
            - containerPort: 80
---
# green-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
        - name: myapp
          image: myregistry.azurecr.io/myapp:v2
          ports:
            - containerPort: 80
---
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
    version: blue  # Switch to green when ready
  ports:
    - port: 80
      targetPort: 80
```

Switch traffic:

```bash
# Deploy green version
kubectl apply -f green-deployment.yaml

# Test green deployment (via port-forward or internal service)
kubectl port-forward deployment/myapp-green 8080:80

# Switch traffic to green
kubectl patch service myapp -p '{"spec":{"selector":{"version":"green"}}}'

# Clean up blue deployment
kubectl delete deployment myapp-blue
```

## Canary Deployment

Route a percentage of traffic to the new version:

```yaml
# stable-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-stable
spec:
  replicas: 9
  selector:
    matchLabels:
      app: myapp
      track: stable
  template:
    metadata:
      labels:
        app: myapp
        track: stable
    spec:
      containers:
        - name: myapp
          image: myregistry.azurecr.io/myapp:v1
---
# canary-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-canary
spec:
  replicas: 1  # 10% of total (1 out of 10)
  selector:
    matchLabels:
      app: myapp
      track: canary
  template:
    metadata:
      labels:
        app: myapp
        track: canary
    spec:
      containers:
        - name: myapp
          image: myregistry.azurecr.io/myapp:v2
---
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp  # Matches both stable and canary
  ports:
    - port: 80
      targetPort: 80
```

Gradually shift traffic:

```bash
# Scale canary up, stable down
kubectl scale deployment myapp-canary --replicas=3
kubectl scale deployment myapp-stable --replicas=7

# Continue until fully migrated
kubectl scale deployment myapp-canary --replicas=10
kubectl scale deployment myapp-stable --replicas=0
```

## Using Helm for Deployments

```bash
# Create a Helm chart
helm create myapp

# Install
helm install myapp ./myapp --set image.tag=v1

# Upgrade
helm upgrade myapp ./myapp --set image.tag=v2

# Rollback
helm rollback myapp 1
```

## Health Checks Are Critical

Always configure proper probes:

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 80
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /health
    port: 80
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /health
    port: 80
  failureThreshold: 30
  periodSeconds: 10
```

## Monitoring Deployments

```bash
# Watch deployment progress
kubectl get deployments -w

# Check events
kubectl get events --sort-by='.lastTimestamp'

# View pod logs
kubectl logs -f deployment/myapp
```

## Which one I actually pick

- **Rolling update**: my default. Stateless web APIs, internal services, anywhere a brief mixed-version state is acceptable. It's free, it's built-in, and rollbacks are one command.
- **Blue-green**: when the cost of a bad deployment is high and the application can't tolerate two versions running at once. Database schema changes are the classic case — although those still need backwards-compatible migrations underneath.
- **Canary**: when I genuinely want to measure the new version against the old before committing. Honest take: pure replica-count canary like above is crude. If you care about real canarying, you want a service mesh (Linkerd or Istio) doing weighted traffic split, plus an automated promote/rollback driven by metrics. Without that, "canary" is just a slow blue-green.

The probe configuration matters more than the strategy. A misconfigured `livenessProbe` can take down a healthy pod faster than any deployment mistake. Tune the readiness path to actually reflect "ready to serve traffic" — including warm caches, JIT, and dependent connections — and the rest of this gets a lot easier.
