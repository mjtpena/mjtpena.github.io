---
title: "Azure Bicep v0.2: Learn It Now, Hold Off on Production"
description: "What Azure Bicep v0.2 can and can't do in January 2021, how to build and deploy it today, and why I'd learn it now but wait for v0.3 before production."
author: Michael John Peña
draft: false
date: 2021-01-05
tags:
  - Azure
  - Bicep
  - Infrastructure as Code
  - ARM Templates
  - DevOps
---

ARM templates and I have a long, unhealthy relationship. Hundreds of lines of JSON to express what reads like fifteen lines of intent, with `concat()`, `resourceId()` and `reference()` calls nested three deep. Bicep is Microsoft's answer to that pain, and I'm convinced it's where Azure infrastructure as code is heading. But "where it's heading" and "what you should run your production estate on in January 2021" are two different questions. My answer: learn it now, and keep production on ARM JSON until v0.3.

## What Bicep actually is

Bicep is a domain-specific language that compiles to ARM template JSON. That's the whole trick, and it's a good one. There's no new deployment engine, no state file, and no new resource provider model. You write `.bicep`, the compiler emits a standard ARM template, and Azure Resource Manager deploys it exactly as it would any other template. Every resource type and API version that ARM supports can be deployed on day one, because Bicep isn't wrapping anything. The compiler validates against type definitions bundled with each release, so a brand-new type or API version may compile with a "type not available" warning (and no IntelliSense) until the next Bicep release ships its definitions, but it still deploys.

That's the key difference from Terraform, which I [covered last year](/blog/2020-09-02-terraform-azure-provider-basics/). Terraform keeps its own state and talks to Azure through a provider that has to catch up with new features. Bicep has no state and nothing to catch up on. If your organisation is Azure-only and already invested in ARM, Bicep removes the main reason people reach for Terraform: readability.

The latest release as I write this is [v0.2.212](https://github.com/Azure/bicep/releases/tag/v0.2.212), shipped on 18 December 2020. v0.2 (November 2020) brought modules, `targetScope`, IntelliSense and type validation in the VS Code extension, and a `bicep decompile` command. v0.2.212 added conditional resources and the `scope` property for extension resources such as locks and role assignments.

## The honest status: experimental

Every Bicep release so far is labelled alpha. The project's own [README at v0.2.212](https://github.com/Azure/bicep/blob/v0.2.212/README.md) is blunt about it: Bicep is "an experimental language", it is "not yet recommended for production usage", it isn't covered by Azure support plans, and breaking changes are expected. The team has said production use and support-plan coverage start with v0.3.

I take that at face value. The compiled output is plain ARM JSON, so the *deployment* risk is low; what you're exposed to is the *language* changing under you. If the syntax for parameter modifiers changes in 0.3 (and I'd bet on it), every file you've written needs touching.

Here's what v0.2 can and can't do today:

| Capability | v0.2.212 (December 2020) |
|---|---|
| Parameters, variables, outputs, expressions | Yes |
| String interpolation instead of `concat()` | Yes |
| Implicit dependencies from symbolic references | Yes |
| Modules (other `.bicep` files) | Yes |
| `targetScope` (resource group, subscription, management group, tenant) | Yes |
| Conditional resources (`if`) | Yes, new in 0.2.212 |
| Loops (ARM `copy`) | No |
| Single-line arrays and objects | No |
| Deploying `.bicep` directly from the Azure CLI | No, compile first |
| Azure support plan coverage | No |

The missing loops are the big one. Plenty of real templates create N subnets, N storage containers or N role assignments. In v0.2 you either write them out by hand or keep that part in ARM JSON.

## A realistic v0.2 template

Here's a small web workload: an App Service plan and web app, a storage account through a module, and an optional Log Analytics workspace. Everything below compiles with v0.2.212.

The storage module, `modules/storage.bicep`:

```bicep
param name string {
  minLength: 3
  maxLength: 24
  metadata: {
    description: 'Globally unique storage account name (lowercase letters and numbers).'
  }
}
param location string
param skuName string = 'Standard_LRS'

resource stg 'Microsoft.Storage/storageAccounts@2019-06-01' = {
  name: name
  location: location
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

output id string = stg.id
output blobEndpoint string = stg.properties.primaryEndpoints.blob
```

And `main.bicep`:

```bicep
param environmentName string {
  allowed: [
    'dev'
    'test'
    'prod'
  ]
  metadata: {
    description: 'Short environment name used in resource names.'
  }
}
param location string = resourceGroup().location
param deployLogAnalytics bool = false

var baseName = 'contoso-${environmentName}'
var suffix = uniqueString(resourceGroup().id)
var isProd = environmentName == 'prod'

resource plan 'Microsoft.Web/serverfarms@2020-06-01' = {
  name: '${baseName}-plan'
  location: location
  sku: {
    name: isProd ? 'P1v2' : 'B1'
  }
}

resource site 'Microsoft.Web/sites@2020-06-01' = {
  name: '${baseName}-web-${suffix}'
  location: location
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
  }
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: 'st${environmentName}${suffix}'
    location: location
    skuName: isProd ? 'Standard_ZRS' : 'Standard_LRS'
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2020-08-01' = if (deployLogAnalytics) {
  name: '${baseName}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

output siteHostName string = site.properties.defaultHostName
output blobEndpoint string = storage.outputs.blobEndpoint
```

