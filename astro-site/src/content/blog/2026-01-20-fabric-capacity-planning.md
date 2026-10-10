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

Two weeks ago, my [Fabric reality check](/blog/2026-01-05-microsoft-fabric-reality-check/) had us still on that F64 and called a reservation on the F64 baseline the obvious next step. The 20%-to-90% swings changed that plan: we'd have reserved the wrong size. That's why we're staying on pay-as-you-go at F32 until the go/no-go test below has a few months of data behind it.

What I'd tell anyone sizing today:

- **Treat the first SKU as a hypothesis.** An F SKU on pay-as-you-go can be resized from the Azure portal in minutes, so the cost of starting smaller is a few days of tighter capacity, not a re-platform.
- **Size from measured workloads, not team size or data volume.** Capacity units (CUs) are consumed by Spark jobs, pipelines, warehouse queries, semantic model refreshes and report interactions. A design document can't tell you how those combine; a few weeks of real usage can.
- **Know why F64 is special before you leave it.** More on that below, because it's the one reason F64 can be the right answer even when the CU maths says otherwise.

## Mistake 2: Not monitoring

We hit capacity limits without warning, and users got errors. That's the worst way to find out you have a capacity problem.

It helps to understand what "hitting the limit" means in Fabric, because it isn't a simple ceiling. Fabric smooths consumption: interactive operations over a minimum of 5 minutes and up to 64 minutes, background operations (refreshes, pipelines, most warehouse work) over 24 hours. When smoothed usage runs ahead of what you've paid for, the [throttling policy](https://learn.microsoft.com/en-us/fabric/enterprise/throttling) escalates in stages, from delaying interactive requests to rejecting them, and eventually rejecting background jobs too. The consequence is that a heavy background load can quietly build up debt, and report users are the first to feel it. If smoothing is new to you, I walked through it in [smoothing and bursting in Fabric](/blog/2024-08-25-smoothing-bursting-fabric/).

What we do now:

- **Monitor from day one.** The [Fabric Capacity Metrics app](https://learn.microsoft.com/en-us/fabric/enterprise/metrics-app) is the source of truth for CU consumption by item and operation. What it lacks for daily operations is a simple at-a-glance view per team and any alerting of its own, so we built custom dashboards on top for day-to-day visibility.
- **Keep your own history.** The Metrics app's Compute page only shows the last 14 days. The app is backed by a semantic model you can query with semantic link (`sempy.fabric.evaluate_dax`), but Microsoft doesn't support using it outside the app's own reports, so its schema can change without notice. Treat a daily snapshot from a scheduled notebook into a lakehouse table as best-effort. For a supported feed, stream Real-Time hub [capacity overview events](https://learn.microsoft.com/en-us/fabric/real-time-hub/explore-fabric-capacity-overview-events) (preview) into an eventhouse.
- **Alert at 70%.** Each capacity's Notifications setting in the admin portal emails capacity admins (or a custom list) when utilisation passes a threshold you set, and again when you exceed capacity. Treat it as an early warning, not a pager. We alert at 70% because that leaves time to act before throttling stages kick in; 90% is too late to do anything except apologise.

### Surge protection

[Surge protection](https://learn.microsoft.com/en-us/fabric/enterprise/surge-protection) for background operations has been GA since June 2025, and on a smaller capacity it's the setting I'd configure first. You set a rejection threshold and a lower recovery threshold on 24-hour background utilisation: above the first, the capacity rejects new background jobs before they starve interactive users, and it only accepts them again once usage falls below the second. The gap between the two is the main tuning decision; my starting values are in the [reality check](/blog/2026-01-05-microsoft-fabric-reality-check/). It doesn't cancel running jobs, so it isn't a hard cap.

The catch is the workload mix. On a background-heavy capacity, a low rejection threshold will reject your own pipelines and refreshes long before interactive users are at risk, so set it from the Background rejection chart or reschedule heavy jobs first.

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

Two caveats worth knowing. Autoscale Billing for Spark means Spark jobs no longer get bursting and smoothing from the capacity, and enabling, disabling or lowering its maximum CU setting cancels active Spark jobs, so plan the switch. And when you pause a capacity, any accumulated overage and smoothed usage is billed immediately, so pausing to escape throttling isn't free.

Do the arithmetic before you trust the table. Halving the SKU doubles every utilisation figure, so a 90% day on F64 is about 180% of an F32. That only fits if the peak is short background work that 24-hour smoothing can spread out, or work you can move to quieter hours. If your 90% days are sustained interactive load, a lower SKU will just throttle more often.

My go/no-go test lives on the Compute page of the Capacity Metrics app. Over at least four weeks that include a month-end, the Throttling tab's Background rejection chart (24-hour background %) should stay well under 50% of the current SKU, and so should the Interactive delay and Interactive rejection charts (those percentages double on the smaller SKU), and the Overages tab should show carryforward burning down within hours rather than accumulating. If any of those sit near 50%, fix the schedules first and measure again.

## What we run now

- **F32 for most workloads.** If I were making the call again, I'd apply the go/no-go test above before moving, not after.
- **Workloads separated by criticality**, so an experimental notebook can't push the capacity serving production reports into throttling.
- **A monthly review** of the top consumers by item, the background and interactive throttling charts, and any schedule changes, adjusting the SKU or the workload when the numbers say so.

If you want to script resizing rather than click through the portal, an F SKU is an ordinary Azure resource of type `Microsoft.Fabric/capacities`, so the generic Azure CLI resource commands work:

```bash
# Resize a Fabric capacity (for example, F64 to F32)
# Needs Microsoft.Fabric/capacities/read and /write on the capacity (Contributor works; a custom least-privilege role is better for automation)
az resource update \
  --resource-group <your-resource-group> \
  --name <your-capacity-name> \
  --resource-type "Microsoft.Fabric/capacities" \
  --set sku.name=F32
```

Resize outside business hours and check the Capacity Metrics app afterwards; a smaller SKU means the same workload consumes a larger share of the smoothing window. If you'd rather use a purpose-built command, the `microsoft-fabric` Azure CLI extension (preview) offers `az fabric capacity update`. Either way, a reservation doesn't follow the resize: scaling below your reserved size doesn't reduce the bill, and scaling above it bills the difference at pay-as-you-go rates.

## The numbers

| | Capacity | Our monthly bill (approx.) |
|---|---|---|
| Before | F64 | ~US$8,000 |
| Now | F32 | ~US$4,000 |

That's roughly **US$4,000 a month saved** on the capacity line, before Pro licences; the [reality check](/blog/2026-01-05-microsoft-fabric-reality-check/) works through what Pro licences for ~50 viewers would add. I don't have clean before-and-after utilisation figures to put beside it, so I won't pretend to. For comparison, US list pay-as-you-go pricing works out to about US$8,410 a month for F64 and about US$4,205 for F32 at 730 hours, but what you actually pay differs by region, currency and agreement, so check the [Fabric pricing page](https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/) for yours.

Before you copy this, check two things the capacity line doesn't show.

**The free-viewer threshold.** On F64 and above, users with a free licence can view Power BI content in workspaces on that capacity. Below F64, every report viewer needs a Power BI Pro or Premium Per User licence, as Microsoft's [Fabric licensing page](https://learn.microsoft.com/en-us/fabric/enterprise/licenses) spells out. If your viewers aren't already licensed (Microsoft 365 E5 includes Pro, for instance), the licence cost can eat most or all of the saving. This is the most common reason F64 is the right answer for a BI-heavy organisation even when the CU maths says F32.

**Reservations.** A one-year [Fabric capacity reservation](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/fabric-capacity) costs about 40% less than pay-as-you-go for the same SKU, but you pay for it whether the capacity is busy or paused. Reserve the base you've proven you need, after a few months of data, and keep anything experimental on pay-as-you-go.

## When going smaller is the wrong call

- **You rely on free viewers.** Do the licence maths first; F64 may be cheaper overall.
- **Your peaks are sustained interactive load.** Smoothing helps background bursts, not a full morning of heavy report use.
- **You can't staff the monitoring.** A tightly sized capacity needs someone watching alerts and acting on them. Without that, the extra headroom is cheaper than the outages.
- **One capacity carries everything.** Separate critical workloads first; then size each capacity on its own pattern.

## The takeaway

Don't guess at capacity. Start smaller than feels comfortable, measure with the Capacity Metrics app, alert well before throttling, and only step down a tier when your peaks still fit under half of the current SKU. Fabric makes it easy to scale up when the data says you need to, so take advantage of that instead of paying for peak every day. Just do the licence maths before you step below F64.
