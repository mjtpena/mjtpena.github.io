---
title: "Open Service Mesh: Azure's SMI-Compatible Mesh"
author: Michael John Peña
draft: false
date: 2022-06-16
tags:
  - osm
  - azure
  - service-mesh
  - kubernetes

---

I wrote "Open Service Mesh: Azure's SMI-Compatible Mesh" to share practical, production-minded guidance on this topic.

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
    methods: ["GET"]\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
