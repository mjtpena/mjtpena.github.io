---
title: "Azure in 2021: Where I'd Place My Bets This Year"
description: "Five Azure bets for 2021 on Arc, Synapse, Purview, edge and security, with what was GA versus preview on 1 January and where I'd hold back."
author: Michael John Peña
draft: false
date: 2021-01-01
tags:
  - Azure
  - Predictions
  - Trends
  - Data Platform
  - Hybrid Cloud
---

First post of 2021. The kids are still on summer holidays here in Australia, the home office is half-disassembled for cleaning, and I'm sketching out what I think the year ahead looks like for Azure. 2020 was the year cloud became survival; 2021 is the year teams ask "now what?" Below are the bets I'm making in client conversations. It isn't a marketing forecast, just where I'd put effort if I were starting a new build today, and where I'd deliberately wait.

Yesterday's [2020 year in review](/blog/2020-12-31-azure-year-in-review-2020/) looked backwards. This post looks forwards, and the most useful thing I can add is a clear line between what is generally available today and what is still preview. Most of the bad architecture decisions I see come from treating a preview announcement as a roadmap commitment.

## Where things stand on 1 January 2021

Check status before you draw the architecture. Here is where the services I'll talk about stand today.

| Service | Status today | What that means for a new build |
|---|---|---|
| Azure Synapse Analytics (workspaces, serverless SQL, Spark) | GA since December 2020 | Safe to design around |
| Azure Purview | Public preview since December 2020 | Pilot, don't make it your system of record yet |
| Azure Arc enabled servers | GA since Ignite (September 2020) | Usable for inventory, policy and monitoring today |
| Azure Arc enabled Kubernetes | Preview | Pilot GitOps and policy on one or two clusters |
| Azure Arc enabled data services | Preview since September 2020 | Lab only |
| Azure Stack HCI (version 20H2) | GA since December 2020 | Real option for hardware refreshes |
| Azure Communication Services | Public preview since September 2020 | Prototype only |
| Dapr | v1.0 release candidates | Close, but not 1.0 yet |
| Bicep | v0.2, labelled alpha | Learn it, don't standardise on it |

## Bet 1: hybrid stops being a dirty word, through Azure Arc

Microsoft's hybrid story used to be "run a smaller Azure in your datacentre" (Azure Stack Hub). Azure Arc flips that: leave the workload where it is and project it into Azure Resource Manager so the same Azure Policy, RBAC, tagging and monitoring apply. Arc enabled servers went GA at Ignite in September 2020. Arc enabled Kubernetes and [Arc enabled data services](https://learn.microsoft.com/azure/azure-arc/data/overview) (SQL Managed Instance and PostgreSQL Hyperscale on your own Kubernetes) are still in preview.

My prediction is that Arc enabled Kubernetes reaches GA this year and becomes the default answer for organisations with clusters in more than one place. The governance pitch is strong: one policy definition, enforced on AKS, on-premises and another cloud.

Where I'd hold back: Arc enabled data services. Running a managed-instance-style database on your own Kubernetes means you own the storage, backups and the cluster upgrades underneath it. For most Australian enterprises I talk to, the honest answer is still "move the database to Azure SQL" rather than "bring Azure SQL to your rack". Arc data services make sense when data sovereignty or latency genuinely prevents that, not as a default.

## Bet 2: Synapse becomes the default analytics front door

