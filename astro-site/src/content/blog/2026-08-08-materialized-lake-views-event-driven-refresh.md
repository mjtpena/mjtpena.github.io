---
title: "Event-Driven Refresh for Materialized Lake Views: Schedules Still Win"
description: "Event-triggered refresh for Fabric materialized lake views trades predictable capacity and clean ordering for freshness. Where events fit and where they don't."
author: Michael John Peña
draft: false
date: 2026-08-08
tags:
  - Microsoft Fabric
  - Data Engineering
  - Lakehouse
  - Delta Lake
  - Architecture
---

The [Fabric July 2026 feature summary](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/Fabric-July-2026-Feature-Summary/ba-p/5325823) put event-triggered refresh for materialized lake views (MLVs) into preview, alongside an Analytics tab on the materialized lake views ribbon. "Refresh when the data arrives" sounds strictly better than "refresh at 6am", but it isn't: an event trigger gives you fresher data and costs you predictable capacity use and the clean dependency ordering a schedule gives you for free. Whether that trade pays off depends on which layer of the medallion you're refreshing and on what optimal refresh will actually do when the trigger fires.

## What shipped, precisely

MLVs themselves are GA. They're declarative Spark SQL (or PySpark, still in preview) transformations that Fabric materialises as Delta tables, tracks in a lineage graph and refreshes in dependency order. The new piece is a second **Refresh type** on a schedule. According to the [scheduling documentation](https://learn.microsoft.com/en-us/fabric/data-engineering/materialized-lake-views/schedule-lineage-run), a schedule can now be:

- **Time-based**: repeat by minute, hour, day, week or month, with time slots, a date range and a time zone.
- **Event-triggered (Preview)**: fire on **Job events** (a Fabric notebook or pipeline run completing) or **OneLake events** (data landing in OneLake).

Two preview constraints are worth knowing before you design around it:

- Private Link isn't part of the preview scope. If your tenant or workspace relies on it, this feature isn't for you yet.
- The trigger runs through an auto-created "FMLV Refresh" notebook and an Activator item. Edit or delete either and event-triggered refreshes can stop working. Put both on the list of items your clean-up scripts and CI/CD deployments must leave alone.

The same page says something people tend to skim past: **if a new refresh starts while another is running, Fabric skips the later one**, and a run fails if it goes past 24 hours. That rule exists for schedules too. With events, though, how often it bites depends on upstream arrival patterns you don't control.

## Optimal refresh decides what a trigger costs

