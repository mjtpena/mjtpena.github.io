---
title: "Service Mesh Comparison: Istio vs Linkerd vs Open Service Mesh"
author: Michael John Peña
draft: false
date: 2022-06-13
tags:
  - service-mesh
  - istio
  - linkerd
  - kubernetes

---

I wrote "Service Mesh Comparison: Istio vs Linkerd vs Open Service Mesh" to share practical, production-minded guidance on this topic.

## Feature Comparison

| Feature | Istio | Linkerd | OSM |
|---------|-------|---------|-----|
| mTLS | Yes | Yes | Yes |
| Traffic Management | Advanced | Basic | Moderate |
| Observability | Extensive | Good | Good |
| Resource Usage | High | Low | Moderate |
| Complexity | High | Low | Moderate |

## Istio

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews-route
spec:
  hosts:
  - reviews
  http:
  - match:
    - headers:
        user:
          exact: jason
    route:
    - destination:
        host: reviews
        subset: v2
  - route:
    - destination:
        host: reviews
        subset: v1
```

## Linkerd

```yaml
apiVersion: policy.linkerd.io/v1beta1
kind: Server
metadata:
  name: api-server
spec:
  podSelector:
    matchLabels:
      app: api
  port: 8080
```

## Open Service Mesh

```yaml
apiVersion: specs.smi-spec.io/v1alpha4
kind: TrafficSplit
metadata:
  name: canary-split
spec:
  service: api
  backends:
  - service: api-v1
    weight: 90
  - service: api-v2
    weight: 10
```

## Summary

Choose based on your needs: Linkerd for simplicity, Istio for features, OSM for Azure integration.


