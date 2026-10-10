---
title: "Azure Container Apps Preview in Bicep: Revisions, Scaling and Dapr"
description: "A closer look at the Azure Container Apps preview API: how revisions, KEDA scale rules and per-app Dapr components behave, and where the preview falls short."
author: Michael John Peña
draft: false
date: 2022-01-02
url: /blog/azure-container-apps-deep-dive/
tags:
  - Azure Container Apps
  - Bicep
  - KEDA
  - Dapr
  - Serverless
---

Azure Container Apps has been in public preview since Ignite in November 2021, and the getting-started story is easy: one CLI command and you have an HTTPS endpoint. The harder questions arrive when you try to describe a real system in infrastructure as code. Which changes create a new revision? How do scale rules map to KEDA? Where do Dapr components live? Get those wrong and you end up with surprise traffic splits, workers that never scale, or secrets copied across every app.

I covered the basics in the [preview overview](/blog/2021-11-27-azure-container-apps-preview/). This post goes one level down, to the preview resource model itself, using Bicep against the API version that exists today.

## What you are actually deploying

During the preview, Container Apps resources live in the `Microsoft.Web` resource provider, next to App Service, and the API version is `2021-03-01`. There are two resource types:

- `Microsoft.Web/kubeEnvironments` is the **Container Apps environment**. It's the security and networking boundary. Apps in the same environment share a virtual network and write logs to the same Log Analytics workspace, configured through `appLogsConfiguration`.
- `Microsoft.Web/containerApps` is the app. It points at its environment through `kubeEnvironmentId`.

Underneath, Microsoft runs the Kubernetes cluster, KEDA for autoscaling, Envoy for ingress and Dapr as an optional sidecar. You never see the cluster, and that is the whole point. You also can't reach past the abstraction when it doesn't fit, which is the trade-off you are signing up for.

The `kubeEnvironments` type is shared with App Service on Azure Arc, which tells you this resource model is a stepping stone. Expect it to change before general availability; preview APIs usually do. Keep your Bicep in one module per resource type so a provider or API version change is a find-and-replace, not a rewrite.

## The rule that explains revisions

Read the [`Microsoft.Web/containerApps` template reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.web/2021-03-01/containerapps?pivots=deployment-language-bicep) and one split explains most of the behaviour. Every app has two blocks under `properties`:

| Block | Versioned? | What lives there |
|---|---|---|
| `configuration` | No (application scope) | Ingress, secrets, registry credentials, `activeRevisionsMode` |
| `template` | Yes (revision scope) | Containers, images, environment variables, scale rules, Dapr settings, `revisionSuffix` |