Azure Synapse Analytics workspaces reached GA in December 2020, with Synapse Studio, serverless SQL pools, Apache Spark pools and integrated pipelines in one place. The [Synapse overview](https://learn.microsoft.com/azure/synapse-analytics/overview-what-is) is worth rereading with fresh eyes, because the serverless SQL pool changes the economics of exploratory work. You pay per terabyte processed, not for a provisioned warehouse that sits idle at 2am.

What I expect in 2021:

- **Serverless SQL over the lake becomes the first thing teams reach for.** Querying Parquet and CSV in ADLS Gen2 with T-SQL, then exposing views to Power BI, removes a whole class of "load it into a warehouse first" projects.
- **Dedicated SQL pools (formerly SQL DW) get used more deliberately.** They're still the right tool for predictable, heavy, concurrent BI workloads. They are the wrong tool for a team with 200 GB of data and three analysts.
- **HDInsight Spark workloads start migrating.** If you're on HDInsight purely for Spark, the choice in 2021 is Synapse Spark pools or Azure Databricks.

That last choice is where I have an opinion. Databricks is ahead on Spark runtime performance, Delta Lake tooling and notebook experience, and its SQL Analytics preview (announced November 2020) is aimed squarely at the warehouse. Synapse wins on integration: one workspace, one security model, pipelines and SQL in the same place. My rule of thumb: if your team is mostly SQL and Power BI people, start with Synapse. If it's mostly data engineers and data scientists writing Python, Databricks still earns its place. Running both is fine, as long as you're honest that you're paying for two platforms.

## Bet 3: governance gets funded, and Purview is the reason

[Azure Purview](https://learn.microsoft.com/purview/) entered public preview in December 2020: automated scanning and classification across Azure, on-premises SQL Server and Power BI, a business glossary, and lineage pushed automatically from Azure Data Factory and Azure Data Share, plus Power BI lineage from scanning. Synapse integration is on the roadmap but not there today. Governance has always been the line item that gets cut. A catalogue that populates itself changes that conversation, because the effort to get started drops from months to days.

I'd pilot it now on one domain, get the scanning and classification running, and find out how your data owners react to seeing their assets in a catalogue. I would not make it your system of record for access approvals or regulatory lineage yet. Preview pricing applies and may change at GA, and features that matter for production (fine-grained catalogue permissions, broader connector coverage) are still landing.

## Bet 4: the edge gets real hardware and real use cases

Two things changed in December. The new [Azure Stack HCI](https://learn.microsoft.com/azure-stack/hci/overview) (version 20H2) went GA as an Azure service, billed per core per month through your Azure subscription, registered with Azure and managed alongside your cloud resources. And Cognitive Services containers (speech, text analytics, Form Recognizer and others) mean some AI workloads can run near the data instead of shipping it to a region.

My prediction is that 2021 hardware refresh conversations will include Azure Stack HCI by default, and that IoT Edge plus containerised models becomes a standard pattern in manufacturing and retail. The trade-off is that Cognitive Services containers aren't fully offline: each one still needs a connection to Azure to report usage for billing, so "runs at the edge" doesn't mean "runs disconnected". Some, such as Form Recognizer, are still in preview and gated behind an access request, which is not something to build a production line around.

I'd keep inference in the Azure region when the site has reliable connectivity, the latency budget is measured in seconds rather than milliseconds, and nothing stops the data leaving the building. Moving models to the edge buys latency and data locality, but you take on patching, monitoring and model rollout across every site. That cost only pays off when the network or the regulator forces your hand.

I'm less convinced by the 5G edge story this year. The announcements are real, but outside a few carriers and markets, I don't expect many Australian customers to have production workloads there by December.

When not to bother: if your on-premises footprint is shrinking and you have a datacentre exit date, buying new HCI hardware is the wrong move. Put the money into migration.

## Bet 5: security moves from perimeter to identity

Zero Trust stopped being optional in 2020, when the perimeter went home with everyone's laptop. The pieces on Azure are now concrete:

- **Azure Active Directory** Conditional Access as the real control plane for who gets in, from what device, under what conditions.
- **Azure Defender**, the name Microsoft gave the Azure Security Center paid tier at Ignite 2020, for workload protection across VMs, SQL, storage, Kubernetes and Key Vault.
- **Azure confidential computing**, with DCsv2-series VMs using Intel SGX enclaves, for the narrow set of workloads where data must be protected even while in use.

My bet is that identity work (Conditional Access, privileged identity management, removing legacy authentication) delivers more risk reduction per dollar in 2021 than anything else on this list. Confidential computing is worth understanding but is still niche. If you haven't blocked legacy authentication protocols yet, enclaves are not your priority.

## Technologies I'm watching, not adopting

| Technology | Why it matters | Why I'm waiting |
|---|---|---|
| Dapr | Portable building blocks (state, pub/sub, bindings) for microservices | The project shipped v1.0-rc.2 in December; I'd wait for v1.0 ([Dapr's 2020 retrospective](https://blog.dapr.io/posts/2020/12/22/looking-back-at-2020/)) |
| Azure Communication Services | Voice, video, chat and SMS APIs on the same backbone as Teams | Public preview, so no SLA for customer-facing apps |
| Bicep | A far more readable language that compiles to ARM templates | v0.2 is labelled alpha; syntax is still changing |

Bicep is the one I'd spend a weekend on. ARM JSON is a tax every Azure team pays, and Bicep removes most of it without changing the deployment engine underneath. But if your team is productive with Terraform today, nothing about Bicep in January 2021 justifies switching.

## Industry clouds: one to watch, not to plan around

Microsoft Cloud for Healthcare went GA in late October 2020, packaging Azure, Dynamics 365, Microsoft 365 and Power Platform capabilities around care coordination and patient engagement. I expect more industry clouds to follow this year, with financial services and retail the obvious candidates. My advice is to treat these as accelerators and reference architectures, not as products that change your platform choices. The underlying services are the same ones you'd use anyway. If you work in health, the piece I'd look at directly is the Azure API for FHIR, which has been GA since 2019 and doesn't require buying into the wider bundle. The bundle earns its keep when you're already on Dynamics 365 and want the templates and data model pre-wired; if you're not, it's a lot of licensing to adopt for a head start you could get from a reference architecture.

## What I'd learn this year

If you're planning your own development for 2021, this is where I'd spend the hours:

1. **Data engineering on the lake**: ADLS Gen2, Parquet and Delta, serverless SQL and Spark. This skill set transfers across Synapse and Databricks.
2. **Identity**: Azure AD Conditional Access and managed identities. Every other area depends on it.
3. **Kubernetes fundamentals on AKS**, because Arc, edge and most of the platform roadmap assume it.
4. **Infrastructure as code**: ARM or Terraform properly, with an eye on Bicep.
5. **Applied AI**: Azure Machine Learning and Cognitive Services, with the focus on getting models into production rather than training them.

For certifications, AZ-104 (Administrator), AZ-204 (Developer) and AZ-500 (Security Engineer) are current and worth it. For data, today the Azure Data Engineer Associate is still DP-200 plus DP-201. For AI, it's AI-100. Check the Microsoft certification pages before you book; Microsoft revises these exams often and you don't want to study for one that's about to be retired.

## The short version

If I had to compress this into a plan for 2021: build analytics on Synapse or Databricks over ADLS Gen2, because that's GA and stable now. Pilot Purview and Arc enabled Kubernetes on something real but non-critical. Put your security budget into identity before anything exotic. Learn Bicep and Dapr so you're ready when they reach 1.0, but don't bet a production system on either today.

The pattern behind all of it is the same: separate what shipped from what was announced, and size your commitment to match. Happy New Year.
