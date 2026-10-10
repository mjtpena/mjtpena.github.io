---
title: "Azure in 2022: Six Bets I'm Making on New Year's Day"
description: "Six predictions for Azure in 2022, from Container Apps and Bicep registries to gated Azure OpenAI access, Purview, Arc data services and carbon reporting."
author: Michael John Peña
draft: false
date: 2022-01-01
url: /blog/azure-predictions-2022/
tags:
  - Azure
  - Predictions
  - Cloud
  - Strategy
  - Trends
---

Azure ended 2021 with more overlapping options than ever: three or four ways to run a container, two infrastructure-as-code languages, and a data estate split across Synapse, Power BI and a newly GA Purview. The question I get most from teams isn't "what's new?" but "which of these should we actually build on?" These are my bets for 2022, written on the first day of the year, with the reasoning behind each and the cases where I'd hold back.

If you want the backdrop, I covered how the platform moved last year in [Azure 2021 Year in Review](/blog/2021-12-01-azure-2021-year-in-review/), and my bets from twelve months ago are in [Azure in 2021: Predictions and Trends](/blog/2021-01-01-azure-2021-predictions/).

## Bet 1: Container Apps becomes the default for "just run my container"

[Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/overview) went into public preview at Ignite on 2 November 2021. It runs on AKS under the covers, with KEDA for event-driven scaling, Dapr for service invocation and pub/sub, and Envoy for ingress, but you never touch the cluster. It can scale to zero, it keeps revisions so you can split traffic between versions, and it accepts any Linux container image from any registry.

That fills a real gap. App Service is great for web apps but awkward for background workers and queue processors. Azure Container Instances is fine for one-off jobs but has no real scaling model. AKS gives you everything, including the upgrade cycles, node pool management and ingress controllers you then have to own. Most of the microservice workloads I see don't need that control.

My prediction: Container Apps reaches GA in 2022, and by the end of the year it will be the first answer for HTTP APIs and event-driven workers that don't need custom Kubernetes resources.

Where I'd hold back right now:

- **It's a preview.** No SLA, and the resource provider and API surface can still change before GA. I'd use it for new internal services and proofs of concept, not a regulated production workload.
- **You can't reach the Kubernetes API.** If you need operators, custom CRDs, DaemonSets or specific node configuration, stay on AKS.
- **Networking is still basic.** Check the VNet integration options against your landing zone before committing.

I go deeper on the service in [Azure Container Apps Deep Dive](/blog/2022-01-02-azure-container-apps-deep-dive/).

## Bet 2: Bicep wins new IaC work on Azure, and registries make it scale

Since version 0.3, Bicep has been covered by Microsoft support plans and can express anything an ARM template can. Version 0.4.1008, released in October 2021, added [private module registries](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/private-module-registry) hosted in Azure Container Registry, so a platform team can publish a versioned storage or networking module and every application team can reference it with a `br:` path instead of copying files around.

I expect 2022 to be the year most Azure-only teams stop writing new JSON ARM templates. JSON becomes what Bicep compiles to, not what people author. The registry is the more important part, because shared, versioned modules are how you get consistency across dozens of subscriptions without a central team reviewing every pull request.

When not to switch: if you deploy to more than one cloud, or you already have mature Terraform modules and state management, Bicep doesn't buy you enough to justify a rewrite. It is an Azure-only language. I'd also not convert working ARM templates for the sake of it; `bicep decompile` gets you a starting point, but the output needs a human pass. More detail in [Bicep Registry](/blog/2022-01-17-bicep-registry/).

## Bet 3: Azure OpenAI opens up, but stays gated

Microsoft announced [Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/) in November 2021 as an invitation-only preview, giving access to OpenAI's GPT-3 models wrapped in Azure's enterprise security, compliance and regional availability. Access requires describing your use case, and Microsoft has been explicit that it is reviewing applications for responsible use. What the preview offers is narrow: the GPT-3 base models (Davinci, Curie, Babbage and Ada), in a limited set of regions, with modest quotas, so plan a use case that fits those models rather than one that assumes whatever OpenAI ships next.

My prediction: access widens in 2022, but it won't be a self-service, sign-up-and-go service. Expect an application process and content filtering to stay. That's the right call. A model that writes fluent, confident text is a liability if you put it in front of customers without guardrails.

What I'd do now: identify one or two internal use cases (summarising support tickets, drafting product descriptions for human review) and apply. What I wouldn't do is promise the business a customer-facing chatbot built on GPT-3 this year. The model is impressive at generating text, but it can't cite where an answer came from, and that is a hard problem for any regulated organisation.

## Bet 4: Governance catches up with the data platform

My claim: 2022 is the year Purview stops being a catalogue you populate by hand and starts being the place lineage across Synapse and Power BI actually shows up.

