---
title: "Kubernetes Adoption in the Enterprise: Lessons from 2021"
author: Michael John Pena
draft: false
date: 2021-12-04
tags:
  - Kubernetes
  - AKS
  - Containers
  - Cloud Native
  - DevOps

---

I wrote "Kubernetes Adoption in the Enterprise: Lessons from 2021" to share practical, production-minded guidance on this topic.

## The Managed Kubernetes Reality

Most enterprises settled on managed Kubernetes. Azure Kubernetes Service (AKS) became the default choice for Azure shops:

```bash
# Production-ready AKS cluster - 2021 best practices
az aks create \
    --resource-group production-rg \
    --name prod-aks-cluster \
    --node-count 5 \
    --node-vm-size Standard_DS3_v2 \
    --network-plugin azure \
    --network-policy calico \
    --enable-managed-identity \
    --enable-aad \
    --enable-azure-rbac \
    --enable-defender \
    --enable-cluster-autoscaler \
    --min-count 3 \
    --max-count 10 \
    --zones 1 2 3 \
    --uptime-sla \
    --generate-ssh-keys
```

## GitOps Became the Standard Deployment Model

Flux and ArgoCD emerged as the GitOps tools of choice:

```yaml
# Flux Kustomization for GitOps deployment
apiVersion: kustomize.toolkit.fluxcd.io/v1beta2
kind: Kustomization
metadata:
  name: production-apps
  namespace: flux-system
spec:
  interval: 5m
  path: ./clusters/production
  prune: true
  sourceRef:
    kind: GitRepository
    name: infra-repo
  validation: client
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: api-gateway
      namespace: production
  timeout: 3m
  postBuild:
    substitute:
      ENVIRONMENT: production
      CLUSTER_NAME: prod-aks-cluster\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
