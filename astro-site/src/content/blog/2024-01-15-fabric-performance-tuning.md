---
title: "Tracing a Slow Fabric Report Back Through Every Layer"
description: "A diagnose-first workflow for slow Fabric reports: check capacity, the visual, DAX, Direct Lake fallback, Delta file layout and Spark, in that order."
author: Michael John Peña
draft: false
date: 2024-01-15
tags:
  - Microsoft Fabric
  - Performance
  - Spark
  - Power BI
  - Direct Lake
---

When someone tells me a Fabric report is slow, the root cause can be anywhere from a Spark config to a single visual. Fabric puts the notebook, the Delta table, the semantic model and the report on one capacity, so they slow each other down in ways a siloed team won't spot. The expensive mistake is to tune the layer you know best instead of the layer that is actually slow. My rule is to work down the stack in a fixed order and prove where the time goes before touching anything.

If you want the broader catalogue of lakehouse, warehouse and Power BI techniques, I covered that in [Fabric Performance Tuning: Optimizing Your Data Platform](/blog/2023-12-20-fabric-performance-tuning/). This one is about diagnosis: working out where the time goes before you change anything.

## Start with the capacity, not the code

Every Fabric workload draws from the same pool of capacity units. A Spark job that overruns its share gets smoothed over time, and if the capacity keeps running over its limit, interactive operations such as report queries get delayed and eventually rejected. A report that is fast at 7am and slow at 10am, with no change to the model, usually means contention on the capacity, not a query problem.

