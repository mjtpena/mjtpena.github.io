---
title: "AKS Cost Review: Fix Requests First, Then Nodes, Then Billing"
description: "A practical order for cutting AKS spend in early 2022: right-size pod requests, tune the cluster autoscaler, then use spot, stop/start and reservations."
author: Michael John Peña
draft: false
date: 2022-01-05
url: /blog/aks-cost-optimization/
tags:
  - Azure
  - Kubernetes
  - AKS
  - Cost Optimization
---

Most AKS bills are high for a boring reason: the cluster is full of pods that ask for far more CPU and memory than they use, so the autoscaler keeps adding nodes that sit mostly idle. Teams then reach for spot VMs or reservations, which discount the waste instead of removing it. The order you work in matters more than any single trick, and this is the order I recommend.

## Where the money actually goes

On AKS the control plane is free unless you add the Uptime SLA. You pay for what AKS creates in the node resource group (the `MC_` group) and for what sits around the cluster:

| Cost line | What drives it | Usually the biggest lever |
|---|---|---|
| Node VMs (scale sets) | VM size × node count × hours | Pod requests and autoscaler settings |
| OS and data disks | Managed disk tier and size, persistent volumes | Ephemeral OS disks, reclaiming orphaned PVs |
| Networking | Standard Load Balancer rules, public IPs, egress | Consolidating ingress, watching cross-region traffic |
| Log Analytics | GB ingested by Container Insights | Filtering noisy namespaces and stdout |
| Uptime SLA (optional) | Per-cluster hourly charge | Only enable it on clusters that need the financially backed SLA |
| Container Registry | SKU tier and storage | Rarely worth optimising first |

In nearly every cluster I look at, compute dominates. That is why the first two sections below are about compute and not about discounts.

## Step 1: fix pod requests before touching nodes

The Kubernetes scheduler places pods by their **requests**, not by real usage. If every pod requests 1 vCPU and uses 100m, a node with 4 vCPUs holds four pods and runs at roughly 10% utilisation. The cluster autoscaler sees pending pods and adds another node. Nothing is broken, and everything is expensive.

The Vertical Pod Autoscaler (VPA) is the most useful tool for finding the right numbers. As of January 2022 AKS does not offer VPA as a managed add-on, so you install the upstream project from the [kubernetes/autoscaler repository](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler) yourself. Pin a release tag rather than cloning `master`, because the VPA README warns that `master` may not match the released images. Version 0.9.2 is the current VPA release as of January 2022:

```bash
git clone --branch vertical-pod-autoscaler-0.9.2 https://github.com/kubernetes/autoscaler.git
cd autoscaler/vertical-pod-autoscaler
./hack/vpa-up.sh
```

`vpa-up.sh` installs into whatever cluster your current `kubectl` context points at, and it needs `openssl` locally to generate the admission webhook's certificates.

Then run it in recommendation-only mode. I would not let VPA apply changes in production until you trust its numbers, because in `Auto` mode it evicts pods to resize them.

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
  namespace: <your-namespace>
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Off"
  resourcePolicy:
    containerPolicies:
      - containerName: "*"
        minAllowed:
          cpu: 50m
          memory: 64Mi
        maxAllowed:
          cpu: "2"
          memory: 4Gi
```

After a few days of representative traffic, `kubectl describe vpa my-app-vpa -n <your-namespace>` shows a target, a lower bound and an upper bound per container. I set requests near the target and limits with headroom, then commit those values to the Helm chart or manifest so the next deployment doesn't undo the work.

Two cautions. First, don't combine VPA with a Horizontal Pod Autoscaler that scales on the same CPU or memory metric, because the two will fight. Second, a week of quiet traffic gives a recommendation that will be wrong at month-end. Collect data across the busy period before you cut requests.

Pair this with a `LimitRange` per namespace so new workloads get sensible defaults, and a `ResourceQuota` so a single team can't request half the cluster. Neither saves money directly; both stop the waste from coming back.

## Step 2: let the cluster shrink

With honest requests in place, the [cluster autoscaler](https://learn.microsoft.com/azure/aks/cluster-autoscaler) can do its job. Enable it per user node pool and give it a low floor. Here is a user pool in Bicep with autoscaling and an ephemeral OS disk, which avoids paying for a managed OS disk and boots faster:

```bicep
param clusterName string = '<your-cluster-name>'

resource aksCluster 'Microsoft.ContainerService/managedClusters@2021-10-01' existing = {
  name: clusterName
}

resource userPool 'Microsoft.ContainerService/managedClusters/agentPools@2021-10-01' = {
  parent: aksCluster
  name: 'userpool'
  properties: {
    mode: 'User'
    vmSize: 'Standard_D4s_v3'
    osType: 'Linux'
    osDiskType: 'Ephemeral'
    osDiskSizeGB: 64
    count: 2
    enableAutoScaling: true
    minCount: 1
    maxCount: 20
  }
}
```

`count` only sets the initial size. Once the autoscaler owns the pool, remove it from repeat deployments or set it to the current node count, otherwise every pipeline run resizes the pool.

Ephemeral OS only works when the OS disk fits in the VM's cache; `Standard_D4s_v3` has a 100 GiB cache, so a 64 GB OS disk fits. If it doesn't fit, the deployment fails, so check the cache size of the SKU you pick.

The autoscaler profile is cluster-wide. A common mistake is to "tune" it with the defaults: `scale-down-delay-after-add=10m`, `scale-down-unneeded-time=10m` and `scale-down-utilization-threshold=0.5` are already the AKS defaults. If you want the cluster to shed nodes faster, change the values:

```bash
az aks update \
  --resource-group <your-resource-group> \
  --name <your-cluster-name> \
  --cluster-autoscaler-profile \
    scale-down-unneeded-time=5m \
    scale-down-delay-after-add=5m \
    expander=least-waste
