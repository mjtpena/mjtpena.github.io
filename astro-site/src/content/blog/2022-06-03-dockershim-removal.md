---
title: "Dockershim Removal: Migrating to containerd on AKS"
author: Michael John Peña
draft: false
date: 2022-06-03
tags:
  - kubernetes
  - docker
  - containerd
  - aks

---

I wrote "Dockershim Removal: Migrating to containerd on AKS" to share practical, production-minded guidance on this topic.

## Understanding the Change

Dockershim was a Kubernetes component that translated Docker API calls to the Container Runtime Interface (CRI). With its removal, containerd communicates directly via CRI.

## What Does NOT Change

Your existing container images continue to work because OCI-compliant images run on any OCI runtime including containerd.

```bash
# Images built with Docker still work
docker build -t myapp:v1 .
docker push myregistry.azurecr.io/myapp:v1

# Deploy to AKS with containerd
kubectl apply -f deployment.yaml
```

## What Changes

Commands that accessed Docker daemon directly no longer work:

```bash
# These NO LONGER work inside pods
# docker ps
# docker build
# docker exec

# Instead use crictl for debugging
crictl ps
crictl images
crictl logs <container-id>
```

## Checking Your Workloads

Identify Docker-dependent workloads:

```bash
# Find pods mounting docker socket
kubectl get pods -A -o json | jq -r '
  .items[] |
  select(.spec.volumes[]? | select(.hostPath.path == "/var/run/docker.sock")) |
  "\(.metadata.namespace)/\(.metadata.name)"
'

# Find pods with docker commands
kubectl get pods -A -o json | jq -r '
  .items[] |
  select(.spec.containers[].command[]? | contains("docker")) |
  "\(.metadata.namespace)/\(.metadata.name)"
'
```

## Replacing Docker Socket Mounts

### Before (Docker)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: docker-build
spec:
  containers:
  - name: docker
    image: docker:dind
    securityContext:
      privileged: true
    volumeMounts:
    - name: docker-sock
      mountPath: /var/run/docker.sock
  volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock
```

### After (Kaniko)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: kaniko-build
spec:
  containers:
  - name: kaniko
    image: gcr.io/kaniko-project/executor:latest
    args:
    - "--dockerfile=Dockerfile"
    - "--context=git://github.com/myrepo/myapp.git"
    - "--destination=myregistry.azurecr.io/myapp:v1"
    volumeMounts:
    - name: kaniko-secret
      mountPath: /kaniko/.docker
  restartPolicy: Never
  volumes:
  - name: kaniko-secret
    secret:
      secretName: regcred
```

## CI/CD Pipeline Updates

### Azure DevOps with Kaniko

```yaml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

stages:
- stage: Build
  jobs:
  - job: BuildAndPush
    steps:
    - task: KubernetesManifest@0
      displayName: 'Build with Kaniko'
      inputs:
        action: 'deploy'
        kubernetesServiceConnection: 'aks-connection'
        manifests: |
          apiVersion: v1
          kind: Pod
          metadata:
            name: kaniko-$(Build.BuildId)
          spec:
            containers:
            - name: kaniko
              image: gcr.io/kaniko-project/executor:latest
              args:
              - "--dockerfile=Dockerfile"
              - "--context=$(Build.Repository.Uri)"
              - "--destination=$(ACR_NAME).azurecr.io/$(IMAGE_NAME):$(Build.BuildId)"
            restartPolicy: Never
```

### GitHub Actions with Buildah

```yaml
name: Build and Push

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3

    - name: Build with Buildah
      uses: redhat-actions/buildah-build@v2
      with:
        image: myapp
        tags: ${{ github.sha }}
        containerfiles: |
          ./Dockerfile

    - name: Push to ACR
      uses: redhat-actions/push-to-registry@v2
      with:
        image: myapp
        tags: ${{ github.sha }}
        registry: ${{ secrets.ACR_NAME }}.azurecr.io
        username: ${{ secrets.ACR_USERNAME }}
        password: ${{ secrets.ACR_PASSWORD }}
```

## Debugging with containerd

Use crictl for container debugging:

```bash
# SSH to AKS node (requires SSH access)
kubectl debug node/aks-nodepool1-12345678-vmss000000 -it --image=mcr.microsoft.com/cbl-mariner/busybox:2.0

# Inside the node
crictl --runtime-endpoint unix:///run/containerd/containerd.sock ps
crictl --runtime-endpoint unix:///run/containerd/containerd.sock images
crictl --runtime-endpoint unix:///run/containerd/containerd.sock logs <container-id>
crictl --runtime-endpoint unix:///run/containerd/containerd.sock exec -it <container-id> /bin/sh
```

## containerd Configuration

AKS manages containerd config, but understanding it helps debugging:

```toml
# /etc/containerd/config.toml
version = 2

[plugins]
  [plugins."io.containerd.grpc.v1.cri"]
    sandbox_image = "mcr.microsoft.com/oss/kubernetes/pause:3.6"
    [plugins."io.containerd.grpc.v1.cri".containerd]
      default_runtime_name = "runc"
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
          runtime_type = "io.containerd.runc.v2"
          [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
            SystemdCgroup = true
    [plugins."io.containerd.grpc.v1.cri".registry]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
        [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
          endpoint = ["https://registry-1.docker.io"]
```

## Testing Migration

Validate before production upgrade:

```bash
# Create test cluster with 1.24
az aks create \
    --resource-group test-rg \
    --name test-aks-124 \
    --kubernetes-version 1.24.0 \
    --node-count 2

# Deploy your workloads
kubectl apply -f ./manifests/

# Run integration tests
./run-tests.sh

# Check for issues
kubectl get events --sort-by='.lastTimestamp'
kubectl get pods -A | grep -v Running
```

## Summary

Dockershim removal means:

- containerd is now the default runtime
- Docker images still work (OCI standard)
- Docker socket access must be replaced
- Use Kaniko/Buildah for in-cluster builds
- Use crictl for debugging

Plan your migration before upgrading to Kubernetes 1.24.


