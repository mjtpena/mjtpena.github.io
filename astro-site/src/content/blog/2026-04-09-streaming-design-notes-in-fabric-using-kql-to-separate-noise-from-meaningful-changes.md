---
title: "Store Changes, Not Readings: Shaping Noisy Streams in an Eventhouse"
description: "Use update policies, materialized views and a KQL state-change function in a Fabric Eventhouse to strip duplicates, chatter and flapping before anyone queries."
author: Michael John Peña
draft: false
date: 2026-04-09
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - KQL
  - Data Engineering
---

Most device and status streams repeat themselves. A pump reports "RUNNING" every five seconds for six hours, a gateway resends a buffer after a reconnect, and a flaky sensor bounces between "OK" and "FAULT" twice a minute. If all of that lands in one table and every dashboard, alert and analyst query has to filter it again, each of them filters it slightly differently, and the noise wins.

I prefer to deal with noise in the storage design instead. In a Fabric Eventhouse that means three layers: an update policy that cleans each batch on ingestion, materialized views that remove duplicates and keep current state, and a stored function that turns readings into settled state changes. The query-time statistics for spotting unusual *numbers* are a separate problem, which I covered in [Noise or a Real Change?](/blog/2026-03-29-kql-and-operational-awareness-using-kql-to-separate-noise-from-meaningful-changes/). This post is about the shape of the data those queries run on.

## Three kinds of noise, three different fixes

Name the noise before picking a feature, because each kind needs a different amount of context.

| Noise | Example | Context needed | Where I fix it |
|---|---|---|---|
| Malformed or irrelevant rows | Empty `DeviceId`, heartbeat-only messages, inconsistent casing | The row itself | Update policy |
| Duplicates | Same `EventId` resent after a reconnect | Other rows with the same key, across batches | Materialized view (`take_any`) |
| Repetition and flapping | "RUNNING" 700 times in an hour; "FAULT" for 10 seconds | The previous and next rows for the same device | Stored function at query time |

The context column decides the layer. The most common mistake I see is deduplication or "only keep changes" logic in an update policy: it passes every test on a small sample and quietly lets duplicates through in production.

## Layer 1: clean each batch with an update policy

