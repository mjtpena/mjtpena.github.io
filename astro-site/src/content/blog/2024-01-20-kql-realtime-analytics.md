---
title: "Keeping KQL Fast on Streaming Data: Query Habits That Matter"
description: "The KQL habits that keep queries over streaming telemetry fast in Fabric KQL databases and Azure Data Explorer, and the shortcuts that quietly slow them down."
author: Michael John Peña
draft: false
date: 2024-01-20
tags:
  - KQL
  - Real-Time Analytics
  - Microsoft Fabric
  - Azure Data Explorer
  - Performance
---

KQL looks easy, and that is exactly why slow queries make it into production. Over a streaming table that grows by millions of rows an hour, a query that ran in 200 ms on day one can take 20 seconds a month later, and nobody notices until a dashboard with ten tiles is refreshing every 30 seconds. Most of the difference between a fast query and a slow one comes from a handful of habits, not from clever syntax.

Everything below applies to a KQL database in Fabric Real-Time Analytics (GA since November 2023) and to Azure Data Explorer, because both run the same Kusto engine. The examples use the telemetry schema from my [end-to-end Fabric Real-Time Analytics design](/blog/2024-01-18-fabric-realtime-intelligence/): a `DeviceTelemetry` table with `Timestamp`, `DeviceId`, `Temperature`, `Humidity` and `BatteryLevel`, plus the `DeviceTelemetry5m` and `DeviceLastSeen` materialized views defined there.

## Why streaming tables punish lazy queries

Kusto stores data in extents (data shards), each with its own column indexes and min/max statistics. Streaming ingestion produces lots of small, time-ordered extents that get merged over time. Two things follow from that:

- **The engine is very good at skipping data.** If your filter lets it rule out an extent from its metadata or index, it never reads it.
- **It's very bad at rescuing a query that doesn't let it skip anything.** A `contains` over a free-text column, or a join of two unfiltered tables, touches every extent no matter how much hardware sits behind it.

The caching policy matters too. Data inside the hot window lives on local SSD and memory; anything older is read from storage and is noticeably slower. If your dashboards default to "last 90 days" and your hot cache is 30 days, you've designed in a slow path.

## Habit 1: filter on time first, then on the most selective column

Put the datetime filter at the top of every query against a raw table, then the filter that removes the most rows:

```kql
DeviceTelemetry
| where Timestamp > ago(1h)
| where DeviceId == "sensor-001"
| summarize AvgTemp = avg(Temperature), MaxTemp = max(Temperature) by bin(Timestamp, 1m)
```

The optimiser usually reorders predicates, but the best practices page says that isn't guaranteed, so I write them in this order anyway. It also makes the intent obvious to the next person, and it makes the bad version stand out in a review. The bad version is the one that computes something on every row first (`extend Local = datetime_utc_to_local(Timestamp, "Australia/Sydney")`) and filters on the computed column afterwards. Filter on the stored column, then convert.

