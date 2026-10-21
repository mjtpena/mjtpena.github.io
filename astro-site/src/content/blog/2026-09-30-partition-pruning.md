---
title: "Partition Pruning: The Fastest Data Is the Data You Never Read"
author: Michael John Peña
draft: false
date: 2026-09-30
url: "/blog/2026-10-21-partition-pruning/"
description: "A query for one day should not read three years. How partition pruning works, the five ways it silently breaks, and how to pick partition columns."
tags:
  - Data Engineering
  - Spark
  - Delta Lake
  - Performance
  - Microsoft Fabric
---

A dashboard query for "yesterday's sales" took four seconds when the table launched. Eighteen months later it takes four minutes. The query hasn't changed, and neither has the amount of data in a day. The difference is that the query reads every day the table has ever held, and there are now 540 of them.

Problems like this are easy to miss because nothing breaks suddenly. The query gets a little slower every day until someone eventually notices. The cause is nearly always the same: **partition pruning** stopped working, or never worked.

## Four layers of not reading data

Engines like Spark avoid I/O at several levels. It's worth separating them, because each is controlled by something different and shows up in a different part of the plan:

| Layer | What it skips | Driven by | Where to check |
|---|---|---|---|
| **Partition pruning** | Whole partitions, before files are listed | Predicates on partition columns | `PartitionFilters` in the scan |
| **Data skipping** (Delta) | Individual files | Per-file min/max statistics in the transaction log | *files read* metric vs table file count |
| **Predicate pushdown** | Parquet row groups inside a file | Row-group statistics in the Parquet footer | `PushedFilters` in the scan |
| **Column pruning** | Columns | The columns your query references | `ReadSchema` in the scan |

