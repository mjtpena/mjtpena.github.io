---
title: "Fabric Throttling Explained: Reading Carryforward Before Users Do"
description: "How Fabric smoothing, carryforward and the four throttling stages work, how to read them in the Capacity Metrics app, and which levers actually help."
author: Michael John Peña
draft: false
date: 2024-01-14
tags:
  - Microsoft Fabric
  - Capacity Planning
  - Cost Optimization
  - Performance
  - Power BI
---

Most Fabric capacity conversations start with "which F SKU should we buy?" and stop there. The more useful question is what happens when a capacity is overloaded. Fabric doesn't slow down the moment you hit 100% of your capacity units (CUs). It borrows from the future, and then it delays or rejects work in stages. If you don't understand that borrowing, you'll misread the Capacity Metrics app, scale at the wrong moment, and blame the wrong workload.

I covered SKU sizing in [Fabric Capacity Management: Right-Sizing Your Platform](/blog/2023-12-24-fabric-capacity-management/) and spend reduction in [Cost Optimization in Microsoft Fabric](/blog/2023-12-25-fabric-cost-optimization/). This post is narrower: how throttling actually works now that Fabric is generally available, how to read it, and what to do about it.

## Smoothing: why 300% utilisation isn't an emergency

Every Fabric operation (a report query, a semantic model refresh, a Spark job, a Warehouse query) consumes CU seconds. Fabric doesn't charge that consumption to the moment it happened. It *smooths* it forward in time, and the window depends on whether the operation is interactive or background, as described in the [Fabric throttling policy](https://learn.microsoft.com/fabric/enterprise/throttling):

| Operation type | Typical examples | Smoothing window |
|---|---|---|
| Interactive | Report visuals, DAX queries from users | A minimum of 5 minutes, longer for short, CU-heavy requests |
| Background | Semantic model refreshes, pipelines, Spark jobs, almost all Warehouse operations | 24 hours |

The consequence is that a large refresh can burst well above the capacity's size for a few minutes without anyone noticing, because its cost is spread across the next day. This is deliberate. Microsoft's guidance is that with 24-hour smoothing you mostly don't need to hand-stagger background jobs to avoid spikes.

I'd qualify that. Smoothing removes the *spike* problem, not the *volume* problem. If your background jobs consume more CU seconds per day than the capacity provides, smoothing just guarantees you'll feel it tomorrow instead of today.

## Carryforward and the four throttling stages

When smoothed usage in the current window exceeds what the capacity provides, the excess becomes *carryforward*: capacity you've borrowed from future time. Fabric measures throttling in terms of how many minutes of future capacity you've already spent.

| Future capacity consumed | Stage | What users experience |
|---|---|---|
| Up to 10 minutes | Overage protection | Nothing. Jobs keep running normally. |
| 10 to 60 minutes | Interactive delay | New interactive requests are delayed 20 seconds at submission. |
| 60 minutes to 24 hours | Interactive rejection | New interactive requests are rejected. Background jobs still run. |
| More than 24 hours | Background rejection | All new requests are rejected until the debt is paid down. |

Three details matter in practice:

- **In-flight work is never killed.** Throttling only applies to operations submitted after the capacity entered a throttled state. A long refresh that started before throttling runs to completion.
- **Throttling is per capacity.** If a lakehouse lives on capacity A and a report on capacity B reads it, B's throttling state decides whether the call is throttled.
- **Some workloads behave differently.** Real-Time Analytics skips the 20-second delay stage and only throttles at the rejection stage, because delayed real-time queries defeat the purpose. Eventstreams that are already running get a reduced CU allocation rather than being stopped.

Microsoft states that it may change this policy, so treat the thresholds as current behaviour rather than a contract.

### Doing the arithmetic

Carryforward is easier to reason about once you convert it into minutes of future capacity and time to burn down. When the capacity has idle headroom, that idle capacity pays the debt down. This helper does the conversion so you can sanity-check what the metrics app shows:

