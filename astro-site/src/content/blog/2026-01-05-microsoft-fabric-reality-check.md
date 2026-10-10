---
title: "Microsoft Fabric Reality Check: What Holds Up and What Hurts"
description: "An honest look at running Microsoft Fabric on an F64: what OneLake and Direct Lake deliver, how throttling really works, and what the bill looks like."
author: Michael John Peña
draft: false
date: 2026-01-05
tags:
  - Microsoft Fabric
  - Power BI
  - Azure
  - Analytics
  - Cost Optimization
---

Most Fabric content is either a launch-day feature tour or a complaint thread. Neither helps when you're deciding whether to consolidate a Synapse and Power BI Premium estate onto a single capacity. After six months of running Fabric in production, my view is that it's a sound platform with a different operating model, and most of the pain I've seen comes from treating it like the services it replaced.

## What we're running

Our footprint is modest, which is exactly why it's useful as a reference point:

| Item | Count |
|---|---|
| Workspaces | 3 (dev, staging, production) |
| Data in OneLake | ~500 GB |
| Pipelines | 15 |
| Power BI reports | 8 |
| Warehouses | 4 |
| Daily active users | ~50 |
| Capacity | F64 |

## What holds up

### OneLake removes duplicate copies

Before Fabric, the same data lived in Data Lake Storage Gen2, again in a Synapse dedicated pool, and again inside imported Power BI datasets. Each copy needed its own load, its own security and its own failure handling. OneLake gives every workload one logical lake, and the lakehouse and warehouse store tables in Delta Parquet. That doesn't make data modelling easier, but it does remove a whole category of "why don't these numbers match" problems caused by copies drifting apart.

### Delta time travel saves bad loads

Because the tables are Delta, you get ACID writes, schema evolution and time travel without extra work. For data quality, time travel matters more than people expect: when a bad load lands, you can query the previous version, compare, and restore instead of rebuilding from source. A dropped column or bad overwrite can be undone with `RESTORE` within your retention window, and warehouses have their own restore points. Treat that as recovery, not a licence to skip testing in dev.

### Direct Lake changed how reports feel

Our reports went from 5–10 second waits to near-instant once we moved the main models to Direct Lake. The trade-off is that Direct Lake has per-SKU guardrails on table size and row counts, and models that read through the SQL analytics endpoint can fall back to DirectQuery when they hit them or meet a feature they can't serve. The [Direct Lake overview](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-overview) lists the guardrails per SKU. Design the gold-layer tables for Direct Lake deliberately rather than pointing it at whatever the pipelines happen to produce. I covered the design side in [Direct Lake best practices](/blog/2024-01-17-direct-lake-best-practices/).

### Git integration now reaches Power BI (in preview)

Version control for Power BI was a long-standing gap. Fabric's [Git integration](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/intro-to-git-integration) (Azure DevOps or GitHub) now covers reports and semantic models, both still in preview, alongside notebooks and pipelines. Warehouses are in preview too, so check the supported-items list before promising that "everything is in Git".

## What hurts

### Capacity units are hard to forecast

A Fabric capacity is a pool of capacity units (CUs) that every workload draws from: Spark, pipelines, warehouse queries, semantic model refreshes and report interactions. That's simpler to buy than five separate meters, but harder to forecast. We couldn't predict usage from a design document; we needed real workload data.

The method that works for me: Microsoft's [Fabric SKU Estimator](https://learn.microsoft.com/en-us/fabric/enterprise/fabric-sku-estimator) (preview) gives you a starting guess, then run a trial or pay-as-you-go capacity with representative workloads for two to four weeks. On the Compute page of the Capacity Metrics app, read the Utilization chart and its split between background and interactive operations, and check the Background rejection chart under Throttling. Size on the smoothed background baseline plus your interactive peaks, with headroom, rather than on the single worst spike.

### Throttling degrades in stages, and users feel it first

