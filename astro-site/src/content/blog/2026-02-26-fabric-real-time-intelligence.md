---
title: "Equipment Monitoring on Fabric Real-Time Intelligence, End to End"
description: "One sensor-monitoring design on Fabric Real-Time Intelligence: where to filter, enrich, aggregate and alert, and what Eventhouse retention costs you."
author: Michael John Peña
draft: false
date: 2026-02-26
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - KQL
  - IoT
  - Data Activator
---

Batch analytics is fine for last month's report. It's useless when a motor is overheating right now and the person who can fix it won't see the number until tomorrow's refresh. Fabric Real-Time Intelligence puts that number in front of someone in seconds, but having every component in one workspace doesn't make the design decisions for you: where to filter, where to enrich, what to keep hot, and what should actually page a human.

The design below is a simplified version of a real deployment: a manufacturing client with 200+ sensors across multiple facilities. The choices matter more than the clicks.

## The shape of the pipeline

Four components do the work: Eventstream for ingestion and in-flight processing, Eventhouse (KQL databases) for storage and query, Real-Time Dashboards for live visuals, and Activator (formerly Data Activator, whose items were called reflexes) for rules and actions. Eventstream, Eventhouse and Activator are generally available.

```text
Azure IoT Hub
     |
Eventstream ---- filter calibration events
     |                         |
     |                   Group by (1-min window)
     |                         |
Eventhouse                 Activator
(raw readings,             (per-device rules:
 30-day retention)          Teams / email)
     |
     +-- materialized view (1-min aggregates)
     +-- OneLake availability --> Lakehouse shortcut / Power BI
     |
Real-Time Dashboard
```

Two choices are deliberate: enrichment happens in Eventhouse, not in the stream, and Activator gets a summarised feed, not every raw event.

## Eventstream: filter early, don't enrich

IoT Hub is a first-class Eventstream source. Give Eventstream its own consumer group on the hub. Sharing `$Default` with another reader causes disconnects and checkpoint conflicts, because exclusive receivers in the same consumer group kick each other off partitions; Microsoft recommends one consumer group per reader.

In the stream I do one cheap thing: a **Filter** that drops calibration events. They're known noise, and dropping them before the Eventhouse destination saves ingestion and storage for no loss.

What I don't do in the stream is add device and facility metadata. The Eventstream editor has no reference-data lookup against a table; its **Join** operator joins two *streams* within a time window, which doesn't fit "look up this device's name and threshold". The SQL operator (in preview), which brings Stream Analytics query semantics into the same editor, adds stream-to-stream joins and windowing but still no reference-table lookup, so enrichment stays in Eventhouse. So the stream carries only `DeviceId`, `FacilityId`, `SensorType`, `ReadingValue` and the device's own `Timestamp`, and metadata stays in a small `DeviceMetadata` table in the same KQL database. Bonus: a changed threshold takes effect on the next query, with no stream republish.

## Eventhouse: raw table plus a materialized view

The Filter outputs to a derived stream, and the Eventhouse destination on that derived stream uses Eventstream's Direct ingestion mode, so raw readings land in `SensorReadings` unchanged. Dashboards almost never need raw readings, though. They need one-minute aggregates per device, and recalculating those from raw rows on every tile refresh is how dashboards end up burning capacity. A [materialized view](https://learn.microsoft.com/en-us/kusto/management/materialized-views/materialized-view-overview?view=microsoft-fabric) keeps the aggregate current as data arrives:

```kql
.create async materialized-view with (backfill=true) SensorTemp1m on table SensorReadings
{
    SensorReadings
    | where SensorType == "temperature"
    | summarize
        avg_temp = avg(ReadingValue),
        max_temp = max(ReadingValue),
        reading_count = count()
      by DeviceId, FacilityId, bin(Timestamp, 1m)
}
```

Track the async backfill with `.show operations`; on an empty table, drop `backfill=true`.

Note the binning on the device's `Timestamp`, not `ingestion_time()`. Ingestion time drifts whenever a gateway buffers through a network blip; equipment health cares when the reading was taken.

The dashboard's main tile then reads the view and joins metadata at query time:

