---
title: "Istio on AKS: Complete Service Mesh Implementation"
author: Michael John Peña
draft: false
date: 2022-06-14
tags:
  - istio
  - aks
  - service-mesh
  - kubernetes

---

I wrote "Istio on AKS: Complete Service Mesh Implementation" to share practical, production-minded guidance on this topic.

## Installing Istio

```bash
# Download Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-*
export PATH=$PWD/bin:$PATH

# Install on AKS
istioctl install --set profile=demo -y

# Enable sidecar injection
kubectl label namespace default istio-injection=enabled
```

## Traffic Management

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 80
    - destination:
        host: reviews
        subset: v2
      weight: 20\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
