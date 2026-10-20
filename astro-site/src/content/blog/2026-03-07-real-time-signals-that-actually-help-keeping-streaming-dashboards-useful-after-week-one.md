---
title: "Why Real-Time Dashboards Rot After Week One, and How to Stop It"
description: "Rules for Fabric Real-Time Dashboards that stay trusted: tiles with owners, visible data freshness, refresh costs you can afford, and thresholds in tables."
author: Michael John Peña
draft: false
date: 2026-03-07
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - KQL
  - Dashboards
---

A real-time dashboard has its best week at launch. Then the slow decay starts: a tile that nobody can explain, a feed that quietly stopped two days ago while the dashboard still looked green, a refresh setting that burns capacity for a screen nobody watches. By week three people go back to asking someone in Teams, and the dashboard is wallpaper.

The tooling is rarely the cause. Fabric Real-Time Dashboards (generally available, built on KQL queries against an Eventhouse or other Kusto sources) do what they say. The decay comes from design decisions nobody made on purpose. These are the ones I make up front now.

## Every tile answers a question someone acts on

The test I apply to every tile is blunt: who looks at this, and what do they do differently when it changes? If the answer is "it's interesting" or "the stakeholder asked for it in the demo", the tile goes in a separate exploration page or nowhere.

Streaming data makes this worse than batch reporting, because everything is cheap to chart and everything moves. I write a one-line purpose for each tile in its tile title, or in a text (Markdown) tile next to it, something like "Line supervisor: restart conveyor if throughput drops below target for 5 minutes". If I can't write that sentence, I don't build the tile.

This also gives each tile an owner: when a number looks wrong, the person who owns that decision chases it, not whoever built the dashboard.

## Make silence visible

The single most damaging failure is a stalled feed that looks healthy. If ingestion stops, a "last 5 minutes" tile shows flat zeros, and green status chips stay green because no event arrived to turn anything red.

So the first tile on every operational dashboard I design is a freshness tile, and it's driven by the list of sources you *expect*, not the ones that happen to be sending. Keep a small `ExpectedSources` table in the same KQL database with each device, its owner, and how long it's allowed to go quiet (`DeviceId`, `Owner`, `MaxSilenceMinutes`). The example reuses the `SensorReadings` table from the [equipment monitoring design](/blog/2026-02-26-fabric-real-time-intelligence/), where every reading carries a `DeviceId`:

```kql
let maxTolerance = toscalar(ExpectedSources | summarize max(MaxSilenceMinutes));
let lookback = 1m * 2 * maxTolerance;
let seen = SensorReadings
    | where ingestion_time() > ago(lookback)
    | summarize LastIngested = max(ingestion_time()), LastEventTime = max(Timestamp) by DeviceId;
ExpectedSources
| join kind=leftouter seen on DeviceId
| extend MinutesSilent = coalesce(tolong((now() - LastIngested) / 1m), tolong(lookback / 1m))
| extend Status = case(
    isnull(LastIngested), "silent",
    MinutesSilent > MaxSilenceMinutes, "stale",
    "fresh")
| extend Severity = case(Status == "silent", 0, Status == "stale", 1, 2)
| order by Severity asc, MinutesSilent desc
| project DeviceId, Owner, Status, MinutesSilent, LastIngested, LastEventTime
```

Three details matter here:

