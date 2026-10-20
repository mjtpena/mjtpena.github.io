---
title: "Power BI Hybrid Tables: A Live DirectQuery Partition on Import"
description: "How Power BI hybrid tables add a DirectQuery partition to an incremental refresh policy, what the preview requires, and when Import alone is the better call."
author: Michael John Peña
draft: false
date: 2022-01-29
url: /blog/power-bi-hybrid-tables/
tags:
  - Power BI
  - Data Modeling
  - Performance
  - Real-Time
  - Analytics
---

Large fact tables in Power BI have always forced an awkward choice. Import is fast but only as fresh as the last refresh, and DirectQuery is fresh but makes every visual wait on the source database. Hybrid tables, in public preview since December 2021, let a single table do both: history stays in memory, and the current period is queried live. That's useful, but it also changes the performance profile of the whole table, so it's worth understanding exactly what gets built before you tick the box.

## What a hybrid table actually is

A hybrid table isn't a new storage mode you pick from a drop-down. It's an extension of [incremental refresh](https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-overview). When you define an incremental refresh policy in Power BI Desktop, there's a new option: **Get the latest data in real time with DirectQuery (Premium only)**. With it selected, the service creates three kinds of partition when it applies the policy:

| Partition | Storage | What it holds | When it changes |
|---|---|---|---|
| Archive (historical) | Import | Data older than the refresh window, merged into coarser periods such as years or months | Rolled forward and merged as time passes |
| Incremental | Import | The refresh window you defined, for example the last 30 complete days | Reloaded on every scheduled or on-demand refresh |
| Real-time | DirectQuery | Everything after the end of the last complete period | Never loaded; queried on demand |

From the report author's side it's still one table called `Sales`. Measures, relationships and row-level security are defined once. The engine decides, per query, which partitions are involved and whether it needs to send SQL to the source.