So the first stop is the [Microsoft Fabric Capacity Metrics app](https://learn.microsoft.com/fabric/enterprise/metrics-app). Look for throttling and for which items consume the most capacity units in the window when users complain. If a nightly notebook is still running at 9am, no amount of DAX tuning will help. I wrote about the capacity side in more depth in [Microsoft Fabric Capacity Management](/blog/2024-01-14-fabric-capacity-management/).

If the capacity is healthy, move down the stack.

## The report: find the slow visual first

Open the report in Power BI Desktop, turn on Performance Analyzer, and refresh the visuals. Each visual gets a breakdown of DAX query time, visual display time and "Other" (query preparation and time spent waiting for other visuals). That breakdown tells you which layer to look at:

| What dominates | Where the problem usually is | First thing to try |
|---|---|---|
| Visual display | Too many data points or a heavy custom visual | Aggregate, or switch to a core visual |
| Other | Too many visuals on the page competing for queries | Fewer visuals, move detail to drillthrough |
| DAX query | Measure logic or model design | Copy the query into DAX Studio and profile it |
| Direct query | Direct Lake fell back to DirectQuery | See the Direct Lake section below |

Page design gets dismissed as cosmetic, but it isn't. A page with 25 cards fires 25 queries. Consolidating them into a single table or multi-row card is often the biggest win available, and it takes ten minutes.

## The semantic model: fix the measures that matter

Once you have the slow visual's query, run it in DAX Studio with server timings on. You want to know whether the time is in the storage engine (scanning columns) or the formula engine (single-threaded evaluation). A high formula-engine share points to measure logic. A high storage-engine share points to model size, cardinality, or too many scans.

The most common pattern I fix is filtering a whole table when only one column is needed:

```dax
// Measure definitions: paste each into the model, or wrap them in DEFINE MEASURE ... EVALUATE in DAX Studio

// Slower: FILTER iterates every row of Sales and removes all filters on the table
Sales Since 2024 Slow =
CALCULATE (
    [Total Sales],
    FILTER ( ALL ( Sales ), Sales[OrderDate] >= DATE ( 2024, 1, 1 ) )
)

// Faster: a column predicate, which DAX expands to FILTER ( ALL ( Sales[OrderDate] ), ... )
Sales Since 2024 =
CALCULATE (
    [Total Sales],
    Sales[OrderDate] >= DATE ( 2024, 1, 1 )
)

// Variables stop the same expression being evaluated twice
Margin % =
VAR Revenue = SUM ( Sales[Amount] )
VAR Cost = SUM ( Sales[Cost] )
RETURN
    DIVIDE ( Revenue - Cost, Revenue )
```

The two filter versions are not identical. The first clears every filter on `Sales`, the second only the filter on `OrderDate`. Usually the second is what the author meant. Check it against the report before you swap one for the other.

Don't assume every iterator is the enemy, though. `SUMX ( Sales, Sales[Quantity] * RELATED ( Products[Price] ) )` is a perfectly reasonable measure, and the storage engine handles it well. Measure with server timings before rewriting it. On the model side, the usual suspects still apply: high-cardinality columns nobody filters on (transaction IDs, timestamps to the second), bi-directional relationships added "just in case", and calculated columns that belong upstream in the lakehouse.

## Direct Lake: check for silent fallback

Direct Lake semantic models read Delta tables from OneLake and page columns into memory on demand. When a query can't be served that way, the model falls back to DirectQuery against the SQL analytics endpoint. Reports keep working, but they slow down, and nothing on the page tells you it happened. Direct Lake is still in preview, so expect the fallback rules below to change.

According to Microsoft's [Direct Lake documentation](https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview), fallback is triggered by things like:

- tables built on SQL views rather than Delta tables
- row-level security defined in the SQL analytics endpoint
- tables that exceed the guardrails for your capacity SKU, such as the number of Parquet files, row groups or rows per table
- memory pressure that stops the columns a query needs from being loaded

To confirm it, follow Microsoft's guide to [analysing Direct Lake query processing](https://learn.microsoft.com/fabric/fundamentals/direct-lake-analyze-query-processing). In Performance Analyzer, a "Direct query" line on a visual means that query fell back. SQL Server Profiler shows the same thing as DirectQuery events.

The guardrail on Parquet files per table is where the Delta layer and the report layer meet. A table that a streaming or micro-batch job has written as thousands of small files can push a Direct Lake model into DirectQuery, even when the row count is modest.

Also expect the first query after a refresh to be slower: the columns it needs aren't in memory yet. If the first user every morning complains and nobody else does, that is probably what they're seeing.

## The Delta layer: file count and layout

Fabric writes Delta tables with V-Order and Optimize Write switched on by default in its Spark runtimes. V-Order is a write-time Parquet optimisation that makes reads faster for the Power BI and SQL engines. Optimize Write cuts down the number of small files a write produces. You get both without doing anything, but they don't undo years of small appends. Check the file layout directly:

```python
# Fabric notebook with a default lakehouse attached; `spark` is predefined.
rows = []
for t in spark.catalog.listTables():
    if t.tableType == "VIEW":
        continue
    detail = spark.sql(f"DESCRIBE DETAIL `{t.name}`").collect()[0]
    if detail["format"] != "delta":
        continue
    files = detail["numFiles"] or 0
    size_mb = (detail["sizeInBytes"] or 0) / 1024 / 1024
    avg_mb = size_mb / files if files else 0
    rows.append((t.name, files, round(size_mb, 1), round(avg_mb, 1)))

for name, files, size_mb, avg_mb in sorted(rows, key=lambda r: -r[1]):
    print(f"{name:40} files={files:>7} size_mb={size_mb:>10} avg_file_mb={avg_mb:>8}")
```

Tables with a high file count and a small average file size are your candidates. Compact them with `OPTIMIZE`, which in Fabric also accepts a `VORDER` clause, and clean up unreferenced files with `VACUUM`; see [Optimize Delta Lake tables with V-Order](https://learn.microsoft.com/fabric/data-engineering/delta-optimization-and-v-order) and the [lakehouse table maintenance](https://learn.microsoft.com/fabric/data-engineering/lakehouse-table-maintenance) page for the `VACUUM` retention rules:

```sql
-- Run in a Spark SQL cell. Replace fact_sales and the Z-order column with your own.
OPTIMIZE fact_sales ZORDER BY (customer_id) VORDER;

-- Default retention is 7 days; don't go shorter unless you understand the time-travel impact.
VACUUM fact_sales RETAIN 168 HOURS;
```

You can run the same compaction from the lakehouse explorer's table maintenance option, which is fine for a one-off. For anything recurring, put it in a scheduled notebook so it is versioned and visible.

On partitioning, my rule is simple: don't partition a table unless it is large, and the partition column has low cardinality and appears in most filters. Partitioning a 5 GB table by date creates hundreds of tiny folders and makes the small-file problem worse. Z-ordering inside `OPTIMIZE` gives you data skipping without that cost.

## Spark: last, and usually least

Spark tuning gets the most attention online and, in my experience, has the least to do with slow reports. It matters when the complaint is "the pipeline finished late" rather than "the report is slow".

Before setting anything, check what you already have. Adaptive query execution, partition coalescing and skew-join handling are on by default from Spark 3.2, and Fabric's Runtime 1.1 runs Spark 3.3 while [Runtime 1.2](https://learn.microsoft.com/fabric/data-engineering/runtime-1-2), which reached GA in November 2023 and is the default for new workspaces, runs Spark 3.4.1. Pasting a block of `spark.conf.set` calls copied from another platform adds noise at best. Some of those keys mean nothing on Fabric, and others change behaviour you didn't intend.

```python
for key in [
    "spark.sql.adaptive.enabled",
    "spark.sql.adaptive.coalescePartitions.enabled",
    "spark.sql.adaptive.skewJoin.enabled",
    "spark.sql.autoBroadcastJoinThreshold",
    "spark.sql.parquet.vorder.enabled",
    "spark.microsoft.delta.optimizeWrite.enabled",
]:
    print(f"{key} = {spark.conf.get(key, 'not set')}")
```

When a job really is slow, open it in the Monitoring hub and go to the Spark application view. Look for stages where a few tasks run far longer than the rest (skew), large shuffle reads, or a broadcast that should have happened and didn't. Then fix that specific stage: add a `broadcast()` hint on a small dimension, filter and select columns before the join rather than after, or salt a skewed key if AQE can't split it. Generic settings rarely beat a targeted change to the one stage that is slow.

One more Spark cost that looks like slowness is session startup. Starter pools start a session in seconds. Custom pools, or workspaces with custom libraries, take noticeably longer. For short scheduled notebooks, startup can be a large share of the total run time.

## Measure, change one thing, measure again

All of this only works if you have a baseline. Before changing anything, record the Performance Analyzer timings for the slow page, the server timings for the slow query, and the file count for the tables underneath it. Then change one layer at a time. If you compact a table, rewrite a measure and resize the capacity in the same afternoon, you won't know which one helped, and you'll carry the two that didn't into the next project.

The order I'd follow:

1. **Capacity.** Is anything throttling or contending at the time users complain?
2. **Report page.** Which visual is slow, and is the cost in display, waiting or query?
3. **DAX and model.** Storage engine or formula engine? Fix the measure or the cardinality.
4. **Direct Lake.** Is the model falling back to DirectQuery, and why?
5. **Delta layout.** Too many small files, or tables that were never optimised?
6. **Spark.** Only when the pipeline itself is late, and only on the stage the Spark UI points to.

When not to bother: if a report is only used by a few people once a week and takes eight seconds, it is probably not worth a day of tuning. Spend the effort on the pages people open every morning.
