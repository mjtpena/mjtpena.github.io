---
title: "Reading a Spark Query Plan: Ten Minutes That Explain a Two-Hour Job"
author: Michael John Peña
draft: false
date: 2026-10-21T12:05:00Z
description: "Most Spark tuning is guessing: change a config, rerun, and hope. The physical plan tells you what Spark will actually do: how many shuffles, which join strategy, whether partitions were pruned, where Python is involved. How to read one bottom-up, the dozen operators that matter, and the three plans that should worry you on sight."
tags:
  - Data Engineering
  - Spark
  - Performance
  - Microsoft Fabric
  - Databricks
---

When a Spark job is slow, the usual response is to experiment. Add executors. Set `spark.sql.shuffle.partitions` to 800, then 2000. Add `.cache()` somewhere. Each attempt costs a full run, and when one of them helps, nobody can say which change it was or why.

Spark will tell you what it plans to do before it does it. The **physical plan** lists every scan, filter, shuffle, sort, and join strategy the engine picked. Reading one takes about ten minutes to learn. After that it usually takes about thirty seconds to see why a job is slow.

## Getting the plan

```python
df.explain()                     # physical plan only
df.explain(mode="formatted")     # tree + numbered node details (best for wide scans)
df.explain(mode="extended")      # parsed, analyzed, optimized logical + physical
```

```sql
EXPLAIN FORMATTED
SELECT ...;
```

Spark builds four plans: **parsed** (your query as written), **analyzed** (names resolved against the catalog), **optimized logical** (after rule-based rewrites such as predicate pushdown and constant folding), and **physical** (the operators that will actually run). When you're debugging performance, the physical plan is the one you want. The others are mainly useful when Spark has rewritten your query in a way you didn't expect.

<div class="cl cl-note">
<div class="cl-tag">AQE</div>
<div class="cl-body">

With adaptive query execution on (the default since Spark 3.2), `explain()` before running shows `AdaptiveSparkPlan isFinalPlan=false`. That's the *initial* plan. AQE re-plans between stages using real data sizes, and it may change join strategies, merge partitions, or split skewed ones. The **final** plan, with runtime metrics on every node, is in the Spark UI's **SQL / DataFrame** tab after the query has run. Read both.

</div>
</div>

## How to read it: bottom-up, children indented

A plan is a tree printed with the root at the top. Data flows **upward**, from the scans at the bottom to the final operator at the top. Indentation shows parent and child. `+-` marks a child, and `:-` marks the first of two children (the left side of a join).

Here's a typical query: a day of sales, joined to stores, revenue by region.

<div class="code-title">example.py</div>

```python
from pyspark.sql import functions as F

sales  = spark.read.table("silver.sales")     # Delta, partitioned by sale_date
stores = spark.read.table("silver.stores")    # ~40 MB

(sales.where("sale_date = '2026-10-01'")
      .join(stores, "store_id")
      .groupBy("region")
      .agg(F.sum("amount").alias("revenue"))
      .explain())
```

```text
== Physical Plan ==
AdaptiveSparkPlan isFinalPlan=false
+- HashAggregate(keys=[region#88], functions=[sum(amount#14)])
   +- Exchange hashpartitioning(region#88, 200), ENSURE_REQUIREMENTS, [plan_id=412]
      +- HashAggregate(keys=[region#88], functions=[partial_sum(amount#14)])
         +- Project [amount#14, region#88]
            +- SortMergeJoin [store_id#11], [store_id#85], Inner
               :- Sort [store_id#11 ASC NULLS FIRST], false, 0
               :  +- Exchange hashpartitioning(store_id#11, 200), ENSURE_REQUIREMENTS, [plan_id=404]
               :     +- Filter isnotnull(store_id#11)
               :        +- FileScan parquet silver.sales[store_id#11,amount#14,sale_date#16]
               :             PartitionFilters: [isnotnull(sale_date#16), (sale_date#16 = 2026-10-01)],
               :             PushedFilters: [IsNotNull(store_id)],
               :             ReadSchema: struct<store_id:int,amount:decimal(18,2)>
               +- Sort [store_id#85 ASC NULLS FIRST], false, 0
                  +- Exchange hashpartitioning(store_id#85, 200), ENSURE_REQUIREMENTS, [plan_id=405]
                     +- Filter isnotnull(store_id#85)
                        +- FileScan parquet silver.stores[store_id#85,region#88]
                             PartitionFilters: [],
                             PushedFilters: [IsNotNull(store_id)],
                             ReadSchema: struct<store_id:int,region:string>
```