Partition pruning is the coarsest and the cheapest. In a Hive-style layout (`.../sale_date=2026-10-14/part-0001.parquet`) or a Delta table with partition values in its log, the planner evaluates your predicate against the *partition values* during planning. Partitions that can't match are never listed, opened, or scheduled.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 290" role="img" aria-label="Two panels show thirty daily partitions of a sales table. On the left, a filter on the partition column sale_date reads only the partition for the 14th: 41 of 1,236 files. On the right, a filter on to_date of the timestamp column reads all thirty partitions: 1,236 of 1,236 files, with empty PartitionFilters.">
<rect x="30" y="24" width="420" height="246" rx="16" class="ff-zone ff-zone-read"/>
<text x="48" y="48" class="ff-zlabel">PRUNED · FILTER ON THE PARTITION COLUMN</text>
<text x="48" y="80" class="ff-tok">WHERE sale_date = '2026-10-14'</text>
<rect x="48" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="65" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">01</text>
<rect x="88" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="105" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">02</text>
<rect x="128" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="145" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">03</text>
<rect x="168" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="185" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">04</text>
<rect x="208" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="225" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">05</text>
<rect x="248" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="265" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">06</text>
<rect x="288" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="305" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">07</text>
<rect x="328" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="345" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">08</text>
<rect x="368" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="385" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">09</text>
<rect x="408" y="104" width="34" height="28" rx="6" class="ff-node"/>
<text x="425" y="122" text-anchor="middle" class="ff-sub" style="opacity:0.45">10</text>
<rect x="48" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="65" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">11</text>
<rect x="88" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="105" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">12</text>
<rect x="128" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="145" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">13</text>
<rect x="168" y="140" width="34" height="28" rx="6" class="ff-node ff-node-cy"/>
<text x="185" y="158" text-anchor="middle" class="ff-sub">14</text>
<rect x="208" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="225" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">15</text>
<rect x="248" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="265" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">16</text>
<rect x="288" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="305" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">17</text>
<rect x="328" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="345" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">18</text>
<rect x="368" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="385" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">19</text>
<rect x="408" y="140" width="34" height="28" rx="6" class="ff-node"/>
<text x="425" y="158" text-anchor="middle" class="ff-sub" style="opacity:0.45">20</text>
<rect x="48" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="65" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">21</text>
<rect x="88" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="105" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">22</text>
<rect x="128" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="145" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">23</text>
<rect x="168" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="185" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">24</text>
<rect x="208" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="225" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">25</text>
<rect x="248" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="265" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">26</text>
<rect x="288" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="305" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">27</text>
<rect x="328" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="345" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">28</text>
<rect x="368" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="385" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">29</text>
<rect x="408" y="176" width="34" height="28" rx="6" class="ff-node"/>
<text x="425" y="194" text-anchor="middle" class="ff-sub" style="opacity:0.45">30</text>
<text x="48" y="234" class="ff-tok">PartitionFilters: [(sale_date = 2026-10-14)]</text>
<text x="48" y="254" class="ff-sub">files read: <tspan class="ff-cyt">41 of 1,236</tspan> · one partition listed</text>
<rect x="460" y="24" width="420" height="246" rx="16" class="ff-zone ff-zone-danger"/>
<text x="478" y="48" class="ff-zlabel">FULL SCAN · FILTER ON A DIFFERENT COLUMN</text>
<text x="478" y="80" class="ff-tok">WHERE to_date(sale_ts) = '2026-10-14'</text>
<rect x="478" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="495" y="122" text-anchor="middle" class="ff-sub">01</text>
<rect x="518" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="535" y="122" text-anchor="middle" class="ff-sub">02</text>
<rect x="558" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="575" y="122" text-anchor="middle" class="ff-sub">03</text>
<rect x="598" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="615" y="122" text-anchor="middle" class="ff-sub">04</text>
<rect x="638" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="655" y="122" text-anchor="middle" class="ff-sub">05</text>
<rect x="678" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="695" y="122" text-anchor="middle" class="ff-sub">06</text>
<rect x="718" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="735" y="122" text-anchor="middle" class="ff-sub">07</text>
<rect x="758" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="775" y="122" text-anchor="middle" class="ff-sub">08</text>
<rect x="798" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="815" y="122" text-anchor="middle" class="ff-sub">09</text>
<rect x="838" y="104" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="855" y="122" text-anchor="middle" class="ff-sub">10</text>
<rect x="478" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="495" y="158" text-anchor="middle" class="ff-sub">11</text>
<rect x="518" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="535" y="158" text-anchor="middle" class="ff-sub">12</text>
<rect x="558" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="575" y="158" text-anchor="middle" class="ff-sub">13</text>
<rect x="598" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="615" y="158" text-anchor="middle" class="ff-sub">14</text>
<rect x="638" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="655" y="158" text-anchor="middle" class="ff-sub">15</text>
<rect x="678" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="695" y="158" text-anchor="middle" class="ff-sub">16</text>
<rect x="718" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="735" y="158" text-anchor="middle" class="ff-sub">17</text>
<rect x="758" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="775" y="158" text-anchor="middle" class="ff-sub">18</text>
<rect x="798" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="815" y="158" text-anchor="middle" class="ff-sub">19</text>
<rect x="838" y="140" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="855" y="158" text-anchor="middle" class="ff-sub">20</text>
<rect x="478" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="495" y="194" text-anchor="middle" class="ff-sub">21</text>
<rect x="518" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="535" y="194" text-anchor="middle" class="ff-sub">22</text>
<rect x="558" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="575" y="194" text-anchor="middle" class="ff-sub">23</text>
<rect x="598" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="615" y="194" text-anchor="middle" class="ff-sub">24</text>
<rect x="638" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="655" y="194" text-anchor="middle" class="ff-sub">25</text>
<rect x="678" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="695" y="194" text-anchor="middle" class="ff-sub">26</text>
<rect x="718" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="735" y="194" text-anchor="middle" class="ff-sub">27</text>
<rect x="758" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="775" y="194" text-anchor="middle" class="ff-sub">28</text>
<rect x="798" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="815" y="194" text-anchor="middle" class="ff-sub">29</text>
<rect x="838" y="176" width="34" height="28" rx="6" class="ff-node ff-node-dn"/>
<text x="855" y="194" text-anchor="middle" class="ff-sub">30</text>
<text x="478" y="234" class="ff-tok">PartitionFilters: []</text>
<text x="478" y="254" class="ff-sub">files read: <tspan class="ff-amt">1,236 of 1,236</tspan> · every partition listed</text>
</svg>
<figcaption><b>Same question, same answer, 30× the I/O.</b> Both queries ask for the 14th. Only the left one filters on the column the table is partitioned by. The right one gets slower every day, because each new partition is another one to read.</figcaption>
</figure>

## Verifying it