Any change inside `template` creates a new, immutable [revision](https://learn.microsoft.com/en-us/azure/container-apps/revisions). Changes inside `configuration` apply to the app and all of its revisions without creating one.

Two consequences matter in practice. First, rotating a secret does not create a revision, and running replicas won't pick up the new value until they restart. You have two ways to make it take effect: push a template change with a new `revisionSuffix`, or restart the active revision. The API has a `containerApps/revisions` child resource with a `restart` action for exactly this, and it's the cleaner option because it doesn't need a new suffix (more on why that matters below). Second, tuning a scale rule *does* create a new revision, so a one-line change to `maxReplicas` shows up in your revision history like a code deployment.

## A two-app example

Here's a realistic shape: an HTTP API that publishes order events through Dapr pub/sub, and a background worker that consumes them and scales to zero when the subscription is empty. It assumes an existing environment and an Azure Container Registry using admin credentials, and it creates the Service Bus subscription the worker scales on.

```bicep
param location string = resourceGroup().location
param environmentName string = '<your-environment-name>'
param registryServer string = '<your-registry>.azurecr.io'
param registryUsername string = '<your-registry>'
param imageTag string = 'v1'
param serviceBusNamespaceName string = '<your-servicebus-namespace>'

// Unique per deployment, for example a CI build number such as 'build-142'
param revisionSuffix string

@secure()
param registryPassword string

@secure()
param serviceBusConnection string

resource environment 'Microsoft.Web/kubeEnvironments@2021-03-01' existing = {
  name: environmentName
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2017-04-01' existing = {
  name: serviceBusNamespaceName
}

resource ordersTopic 'Microsoft.ServiceBus/namespaces/topics@2017-04-01' existing = {
  parent: serviceBus
  name: 'orders'
}

// Must exist before the worker can scale from zero
resource workerSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2017-04-01' = {
  parent: ordersTopic
  name: 'orders-worker'
  properties: {
    maxDeliveryCount: 10
  }
}

var sharedSecrets = [
  {
    name: 'registry-password'
    value: registryPassword
  }
  {
    name: 'servicebus-connection'
    value: serviceBusConnection
  }
]

var registries = [
  {
    server: registryServer
    username: registryUsername
    passwordSecretRef: 'registry-password'
  }
]

// In this API version, Dapr components are declared on each app
var pubsubComponent = {
  name: 'orders-pubsub'
  type: 'pubsub.azure.servicebus'
  version: 'v1'
  metadata: [
    {
      name: 'connectionString'
      secretRef: 'servicebus-connection'
    }
  ]
}

resource ordersApi 'Microsoft.Web/containerApps@2021-03-01' = {
  name: 'orders-api'
  location: location
  properties: {
    kubeEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: sharedSecrets
      registries: registries
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'orders-api'
          image: '${registryServer}/orders-api:${imageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
      dapr: {
        enabled: true
        appId: 'orders-api'
        appPort: 8080
        components: [
          pubsubComponent
        ]
      }
    }
  }
}

resource ordersWorker 'Microsoft.Web/containerApps@2021-03-01' = {
  name: 'orders-worker'
  location: location
  dependsOn: [
    workerSubscription
  ]
  properties: {
    kubeEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'single'
      secrets: sharedSecrets
      registries: registries
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'orders-worker'
          image: '${registryServer}/orders-worker:${imageTag}'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 20
        rules: [
          {
            name: 'orders-backlog'
            custom: {
              type: 'azure-servicebus'
              metadata: {
                topicName: 'orders'
                subscriptionName: 'orders-worker'
                messageCount: '20'
              }
              auth: [
                {
                  secretRef: 'servicebus-connection'
                  triggerParameter: 'connection'
                }
              ]
            }
          }
        ]
      }
      dapr: {
        enabled: true
        appId: 'orders-worker'
        appPort: 8080
        components: [
          pubsubComponent
        ]
      }
    }
  }
}

output apiFqdn string = ordersApi.properties.configuration.ingress.fqdn
```

Don't pass the two secrets as inline values on the command line, where they end up in shell history and CI logs. Put them in a parameters file that stays out of source control, or better, have that file reference a Key Vault secret so nobody handles the value at all:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "registryPassword": {
      "reference": {
        "keyVault": {
          "id": "/subscriptions/<subscription-id>/resourceGroups/<vault-resource-group>/providers/Microsoft.KeyVault/vaults/<your-vault>"
        },
        "secretName": "acr-password"
      }
    },
    "serviceBusConnection": {
      "reference": {
        "keyVault": {
          "id": "/subscriptions/<subscription-id>/resourceGroups/<vault-resource-group>/providers/Microsoft.KeyVault/vaults/<your-vault>"
        },
        "secretName": "servicebus-connection"
      }
    }
  }
}
```

Then deploy with a normal resource group deployment, passing only the non-secret suffix inline:

```bash
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file main.bicep \
  --parameters @main.parameters.json \
  --parameters revisionSuffix='build-142'
```

The vault needs `enabledForTemplateDeployment` turned on, and the deploying identity needs permission to read the secret. If you compose the template from modules, the Bicep equivalent is `getSecret()` on an `existing` Key Vault resource, passed into a module's `@secure()` parameter.

The worker's subscription name matches its Dapr app ID on purpose. The Dapr Service Bus pub/sub component uses the app ID as the consumer ID by default, so the subscription KEDA watches is the one Dapr is reading from. If those two drift apart, the worker will sit at zero replicas while messages pile up somewhere else.

That's also why the template declares the subscription itself. Left alone, Dapr creates the subscription the first time a worker replica starts and subscribes. With `minReplicas: 0`, no replica starts until KEDA sees a backlog, and KEDA can't see a backlog on a subscription that doesn't exist yet. Messages published before then are never delivered to it, so the worker can sit at zero indefinitely. Create the subscription in the same deployment, or make sure it already exists.

## Revisions and traffic splitting

The default for `activeRevisionsMode` in this API version is **multiple**, not single. If you leave it out, every deployment leaves the previous revision active. Ingress still sends traffic to the latest revision by default, but the old replicas keep running, still cost money and can still be reached on their own revision FQDN. For a queue worker, old and new revisions will both process messages. That is why I set it explicitly to `single` in the example. For most APIs, single mode is the right default: a new revision becomes active, the old one is deactivated, and you get the closest thing to a normal rolling deployment.

Switch to multiple mode only when you actually want a canary or blue/green release. Then you name the revisions in the `configuration.ingress.traffic` array, which is application scope, so shifting weights doesn't create yet another revision. This is a fragment that replaces the ingress block above:

```bicep
ingress: {
  external: true
  targetPort: 8080
  traffic: [
    {
      revisionName: 'orders-api--build-141'
      weight: 90
    }
    {
      latestRevision: true
      weight: 10
    }
  ]
}
```

Revision names are the app name, a double hyphen and the suffix, which is another reason to set `revisionSuffix` deliberately instead of relying on the generated one. A suffix you can't predict is a traffic rule you can't write in advance.

A suffix can't be reused, so if the suffix comes from the image tag, a scale-rule change without a new image will fail to deploy. Give the suffix its own parameter, as the example does, and feed it something that changes on every deployment, such as the CI build number. This is also why restarting a revision is the better way to pick up a rotated secret: it changes nothing in `template`, so it needs no new suffix. In this API version it's a POST to the revision's `restart` action:

```bash
az rest --method post \
  --url "https://management.azure.com/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.Web/containerApps/orders-api/revisions/orders-api--build-142/restart?api-version=2021-03-01"
