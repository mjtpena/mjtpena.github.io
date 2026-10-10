---
title: "From F64 to F32: Three Fabric Sizing Mistakes and the Fixes"
description: "Why we moved Microsoft Fabric from F64 to F32: the three sizing mistakes, the monitoring and alerts we added, and when going smaller is the wrong call."
author: Michael John Peña
draft: false
date: 2026-01-20
tags:
  - Microsoft Fabric
  - Capacity Planning
  - Cost Optimization
  - FinOps
---

We started our Microsoft Fabric platform on an F64 because it sounded like the "enterprise" choice. That was a guess, not a sizing decision, and we paid for it every month until we looked hard enough at the usage to step down to F32. Capacity is the single biggest line on most Fabric bills, so guessing wrong in either direction costs you: too big and you burn money, too small and your users meet throttling errors.

## Mistake 1: Starting too big

The trap is that Fabric makes over-provisioning feel responsible. A bigger capacity throttles less, and nobody gets blamed for a report that loaded quickly. But a capacity running well below its limit for most of the day is paying for headroom you never use.

My [Fabric reality check](/blog/2026-01-05-microsoft-fabric-reality-check/) argued for reserving the steady baseline. Moving to F32 shows why you measure before you reserve: reserve too early and you lock in the wrong size. Run a few months on pay-as-you-go at the new size, month-ends included, before you reserve it.

What I'd tell anyone sizing today:

- **Treat the first SKU as a hypothesis.** An F SKU can be resized from the Azure portal in minutes, so the cost of starting smaller is a few days of tighter capacity, not a re-platform.
- **Size from measured workloads, not team size or data volume.** Capacity units (CUs) are consumed by Spark jobs, pipelines, warehouse queries, semantic model refreshes and report interactions. A design document can't tell you how those combine; a few weeks of real usage can.
- **Know why F64 is special before you leave it.** Free viewers (below) can make F64 the cheaper answer even when the CU maths says otherwise.

## Mistake 2: Not monitoring

We hit capacity limits without warning, and users got errors. That's the worst way to find out you have a capacity problem.

