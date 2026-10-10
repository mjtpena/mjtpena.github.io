---
title: "Azure Blueprints Is Still in Preview: Hedging With Bicep and Template Specs"
description: "Azure Blueprints has sat in preview since 2018; here's how to keep landing zone governance portable with Bicep, Template Specs, Policy and locks."
author: Michael John Peña
draft: false
date: 2022-01-20
url: /blog/azure-blueprints-deprecation/
tags:
  - Azure
  - Governance
  - Blueprints
  - Bicep
  - Infrastructure as Code
---

Azure Blueprints was announced in preview at Ignite in 2018, and more than three years later it still carries the "(Preview)" label with no published GA date. Meanwhile, the rest of the Azure Resource Manager toolchain has moved fast: Bicep is production-ready, Template Specs are generally available, and Azure Policy keeps gaining built-in definitions. If your landing zone governance depends on Blueprints, you are building on the one part of that stack that isn't standing still. That doesn't mean ripping it out tomorrow. It means structuring your work so it would survive Blueprints going away.

I've written before about [using Blueprints for environment governance](/blog/2021-02-07-azure-blueprints-environment-governance/), and I still think the idea behind it is right. This post is about the risk side: what Blueprints gives you that nothing else does, what you can already do elsewhere, and how to hedge.

## What Blueprints actually bundles

A blueprint definition is a package of four artifact types, published as a version and assigned to a subscription:

- **Resource groups** to create
- **ARM template** deployments, at subscription or resource group level
- **Policy assignments**
- **Role assignments**

On top of that packaging, a blueprint assignment adds two things: it tracks which definition version a subscription is on, and it can apply [resource locking](https://learn.microsoft.com/en-us/azure/governance/blueprints/concepts/resource-locking) in "Do Not Delete" or "Read Only" mode.

Most of those pieces are thin wrappers over features you can use directly. The packaging and versioning are useful but replaceable. The locking is the hard part, and I'll come back to it.

## Why I'm cautious about Blueprints in 2022

None of what follows is an announcement from Microsoft. It's my reading of where the platform is heading and what it costs to stay put.

**It's preview, and has been for a long time.** Preview services come without an SLA, and preview APIs can change. For a tool that sits at the root of every subscription you create, that's a real governance question, not a technicality.

**ARM template artifacts are JSON only.** You can author in Bicep, but you have to run `bicep build` and paste or import the compiled JSON as an artifact. Your source of truth becomes the generated file, which is the opposite of why you adopted Bicep.

**The authoring loop is awkward.** Definitions as code are possible with the `Az.Blueprint` module (`Export-AzBlueprintWithArtifact` and `Import-AzBlueprintWithArtifact`), but the folder layout is Blueprint-specific and the module is still a 0.x preview release. `what-if` doesn't understand blueprint assignments, so you can't preview a change the way you can for an ordinary deployment.

**The rest of ARM covers most of it now.** [Template Specs](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/template-specs) give you versioned, RBAC-controlled templates stored in Azure. Bicep handles subscription-scope deployments, resource groups, role assignments and policy assignments in one file. The gap between "Blueprint" and "a well-structured Bicep deployment" is smaller than it was in 2019.

## The mapping

| Blueprint concept | What you can use today | Gap |
|---|---|---|
| Blueprint definition and versions | Template Spec with versions | None worth worrying about |
| Resource group artifact | `Microsoft.Resources/resourceGroups` in a subscription-scope Bicep file | None |
| ARM template artifact | Bicep modules | Better, not worse |
| Policy assignment artifact | Bicep policy assignments, or management-group-level Azure Policy | None |
| Role assignment artifact | Bicep role assignments | None |
| Assignment tracking per subscription | Deployment history plus tags, or your pipeline's records | Weaker; you build the reporting |
| Blueprint locks (deny assignments) | Resource locks plus RBAC and Azure Policy | Real gap; see below |

## Step one: get your definitions into source control

Even if you keep using Blueprints, export what you have. Many teams built their blueprints in the portal, so the only copy lives in Azure.

```powershell
# Requires the Az.Blueprint module: Install-Module Az.Blueprint
Connect-AzAccount

$bp = Get-AzBlueprint `
    -ManagementGroupId "<your-management-group-id>" `
    -Name "<your-blueprint-name>" `
    -LatestPublished

Export-AzBlueprintWithArtifact `
    -Blueprint $bp `
    -OutputPath "./blueprints"
```

This writes a `<your-blueprint-name>` folder containing `blueprint.json` and an `artifacts` subfolder with one JSON file per artifact. Commit it. Even if you never migrate, you now have a diffable history and a way to recreate the blueprint with `Import-AzBlueprintWithArtifact`. The [import and export how-to](https://learn.microsoft.com/en-us/azure/governance/blueprints/how-to/import-export-ps) covers the folder structure it expects.

## Step two: express the same intent in Bicep

The exported artifacts translate almost line for line into a subscription-scope Bicep file. This is a fragment of a typical baseline: a resource group, an "Allowed locations" policy, a role assignment and a delete lock.

```bicep
// main.bicep
targetScope = 'subscription'

param location string = 'australiaeast'
param environmentName string
param platformTeamObjectId string

var allowedLocationsPolicyId = '/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c'
var contributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6181-4fd3-a1c5-c2e5a2e26e30')

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-shared-${environmentName}'
  location: location
  tags: {
    environment: environmentName
    managedBy: 'landing-zone-baseline'
  }
}

resource allowedLocations 'Microsoft.Authorization/policyAssignments@2020-09-01' = {
  name: 'allowed-locations'
  properties: {
    displayName: 'Allowed locations'
    policyDefinitionId: allowedLocationsPolicyId
    parameters: {
      listOfAllowedLocations: {
        value: [
          'australiaeast'
          'australiasoutheast'
        ]
      }
    }
  }
}

