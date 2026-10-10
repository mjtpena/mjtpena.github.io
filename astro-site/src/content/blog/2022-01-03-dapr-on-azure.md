---
title: "Dapr on Azure in 2022: Picking a Host and Securing Components"
description: "Where to run Dapr 1.5 on Azure in early 2022 (AKS, the new AKS extension, or Container Apps) and how to wire Azure components without leaking keys."
author: Michael John Peña
draft: false
date: 2022-01-03
url: /blog/dapr-on-azure/
tags:
  - Azure
  - Dapr
  - Microservices
  - AKS
  - Key Vault
---

Most Dapr demos stop at `dapr init` and a state store holding a connection string in plain text. The questions that matter once a team commits are less glamorous. Where does the Dapr control plane run, and who upgrades it? How do the sidecars authenticate to Cosmos DB, Service Bus and Key Vault without someone pasting keys into YAML? On Azure at the start of 2022 those answers have changed, because there are now three realistic hosting options instead of one.

I covered the building blocks themselves in [Dapr on Azure for Cloud-Native Applications](/blog/2021-06-27-dapr-azure-integration/). This post is about the platform decisions around them, as of Dapr 1.5.

## Where Dapr stands right now

Dapr 1.5 shipped in November 2021. The headline items were an alpha Configuration API (gRPC only for now), an alpha state query API, and a batch of components promoted to Stable. That batch includes the Azure Key Vault secret store, which is certified with managed identity. The .NET SDK (`Dapr.Client`, `Dapr.AspNetCore`, `Dapr.Actors`) is also at 1.5.0.

