---
title: "Data Skew: Why 199 Tasks Finish in Seconds and One Takes an Hour"
author: Michael John Peña
draft: false
date: 2026-10-21T12:04:00Z
description: "A shuffle sends every row with the same key to the same task. When one key holds a third of the data, one task does a third of the work, and adding nodes doesn't help. How to spot skew in the Spark UI, find the guilty keys, and fix it: null handling, broadcast, AQE skew joins, and salting done properly."
tags:
  - Data Engineering
  - Spark
  - Performance
  - Delta Lake
  - Microsoft Fabric
---

A job that has run in twelve minutes every night for a year is at hour three. The Spark UI shows the stage at 199 of 200 tasks complete. The executors are idle except one core, which has been reading shuffle data for 140 minutes. Someone doubles the cluster size and reruns. It still takes three hours, now on twice as many idle machines.

That's **data skew**. More hardware doesn't fix it, because the problem isn't capacity. Most of the work has been given to a single task.

## Why one task gets everything

Any operation that has to bring matching rows together, such as a join, a `groupBy`, a window with `partitionBy`, or `distinct`, triggers a **shuffle**. Spark hashes the key of each row and sends it to partition `hash(key) mod N`. That's how every row for `customer_id = 42` ends up in the same task and can be joined or aggregated there.

It also means every row for one *very common* key ends up in the same task. If 31% of the rows have `customer_id IS NULL`, one task processes 31% of the dataset while 199 others share the remaining 69%. A stage finishes when its slowest task finishes.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 300" role="img" aria-label="Bar chart of task durations for one Spark stage. Thirty-nine bars are short, around eight seconds each. One bar is far taller, at forty-one minutes, for the task that received all rows with a null key and read 6.1 gigabytes of shuffle data.">
<text x="60" y="36" class="ff-zlabel">STAGE 14 · TASK DURATION · 40 OF 200 TASKS SHOWN</text>
<line x1="60" y1="228" x2="860" y2="228" class="ff-edge-dash"/>
<text x="860" y="222" text-anchor="end" class="ff-sub">median ≈ 8 s</text>
<g fill="#00B7C3" opacity="0.75">
<rect x="62" y="231" width="14" height="9" rx="2"/><rect x="82" y="233" width="14" height="7" rx="2"/><rect x="102" y="229" width="14" height="11" rx="2"/><rect x="122" y="232" width="14" height="8" rx="2"/><rect x="142" y="230" width="14" height="10" rx="2"/><rect x="162" y="234" width="14" height="6" rx="2"/><rect x="182" y="228" width="14" height="12" rx="2"/><rect x="202" y="231" width="14" height="9" rx="2"/><rect x="222" y="232" width="14" height="8" rx="2"/><rect x="242" y="233" width="14" height="7" rx="2"/>
<rect x="262" y="230" width="14" height="10" rx="2"/><rect x="282" y="227" width="14" height="13" rx="2"/><rect x="302" y="232" width="14" height="8" rx="2"/><rect x="322" y="231" width="14" height="9" rx="2"/><rect x="342" y="233" width="14" height="7" rx="2"/><rect x="362" y="229" width="14" height="11" rx="2"/><rect x="382" y="231" width="14" height="9" rx="2"/><rect x="402" y="232" width="14" height="8" rx="2"/><rect x="422" y="230" width="14" height="10" rx="2"/><rect x="442" y="228" width="14" height="12" rx="2"/>
<rect x="462" y="233" width="14" height="7" rx="2"/><rect x="482" y="231" width="14" height="9" rx="2"/><rect x="502" y="232" width="14" height="8" rx="2"/><rect x="522" y="229" width="14" height="11" rx="2"/><rect x="542" y="230" width="14" height="10" rx="2"/><rect x="562" y="231" width="14" height="9" rx="2"/><rect x="582" y="232" width="14" height="8" rx="2"/>
<rect x="622" y="231" width="14" height="9" rx="2"/><rect x="642" y="233" width="14" height="7" rx="2"/><rect x="662" y="230" width="14" height="10" rx="2"/><rect x="682" y="232" width="14" height="8" rx="2"/><rect x="702" y="228" width="14" height="12" rx="2"/><rect x="722" y="231" width="14" height="9" rx="2"/><rect x="742" y="229" width="14" height="11" rx="2"/><rect x="762" y="232" width="14" height="8" rx="2"/><rect x="782" y="233" width="14" height="7" rx="2"/><rect x="802" y="230" width="14" height="10" rx="2"/><rect x="822" y="231" width="14" height="9" rx="2"/><rect x="842" y="232" width="14" height="8" rx="2"/>
</g>
<rect x="602" y="56" width="14" height="184" rx="2" fill="#e0554a"/>
<line x1="60" y1="240" x2="860" y2="240" class="ff-edge"/>
<text x="590" y="68" text-anchor="end" class="ff-elabel" style="fill:#e0554a">task 137 · 41 min · 6.1 GB shuffle read</text>
<text x="590" y="86" text-anchor="end" class="ff-sub">key = NULL (orders with no customer_id)</text>
<text x="590" y="104" text-anchor="end" class="ff-sub">spilled 18 GB to disk</text>
<text x="60" y="268" class="ff-sub">The stage finishes when its slowest task does. 199 tasks finish in seconds; then 199 cores sit idle while one does 31% of the work.</text>
<text x="60" y="286" class="ff-sub">Doubling the cluster adds more idle cores. It doesn't split task 137.</text>
</svg>
<figcaption><b>What skew looks like.</b> A healthy stage has task durations within a small multiple of each other. A skewed stage has one or a few outliers that run orders of magnitude longer, because the shuffle sent them every row for a hot key.</figcaption>
</figure>

