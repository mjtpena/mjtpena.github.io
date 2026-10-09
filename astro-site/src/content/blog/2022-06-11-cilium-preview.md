---
title: "Cilium Preview on AKS: eBPF-Based Networking"
description: "eBPF (Extended Berkeley Packet Filter) allows running sandboxed programs in the Linux kernel without changing kernel source code, enabling efficient…"
author: Michael John Peña
draft: false
date: 2022-06-11
tags:
  - cilium
  - ebpf
  - Kubernetes
  - Networking
---

## What is eBPF?

eBPF (Extended Berkeley Packet Filter) allows running sandboxed programs in the Linux kernel without changing kernel source code, enabling efficient networking and security.

## Cilium Features

- eBPF-based data plane
- Advanced network policies
- Transparent encryption
- Service mesh capabilities
- Observability with Hubble

## Network Policy with Cilium

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-policy
spec:
  endpointSelector:
    matchLabels:
      app: api
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: frontend
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
      rules:
        http:
        - method: GET
          path: /api/.*
```

## Hubble Observability

```bash
# Enable Hubble
cilium hubble enable

# View traffic flows
hubble observe --pod api
hubble observe --namespace production
```

## Summary

Cilium represents the future of Kubernetes networking with eBPF, offering performance and features beyond traditional CNI plugins.
