---
title: "When Two Fabric Reports Disagree: A Metric Drift Runbook"
description: "A triage runbook for disputed numbers in Fabric: check definition, timing, filters and logic in order, using time travel, snapshots and Semantic Link."
author: Michael John Peña
draft: false
date: 2026-04-08
tags:
  - Microsoft Fabric
  - Data Warehouse
  - Power BI
  - Semantic Link
  - Data Governance
---

Ownership rules tell you who decides what a metric means. They don't tell you what to do when two reports disagree. Say the CFO's dashboard shows 41,200 active customers at 8am and the sales pack shows 40,870. That gap gets closed by whoever can explain the difference fastest, and without a written process it's usually the most senior engineer reading SQL and DAX side by side for an afternoon.

In [One Metric, One Home](/blog/2026-03-28-warehouse-modeling-in-fabric-preventing-metric-drift-through-ownership-rules/) I set out the two rules: every metric has one home layer, and every home has one named owner. This post is the operational half: a triage runbook for disputed numbers in a Fabric Data Warehouse with Power BI semantic models on top, plus an acceptance test that catches most disagreements before anyone else sees them.

## The runbook: four questions, cheapest first

When two numbers disagree, almost every case comes down to one of four questions. I check them in order of how cheap they are to rule out, not how likely they are, because the cheap checks take minutes and often settle the dispute outright.

| Order | Question | Typical cause | Who resolves it |
|---|---|---|---|
| 1 | Same definition? | One report uses version 1 of the metric, the other version 2 | Metric owner |
| 2 | Same point in time? | Data loaded between the two refreshes | Data engineer |
| 3 | Same filter context? | A slicer, page filter or row-level security role differs | Report author |
| 4 | Same logic? | The metric is recomputed somewhere outside its home | Metric owner and engineer |

The last column matters as much as the order. A runbook that ends in "escalate to the data team" just moves the afternoon of SQL reading to someone else. Each question has a different person who can close it, and naming them up front means the triage call has the right people on it.

### 1. Same definition?

If you keep a versioned metric register, as I described in the earlier post, this is a single query: which version does each report's semantic model filter to, and is that version still live? When a definition changes, both versions should run side by side for at least one reporting cycle. A report pinned to the old version isn't wrong; it's answering a different question, and the fix is a conversation with the owner about when to cut over.

If there's no register, this step becomes archaeology, and that alone is a good argument for having one.

### 2. Same point in time?

In my experience it's the most common cause, and the one people check last because it feels too simple. A Direct Lake model and the warehouse it reads can briefly show different data, and two Import models refreshed at different times certainly will.

