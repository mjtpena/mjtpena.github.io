---
title: "The Small Files Problem: How Tables End Up With Two Million Files"
author: Michael John Peña
draft: false
date: 2026-10-21T12:07:00Z
description: "Small files come from simple arithmetic, and every reader pays a cost per file. Where they come from, how to measure them, and how to compact them safely."
tags:
  - Data Engineering
  - Spark
  - Delta Lake
  - Performance
  - Microsoft Fabric
---

A query on a 200 GB table spends nine minutes before its first task starts. The Spark UI shows nothing running, and the driver is busy listing and planning. The table has 2.1 million files with an average size of 95 KB.

Nobody chose that layout. It came from a streaming job that was set up correctly, a partitioning scheme that seemed reasonable, and two years of operation. Small files are what you get by default when nothing prevents them, and the cost lands on every reader rather than the writer that created them.

## Why every file costs something

Reading 10 GB as 40 files and reading 10 GB as 23,000 files both move 10 GB of data, but the second does far more work on top of that:

- **Listing and metadata.** Object storage lists in pages, so more files means more round trips. Delta records every file as an `add` action in the transaction log, which makes the log and its checkpoints bigger and slows down planning for every query.
- **Opening files.** Each file needs a request, a footer read to get the Parquet schema and statistics, and then the actual data reads. With small files the fixed per-file cost is larger than the cost of the data itself.
- **Scheduling.** Spark packs files into read tasks up to `spark.sql.files.maxPartitionBytes` (128 MB), but counts every file as at least [`spark.sql.files.openCostInBytes`](https://spark.apache.org/docs/latest/sql-performance-tuning.html) (4 MB). Ten GB in 23,040 files of 434 KB is treated as about 100 GB of work, roughly 800 tasks instead of 80.
- **Worse compression and skipping.** Columnar encoding and compression work better on large row groups. Tiny files contain tiny row groups, so their min/max statistics cover little data each, and checking them all adds overhead instead of saving it.
- **Downstream engines.** SQL endpoints and BI engines that read the same Delta tables pay these costs too. Fabric's [Direct Lake](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-overview) mode, for example, has limits on Parquet files and row groups per table, and exceeding them causes queries to fall back to slower modes.

## Where they come from: arithmetic

The number of files a write produces is roughly:

> **files per write ≈ write tasks × partitions each task writes to**

Multiply by how often the job writes and you get the growth rate. Most small-file problems come from a calculation like this one, which nobody actually did:

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 300" role="img" aria-label="A streaming job writes every 30 seconds, which is 2,880 micro-batches a day. Each batch has 8 write tasks writing into one date partition, giving 23,040 files a day of about 434 kilobytes each for 10 gigabytes of daily data. Below, two bars compare the same 10 gigabytes stored as 23,040 small files versus 40 files of 256 megabytes.">
<defs>
<pattern id="sfStripe" width="4" height="22" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="2" height="22" fill="#e0554a" opacity="0.8"/></pattern>
</defs>
<rect x="20" y="20" width="860" height="122" rx="16" class="ff-zone ff-zone-flow"/>
<text x="40" y="42" class="ff-zlabel">ONE STREAMING JOB · A REASONABLE CONFIG</text>
<rect x="40" y="58" width="170" height="64" rx="11" class="ff-node"/>
<text x="125" y="86" text-anchor="middle" class="ff-title">2,880 batches</text>
<text x="125" y="105" text-anchor="middle" class="ff-sub">every 30 s, all day</text>
<text x="225" y="96" text-anchor="middle" class="ff-title">×</text>
<rect x="240" y="58" width="150" height="64" rx="11" class="ff-node"/>
<text x="315" y="86" text-anchor="middle" class="ff-title">8 write tasks</text>
<text x="315" y="105" text-anchor="middle" class="ff-sub">per batch</text>
<text x="405" y="96" text-anchor="middle" class="ff-title">×</text>
<rect x="420" y="58" width="150" height="64" rx="11" class="ff-node"/>
<text x="495" y="86" text-anchor="middle" class="ff-title">1 partition</text>
<text x="495" y="105" text-anchor="middle" class="ff-sub">today's date</text>
<text x="585" y="96" text-anchor="middle" class="ff-title">=</text>
<rect x="600" y="58" width="260" height="64" rx="11" class="ff-node ff-node-dn"/>
<text x="730" y="86" text-anchor="middle" class="ff-title">23,040 files / day</text>
<text x="730" y="105" text-anchor="middle" class="ff-tok ff-amt">≈ 434 KB each at 10 GB/day</text>
<rect x="20" y="158" width="860" height="128" rx="16" class="ff-zone ff-zone-neutral"/>
<text x="40" y="180" class="ff-zlabel">THE SAME 10 GB, TWO LAYOUTS</text>
<text x="60" y="202" class="ff-sub">23,040 files × 434 KB · ~800 read tasks · per-file overhead dominates</text>
<rect x="60" y="208" width="780" height="22" rx="4" fill="url(#sfStripe)"/>
<text x="60" y="252" class="ff-sub">40 files × 256 MB · ~80 read tasks · time spent reading data</text>
<g fill="#00B7C3" opacity="0.8">
<rect x="60" y="258" width="18.5" height="22" rx="2"/><rect x="79.5" y="258" width="18.5" height="22" rx="2"/><rect x="99" y="258" width="18.5" height="22" rx="2"/><rect x="118.5" y="258" width="18.5" height="22" rx="2"/><rect x="138" y="258" width="18.5" height="22" rx="2"/><rect x="157.5" y="258" width="18.5" height="22" rx="2"/><rect x="177" y="258" width="18.5" height="22" rx="2"/><rect x="196.5" y="258" width="18.5" height="22" rx="2"/><rect x="216" y="258" width="18.5" height="22" rx="2"/><rect x="235.5" y="258" width="18.5" height="22" rx="2"/>
<rect x="255" y="258" width="18.5" height="22" rx="2"/><rect x="274.5" y="258" width="18.5" height="22" rx="2"/><rect x="294" y="258" width="18.5" height="22" rx="2"/><rect x="313.5" y="258" width="18.5" height="22" rx="2"/><rect x="333" y="258" width="18.5" height="22" rx="2"/><rect x="352.5" y="258" width="18.5" height="22" rx="2"/><rect x="372" y="258" width="18.5" height="22" rx="2"/><rect x="391.5" y="258" width="18.5" height="22" rx="2"/><rect x="411" y="258" width="18.5" height="22" rx="2"/><rect x="430.5" y="258" width="18.5" height="22" rx="2"/>
<rect x="450" y="258" width="18.5" height="22" rx="2"/><rect x="469.5" y="258" width="18.5" height="22" rx="2"/><rect x="489" y="258" width="18.5" height="22" rx="2"/><rect x="508.5" y="258" width="18.5" height="22" rx="2"/><rect x="528" y="258" width="18.5" height="22" rx="2"/><rect x="547.5" y="258" width="18.5" height="22" rx="2"/><rect x="567" y="258" width="18.5" height="22" rx="2"/><rect x="586.5" y="258" width="18.5" height="22" rx="2"/><rect x="606" y="258" width="18.5" height="22" rx="2"/><rect x="625.5" y="258" width="18.5" height="22" rx="2"/>
<rect x="645" y="258" width="18.5" height="22" rx="2"/><rect x="664.5" y="258" width="18.5" height="22" rx="2"/><rect x="684" y="258" width="18.5" height="22" rx="2"/><rect x="703.5" y="258" width="18.5" height="22" rx="2"/><rect x="723" y="258" width="18.5" height="22" rx="2"/><rect x="742.5" y="258" width="18.5" height="22" rx="2"/><rect x="762" y="258" width="18.5" height="22" rx="2"/><rect x="781.5" y="258" width="18.5" height="22" rx="2"/><rect x="801" y="258" width="18.5" height="22" rx="2"/><rect x="820.5" y="258" width="18.5" height="22" rx="2"/>
</g>
</svg>
<figcaption><b>Each factor is reasonable on its own.</b> Thirty-second batches, eight tasks, and daily partitions are all normal settings. Together they produce 8.4 million files a year from a single table.</figcaption>
</figure>

Other common sources:

- **Shuffle partitions × date partitions.** A backfill of 30 days through a 200-partition shuffle followed by `write.partitionBy("sale_date")` can produce up to 6,000 files, because every task may hold rows for every date.
- **Over-partitioning.** Partitioning by `date + store_id` multiplies the files per write by the number of stores. The [partition pruning post](/blog/2026-10-21-partition-pruning/) covers choosing partition columns.
- **Frequent small `MERGE`s.** A `MERGE` rewrites every file that contains a matched row. A CDC feed merging a few hundred rows every minute rewrites files constantly and leaves the replacements fragmented.
- **Trickle inserts.** Applications inserting rows one batch at a time through a SQL endpoint or JDBC, with each insert its own commit and its own file.
- **The landing zone itself.** APIs and IoT devices that drop one small JSON file per call or per device per minute.

## Measure it

Delta reports file count and size per table:

<div class="code-title">ops/file_health.py</div>

```python
from pyspark.sql import functions as F

def table_file_health(spark, table: str):
    d = spark.sql(f"DESCRIBE DETAIL {table}").select("numFiles", "sizeInBytes").first()
    avg_mb = d.sizeInBytes / max(d.numFiles, 1) / 1024**2
    return {"table": table, "files": d.numFiles, "avg_mb": round(avg_mb, 1)}

def partition_file_health(spark, table: str, part_col: str, where: str = "true"):
    return (spark.read.table(table).where(where)
            .select(part_col, "_metadata.file_path", "_metadata.file_size")
            .distinct()
            .groupBy(part_col)
            .agg(F.count("*").alias("files"),
                 F.round(F.avg("file_size") / 1024**2, 2).alias("avg_mb"))
            .orderBy(F.desc("files")))
```

`DESCRIBE DETAIL` reads only the log, so it's cheap enough to run across every table each night. The partition-level view reads the data, so restrict it with a `where`. Two thresholds are a good place to start for alerts: **average file size under 32 MB** on any table over 10 GB, and **any partition with more than 1,000 files**.

## Stop creating them

### Shape the data before the write

If each task writes rows for only one partition, you get one file per partition per write:

```python
(df.repartition("sale_date")
   .write.format("delta").mode("append")
   .partitionBy("sale_date")
   .saveAsTable("silver.sales"))
```

This has a known failure mode: one very large date ends up in one task, which writes one huge file slowly. That's [skew on write](/blog/2026-10-21-data-skew-in-spark/). Add a bounded salt (`repartition("sale_date", pmod(xxhash64("sale_id"), 8))`) so large partitions are split across a fixed number of files, or cap file size with `spark.sql.files.maxRecordsPerFile`.

### Let the engine bin-pack: optimized write

Delta on Databricks and Fabric (and open-source Delta from 3.1) can add an adaptive shuffle before the write that groups rows by partition and targets a sensible file size. It costs a shuffle at write time and saves a compaction later:

```sql
ALTER TABLE silver.sales SET TBLPROPERTIES ('delta.autoOptimize.optimizeWrite' = 'true');
```

This suits partitioned tables, streaming sinks, and `MERGE` targets. It isn't worth it for jobs that already write a few large files.

### Write less often

A dashboard refreshed every 15 minutes doesn't need a stream committing every 10 seconds. Run the stream with `trigger(availableNow=True)` on a schedule, or set `trigger(processingTime="5 minutes")`. The latency is still well within what the consumer needs, and you produce 30 times fewer files.

## Fix the ones you have: compaction

[`OPTIMIZE`](https://docs.delta.io/latest/optimizations-oss.html) rewrites small files in a partition into fewer large ones, as a normal Delta commit. Readers see the old files until the commit and the new files after it, and the data doesn't change.

<div class="code-title">ops/nightly_compaction.sql</div>

```sql
-- Compact only recent partitions: older ones were compacted on earlier nights
OPTIMIZE silver.sales
WHERE sale_date >= date_sub(current_date(), 3);

-- Optional: cluster within files so data skipping has narrow ranges to work with
OPTIMIZE silver.sales
WHERE sale_date >= date_sub(current_date(), 3)
ZORDER BY (store_id);
```

`WHERE` in `OPTIMIZE` only accepts partition-column predicates, and scoping it is what keeps compaction cheap. Running it unscoped on a table with years of history means rewriting partitions that are already fine. For tables written frequently, **auto compaction** (`delta.autoOptimize.autoCompact = true`) runs a small compaction after writes so you don't need a scheduled job. On Fabric, `OPTIMIZE` can also apply [V-Order](https://learn.microsoft.com/en-us/fabric/data-engineering/delta-optimization-and-v-order), which reorganises row groups for faster reads by Fabric's engines.

<div class="cl cl-warn">
<div class="cl-tag">Storage and time travel</div>
<div class="cl-body">

`OPTIMIZE` doesn't delete anything. The small files remain, marked as removed in the log, so that time travel and in-progress readers still work. Storage temporarily roughly doubles for compacted partitions until [`VACUUM`](https://docs.delta.io/latest/delta-utility.html) deletes files older than the retention period (7 days by default). Don't "fix" the bill by vacuuming with zero retention. Delta blocks retention under 168 hours unless you disable the safety check, and if you do, you break time travel and can delete files that a running query is still reading.

</div>
</div>

## What size to aim for

There's no single right size, but there's a reasonable range:

| Table pattern | Target file size | Why |
|---|---|---|
| Append-mostly, scan-heavy (facts, events) | 256 MB – 1 GB | Fewer files, better compression, fewer tasks |
| Frequently `MERGE`d (CDC targets, dimensions) | 32 – 128 MB | A `MERGE` rewrites whole files, so smaller files mean less rewrite per change |
| Small tables (< 1 GB total) | A handful of files | Partitioning a small table only creates small files |

The open-source `OPTIMIZE` default maximum file size is 1 GB (`spark.databricks.delta.optimize.maxFileSize`). Managed runtimes may tune the target automatically based on table size and write pattern. If you override it, have a reason, and the table above gives you some.

## On Monday

- Run `table_file_health` across every Delta table and sort by file count.
- For the worst five, work out which arithmetic created them: frequency, tasks, partitions, merges.
- Enable optimized write on streaming sinks and `MERGE` targets.
- Schedule `OPTIMIZE` scoped to recent partitions, and a `VACUUM` with the default retention.
- Question every streaming trigger under one minute. Ask who needs the data that quickly.

Small files are a slow-building problem in the opposite direction to most failures. The writer that creates them never notices anything wrong, and the readers end up paying for it.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 8 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data/">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-10-21-the-grain-of-a-table/">The grain of a table</a></li>
<li><a href="/blog/2026-10-21-event-time-vs-processing-time/">Event time vs processing time</a></li>
<li><a href="/blog/2026-10-21-late-arriving-data/">Late-arriving data</a></li>
<li><a href="/blog/2026-10-21-data-skew-in-spark/">Data skew</a></li>
<li><a href="/blog/2026-10-21-reading-a-spark-query-plan/">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-10-21-partition-pruning/">Partition pruning</a></li>
<li class="on">The small files problem</li>
<li><a href="/blog/2026-10-21-slowly-changing-dimensions/">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution/">Schema evolution</a></li>
</ol>
</nav>