A few things worth noticing.

**No `dependsOn`.** `serverFarmId: plan.id` tells the compiler the site depends on the plan, and it writes the `dependsOn` for you. This alone removes a whole class of ARM bugs where someone forgets a dependency and the deployment fails intermittently, depending on which resource ARM happens to create first.

**Parameter modifiers are an object.** In v0.2, constraints like `allowed`, `minLength` and `secure` go in a `{ }` block after the type, as the [v0.2.212 parameter spec](https://github.com/Azure/bicep/blob/v0.2.212/docs/spec/parameters.md) shows. This is exactly the sort of syntax I expect to change, so don't build tooling that parses it.

**Secrets go through `secure: true` and Key Vault.** There's no `getSecret()` function in v0.2, so the pattern is a parameter declared with `secure: true` (it compiles to `secureString`) and a [Key Vault reference in the parameters JSON file](https://learn.microsoft.com/azure/azure-resource-manager/templates/key-vault-parameter). The secret never appears in the template, the pipeline variables or the deployment history.

**Arrays are multi-line.** `allowed` has one value per line because single-line arrays don't parse yet. It's annoying for three values; you get used to it.

**ZRS depends on the region.** The prod branch picks `Standard_ZRS`, which only works in regions that support zone-redundant storage. If your `location` doesn't, the storage deployment fails, so either deploy prod to a region with availability zones or switch that value to `Standard_GRS`.

**Modules compile to nested deployments.** The `name` property on a module is required and becomes the name of the nested deployment you'll see in the portal. Give it something meaningful, because that's what you'll be searching for when a deployment fails.

## Building and deploying today

The Azure CLI doesn't understand `.bicep` files yet. You install the standalone Bicep CLI first (the [v0.2.212 install guide](https://github.com/Azure/bicep/blob/v0.2.212/docs/installing.md) covers Windows, macOS and Linux; on Linux it's a single binary download), then compile and deploy the generated JSON:

```bash
# Linux: install the Bicep CLI (see the install guide for Windows and macOS)
curl -Lo bicep https://github.com/Azure/bicep/releases/download/v0.2.212/bicep-linux-x64
chmod +x ./bicep
sudo mv ./bicep /usr/local/bin/bicep

bicep build main.bicep

az deployment group create \
  --resource-group <your-resource-group> \
  --template-file main.json \
  --parameters environmentName=dev deployLogAnalytics=true
```

The compile step is a small tax, but it has an upside: `main.json` is a reviewable artefact. In a pipeline I'd build in one stage, publish the JSON, and deploy that exact file in later stages. If Bicep ever produces something surprising, you can diff the JSON.

If you have existing templates, `bicep decompile azuredeploy.json` gives you a starting point. Treat it as a first draft. Decompiled output keeps ARM-isms like `resourceId()` calls and generated symbolic names, and anything using `copy` won't translate cleanly because Bicep has no loops yet.

## Where Bicep fits against the alternatives

| | ARM JSON | Bicep v0.2 | Terraform |
|---|---|---|---|
| Readability | Poor | Good | Good |
| State file | None | None | Required |
| New Azure features | Day one | Day one | When the provider adds them |
| Multi-cloud | No | No | Yes |
| Production-supported | Yes | No (alpha) | Yes |
| Loops | Yes (`copy`) | No | Yes |
| Preview changes | `what-if` | `what-if` (on the compiled JSON) | `terraform plan` |

`az deployment group what-if` is the closest thing ARM has to `terraform plan`, and it works on Bicep's compiled JSON, but it's noisier: it compares against live resource properties, so read-only and server-defaulted properties often show up as changes that aren't real. Treat its output as a guide, not a contract.

If you need to manage non-Azure resources, Terraform is still the answer and Bicep doesn't change that. If you're Azure-only, the trade-off is readability against maturity, and right now maturity wins for production.

## When not to use Bicep (yet)

- **Production pipelines that can't absorb breaking changes.** Until v0.3 lands, you're on an experimental language with no support plan.
- **Templates that depend on `copy` loops.** You'll fight the language or end up with copy-pasted resource blocks.
- **Teams that have just standardised on Terraform.** Switching tools for readability alone isn't worth the churn.
- **Regulated environments where every tool needs vendor support.** That box can't be ticked until v0.3.

## My recommendation for January 2021

Learn Bicep now. Install the CLI and the VS Code extension, rewrite one or two of your gnarliest ARM templates in it, and run `bicep decompile` over a few others to see what the conversion looks like. Use it for sandboxes, demos and proofs of concept, where a breaking change costs you an hour.

For production, keep shipping ARM JSON for now, but write it with the move in mind: fewer clever nested `concat()` expressions, clear parameter names, small linked templates that map neatly to future Bicep modules. When v0.3 arrives with support coverage and loops, the migration will be mostly mechanical. The [ARM template documentation](https://learn.microsoft.com/azure/azure-resource-manager/templates/overview) still applies to everything Bicep emits, so nothing you learn about the underlying engine is wasted.

Bicep is the first time ARM has felt pleasant to write. I just want it out of alpha before I bet a production estate on it.