```python
from dataclasses import dataclass

STAGES = [
    (10, "Overage protection: no user impact"),
    (60, "Interactive delay: new interactive requests wait 20 seconds"),
    (24 * 60, "Interactive rejection: new interactive requests rejected"),
    (float("inf"), "Background rejection: all new requests rejected"),
]


@dataclass
class CarryforwardState:
    capacity_units: int          # F64 = 64
    carryforward_cu_seconds: float
    current_utilisation: float   # 0.6 means 60% of the capacity is in use right now

    @property
    def future_minutes_consumed(self) -> float:
        return self.carryforward_cu_seconds / (self.capacity_units * 60)

    @property
    def stage(self) -> str:
        for limit, label in STAGES:
            if self.future_minutes_consumed <= limit:
                return label
        return STAGES[-1][1]

    def minutes_to_clear(self) -> float:
        idle_cu_per_second = self.capacity_units * (1 - self.current_utilisation)
        if idle_cu_per_second <= 0:
            return float("inf")
        return self.carryforward_cu_seconds / idle_cu_per_second / 60


if __name__ == "__main__":
    # An F64 that has borrowed 230,400 CU seconds (one hour of capacity)
    # and is still 75% busy. Exactly 60 minutes is the last minute of the
    # interactive delay stage; one more CU second tips it into rejection.
    state = CarryforwardState(capacity_units=64,
                              carryforward_cu_seconds=230_400,
                              current_utilisation=0.75)
    print(f"Future minutes consumed: {state.future_minutes_consumed:.0f}")
    print(f"Stage: {state.stage}")
    print(f"Minutes to clear at current load: {state.minutes_to_clear():.0f}")
    for sku in (64, 128):
        scaled = CarryforwardState(sku, 230_400, 0.75 * 64 / sku)
        print(f"F{sku}: {scaled.minutes_to_clear():.0f} minutes to clear")
```

The last loop shows the one lever that works on existing debt. On the F64, an hour of carryforward at 75% load takes four hours to clear because only 16 CUs are idle. Scale the same workload to an F128 and roughly 80 CUs are idle, so it clears in under an hour. Scaling up also helps immediately, before any debt is repaid: the same 230,400 CU seconds is 60 minutes of future capacity on an F64 but only 30 minutes on an F128, so a capacity sitting in interactive rejection can drop straight back into the delay stage the moment the larger SKU applies. The throttling documentation calls this out directly: temporarily increasing the SKU generates idle capacity that is applied to carryforward.

## Reading the Capacity Metrics app