The common complaint is that Fabric "just stops working" when you exceed capacity. That's not quite how it works. Fabric smooths usage: interactive operations over a short window, background operations (refreshes, pipelines, most warehouse work) over 24 hours. When smoothed usage runs ahead of what you've paid for, the [throttling policy](https://learn.microsoft.com/en-us/fabric/enterprise/throttling) escalates in stages:

| Future capacity already consumed | What happens |
|---|---|
| Up to 10 minutes | Overage protection, no throttling |
| 10 to 60 minutes | Interactive requests delayed by 20 seconds |
| 60 minutes to 24 hours | Interactive requests rejected |
| More than 24 hours | All requests rejected, including background jobs |

So there's degradation, but it lands on the wrong people. A capacity is shared, so one badly written query or an oversized Spark job can push it into debt, and your report users are the first to feel it. Isolate resource-intensive or unpredictable workloads where you can. For Spark-heavy work, [Autoscale Billing for Spark](https://learn.microsoft.com/en-us/fabric/data-engineering/autoscale-billing-for-spark-overview) (GA since July 2025) moves jobs off the shared capacity onto pay-as-you-go serverless billing, which is often cheaper than a second capacity just for isolation. The mitigation that actually helps is [surge protection](https://learn.microsoft.com/en-us/fabric/enterprise/surge-protection), GA since June 2025: it rejects new background jobs before they starve interactive users. It doesn't cancel running jobs, so it isn't a hard cap, but it's the first setting I'd configure on any shared capacity.

There are two thresholds, both a percentage of 24-hour background utilisation: rejection, where the capacity starts refusing new background jobs, and recovery, where it accepts them again. Don't copy a fixed number. Read your typical background percentage off the Background rejection chart, set rejection a margin above it (as a starting point, something around 80% is reasonable when your baseline sits well below it) and recovery close to that baseline, so there's a real gap to burn down before jobs resume. If 80–90% of your usage is background anyway, surge protection does little, as Microsoft's guidance notes. If the smoothing model is new to you, my earlier post on [smoothing and bursting](/blog/2024-08-25-smoothing-bursting-fabric/) walks through it.

One trap worth calling out: Import-mode semantic model refreshes are background operations, smoothed over 24 hours like everything else in that bucket. A heavy refresh schedule therefore stays invisible in day-to-day use until the accumulated debt tips the capacity into throttling.

### Monitoring takes real effort

The Capacity Metrics app is where you go to understand CU consumption, and it's not intuitive. It tells you what consumed capacity, not why. We built custom monitoring because the built-in view wasn't enough for daily operations. The monitoring hub and workspace monitoring (preview) help with item-level history, but expect to invest here regardless.

### Migration is a re-platform

Moving from Synapse plus Power BI to Fabric isn't a re-point. Budget more time than you think and plan a test pass for the areas that behave differently. Three I'd check first:

- **T-SQL surface area.** Fabric Warehouse doesn't support everything a Synapse dedicated SQL pool does. Review the documented [Warehouse T-SQL surface area](https://learn.microsoft.com/en-us/fabric/data-warehouse/tsql-surface-area) against your stored procedures and DDL (materialized views and triggers, for example) before assuming they port unchanged.
- **Refresh behaviour in Direct Lake.** An Import model's incremental refresh policy doesn't carry over to Direct Lake. Direct Lake reframes against the current Delta tables, so the incremental logic moves into your pipelines and table design. Test how each model behaves straight after a pipeline load.
- **Workspace reassignment and region.** Moving workspaces from a P to an F capacity is mostly an admin task, but a workspace can only [move to a capacity in another region](https://learn.microsoft.com/en-us/fabric/admin/portal-workspace-capacity-reassignment) once every non-movable item (anything other than reports, dashboards, small-format semantic models and a few other Power BI items) is removed, and that includes large-format semantic models and hidden Dataflow Gen2 staging items. A region mismatch turns a reassignment into a rebuild. Pick the capacity region to sit with your data sources, and test reassignment with workspaces that hold Fabric items and large semantic models before you schedule the cut-over.

## The real cost numbers

Our F64 runs at ~US$8,000 a month, close to pay-as-you-go list, so a reservation is our obvious next lever now that we have six months of usage data. The prices below are US list prices for reference (pay-as-you-go is US$0.18 per CU-hour, about US$8,410 a month for F64); region, currency and agreement discounts move the actual bill. What it replaced:

| Previous service | Monthly cost |
|---|---|
| Synapse dedicated SQL pool | ~US$6,000 |
| Power BI Premium | ~US$5,000 |
| Data Lake Storage Gen2 | ~US$1,000 |
| **Total** | **~US$12,000** |

Fabric is cheaper while doing more. Two pricing details matter more than the headline:

- **F64 is the free-viewer threshold.** On F64 and above, users with a free licence can view Power BI content shared through the capacity, as they could on P1. Below F64, every viewer needs a Pro or Premium Per User licence. Microsoft announced in early 2024 that it would retire the Power BI Premium P SKUs; new purchases stopped on 1 July 2024, non-EA renewals ended on 1 February 2025, and EA customers can renew annually until their EA term ends. The [migration overview](https://learn.microsoft.com/en-us/power-bi/support/premium-migration-overview) covers the grace-period rules. P1 maps to F64, so this is the comparison most Power BI shops will face.
- **Reserved pricing is the real lever.** Pay-as-you-go is the wrong baseline for a production capacity that runs around the clock. A [one-year Fabric capacity reservation](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/fabric-capacity) is about 40% off pay-as-you-go, which takes an F64 from about US$8,410 to about US$5,000 a month. Against the ~US$12,000 legacy total, that's the comparison that matters: well under half the old bill, not two-thirds of it. The catch: you pay the reservation even while paused, so reserve the steady baseline and use pay-as-you-go for dev, test and occasional scale-ups.

## What I'd do differently

1. **Start smaller and measure.** We chose F64 on recommendation. We probably could have started at F32 and scaled up. Do the licence maths first: on F32, our ~50 viewers would each need Pro. At US list prices, F32 pay-as-you-go is about US$4,205 a month plus 50 Pro licences at US$14 (about US$700), so roughly US$4,900. Compare that against F64 reserved (~US$5,000), not pay-as-you-go, and the saving almost disappears. Creators and publishers need Pro on either SKU, so only viewer licences are extra on F32, and users with Pro through Microsoft 365 E5 shrink that further. The answer depends on your licence mix.
2. **Test the differences early.** Run the three migration checks above in the first sprint, not in front of users.
3. **Build observability from day one.** Decide which CU and job-failure signals you'll watch, and keep a record of which items and schedules drive CU usage, before go-live. The first throttling incident is a bad time to start.
4. **Reserve the baseline once usage is stable.** A few weeks of Metrics app data is enough to commit to a reservation; staying on pay-as-you-go after that just pays list price for flexibility you don't use.
5. **Set guardrails before people arrive.** Naming conventions, workspace structure and an approval process for new items. Without them, a shared capacity becomes a shared mess quickly.

## The verdict

Fabric is working for us, and we're staying on it. The integration is real, Direct Lake performance is good, and running one platform beats operating five separate services. But if nobody owns the Metrics app, the capacity model will bite you, and your report users will feel it before you do. If you're evaluating it, run a proof of concept on a non-critical workload, collect a few weeks of Capacity Metrics data, and only then size the capacity, buy the reservation and plan the migration.

**Good fit:**

- Heavy Power BI users, especially those facing a P SKU renewal
- Teams consolidating several Azure data services with copies of the same data
- Microsoft-centric organisations that value one security and billing model

**Think harder first:**

- Real-time or customer-facing workloads that need predictable performance on a shared capacity
- Multi-cloud strategies where vendor flexibility is a hard requirement
- Teams without the people to run capacity monitoring and governance
