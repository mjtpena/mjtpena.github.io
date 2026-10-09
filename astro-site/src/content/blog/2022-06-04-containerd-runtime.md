---
title: "containerd Runtime: Understanding the Container Engine"
description: "containerd provides core container functionality: image management, container execution, and storage through a modular design with plugins."
author: Michael John Peña
draft: false
date: 2022-06-04
tags:
  - containerd
  - Kubernetes
  - Containers
  - runtime
---

## containerd Architecture

containerd provides core container functionality: image management, container execution, and storage through a modular design with plugins.

```bash
# Check containerd version
containerd --version

# View containerd configuration
cat /etc/containerd/config.toml

# Check running containers via ctr
ctr --namespace k8s.io containers list
```

## Working with crictl

```bash
# List pods
crictl pods

# List containers
crictl ps -a

# View container logs
crictl logs <container-id>

# Execute command in container
crictl exec -it <container-id> /bin/sh

# Pull image
crictl pull nginx:latest

# Inspect container
crictl inspect <container-id>
```

## Image Management

```bash
# List images
crictl images

# Pull image
crictl pull mcr.microsoft.com/azuredocs/aks-helloworld:v1

# Remove image
crictl rmi <image-id>

# Image details
crictl inspecti <image-id>
```

## containerd Namespaces

containerd uses namespaces to isolate containers:

```bash
# Kubernetes uses k8s.io namespace
ctr --namespace k8s.io containers list
ctr --namespace k8s.io images list

# Default namespace
ctr --namespace default containers list
```

## Performance Considerations

containerd offers better performance than Docker for Kubernetes workloads due to its simpler architecture and direct CRI integration.

## Summary

containerd provides a lightweight, efficient container runtime ideal for Kubernetes clusters. Understanding its tools and architecture helps with debugging and optimization.
