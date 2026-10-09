---
title: "Open Service Mesh: Azure's SMI-Compatible Mesh"
author: Michael John Peña
draft: false
date: 2022-06-16
tags:
  - osm
  - Azure
  - service-mesh
  - Kubernetes
---

## Enabling OSM on AKS

```bash
# Enable OSM add-on
az aks enable-addons \
    --addons open-service-mesh \
    --resource-group myResourceGroup \
    --name myAKSCluster

# Verify installation
kubectl get pods -n kube-system -l app=osm-controller
```

## Namespace Enrollment

```bash
# Enroll namespace
osm namespace add bookstore

# Or use label
kubectl label namespace bookstore openservicemesh.io/monitored-by=osm
```

## Traffic Policies

```yaml
apiVersion: specs.smi-spec.io/v1alpha4
kind: HTTPRouteGroup
metadata:
  name: bookstore-routes
spec:
  matches:
  - name: books
    pathRegex: /books
    methods: ["GET"]
```
