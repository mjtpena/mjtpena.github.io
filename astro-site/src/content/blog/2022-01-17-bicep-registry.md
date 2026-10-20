---
title: "Bicep Private Module Registry: Publishing and Versioning with ACR"
description: "How to run a private Bicep module registry on Azure Container Registry: publishing, aliases, immutable versions, and when template specs fit better."
author: Michael John Peña
draft: false
date: 2022-01-17
url: /blog/bicep-registry/
tags:
  - Azure
  - Bicep
  - Infrastructure as Code
  - DevOps
---

Bicep modules solve reuse inside one repository. The problem starts when a second team wants your storage account module and the answer is "copy the folder", or a Git submodule nobody wants to maintain. Within a few months you have five forks of the same module, each with a slightly different idea of what "secure by default" means, and no way to tell which deployments are running which version.

The private module registry, which shipped in [Bicep v0.4.1008](https://github.com/Azure/bicep/releases/tag/v0.4.1008) in October 2021, is the fix. You publish compiled modules to an Azure Container Registry as OCI artifacts and reference them by tag from any Bicep file. This post covers how I'd set one up as of January 2022, and the versioning discipline that decides whether it helps or hurts. If you're new to modules, start with [Bicep Modules for Modular Azure Infrastructure](/blog/2021-06-11-bicep-modules-azure/), and for the wider picture of where Bicep sits this year, see [my Bicep in 2022 post](/blog/2022-01-16-azure-bicep-2022/).

## What exists today, and what doesn't

It's worth being precise about the tooling, because it moved quickly in late 2021:

| Capability | Status in January 2022 |
|---|---|
| `br:` registry module references | Shipped in Bicep v0.4.1008 (October 2021) |
| `ts:` template spec module references | Shipped in the same release |
| `az bicep publish` | Added in Azure CLI 2.30.0 (2 November 2021) |
| Aliases in `bicepconfig.json` (`moduleAliases`) | Available, including aliases at publish time since v0.4.1124 |
| Digest references (`@sha256:...`) | Supported since Bicep v0.4.1124 (December 2021) |
| `az bicep restore` | Not in Azure CLI yet; restore runs automatically on build and deploy, or use the standalone `bicep restore` |
| Public Microsoft module registry | Announced as planned for Bicep v0.5, not available yet |

So everything in this post is about a **private** registry you own. A public catalogue of Microsoft-maintained modules is coming, but I wouldn't plan around a date.

One design point matters more than any command: the registry is a **build-time** dependency, not a deploy-time one. When you build or deploy a Bicep file, Bicep restores the referenced modules into a local cache (`~/.bicep` by default), then compiles everything into a single ARM JSON template with nested deployments. Azure Resource Manager never talks to your registry. That means registry outages don't break running deployments, and it also means the identity running the build needs pull rights on the registry, which is not always the same identity that holds deployment rights.

## Create the registry

A Basic SKU registry is enough to start. Modules are small and pull volume is low. You'd move to Premium if you need private endpoints or geo-replication, and that decision is usually driven by your network policy rather than by Bicep.

```bicep
// registry.bicep
@description('Globally unique registry name, 5-50 alphanumeric characters')
@minLength(5)
@maxLength(50)
param registryName string

param location string = resourceGroup().location

resource acr 'Microsoft.ContainerRegistry/registries@2021-09-01' = {
  name: registryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

output loginServer string = acr.properties.loginServer
```

Keep the admin user off. Access should go through Azure AD and RBAC: give consumers (developers, and the pipelines that build templates) **AcrPull**, and give only the publishing pipeline **AcrPush**. The [ACR roles reference](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-roles) lists exactly what each role allows. Bicep authenticates using your existing Azure CLI or Azure PowerShell sign-in, in that order by default, so there are no registry credentials to manage.

## Publish a module

A module in the registry is just a normal Bicep file. Here's one I'd consider a reasonable baseline for storage:

```bicep
// modules/storage-account/main.bicep
@description('Storage account name, 3-24 lowercase letters and numbers')
@minLength(3)
@maxLength(24)
param name string

param location string = resourceGroup().location

@allowed([
  'Standard_LRS'
  'Standard_ZRS'
  'Standard_GRS'
])
param sku string = 'Standard_LRS'

@description('Days to keep soft-deleted blobs')
@minValue(1)
@maxValue(365)
param softDeleteRetentionDays int = 7

param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2021-08-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteRetentionDays
    }
  }
}

output id string = storageAccount.id
output name string = storageAccount.name
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
```

Notice what isn't there: a connection string output built from `listKeys()`. Module outputs are stored in the deployment history in plain text, so a shared module that emits account keys leaks them to everyone with read access on the resource group. A registry module gets reused far more than a local one, which makes that mistake far more expensive. Consumers who need data access should use managed identities and role assignments instead.

Publishing is one command:

```bash
az bicep publish \
  --file modules/storage-account/main.bicep \
  --target br:<your-registry-name>.azurecr.io/bicep/modules/storage-account:v1.0.0
```

Bicep compiles the file first, so a module with errors never reaches the registry. Keep repository paths lowercase and pick a prefix like `bicep/modules/` so modules don't collide with container images in the same registry.

## Consume it, preferably through an alias

You can reference the full path directly:

```bicep
module storage 'br:<your-registry-name>.azurecr.io/bicep/modules/storage-account:v1.0.0' = {
  name: 'storage'
  params: {
    name: 'st${uniqueString(resourceGroup().id)}'
  }
}
```

That works, but the registry host ends up hard-coded in every file. An alias in [`bicepconfig.json`](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-config-modules) moves it to one place:

```json
{
  "moduleAliases": {
    "br": {
      "CoreModules": {
        "registry": "<your-registry-name>.azurecr.io",
        "modulePath": "bicep/modules"
      }
    },
    "ts": {
      "CoreSpecs": {
        "subscription": "00000000-0000-0000-0000-000000000000",
        "resourceGroup": "rg-template-specs"
      }
    }
  }
}
```

The reference then becomes much shorter:

```bicep
param location string = resourceGroup().location

module storage 'br/CoreModules:storage-account:v1.0.0' = {
  name: 'storage'
  params: {
    name: 'st${uniqueString(resourceGroup().id)}'
    location: location
  }
}

output blobEndpoint string = storage.outputs.blobEndpoint
```

Aliases are a small thing that pays off later. If you ever move the registry, or split dev and prod registries, you change one config file per repository instead of every module reference.

## Versioning is the real work

The registry gives you distribution. It does not give you a release process, and this is where I see teams get it wrong.

**Tags are mutable.** ACR tags can be overwritten, and in the current Bicep release `publish` doesn't check whether the target tag already exists. Publish `v1.0.0` twice and every consumer silently picks up the second build the next time their cache is cold. That's the worst kind of change: invisible in the consumer's pull request, and different between a laptop with a warm cache and a fresh build agent.

My rules:

- **Never republish a tag.** Treat every published version as immutable and enforce it, rather than relying on discipline. ACR can [lock a tag](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-image-lock) with `--write-enabled false`, which makes an overwrite fail.
- **Use semantic versions and mean them.** Adding an optional parameter is a minor bump. Renaming a parameter, removing an output, or changing a default that alters deployed resources is a major bump.
- **Don't publish `latest`.** Bicep requires an explicit tag in every reference, which is a good design choice. Publishing a floating tag just recreates the mutability problem on purpose.
- **Pin by digest where it matters.** For regulated workloads, `br:<registry>/bicep/modules/storage-account@sha256:<digest>` guarantees byte-for-byte the same module regardless of what happens to tags. Get the digest with `az acr repository show --name <your-registry-name> --image bicep/modules/storage-account:v1.0.0 --query digest -o tsv`.

## Automate publishing from main

Each module lives in its own folder with a `version.txt`. The pipeline publishes only versions that don't exist yet and locks them straight after:

```bash
#!/usr/bin/env bash
# scripts/publish-modules.sh
set -euo pipefail

REGISTRY_NAME="<your-registry-name>"
REGISTRY="${REGISTRY_NAME}.azurecr.io"

# First pass: fail before anything is published if a module has no version.txt
for dir in modules/*/; do
  if [[ ! -s "${dir}version.txt" ]]; then
    echo "Missing or empty ${dir}version.txt" >&2
    exit 1
  fi
done

for dir in modules/*/; do
  name=$(basename "$dir")
  version=$(tr -d '[:space:]' < "${dir}version.txt")
  repo="bicep/modules/${name}"

  # show-tags fails for a repository that doesn't exist yet (a module's first
  # publish), which is why its errors are suppressed. The catch: an auth error
  # also reads as "not published", and the publish step will then fail loudly.
  if az acr repository show-tags --name "$REGISTRY_NAME" --repository "$repo" --output tsv 2>/dev/null | grep -qx "$version"; then
    echo "Skipping ${repo}:${version}, already published"
    continue
  fi

  echo "Publishing ${repo}:${version}"
  az bicep publish --file "${dir}main.bicep" --target "br:${REGISTRY}/${repo}:${version}"
  az acr repository update --name "$REGISTRY_NAME" --image "${repo}:${version}" --write-enabled false --output none
done
```

```yaml
# .github/workflows/publish-bicep-modules.yml
name: Publish Bicep modules

on:
  push:
    branches: [main]
    paths:
      - 'modules/**'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Install Bicep
        run: az bicep install

      - name: Build every module
        run: |
          for f in modules/*/main.bicep; do
            az bicep build --file "$f"
          done

      - name: Publish new versions
        run: bash scripts/publish-modules.sh
```

Building every module before publishing any of them means one broken module stops the run before anything is pushed. If a developer forgets to bump `version.txt`, the script skips the module instead of overwriting it, which is the failure mode you want. Pair that with a pull request check that fails when a module changes without a version bump, and the process mostly enforces itself.

The lock step needs more than AcrPush. According to the [ACR roles reference](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-roles), AcrPush lets you push and pull images, and that's all. It doesn't let you change image attributes, and `--write-enabled false` is an attribute change. Give the publishing service principal Contributor scoped to the registry resource only, not the resource group or subscription. That role covers pushing and locking. If your security team won't grant Contributor to a pipeline identity, split the lock into its own job that runs under a separate identity that has it. Don't drop the lock step: without it, immutability is a convention again.

## Registry, template specs or a shared repo?

Bicep can also consume [template specs](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/template-specs) through `ts:` references, and plenty of teams still just reference modules by relative path in one repository. They suit different situations:

| Option | Good fit | Weak spot |
|---|---|---|
| Relative path modules | One team, one repo, modules change with the app | No versioning across repos |
| Private registry (`br:`) | Platform team publishing to many app teams | You own the release process and tag immutability |
| Template specs (`ts:`) | Teams that also deploy from the portal or need Azure RBAC on each template | Versions are mutable resources, and they're tied to a subscription and resource group |

I wouldn't introduce a registry for a single team with a single repository. The extra step between changing a module and using it slows you down, and you get nothing for it. The registry earns its place when there's a clear producer and several consumers: a platform or cloud centre of excellence team that owns landing zone building blocks, and application teams that consume them.

## Where I'd land

Start with a Basic ACR, Azure AD access only, and one alias per environment in `bicepconfig.json`. Publish from a pipeline, never from a laptop, and make published versions immutable from day one, because retrofitting that discipline after consumers depend on mutable tags is painful. Keep secrets out of module outputs. And keep the module count small at first: three well-versioned modules that people trust are worth more than thirty that nobody is sure they can upgrade.
