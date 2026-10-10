---
title: "Pricing a Threshold: Tying Fabric Activator Rules to Business Impact"
description: "Set Fabric Activator and KQL alert thresholds from the cost of a miss versus the cost of acting, then tier actions by the value at risk, not the raw reading."
author: Michael John Peña
draft: false
date: 2026-04-20
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - Data Activator
  - KQL
  - Alerts
---

Most alert thresholds in Fabric Real-Time Intelligence are written in sensor units: 8°C, 500 ms, 20 errors. The business cares about spoiled stock, missed SLAs and refunds, and a threshold that ignores what's at stake will be too twitchy for cheap cargo and too relaxed for expensive cargo at the same time.

I've written before about [designing Fabric Activator (formerly Data Activator) rules people don't mute](/blog/2026-03-18-real-time-signals-that-actually-help-building-alerting-that-avoids-fatigue/): transitions, persistence, one row per incident. This post is about the step before that: deciding *where* the line goes and *what happens* when it's crossed, using money rather than instinct.

## A threshold is a bet

Every alert threshold is a trade between two costs:

- **Cost of acting** (C_act): what it costs each time the rule fires and someone responds. A driver diverts, an engineer gets paged, a pipeline reprocesses a day of data.
- **Cost of missing** (C_miss): what it costs when a real problem goes unhandled. Spoiled stock, a breached contract, a customer who leaves.

If p is the probability that a signal at this level turns into a real problem, acting is worth it when p × C_miss > C_act. Everything else in this post is about estimating those three numbers well enough to argue about them.

The ratio matters more than the precision. With made-up numbers: if a dispatch costs A$150 and a lost container costs A$12,000, you should act whenever there's better than roughly a 1.25% chance the breach is real. That's a sensitive rule, and it's correct. Flip the numbers (an expensive response, a cheap loss) and the right rule barely fires at all. Teams that set one global temperature threshold are implicitly assuming every container carries the same cargo.

## Calibrate against labelled history

The fatigue post replays a threshold to count how often it would fire. To tie it to impact you also need outcomes: a table of the incidents that actually cost money. In most organisations that lives in a ticketing or claims system, and getting it into an Eventhouse table is the hardest part.

Once you have it, sweep candidate thresholds and price each one:

```kusto
// Price candidate thresholds per cargo class against 90 days of history.
// Unit of evaluation: one container-day.
// ContainerTelemetry, SpoilageIncidents, ContainerAssignments and the
// cost figures are placeholders.
let costAct = 150.0;      // cost of one response (for example, a dispatch)
let costMiss = 12000.0;   // average loss when a real incident goes unhandled
let daily =
    ContainerTelemetry
    | where Timestamp > ago(90d)
    | summarize AvgTemp = avg(TemperatureC) by ContainerId, Window = bin(Timestamp, 5m)
    | summarize PeakAvgTemp = max(AvgTemp) by ContainerId, Day = startofday(Window);
let incidents =
    SpoilageIncidents
    | where IncidentTime > ago(90d)
    | summarize by ContainerId, Day = startofday(IncidentTime)
    | extend HadIncident = true;
daily
| lookup kind=inner (
    ContainerAssignments
    | distinct ContainerId, CargoClass
  ) on ContainerId
| join kind=leftouter incidents on ContainerId, Day
| extend Spoiled = isnotnull(HadIncident)
| project ContainerId, CargoClass, Day, PeakAvgTemp, Spoiled
| extend Threshold = range(5.0, 12.0, 0.5)
| mv-expand Threshold to typeof(real)
| extend Fired = PeakAvgTemp > Threshold
| summarize
    Alerts = countif(Fired),
    Caught = countif(Fired and Spoiled),
    Missed = countif(not(Fired) and Spoiled)
    by CargoClass, Threshold
| extend ExpectedCost = Alerts * costAct + Missed * costMiss
| summarize arg_min(ExpectedCost, *) by CargoClass
```

The result is one row per cargo class: the cheapest threshold for that class at that cost ratio. That number goes into `MaxTempC` for every shipment of that class in the alert below, so the line you calibrate is the line you deploy. Keep the sweep and the alert on the same window: the sweep bins at five minutes because the alert averages five minutes, and a 30-minute sweep would be smoother than the live rule and under-predict its alerts. The match isn't perfect, though: the sweep bins on the device's event time, while the live rule averages whatever was ingested in the last five minutes. If devices buffer readings and send them in batches, the replay will look smoother than production. Check ingestion lag (`ingestion_time() - Timestamp`) first to see whether that matters for your fleet.

