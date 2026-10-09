---
title: "Pod Security Admission: Replacing Pod Security Policies"
author: Michael John Peña
draft: false
date: 2022-06-07
tags:
  - Kubernetes
  - Security
  - psa
  - pods
---

## Security Standards

Three built-in levels:
- **Privileged**: Unrestricted (equivalent to no PSP)
- **Baseline**: Prevents known privilege escalations
- **Restricted**: Heavily restricted, hardened pod configuration

## Configuring Namespaces

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    # Enforce restricted standard
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.24
    # Warn on violations
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.24
    # Audit violations
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.24
```

## Compliant Pod Example

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: restricted-pod
  namespace: production
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: myapp:latest
    securityContext:
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      runAsUser: 65534
      capabilities:
        drop:
          - ALL
      readOnlyRootFilesystem: true
```

## Migration from PSP

```bash
# Check existing PSPs
kubectl get psp

# Identify pods using PSPs
kubectl get pods -A -o json | jq -r '.items[] | select(.metadata.annotations["kubernetes.io/psp"]) | "\(.metadata.namespace)/\(.metadata.name): \(.metadata.annotations["kubernetes.io/psp"])"'

# Apply PSA labels to namespaces
kubectl label namespace myns pod-security.kubernetes.io/enforce=baseline
```

## Summary

Pod Security Admission provides simpler, namespace-level security enforcement replacing the complex PSP system. Migrate before Kubernetes 1.25 when PSP is removed.