(The `FileScan` lines are wrapped here for readability. Spark prints each on a single long line, and `mode="formatted"` moves them into a separate details section.)

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 412" role="img" aria-label="The physical plan drawn as a tree. At the bottom, two FileScans read sales and stores. Each passes through a Filter, an Exchange that shuffles by store_id, and a Sort, before meeting in a SortMergeJoin. Above the join are a partial HashAggregate, an Exchange that shuffles by region, and a final HashAggregate. Annotations mark the exchanges as shuffles, the join as the strategy decision, and the FileScan as the place to check partition and pushed filters.">
<defs>
<marker id="qpU" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker>
</defs>
<rect x="160" y="20" width="210" height="34" rx="9" class="ff-node"/>
<text x="265" y="41" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">HashAggregate · sum</text>
<rect x="160" y="66" width="210" height="34" rx="9" class="ff-node ff-node-am"/>
<text x="265" y="87" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">Exchange · hash(region)</text>
<rect x="160" y="112" width="210" height="34" rx="9" class="ff-node"/>
<text x="265" y="133" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">HashAggregate · partial_sum</text>
<rect x="160" y="158" width="210" height="34" rx="9" class="ff-node ff-node-pu"/>
<text x="265" y="179" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">SortMergeJoin · store_id</text>
<rect x="40" y="204" width="210" height="34" rx="9" class="ff-node"/>
<text x="145" y="225" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">Sort · store_id</text>
<rect x="280" y="204" width="210" height="34" rx="9" class="ff-node"/>
<text x="385" y="225" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">Sort · store_id</text>
<rect x="40" y="250" width="210" height="34" rx="9" class="ff-node ff-node-am"/>
<text x="145" y="271" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">Exchange · hash(store_id)</text>
<rect x="280" y="250" width="210" height="34" rx="9" class="ff-node ff-node-am"/>
<text x="385" y="271" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">Exchange · hash(store_id)</text>
<rect x="40" y="296" width="210" height="34" rx="9" class="ff-node"/>
<text x="145" y="317" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">Filter · isnotnull</text>
<rect x="280" y="296" width="210" height="34" rx="9" class="ff-node"/>
<text x="385" y="317" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">Filter · isnotnull</text>
<rect x="40" y="342" width="210" height="34" rx="9" class="ff-node ff-node-cy"/>
<text x="145" y="363" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">FileScan · sales</text>
<rect x="280" y="342" width="210" height="34" rx="9" class="ff-node ff-node-cy"/>
<text x="385" y="363" text-anchor="middle" class="ff-tok" style="fill:#e8ecef">FileScan · stores</text>
<line x1="145" y1="340" x2="145" y2="332" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="385" y1="340" x2="385" y2="332" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="145" y1="294" x2="145" y2="286" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="385" y1="294" x2="385" y2="286" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="145" y1="248" x2="145" y2="240" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="385" y1="248" x2="385" y2="240" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="145" y1="202" x2="196" y2="194" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="385" y1="202" x2="334" y2="194" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="265" y1="156" x2="265" y2="148" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="265" y1="110" x2="265" y2="102" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="265" y1="64" x2="265" y2="56" class="ff-edge" marker-end="url(#qpU)"/>
<line x1="548" y1="83" x2="374" y2="83" class="ff-edge-dash"/>
<text x="560" y="78" class="ff-elabel ff-amt">1 · EXCHANGE = A SHUFFLE</text>
<text x="560" y="94" class="ff-sub">Rows written to disk and sent over the network.</text>
<text x="560" y="108" class="ff-sub">Three here. Each one is a stage boundary.</text>
<line x1="548" y1="175" x2="374" y2="175" class="ff-edge-dash"/>
<text x="560" y="170" class="ff-elabel" style="fill:#a98af0">2 · JOIN STRATEGY</text>
<text x="560" y="186" class="ff-sub">SortMergeJoin: shuffle and sort both sides.</text>
<text x="560" y="200" class="ff-sub">Broadcast stores and both Exchanges + Sorts go.</text>
<line x1="548" y1="359" x2="494" y2="359" class="ff-edge-dash"/>
<text x="560" y="354" class="ff-elabel ff-cyt">3 · FILESCAN</text>
<text x="560" y="370" class="ff-sub">PartitionFilters → pruning. PushedFilters → pushdown.</text>
<text x="560" y="384" class="ff-sub">ReadSchema → which columns are actually read.</text>
<text x="40" y="402" class="ff-zlabel">READ BOTTOM-UP · DATA FLOWS FROM THE SCANS TO THE ROOT</text>
</svg>
<figcaption><b>The same plan as a tree.</b> Three places tell you most of what you need to know: how many exchanges there are, which join strategy was chosen, and what each scan actually reads.</figcaption>
</figure>