Also use `==` rather than `=~` when you know the casing. The [best practices guidance](https://learn.microsoft.com/en-us/kusto/query/best-practices) says case-sensitive comparisons are cheaper, and device IDs from firmware don't change case.

## Habit 2: use `has`, not `contains`, on text

This is the single most common slow-query cause I see in KQL written by people coming from SQL. Kusto builds a term index of every alphanumeric term of [three characters or more](https://learn.microsoft.com/en-us/kusto/query/datatypes-string-operators). `has` looks the term up in that index. `contains` matches substrings, so it can't use the index and scans the column instead. The example assumes device IDs that embed the site, following a `sensor-<site>-<nn>` convention such as `sensor-buildinga-07`, rather than the plain `sensor-001` style above.

```kql
// Index lookup: fast
DeviceTelemetry
| where Timestamp > ago(1d)
| where DeviceId has "buildinga"
| count

// Substring scan: correct, but reads every value in the time range
DeviceTelemetry
| where Timestamp > ago(1d)
| where DeviceId contains "buildinga"
| count
```

The two aren't interchangeable. `has` matches whole terms, so `"sensor-buildinga-07" has "buildinga"` is true while `"sensor-buildingab-07" has "buildinga"` is false. If you genuinely need substring matching, keep `contains` but narrow the time range hard first. If you find yourself doing it on every query, the real fix is upstream: extract the site into its own column in the update policy so you can filter it with `==`.

## Habit 3: shrink both sides before a join, and prefer `lookup` for dimensions

Joins are where most real-time query time goes. The rule is simple: aggregate or filter each side down to what you need *before* the join, and put the smaller side on the left.

For enriching telemetry with a small reference table, I use [`lookup`](https://learn.microsoft.com/en-us/kusto/query/lookup-operator) instead of `join`. It's built for exactly this shape (big fact table on the left, small dimension on the right) and it defaults to a left outer join, so devices missing from the metadata table don't silently vanish:

```kql
DeviceTelemetry
| where Timestamp > ago(1h)
| summarize AvgTemp = avg(Temperature), MaxTemp = max(Temperature) by DeviceId
| lookup (DeviceMetadata | project DeviceId, Site, DeviceType) on DeviceId
```

The documentation is explicit that `lookup` keeps the right side in memory and fails if it grows beyond several tens of MB, so this is for dimension tables, not for joining two event streams.

Correlating two event streams in time is the case people usually get wrong. Joining `AlertEvents` to `DeviceTelemetry` on `DeviceId` alone and then filtering on the time difference creates every alert-reading pair for that device before throwing most of them away. Bucket the timestamps and join on the bucket as well, so the join itself does the narrowing:

```kql
let window = 1m;
let Alerts = AlertEvents
    | where Timestamp > ago(24h)
    | project DeviceId, AlertType, AlertTime = Timestamp, TimeKey = bin(Timestamp, window);
let Readings = DeviceTelemetry
    | where Timestamp > ago(24h)
    | project DeviceId, Temperature, ReadingTime = Timestamp,
        TimeKey = range(bin(Timestamp - window, window), bin(Timestamp + window, window), window)
    | mv-expand TimeKey to typeof(datetime);
Alerts
| join kind=inner Readings on DeviceId, TimeKey
| where abs(AlertTime - ReadingTime) <= window
| project AlertTime, AlertType, DeviceId, ReadingTime, Temperature
```

Each reading is expanded into the three one-minute buckets it could match, so the join compares only nearby rows. Alerts are the small side, so they sit on the left. If both sides are genuinely large and the key has high cardinality, `hint.shufflekey=DeviceId` spreads the join across nodes; if the left side is small (the best practices page puts that at up to 100 MB) and the right is large, `hint.strategy=broadcast` is the one to try. I add hints only after `.show queries` shows the query is expensive and timing the join on its own confirms it's the bottleneck, not by default.

## Habit 4: don't compute "latest state" from raw rows on every refresh

The "status of every device" tile is in almost every operational dashboard, and it's usually written as `summarize arg_max(Timestamp, *) by DeviceId` over the raw table. That scans the whole range on every refresh. A materialized view with the same `arg_max` keeps the answer up to date incrementally, and the tile becomes a cheap read:

```kql
materialized_view("DeviceLastSeen", 5m)
| extend MinutesSinceLastSeen = datetime_diff('minute', now(), Timestamp)
| extend Status = case(
    MinutesSinceLastSeen < 5, "Online",
    MinutesSinceLastSeen < 30, "Degraded",
    "Offline")
| extend Severity = case(Status == "Offline", 0, Status == "Degraded", 1, 2)
| project DeviceId, Status, Severity, LastSeen = Timestamp, Temperature, BatteryLevel
| order by Severity asc, LastSeen desc
```

Querying the view by name (`DeviceLastSeen`) combines the materialized part with any records not yet processed, which is always correct but slower. `materialized_view()` with a `max_age` returns only the materialized part when it was refreshed within that age, which is the right trade for a status tile that already tolerates a few minutes of lag. Pick one deliberately; don't let it happen by accident.

One trap with aggregate views: averaging pre-computed averages gives the wrong answer when buckets have different row counts. If a coarser rollup needs a true average, store `sum()` and `count()` in the view and divide at query time.

## Habit 5: do time series as series, not as rows

The z-score join in the [previous post](/blog/2024-01-18-fabric-realtime-intelligence/), a mean and standard deviation per device joined back to the rows, is fine for a quick check. For per-device anomalies over time, where daily patterns matter, use `make-series` instead. It builds one array per device and the `series_*` functions run over all of them in a single, vectorised pass:

```kql
DeviceTelemetry
| where Timestamp > ago(7d)
| make-series AvgTemp = avg(Temperature) default = real(null)
    on Timestamp from startofhour(ago(7d)) to startofhour(now()) step 1h
    by DeviceId
| extend AvgTemp = series_fill_linear(AvgTemp)
| extend (Anomalies, Score, Baseline) = series_decompose_anomalies(AvgTemp, 2.5)
| mv-expand Timestamp to typeof(datetime), AvgTemp to typeof(real),
    Anomalies to typeof(int), Score to typeof(real)
| where Anomalies != 0 and Timestamp > ago(6h)
| project DeviceId, Timestamp, AvgTemp, Score, Direction = iff(Anomalies > 0, "Spike", "Drop")
```

[`series_decompose_anomalies`](https://learn.microsoft.com/en-us/kusto/query/series-decompose-anomalies-function) separates seasonality and trend before scoring, so a building that's warm every afternoon doesn't fire an alert every afternoon. Two decisions matter more than the function itself. First, fill gaps explicitly (`series_fill_linear` here); a device that drops offline produces nulls, and leaving them as zeros manufactures anomalies. Second, give the model enough history. Seven days of hourly points lets it learn a daily pattern; one day doesn't.

This approach scales well to thousands of devices. At tens of thousands with minute-level granularity, I'd run it on the `DeviceTelemetry5m` view rather than raw rows.

## Habit 6: let dashboards hit the results cache

Ten people with the same dashboard open, refreshing every 30 seconds, will run the same query over a thousand times an hour per tile. The [query results cache](https://learn.microsoft.com/en-us/kusto/query/query-results-cache) returns an identical earlier result if it's younger than the age you allow:

```kql
set query_results_cache_max_age = time(2m);
DeviceTelemetry5m
| where Timestamp > ago(24h)
| summarize MaxTemp = max(MaxTemp), Readings = sum(Readings) by bin(Timestamp, 15m), DeviceId
```

The cache only applies to results up to 16 MB and is kept per node, so it's a fit for dashboard tiles, not for large exports. It also means a viewer can see data up to two minutes old. That's almost always fine for a trend chart and almost never fine for an "is the line down right now" tile, so set it per query rather than everywhere.

## Measure before you tune

Guessing is how hints end up sprinkled through every query. `.show queries` lists recent queries with their duration and CPU, which is enough to find the few that cost the most:

```kql
.show queries
| where StartedOn > ago(1d) and State == "Completed"
| top 20 by TotalCpu desc
| project StartedOn, Duration, TotalCpu, User, Text
```

Fix the top three, then look again. The usual culprits are frequently refreshed dashboard tiles and scheduled queries, not ad hoc analysis.

## When KQL is the wrong tool

None of these habits will make KQL good at things it isn't designed for:

| Need | Better fit |
|---|---|
| Single-record lookups by key from an application at high concurrency | Azure Cosmos DB or Azure SQL Database |
| Frequent updates or deletes of individual records | A transactional database; Kusto is append-oriented |
| Joining two very large tables with no time bound | Spark in a Fabric lakehouse or Azure Databricks |
| Window functions and stateful logic before data lands | Eventstream or Azure Stream Analytics |

If your workload is mostly in that table, tuning queries treats the symptom.

## What I'd do first

If you inherit a slow real-time workload, start with `.show queries`, not the query text. Then, in order: add or tighten time filters, swap `contains` for `has` (or move the parsing into the update policy), push repeated aggregations and latest-state logic into materialized views, and turn on the results cache for dashboard tiles that can tolerate a short delay. Query hints come last. Most of the time you'll never need them.