Skew belongs to the data *and the operation* together. The same table can be perfectly balanced when grouped by `order_id` and badly skewed when joined on `customer_id`. That's why a job can run fine for a year and then stop: the code didn't change, but the distribution of one key did.

## Where hot keys come from

There aren't many sources, and they repeat across most pipelines:

- **Nulls and sentinel values.** `NULL`, `''`, `'UNKNOWN'`, `-1`, `0`, `'N/A'`. Every row the source system didn't fill in shares one key. This is the most common cause by a long way.
- **Power-law entities.** The largest customer, the most popular product, one enormous tenant in a multi-tenant system, the "anonymous" user.
- **Bots and test traffic.** One crawler user agent or one load-test account generating millions of events.
- **Time.** Black Friday, a month-end batch, the day a backfill landed. Shuffling by date puts all of them in one task.
- **Upstream changes.** A source starts defaulting a field to `'DEFAULT'` instead of leaving it null, and a balanced key becomes a skewed one overnight.

## Diagnose: the UI first, then the keys

**In the Spark UI**, open the slow stage and look at *Summary Metrics for Completed Tasks*. Compare **Max** with **Median** for *Duration* and *Shuffle Read Size / Records*.

| Signal | Healthy | Skewed |
|---|---|---|
| Max ÷ median task duration | 1–3× | 10× or more, often 100×+ |
| Max ÷ median shuffle read size | 1–3× | The same outlier task reads GBs while the median reads MBs |
| Spill (memory and disk) | None, or spread evenly | Concentrated in the outlier task |

Duration and shuffle read have to point at the same task. If one task is slow but read about as much as the others, it isn't skew: look at the executor it ran on for a slow node, GC pressure, or a bad disk.

**Then find the keys.** Group by the shuffle key and look at the head of the distribution:

<div class="code-title">diagnose/top_keys.py</div>

```python
from pyspark.sql import functions as F

def top_keys(df, key: str, n: int = 10):
    total = df.count()
    return (df.groupBy(key).count()
              .withColumn("pct", F.round(100 * F.col("count") / total, 2))
              .orderBy(F.desc("count"))
              .limit(n))

top_keys(orders, "customer_id").show(truncate=False)
```

