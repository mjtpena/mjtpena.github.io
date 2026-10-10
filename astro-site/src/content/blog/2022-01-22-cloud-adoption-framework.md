---
title: "Cloud Adoption Framework: The Half That Isn't Landing Zones"
description: "How to use the Microsoft Cloud Adoption Framework for strategy, planning, governance and operations, not just as a landing zone template library."
author: Michael John Peña
draft: false
date: 2022-01-22
url: /blog/cloud-adoption-framework/
tags:
  - Azure
  - Governance
  - Strategy
  - Migration
---

In my experience, most Azure programmes adopt the Cloud Adoption Framework (CAF) in a narrow way: someone deploys an enterprise-scale landing zone, the team calls itself "CAF-aligned", and the rest of the framework is never opened. The landing zone is the easy part. Programmes stall on the questions CAF spends most of its pages on: why are we moving, what are we moving first, who decides, and who runs it once it is there.

Yesterday's post covered the technical foundation in [Azure Landing Zones: Enterprise-Scale Cloud Foundation](/blog/azure-landing-zones/). This one is about everything around it, and how I'd use the rest of the framework without turning it into a documentation exercise.

## What CAF actually is

The [Cloud Adoption Framework for Azure](https://learn.microsoft.com/azure/cloud-adoption-framework/) is a free body of guidance, templates and assessments from Microsoft. It isn't a product, a licence or a certification. As of early 2022 it's organised into a set of methodologies:

| Methodology | Question it answers | Typical owner |
|---|---|---|
| Strategy | Why are we adopting cloud, and what outcomes do we expect? | Business sponsor, CIO |
| Plan | What's in the estate, what moves, in what order, with what skills? | Programme lead, architects |
| Ready | Is the Azure environment ready to receive workloads? | Platform team |
| Adopt (Migrate / Innovate) | How do we move existing workloads or build new ones? | Workload teams |
| Govern | How do we keep cost, security and consistency under control? | Cloud governance team |
| Manage | How do we operate what's now in Azure? | Operations |
| Secure | How does security improve across the whole journey? | CISO, security architects |
| Organize | Which teams and functions does all of this need? | Leadership, HR |

[Secure](https://learn.microsoft.com/azure/cloud-adoption-framework/secure/overview) is the newest of these. Microsoft added it in 2021 to give CISOs a view of cloud security that runs alongside the other methodologies, not as one more step at the end. If you last read CAF in 2020, that section is worth a look.

The methodologies are not a waterfall. Strategy and Plan come first for the first wave of workloads. After that, Ready, Adopt, Govern and Manage run in parallel and loop for every wave.

## Strategy: write down the motivation, then test it

The Strategy methodology asks you to record your motivations (cost, agility, a data centre exit, a merger, innovation), the business outcomes you expect, a business justification, and a first adoption project.

The mistake I see most often is a strategy that lists every motivation at once. "Reduce cost, increase agility, enable innovation" isn't a strategy, because each one leads to different decisions:

- A **data centre exit** with a contract end date favours rehosting quickly and fixing things afterwards.
- **Cost reduction** favours right-sizing, retiring unused workloads and reserved capacity, and it punishes a lift-and-shift of oversized VMs.
- **Innovation** favours platform services and new builds, and may barely touch the existing estate.

My rule of thumb: pick one primary motivation and at most one secondary. Agree up front which one wins when they conflict, because they will. Then attach a measurable outcome to each, with a baseline you can measure today. If nobody can say what the current infrastructure costs, a "30% saving" target can't be proven or disproven later.

The first adoption project matters more than it looks. Choose a workload that is low-risk, visible enough that people notice when it succeeds, and representative enough that the team learns something reusable. A stateless internal web app with a SQL back end usually beats both a trivial file share and the core ERP.

## Plan: rationalise the digital estate before you size anything

The Plan methodology centres on the digital estate: the inventory of applications, VMs, data and dependencies you own. CAF frames each asset against the five Rs of rationalisation: rehost, refactor, rearchitect, rebuild and replace. Some workloads should be retired outright, and those are the cheapest migrations you will ever do.

For on-premises estates, [Azure Migrate](https://learn.microsoft.com/azure/migrate/migrate-services-overview) does the discovery and dependency analysis, and its assessments recommend VM sizes from performance data. Use it instead of spreadsheets compiled from interviews. Interviews tell you who owns a workload. Performance data tells you what it actually needs.

Many organisations also already have Azure subscriptions that grew without a plan: proof-of-concept environments, a team's credit-card subscription, a vendor-managed tenant. That estate belongs in the plan too. Azure Resource Graph is the fastest way to see it across every subscription you can read:

```bash
# Requires the Azure CLI and the resource-graph extension:
#   az extension add --name resource-graph
az login

# Resource count per subscription and resource group
az graph query -q "
Resources
| summarize resources = count() by subscriptionId, resourceGroup
| order by resources desc" --first 1000 -o table

# Resources with no 'owner' tag, grouped by type.
# Tag keys are case-sensitive in KQL: adjust the key if your estate uses 'Owner'.
az graph query -q "
Resources
| where isempty(tostring(tags['owner']))
| summarize untagged = count() by subscriptionId, type
| order by untagged desc" --first 1000 -o table
```

The second query is usually the uncomfortable one. Resources without a clear owner can't be rationalised, because nobody has the authority to retire them. Fix ownership before you build the migration backlog.

The other half of Plan is skills. A skills readiness plan sounds like HR paperwork, but it decides whether the platform team can operate what Ready builds. If the people who will run the landing zone haven't touched Azure Policy or Bicep, put that training before the landing zone deployment, not after.

## Ready and Adopt: keep the landing zone in proportion

Ready is where landing zones live, and I covered the architecture [in the previous post](/blog/azure-landing-zones/). The point I'd add here is proportion. The enterprise-scale reference implementation assumes a platform team, multiple subscriptions and a hub-and-spoke or Virtual WAN network. That suits a 500-workload migration. It's heavy for a company moving ten workloads with two engineers.

CAF says this itself. Its [landing zone journey](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/landing-zone-journey) lets you start small and refactor towards the target architecture as adoption grows. Choose the starting point that fits the team you actually have. A landing zone nobody understands is a governance risk of its own.

Adopt splits into Migrate (move existing workloads, wave by wave) and Innovate (build new cloud-native solutions). For Migrate, let the dependency data from Plan shape the waves: servers that talk to each other move together, so an application isn't split from its database across a WAN link for weeks. Keep the Migrate and Innovate backlogs separate. They have different success measures, and mixing them lets a slow migration hide behind an exciting innovation demo.

## Govern: start with the minimum viable product

CAF's governance methodology is built on five disciplines: Cost Management, Security Baseline, Identity Baseline, Resource Consistency and Deployment Acceleration. Its most useful advice is to start with a minimum viable product and grow governance as the risk grows. Don't design the end state before the first workload lands.

In practice, the initial governance MVP I'd put in place before the first production workload is short:

- A management group hierarchy, so policy and RBAC are assigned once (see [Azure Management Groups for Enterprise Hierarchy](/blog/azure-management-groups/)).
- Allowed regions and a required owner and cost-centre tag, enforced with [Azure Policy](/blog/azure-policy-compliance/).
- A budget with alerts on every subscription.
- Privileged roles assigned to Azure Active Directory groups rather than individuals, with Privileged Identity Management where you have the licence.
- Diagnostic settings sending activity logs to a central Log Analytics workspace.

Everything else, such as detailed network rules, encryption standards and chargeback, can come in later iterations, once real workloads show you where the risk actually is. Governance that blocks the first migration for three months doesn't reduce risk. It pushes teams back to the credit-card subscriptions you just found with Resource Graph.

## Manage: agree the operations baseline before go-live

The Manage methodology asks you to define an operations baseline (inventory and visibility, operational compliance, and protection and recovery) and then decide which workloads need more than that baseline. CAF calls this an operations baseline plus business commitments: you agree with the business which workloads get enhanced recovery or platform-specific operations, and what that costs.

The trade-off is explicit. Every workload gets the baseline. Only the workloads whose business impact justifies it get more. If you skip that conversation, every system gets treated as critical, operations costs climb, and the cost-reduction motivation from Strategy quietly fails.

## Secure and Organize: the parts people skip

These two get the least attention and cause the most friction later.

### Secure

Secure has eight disciplines: risk insights, security integration, resilience, access control, security operations, asset protection, security governance and innovation security. Its main value is getting the security team involved from the strategy stage, so security shapes the landing zone design instead of only approving it.

If you can only do one discipline before the landing zone build, make it access control. Decide how identities, privileged roles and network access will work across subscriptions, because that design is the hardest to change once workloads depend on it.

### Organize

Organize describes the functions a programme needs: a cloud strategy team, cloud adoption, a central IT team, cloud operations, a cloud centre of excellence, cloud governance and cloud security. In a small organisation one person may cover three of these. That's fine, as long as someone is explicitly accountable for each. The failure mode isn't small teams. It's functions nobody owns.

## When not to lean on CAF

CAF is written for programmes. For a single new application in an existing, well-governed Azure tenant, the [Azure Well-Architected Framework](/blog/well-architected-framework/) is the better guide, because it focuses on the workload instead of the adoption journey. CAF is also not a compliance standard. Saying a design is "CAF-aligned" proves nothing to an auditor. Map your controls to the framework the auditor actually uses.

## How I'd use it

Read Strategy, Plan and Govern before you deploy anything. Write a one-page strategy with one primary motivation and measurable outcomes. Inventory the estate, including the Azure you already have, and fix ownership. Size the landing zone to your team, put in a minimum viable governance baseline, and agree the operations baseline before the first go-live. Then let each migration wave tell you what to tighten next.