The [public preview announcement](https://powerbi.microsoft.com/en-us/blog/announcing-public-preview-of-hybrid-tables-in-power-bi-premium/) is explicit about scope: the real-time option is Premium-only, so the dataset must live in a workspace on Premium capacity, Premium Per User, or Power BI Embedded. You can author the policy in Desktop, but outside those workspaces the hybrid table won't work as designed, so publish to a Premium or PPU workspace.

This is a different thing from a composite model. A composite model mixes storage modes *across* tables, for example a DirectQuery fact with Import dimensions. A hybrid table mixes them *within* one table, split by date. I covered the across-tables case in [Power BI Composite Models](/blog/2022-01-27-power-bi-composite-models/), and the broader preview landscape in [Power BI in Early 2022](/blog/2022-01-26-power-bi-2022-features/).

## Prerequisites that decide whether it works

Before configuring anything, check three things. If any of them fails, stop and fix it first, because the policy will either be rejected or behave badly in production.

**The source must support DirectQuery.** Azure SQL Database, Synapse dedicated SQL pools, SQL Server through a gateway and similar relational sources are fine. A folder of CSV files isn't. The import and DirectQuery partitions are generated from the same Power Query expression, so all of them query the same source.

**The date filter must fold.** Incremental refresh already relies on the `RangeStart` and `RangeEnd` filter being pushed down to the source. With a hybrid table it matters more: the DirectQuery partition sends SQL at report time, so any step that breaks folding makes the table unusable rather than merely slow to refresh. Check with *View Native Query* in Power Query Editor on the last step.

**The transformations must be valid in DirectQuery.** Because part of the table is DirectQuery, the whole table is held to DirectQuery's rules. Power Query steps that don't translate to SQL, and calculated columns that depend on unsupported functions, are the usual problems. If you've been doing heavy shaping in M on this table, push that work into a view in the source instead.

## Setting it up in Power BI Desktop

Start with the two required parameters, `RangeStart` and `RangeEnd`, both of type Date/Time. Then filter the fact table on them. Use `>=` on one boundary and `<` on the other so a row on the boundary can't land in two partitions.

```powerquery
let
    Source = Sql.Database("<your-server>.database.windows.net", "<your-database>"),
    Sales = Source{[Schema = "dbo", Item = "FactSales"]}[Data],
    FilteredRows = Table.SelectRows(
        Sales,
        each [OrderDateTime] >= RangeStart and [OrderDateTime] < RangeEnd
    )
in
    FilteredRows
```

If the source column is a date or an integer key such as `20220129` rather than a datetime, convert the parameter inside the filter rather than converting the column, because converting the column usually breaks folding. For a date column, `Date.From(RangeStart)` is enough. For a yyyymmdd integer key, turn each parameter into the matching number:

```powerquery
each [OrderDateKey] >= Number.From(DateTime.ToText(RangeStart, "yyyyMMdd"))
    and [OrderDateKey] < Number.From(DateTime.ToText(RangeEnd, "yyyyMMdd"))
```

This is a fragment that replaces the filter in the step above. It still folds, because the conversion happens on the parameter side and the source sees a plain integer comparison.

Then open **Incremental refresh** on the table and set:

1. **Archive data starting** a sensible distance back, for example 3 years.
2. **Incrementally refresh data starting** a shorter window, for example 30 days.
3. **Get the latest data in real time with DirectQuery (Premium only)**.

The real-time option works with complete periods. The import window ends at the last complete day, and the DirectQuery partition picks up from there. That's why the dialog ties this option to **Only refresh complete days**: today's rows always come from the source, never from a half-loaded import partition.

In Desktop itself nothing changes visually. The table is still imported, filtered to whatever `RangeStart` and `RangeEnd` currently hold, so keep those parameter values to a small range to keep the .pbix light. The partitions only appear after you publish and the service runs the first refresh.

## What the service builds

After publishing, the policy is stored on the table in the dataset's metadata. If you connect to the workspace through the [XMLA endpoint](https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-xmla) with SQL Server Management Studio or Tabular Editor, the table definition includes a refresh policy along these lines. This is a fragment of the table's TMSL, not a complete script:

```json
"refreshPolicy": {
  "policyType": "basic",
  "mode": "hybrid",
  "rollingWindowGranularity": "year",
  "rollingWindowPeriods": 3,
  "incrementalGranularity": "day",
  "incrementalPeriods": 30,
  "incrementalPeriodsOffset": -1,
  "sourceExpression": [
    "let",
    "    Source = Sql.Database(\"<your-server>.database.windows.net\", \"<your-database>\"),",
    "    Sales = Source{[Schema = \"dbo\", Item = \"FactSales\"]}[Data],",
    "    FilteredRows = Table.SelectRows(Sales, each [OrderDateTime] >= RangeStart and [OrderDateTime] < RangeEnd)",
    "in",
    "    FilteredRows"
  ]
}
```

Two properties are worth knowing. `"mode": "hybrid"` is what tells the engine to create the DirectQuery partition, and it requires model compatibility level 1565 or higher. `"incrementalPeriodsOffset": -1` is the "complete days only" setting: the refresh window ends one day before the refresh date. The values here mirror the Desktop dialog; I'd treat the dialog as the source of truth and use XMLA to inspect the result rather than hand-editing the policy.

Each refresh then rolls the window forward. Yesterday's data moves from the DirectQuery partition into a new import partition, older days are merged into the archive, and the DirectQuery boundary advances. There's a useful side effect: because the DirectQuery partition has no upper bound, a failed refresh doesn't create a gap. The live partition simply covers a little more than usual until the next successful run. Your source takes slightly more load, but users still see complete numbers.

## Query behaviour and performance

The engine only goes to the source when a query touches the DirectQuery partition. A visual filtered to last year is answered entirely from memory. A visual that includes today, such as a "year to date" card or a line chart ending at the current date, generates SQL against the source on every render, every slicer change, and every user.

That has three practical consequences.

**Set related dimensions to Dual.** The preview announcement recommends it, and the reasoning is the same as in any composite model. If `Date`, `Product` and `Store` are Import, a query that joins them to the DirectQuery partition can't be pushed down as a single SQL statement. As Dual, they can be imported for historical queries and joined at the source for live ones.

**Design landing pages deliberately.** If the first page every user sees includes today, every report open hits the database. Sometimes that's the point. Often it isn't, and a landing page that defaults to "last complete month" with a separate "today" page gives most users Import speed.

**Size and index the source for report traffic.** The DirectQuery partition is small in rows, but the queries arrive at the rate users click. Index the date column used in the filter, and include the columns most visuals group by. A source that copes with one nightly refresh may not cope with 200 analysts at 9am.

Measures need no special handling. A plain `SUM(Sales[Amount])` returns the union of all partitions. What you should test is that measures behave the same across the boundary, particularly anything that relies on calculated columns or on functions that DirectQuery translates differently.

## A second pattern: hot in memory, cold in DirectQuery

The policy-driven setup puts the *recent* data in DirectQuery. The opposite arrangement is also possible: keep recent data in Import for speed and leave rarely queried history in DirectQuery to keep the dataset small. Desktop can't build this. You create and manage the partitions yourself through the XMLA endpoint with read-write enabled, using TMSL, the Tabular Object Model, or Tabular Editor.

I'd only consider this for very large history that users seldom touch, and only where someone on the team is comfortable owning custom partition management. You give up the automatic rolling window, so partition maintenance becomes your job.

## When not to use a hybrid table

| Situation | Better choice |
|---|---|
| Refreshing a few times a day meets the business need | Import with incremental refresh |
| You're on Pro, not Premium or PPU | Import with incremental refresh, or a separate DirectQuery table for "today" |
| The source is an OLTP system that can't take report traffic | Land the data in a warehouse or replica first |
| Power Query does heavy shaping that won't fold | Move the shaping into a source view, or stay on Import |
| The model is headed for a board pack or a critical SLA | Wait for general availability; this is still preview |

I'd add one more: don't adopt it because "real time" sounds better. Ask the business how stale is too stale. If the honest answer is "this morning's numbers are fine", eight scheduled refreshes a day (the Pro limit; Premium allows up to 48) gets you there without putting the source database in the query path.

## The call I'd make

Hybrid tables are the cleanest answer yet to "history must be fast and today must be current" in one model. They replace the old workaround of separate history and today tables stitched together with measures, and they inherit everything incremental refresh already does well.

My position as of January 2022: pilot it on one large fact table in a Premium or PPU workspace, against a source that already folds cleanly and can take report-time queries. Set the dimensions to Dual, measure the landing page before and after with Performance Analyzer, and watch the source's query load for a few weeks. If the freshness requirement doesn't truly need same-day data, stay on Import with incremental refresh; I covered that setup in [Power BI Incremental Refresh](/blog/2021-01-13-power-bi-incremental-refresh/). And keep it off anything mission-critical until it leaves preview.
