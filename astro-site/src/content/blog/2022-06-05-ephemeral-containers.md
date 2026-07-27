---
title: "Ephemeral Containers: Debugging Kubernetes Pods"
author: Michael John Peña
draft: false
date: 2022-06-05
tags:
  - kubernetes
  - debugging
  - containers
  - devops

---

I wrote "Ephemeral Containers: Debugging Kubernetes Pods" to share practical, production-minded guidance on this topic.

## Basic Usage

```bash
# Add debug container to running pod
kubectl debug -it myapp-pod --image=busybox --target=myapp

# Use a more capable debug image
kubectl debug -it myapp-pod --image=nicolaka/netshoot --target=myapp

# Debug with Ubuntu for package installation
kubectl debug -it myapp-pod --image=ubuntu --target=myapp
```

## Sharing Process Namespace

```bash
# Share process namespace with target container
kubectl debug -it myapp-pod \
    --image=busybox \
    --target=myapp \
    --share-processes
```

Inside the debug container:

```bash
# View processes from target container
ps aux

# Trace system calls
strace -p <pid>

# Network debugging
netstat -tulpn
ss -tulpn
```

## Creating Debug Copies

```bash
# Create a copy of the pod for debugging
kubectl debug myapp-pod -it --copy-to=myapp-debug --container=debug --image=ubuntu

# Copy with modified command
kubectl debug myapp-pod -it \
    --copy-to=myapp-debug \
    --container=myapp \
    --image=myapp:debug \
    -- /bin/sh
```

## Debug Profiles

```bash
# Use predefined profiles
kubectl debug -it myapp-pod --image=busybox --profile=general
kubectl debug -it myapp-pod --image=busybox --profile=baseline
kubectl debug -it myapp-pod --image=busybox --profile=restricted
```

## Common Debugging Scenarios

### Network Troubleshooting

```bash
kubectl debug -it myapp-pod --image=nicolaka/netshoot --target=myapp

# Inside debug container
curl -v http://service-name.namespace.svc.cluster.local
nslookup service-name
tcpdump -i any port 80
```

### File System Inspection

```bash
kubectl debug -it myapp-pod --image=busybox --target=myapp

# Access target container filesystem
ls /proc/1/root/app/
cat /proc/1/root/app/config.yaml
```

## Summary

Ephemeral containers enable live debugging of production pods without disruption, making troubleshooting faster and safer.