Reading from the bottom up:

1. **`FileScan … silver.sales`.** `PartitionFilters` contains `sale_date = 2026-10-01`, so Spark will only list and read that day's partition. That's [partition pruning](/blog/2026-10-21-partition-pruning) working. `PushedFilters: [IsNotNull(store_id)]` means the null check is sent to the Parquet reader, which can skip row groups using column statistics. `ReadSchema` lists three columns, not all forty, so column pruning works as well.
2. **`Filter isnotnull(store_id#11)`.** Spark added this itself. An inner join can never match a null key, so the optimiser removes nulls early. (In a left join it can't, which is how null keys end up causing [skew](/blog/2026-10-21-data-skew-in-spark).)
3. **`Exchange hashpartitioning(store_id#11, 200)`.** A shuffle. Every row is redistributed by `store_id` into 200 partitions so that matching keys meet. The same happens on the stores side.
4. **`Sort` + `SortMergeJoin`.** Both sides are sorted by the key and merged. The join was planned this way because `stores` is about 40 MB, above the 10 MB `autoBroadcastJoinThreshold`.
5. **`HashAggregate(partial_sum)` → `Exchange hashpartitioning(region)` → `HashAggregate(sum)`.** A two-phase aggregation. Each task pre-aggregates its rows by region, the partial results are shuffled by region, and a final aggregate combines them. The partial step is why plain sums are fairly resistant to skew.

The numbers after column names (`store_id#11`, `store_id#85`) are expression IDs. Two columns with the same name and different IDs are different columns. This matters in self-joins, where ambiguous references usually show up as two `#` IDs you didn't expect.

From this plan the first improvement is clear without running anything: `stores` is a dimension, so broadcast it. Two exchanges and two sorts disappear. AQE may do this at runtime anyway if the filtered stores data turns out to be small, and the final plan in the UI will show whether it did.

## The operators that matter

Most of what you see in a plan is routine. These are the operators that tell you something:

| You see | It means | Worry when |
|---|---|---|
| `Exchange hashpartitioning(k, n)` | A shuffle by `k` | More of them than joins and groupings would explain |
| `Exchange SinglePartition` | **All rows go to one task** | Almost always, at any real scale |
| `Exchange rangepartitioning` | A shuffle for a global sort | On large data where a per-partition sort would do |
| `BroadcastExchange` + `BroadcastHashJoin` | Small side copied to every executor | The "small" side is actually hundreds of MB or more |
| `SortMergeJoin` | Both sides shuffled and sorted | One side would fit in a broadcast |
| `BroadcastNestedLoopJoin` / `CartesianProduct` | **No equi-join key**: every row compared with every row | Nearly always |
| `PartitionFilters: []` on a partitioned table | No partition pruning | The query filters on a date or partition-related column |
| Your predicate missing from `PushedFilters` | Filter applied after reading everything | It involves a UDF, a cast, or a non-pushable function |
| `BatchEvalPython` / `ArrowEvalPython` | Rows serialised out to a Python worker for a UDF | It's in a hot path that a built-in function could handle |
| `Generate explode(...)` | One row becomes many | Downstream code assumes the original [grain](/blog/2026-10-21-the-grain-of-a-table) |
| `InMemoryTableScan` | Reading from `.cache()` | The cached data might be out of date |
| `AQEShuffleRead` (final plan) | AQE coalesced or split shuffle partitions | Never. This is AQE working as intended |

## Three plans to recognise on sight

### A join that becomes a nested loop

```python
a.join(b, (a.email == b.email) | (a.phone == b.phone))
```

An `OR` across two keys can't be hashed, so Spark falls back to `BroadcastNestedLoopJoin`. If neither side is small, you get `CartesianProduct`: every row of `a` compared with every row of `b`. A join that takes seconds on test data can run for hours on production volumes. Rewrite it as two equi-joins with a union and a deduplication:

```python
by_email = a.join(b, a.email == b.email)
by_phone = a.join(b, a.phone == b.phone)
matched  = by_email.unionByName(by_phone).dropDuplicates(["a_id", "b_id"])
```

Range joins (`a.ts BETWEEN b.start AND b.end`) have the same problem. Add an equality key wherever you can, such as the customer ID in a [point-in-time dimension lookup](/blog/2026-10-21-slowly-changing-dimensions), so the range condition is applied within each key.

### A window that sends everything to one task

```python
from pyspark.sql import Window
df.withColumn("rn", F.row_number().over(Window.orderBy("event_ts")))
```

A window with no `partitionBy` produces `Exchange SinglePartition`, and Spark logs a warning that's easy to miss: *No Partition Defined for Window operation! Moving all data to a single partition.* A billion rows on one core is a job that runs until it fails. Add a `partitionBy` if the logic permits. If you really need a global sequence number, use `monotonically_increasing_id()` (unique and increasing, but not consecutive) or `zipWithIndex` on the RDD.

### A scan that reads the whole table

```text
FileScan parquet silver.sales[...] PartitionFilters: [], PushedFilters: [...]
```

The table is partitioned by `sale_date`, the query filters on a date, and `PartitionFilters` is empty. That usually means the filter was on a different column, for example `to_date(sale_ts) = '2026-10-01'` instead of `sale_date = '2026-10-01'`, or the date filter comes from a join that dynamic partition pruning couldn't use. The next post is about exactly this.

## Use the final plan's metrics

The UI's SQL tab shows the *executed* plan with metrics on each node, which turns the plan from a forecast into a record of what happened:

- **number of output rows** on every node. Compare input and output of a join to see fan-out immediately. If 10 million rows go in and 31 million come out, a key you assumed was unique isn't.
- **number of files read / size of files read** on scans. This tells you whether pruning actually reduced the read and by how much.
- **spill size** and **peak memory** on sorts and aggregates. Spill concentrated in one task is skew.
- **data size** on exchanges. That's the actual volume each shuffle moved.

## On Monday

- Run `explain(mode="formatted")` on your slowest job and count the `Exchange` nodes. Explain each one.
- Search plans for `SinglePartition`, `NestedLoop`, and `Cartesian`. Each match needs a reason.
- On every scan of a partitioned table, check that `PartitionFilters` isn't empty.
- Look for `BatchEvalPython` and replace the UDF with built-in functions where possible.
- Make "paste the physical plan" part of performance review requests. The discussion gets much shorter.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 6 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-10-21-the-grain-of-a-table">The grain of a table</a></li>
<li><a href="/blog/2026-10-21-event-time-vs-processing-time">Event time vs processing time</a></li>
<li><a href="/blog/2026-10-21-late-arriving-data">Late-arriving data</a></li>
<li><a href="/blog/2026-10-21-data-skew-in-spark">Data skew</a></li>
<li class="on">Reading a Spark query plan</li>
<li><a href="/blog/2026-10-21-partition-pruning">Partition pruning</a></li>
<li><a href="/blog/2026-10-21-the-small-files-problem">The small files problem</a></li>
<li><a href="/blog/2026-10-21-slowly-changing-dimensions">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution">Schema evolution</a></li>
</ol>
</nav>