The [Microsoft Fabric Capacity Metrics app](https://learn.microsoft.com/fabric/enterprise/metrics-app-compute-page) is the only first-party view of all of this, and the compute page has three tabs on its utilisation visual that people tend to skip:

- **Utilization** shows interactive and background CU % per 30-second timepoint against the CU % limit line. Columns above the line are not throttling by themselves. They are the input to carryforward.
- **Throttling** shows how close you are to each stage. The interactive delay tab is driven by 10-minute interactive smoothing, interactive rejection by 60-minute smoothing, and background rejection by 24-hour smoothing. Above 100% on a tab means that stage is active.
- **Overages** shows carryforward added, burned down, and the cumulative total. This is the tab I'd look at first after a complaint, because it tells you whether you have a short spike or a debt that has been accumulating for hours.

From any timepoint you can drill through to the timepoint page and see which operations, items and users consumed the CUs. Rejected operations show up there with the product, user, operation ID and submission time, but little else, because they never ran.

Two limitations to plan around. The app keeps roughly two weeks of history, so if you want month-on-month trends you need to export or snapshot it yourself. And it's a Power BI report, not an alerting system: for proactive warning, configure the capacity notifications in the admin portal so admins are emailed when the capacity reaches its CU limit.

## The levers, in the order I'd use them

### 1. Find the operation, not the workload

The mistake I see most often is treating "Spark" or "Power BI" as the culprit. The timepoint drill-through usually points to a small number of items: one semantic model refreshing every 30 minutes, one notebook doing a full reload, one report page with a dozen heavy visuals. Fix those before touching the SKU. My rule of thumb is that if the top five items don't account for most of the background CU, you have a sizing problem rather than an optimisation problem.

### 2. Watch interactive Spark sessions

Spark has its own concurrency model on top of CU smoothing. Each CU gives you two Spark VCores, and [Fabric Spark allows bursting to three times that](https://learn.microsoft.com/fabric/data-engineering/spark-job-concurrency-and-queueing) for concurrency, but not for a single job's size. Once all cores are in use, interactive notebook runs and lakehouse operations such as Load to Table fail with HTTP 430, while batch (non-interactive) jobs are placed in a first-in, first-out queue and retried for up to 24 hours before they expire.

Billing applies while a session is active, not while the pool is idle. An interactive notebook left open holds its session until it expires, and the default session expiry is 20 minutes. On a small capacity shared by several developers, abandoned sessions can be the difference between queueing and not. Shortening the session timeout from the notebook's session status (or stopping the session when you're done) is a cheap fix.

### 3. Separate capacities by blast radius

Because throttling is per capacity, the cleanest way to protect executive reports from a runaway notebook is to put them on different capacities. A common split is one capacity for production reporting, one for engineering and data science, and a small one for development. The trade-off is fragmentation: three capacities each sized for their own peak cost more than one shared capacity whose peaks don't coincide. I'd only split when you have evidence of one workload hurting another, or when the reporting audience can't tolerate a 20-second delay.

### 4. Scale or pause deliberately

F SKUs can be scaled and paused at any time in the Azure portal, and both operations are available through Azure Resource Manager, which makes them scriptable. The script below pins the generally available `2023-11-01` API version; note that `az resource update` reads the whole resource and writes it back (a GET then a PUT), which that API version supports. There's no autoscale for F SKUs; the "Autoscale CU % limit" line in the metrics app relates to Power BI Premium capacities. Scaling is something you do on purpose:

```bash
#!/usr/bin/env bash
# Temporarily scale a Fabric capacity to pay down carryforward, or pause it overnight.
# Requires Azure CLI, logged in with rights to manage the capacity.
set -euo pipefail

# Pin the GA Microsoft.Fabric/capacities API version rather than relying on lookup.
API_VERSION="2023-11-01"
CAPACITY_ID="/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Fabric/capacities/<capacity-name>"

case "${1:-}" in
  scale)
    az resource update --ids "$CAPACITY_ID" --api-version "$API_VERSION" --set sku.name="${2:?usage: $0 scale F128}"
    ;;
  pause)
    az resource invoke-action --ids "$CAPACITY_ID" --action suspend --api-version "$API_VERSION"
    ;;
  resume)
    az resource invoke-action --ids "$CAPACITY_ID" --action resume --api-version "$API_VERSION"
    ;;
  *)
    echo "usage: $0 scale <SKU> | pause | resume" >&2
    exit 1
    ;;
esac
```

Two caveats. First, [pausing a capacity](https://learn.microsoft.com/fabric/enterprise/pause-resume) makes its content unavailable, and any outstanding smoothed usage is settled onto your Azure bill at that point, so pausing to escape carryforward doesn't make the cost disappear. Second, scaling up a capacity smaller than F64 can take up to three hours to fully apply for free-licence users viewing Power BI content, so don't rely on a quick scale-up from F32 to rescue a report audience.

On price: F SKUs are billed per second with a one-minute minimum, at regional pay-as-you-go rates. At list pay-as-you-go rates in US regions in early 2024 that was about US$0.36 per hour for an F2 and US$11.52 per hour for an F64; check your region, because rates differ. [Fabric capacity reservations](https://learn.microsoft.com/azure/cost-management-billing/reservations/fabric-capacity), generally available since November 2023, cut the rate by up to about 40% for a one-year commitment. A reservation applies to capacity units, though, so it pays for the baseline you run all day. Pausing a reserved capacity saves nothing.

## When not to optimise

Not every red column needs action. If the Overages tab shows carryforward that clears within the hour and the Throttling tab never crosses 100%, the capacity is doing exactly what smoothing was designed for, and spending engineering time on it is waste. Equally, if you're on a trial capacity, the numbers tell you about workload shape but not about the paid SKU you'll eventually need.

My decision rule for an F SKU is simple. Look at the Throttling tab over the last two weeks. If interactive delay never activates, leave it alone. If it activates during predictable peaks, fix the top background items and reschedule what you can. If background rejection ever activates, you are under-provisioned, and the answer is a larger SKU or a second capacity, not more tuning. For the item-level tuning itself, see [Microsoft Fabric Performance Tuning: From Notebooks to Reports](/blog/2024-01-15-fabric-performance-tuning/).