It helps to understand what "hitting the limit" means in Fabric, because it isn't a simple ceiling. Fabric smooths consumption: interactive operations over a minimum of 5 minutes and up to 64 minutes, background operations (refreshes, pipelines, most warehouse work) over 24 hours. When smoothed usage runs ahead of what you've paid for, the [throttling policy](https://learn.microsoft.com/en-us/fabric/enterprise/throttling) escalates in stages, from delaying interactive requests to rejecting them, and eventually rejecting background jobs too. The consequence is that a heavy background load can quietly build up debt, and report users are the first to feel it. I covered the mechanics in [smoothing and bursting in Fabric](/blog/2024-08-25-smoothing-bursting-fabric/).

What we do now:

- **Monitor from day one.** The [Fabric Capacity Metrics app](https://learn.microsoft.com/en-us/fabric/enterprise/metrics-app) is the source of truth for CU consumption by item and operation. It has no per-team view and no alerting of its own, so we built custom dashboards on top.
- **Keep your own history.** The Metrics app's Compute page only shows the last 14 days. The app is backed by a semantic model you can query with semantic link (`sempy.fabric.evaluate_dax`), but Microsoft doesn't support using it outside the app's own reports, so its schema can change without notice. Treat a daily snapshot from a scheduled notebook into a lakehouse table as best-effort. For a supported feed, stream Real-Time hub capacity overview events (preview) into an eventhouse.
- **Alert at 70%.** Each capacity's Notifications setting in the admin portal emails capacity admins (or a custom list) when utilisation passes a threshold you set, and again when you exceed capacity. Treat it as an early warning, not a pager. We alert at 70% because that leaves time to act before throttling stages kick in; 90% is too late to do anything except apologise.

## Mistake 3: Ignoring the usage pattern

Some days we used 20% of capacity. Others hit 90%. We paid for the peak every day.

A Fabric capacity is a fixed block of CUs billed whether you use them or not. Unlike the old Power BI Premium Gen2 autoscale, F SKUs don't add cores on demand. Your levers for a spiky pattern are different:

| Lever | What it does | When it fits |
|---|---|---|
| Lower base SKU plus smoothing | Lets short peaks borrow against the 24-hour background window | Peaks are brief and background-heavy |
| Reschedule background work | Moves refreshes and pipelines away from business-hours interactive load | Peaks are self-inflicted by schedules |
| Separate capacities | Isolates noisy or critical workloads so one can't throttle the other | Mixed criticality on one capacity |
| Autoscale Billing for Spark | Runs Spark on serverless, pay-per-use compute outside the capacity (GA) | Spark is the main source of spikes |
| Pause pay-as-you-go capacities | Stops billing for capacities nobody uses overnight | Dev and test, rarely production |

Two caveats. Spark on Autoscale Billing loses the capacity's bursting and smoothing. And pausing a capacity bills any accumulated overage and smoothed usage immediately, so pausing to escape throttling isn't free.

Do the arithmetic before you trust the table. Halving the SKU doubles every utilisation figure, so a 90% day on F64 is about 180% of an F32. That only fits if the peak is short background work that 24-hour smoothing can spread out, or work you can move to quieter hours. If your 90% days are sustained interactive load, a lower SKU will just throttle more often.

My go/no-go test lives on the Compute page of the Capacity Metrics app, and it runs on the current SKU before you halve it. Those percentages double on the smaller SKU. Step down only if all four hold:

1. The data covers at least four weeks, including a month-end.
2. The Throttling tab's Background rejection chart (24-hour background %) stays well under 50%.
3. The Interactive delay and Interactive rejection charts also stay well under 50%.
4. The Overages tab shows carryforward burning down within hours rather than accumulating.

If any of those sit near 50%, fix the schedules first and measure again.

## Guardrails for a smaller capacity

[Surge protection](https://learn.microsoft.com/en-us/fabric/enterprise/surge-protection) for background operations has been GA since June 2025, and it's the setting I'd configure first on a smaller capacity. You set a rejection threshold and a lower recovery threshold on 24-hour background utilisation: above the first, the capacity rejects new background jobs before they starve interactive users, and it only accepts them again once usage falls below the second. The gap between the two is the main tuning decision; my starting values are in the [reality check](/blog/2026-01-05-microsoft-fabric-reality-check/). It doesn't cancel running jobs, so it isn't a hard cap.

The catch is the workload mix. On a background-heavy capacity, a low rejection threshold will reject your own pipelines and refreshes long before interactive users are at risk, so set it from the Background rejection chart or reschedule heavy jobs first.

## What we run now

- **F32 for most workloads.** If I were making the call again, I'd apply the go/no-go test above before moving, not after.
- **Workloads separated by criticality**, so an experimental notebook can't push the capacity serving production reports into throttling.
- **A monthly review** of the top consumers by item, the background and interactive throttling charts, and any schedule changes, adjusting the SKU or the workload when the numbers say so.

## The numbers

| | Capacity | Monthly run rate (approx.) |
|---|---|---|
| Before | F64 | ~US$8,000 |
| Now | F32 | ~US$4,000 |

That's roughly **US$4,000 a month saved** on the capacity line, before Pro licences; the [reality check](/blog/2026-01-05-microsoft-fabric-reality-check/) works through what Pro licences for ~50 viewers would add. I don't have clean before-and-after utilisation figures to put beside it, so I won't pretend to.

Before you copy this, check two things the capacity line doesn't show.

**The free-viewer threshold.** On F64 and above, users with a free licence can view Power BI content in workspaces on that capacity. Below F64, every report viewer needs a [Power BI Pro or Premium Per User licence](https://learn.microsoft.com/en-us/fabric/enterprise/licenses). If your viewers aren't already licensed (Microsoft 365 E5 includes Pro, for instance), the licence cost can eat most or all of the saving. This is the most common reason F64 is the right answer for a BI-heavy organisation even when the CU maths says F32.

**Reservations.** A one-year [Fabric capacity reservation](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/fabric-capacity) costs about 40% less than pay-as-you-go. At US list prices that takes an F64 from about US$8,410 to about US$5,000 a month, and an F32 from about US$4,205 to about US$2,500; your region and agreement will differ. But you pay for it whether the capacity is busy or paused. Reserve the base you've proven you need, after a few months of data, and keep anything experimental on pay-as-you-go.

## Scripting the resize

To script the resize rather than click through the portal, an F SKU is an ordinary Azure resource of type `Microsoft.Fabric/capacities`, so the generic Azure CLI resource commands work:

```bash
# Resize a Fabric capacity (for example, F64 to F32)
# Needs Microsoft.Fabric/capacities/read and /write on the capacity (Contributor works; a custom least-privilege role is better for automation)
az resource update \
  --resource-group <your-resource-group> \
  --name <your-capacity-name> \
  --resource-type "Microsoft.Fabric/capacities" \
  --set sku.name=F32
```

Resize outside business hours and check the Metrics app afterwards. For a purpose-built command, the `microsoft-fabric` Azure CLI extension (preview) offers `az fabric capacity update`. Either way, a reservation doesn't follow the resize: scaling below your reserved size doesn't reduce the bill, and scaling above it bills the difference at pay-as-you-go rates.

## When going smaller is the wrong call

- **You rely on free viewers.** Do the licence maths first; F64 may be cheaper overall.
- **Your peaks are sustained interactive load.** Smoothing helps background bursts, not a full morning of heavy report use.
- **You can't staff the monitoring.** A tightly sized capacity needs someone watching alerts and acting on them. Without that, the extra headroom is cheaper than the outages.
- **One capacity carries everything.** Separate critical workloads first; then size each capacity on its own pattern.

## The takeaway

Don't guess at capacity. Start smaller than feels comfortable, measure with the Capacity Metrics app, alert well before throttling, and only step down a tier when the throttling and background-rejection charts stay well under 50% on the current SKU. Scaling back up takes minutes, so don't pay for peak every day.