A trigger only decides *when* a refresh starts. *What* the refresh does is decided by [optimal refresh](https://learn.microsoft.com/en-us/fabric/data-engineering/materialized-lake-views/refresh-materialized-lake-view), which is on by default and picks one of three strategies per view on every run:

| Strategy | When Fabric picks it | Cost profile |
|---|---|---|
| No refresh | No new Delta commits on any source table | Close to free |
| Incremental | New commits, CDF enabled on all sources, append-only changes, only supported SQL constructs | Proportional to new data |
| Full | Anything else, including unsupported constructs, deletes or updates, or a small source where recompute is cheaper | Proportional to the whole dataset |

This is why "event-driven is more efficient" is only half true. Run a time-based schedule every 15 minutes over sources that change twice a day and most runs come out as no-refresh, which costs very little. An event trigger cuts those empty runs, but they were cheap to begin with. The runs that cost real money are the full refreshes, and triggering more often only multiplies them.

The conditions for incremental refresh are stricter than most people expect:

- **Change data feed (CDF) must be on for every source.** Without `delta.enableChangeDataFeed=true`, optimal refresh can only choose between no refresh and full refresh.
- **Each refresh cycle must be append-only.** If any source records an update or a delete in that cycle, the engine falls back to full refresh, even with CDF enabled and a fully supported query. A `MERGE`-based upsert into bronze that updates or deletes rows counts.
- **The SQL must stay inside the supported constructs.** Window functions, `DISTINCT` and non-deterministic functions such as `current_timestamp()` all force a full refresh. For a `LEFT OUTER JOIN`, any change on the right-side table forces a full refresh. Aggregates other than `SUM`, `COUNT`, `MIN` and `MAX` need every source partitioned, with the partition column in the `GROUP BY`.
- **PySpark-defined MLVs always do a full refresh.**

Before you put an event on a view, check what its sources actually do between refreshes. Delta history tells you directly:

```sql
-- Look for UPDATE, DELETE, or MERGE operations whose operationMetrics show
-- non-zero numTargetRowsUpdated or numTargetRowsDeleted between refreshes.
-- Any of these in a cycle forces a full refresh of downstream MLVs.
DESCRIBE HISTORY bronze.orders LIMIT 20;

-- Turn on CDF so incremental refresh is even possible.
ALTER TABLE bronze.orders   SET TBLPROPERTIES (delta.enableChangeDataFeed = true);
ALTER TABLE bronze.products SET TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

If the `operation` column shows `MERGE`, check `operationMetrics` for non-zero `numTargetRowsUpdated` or `numTargetRowsDeleted`; those upserts force a full recompute every time they run, and an event trigger downstream just makes that happen more often. An insert-only `MERGE` records neither, so it can still leave the cycle append-only.

CDF only records changes made after you set the property, so expect the first refresh after enabling it (and the `ALTER TABLE` commit itself) to land as a full refresh. Judge the policy mix after a few cycles, not the first one.

## Non-Delta sources make every event a full refresh

The documentation is blunt: MLVs over non-Delta source tables always do a full refresh, because both no-refresh and incremental depend on reading Delta commits. With no commit log to inspect, Fabric can't tell whether anything changed, so it can't skip, and it has no CDF to read, so it can't go incremental.

This matters most for the pattern event triggers seem built for: files landing in OneLake, a OneLake event firing, and a view over those files refreshing straight away. If the view reads CSV, JSON or Parquet directly rather than a Delta table, every event means rebuilding the view over everything. A partner that drops 200 small files over an afternoon can produce a run of full recomputes, and because overlapping refreshes are skipped, it's hard to predict how many of those actually run.

My rule: **never put an event trigger on an MLV whose lineage includes a non-Delta source.** Land the files into a Delta table first, with a notebook or pipeline that you control, and trigger from that job's completion instead. You get one event per batch rather than one per file, and the MLV now sits on a source that optimal refresh can reason about.

## What you give up: ordering and predictability

A time-based schedule with **Refresh all materialized lake views** refreshes the whole lineage in dependency order. With extended lineage turned on, that order crosses lakehouses too: one schedule in a gold lakehouse can cascade through silver and bronze, and independent branches run in parallel. The run happens at a known time, and you can see what it costs in the capacity metrics app and plan around it.

Event triggers weaken both of those properties.

**Ordering becomes a function of arrival.** Take a gold view that joins orders with a customer dimension, where the two are loaded by separate pipelines. With an event-triggered schedule on each pipeline's completion, the first completion refreshes gold against a half-updated picture, and the second refreshes it again. If the dimension is on the right side of a `LEFT JOIN`, the second refresh is a full one. A schedule set after both loads land does the job once, in order, against consistent inputs.

**Capacity use follows upstream behaviour.** Bursty upstream jobs give you bursty refreshes. Everything shares the capacity, so a backfill that replays a week of pipeline runs turns into a week of MLV refreshes landing in an hour, competing with interactive Spark and your semantic models. With a schedule, the worst case is bounded by the cadence you chose.

**Skipped runs can strand data.** I haven't seen this documented as a scenario, but it follows from the overlap rule. If an event fires while a refresh is still running, that trigger is skipped. If no further event arrives, the commits it was meant to pick up wait until the next one does. A schedule always comes around again. An event might not. If you do use an event trigger, pair it with a low-frequency time-based schedule on the same views as a safety net; when nothing changed, it lands as a near-free no-refresh run.

None of these are bugs. They come with reacting to events instead of running on a clock, and the Microsoft guidance points the same way: use event-triggered refresh when arrival is unpredictable, and align time-based schedules with reporting SLAs.

## Which layers deserve events

This is how I'd split a typical bronze/silver/gold lakehouse. It's the same separation of ingestion from curation I [argued for earlier this year](/blog/2026-04-16-fabric-architecture-notes-where-i-separate-ingestion-from-curation/).

| Layer | Refresh type | Why |
|---|---|---|
| Bronze to silver (single source, append-only, CDF on) | Event-triggered on the ingestion job's completion | Incremental refresh is realistic, ordering is trivial with one upstream, and freshness here benefits everything downstream |
| Bronze to silver (files, non-Delta, or MERGE-heavy) | Time-based | Every event would be a full refresh, so put a ceiling on how often that happens |
| Silver to gold (multi-source joins, aggregates) | Time-based, aligned to the reporting SLA | Needs consistent inputs and dependency order, and often runs full anyway |
| Operational views with a genuine freshness need | Event-triggered, scoped to selected views | Only where someone acts on the data within minutes and the SQL stays incremental-friendly |

A schedule can be scoped to **selected materialized lake views**, so mixing the two is easy. Put an event-triggered schedule on the handful of silver views next to ingestion, and a time-based schedule using **Refresh selected materialized lake view(s)** scoped to the gold views only. Don't reach for "refresh all" here: it also refreshes the event-driven silver views, usually as cheap no-refresh runs, but it can collide with an in-flight event run, and under the skip rule one of the two gets dropped.

Prefer **job events** over **OneLake events** wherever you own the upstream job. A notebook or pipeline completion marks a batch as finished. A OneLake event marks data appearing, which can mean partial data and many events per batch.

## Measure before you switch

The Analytics tab is the right tool for this decision. Alongside run trends and top error codes, it has a **refresh policy distribution** chart that shows how your runs split across no-refresh, incremental and full. Run your existing schedule for a week or two first, then read the [analytics](https://learn.microsoft.com/en-us/fabric/data-engineering/materialized-lake-views/analytics):

- **Mostly no-refresh:** your schedule is cheap already, and an event trigger mainly buys latency. Switch only if the latency matters to someone.
- **Mostly incremental:** these views are good event candidates, as long as ordering holds.
- **Mostly full:** fix that first. Enable CDF, remove the `MERGE` from upstream, rewrite the window function, or partition for the aggregate. An event trigger on a view that always runs full just spends capacity faster.

When you do need to force a rebuild after a correction, do it explicitly rather than disabling optimal refresh for the whole schedule:

```sql
REFRESH MATERIALIZED LAKE VIEW `<your-workspace>`.<your-lakehouse>.silver.cleaned_order_data FULL;
```

## The decision

Event-triggered refresh is a good feature in the wrong default position. Start every MLV lineage on a time-based schedule, read the refresh policy mix, and move views onto events only when they're single-source, Delta-backed, CDF-enabled, append-only and actually needed fresher than the schedule delivers. Keep gold on a clock set to when people read it. And while it's in preview, without Private Link and with Activator plumbing you mustn't touch, treat it as an optimisation for a few silver views rather than the new way to run your lakehouse.
