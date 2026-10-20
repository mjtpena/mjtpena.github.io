---
title: "Rolling, Blue-Green and Canary Deployments on AKS"
description: "How to choose between rolling updates, blue-green and canary releases on AKS, what each one actually guarantees, and when the extra machinery pays off."
author: Michael John Peña
draft: false
date: 2020-08-06
tags:
  - Azure
  - Kubernetes
  - AKS
  - DevOps
---

Every team moving onto AKS eventually asks how to ship a new version without downtime. AKS gives you the primitives, but the choice between rolling, blue-green and canary depends on what your application can tolerate during the swap, and how much complexity your team is willing to operate. The right answer is usually the least machinery that protects you from your actual failure mode, and that is rarely blue-green.

One framing up front: none of these strategies is a feature of AKS itself. They are patterns built from plain Kubernetes objects (Deployments, Services, Ingress) plus whatever tooling you put around them. That's good news, because everything here works the same on any conformant cluster, and it also means AKS won't save you from a badly designed rollout.

## The cluster

Nothing special is needed. A standard cluster with Azure Monitor for containers enabled and an Azure Container Registry attached is enough to follow along:

```bash
az aks create \
    --resource-group <your-resource-group> \
    --name <your-cluster-name> \
    --node-count 3 \
    --enable-addons monitoring \
    --attach-acr <your-acr-name> \
    --generate-ssh-keys

az aks get-credentials --resource-group <your-resource-group> --name <your-cluster-name>
```

If you haven't got images flowing into the registry yet, the [multi-stage pipeline skeleton](/blog/2020-08-04-azure-devops-multi-stage-pipelines/) I posted earlier this week covers the build side.

## Rolling update: the default, and usually enough

A Deployment with no `strategy` block already does a rolling update, with `maxSurge` and `maxUnavailable` both defaulting to 25%. I always set them explicitly, because the defaults are rarely what I want for a small replica count:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 4
  minReadySeconds: 10
  progressDeadlineSeconds: 300
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: myapp
          image: <your-acr-name>.azurecr.io/myapp:v1
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /ready
              port: 80
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: 80
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "10"]
```

A few of those lines carry most of the weight:

- **`maxUnavailable: 0` with `maxSurge: 1`** means capacity never drops below four ready pods. With four replicas, the 25% default would let one pod go away before its replacement is ready, which is exactly when a traffic spike hurts.
- **`minReadySeconds`** makes a new pod stay ready for ten seconds before it counts as available. It catches the pod that passes one readiness check and then falls over.
- **`progressDeadlineSeconds`** marks the rollout as failed if it stalls. Kubernetes won't roll back on its own, but your pipeline can see the failure and act on it.
- **The `preStop` sleep** covers a race that catches almost everyone. When a pod is terminated, removing it from the Service endpoints and sending SIGTERM to the container happen in parallel. Without a short pause, the container can stop accepting connections while kube-proxy on other nodes is still routing to it, and you get a handful of 502s on every deploy. This needs a `sleep` binary in the image; distroless images need the equivalent built into the app's shutdown handling.

Rolling out and backing out is all `kubectl`:

```bash
# First deploy (v1)
kubectl apply -f deployment.yaml
kubectl rollout status deployment/myapp --timeout=5m

# Ship v2 by hand
kubectl set image deployment/myapp myapp=<your-acr-name>.azurecr.io/myapp:v2
kubectl rollout status deployment/myapp --timeout=5m

# Back out if v2 misbehaves
kubectl rollout undo deployment/myapp
```

`kubectl set image` is fine by hand, but it leaves the cluster out of step with `deployment.yaml`; in a pipeline, update the tag in the manifest and re-apply instead.

The trade-off is that for a few minutes, v1 and v2 serve traffic side by side. If v2 changes an API contract, a message format or a database schema in a way v1 can't handle, a rolling update is the wrong tool, or the change needs to be split into backwards-compatible steps first.

## Blue-green: one switch, two full environments

Blue-green runs the new version at full size next to the old one, tests it in place, then moves all traffic at once. On Kubernetes the switch is a label selector on a Service. This assumes `myapp-blue` (v1, `version: blue`) is already running; the YAML adds green next to it and keeps the Service pointed at blue:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
        - name: myapp
          image: <your-acr-name>.azurecr.io/myapp:v2
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /ready
              port: 80
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
    version: blue
  ports:
    - port: 80
      targetPort: 80
```