```

`least-waste` picks the node pool that leaves the least idle CPU and memory after scaling, which helps when you have several pools of different sizes. Shorter timers mean more churn, so I only shorten them on pools running bursty batch work.

The autoscaler will not remove a node if doing so would violate a PodDisruptionBudget. Depending on `skip-nodes-with-local-storage` and `skip-nodes-with-system-pods` in the autoscaler profile, nodes holding `emptyDir`/`hostPath` pods or `kube-system` pods can also block scale-down, as can bare pods with no controller. Check the values with `az aks show --query autoScalerProfile`. A PDB that says `minAvailable` equal to the replica count blocks scale-down forever. Write PDBs that leave room to move:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
  namespace: <your-namespace>
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: api
```

`policy/v1` needs Kubernetes 1.21 or later; on 1.20 clusters use `policy/v1beta1`.

### Scale-down mode is worth watching, not betting on

AKS added [Scale-down Mode](https://learn.microsoft.com/azure/aks/scale-down-mode) in public preview in September 2021. Setting a pool to `Deallocate` stops nodes instead of deleting them, so they come back faster with images already cached. You still pay for their disks while deallocated. It needs the `aks-preview` CLI extension:

```bash
az extension add --name aks-preview
az aks nodepool add \
  --resource-group <your-resource-group> \
  --cluster-name <your-cluster-name> \
  --name burstpool \
  --node-vm-size Standard_D4s_v3 \
  --enable-cluster-autoscaler \
  --min-count 0 \
  --max-count 10 \
  --node-osdisk-type Managed \
  --scale-down-mode Deallocate
```

Deallocate doesn't work with ephemeral OS disks, so this pool uses a managed OS disk. `--node-osdisk-type Managed` makes that explicit, and it means you can't combine this pool with the ephemeral OS saving from the Bicep example above.

I'd keep it to dev and test clusters while it's in preview. The saving is really in scale-up latency, not in the bill.

## Step 3: switch it off when nobody is using it

Dev and test clusters that run 24/7 are the easiest money in the subscription. [Stopping a cluster](https://learn.microsoft.com/azure/aks/start-stop-cluster) (generally available since early 2021) deallocates every node and stops the control plane, and `az aks start` brings it back with its configuration intact:

```bash
az aks stop --resource-group <your-resource-group> --name <your-cluster-name>
az aks start --resource-group <your-resource-group> --name <your-cluster-name>
```

Schedule those two commands from an Azure Automation runbook or a pipeline on a cron trigger. Evenings and weekends are roughly two-thirds of the week. Don't do this to production, and remember that a start can fail if the region is short of capacity for your VM size.

If the whole cluster can't stop, stopping a single user node pool with `az aks nodepool stop` and `az aks nodepool start` entered preview in late October 2021. As of January 2022 it needs the `aks-preview` extension, and I'd keep it to dev and test pools until it's generally available.

## Step 4: discount the capacity you've earned

Only now do discounts make sense, because you're discounting a smaller, honest footprint.

**Spot node pools** suit interruptible work: batch jobs, CI agents and queue workers. Spot VMs can be evicted at short notice, the system pool can't be spot, and you need taints and tolerations to keep critical pods off them. I covered the pattern in detail in [Cost Optimization with AKS Spot Node Pools](/blog/2021-10-03-aks-spot-node-pools/), so I won't repeat it here.

**[Azure Reservations](https://learn.microsoft.com/azure/cost-management-billing/reservations/save-compute-costs-reservations)** suit the floor that never goes away. Look at the lowest node count each pool held over the last month or two, and reserve that number of VMs for one or three years. Reservations apply to the underlying scale set VMs automatically when the region and VM size match. They're the wrong choice if you expect to change VM family soon. Exchanges are possible but a hassle, so settle the right-sizing in Step 1 first.

## Step 5: make the cost visible per team

Azure Cost Management shows the node resource group as one line, which tells you nothing about which namespace caused it. For per-namespace and per-workload allocation, Kubecost is the practical option today. Its free tier runs in the cluster:

```bash
helm repo add kubecost https://kubecost.github.io/cost-analyzer/
helm repo update
helm install kubecost kubecost/cost-analyzer \
  --namespace kubecost \
  --create-namespace
```

Treat the figures as an allocation model rather than an invoice: by default it estimates node prices from public rates, so reconcile the totals against Cost Management before you send anyone a chargeback.

Also look at Log Analytics. Container Insights collects stdout and stderr from every namespace except `kube-system` by default, and chatty workloads can make monitoring cost as much as a node pool. Use the [agent ConfigMap's](https://learn.microsoft.com/azure/azure-monitor/containers/container-insights-agent-config) `exclude_namespaces` setting to drop noisy application namespaces (dev, load-test), or turn off stdout collection where logs already go elsewhere. I walked through the setup in [Comprehensive AKS Monitoring with Container Insights](/blog/2021-10-07-container-insights/).

## When not to bother

If a cluster costs less than the engineering time this takes, leave it alone and stop it overnight. If your workloads are spiky and latency-sensitive, an aggressive autoscaler profile will hurt users more than it saves. And if your node pools are badly shaped, with one giant pool running everything, fix the design first; [Designing AKS Node Pools for Production Workloads](/blog/2021-10-02-aks-node-pools-design/) covers that.

My rule of thumb: requests first, autoscaler second, schedules third, discounts last. Each step makes the next one cheaper and safer, and doing them in reverse means you pay for idle capacity at a discount.