```kql
SensorTemp1m
| where Timestamp > ago(5m)
| summarize
    avg_temp = sum(avg_temp * reading_count) / sum(reading_count),
    max_temp = max(max_temp)
  by DeviceId, FacilityId
| lookup kind=leftouter (
    DeviceMetadata
    | project DeviceId, DeviceName, WarningThreshold, CriticalThreshold
  ) on DeviceId
| extend alert_level = case(
    avg_temp > CriticalThreshold, "critical",
    avg_temp > WarningThreshold, "warning",
    "normal")
| extend alert_level = iff(isnull(CriticalThreshold), "unconfigured", alert_level)
| order by avg_temp desc
```

Two details are easy to get wrong:

- **Weighted average.** A five-minute average built from one-minute averages has to be weighted by `reading_count`, or a device that dropped half its readings in one minute skews the result.
- **Unconfigured devices.** The thresholds come from metadata, not a hard-coded constant in the query, because different equipment has different safe ranges. But the `lookup` is a left outer join, so a device with no `DeviceMetadata` row gets null thresholds, and `case()` would quietly label it "normal" forever. The `iff()` line flags it as "unconfigured" instead, so a newly installed sensor that nobody registered shows up on the dashboard rather than hiding.

If KQL is new to your team, I wrote a [KQL primer for SQL people](/blog/2026-02-22-kql-the-query-language/) that covers `lookup`, `summarize` and the join defaults that trip people up.

### Retention and caching are cost decisions

Eventhouse storage is billed in two tiers: hot cache and standard storage. The default retention on a KQL database is 3,650 days, which is almost never what you want for one-second sensor data. I set retention and caching explicitly on day one through the [data policies](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-policies):

```kql
.alter-merge table SensorReadings policy retention softdelete = 30d recoverability = enabled

.alter table SensorReadings policy caching hot = 7d
```

Seven days hot covers the dashboards and incident investigation. Thirty days total covers "what did this compressor do before it failed last week". Anything older belongs somewhere cheaper. Keep recoverability enabled: this table feeds the `SensorTemp1m` view, and Microsoft recommends recoverability on a materialized view's source table so you can recover quickly from errors and diagnose problems with the view.

Don't stop at the raw table. The `SensorTemp1m` view has its own policies, and if you don't set them it inherits the database defaults: 3,650 days of retention and 3,650 days of hot cache. Left alone, your aggregates sit in hot cache for ten years. Set the view explicitly too (or set sensible defaults once with `.alter-merge database`):

```kql
.alter-merge materialized-view SensorTemp1m policy retention softdelete = 365d

.alter materialized-view SensorTemp1m policy caching hot = 30d
```

One-minute aggregates are around sixty times smaller than one-second raw readings, so a year of them is a cheap way to keep long history queryable in KQL while the raw rows age out after a month.

## Getting history into the lake without double-routing

The original version of this design routed every event twice, to Eventhouse and to a Lakehouse, leaving two copies with schemas that drift apart.

[Eventhouse OneLake availability](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-house-onelake-availability) (GA) exposes a KQL table as Delta in OneLake at no extra storage charge, so a Lakehouse shortcut (and a Direct Lake semantic model on top of it) or a notebook can read it without a second pipeline. There are three catches you need to know before relying on it:

- **Retention applies to the lake copy too.** When data ages out of the KQL table, it is removed from OneLake. With 30-day retention, OneLake availability gives you 30 days in Delta, not forever.
- **It isn't real time.** Files are written in batches, by default up to 3 hours or until files reach roughly 200-256 MB. You can shorten that per table with `.alter-merge table SensorReadings policy mirroring dataformat=parquet with (IsEnabled=true, TargetLatencyInMinutes=15)`, where the latency can be anything from 5 to 180 minutes, at the price of more small files in the Delta table. Either way it's fine for Power BI trend reports, not for operations.
- **It locks some table changes.** While it's on, you can't rename the table, change a column's type, or delete, truncate or purge data. Turning it off to make the change soft-deletes the OneLake copy.

My rule: if the lake only needs what Eventhouse keeps, use OneLake availability and skip the second route. If you need years of history at Lakehouse prices, keep a separate Lakehouse destination from Eventstream, and accept that you now own two copies.

## Alerting: Activator on a summarised stream