`myapp-blue` is the same Deployment with its own name, `version: blue` and the v1 image. The cutover by hand:

```bash
kubectl apply -f green-deployment.yaml
kubectl rollout status deployment/myapp-green

# Smoke test green directly, without touching production traffic
kubectl port-forward deployment/myapp-green 8080:80

# Flip the Service
kubectl patch service myapp -p '{"spec":{"selector":{"app":"myapp","version":"green"}}}'

# Keep blue around until you're confident, then remove it
kubectl delete deployment myapp-blue
```

What you get is a clean, fast rollback: patch the selector back to `blue`. What you pay is double the compute while both sides run, and on a node pool sized for one copy of the app, that means adding nodes first, either by scaling the pool or by letting the cluster autoscaler do it. If you use a HorizontalPodAutoscaler, each colour needs its own, with `minReplicas` high enough that the idle side can take full traffic the moment you flip back.

In a pipeline, don't flip with `kubectl patch`. Make the active colour a value in source control, such as a Helm value (`--set activeColour=green`) templated into the Service selector, or a pipeline variable substituted into the Service manifest, so every cutover and rollback is a versioned, reviewable change. Keep blue running for at least one full traffic cycle you care about (a business day, or a batch window) before the pipeline removes it.

Two things people assume about blue-green that aren't true here. First, the switch isn't instantaneous for every client. Existing keep-alive connections stay pinned to blue pods until they close, so delay deleting blue for at least as long as your longest connection lives. Second, blue-green doesn't solve database changes. Both versions still hit the same database, and if green runs a migration blue can't live with, rolling back the Service selector won't roll back the schema. You still need expand-and-contract migrations underneath.

## Canary: cheap, then real

A canary sends a small slice of real traffic to the new version and watches it before committing. The cheapest way to do it on Kubernetes is two Deployments behind one Service, with the split set by replica counts:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
      track: canary
  template:
    metadata:
      labels:
        app: myapp
        track: canary
    spec:
      containers:
        - name: myapp
          image: <your-acr-name>.azurecr.io/myapp:v2
          ports:
            - containerPort: 80
```

That's a fragment: `myapp-stable` is identical apart from its name, `track: stable`, nine replicas and the v1 image. The split comes from a Service that ignores `track`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
  ports:
    - port: 80
      targetPort: 80
```

With nine stable pods and one canary behind it, roughly 10% of connections land on the canary. You promote by scaling one up and the other down:

```bash
kubectl scale deployment myapp-canary --replicas=3
kubectl scale deployment myapp-stable --replicas=7
```

This is crude. kube-proxy picks a backend per connection, not per request, so clients with long-lived connections skew the ratio. You can't go below one pod's share, which is 10% here and 50% if you only run two replicas. And nothing decides whether the canary is healthy; a person stares at a dashboard. Without that last piece, "canary" is a slow blue-green.

There are three steps up from there, in increasing order of effort:

| Approach | Split by | Fine-grained % | Automated analysis | Extra moving parts |
|---|---|---|---|---|
| Replica ratio | Connection | No | No | None |
| NGINX ingress canary | Request at the edge | Yes | No | Ingress controller |
| Flagger (NGINX or mesh) | Request; east-west with a mesh | Yes | Yes | Flagger, metrics, plus mesh if used |