The detail that shapes everything below is that Azure AD authentication is uneven across Azure components. Dapr has a common [Azure authentication layer](https://docs.dapr.io/developing-applications/integrations/azure/authenticating-azure/) (`azureTenantId`, `azureClientId`, `azureClientSecret`, certificates, or managed identity), and components are adopting it one at a time. Dapr 1.4 added Azure AD support to the Cosmos DB state store, but Service Bus is still on connection strings. In 1.5:

| Component | Type | Authentication in 1.5 |
|---|---|---|
| Azure Key Vault | `secretstores.azure.keyvault` | Azure AD only, including managed identity |
| Azure Cosmos DB | `state.azure.cosmosdb` | `masterKey`, or Azure AD/managed identity (since 1.4; not yet on the component reference page) |
| Azure Blob Storage | `state.azure.blobstorage` | `accountKey`, or Azure AD/managed identity |
| Azure Service Bus | `pubsub.azure.servicebus` | `connectionString` (shared access policy) only; Azure AD arrives in 1.6 |

So Key Vault and Cosmos DB can use managed identity today, and Service Bus can't. The pattern I'd use on any Azure Dapr deployment right now is managed identity wherever the component supports it, and Key Vault-sourced keys for the rest.

## Three ways to host Dapr on Azure

### AKS with the Dapr CLI or Helm

This is the mature path. You run `dapr init -k` (add `--enable-ha=true` for anything beyond a dev cluster) or install the Helm chart. The Dapr production guide is written around Helm and recommends keeping a values file in source control, which fits a pipeline better. You own the control plane: operator, sidecar injector, placement and Sentry. You choose when to upgrade, and you can apply any component or Configuration resource Dapr supports.

The cost is that you also own patching, certificate rotation for Sentry, and keeping the CLI, runtime and SDK versions in step.

### AKS with the Dapr cluster extension (preview)

Microsoft announced the [Dapr extension for AKS](https://learn.microsoft.com/azure/aks/dapr) in public preview on 2 November 2021. Azure provisions the same control plane through the cluster extensions mechanism, and you can opt into automatic minor-version upgrades. In preview it sits behind feature flags:

```bash
az extension add --name aks-preview

az feature register --namespace "Microsoft.ContainerService" --name "AKS-ExtensionManager"
az feature register --namespace "Microsoft.ContainerService" --name "AKS-Dapr"

# Wait until both show "Registered", then refresh the providers
az provider register --namespace Microsoft.KubernetesConfiguration
az provider register --namespace Microsoft.ContainerService

az extension add --name k8s-extension

az k8s-extension create \
  --cluster-type managedClusters \
  --cluster-name <your-aks-cluster> \
  --resource-group <your-resource-group> \
  --name dapr \
  --extension-type Microsoft.Dapr \
  --auto-upgrade-minor-version true

kubectl get pods -n dapr-system
```

One rule matters here. If the extension installed Dapr, manage it through the extension from then on. Mixing `dapr upgrade -k` or Helm with the extension invites conflicts, and the AKS Dapr extension documentation says so directly.

### Azure Container Apps (preview)

[Azure Container Apps](https://learn.microsoft.com/azure/container-apps/dapr-overview) launched in preview at Ignite in November 2021 with Dapr built in. You enable Dapr per app, give it an app ID and port, and the platform runs the sidecar. There's no control plane to install, no Kubernetes API to manage, and KEDA-based scaling comes with it. I went through the service itself in [Azure Container Apps Preview](/blog/2021-11-27-azure-container-apps-preview/) and the [deep dive](/blog/2022-01-02-azure-container-apps-deep-dive/).

The trade-off is control. The platform decides the Dapr runtime version and owns the control plane, and you get the subset of Dapr features and settings the service exposes. Read the preview docs carefully against your design before assuming that a feature you use on AKS behaves the same way.

### How I'd choose

| Situation | My pick |
|---|---|
| Production workload today, need an SLA | AKS with Helm-managed Dapr |
| Existing AKS platform team, happy to run preview add-ons in non-prod | AKS Dapr extension, to evaluate it |
| New microservices, small team, no Kubernetes skills, not yet production | Container Apps, to prototype |
| Heavy use of actors or custom Dapr Configuration | AKS (either install method) |

Both newer options are preview, without an SLA. I wouldn't put a regulated production workload on either in January 2022. I would start a proof of concept on Container Apps now, because if it reaches general availability with Dapr intact it removes a lot of platform work for small teams.

## Securing components: identity first, Key Vault for the rest

On AKS the mechanism for giving a pod an Azure identity right now is [Azure AD pod-managed identity](https://learn.microsoft.com/azure/aks/use-azure-ad-pod-identity), itself in preview. You create a user-assigned managed identity, bind it to the cluster, and label the pod. The Dapr sidecar runs in the same pod, so it gets the identity too.

Grant that identity read access to secrets in Key Vault, then define the secret store with no credentials at all:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: azurekeyvault
  namespace: orders
spec:
  type: secretstores.azure.keyvault
  version: v1
  metadata:
  - name: vaultName
    value: "<your-key-vault-name>"
  - name: azureClientId
    value: "<managed-identity-client-id>"
```

The `azureClientId` is optional with managed identity, but I set it anyway. Being explicit avoids the sidecar picking up the wrong identity when several user-assigned identities are bound to the node pool.

### Cosmos DB with managed identity

Cosmos DB's data-plane RBAC has been generally available since May 2021, so the same identity can be given a data role on the account. The built-in Cosmos DB Data Contributor role covers reads and writes:

```bash
principalId=$(az identity show \
  --resource-group <your-resource-group> \
  --name <your-managed-identity> \
  --query principalId --output tsv)

az cosmosdb sql role assignment create \
  --account-name <your-cosmos-account> \
  --resource-group <your-resource-group> \
  --role-definition-id 00000000-0000-0000-0000-000000000002 \
  --principal-id "$principalId" \
  --scope "/"
```

Leave `masterKey` out of the component and it falls back to Azure AD:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: orderstate
  namespace: orders
spec:
  type: state.azure.cosmosdb
  version: v1
  initTimeout: 1m
  metadata:
  - name: url
    value: "https://<your-cosmos-account>.documents.azure.com:443/"
  - name: database
    value: "orders"
  - name: collection
    value: "orderstate"
  - name: azureClientId
    value: "<managed-identity-client-id>"
scopes:
- order-service
```

Two caveats. This path isn't on the Cosmos DB component reference page yet, so you're relying on behaviour in the component source rather than documented configuration. And on first start the component creates a `__dapr__` stored procedure in the container if it isn't there. Data-plane roles don't cover creating stored procedures, so either let a key-based deployment create it once or create it in your infrastructure code. If you can't create role assignments on the Cosmos account at all, use the Key Vault pattern below instead.

### Service Bus with a key from Key Vault

Service Bus has no identity option in 1.5, so its connection string lives in Key Vault and the component references it through `auth.secretStore`:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: orderevents
  namespace: orders
spec:
  type: pubsub.azure.servicebus
  version: v1
  metadata:
  - name: connectionString
    secretKeyRef:
      name: servicebus-connection-string
      key: servicebus-connection-string
  - name: disableEntityManagement
    value: "true"
auth:
  secretStore: azurekeyvault
scopes:
- order-service
```

You could use exactly the same pattern for Cosmos DB, with `masterKey` pulled from Key Vault. That's the fallback I'd pick when a team wants one consistent pattern across every component, or can't get Cosmos role assignments approved. The trade-off is real: a master key grants full control of the account and has to be rotated, while a data-plane role assignment grants only data access and has nothing to rotate. Consistency is worth something, but I'd take the narrower permission where it's available.

The pod template needs the identity label and the Dapr annotations. This is a fragment of a Deployment, not a full manifest:

```yaml
  template:
    metadata:
      labels:
        app: order-service
        aadpodidbinding: <your-pod-identity-selector>
      annotations:
        dapr.io/enabled: "true"
        dapr.io/app-id: "order-service"
        dapr.io/app-port: "8080"
        dapr.io/config: "appconfig"
```

The application code doesn't change at all. `DaprClient.SaveStateAsync("orderstate", key, value)` works the same whether the sidecar authenticated with an identity, a key from Key Vault or a Kubernetes secret, which is the point of Dapr.

## Component details that catch people out

**Cosmos DB partition key.** The container must use `/partitionKey` as its partition key path, and it's case-sensitive. Dapr uses the state key as the partition value unless you pass a `partitionKey` metadata value on the request. Create the database and container before deploying, because Dapr won't create them.

**Cosmos DB connection bursts.** Cosmos DB rate-limits metadata requests per account, and every sidecar that loads the component opens new connections at startup. That's why the Cosmos DB example above uses `scopes`, so only `order-service` loads it, and raises `initTimeout` from its 5-second default. The [Cosmos DB component docs](https://docs.dapr.io/reference/components-reference/supported-state-stores/setup-azure-cosmosdb/) also recommend a separate Cosmos account for unrelated systems.

**Service Bus entity management.** By default the Service Bus pub/sub component creates topics and subscriptions for you, which means the shared access policy needs Manage rights. In production I'd set `disableEntityManagement: "true"`, as in the example above, create the entities in Bicep or Terraform, and give Dapr a Send/Listen policy only. Once your IaC owns the entities, set max delivery count and lock duration there on purpose. The component's `maxDeliveryCount` and `lockDurationInSec` settings only apply to entities Dapr creates itself.

## Tracing into Application Insights

Dapr emits traces in Zipkin format. Application Insights doesn't accept Zipkin directly, so the documented route is the OpenTelemetry Collector running in the cluster. It receives Zipkin spans from the sidecars and exports them to Application Insights. Point the Dapr Configuration at the collector:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Configuration
metadata:
  name: appconfig
  namespace: orders
spec:
  tracing:
    samplingRate: "1"
    zipkin:
      endpointAddress: "http://otel-collector.orders.svc.cluster.local:9411/api/v2/spans"
```

The `dapr.io/config: "appconfig"` annotation on the pod must match this Configuration's name exactly, and Kubernetes only accepts lowercase resource names, so keep both lowercase. Drop `samplingRate` below `"1"` once you leave test environments. Sampling every request from every sidecar gets expensive quickly in Application Insights.

## When not to bother with Dapr

Dapr earns its place when several services need the same cross-cutting capabilities and you want a swappable backend: state, pub/sub, service invocation with mTLS and retries. It's harder to justify for a single API talking to one Cosmos DB container that will never move. Swappable backends are worth nothing if there's only ever one backend, and you'd be paying for the abstraction anyway: a sidecar in every pod adds a network hop to each call, memory per pod, and another runtime version to track and upgrade in step with the SDK. In that case the Cosmos DB SDK, called directly, is simpler and exposes features the state API doesn't, such as queries over your own document shape.

## My recommendation for early 2022

Run production Dapr on AKS, installed with Helm, in HA mode. Use managed identity for Key Vault and for Cosmos DB where you can create the data-plane role assignment, and pull the Service Bus connection string from Key Vault until 1.6 brings Azure AD to that component. If you need one pattern everywhere, Key Vault-sourced keys are the fallback, at the cost of broader keys you have to rotate. Scope every component to the apps that need it. Use the AKS extension and Container Apps in non-production to learn where they fall short, because both are likely to be the easier answer later this year, but neither is a production answer yet.