The evidence is already there. Azure Purview reached [GA on 28 September 2021](https://learn.microsoft.com/en-us/purview/), and it can already [scan a Power BI tenant](https://learn.microsoft.com/en-us/purview/register-scan-power-bi-tenant) to inventory workspaces, datasets and reports, and capture lineage from Azure Data Factory and Synapse pipelines when you connect those workspaces to the Purview account. What is still manual is everything a catalogue can't infer: glossary terms, data owners, classification rules beyond the built-in patterns, and lineage for anything that runs as custom code in a Spark notebook rather than as a pipeline activity. I expect Microsoft to keep closing the automated half of that gap during 2022, not to ship a new governance product.

The trap I'd avoid: buying Purview and expecting governance to appear. Automated scanning gives you an inventory. It doesn't give you owners, definitions or a decision about who may see customer data. Do the operating model first, then the tooling.

## Bet 5: Arc data services move from interesting to deployable

Azure Arc-enabled SQL Managed Instance went GA on 30 July 2021, while Arc-enabled PostgreSQL Hyperscale remained in preview (see the [Arc-enabled data services overview](https://learn.microsoft.com/en-us/azure/azure-arc/data/overview)). The pitch is that you get Azure's managed database experience (automated patching, backups, a consistent portal and billing) on any Kubernetes cluster, including on-premises.

For organisations that can't move certain databases to a public cloud region because of data residency rules or latency to factory systems, that is a genuine option rather than a slide. I expect more workload types and more customers running it in production during 2022.

When not to use it: if you don't already run Kubernetes well on-premises, Arc data services adds a platform you have to operate before you get any database benefit. In that case, SQL Server on Arc-enabled servers (for inventory and governance) or a straight move to Azure SQL Managed Instance is the simpler path.

## Bet 6: Cost and carbon become reporting requirements

In my experience, finance teams started asking harder questions about cloud spend once the post-migration bills settled into a run rate, and the answer they want is "who owns this and is it worth it?", not a list of Advisor recommendations. At the same time, Microsoft is putting emissions data in front of customers: [Microsoft Cloud for Sustainability](https://blogs.microsoft.com/blog/2021/07/14/microsoft-cloud-for-sustainability-empowering-organizations-on-their-path-to-net-zero/) was announced in preview in July 2021, and the [Emissions Impact Dashboard for Azure](https://learn.microsoft.com/en-us/power-bi/connect-data/service-connect-to-emissions-impact-dashboard), a Power BI template app that estimates the carbon emissions of your Azure usage, became generally available in October 2021.

My prediction: FinOps, the practice of making engineering teams accountable for what their cloud usage costs, picks up a carbon column in 2022. The concrete lever I'd pull is putting both data sets in the same place. Cost Management data can already be loaded into Power BI with the Azure Cost Management connector or from scheduled exports to a storage account, and the Emissions Impact Dashboard is itself a Power BI app. Put them in one Power BI workspace, join them on subscription, and you can give each owner a single report showing their spend, their emissions estimate and the trend for both. That changes the conversation from "the cloud bill went up" to "your subscription went up, here's why".

The decision that changes for a platform team is what to standardise first. A subscription-per-workload model with mandatory owner and cost-centre tags (enforced with Azure Policy) matters more this year than another round of right-sizing, because without it neither the cost nor the carbon numbers can be attributed to anyone. Right-sizing, reservations for steady workloads and Spot VMs for interruptible batch jobs are still worth doing; they just land better when someone owns the result.

When not to bother: if you don't yet have tagging and clear ownership, don't start with carbon. Emissions numbers you can't attribute to a team are numbers nobody can act on, and the Emissions Impact Dashboard reports at subscription and service level, so a shared "everything" subscription gives you one big figure and no decisions. Fix ownership first, then cost, then carbon.

## What I'm less sure about

**Security in the pipeline.** GitHub Advanced Security (code scanning, secret scanning and dependency review, the last still in beta) is strong, but it lives on GitHub. Plenty of Azure customers run Azure DevOps and won't move repositories for one feature. I'd like Microsoft to close that gap, but I wouldn't plan around it this year. If security scanning matters to you now, run the tools you already have in Azure Pipelines or start new repositories on GitHub.

**Consolidation.** I'd like to see fewer overlapping services and a clearer answer to "which one do I use?" Container Apps and Bicep are steps in that direction. Data and analytics still has the most overlap: Synapse already had dedicated SQL, serverless SQL and Spark, and picked up Data Explorer pools in public preview at Ignite in November (see the [Synapse what's new archive](https://learn.microsoft.com/en-us/azure/synapse-analytics/whats-new-archive)). That is more choice inside one workspace, not less, and I don't expect it to simplify this year.

## How I'd use these bets

None of these predictions means "adopt everything new". My rule of thumb for 2022:

| If you are... | Start with | Wait on |
|---|---|---|
| Building new microservices | Container Apps for non-critical services, AKS where you need control | Moving regulated production workloads off AKS until GA |
| Writing new infrastructure code | Bicep with a private registry for shared modules | Rewriting working Terraform or ARM |
| Exploring generative AI | Applying for Azure OpenAI access with an internal use case | Customer-facing generation without human review |
| Running a data platform | An ownership and classification model, then Purview | Expecting one unified product this year |
| Under cost or carbon pressure | Owner tags, then one Power BI workspace for cost and emissions | Carbon targets before spend can be attributed |

The theme across all six is the same: Azure is giving teams fewer reasons to build their own platform plumbing. The teams that benefit are the ones that pick the managed option deliberately, know its limits, and keep the escape hatch (AKS, Terraform, plain SQL) for the cases that genuinely need it.
