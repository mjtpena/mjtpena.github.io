---
title: "Power BI Incremental Refresh in Production: Folding, Partitions, XMLA"
description: "What breaks once Power BI incremental refresh is live: query folding, change detection, republishing, and managing partitions through the XMLA endpoint."
author: Michael John Peña
draft: false
date: 2021-01-13
tags:
  - Power BI
  - Performance
  - XMLA
  - Analytics
---

"Why is the dataset refresh taking three hours?" is the question that eventually leads every Power BI shop to incremental refresh. The first time I switched on a properly configured policy on a large sales fact table, the daily refresh dropped from two hours to seven minutes. Turning the policy on is the easy part. Keeping it fast, correct and recoverable once the dataset is in production is where most teams get caught out.

I covered the basic setup, the `RangeStart`/`RangeEnd` parameters and the policy dialog, in [an earlier post on incremental refresh](/blog/2020-10-14-power-bi-incremental-refresh/). This one is about what happens after you publish: the folding rules that decide whether you get any benefit at all, how change detection really works, why republishing from Desktop can quietly undo your work, and what the newly GA read/write XMLA endpoint changes for partition management.

## Where things stand in January 2021

Incremental refresh went generally available in the February 2020 Power BI Desktop release, and Microsoft removed the Premium-only restriction at the same time; the [incremental refresh overview](https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-overview) lists Pro as supported. Any dataset in a Pro workspace can use it. What you don't get on Pro is the XMLA endpoint, so on shared capacity the policy is a black box: Power BI creates and merges partitions, and you can't see or touch them.

