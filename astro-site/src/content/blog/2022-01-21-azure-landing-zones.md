---
title: "Azure Landing Zones: Accelerator, Terraform Module or Your Own Bicep"
description: "What an Azure landing zone is in early 2022, and how to choose between the portal accelerator, the Terraform module and your own Bicep."
author: Michael John Peña
draft: false
date: 2022-01-21
url: /blog/azure-landing-zones/
tags:
  - Azure
  - Governance
  - Architecture
  - Bicep
  - Enterprise
---

Most Azure estates don't fail because someone picked the wrong VM size. They fail because the first three subscriptions were created by hand, each with its own network ranges, its own idea of who gets Owner and no policy at all, and by subscription twenty nobody can untangle it. An Azure landing zone is Microsoft's answer to that: a pre-agreed shape for subscriptions, identity, networking and policy that every new workload lands into. The concept is sound. The arguments start over how much of it you adopt, and with which tooling.

## What a landing zone is (and isn't)

In the [Cloud Adoption Framework's landing zone guidance](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/), a landing zone is an environment that is already provisioned through code and ready to host a workload. It isn't a product you buy or a single template you run. Enterprise-scale is the opinionated reference architecture for it, organised around eight design areas:

- Azure billing and Active Directory tenant
- Identity and access management
- Resource organisation (management groups and subscriptions)
- Network topology and connectivity
- Security
- Management (logging, monitoring, backup)
- Governance (Azure Policy and cost)
- Platform automation and DevOps

The useful mental split is **platform landing zones** versus **application landing zones**. Platform subscriptions hold shared services owned by a central team: a management subscription with the central Log Analytics workspace, a connectivity subscription with the hub network, and an identity subscription for domain controllers if you still need them. Application landing zones are the subscriptions handed to workload teams. They inherit policy and network plumbing from above and own everything inside.

That split is the most valuable idea in the whole framework. When it's clear, the platform team can say "no public IPs in Corp" through policy rather than through a ticket queue, and workload teams get a subscription in hours instead of weeks.

## The management group hierarchy

The reference hierarchy looks like this:

```text
Tenant Root Group
└── contoso                  (intermediate root)
    ├── contoso-platform
    │   ├── contoso-management
    │   ├── contoso-connectivity
    │   └── contoso-identity
    ├── contoso-landingzones
    │   ├── contoso-corp     (private, connected to the hub)
    │   └── contoso-online   (internet-facing)
    ├── contoso-sandbox
    └── contoso-decommissioned
```

Three choices in that tree are worth defending, because they're the ones teams try to change.

**An intermediate root instead of the Tenant Root Group.** Assigning policy at the Tenant Root Group affects every subscription in the tenant, including ones you don't control yet, and changing anything there needs elevated access. An intermediate root gives you the same inheritance with a scope you own.

**Corp and Online by connectivity, not by environment.** The instinct is to build `prod` and `nonprod` branches. I'd resist it. Production and development of the same app should face the same policies; otherwise you only discover a denied configuration on the way to production. Environment belongs in the subscription, not the management group. The dimension that genuinely changes policy is whether a workload is private and routed through the hub (Corp) or published to the internet (Online). I made the same argument at more length in [my management groups post](/blog/2021-06-14-azure-management-groups/).

**Sandbox and Decommissioned as real branches.** Sandbox subscriptions get relaxed policy and no hub connectivity, so experiments can't leak into the corporate network. Decommissioned is where subscriptions go to be cancelled, with policy that stops new resources being created while you confirm nothing still depends on them.

Keep it shallow. Azure allows six levels of management groups below the root and 10,000 management groups per tenant, but every extra level is another place to look when you're working out why a deployment was denied.

## Three ways to build it

As of January 2022 there are three realistic routes, and the right one depends far more on your team than on Azure.

| Option | What you get | Fits when | Watch out for |
|---|---|---|---|
| Enterprise-scale portal accelerator ([Azure/Enterprise-Scale](https://github.com/Azure/Enterprise-Scale)) | Full hierarchy, policy set, logging and optional hub network, deployed from a portal wizard backed by ARM templates | You need a working baseline quickly and have no IaC team yet | Day two. The portal deploys once; unless you turn on its optional GitHub/AzOps pipeline integration, you need your own way to manage changes afterwards |
| [Terraform module](https://github.com/Azure/terraform-azurerm-caf-enterprise-scale) (`caf-enterprise-scale`) | The same architecture as a Terraform module, generally available since v1.0.0 in October 2021 | You already run Terraform and want lifecycle management from day one | It's a large module with many policies; read what it assigns before you `apply` |
| Your own Bicep or ARM | Exactly what you write, nothing more | Small estate, strong Bicep skills, or requirements far from the reference | You now own the policy set, its upgrades and its documentation |

My default advice: if you're a Terraform shop, use the module, because its upgrade path is the main thing you're paying for. If you're not, deploy the portal accelerator into a test tenant first, even if you never use it in production. Seeing the full set of resources and policy assignments it creates is the fastest way to find out what you've left out of your own design. If you do use it for real and you're not a Terraform shop, switch on the GitHub integration so [AzOps](https://github.com/Azure/AzOps) pulls the deployed state into a repository and pushes later changes through GitHub Actions; that's your day-two story instead of portal clicks.

Hand-rolled Bicep is a fine choice when you know which parts of the reference you're deliberately skipping. It's a poor choice when it's really an excuse to skip the policy and logging work. A management group tree with no policy assigned to it is just folders.

## The hierarchy in Bicep

If you do go your own way, the management group tree is the easy part. This file deploys at tenant scope and uses loops for the leaf groups:

```bicep
// mg-hierarchy.bicep
targetScope = 'tenant'

@description('Short prefix for the intermediate root, for example an abbreviation of the organisation name.')
param prefix string = 'contoso'

param platformChildren array = [
  {
    name: 'management'
    displayName: 'Management'
  }
  {
    name: 'connectivity'
    displayName: 'Connectivity'
  }
  {
    name: 'identity'
    displayName: 'Identity'
  }
]

param landingZoneChildren array = [
  {
    name: 'corp'
    displayName: 'Corp'
  }
  {
    name: 'online'
    displayName: 'Online'
  }
]

resource intermediateRoot 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: prefix
  properties: {
    displayName: prefix
  }
}

resource platform 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${prefix}-platform'
  properties: {
    displayName: 'Platform'
    details: {
      parent: {
        id: intermediateRoot.id
      }
    }
  }
}

resource landingZones 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${prefix}-landingzones'
  properties: {
    displayName: 'Landing Zones'
    details: {
      parent: {
        id: intermediateRoot.id
      }
    }
  }
}

resource sandbox 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${prefix}-sandbox'
  properties: {
    displayName: 'Sandbox'
    details: {
      parent: {
        id: intermediateRoot.id
      }
    }
  }
}

resource decommissioned 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${prefix}-decommissioned'
  properties: {
    displayName: 'Decommissioned'
    details: {
      parent: {
        id: intermediateRoot.id
      }
    }
  }
}

resource platformGroups 'Microsoft.Management/managementGroups@2021-04-01' = [for child in platformChildren: {
  name: '${prefix}-${child.name}'
  properties: {
    displayName: child.displayName
    details: {
      parent: {
        id: platform.id
      }
    }
  }
}]

resource landingZoneGroups 'Microsoft.Management/managementGroups@2021-04-01' = [for child in landingZoneChildren: {
  name: '${prefix}-${child.name}'
  properties: {
    displayName: child.displayName
    details: {
      parent: {
        id: landingZones.id
      }
    }
  }
}]
```

```bash
az deployment tenant create \
  --name mg-hierarchy \
  --location australiaeast \
  --template-file mg-hierarchy.bicep \
  --parameters prefix=<your-prefix>
```

The catch is permissions. A [tenant-scope deployment](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-to-tenant) needs a role assignment at `/`, which nobody has by default. A Global Administrator has to elevate access, grant the deployment identity the role, and then remove the elevation. Do that once, deliberately, for a dedicated pipeline identity, and write down who holds it. This isn't unique to Bicep: the portal accelerator and the Terraform module both need Owner at the tenant root too, so plan the elevation step whichever route you pick.

After the tree, policy is the real work. I covered the pipeline side in [Azure Policy as code](/blog/2022-01-19-azure-policy-as-code/), and if you were planning to package all of this with Blueprints, read [why I'd hedge against Blueprints](/blog/2022-01-20-azure-blueprints-deprecation/) first.

## Where landing zones go wrong

**Treating the hub as the landing zone.** Teams often spend weeks on the connectivity subscription (firewall, gateways, DNS) and almost no time on subscription vending, the process that creates a new application landing zone, puts it in the right management group, peers it to the hub and assigns the owning team. If vending is a manual ticket, you've rebuilt the bottleneck the architecture was meant to remove. On an Enterprise Agreement or Microsoft Customer Agreement, the subscription alias API (`Microsoft.Subscription/aliases`) lets an ARM or Bicep template create the subscription itself, so a pipeline can run creation, placement, peering and role assignment as one request. If you're on the Terraform module, its custom landing zone inputs are the place to declare which management group each subscription belongs in, though creating the subscription is still a separate step.

**Peering that only works one way.** A spoke-to-hub peering needs a matching hub-to-spoke peering in the connectivity subscription, and `useRemoteGateways` on the spoke fails if the hub has no VPN or ExpressRoute gateway yet. Template the peering as a pair, with the gateway setting as a parameter, and run it as part of vending rather than by hand.

**Hub-and-spoke versus Virtual WAN, decided by habit.** Both are supported connectivity models in the reference architecture. A customer-managed hub gives you full control over routing; Virtual WAN takes routing off your hands and suits many regions and branches. If you have one or two regions and a network team that wants control, hub-and-spoke is fine. If you're connecting dozens of sites, look hard at Virtual WAN before building your own transit.

**Deny policies on day one.** Starting with `Deny` on a brownfield estate breaks deployments that people depend on. Start with `Audit` (or `enforcementMode: DoNotEnforce`), look at what's non-compliant, then tighten.

## When not to bother

If you have one subscription, one team and no regulatory pressure, the full architecture is overhead. Use a sensible naming convention, a couple of policy assignments and a resource group per workload, and revisit when a second team asks for its own subscription. The landing zone earns its keep when more than one team deploys to Azure and someone central is accountable for security and cost across all of them.

My rule of thumb: adopt the hierarchy and the platform/application split early, because they're painful to retrofit, and adopt the rest of the reference implementation as fast as your team can genuinely operate it. A landing zone nobody maintains is just a more elaborate version of the mess it was supposed to prevent.