An [update policy](https://learn.microsoft.com/kusto/management/update-policy?view=microsoft-fabric) runs a query over newly ingested data in a source table and writes the result to a target table. It's the right place for anything you can decide from one row: validation, normalisation, dropping message types nobody queries, and rounding to the sensor's real precision.

The examples use a placeholder raw table, `DeviceStatusRaw`, fed by an Eventstream. Run each command separately.

```kusto
.create table DeviceStatusRaw (EventId: string, DeviceId: string, Timestamp: datetime, Status: string, Temperature: real)
```

```kusto
.create table DeviceStatus (EventId: string, DeviceId: string, Timestamp: datetime, Status: string, Temperature: real)
```

```kusto
.create-or-alter function with (folder = "streaming", docstring = "Row-level cleaning for DeviceStatusRaw")
CleanDeviceStatus() {
    DeviceStatusRaw
    | where isnotempty(EventId) and isnotempty(DeviceId) and isnotnull(Timestamp)
    | where Timestamp <= now(5m)
    | extend Status = toupper(trim(@"\s+", Status))
    | where Status != "HEARTBEAT"
    | extend Temperature = round(Temperature, 1)
    | project EventId, DeviceId, Timestamp, Status, Temperature
}
```

```kusto
.alter table DeviceStatus policy update
@'[{"IsEnabled": true, "Source": "DeviceStatusRaw", "Query": "CleanDeviceStatus()", "IsTransactional": true}]'
```

```kusto
.alter-merge table DeviceStatusRaw policy retention softdelete = 3d
```

A few decisions in there are worth defending.

**Transactional, on purpose.** With `IsTransactional` set to true, a failing policy fails the ingestion instead of letting rows land in the raw table but not the clean one. Microsoft's guidance is to use true in production for that reason. The cost is that a bad change to `CleanDeviceStatus()` stops ingestion, so treat the function like code: version it, test it against existing data before you alter it.

**Short raw retention, not zero.** The documentation describes a `0s` soft-delete period on the source table so raw data is never persisted. I keep a few days instead, because the first time someone asks "did the device send that, or did our cleaning drop it?", the raw table is the only honest answer. Zero retention makes sense once the rules are stable and nobody needs replay.

**The future-timestamp filter.** `Timestamp <= now(5m)` drops readings from devices with broken clocks. If those devices matter, route them to a quarantine table with a second update policy instead.

### What an update policy can't do

The Kusto docs are explicit about this: [update policies run separately for each ingestion batch](https://learn.microsoft.com/kusto/management/materialized-views/materialized-view-use-cases?view=microsoft-fabric#materialized-views-vs-update-policies), so they can only aggregate within that batch. A query like `summarize take_any(*) by EventId` inside the policy only removes duplicates that happen to arrive together. A retry that lands in the next batch is kept as a second row. The same goes for "drop this reading if the status hasn't changed": the previous reading is usually in an earlier batch, which the policy can't see. Anything that needs history belongs in the next two layers.

## Layer 2: deduplicate and keep current state with materialized views

Materialized views handle the cross-batch aggregations update policies can't. Two views cover most status streams.

```kusto
.create materialized-view with (lookback = 6h) DeviceStatusDedup on table DeviceStatus
{
    DeviceStatus
    | summarize take_any(*) by EventId
}
```

```kusto
.create materialized-view DeviceCurrentState on materialized-view DeviceStatusDedup
{
    DeviceStatusDedup
    | summarize arg_max(Timestamp, *) by DeviceId
}
```

The first view keeps one row per `EventId`. The `lookback` tells the materialization process to compare new records only against records ingested in the previous six hours, which keeps the background work cheap. The trade-off is in the [`.create materialized-view` documentation](https://learn.microsoft.com/kusto/management/materialized-views/materialized-view-create?view=microsoft-fabric#lookback-period): a duplicate that arrives after the lookback isn't caught. Set it from how long your devices can buffer offline, not from a round number. If a gateway can hold a day of readings, six hours is wrong.

### Existing data

A new view only processes records ingested after you create it. If `DeviceStatus` already holds data, use this instead of the first create command, then track the backfill with `.show operations`. Without it, the view starts with no history.

```kusto
.create async materialized-view with (lookback = 6h, backfill = true) DeviceStatusDedup on table DeviceStatus
{
    DeviceStatus
    | summarize take_any(*) by EventId
}
```

### Reading current state

The second view is a materialized view over a materialized view, which is supported only when the source view is a `take_any(*)` deduplication view, as this one is. It holds the latest row per device, so a "current status" tile or a lookup in another query reads one row per device instead of scanning recent history. Both it and the next layer's function read `DeviceStatusDedup`, so treat changes to that view like a schema change.

Both views stay fresh when queried by name: the engine combines the materialized part with records not yet processed. For `DeviceCurrentState`, which is built on another view, the docs recommend querying only the materialized part with `materialized_view()`. Querying it by name can be slow while both views are catching up. So I make `materialized_view("DeviceCurrentState", 5m)` the default way to read it, in tiles and in lookups alike. It returns only the materialized part when that was materialized in the last five minutes, and falls back to the full view otherwise, so it's cheap in the normal case and never stale by more than five minutes. The fallback is the slow path, though, so if it happens often, alert on materialization age (`.show materialized-view DeviceCurrentState` returns a `MaterializedTo` column) rather than letting tiles quietly get slower.

## Layer 3: turn readings into state changes

Now the noise that needs neighbours: repeated readings and flapping. I use a stored function rather than a table, because the minimum dwell time is a business decision that changes, and recomputing a few days for a set of devices is cheap.

```kusto
.create-or-alter function with (folder = "streaming", docstring = "Settled state transitions per device")
DeviceStateChanges(lookback: timespan, minDwell: timespan, devices: dynamic = dynamic([])) {
    DeviceStatusDedup
    | where Timestamp > ago(lookback)
    | where array_length(devices) == 0 or DeviceId in (devices)
    | project DeviceId, Timestamp, Status
    // Pass 1: keep the first reading of each run of identical statuses
    | order by DeviceId asc, Timestamp asc
    | extend IsChange = DeviceId != prev(DeviceId) or Status != prev(Status)
    | where IsChange
    // Pass 2: measure how long each state lasted and drop short-lived ones
    | order by DeviceId asc, Timestamp asc
    | extend EndedAt = iff(next(DeviceId, 1, "") == DeviceId, next(Timestamp), now())
    | extend Dwell = EndedAt - Timestamp
    | where Dwell >= minDwell
    // Pass 3: removing a flap can leave two identical states in a row, so collapse again
    | order by DeviceId asc, Timestamp asc
    | extend IsChange = DeviceId != prev(DeviceId) or Status != prev(Status)
    | where IsChange
    | extend PreviousStatus = iff(prev(DeviceId) == DeviceId, prev(Status), "")
    | project DeviceId, ChangedAt = Timestamp, PreviousStatus, Status
}
```

```kusto
DeviceStateChanges(1d, 2m)
| where PreviousStatus != "" and Status == "FAULT"
| summarize Faults = count() by DeviceId
| order by Faults desc
```

`prev()` and `next()` only work on a serialised row set, and `order by` provides one. Sorting by `DeviceId` then `Timestamp`, and comparing the device as well as the status, stops one device's last reading being treated as the previous reading of the next device. Each pass re-sorts because the `where` before it drops rows, and being explicit about the order keeps the function correct if someone later inserts an operator that doesn't preserve it.

### Cost at fleet scale

Each pass sorts every row in the window across all devices, so the function takes an optional `devices` list. Call it with a narrow lookback or a device list, for example `DeviceStateChanges(6h, 2m, dynamic(["<device-id-1>", "<device-id-2>"]))`, rather than a week across the whole estate. The alternative is to wrap the three passes in `partition hint.strategy=native by DeviceId ( ... )` (or `hint.strategy=shuffle` once you have millions of devices), or rewrite them with the `scan` operator, so each device is processed separately instead of the whole fleet being serialised into one sorted set. I'd switch to that once the single sort dominates the query; for a few hundred devices over a day, the plain version is easier to debug.

Five behaviours to understand before anyone builds on this (statuses are upper case because the update policy applies `toupper`):

- **The third pass matters.** A sequence of RUNNING, FAULT for 20 seconds, RUNNING becomes RUNNING, RUNNING once the fault is dropped. Without collapsing again, you'd report a "change" from RUNNING to RUNNING.
- **A new state appears only after it has lasted `minDwell`.** That is the debounce working as intended. It also means a real fault shows up two minutes late in this view. For safety-critical signals, that delay is unacceptable, and those signals shouldn't go through a debounce at all.
- **`ChangedAt` can be late when a flap interrupts a new state.** When nothing flaps, it is the first reading in the new state. Dwell is measured between change points, so a state that's interrupted by a flap before it reaches `minDwell` gets dropped. With `minDwell` at two minutes, take STOPPED, then RUNNING at time T for 60 seconds, then FAULT for 20 seconds, then RUNNING for hours. The function reports STOPPED to RUNNING at T plus 80 seconds, not T. The error is at most the length of the flapping period.
- **A device that flaps continuously disappears from this view entirely.** If it alternates between OK and FAULT every 30 seconds for an hour, every segment is shorter than `minDwell` and it produces no rows at all, even though sustained flapping is itself a fault. Count raw transitions per device from the Pass 1 logic (before the dwell filter) and alert on that count separately. This query is complete as shown; replace the threshold placeholder with your own number:

  ```kusto
  DeviceStatusDedup
  | where Timestamp > ago(1h)
  | project DeviceId, Timestamp, Status
  | order by DeviceId asc, Timestamp asc
  | extend IsChange = DeviceId == prev(DeviceId) and Status != prev(Status)
  | summarize Transitions = countif(IsChange) by DeviceId
  | where Transitions > <max-transitions-per-hour>
  ```
- **The first row per device in the window isn't a change.** It has an empty `PreviousStatus` because the window started there, not because the device changed. Filter on `PreviousStatus != ""` when you count transitions.

The result is usually a tiny fraction of the readings, and it's the right input for alert rules. If you alert with Activator, its *Changes*, *Changes to* and *Becomes* [detection conditions](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-detection-conditions) give you the transition half of this on the alerting side. Pair a state condition with the **When it has been true for** occurrence option (the condition must stay true for N minutes) to get the debounce. I covered both in [Alerts People Don't Mute](/blog/2026-03-18-real-time-signals-that-actually-help-building-alerting-that-avoids-fatigue/).

## When I wouldn't build this

- **When the readings are the product.** If a model trains on raw sensor values, or an auditor needs every reading, keep the full stream queryable and treat the layers here as views on top, not replacements.
- **When the stream is already clean.** Low-volume, event-shaped sources (an order placed, a job finished) don't repeat themselves. Two materialized views and a function would be ceremony.
- **When you need the change as a stored, alertable event within seconds.** The function runs at query time. If downstream systems need a pushed "state changed" event, detect it on the stream instead of polling a KQL function on a tight schedule. A plain Eventstream filter can't do this, because it can't compare a reading with the previous one for the same device. Activator's *Changes* conditions can, and so can the [Eventstream SQL operator](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/process-events-using-sql-code-editor), which went GA in March 2026 and uses the Stream Analytics query language, including `LAG` partitioned by device.
- **When nobody owns the thresholds.** `minDwell`, the lookback and the dropped message types are business rules. If no one will say "two minutes is right for pumps", you'll end up with defaults nobody trusts.

## The rule I'd keep

Match each kind of noise to the smallest scope that can see it. Row-level problems go in the update policy, because it sees one batch. Duplicates and current state go in materialized views, because they see across batches. Repetition and flapping go in a query that can look at the rows on either side. Put the logic at the wrong layer and it will look right in testing and leak noise in production. Put it at the right one and every dashboard, alert and analyst starts from the same clean set of changes.