A few shortcuts keep the sketch short:

- **Cargo class is fixed per container.** The `distinct` assumes it. If containers switch class, join on the assignment's start and end times instead.
- **One `costMiss` for every class.** If a miss costs very different amounts per class, give each class its own figure.
- **Every class has incidents.** For a class with none, `Missed` is zero at every threshold, so `arg_min` picks the loosest line and the class isn't calibrated. Require a minimum incident count, and treat the rest as rare events (see below).

Beyond those, three assumptions are baked into the model, and you should say them out loud when you present the result:

1. **A caught incident costs nothing beyond the response.** In reality some stock is lost even when someone acts. If you know the save rate, add `(Caught * costMiss * (1 - saveRate))` to the expected cost.
2. **A container-day is the right unit.** It's coarse: it hides whether the alert came early enough to help, and a container-day counts as one response even if the live rule would fire several times that day, so the sweep understates C_act for containers that breach repeatedly. If response time matters, label at the window level and require the alert to precede the incident by a minimum lead time.
3. **Incidents without telemetry drop out.** A container that went dark and then spoiled won't appear in `daily`. Silence needs a heartbeat rule of its own; no temperature threshold will catch it.

The answer matters less to me than the argument it settles: instead of "8°C feels right" against "it's too noisy", both sides see the noise and the misses priced.

## Alert on value at risk

A single cost ratio still assumes uniform cargo. Better to compute the impact in the query and alert on that. Activator rules attached directly to an eventstream evaluate each event on its own and can't look up reference data held in another table, such as cargo value per shipment. When the line depends on what's in the container, I use a [KQL queryset alert](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-alert-queryset) instead, which runs on a schedule (every five minutes by default) and sends one alert per returned row.

```kusto
// Scheduled KQL queryset alert: shipments breaching their own limit,
// paged only when the combined value at risk crosses the policy floor.
// ContainerAssignments and AlertPolicy are business-owned reference tables;
// their names and columns (including AssignedFrom and AssignedUntil) are placeholders.
// lookback matches the alert's run frequency (5 minutes).
let lookback = 5m;
let pageFloorAud = coalesce(toreal(toscalar(
    AlertPolicy
    | where Tier == "page"
    | summarize max(MinValueAud))), 0.0);
ContainerTelemetry
| where ingestion_time() >= bin(now(), lookback) - lookback
    and ingestion_time() < bin(now(), lookback)
| summarize AvgTemp = avg(TemperatureC) by ContainerId
| lookup kind=inner (
    ContainerAssignments
    // Only the current assignment; past or pre-booked ones would
    // double-count value and apply another cargo's limit.
    | where AssignedFrom <= now()
        and (isnull(AssignedUntil) or AssignedUntil > now())
    | project ContainerId, ShipmentId, CargoValueAud, MaxTempC
  ) on ContainerId
| where AvgTemp > MaxTempC
| summarize
    Breaches = count(),
    Shipments = make_list(ShipmentId),
    ValueAtRiskAud = sum(CargoValueAud)
| where Breaches > 0 and ValueAtRiskAud >= pageFloorAud
```

Three design choices are in there. The per-shipment limit (`MaxTempC`) comes from the assignment, filled from the sweep, so a pharmaceutical load and a produce load are judged by their own spec. The decision to wake someone comes from `AlertPolicy`, a small table the business owns, so changing the paging floor is an audited row update rather than a rule edit by whoever has workspace access.

If the `page` row goes missing, `coalesce` drops the floor to zero, so the alert pages on any breach instead of going quiet. The `Breaches > 0` filter keeps that fallback honest: a `summarize` with no `by` clause returns one row even when nothing matched, and without the filter a zero floor would page on every run; I'd rather be over-paged for an hour than discover the gap after a spoiled load.

