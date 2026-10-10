---
title: "AKS, ACI or App Service? Choosing an Azure Container Platform"
description: "How I decide between AKS, Azure Container Instances and App Service for containers in early 2021, and why AKS is often the wrong first choice."
author: Michael John Peña
draft: false
date: 2021-01-06
tags:
  - Azure
  - Kubernetes
  - AKS
  - Containers
  - App Service
---

Once a team has a Dockerfile, the next question is where the container runs, and on Azure the reflex answer is Azure Kubernetes Service. That reflex is expensive. AKS is a very good managed Kubernetes, but it hands you a platform to operate, and plenty of workloads I see would be better served by Azure Container Instances or App Service. This is how I make that call at the start of 2021.

If you want the AKS mechanics themselves (creating a cluster, writing a Deployment), I covered those in [Azure Kubernetes Service: Managed Kubernetes](/blog/2020-10-08-azure-kubernetes-service-basics/). This post is about the decision that comes before that.

## The three realistic options

Azure has more ways to run a container than these three (Service Fabric, Batch, Functions with a custom image), but for a typical web API, worker or scheduled job, the shortlist is:

| | AKS | Azure Container Instances | App Service (containers) |
|---|---|---|---|
| What you manage | Node pools, upgrades, ingress, add-ons, Kubernetes manifests | A container group | An app and its plan |
| Unit of billing | VMs in your node pools (control plane is free) | Per-second vCPU and memory while running | App Service plan instances |
| Scaling | Horizontal Pod Autoscaler, cluster autoscaler, KEDA | None built in; you create more groups | Built-in scale out rules |
| Scale to zero | Not natively (KEDA can scale pods to zero, nodes stay) | Yes, by not running | No |
| Networking | Full control: VNet, network policy, ingress controllers | Public IP or VNet deployment | Regional VNet integration, Private Endpoints |
| Best fit | Many services, platform team, Kubernetes skills | Jobs, batch, burst, short-lived tasks | Web apps and APIs that are "just a website" |

The important row is the first one. The difference between these services is not features; it is how much platform you are signing up to run.

## When AKS earns its keep

I'd pick AKS when most of these are true:

- **You have more than a handful of services** that need to discover each other, share ingress, and deploy independently.
- **Someone owns the platform.** A cluster needs Kubernetes version upgrades several times a year, node image updates, ingress controller patches, and someone who can read `kubectl describe pod` output at 2am.
- **You need Kubernetes-native tooling**: Helm charts from vendors, operators, service meshes, or GitOps.
- **You need fine-grained networking**: network policies between services, internal load balancers, or a private cluster.