**NGINX ingress canary annotations** are the middle ground I use most. If you already run the NGINX ingress controller, a second Ingress with `nginx.ingress.kubernetes.io/canary: "true"` and `canary-weight: "10"` sends 10% of requests to the canary Service, and `canary-by-header` lets testers opt in deterministically. It only covers traffic coming through the ingress, not calls between services. The [annotations reference](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/#canary) has the full set.

The canary Ingress does nothing on its own. It sits alongside your existing main Ingress for the same host and path, which routes to the stable `myapp` Service; the controller merges the two and splits by weight:

```yaml
apiVersion: networking.k8s.io/v1beta1
kind: Ingress
metadata:
  name: myapp-canary
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  rules:
    - host: myapp.<your-domain>
      http:
        paths:
          - path: /
            backend:
              serviceName: myapp-canary
              servicePort: 80
```

This assumes two Services: `myapp` selecting `track: stable` and `myapp-canary` selecting `track: canary`. If the stable Service still selects only `app: myapp`, as in the replica-ratio setup, the canary gets more than 10%.

**A service mesh** (Linkerd or Istio today) gives you weighted splits for every hop, with Linkerd using the SMI `TrafficSplit` resource and Istio its own `VirtualService` weights. Pair it with [Flagger](https://docs.flagger.app/) and the promote-or-rollback decision is driven by success rate and latency instead of a human. Flagger can also drive the NGINX canary annotations for you, so automated analysis doesn't require a mesh; a mesh only adds east-west splitting. Microsoft also released [Open Service Mesh v0.1.0](https://github.com/openservicemesh/osm/releases/tag/v0.1.0) yesterday as an SMI-based mesh, but it's an early release, and I wouldn't put production traffic through it yet.

**If your releases already run in Azure Pipelines**, the [KubernetesManifest task](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/kubernetes-manifest-v0) has a built-in canary strategy. It deploys baseline and canary variants, splits traffic by pod count or SMI, and has explicit `promote` and `reject` actions that you can gate behind an environment approval.

## Probes decide whether any of this works

Every strategy above trusts readiness to mean "safe to send traffic". If `/ready` returns 200 before caches are warm, connection pools are open and the JIT has settled, every strategy will happily route users to a pod that isn't ready.

My rules of thumb:

- **Readiness and liveness should check different things.** Readiness can include dependencies. Liveness should only answer "is this process wedged?" If liveness checks the database, a database blip restarts every pod at once, turning a partial outage into a full one.
- **Be generous with liveness timing.** A misconfigured `livenessProbe` will kill a healthy, slow-starting pod faster than any deployment mistake.
- **Use `startupProbe` where you can, but check your version.** It went to beta, and is enabled by default, in Kubernetes 1.18. AKS has 1.18 in preview at the time of writing and has said GA is planned for the week of 31 August. On 1.16 and 1.17 clusters, the feature gate is off and the field is ignored, so keep an `initialDelaySeconds` on liveness until you've upgraded. The [probe documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) shows the pattern.

```yaml
startupProbe:
  httpGet:
    path: /health
    port: 80
  failureThreshold: 30
  periodSeconds: 10
```

That fragment gives the container up to five minutes to start before liveness checks begin.

## Helm doesn't change the strategy

Helm 3 is how I package most of this, but it's worth being clear that Helm sits on top of whatever strategy your templates describe. `helm upgrade` on a chart with a normal Deployment is still a rolling update. The useful extras are `--atomic`, which rolls back automatically if the release doesn't become ready, and `helm rollback`, which returns everything in the release (ConfigMaps included) rather than just the image:

```bash
helm upgrade --install myapp ./myapp \
    --set image.tag=v2 \
    --atomic --timeout 5m

helm history myapp
helm rollback myapp 1
```

## How I choose

- **`Recreate`** is the right answer more often than people admit. For a single-replica internal tool, it's simpler and perfectly adequate; don't build blue-green around something nobody notices going down for 20 seconds. (Jobs and CronJobs don't have a Deployment strategy at all, so none of this applies to them.)
- **Rolling update** is my default for stateless APIs and internal services, anywhere a few minutes of mixed versions is harmless. It's built in, it's free, and rollback is one command. Get `maxUnavailable`, readiness and the `preStop` hook right, and most "we need blue-green" conversations go away.
- **Blue-green** is for when two versions can't run side by side, or when I need to smoke test at full scale before any user sees it. Budget for double capacity and don't pretend it handles the database.
- **Canary** is worth it when you can measure the result automatically. If nobody has defined what "healthy" means in metrics, start with NGINX weights and a human, and treat Flagger or a pipeline-driven canary as the goal. Replica-ratio canaries are fine for a demo and not much more.

If you only change one thing after reading this, fix your probes. The strategy you pick matters less than whether Kubernetes can tell a ready pod from a broken one.
