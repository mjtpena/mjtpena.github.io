---
title: "Microsoft Fabric Reality Check: What Holds Up and What Hurts"
description: "An honest look at running Microsoft Fabric on an F64: what OneLake and Direct Lake deliver, how throttling really works, and what the bill looks like."
author: Michael John Peña
draft: false
date: 2026-01-05
tags:
  - Fabric
  - Azure
  - Data
  - Analytics
  - Cost
---

Most Fabric content is either a launch-day feature tour or a complaint thread. Neither helps when you're deciding whether to consolidate a Synapse and Power BI Premium estate onto a single capacity. After six months of running Fabric in production, my view is that it's a sound platform with a different operating model, and most of the pain I've seen comes from treating it like the services it replaced.

## What we're running

Our footprint is modest, which is exactly why it's useful as a reference point:

| Item | Count |
|---|---|
| Workspaces | 3 (dev, staging, production) |
| Data in OneLake | ~500 GB |
| Data pipelines | 15 |
| Power BI reports | 8 |
| Warehouses | 4 |
| Daily active users | ~50 |
| Capacity | F64 |

Nothing here is exotic. If Fabric couldn't handle this comfortably, it wouldn't be worth discussing.

## What holds up

### OneLake removes duplicate copies

Before Fabric, the same data lived in Data Lake Storage Gen2, again in a Synapse dedicated pool, and again inside imported Power BI datasets. Each copy needed its own load, its own security and its own failure handling. OneLake gives every workload one logical lake, and the lakehouse and warehouse store tables in Delta Parquet. That doesn't make data modelling easier, but it does remove a whole category of "why don't these numbers match" problems caused by copies drifting apart.

### Delta time travel saves bad loads

Because the tables are Delta, you get ACID writes, schema evolution and time travel without extra work. For data quality, time travel matters more than people expect: when a bad load lands, you can query the previous version, compare, and restore instead of rebuilding from source. The same history covers schema mistakes: a dropped column or bad overwrite can be undone with `RESTORE` within your retention window, and warehouses have their own time travel and restore points. Treat that as recovery, not a licence to skip testing schema changes in dev.

### Direct Lake changed how reports feel

Our reports went from 5–10 second waits to near-instant once we moved the main models to [Direct Lake](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-overview). Users noticed, and the "why is this slow?" questions dropped off. The trade-off is that Direct Lake has per-SKU guardrails on table size and row counts, and models that read through the SQL analytics endpoint can fall back to DirectQuery when they hit them or meet a feature they can't serve. Design the gold-layer tables for Direct Lake deliberately rather than pointing it at whatever the pipelines happen to produce. I covered the design side in [Direct Lake best practices](/blog/2024-01-17-direct-lake-best-practices/).

### Git integration finally covers Power BI

Version control for Power BI was a long-standing gap. Fabric's Git integration (Azure DevOps or GitHub) now covers reports and semantic models, though both are still in preview, alongside notebooks and pipelines. Item coverage still varies (warehouses are in preview too), so check what's supported before you promise the team that "everything is in Git", but for BI-heavy teams this alone is a reason to start piloting it.

## What hurts

### Capacity units are hard to forecast

A Fabric capacity is a pool of capacity units (CUs) that every workload draws from: Spark, pipelines, warehouse queries, semantic model refreshes and report interactions. That's simpler to buy than five separate meters, but harder to forecast. We still can't predict usage accurately from a design document; we needed real workload data before the numbers made sense.

The method that works for me: Microsoft's Fabric SKU Estimator (preview) gives you a starting guess, then run a trial or pay-as-you-go capacity with representative workloads for two to four weeks. On the Compute page of the Capacity Metrics app, read the Utilization chart and its split between background and interactive operations, and check the Background rejection chart under Throttling. Size on the smoothed background baseline plus your interactive peaks, with headroom, rather than on the single worst spike.

### Throttling degrades in stages, and users feel it first