The third choice is the time filter. The query filters on `ingestion_time()` over a window equal to the schedule. Filtering on the device `Timestamp` instead would miss readings that arrive late (event time isn't ingestion time). I use an aligned window rather than `ago(lookback)` because scheduled runs don't start exactly on the boundary, so a sliding window can double-count or skip readings at the edges. The aligned version costs up to one interval of extra delay and isn't strictly exactly-once if a run slips, but it's much closer. This relies on the table's ingestion time policy, which is on by default for new tables.

The trade-off is latency and cost: a scheduled query isn't per-event, and running every few minutes keeps the Eventhouse from going idle. The final `summarize` yields at most one page per run. It still repeats every run while the breach lasts; the fatigue post covers suppression.

## Tier the action by impact

Once the rule speaks in Australian dollars at risk, the action can scale with them. Activator can email, post to Teams, start a Power Automate flow, or run a Fabric item (a pipeline, notebook, Spark job definition, Dataflow (preview) or User Data Function (preview)), passing values from the alert as parameters with `@` references (parameter passing is also in preview). See [Trigger Fabric items](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-trigger-fabric-items). I map tiers like this:

| Value at risk (AUD) | Action | Why |
|---|---|---|
| Below the notify floor | Nothing real-time; daily digest or Real-Time Dashboard tile | A human response costs more than the expected loss |
| Notify floor to page floor | Teams message to the owning team | Worth a look within the hour; nobody needs waking |
| Above the page floor | Teams or email to the named on-call owner, plus a Power Automate flow that raises a ticket | The expected loss justifies an interruption and a record |
| Any tier, where the response is cheap and reversible | Run a Fabric item, such as a pipeline that re-routes or re-processes | Automation is the cheapest C_act you'll ever get |

Each tier is its own queryset alert with one action, all sharing the query body above:

1. **Page alert** (Teams or email to on-call). This is the query as shown: floor from the `Tier == "page"` row, filter `Breaches > 0 and ValueAtRiskAud >= pageFloorAud`.
2. **Notify alert** (Teams to the owning team). It also reads `notifyFloorAud` from the `Tier == "notify"` row with the same `toreal`/`coalesce` fallback, so a missing notify row widens the band rather than silencing it. Filter: `Breaches > 0 and ValueAtRiskAud >= notifyFloorAud and ValueAtRiskAud < pageFloorAud`. A breach lands in exactly one tier, and an empty run never fires.
3. **Ticket alert** (Power Automate flow). Same floor and filter as the page alert, as a separate alert so the Teams message and the ticket fail independently.

If the page row is missing, its floor is zero and the notify band is empty by design: everything pages.

That last row is where the cost model pays off most. If the response is automated, idempotent and easy to undo, C_act falls close to zero and the right threshold drops with it. If the action is expensive or irreversible (cancelling an order, shutting down a line), keep a human in the loop and set the threshold higher. For eventstream rules that don't need reference data, I'd point two or three rules at the same property with different values, one per tier, using the condition types described in [detection conditions](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-detection-conditions).

## Keep the numbers honest

Cost figures go stale: freight rates change, cargo mixes shift, responses get automated. My rule of thumb is to treat C_act, C_miss and the policy floors like any other business-owned reference data:

- **Name an owner** for each figure, usually someone in finance or operations. The data team maintains the tables but shouldn't set the numbers.
- **Re-run the sweep quarterly**, or whenever the incident rate moves noticeably. If the cheapest threshold has drifted, take it to the figure's owner before changing `MaxTempC`.
- **Track outcomes per tier.** Count alerts, acted-on alerts and incidents per tier in a simple Eventhouse table. If the page tier is rarely followed by a real incident, its floor is too low.

## When this is the wrong tool

- **Thresholds set by regulation or safety.** If a standard or a contract says 8°C, the threshold is 8°C. Cost modelling can decide the action tier, but not the line.
- **No outcome data.** Without a labelled incident history, the sweep is guesswork with extra steps. Start with the volume replay, and start recording outcomes now so you can price thresholds next quarter.
- **Rare, catastrophic events.** When C_miss is huge and incidents happen once every few years, 90 days of history won't contain one. Use engineering judgement and a conservative threshold.
- **Impact you can't compute in time.** If cargo value lives in a system that syncs nightly, a value-at-risk rule is only as current as that sync. Check its freshness first.

## The decision rule

Write the threshold as a bet: what does a response cost, what does a miss cost, and how likely is this signal to be real? Price candidate thresholds against labelled history, push per-object limits and paging floors into business-owned tables, and let the value at risk pick the action. Get that right and the rule-shaping techniques from the [fatigue post](/blog/2026-03-18-real-time-signals-that-actually-help-building-alerting-that-avoids-fatigue/) and the [end-to-end monitoring design](/blog/2026-02-26-fabric-real-time-intelligence/) have the right numbers to work with.