- **Start from the expected list.** A query that starts from the readings table can only report on sources that sent something. The source that died is exactly the one that disappears from the result. The left outer join from `ExpectedSources` keeps it on screen.
- **Use [`ingestion_time()`](https://learn.microsoft.com/en-us/kusto/query/ingestion-time-function?view=microsoft-fabric) for freshness, event time for everything else.** Freshness is a question about the pipeline: when did Eventhouse last receive data from this source? The function relies on the table's IngestionTime policy, which is on by default.
- **Per-source tolerance.** A temperature sensor that reports every second and a batch upload that lands every 15 minutes need different thresholds. The lookback is derived from the same table (twice the longest tolerance), so an hourly batch inside its window reads as fresh rather than silent. A silent device shows the full lookback as its `MinutesSilent`, which means "at least this long", and the explicit severity sort puts silent and stale devices at the top instead of relying on alphabetical order.

On a high-volume table, rescanning twice the longest tolerance of raw readings on every refresh stops being cheap. Split sources into tolerance tiers so the fast sensors only need a short lookback, or back the tile with a materialized view that keeps only the latest ingestion time per `DeviceId`.

I put this tile top-left, coloured with conditional formatting on `Status`, so the first thing anyone sees is whether the rest of the page can be believed.

If KQL joins are unfamiliar, the [KQL primer for SQL people](/blog/2026-02-22-kql-the-query-language/) covers why the join kind matters; the default isn't what SQL users expect.

## Refresh rate is a capacity decision

Real-Time Dashboards [support auto refresh](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/dashboard-real-time-create), with the editor setting a minimum interval and a default rate for viewers; the options go down to 10 seconds or continuous. Every refresh re-runs the queries behind the visible tiles against your capacity.

The query count is only half the bill. Eventhouse [bills compute for uptime](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/real-time-intelligence-consumption#eventhouse-uptime), and it only goes idle after about five minutes with no queries or ingestion. Any refresh more often than that keeps it awake, so a screen left open overnight means 24-hour uptime. Heavy concurrent tile queries can also push the autoscale mechanism to a larger Eventhouse size.

Do the arithmetic before you pick a number. A page with 12 tiles refreshing every 30 seconds runs 24 queries a minute for one viewer. Leave it open on six wall screens and a few laptops and you're into hundreds of queries a minute, around the clock. Continuous refresh on that page belongs in your capacity plan; the [capacity planning post](/blog/2026-01-20-fabric-capacity-planning/) covers how interactive load is smoothed and where to see it in the Capacity Metrics app, which is also where Eventhouse UpTime shows up.

My defaults:

| Signal changes meaningfully every... | Refresh I'd set | Why |
|---|---|---|
| Seconds, and someone acts in seconds | Don't use a dashboard; alert instead | A human watching a screen is the slowest possible detector |
| A minute or two | 30 seconds | Fast enough to look live, cheap enough to leave open |
| 15 minutes or more | 5 minutes, or manual | Faster refresh only shows the same number more often |

Set the minimum interval as an editor, so a viewer can't switch a heavy dashboard to continuous because the faster option was there.

### Make each refresh cheap

The other half of the cost equation is what each query does. Two habits keep it under control:

- **Read aggregates, not raw rows.** If a tile shows one-minute averages, back it with a materialized view that maintains them as data lands, rather than re-summarising raw events every 30 seconds. The [equipment monitoring design](/blog/2026-02-26-fabric-real-time-intelligence/) walks through one, including the weighted average you need when rolling one-minute aggregates into longer windows.
- **Bound every query by the dashboard's time range.** Every dashboard has a built-in time range [parameter](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/dashboard-parameters), exposed in queries as `_startTime` and `_endTime`. Use it, so that "show me the last 30 days" only runs when a viewer picks it, and never as the hard-coded default on a page that refreshes every 30 seconds.

```kql
SensorTemp1m
| where Timestamp between (_startTime .. _endTime)
| summarize avg_temp = sum(avg_temp * reading_count) / sum(reading_count)
    by FacilityId, bin(Timestamp, 5m)
```

This is a tile query; `_startTime` and `_endTime` only resolve inside the dashboard. To test it in a queryset, replace them with `ago(1h)` and `now()`.

When several tiles share the same filtered slice of data, define it once as a base query (Home tab > **Base queries**) and reference it from each tile. That's mostly a maintenance win: filter logic changes in one place instead of drifting across a dozen tiles.

## Thresholds belong in tables, not queries

The second most common rot: thresholds hard-coded in tile queries. The day someone decides "warning" should be 75 instead of 80, an editor updates three tiles and misses the fourth, and now two tiles on the same page disagree about whether the same machine is in trouble.

Keep thresholds in a small reference table in the KQL database and `lookup` them at query time, the same way `ExpectedSources` drives the freshness tile. A change takes effect on the next refresh, every tile uses the same number, and if you later move an alert to an [Activator rule on a KQL queryset](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-alert-queryset) (generally available like Activator itself, for queries against a KQL database in an Eventhouse), the alert and the red tile can't disagree either.

Handle the source with no row in the reference table: a left outer join gives it null thresholds, and a `case()` that falls through to "normal" hides it forever. Label it "unconfigured".

## Separate who sees the dashboard from who sees the data

Sharing a Real-Time Dashboard and granting access to the underlying Eventhouse are separate [permission layers](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/dashboard-permissions). By default, a viewer's own identity is passed through to the data source, so a supervisor you've shared the dashboard with sees empty tiles until they also get database access. The alternative is having the dashboard query with an editor's cloud connection, so viewers see the data without direct access to the database. That connection has its own rot: a cloud connection unused for 90 days expires, and every editor who modifies the dashboard has to set up their own. When no valid connection exists, viewers only see data they can access themselves, which looks exactly like the blank-tile decay this post is about. Put the connection's owner and renewal on the same list as the tile owners.

Decide this on day one. Pass-through is the safer default when the database holds anything sensitive, because security on the data stays enforced per viewer. Editor's identity is the pragmatic choice for a shop-floor screen where the audience should see the dashboard and nothing else. What rots a dashboard is making the choice by accident, then granting database access ad hoc to whoever complains about blank tiles.

## Schedule the week-one review

The pattern I recommend is a short review at the end of the first week of real use, with the tile owners in the room. Three questions per tile:

1. Did anyone act on this tile this week?
2. Did it ever show something wrong, stale, or confusing?
3. Is the refresh rate still justified by how fast this signal moves?

Tiles that fail the first question move to an exploration page or get deleted. Tiles that fail the second get a fix and a note in their tile title or in a text tile next to them. Tiles that fail the third move to a separate dashboard with a slower refresh, or the whole dashboard's default rate drops, since auto refresh is a dashboard-level setting under **Manage** > **Auto refresh**. Repeat it monthly, because business questions drift even when the data doesn't.

## When a real-time dashboard is the wrong tool

- **Nobody acts within the hour.** If the response to a change is a decision next week, a Power BI report on a Lakehouse or Warehouse is simpler, cheaper, and easier for analysts to own.
- **The response needs to be immediate.** If a value crossing a line should page someone, build an alert in Activator and use the dashboard for context once someone is investigating.
- **Nobody on the team writes KQL.** Every tile is a KQL query. A dashboard nobody can maintain rots faster than any other kind.

## The short version

Make silence visible with a freshness tile driven by expected sources, set refresh by how fast the signal moves rather than how fast the slider goes, keep thresholds in one table, choose the permission model on purpose, and review every tile against a decision someone actually makes. A dashboard with six trusted tiles beats one with thirty that people have learnt to ignore.