The platform has matured a lot over 2020. [Managed identity support went GA in March 2020](https://github.com/Azure/AKS/releases/tag/2020-03-16), so new clusters don't need a service principal secret that expires on you. In November 2020, the [AKS release notes](https://github.com/Azure/AKS/releases/tag/2020-11-16) made Kubernetes 1.19 available and containerd generally available, and containerd is now the default runtime for clusters created on or upgraded to 1.19. If your pipeline builds images by mounting the node's Docker socket (`/var/run/docker.sock`), that stops working on containerd nodes; Microsoft's guidance is to move to `docker buildx`, and Kaniko or ACR Tasks also work.

The control plane is free, but the free tier is backed only by a service level objective, not a financial SLA. The optional [Uptime SLA](https://learn.microsoft.com/en-us/azure/aks/uptime-sla), launched in May 2020, gives a financially backed 99.95% API server availability with Availability Zones (99.9% without) for about US$0.10 per cluster per hour. For anything in production I turn it on; it's a rounding error next to the node VMs.

A production-leaning starting point looks like this. It's a fragment of a larger setup (you'd still want monitoring and an ingress controller), but every flag here exists in the current Azure CLI (2.17):

```bash
az group create --name <your-resource-group> --location australiaeast

az aks create \
  --resource-group <your-resource-group> \
  --name <your-cluster-name> \
  --enable-managed-identity \
  --uptime-sla \
  --zones 1 2 3 \
  --node-count 3 \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 6 \
  --network-plugin azure \
  --generate-ssh-keys

az aks get-credentials --resource-group <your-resource-group> --name <your-cluster-name>
```

Notice what isn't in that command: patching cadence, upgrade testing, ingress, certificate management, secrets handling, log retention. That's the operating cost, and it's why I don't recommend AKS for a team with three services and no one who wants to own Kubernetes. Release strategy is part of that cost too; if you go ahead, plan how you'll ship safely before the first production deploy, which I covered in [rolling, blue-green and canary deployments on AKS](/blog/2020-08-06-aks-deployment-strategies/).

### Event-driven scaling is now a real option

The Horizontal Pod Autoscaler scales on CPU and memory, which is the wrong signal for queue workers. [KEDA 2.0 shipped on 4 November 2020](https://keda.sh/blog/2020-11-04-keda-2.0-release/) and fixes that: it scales Deployments (and, new in 2.0, Jobs via `ScaledJob`) on queue length, stream lag and dozens of other sources, including down to zero pods. KEDA isn't an AKS add-on; you install it yourself with Helm and own its upgrades.

A worker that scales on an Azure Service Bus queue looks like this:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: servicebus-secret
type: Opaque
stringData:
  connection: "<your-service-bus-connection-string>"
---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: servicebus-auth
spec:
  secretTargetRef:
    - parameter: connection
      name: servicebus-secret
      key: connection
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: orders-worker-scaler
spec:
  scaleTargetRef:
    name: orders-worker
  minReplicaCount: 0
  maxReplicaCount: 20
  triggers:
    - type: azure-servicebus
      metadata:
        queueName: orders
        messageCount: "50"
      authenticationRef:
        name: servicebus-auth
```

The Secret is shown for completeness; in a real cluster the connection string should come from your secret store, for example Key Vault through the Secrets Store CSI driver (still in preview for AKS at the time of writing). The connection string also needs Manage rights on the namespace or queue, because KEDA reads queue length through the management API and a Listen-only policy isn't enough.

`orders-worker` is an existing Deployment. Scaling pods to zero saves capacity on the nodes, not money on its own; the saving only arrives when the cluster autoscaler removes nodes. In practice you pay for your minimum node count regardless.

## When Azure Container Instances is the better answer

Azure Container Instances runs a container group with no cluster at all, billed per second for the vCPU and memory you request. It is the right tool for:

- **Batch and scheduled jobs**: a nightly data export, a report render, a one-off migration. Run it, let it exit, stop paying. ACI has no built-in scheduler, though, so something else has to start the group on time: a Logic App, a timer-triggered Function or a pipeline schedule.
- **Burst capacity**: AKS virtual nodes use ACI under the hood to absorb spikes without waiting for VMs.
- **Build agents and test environments** that should exist for minutes, not months.

Where ACI falls down is long-running services. There's no built-in autoscaling, no rolling deployment, no load balancing across groups, and per-group CPU and memory limits are small and vary by region. If you find yourself scripting a load balancer and health checks in front of several container groups, you've rebuilt a worse orchestrator; move to App Service or AKS. I wrote more about ACI's sweet spot in [Azure Container Instances: Serverless Containers](/blog/2020-09-12-azure-container-instances/).

## When App Service is the better answer

The most underrated option. [App Service runs custom containers](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container) on Linux, and Windows container support went GA in September 2020 alongside the new Premium V3 plans. Windows containers on App Service need a Premium V3 plan, so the cost floor is noticeably higher than for Linux containers, which run on Basic and Standard plans. You get deployment slots with swap, built-in TLS and custom domains, autoscale rules, Azure AD authentication without code changes, regional VNet integration and Private Endpoints.

If your workload is a web app or HTTP API, and especially if it's one or two of them, App Service gives you most of what a team builds on top of AKS in the first six months, already done. The trade-offs are real, though:

- **No sidecars or multi-container pods** in the Kubernetes sense (Docker Compose support on Linux exists but is still in preview).
- **Non-HTTP workloads are awkward.** Background workers run, but there's no queue-driven scaling like KEDA.
- **The plan is always on.** You pay for at least one instance, even at 3am.

## How I decide

My rule of thumb, in order:

1. **Does it run to completion?** Use ACI (or Azure Batch if it's a large parallel job).
2. **Is it one to a few HTTP apps?** Use App Service. Revisit only when you hit a wall you can name.
3. **Is it many services, with a team that will own the platform?** Use AKS, with managed identity, the Uptime SLA, availability zones and the cluster autoscaler from day one.

The mistake I see most often is choosing AKS for its future flexibility and then paying the operating cost for years before any of that flexibility is used. Kubernetes skills are valuable, but a cluster is a product your team has to run. Pick it because your workload needs it, not because it's the default answer in architecture diagrams.