Activator can watch an Eventstream directly or run a KQL query on a schedule. For per-device threshold rules, I attach it to the stream, with one change: a **Group by** node before the Activator destination that averages `ReadingValue` by `DeviceId` and `SensorType` on a one-minute tumbling window. The stream carries every sensor type, so without `SensorType` in the grouping, unrelated readings get averaged together. (A Filter on `SensorType == "temperature"` before the Group by also works.) Activator is billed partly on events ingested, so feeding it every raw reading pays for precision nobody uses. Microsoft documents exactly this pattern for [reducing Activator rule costs](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/reduce-cost-rules-apply-summarizations).

The rule tracks each `DeviceId` as an object, filters to rows where `SensorType` is `temperature`, and fires when that one-minute temperature average crosses above the critical value. Use a condition that fires on the transition, not one that fires on every evaluation where the value is high, or a compressor that runs hot for an hour sends sixty Teams messages and the facility manager mutes the channel. For actions, I'd send a Teams message to the facility manager and start a Power Automate flow to raise a maintenance ticket.

There is a trade-off. Stream-attached rules can't see `DeviceMetadata`, so per-device thresholds either ride along on the event or the rule uses a per-sensor-type constant. When thresholds vary per device and change often, I'd instead set an [Activator alert on a KQL query](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-alert-queryset). Not the dashboard query as written, though: it returns every device, including the normal ones, and the alert fires on whatever rows come back. The alert version filters to critical devices and collapses them into a single row:

```kql
SensorTemp1m
| where Timestamp > ago(5m)
| summarize
    avg_temp = sum(avg_temp * reading_count) / sum(reading_count),
    max_temp = max(max_temp)
  by DeviceId, FacilityId
| lookup kind=leftouter (
    DeviceMetadata
    | project DeviceId, DeviceName, WarningThreshold, CriticalThreshold
  ) on DeviceId
| extend alert_level = case(
    avg_temp > CriticalThreshold, "critical",
    avg_temp > WarningThreshold, "warning",
    "normal")
| extend alert_level = iff(isnull(CriticalThreshold), "unconfigured", alert_level)
| where alert_level == "critical"
| summarize HotDevices = make_list(DeviceName), Count = count()
```

A scheduled query runs on a schedule you set (5 minutes by default) rather than per event. In this design the Eventhouse is already always on because of streaming ingestion, so the cost is the query itself. In exchange, it uses the same thresholds as the dashboard, so the alert and the red tile can't disagree.

Watch the alert volume, though. Activator sends one alert per returned row on every run. Without the final `summarize`, a 5-minute schedule over a 5-minute window means a device that stays critical pages someone every 5 minutes until it cools down, and ten hot devices mean ten messages per run. Collapsing to one row with `make_list(DeviceName)` (the pattern Microsoft's doc shows) means each run sends at most one message listing every hot device. If even that is too noisy, keep a small table of devices already alerted and filter them out before the `summarize`.

## Dashboard refresh: faster isn't free

Real-Time Dashboards support auto refresh down to 10 seconds or continuous, within a minimum interval the editor sets. Every refresh re-runs every visible tile's query against your capacity. Thirty seconds was the right answer here: temperatures don't move meaningfully faster, and the materialized view keeps each refresh cheap. If you find yourself wanting continuous refresh on a wall of tiles, check the [capacity cost](/blog/2026-01-20-fabric-capacity-planning/) before you ship it.

## Where this design doesn't fit

- **Mutable data.** Eventhouse is built for append-only events. If your source sends corrections to past readings, model them as new events, or use a different store.
- **Hourly is good enough.** If nobody acts within the hour, a Lakehouse with scheduled pipelines is simpler and cheaper. Real-time is an operational commitment, not a reporting upgrade.
- **Teams with no KQL appetite.** Every interesting decision above lives in KQL. If nobody on the team will learn it, the platform will be underused.
- **Sub-second control loops.** Shutting down a machine belongs on the edge or in the PLC, not in a cloud analytics service.

## What I'd carry into the next build

The win over the old Azure stack (Stream Analytics, Azure Data Explorer, Functions for alerting and Grafana) is fewer moving parts: one capacity, one security model, one place to look. But the design work doesn't go away. Filter in the stream, enrich and aggregate in Eventhouse, set retention before the first event lands, and give Activator only the events it needs. Get those four right and the rest is configuration.