Don't assume it works. Check:

```python
spark.read.table("silver.sales").where("sale_date = '2026-10-14'").explain()
```

```text
FileScan parquet silver.sales[...] ...
  PartitionFilters: [isnotnull(sale_date#16), (sale_date#16 = 2026-10-14)],
  PushedFilters: [...], ...
```

A non-empty `PartitionFilters` that mentions your partition column means pruning is planned. To see how much it actually saved, look at the executed scan in the Spark UI's SQL tab. *number of files read* and *number of partitions read* against the table's totals give you the real reduction. The [query plan post](/blog/2026-09-23-reading-a-spark-query-plan/) covers reading the rest of the plan.

## Five ways pruning breaks

### 1. Filtering on the source column, not the partition column

The table is partitioned by `sale_date`, which is derived from `sale_ts`. Someone writes:

```sql
WHERE sale_ts >= '2026-10-14' AND sale_ts < '2026-10-15'
```

That's a perfectly reasonable filter for the question, but the planner doesn't know that `sale_date` is derived from `sale_ts`, so `PartitionFilters` is empty and every partition is read.

You can teach the engine the relationship. In Delta Lake, declare the partition column as a [**generated column**](https://docs.delta.io/latest/delta-batch.html), and Delta derives the partition filter from predicates on the source column:

<div class="code-title">ddl/silver_sales.sql</div>

```sql
CREATE TABLE silver.sales (
  sale_id   BIGINT,
  store_id  INT,
  amount    DECIMAL(18,2),
  sale_ts   TIMESTAMP,
  sale_date DATE GENERATED ALWAYS AS (CAST(sale_ts AS DATE))
)
USING DELTA
PARTITIONED BY (sale_date);
```

With that definition, a filter on `sale_ts` gets a matching `sale_date` partition filter. Delta supports this for a specific set of expressions: `CAST(... AS DATE)`, `YEAR`, `MONTH`, `DAY`, `DATE_FORMAT`, `DATE_TRUNC`, and a few others. Arbitrary expressions don't qualify. And note that `CAST(timestamp AS DATE)` uses the session time zone, so [pin it](/blog/2026-09-02-event-time-vs-processing-time/) or partitions end up a few hours off depending on which cluster wrote them.

Without generated columns, the fix is a convention: always filter on the partition column, and also on the source column when you need sub-day precision.

### 2. The filter comes from a join

Analysts don't write `sale_date BETWEEN ...`. They write:

```sql
SELECT ...
FROM silver.sales s
JOIN gold.dim_date d ON d.date = s.sale_date
WHERE d.fiscal_quarter = 'FY27-Q2'
```

The filter is on `dim_date`, and the planner doesn't know which `sale_date` values it produces until it runs. **Dynamic partition pruning** (on by default since Spark 3.0) handles this. At runtime, Spark evaluates the filtered dimension side first and uses the resulting keys to prune the fact table's partitions. When it applies, the plan shows it:

```text
PartitionFilters: [isnotnull(sale_date#16), dynamicpruningexpression(sale_date#16 IN dynamicpruning#120)]
```

When it doesn't apply, this is usually why: by default (`spark.sql.optimizer.dynamicPartitionPruning.reuseBroadcastOnly = true`), DPP only fires when the dimension side is broadcast, because it reuses the broadcast result rather than computing the dimension twice. Keep dimensions small enough to broadcast, and keep the join on the partition column itself rather than an expression of it.

### 3. The filter sits above something it can't be pushed through

The optimiser moves filters down toward the scan, but not through everything:

- **Window functions.** A filter on a column the window is *not* partitioned by can't move below the window, because removing rows first would change the window's result. Filter before the window in your code.
- **Caching.** `df = spark.read.table("silver.sales").cache()` followed by `df.where("sale_date = ...")` filters the *cache*, and the cache was built from the whole table. Filter, then cache.
- **Non-deterministic expressions and some UDFs.** Anything the optimiser can't safely reorder stays where you put it.

### 4. String partition values

Partition columns stored as strings work until someone compares them:

```sql
WHERE month >= '9'      -- on a string column: '10', '11', '12' are all < '9'
```

Lexicographic order isn't numeric order. Pruning works perfectly and returns the wrong partitions. Use real `DATE` or `INT` partition columns, and if you inherit string ones, zero-pad them (`'09'`) and compare on full dates.

### 5. There's no filter at all

`SELECT * FROM silver.sales` from a BI tool in DirectQuery mode, or a notebook that loads the whole table and filters in pandas. Pruning can only use predicates that reach the engine. Semantic models should push date filters down, and notebooks should filter before calling `.toPandas()`, not after.

## Choosing partition columns

Pruning only helps if the table is partitioned by something queries actually filter on, and partitioning can make things worse when it's done badly.

<div class="cl cl-key">
<div class="cl-tag">Rules of thumb</div>
<div class="cl-body">

- **Partition by what queries filter on and what the lifecycle acts on.** Usually a date, which is also the unit you [replace on rerun](/blog/2026-08-19-idempotent-writes-and-why-retries-duplicate-data/) and expire on retention.
- **Low cardinality.** Hundreds to low thousands of partitions, not millions. Never a customer ID.
- **Big partitions.** Aim for each partition to hold at least around 1 GB. [Databricks' guidance](https://docs.databricks.com/en/tables/partitions.html) is not to partition tables under about 1 TB at all and to rely on file-level skipping instead.
- **Coarser beats finer.** Daily is usually right, hourly rarely is, and a `date + country + channel` combination almost never is.

</div>
</div>

Over-partitioning is the most common way teams turn pruning into a problem. Partitioning a 50 GB table by `date` and `store_id` with 400 stores gives 146,000 partitions a year averaging 340 KB each. Every query has to plan over a huge partition list, and every write produces hundreds of [tiny files](/blog/2026-10-07-the-small-files-problem/).

## Inside the partition: data skipping

Partitions get you to the right day. Within the day, Delta's **data skipping** gets you to the right files, using min/max statistics recorded for each file in the transaction log. A query for `store_id = 412` skips every file whose `store_id` range doesn't include 412.

Two things decide whether data skipping helps:

- **Which columns have statistics.** By default Delta [collects them](https://docs.delta.io/latest/optimizations-oss.html) for the first 32 columns of the schema (`delta.dataSkippingNumIndexedCols`). A filter column in position 47 has no stats and can't be used for skipping. Move commonly filtered columns towards the front, or name them explicitly with `delta.dataSkippingStatsColumns` on runtimes that support it.
- **Whether the data is clustered.** If every file contains every store, every file's range is `[1, 900]` and nothing is skipped. Clustering the data with `OPTIMIZE ... ZORDER BY (store_id)` or liquid clustering (`CLUSTER BY`) where your runtime supports it gives each file a narrow range and makes the statistics useful.

Data skipping also depends on how the predicate is written. `store_id = 412` and `amount > 1000` can be compared with min/max stats. `date_format(sale_ts, 'yyyy-MM') = '2026-10'` generally can't, so write the range directly: `sale_ts >= '2026-10-01' AND sale_ts < '2026-11-01'`.

## On Monday

- For your ten most-queried large tables, run the common filter through `explain()` and check `PartitionFilters`.
- Search report and notebook code for filters on timestamp columns where the table is partitioned by a derived date.
- Make derived partition columns generated columns on new Delta tables.
- Find tables with more than about 10,000 partitions or an average partition under 100 MB. Those are over-partitioned.
- Check that the columns people filter on are within the first 32, or explicitly indexed.

Pruning is the rare optimisation that gets *more* valuable over time. A query that reads one day out of 540 costs the same on day 540 as on day one.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 7 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-08-19-idempotent-writes-and-why-retries-duplicate-data/">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-08-26-the-grain-of-a-table/">The grain of a table</a></li>
<li><a href="/blog/2026-09-02-event-time-vs-processing-time/">Event time vs processing time</a></li>
<li><a href="/blog/2026-09-09-late-arriving-data/">Late-arriving data</a></li>
<li><a href="/blog/2026-09-16-data-skew-in-spark/">Data skew</a></li>
<li><a href="/blog/2026-09-23-reading-a-spark-query-plan/">Reading a Spark query plan</a></li>
<li class="on">Partition pruning</li>
<li><a href="/blog/2026-10-07-the-small-files-problem/">The small files problem</a></li>
<li><a href="/blog/2026-10-14-slowly-changing-dimensions/">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution/">Schema evolution</a></li>
</ol>
</nav>