```text
+------------+--------+-----+
|customer_id |count   |pct  |
+------------+--------+-----+
|NULL        |61204411|31.4 |
|C-0000001   | 8190023| 4.2 |
|C-0731245   |  402117| 0.21|
|C-0012987   |  398803| 0.2 |
...
```

That's two problems: a null key and one very large customer. They need different fixes.

## Fixes, cheapest first

### 1. Stop shuffling the nulls

In an inner join, a `NULL` key never matches anything, because `NULL = NULL` is not true. Those 61 million rows get shuffled into one task only to be thrown away. Filter them out before the join:

```python
joined = orders.where(F.col("customer_id").isNotNull()).join(customers, "customer_id")
```

For a left join, where the null rows need to be kept, split the data, join only the keyed part, and union the rest back:

<div class="code-title">fix/split_nulls.py</div>

```python
keyed   = orders.where(F.col("customer_id").isNotNull())
unkeyed = orders.where(F.col("customer_id").isNull())

joined = keyed.join(customers, "customer_id", "left").unionByName(
    unkeyed.select(*keyed.columns, *[F.lit(None).cast(c.dataType).alias(c.name)
                                     for c in customers.schema
                                     if c.name != "customer_id"]),
)
```

Do the same for sentinel values like `'UNKNOWN'` and `-1`. They behave like real keys, so they *do* match. If they match a dimension row, that's one row broadcast to millions, which is cheap if you handle it separately and expensive if it goes through a shuffle.

### 2. Don't shuffle at all: broadcast the small side

If the other side of the join is small, broadcasting it sends a full copy to every executor. There's no shuffle, so the big side keeps its existing distribution and skew stops mattering. Spark does this automatically below `spark.sql.autoBroadcastJoinThreshold` (10 MB by default). Above that, you can ask for it:

```python
from pyspark.sql.functions import broadcast
joined = orders.join(broadcast(customers), "customer_id")
```

Broadcast is appropriate for tens to a few hundred MB, the typical dimension table. Beyond that, the driver has to collect the table and every executor has to hold it in memory, and the failure moves from slow to out of memory.

### 3. Let AQE split the skewed partition

With adaptive query execution (on by default since Spark 3.2, and enabled in Fabric and Databricks runtimes), Spark looks at actual shuffle partition sizes at runtime. When a partition is larger than both `skewedPartitionFactor` × the median (default 5) **and** `skewedPartitionThresholdInBytes` (default 256 MB), it splits that partition into pieces and duplicates the matching partition from the other side for each piece.

<div class="code-title">spark-defaults (the relevant knobs)</div>

```properties
spark.sql.adaptive.enabled                                  true
spark.sql.adaptive.skewJoin.enabled                         true
spark.sql.adaptive.skewJoin.skewedPartitionFactor           5
spark.sql.adaptive.skewJoin.skewedPartitionThresholdInBytes 256MB
spark.sql.adaptive.advisoryPartitionSizeInBytes             64MB
```

Confirm it fired. The join node in the final adaptive plan, or in the SQL tab of the UI, shows `SortMergeJoin(skew=true)`. If it doesn't, the usual reasons are:

- **It isn't a join.** AQE's skew handling covers sort-merge joins (and shuffled hash joins in recent Spark versions). It doesn't split skewed `groupBy`, window, or `distinct` partitions.
- **The skew is below the thresholds.** A 200 MB hot partition next to a 2 MB median is 100× skew, but it's under the 256 MB floor. Lower the threshold for that job.
- **The skewed side can't be split for that join type.** For example, the outer side of an outer join can't always be split safely.

### 4. Salt the hot keys

When AQE can't help, as with aggregations, windows, or joins it won't split, you spread the hot key yourself. **Salting** adds a second key component so that one logical key maps to *N* physical partitions.

For a join, salt the big side and replicate the matching rows of the small side once per salt. Only do it for the hot keys, so that the small side grows by *N* rows per hot key instead of *N*×:

<div class="code-title">fix/salted_join.py</div>