```

## Scale rules are KEDA with a thin wrapper

The `scale.rules` array accepts three kinds of rule: `http` (concurrent requests per replica), `azureQueue` (Azure Storage queue length), and `custom`. The `custom` rule is where most of the power is. Its `type` is a KEDA scaler name, and `metadata` is passed through to that scaler, so the Service Bus rule above uses the same `topicName`, `subscriptionName` and `messageCount` fields documented for KEDA's [Azure Service Bus scaler](https://keda.sh/docs/2.5/scalers/azure-service-bus/). The `auth` array maps a Container Apps secret onto the scaler's trigger parameter, here `connection`.

A few things to keep in mind, all visible in the [scaling docs](https://learn.microsoft.com/en-us/azure/container-apps/scale-app):

- Metadata values are strings, even numeric ones. The schema types metadata as a map of strings, so `messageCount: 20` without quotes fails validation.
- If you don't set `maxReplicas`, it defaults to 10. Set it explicitly so the number in your template is the number you reasoned about.
- Scaling to zero is great for queue workers and poor for user-facing APIs. The first request after an idle period waits for a replica to start, which is why the API above keeps `minReplicas: 1`.
- Scale rules live in `template`, so every tweak is a new revision. Settle the numbers in a test environment before they become revision noise in production.

## Dapr components are scoped to the app, for now

The biggest design surprise in the preview API is where Dapr components live. In `2021-03-01`, the `components` array sits inside each app's `template.dapr` block. There's no environment-level component resource yet. Two apps that share a pub/sub broker each declare the component, and each carries its own copy of the connection string secret.

That has three effects. Components are versioned with the app, so changing broker metadata produces a new revision of every app that uses it. Secrets are duplicated, which means more places to rotate. And there's no single place to see which brokers and state stores an environment depends on. The Bicep `var` in the example keeps the definition in one place in source control, which is the best mitigation available today. The [Dapr integration docs](https://learn.microsoft.com/en-us/azure/container-apps/dapr-overview) are worth rereading before each deployment while the preview evolves, because this is the area I'd expect to change most.

## What's missing, and when I wouldn't use it yet

The preview API is honest about its gaps if you read the schema:

- **No managed identity on the app.** Registry pulls use a username and a password secret. Don't reach for the ACR admin user just because it's the easy option: it has push and delete rights over the whole registry. Create an ACR scoped token mapped to the built-in `_repositories_pull` scope map instead (scoped tokens are themselves a preview ACR feature right now), so a leaked secret can only pull images. Downstream services also need connection strings or keys rather than Azure AD tokens.
- **No health probe settings.** There's nothing in the container definition for liveness or readiness, so slow-starting apps need to be tolerant of early traffic.
- **No SLA.** It's a preview. I would not put a revenue-critical workload on it yet.

Given that, I'd use Container Apps today for internal APIs, event-driven workers and proof-of-concept microservices, especially where scale to zero saves real money. I would not use it where you need Azure AD identity end to end, fine-grained network policy, custom operators, or anything that requires `kubectl` access. That is still AKS territory. If the workload is a single web app or a few functions, App Service or Azure Functions remain simpler and are generally available.

## Where I land

Treat the `configuration` versus `template` split as the mental model and most of the preview's behaviour becomes predictable. Set `activeRevisionsMode` explicitly, give `revisionSuffix` its own per-deployment parameter, create the queues and subscriptions your scalers watch, quote your KEDA metadata, keep Dapr components in one Bicep variable, and keep the resource definitions isolated so the inevitable API changes before GA are cheap. Container Apps is already the most pleasant way I know to run event-driven containers on Azure; just build as if the resource model will move under you, because it probably will.
