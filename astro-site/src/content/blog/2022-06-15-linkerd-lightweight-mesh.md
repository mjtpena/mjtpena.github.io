---
title: "Linkerd: Lightweight Service Mesh for Kubernetes"
author: Michael John Peña
draft: false
date: 2022-06-15
tags:
  - linkerd
  - service-mesh
  - kubernetes
  - microservices

---

I wrote "Linkerd: Lightweight Service Mesh for Kubernetes" to share practical, production-minded guidance on this topic.

## Installation

```bash
# Install CLI
curl -sL https://run.linkerd.io/install | sh
export PATH=$PATH:$HOME/.linkerd2/bin

# Check prerequisites
linkerd check --pre

# Install on cluster
linkerd install | kubectl apply -f -

# Verify
linkerd check
```

## Injecting Sidecars

```bash
# Annotate namespace
kubectl annotate namespace default linkerd.io/inject=enabled

# Or inject existing deployment
kubectl get deploy -o yaml | linkerd inject - | kubectl apply -f -
```

## Traffic Split

```yaml
apiVersion: split.smi-spec.io/v1alpha1
kind: TrafficSplit
metadata:
  name: canary-split
spec:
  service: api
  backends:
  - service: api-v1
    weight: 900m
  - service: api-v2
    weight: 100m
```

## Observability

```bash
# Dashboard
linkerd viz dashboard

# Metrics
linkerd viz stat deploy

# Top requests
linkerd viz top deploy/api
```

## Summary

Linkerd offers simplicity and low overhead, ideal for teams wanting service mesh benefits without complexity.