Direct Lake models have a setting called **Keep your Direct Lake data up to date**, which is on by default. According to [how Direct Lake works](https://learn.microsoft.com/fabric/fundamentals/direct-lake-how-it-works), when it's on the model reframes after it detects changes in the underlying Delta tables. That's great for freshness and risky for consistency: if your load writes the fact table before the dimension, a report can briefly see one without the other. If your loads have several steps, turn automatic updates off and trigger a refresh as the last step of the pipeline, so the model only ever sees completed loads.

To prove a timing difference rather than guess at it, use [time travel](https://learn.microsoft.com/fabric/data-warehouse/time-travel). Fabric Warehouse keeps 30 days of history by default, and the `FOR TIMESTAMP AS OF` query hint returns data as it existed at a given moment. Take the time the disputed report last refreshed, convert it to UTC (time travel only uses UTC), and run the same aggregate twice:

```sql
-- As of the disputed report's last refresh (UTC)
SELECT
    month_start_date,
    metric_version,
    SUM(CAST(is_active_customer AS int)) AS active_customers
FROM metrics.customer_monthly
WHERE month_start_date = '2026-03-01'
GROUP BY month_start_date, metric_version
OPTION (FOR TIMESTAMP AS OF '2026-04-07T21:00:00.000');

-- As of now
SELECT
    month_start_date,
    metric_version,
    SUM(CAST(is_active_customer AS int)) AS active_customers
FROM metrics.customer_monthly
WHERE month_start_date = '2026-03-01'
GROUP BY month_start_date, metric_version;
```

If the first query matches the report and the second matches the other number, you've found it: data changed between refreshes. The hint applies to every warehouse table in the statement, so joins see a consistent point in time too. Nobody's definition is wrong, and the useful follow-up question is whether that late-arriving data should have been allowed into a closed month at all.

**Freezing month end.** For month-end and board reporting, I'd rather prevent timing disputes than diagnose them. [Warehouse snapshots](https://learn.microsoft.com/fabric/data-warehouse/warehouse-snapshot), [generally available since November 2025](https://blog.fabric.microsoft.com/blog/warehouse-snapshots-in-microsoft-fabric-freeze-data-unlock-reliable-reporting/), give you a read-only copy of a warehouse at a point in time that consumers query like any other warehouse. Point the month-end semantic model at the snapshot, and late loads into the live warehouse can't move a number that's already been signed off.

Two limits shape how you use them. First, the month-end model has to use Import or DirectQuery, because snapshots don't support Direct Lake. That suits a frozen period anyway: refresh it once after sign-off, then turn off scheduled refresh on the month-end model so the snapshot isn't the only thing holding the numbers still. Second, snapshots freeze data, not schema. Rename or drop a column in the parent warehouse and the month-end model breaks, so freeze schema changes to the metric tables until the period is persisted.

You create the snapshot from the warehouse in the Fabric portal. Rolling it forward when the next period closes is one T-SQL statement, run while connected to the parent warehouse (not the snapshot) by someone with Admin, Member or Contributor rights, or you can use **Capture new state** in the portal. The `TIMESTAMP` argument is UTC, so a Sydney month end has to be converted first:

```sql
-- Run in the context of the parent warehouse
ALTER DATABASE [<your-snapshot-name>]
SET TIMESTAMP = '2026-03-31T13:00:00.000'; -- midnight 1 April AEDT, expressed in UTC
```

The change applies atomically, and queries already running finish against the version they started on. A snapshot's timestamp must stay within the warehouse's retention period (30 days by default), so it freezes the current close, not an archive. The order matters at the next close: persist the signed-off figures as a table first, then roll the snapshot forward. With scheduled refresh off, the Import model keeps serving its last refresh in the meantime. If you need last year's March figures exactly as reported, that table is where they live.

### 3. Same filter context?

Once definition and timing are ruled out, look at the reports themselves. The usual suspects are a page-level filter someone forgot about, a slicer saved in a non-default state, a relative date filter that rolled over at midnight UTC rather than Sydney time, or the two viewers sitting in different row-level security roles. The report author can usually close this in ten minutes by opening both reports with filters exposed. It isn't glamorous, but skipping it is how a ten-minute fix becomes an afternoon.

### 4. Same logic?

Only now do you open the code. If both numbers claim to be the same metric at the same version, same time and same filters, then one of them is computed outside its home: a DAX measure that re-implements a warehouse classification, a notebook that recalculates "active" from base tables, or an Import model that copies logic from a view and has since diverged. The fix is not to make the copy match. It's to delete the copy and point the report at the certified model, with the metric owner deciding which definition survives.

## Catch it first: an acceptance test between layers

The runbook handles disputes. An acceptance test reduces how many reach a human. The check I trust most compares the semantic model measure with an independent aggregate of the warehouse table it reads, for every month of every live version, after every load.

Semantic Link is the tool for this. Its `sempy.fabric.evaluate_dax` function runs a DAX query through the semantic model, so the result reflects the measure as the report sees it, including any DAX the model adds. I use it rather than `evaluate_measure` here because `evaluate_measure`'s filters are typed as lists of strings, and its XMLA backend quotes every value, so an integer column like `metric_version` is safer filtered in DAX. The warehouse side is read with the [Spark connector for Fabric Data Warehouse](https://learn.microsoft.com/fabric/data-engineering/spark-data-warehouse-connector), which is preinstalled in the Fabric Spark runtime. This runs in a PySpark notebook:

```python
import pandas as pd
import sempy.fabric as fabric
import com.microsoft.spark.fabric  # registers spark.read.synapsesql
from pyspark.sql import functions as F

WORKSPACE = "<your-workspace-name>"
MODEL = "<your-semantic-model-name>"
WAREHOUSE = "<your-warehouse-name>"
METRIC = "<your-metric-name>"  # metric_name as stored in governance.metric_register

# Every live version of the metric: during a parallel run there are two
live_versions = [
    row["metric_version"]
    for row in (
        spark.read.synapsesql(f"{WAREHOUSE}.governance.metric_register")
        .where((F.col("metric_name") == METRIC) & F.col("effective_to").isNull())
        .select("metric_version")
        .collect()
    )
]
if not live_versions:
    raise AssertionError(f"{METRIC}: no live version in governance.metric_register")

failures = []
for VERSION in live_versions:  # metric_version is an integer column
    # The measure as the report sees it. TREATAS keeps the version filter an
    # integer: evaluate_measure's filters are typed as lists of strings and its
    # XMLA backend quotes every value, so the integer column is filtered in DAX.
    dax = f"""
    EVALUATE
    SUMMARIZECOLUMNS(
        customer_monthly[month_start_date],
        TREATAS({{{VERSION}}}, customer_monthly[metric_version]),
        "model_count", [Active Customers]
    )
    """
    model = fabric.evaluate_dax(dataset=MODEL, dax_string=dax, workspace=WORKSPACE)
    model = model.rename(columns={
        "customer_monthly[month_start_date]": "month_start_date",
        "[model_count]": "model_count",
    })

    # An independent aggregate of the published warehouse table
    warehouse = (
        spark.read.synapsesql(f"{WAREHOUSE}.metrics.customer_monthly")
        .where(F.col("metric_version") == VERSION)
        .groupBy("month_start_date")
        .agg(F.sum(F.col("is_active_customer").cast("int")).alias("warehouse_count"))
        .toPandas()
    )

    for df in (model, warehouse):
        df["month_start_date"] = pd.to_datetime(df["month_start_date"]).dt.normalize()

    compared = model.merge(warehouse, on="month_start_date", how="outer")
    # SUMMARIZECOLUMNS drops rows where the measure is BLANK, while the warehouse
    # sum returns 0, so a month missing on the model side counts as 0
    compared["model_count"] = compared["model_count"].fillna(0)
    mismatches = compared[
        compared["model_count"] != compared["warehouse_count"].fillna(-1)
    ]

    if mismatches.empty:
        print(f"{METRIC} v{VERSION}: model and warehouse agree for {len(compared)} month(s)")
    else:
        print(f"{METRIC} v{VERSION}:")
        print(mismatches.to_string(index=False))
        failures.append(f"v{VERSION}: {len(mismatches)} month(s) disagree")

if failures:
    raise AssertionError(f"{METRIC}: " + "; ".join(failures))
```

This assumes the table has one row per customer, month and version, so a sum of the flag equals the distinct count the measure returns. If your grain is different, the warehouse aggregate has to change to match it, which is another reason to [decide grain first](/blog/2026-03-06-fabric-warehouse-tradeoffs-choosing-model-grain-before-performance-tuning/).

Run it as the last notebook activity in the load pipeline, after the semantic model refresh, and let the failure stop the pipeline.

### Identity and permissions

The Spark connector authenticates as a Microsoft Entra user, not a service principal. Inside a pipeline, the notebook runs as the user who last modified the pipeline, so that user needs Read on the warehouse plus `SELECT` on `metrics.customer_monthly` and `governance.metric_register`. The same identity runs `evaluate_dax` over the model's XMLA endpoint. Querying the model over XMLA needs Build permission at minimum; give this identity Write on the semantic model (or Contributor or higher on the workspace) so row-level security doesn't filter the measure. RLS only filters users with Viewer-level access, which is what you want here: the test compares the unfiltered measure with the unfiltered table. Don't run it with a Viewer-only identity, or RLS will filter the measure side.

### What this test doesn't cover

It compares the model with the warehouse; it doesn't check either against the owner's definition. That's the job of the reconciliation query in the earlier post, which recomputes the flag from the base tables. You want both: one proves the warehouse matches the definition, the other proves the report matches the warehouse.

## When not to bother

Don't write an acceptance test for every measure. I reserve them for metrics that appear in certified models and leave the building: board packs, regulatory returns, anything with a target attached. For the rest, the runbook is enough.

Equally, don't use exact equality on measures that involve floating-point division or currency conversion. Compare with a tolerance the owner agrees to, and write that tolerance into the register so nobody argues about it during an incident.

And if the same pair of reports disagrees every month, stop triaging. A recurring dispute is a sign that two homes exist for one metric, and the fix is the ownership conversation, not a faster runbook.

## What to take from this

Write the four questions down, in order, with a named resolver for each, before the next dispute arrives. Check definition and timing before anyone opens the code, because time travel will settle most timing arguments in two queries. Freeze closed periods with a warehouse snapshot so signed-off numbers stay put. Then automate the one comparison that matters most, the semantic model against the warehouse, so the pipeline finds the disagreement before the CFO does.