On Premium capacity, and on [Premium Per User](https://learn.microsoft.com/en-us/power-bi/enterprise/service-premium-per-user-faq) (in public preview since November 2020), you do get the XMLA endpoint. Read/write XMLA reached general availability for Premium in January 2021, as the [XMLA endpoint documentation](https://learn.microsoft.com/en-us/power-bi/enterprise/service-premium-connect-tools) records, which is what makes the partition-level operations later in this post a supported production pattern rather than a preview experiment.

| | Pro (shared capacity) | Premium (and PPU, preview) |
|---|---|---|
| Incremental refresh policy | Yes | Yes |
| Scheduled refresh timeout | 2 hours | 5 hours |
| Dataset size limit | 1 GB | Capacity dependent |
| See and refresh individual partitions | No | Yes, via XMLA |
| Override the policy's "current date" | No | Yes, via TMSL |

## Query folding decides everything

Incremental refresh works by giving each partition its own values for `RangeStart` and `RangeEnd` and running your Power Query once per partition. If the filter on those parameters folds into the source query, each partition reads only its slice. If it doesn't fold, Power BI pulls the full table for every partition and filters it in the mashup engine. You end up with a policy that is slower than a plain full refresh, and nothing errors to tell you so, apart from a Desktop warning that is easy to dismiss.

That warning appears whenever Desktop can't confirm the query folds, so people learn to click past it. My rule is to check folding on the final step, not just the filter step, so I know the whole query runs at the source.

```powerquery
let
    Source = Sql.Database("<your-server>.database.windows.net", "<your-database>"),
    Sales = Source{[Schema = "dbo", Item = "Sales"]}[Data],
    // Filter first, against the raw column, so it folds to a WHERE clause
    Filtered = Table.SelectRows(
        Sales,
        each [OrderDate] >= RangeStart and [OrderDate] < RangeEnd
    ),
    Selected = Table.SelectColumns(
        Filtered,
        {"OrderDate", "CustomerKey", "ProductKey", "SalesAmount", "LastModified"}
    )
in
    Selected
```

Right-click the last step and choose **View Native Query**. If it's greyed out, folding is broken somewhere in the chain. For SQL sources you should see a `WHERE` clause that compares `OrderDate` against two parameter values.

Two details cause most of the problems I see:

- **Use `>=` on one boundary and `<` on the other.** If both ends are inclusive, a row that lands exactly on a partition boundary gets loaded into two partitions and your totals double-count. Nothing errors; the numbers are just wrong.
- **Don't wrap the column in a function.** `each DateTime.Date([OrderDate]) >= RangeStart`, or a `Text.From` or type conversion on the column inside the filter, is where trouble starts. Folding becomes unreliable across connectors, and even when it folds the predicate is no longer sargable: the source has to evaluate the function on every row and can't use an index on `OrderDate`. Filter the raw column and derive anything else afterwards.

### Integer date keys

`RangeStart` and `RangeEnd` must be Date/Time parameters, but plenty of warehouses partition fact tables on an integer key such as `20210113`. The [incremental refresh documentation](https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-overview) covers this: convert the parameter to an integer in a function and compare against that, so the comparison still folds.

```powerquery
// Fragment: the complete body of a separate query named DateKey
(x as datetime) as number =>
    Date.Year(x) * 10000 + Date.Month(x) * 100 + Date.Day(x)
```

```powerquery
// Fragment: the filter step in the fact query, replacing the OrderDate filter above
Filtered = Table.SelectRows(
    Sales,
    each [OrderDateKey] >= DateKey(RangeStart) and [OrderDateKey] < DateKey(RangeEnd)
),
```

The conversion runs on the parameter values, not on the column, so the source still sees a plain integer comparison.

## Change detection is not row-level

"Detect data changes" sounds like change data capture. It isn't. You pick a date/time column, typically a `LastModified` audit column, and during refresh Power BI takes the maximum value of that column for each period in the incremental window. Only periods whose maximum has moved since the last refresh are reprocessed. Every period that is refreshed is still reloaded in full.

That has a few consequences:

- The change column must be maintained by the source on every insert and update. If an ETL job backfills rows without touching `LastModified`, those periods won't refresh.
- It must be a different column from the one you filter on. Using `OrderDate` for both defeats the point.
- Deletes don't move a maximum. If rows get hard-deleted in the source, change detection won't notice.

I turn it on when the refresh window is wide (30 days or more) and most of those days are static. With a 3-day window there isn't much to skip, and the extra polling query isn't worth the risk of missed updates.

**Only refresh complete days** is the other checkbox people tick without thinking. It skips the current, partial day, so it suits an overnight refresh that reports up to yesterday. If business users expect today's sales to appear after the midday refresh, leave it off. It's also worth checking the time zone in the dataset's scheduled refresh settings, which incremental refresh uses to decide what "today" is.

## Republishing from Desktop resets the history

This is the one that hurts. Publishing a .pbix over an existing dataset replaces it. The partitions built by the service go with it, and the next refresh has to reload the full historical range: all of the "store rows" period, not just the refresh window. On a large Pro dataset that first load can run into the 2-hour timeout and fail outright.

My guidance:

- **Do the first full load at a quiet time** and watch it. On Pro, if the full history can't load inside 2 hours, the policy won't save you; shrink the history or reduce the model before going further.
- **Treat a republish as a full reload** when you plan changes, and batch model edits so you're not doing it weekly.
- **On Premium, deploy metadata only.** Tools that write over the XMLA endpoint, such as the ALM Toolkit or Tabular Editor, can push model changes without dropping existing partitions, but only if you tell them to: turn on **Retain partitions** in the ALM Toolkit options, or the equivalent partition-preserving deployment setting in Tabular Editor, otherwise the deployment overwrites the policy's partitions with the single one in your file. Measures, descriptions and format strings deploy for free. Anything that changes column data, such as a new or modified source or calculated column, leaves every existing partition needing a data refresh before the column is populated, so plan it like a reload. Once you modify a dataset through XMLA, you can no longer download it as a .pbix from the service, so keep the source file under version control.

## Managing partitions over XMLA

With read/write XMLA on Premium or PPU, the policy stops being a black box. The [XMLA endpoint documentation](https://learn.microsoft.com/en-us/power-bi/enterprise/service-premium-connect-tools) covers enabling read/write in the capacity settings and connecting with SQL Server Management Studio or other client tools.

The first useful thing is simply seeing what the policy built. In SSMS, connect to `powerbi://api.powerbi.com/v1.0/myorg/<your-workspace>`, open a new MDX query window against the dataset (DMVs run there) and run:

```sql
SELECT [TableID], [Name], [RefreshedTime], [State]
FROM $SYSTEM.TMSCHEMA_PARTITIONS
```

You'll see the year, quarter, month and day partitions the policy generated and when each was last refreshed. When a single period in history has bad data, refresh only that partition rather than the whole table. The TMSL below can be run from an SSMS XMLA query window or with `Invoke-ASCmd` from the `SqlServer` PowerShell module:

```json
{
  "refresh": {
    "type": "full",
    "objects": [
      {
        "database": "<your-dataset>",
        "table": "Sales",
        "partition": "<partition-name-from-the-dmv>"
      }
    ]
  }
}
```

The second useful thing is controlling the initial load. On a big table, one refresh that creates every partition and loads all of history can hit the 5-hour Premium timeout. The [advanced incremental refresh documentation](https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-xmla) describes the way around it: apply the refresh policy first so the partitions are created without loading any data, then refresh the historical partitions one at a time or in small batches with the partition-level command above. The simplest tool for that bootstrap step is Tabular Editor: right-click the table, choose **Apply Refresh Policy**, and save, which creates the partitions over XMLA without querying the source. A failure then costs you one partition, not the whole run.

The same doc covers two properties on the normal TMSL refresh command. `applyRefreshPolicy` (true by default) decides whether a refresh of the table follows the policy. `effectiveDate` overrides the date the policy treats as "today", which is useful for testing a policy or for a back-dated load; it doesn't split history into chunks for you:

```json
{
  "refresh": {
    "type": "full",
    "applyRefreshPolicy": true,
    "effectiveDate": "12/31/2020",
    "objects": [
      {
        "database": "<your-dataset>",
        "table": "Sales"
      }
    ]
  }
}
```

If you prefer code to scripts, the same operations are available through the Tabular Object Model in `Microsoft.AnalysisServices.Tabular`. This is a .NET Framework 4.7.2+ console app referencing the `Microsoft.AnalysisServices.retail.amd64` NuGet package, the client library that supports interactive Azure AD sign-in today (the .NET Core package is still in preview). It lists partitions and queues a refresh of one:

```csharp
using System;
using Microsoft.AnalysisServices.Tabular;

class Program
{
    static void Main()
    {
        using (var server = new Server())
        {
            // Interactive Azure AD sign-in; a service principal also works for unattended jobs
            server.Connect("Data Source=powerbi://api.powerbi.com/v1.0/myorg/<your-workspace>");

            Database database = server.Databases.GetByName("<your-dataset>");
            Table sales = database.Model.Tables["Sales"];

            foreach (Partition p in sales.Partitions)
            {
                Console.WriteLine($"{p.Name}\t{p.RefreshedTime:u}");
            }

            sales.Partitions["<partition-name>"].RequestRefresh(RefreshType.Full);
            database.Model.SaveChanges();
        }
    }
}
```

`SaveChanges()` is what actually executes the refresh. Requesting it without saving does nothing.

## When I wouldn't use it

Incremental refresh isn't free, and there are cases where I'd leave it off:

- **The table refreshes in a few minutes already.** The ceremony costs more than it saves.
- **The source can't fold.** Flat files, most SharePoint lists and many web APIs will be slower with a policy than without one. Land the data in a database or a dataflow first.
- **History changes a lot.** If late-arriving corrections routinely touch rows from months ago, you either widen the refresh window until the benefit disappears, or refresh historical partitions by hand over XMLA. If that's your situation, fix the source before tuning the policy.
- **You need data that's minutes old.** Incremental refresh shortens scheduled refreshes; it doesn't give you real-time data. That's a DirectQuery or composite model conversation.

## What I'd do

Before you publish, confirm the final step folds, make one boundary exclusive, and use change detection only when the window is wide enough to skip something. Plan for the first full load and treat every republish from Desktop as another one. If you're on Premium or trialling PPU, enable read/write XMLA and get comfortable reading the partitions DMV. When a refresh goes wrong at 6am, being able to see and reload a single partition is the difference between fixing it in ten minutes and reloading five years of history.