```python
from pyspark.sql import functions as F

SALTS = 32
HOT = ["C-0000001"]                       # from top_keys()
is_hot = F.col("customer_id").isin(HOT)

big = orders.withColumn(
    "salt",
    F.when(is_hot, F.pmod(F.xxhash64("order_id"), F.lit(SALTS))).otherwise(F.lit(0)))

small = (customers
    .withColumn("salts", F.when(is_hot, F.sequence(F.lit(0), F.lit(SALTS - 1)))
                          .otherwise(F.array(F.lit(0))))
    .withColumn("salt", F.explode("salts"))
    .drop("salts"))

joined = big.join(small, ["customer_id", "salt"]).drop("salt")
```

The salt comes from a hash of `order_id`, not from `rand()`. A hash gives the same salt for the same row on every retry, so a recomputed task reproduces exactly what it did the first time.

For an aggregation, salt and aggregate twice: once by `(key, salt)` to split the work, and again by `key` to combine the results. This needs some care with non-additive measures. A distinct count is only exact if you salt **by the column being counted**, because then each value falls in exactly one salt bucket and the per-bucket counts can be added:

<div class="code-title">fix/two_stage_distinct.py</div>

```python
partial = (events
    .withColumn("salt", F.pmod(F.xxhash64("session_id"), F.lit(32)))   # salt BY the distinct column
    .groupBy("user_agent", "salt")
    .agg(F.countDistinct("session_id").alias("sessions"),
         F.count("*").alias("events")))

result = (partial.groupBy("user_agent")
    .agg(F.sum("sessions").alias("sessions"),      # exact: buckets are disjoint
         F.sum("events").alias("events")))
```

If you salt by something else, the same session can appear in several buckets and summing overcounts. The [grain](/blog/2026-10-21-the-grain-of-a-table) problem from earlier in the series turns up again, this time inside a performance fix.

<div class="cl cl-note">
<div class="cl-tag">Note</div>
<div class="cl-body">

Plain `sum` and `count` aggregations are less sensitive to skew than they look, because Spark does a partial aggregation on the map side before the shuffle. The hot key arrives at its task already reduced to one partial row per input partition. The operations that really suffer are the ones that can't pre-aggregate: `collect_list`, `countDistinct`, `percentile`, and window functions partitioned by the hot key.

</div>
</div>

## Skew on write

Skew also appears when *writing*. `df.write.partitionBy("country")` after a `repartition("country")` gives the US partition one task writing a 40 GB file while Luxembourg's task writes 2 MB. Repartition by the partition column **plus** a bounded salt so large partitions are written by several tasks:

```python
(df.repartition("country", F.pmod(F.xxhash64("order_id"), F.lit(8)))
   .write.partitionBy("country").format("delta").saveAsTable("silver.orders"))
```

The opposite mistake, too many tasks writing into each partition, is the [small files problem](/blog/2026-10-21-the-small-files-problem).

## On Monday

- For your three slowest jobs, open the slowest stage and compare max and median task duration and shuffle read.
- Run `top_keys` on every join and grouping key in those stages.
- Filter null keys before inner joins. This is often the whole fix.
- Check that AQE is on and that skewed joins show `skew=true` in the final plan.
- Write down the hot keys you salt for, and alert when the top key's share moves. New skew usually starts with a change upstream.

To confirm which joins, shuffles, and partitions a job is actually running, you need the query plan. That's the next post.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 5 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-10-21-the-grain-of-a-table">The grain of a table</a></li>
<li><a href="/blog/2026-10-21-event-time-vs-processing-time">Event time vs processing time</a></li>
<li><a href="/blog/2026-10-21-late-arriving-data">Late-arriving data</a></li>
<li class="on">Data skew</li>
<li><a href="/blog/2026-10-21-reading-a-spark-query-plan">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-10-21-partition-pruning">Partition pruning</a></li>
<li><a href="/blog/2026-10-21-the-small-files-problem">The small files problem</a></li>
<li><a href="/blog/2026-10-21-slowly-changing-dimensions">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution">Schema evolution</a></li>
</ol>
</nav>
