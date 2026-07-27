---
title: "Calico on AKS: Advanced Network Policies"
author: Michael John Peña
draft: false
date: 2022-06-09
tags:
  - calico
  - kubernetes
  - networking
  - aks

---

I wrote "Calico on AKS: Advanced Network Policies" to share practical, production-minded guidance on this topic.

## Enabling Calico on AKS

```bash
az aks create \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --network-plugin azure \
    --network-policy calico
```

## Calico Global Network Policy

```yaml
apiVersion: crd.projectcalico.org/v1
kind: GlobalNetworkPolicy
metadata:
  name: deny-external-egress
spec:
  selector: all()
  types:
  - Egress
  egress:
  - action: Allow
    destination:
      nets:
      - 10.0.0.0/8
  - action: Deny
    destination:
      nets:
      - 0.0.0.0/0
```

## DNS Policy

```yaml
apiVersion: crd.projectcalico.org/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
spec:
  selector: app == 'myapp'
  types:
  - Egress
  egress:
  - action: Allow
    protocol: UDP
    destination:
      selector: k8s-app == 'kube-dns'
      ports:
      - 53
```

## Application Layer Policy

```yaml
apiVersion: crd.projectcalico.org/v1
kind: NetworkPolicy
metadata:
  name: http-methods
spec:
  selector: app == 'api'
  ingress:
  - action: Allow
    http:
      methods: ["GET", "POST"]
      paths:
      - exact: /api/v1/users
      - prefix: /api/v1/products
```

## Summary

Calico provides enterprise-grade network security for AKS with features beyond standard Kubernetes Network Policies.