The common complaint is that Fabric "just stops working" when you exceed capacity. That's not quite how it works, and understanding the mechanism is what makes it manageable. Fabric smooths usage: interactive operations over a short window, background operations (refreshes, pipelines, most warehouse work) over 24 hours. When smoothed usage runs ahead of what you've paid for, the [throttling policy](https://learn.microsoft.com/en-us/fabric/enterprise/throttling) escalates in stages:

| Future capacity already consumed | What happens |
|---|---|
| Up to 10 minutes | Overage protection, no throttling |
| 10 to 60 minutes | Interactive requests delayed by 20 seconds |
| 60 minutes to 24 hours | Interactive requests rejected |
| More than 24 hours | All requests rejected, including background jobs |

So there's degradation, but it lands on the wrong people. A capacity is shared, so one badly written query or an oversized Spark job can push it into debt, and your report users are the first to feel it. Isolate resource-intensive or unpredictable workloads on their own capacity where you can. The mitigation that actually helps is [surge protection](https://learn.microsoft.com/en-us/fabric/enterprise/surge-protection), which went GA in mid-2025: it rejects new background jobs before they starve interactive users. It doesn't cancel running jobs, so it isn't a hard cap, but it's the first setting I'd configure on any shared capacity.

There are two thresholds, both expressed as a percentage of 24-hour background utilisation. The background rejection threshold is where the capacity starts refusing new background jobs; the background recovery threshold is where it accepts them again. My starting point is rejection around 80% and recovery around 50–60%, so the capacity has a real gap to burn down before jobs resume. Then tune both from Metrics app data: if refreshes are being rejected while interactive use is comfortable, raise the rejection threshold; if users still hit interactive delays, lower it. If the smoothing model is new to you, my earlier post on [smoothing and bursting](/blog/2024-08-25-smoothing-bursting-fabric/) walks through it.

### Monitoring takes real effort

The Capacity Metrics app is where you go to understand CU consumption, and it's not intuitive. It tells you what consumed capacity; it doesn't tell you a story. We built custom monitoring because the built-in view wasn't enough for daily operations. The monitoring hub and workspace monitoring (preview) help with item-level history, but expect to invest here regardless.

### Two smaller things that bite

**Refreshes still cost CUs.** Import-mode semantic model refreshes are background operations. They're smoothed over 24 hours, which hides a heavy refresh schedule until the background load builds up and the throttling stages above start to apply.

**Region placement matters.** If your capacity and your data sources sit in different regions, you'll feel the latency in pipelines and shortcuts, and you may pay for cross-region data movement. Put the capacity where the data is.

### Migration is a re-platform

Moving from Synapse plus Power BI to Fabric isn't a re-point. Budget more time than you think and plan a test pass for the areas that behave differently. Three I'd check first:

- **T-SQL surface area.** Fabric Warehouse doesn't support everything a Synapse dedicated SQL pool does. Review Microsoft's documented Warehouse T-SQL surface area against your stored procedures and DDL (materialized views and triggers, for example) before assuming they port unchanged.
- **Refresh behaviour in Direct Lake.** An Import model's incremental refresh policy doesn't carry over to Direct Lake. Direct Lake reframes against the current Delta tables, so the incremental logic moves into your pipelines and table design. Test how each model behaves straight after a pipeline load.
- **Workspace reassignment from P to F.** Moving workspaces onto the new capacity is mostly an admin task, but test it with workspaces that contain Fabric items, large semantic models and anything in a different region from the target capacity before you schedule the cut-over.

## The real cost numbers

Our F64 runs at roughly US$8,000 a month. For reference, the US list price for F64 on pay-as-you-go is about US$8,410 (US$0.18 per CU-hour; prices vary by region). What it replaced:

| Previous service | Monthly cost |
|---|---|
| Synapse dedicated SQL pool | ~$6,000 |
| Power BI Premium | ~$5,000 |
| Data Lake Storage Gen2 | ~$1,000 |
| **Total** | **~$12,000** |

Fabric is cheaper for us, but it's also doing more, so this isn't a clean apples-to-apples comparison. Two pricing details matter more than the headline number:

- **F64 is the free-viewer threshold.** On F64 and above, users with a free licence can view Power BI content shared through the capacity, as they could on P1. Below F64, every viewer needs a Pro or Premium Per User licence. Microsoft [announced in January 2024](https://powerbi.microsoft.com/en-us/blog/important-update-coming-to-power-bi-premium-licensing/) that it would stop selling Power BI Premium P SKUs. Non-EA customers move to F SKUs at renewal, and EA customers can renew only until their agreement ends. P1 maps to F64, so this is the comparison most Power BI shops will face. Microsoft's [licensing guidance](https://learn.microsoft.com/en-us/fabric/enterprise/licenses) lays out the options.
- **Reserved pricing is the real lever.** Pay-as-you-go is the wrong baseline for a production capacity that runs around the clock. Microsoft's Fabric pricing lists the one-year reservation at roughly 41% off pay-as-you-go, which takes an F64 from about US$8,410 to about US$5,000 a month at US list prices. Against the ~$12,000 legacy total, that's the comparison that matters: well under half the old bill, not two-thirds of it. The catch is that you pay the reservation whether the capacity is running or paused. Pay-as-you-go capacities can be paused, which suits dev and test, and rarely production. A common pattern is a reservation sized for the steady baseline plus pay-as-you-go for occasional scale-ups.

## What I'd do differently

1. **Start smaller and measure.** We chose F64 on recommendation. We probably could have started at F32 and scaled up. Do the licence maths first: on F32, our ~50 viewers would each need Pro unless they already have Power BI Pro through Microsoft 365 E5, and that can close part of the gap.
2. **Test the differences early.** Run the three migration checks above in the first sprint, not in front of users.
3. **Build observability from day one.** Decide which CU and job-failure signals you'll watch, and keep a record of which items and schedules drive CU usage, before go-live. The first throttling incident is a bad time to start.
4. **Set guardrails before people arrive.** Naming conventions, workspace structure and an approval process for new items. Without them, a shared capacity becomes a shared mess quickly.

## The verdict

Fabric is working for us, and we're staying on it. The integration is real, Direct Lake performance is good, and running one platform beats operating five separate services. But the capacity model is an operational discipline in its own right, and it rewards teams that monitor, isolate and protect interactive workloads deliberately.

**Good fit:**

- Heavy Power BI users, especially those facing a P SKU renewal
- Teams consolidating several Azure data services with copies of the same data
- Microsoft-centric organisations that value one security and billing model over best-of-breed components

**Think harder first:**

- Teams that need strict, predictable performance for real-time or customer-facing workloads on a shared capacity; plan for dedicated capacity or keep those workloads elsewhere
- Multi-cloud strategies where vendor flexibility is a hard requirement
- Teams that want fine-grained control over compute, which Fabric deliberately abstracts away
- Organisations without the people to run capacity monitoring and governance

If you're evaluating it, run a proof of concept on a non-critical workload, collect a few weeks of Capacity Metrics data, and only then size the capacity, buy the reservation and plan the migration.
