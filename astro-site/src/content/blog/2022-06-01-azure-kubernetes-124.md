---
title: "Azure Kubernetes Service 1.24: New Features and Breaking Changes"
author: Michael John Peña
draft: false
date: 2022-06-01
tags:
  - Azure
  - Kubernetes
  - AKS
  - Containers
---

## Key Changes in 1.24

- Dockershim removal
- Seccomp by default
- Pod security admission
- Ephemeral containers GA
- Storage capacity tracking

## Upgrading to AKS 1.24

```bash
# Check current version
az aks show --resource-group myResourceGroup --name myAKSCluster --query kubernetesVersion

# Check available versions
az aks get-versions --location eastus --output table

# Upgrade cluster
az aks upgrade \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --kubernetes-version 1.24.0

# Verify upgrade
kubectl get nodes
```

## Container Runtime Migration

With Dockershim removed, containerd is now the default:

```yaml
# Check container runtime
apiVersion: v1
kind: Pod
metadata:
  name: runtime-check
spec:
  containers:
  - name: check
    image: alpine
    command: ["sh", "-c", "cat /etc/os-release && sleep 3600"]
```

```bash
# Verify containerd
kubectl get nodes -o jsonpath='{.items[*].status.nodeInfo.containerRuntimeVersion}'
# Output: containerd://1.6.x
```

## Updating Docker-Specific Configurations

Replace Docker socket mounts:

```yaml
# Old: Docker socket (no longer works)
# volumes:
# - name: docker-sock
#   hostPath:
#     path: /var/run/docker.sock

# New: Use containerd or avoid privileged access
apiVersion: v1
kind: Pod
metadata:
  name: build-pod
spec:
  containers:
  - name: kaniko
    image: gcr.io/kaniko-project/executor:latest
    args:
    - "--dockerfile=Dockerfile"
    - "--context=git://github.com/my-repo/app"
    - "--destination=myregistry.azurecr.io/app:latest"
    volumeMounts:
    - name: kaniko-secret
      mountPath: /kaniko/.docker
  volumes:
  - name: kaniko-secret
    secret:
      secretName: regcred
      items:
      - key: .dockerconfigjson
        path: config.json
```

## Seccomp by Default

Kubernetes 1.24 enables Seccomp profiles by default:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault  # Now default in 1.24
  containers:
  - name: app
    image: myapp:latest
    securityContext:
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      runAsUser: 1000
      capabilities:
        drop:
          - ALL
```

Custom Seccomp profile:

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": [
        "accept4",
        "bind",
        "clone",
        "close",
        "connect",
        "epoll_create1",
        "epoll_ctl",
        "epoll_pwait",
        "execve",
        "exit_group",
        "fcntl",
        "fstat",
        "futex",
        "getdents64",
        "getpid",
        "getsockname",
        "getsockopt",
        "listen",
        "mmap",
        "mprotect",
        "nanosleep",
        "openat",
        "read",
        "recvfrom",
        "rt_sigaction",
        "rt_sigprocmask",
        "sendto",
        "setsockopt",
        "socket",
        "stat",
        "write"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

## Pod Security Admission

Replace Pod Security Policies with Pod Security Admission:

```yaml
# Namespace-level enforcement
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.24
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.24
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.24
```

Compliant pod example:

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
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

## Ephemeral Containers GA

Debug running pods without modification:

```bash
# Attach ephemeral container to running pod
kubectl debug -it myapp-pod --image=busybox:1.35 --target=myapp

# Debug with specific tools
kubectl debug -it myapp-pod \
    --image=nicolaka/netshoot \
    --target=myapp \
    -- /bin/bash

# Create debug copy of pod
kubectl debug myapp-pod -it \
    --copy-to=myapp-debug \
    --container=debug \
    --image=ubuntu
```

Using ephemeral containers programmatically:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
spec:
  containers:
  - name: myapp
    image: myapp:latest
  ephemeralContainers:
  - name: debugger
    image: busybox:1.35
    command: ["sh"]
    stdin: true
    tty: true
    targetContainerName: myapp
```

## Storage Capacity Tracking

New storage features:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: azure-disk-premium
provisioner: disk.csi.azure.com
parameters:
  skuName: Premium_LRS
  cachingMode: ReadOnly
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```