resource platformContributor 'Microsoft.Authorization/roleAssignments@2020-04-01-preview' = {
  name: guid(subscription().id, platformTeamObjectId, contributorRoleId)
  properties: {
    roleDefinitionId: contributorRoleId
    principalId: platformTeamObjectId
    principalType: 'Group'
  }
}

module lock 'modules/rg-lock.bicep' = {
  name: 'rg-lock'
  scope: rg
}
```

```bicep
// modules/rg-lock.bicep
resource lock 'Microsoft.Authorization/locks@2016-09-01' = {
  name: 'do-not-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Managed by the landing zone baseline deployment.'
  }
}
```

Publish it as a Template Spec so other teams can deploy a specific version without needing access to your repository. The Azure CLI compiles the Bicep file for you (Azure CLI 2.27 or later):

```bash
az ts create \
  --name landing-zone-baseline \
  --version 1.0.0 \
  --resource-group rg-template-specs \
  --location australiaeast \
  --template-file main.bicep

az deployment sub create \
  --location australiaeast \
  --template-spec "/subscriptions/<your-subscription-id>/resourceGroups/rg-template-specs/providers/Microsoft.Resources/templateSpecs/landing-zone-baseline/versions/1.0.0" \
  --parameters environmentName=dev platformTeamObjectId=<your-group-object-id>
```

I covered Template Spec versioning and access control in more depth in [ARM Template Specs for enterprise template management](/blog/2021-06-12-arm-template-specs/), and module structure in [Bicep modules](/blog/2021-06-11-bicep-modules-azure/).

## Step three: wire it into a pipeline

The part Blueprints never did well was CI/CD. With plain Bicep you get linting, `what-if` and a normal deployment history.

```yaml
# .github/workflows/landing-zone.yml
name: Deploy landing zone baseline

on:
  workflow_dispatch:
    inputs:
      environmentName:
        description: Environment
        required: true
        type: choice
        options:
          - dev
          - prod

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environmentName }}
    steps:
      - uses: actions/checkout@v2

      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Lint
        run: az bicep build --file main.bicep

      - name: Preview changes
        run: |
          az deployment sub what-if \
            --location australiaeast \
            --template-file main.bicep \
            --parameters environmentName=${{ github.event.inputs.environmentName }} \
                         platformTeamObjectId=${{ secrets.PLATFORM_TEAM_OBJECT_ID }}

      - name: Deploy
        run: |
          az deployment sub create \
            --location australiaeast \
            --template-file main.bicep \
            --parameters environmentName=${{ github.event.inputs.environmentName }} \
                         platformTeamObjectId=${{ secrets.PLATFORM_TEAM_OBJECT_ID }}
```

Use GitHub environments with required reviewers on `prod` so the `what-if` output gets a human look before the deploy step runs.

## The locking gap is real

This is the part I'd want every platform team to understand before they decide anything. Blueprint locks are implemented with **deny assignments**, which you can't create yourself; only Azure-managed features like Blueprints can. A "Read Only" blueprint lock stops even a subscription Owner from changing the protected resources, unless they're in the assignment's excluded principals.

[Resource locks](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources) are not the same. Anyone with `Microsoft.Authorization/locks/delete` permission, which includes Owner and User Access Administrator, can remove the lock and then delete the resource. A resource lock protects against accidents, not against a determined admin.

So if you replace Blueprints with Bicep, you need to make up the difference with other controls:

- **Keep Owner rare.** Application teams get Contributor, which can't remove locks. Owner sits with the platform team, ideally through Azure AD Privileged Identity Management so it's time-bound and audited.
- **Push guardrails up to management groups.** Policy assigned at a management group can't be removed by a subscription Owner. Put your deny policies there, not in a per-subscription deployment.
- **Alert on lock deletion.** An Activity Log alert on `Microsoft.Authorization/locks/delete` is cheap and catches the cases RBAC doesn't.

If your compliance requirements genuinely need "nobody, including Owner, can touch this", Blueprints is still the only general-purpose first-party way to get that for your own landing-zone resources today. That's a legitimate reason to stay.

## When not to move yet

I would not migrate a working Blueprints setup just because it's preview. Stay put if:

- You depend on Read Only blueprint locks for regulatory reasons and can't tighten RBAC to compensate.
- Your auditors already accept blueprint assignment status as evidence, and the reporting you'd need to rebuild isn't worth it this year.
- The blueprint is small, stable and rarely changes.

Do start the hedge if you're about to create new blueprints, if you're already authoring in Bicep and pasting compiled JSON into artifacts, or if nobody on the team can say which version is assigned where.

## My recommendation

For new landing zones in 2022, I'd start with subscription-scope Bicep published as Template Specs, deployed from a pipeline, with policy at the management group and tight RBAC. For existing Blueprints, export them into source control this week, write the Bicep equivalent alongside, and keep Blueprints only for the locking it uniquely provides. If you want a reference pattern rather than starting from a blank file, look at Microsoft's [Enterprise-Scale landing zone reference implementation](https://github.com/Azure/Enterprise-Scale), which deploys management groups, policy and role assignments at management-group scope as ARM templates. Even if you don't adopt it wholesale, it shows how Microsoft itself structures this without Blueprints.

If Microsoft ships a GA Blueprints, or something better for locking, you lose nothing: your intent is already in Bicep, and that is the format the rest of ARM is converging on. For where Bicep itself is heading this year, see [Azure Bicep in 2022](/blog/2022-01-16-azure-bicep-2022/).
