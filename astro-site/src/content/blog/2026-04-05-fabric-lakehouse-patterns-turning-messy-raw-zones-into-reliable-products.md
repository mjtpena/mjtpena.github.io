---
title: "When a Slow Fabric Lakehouse Is Really a Raw Zone Problem"
description: "Why slow Fabric silver loads often trace back to the raw zone: landing layout, header checks, small files and bronze table maintenance, with PySpark examples."
author: Michael John Peña
draft: false
date: 2026-04-05
tags:
  - Microsoft Fabric
  - Lakehouse
  - Delta Lake
  - Data Engineering
  - Performance
---

When a silver notebook is slow, the cause usually isn't Spark tuning. It's the raw zone: files landed wherever the copy tool put them, a bronze table made of tens of thousands of tiny files, and a silver load that pays per-file overhead on every read. The Delta log and its checkpoint grow with every tiny commit, so there's more to replay, and the planner has thousands of files to list and consider, even when file statistics prune most of them. Bigger capacity hides that for a while. Fixing the shape of the raw zone fixes it for good, and the same boundaries catch bad data earlier.

This post is about the physical side of the raw zone: where files land, how bronze reads them, and how bronze tables stay healthy. The contract side (what silver promises and how it quarantines bad rows) is in [Table Contracts in a Fabric Lakehouse](/blog/2026-03-03-lakehouse-decisions-i-made-this-week-turning-messy-raw-zones-into-reliable-products/), and I won't repeat it here.

## Three raw-zone problems that show up downstream

The symptoms vary, but the causes are usually one of three. Two make silver slow; one makes it wrong:

| Cause | What you see | Where the fix belongs |
|---|---|---|
| Landing folders with no batch boundary | Each load lists the whole folder tree and filters by modified date | Landing layout |
| Positional reads of headed files | Not a slowdown but a silent correctness failure: columns swap when the source reorders them, the load succeeds, and silver "fixes" it with more logic | The read into bronze |
| Bronze tables that are never compacted | Thousands of files under a few MB; every incremental read pays the overhead | Table maintenance |

None of these is solved by a faster Spark pool. All three are decisions someone made, or didn't make, when the first feed went live.

## Give every batch its own folder

The `Files` area of a lakehouse is just a folder tree in OneLake, so it'll take whatever structure you give it. My convention is one folder per source, entity and batch:

`Files/landing/<source>/<entity>/batch_id=<batch-id>/`

The pipeline that copies data in creates the batch ID and writes into that folder, and nothing else ever writes there. That gives you three things for free. The bronze load reads one folder instead of listing everything and filtering by date. A rerun reads exactly the same files, so it produces exactly the same result. And when someone asks "what did the source send on Tuesday?", the answer is a folder, not a forensic exercise.

I avoid date-only folders (`/2026/04/05/`) as the lowest level. Two runs on the same day end up mixed, and a late rerun overwrites or duplicates the morning's files depending on how the copy activity is configured. A date can be part of the batch ID if people like reading it; the batch is still the boundary.

If the landing area is a shortcut to storage another team owns, the same rule needs to hold on their side: files written once, never edited in place. A shortcut points at whatever is there now, so a source system that rewrites yesterday's file also rewrites your evidence.

## Check the header, don't trust position

The more expensive raw-zone problem isn't slowness, it's being quietly wrong. The classic one is a CSV feed whose columns get reordered upstream. With an explicit schema, Spark's CSV reader applies it by position by default and ignores the header, so `order_total` and `currency` swap places and the load succeeds.

The [Spark CSV options](https://spark.apache.org/docs/3.5.0/sql-data-sources-csv.html) include `enforceSchema`, which defaults to `true`. Set it to `false` with `header` on, and Spark still reads by position, but first checks each header name against the schema field in that position (case-insensitively, unless `spark.sql.caseSensitive` is on) and fails the read on a mismatch. It costs one option and fires at the boundary instead of three layers later. Pair it with a `_corrupt_record` column in permissive mode, so rows Spark can't parse are kept with their original text instead of being silently dropped or nulled. With an all-string schema, that column only catches structural failures, mainly rows with the wrong number of columns (some quoting errors show up this way too); a bad value in a well-formed row passes straight through, so don't expect it to catch type or content problems at bronze.

This runs in a Fabric notebook on Runtime 1.3 (Spark 3.5, Delta Lake 3.2), attached to a schema-enabled lakehouse, with the pipeline passing in the batch ID:

```python
import re

from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType

batch_id = "<batch-id>"  # notebook parameter, set by the pipeline

# The batch ID goes into a replaceWhere predicate below, so reject anything unexpected.
if not re.fullmatch(r"[A-Za-z0-9_-]+", batch_id):
    raise ValueError(f"invalid batch_id: {batch_id!r}")

landing_path = f"Files/landing/erp/orders/batch_id={batch_id}/"
target = "bronze.erp_orders_raw"

# Fail fast if the copy step didn't deliver anything for this batch.
# fs.ls throws if the folder is missing, so check it exists first.
landed = []
if notebookutils.fs.exists(landing_path):
    landed = [f for f in notebookutils.fs.ls(landing_path) if f.name.endswith(".csv")]
if not landed:
    raise ValueError(f"Batch {batch_id}: no CSV files in {landing_path}. Bronze not updated.")

columns = ["order_id", "customer_id", "order_date", "order_total", "currency", "source_updated_at"]
schema = StructType(
    [StructField(c, StringType(), True) for c in columns]
    + [StructField("_corrupt_record", StringType(), True)]
)

batch = (
    spark.read.format("csv")
    .option("header", "true")
    .option("enforceSchema", "false")  # header names must match the schema, position by position, or the read fails
    .option("pathGlobFilter", "*.csv")  # skip manifests and other non-CSV files, matching the check above
    .option("mode", "PERMISSIVE")
    .option("columnNameOfCorruptRecord", "_corrupt_record")
    .schema(schema)
    .load(landing_path)
    .withColumn("_source_file", F.col("_metadata.file_path"))
    .withColumn("_loaded_at", F.current_timestamp())
    .withColumn("_batch_id", F.lit(batch_id))
)

spark.sql("CREATE SCHEMA IF NOT EXISTS bronze")
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {target} (
        order_id STRING, customer_id STRING, order_date STRING,
        order_total STRING, currency STRING, source_updated_at STRING,
        _corrupt_record STRING, _source_file STRING,
        _loaded_at TIMESTAMP, _batch_id STRING
    ) USING DELTA
    TBLPROPERTIES (
        'delta.autoOptimize.optimizeWrite' = 'true',
        'delta.autoOptimize.autoCompact' = 'true'
    )
""")
# TBLPROPERTIES above only apply when the table is created; enforce them on reruns too.
spark.sql(f"""
    ALTER TABLE {target} SET TBLPROPERTIES (
        'delta.autoOptimize.optimizeWrite' = 'true',
        'delta.autoOptimize.autoCompact' = 'true'
    )
""")

# Replace only this batch's rows, so a rerun never duplicates data.
(batch.write.format("delta")
    .mode("overwrite")
    .option("replaceWhere", f"_batch_id = '{batch_id}'")
    .saveAsTable(target))

loaded = spark.table(target).filter(F.col("_batch_id") == batch_id)
corrupt = loaded.filter(F.col("_corrupt_record").isNotNull()).count()
print(f"Batch {batch_id}: {len(landed)} files, {loaded.count()} rows, {corrupt} unparseable rows kept for silver")
```

Everything lands as a string on purpose, so type problems surface at silver (the corrupt-record column won't see them), where they can be quarantined with a reason. The header check is different: a renamed or reordered column is a batch-level failure, and I want it to stop the load before a single row reaches bronze. The `_metadata.file_path` column is standard Spark file metadata, so every row can be traced back to the file it came from without any custom code.

## Small files are fine to write, expensive to keep

Microsoft's [cross-workload table maintenance guidance](https://learn.microsoft.com/en-us/fabric/fundamentals/table-maintenance-optimization) is clear about bronze: prioritise ingestion throughput, discourages partitioning for new tables, don't apply V-Order to bronze, and don't build Direct Lake models on raw bronze tables. For Spark-written bronze tables it recommends optimize write, with auto compaction enabled unless ingestion latency matters more, and notes the two typically produce the best results when used together. I agree with all of it, with one caveat. Tolerating small files is fine at write time. It stops being true when silver reads that table every hour and the file count has crept past ten thousand.

Two settings change the default picture. New Fabric workspaces now use the `writeHeavy` [resource profile](https://learn.microsoft.com/en-us/fabric/data-engineering/configure-resource-profile-configurations), which turns V-Order off by default. That's the right default for bronze, but check it before you assume your gold tables are V-Ordered for Direct Lake. And [auto compaction](https://learn.microsoft.com/en-us/fabric/data-engineering/table-compaction#auto-compaction) checks file fragmentation after each write and runs a synchronous `OPTIMIZE` when it finds too many small files: by default, 50 files under half the 128 MB target. Microsoft recommends auto compaction as the default for most ingestion workloads, and for bronze I'd make it the rule.

Auto compaction cleans up after the fact. Optimize write works before the files exist: it shuffles data before the write so each batch produces fewer, larger files. The catch with `writeHeavy` is that it leaves `optimizeWrite.enabled` unset and only applies optimize write to partitioned writes by default, so an unpartitioned bronze table like the one above writes without it unless you ask. That's why the notebook sets both `delta.autoOptimize.optimizeWrite` and `delta.autoOptimize.autoCompact` on the table, and reapplies them on every run in case the table already existed. The trade-off is the extra shuffle, which adds time to every write rather than to the occasional one.

My rule for bronze: use both when a batch lands as many small source files or the copy step writes in parallel, because optimize write keeps each commit tidy and auto compaction catches the slow build-up across many commits. If each batch is already one or two decent-sized files, optimize write has little to merge, so auto compaction alone is enough.

The exception is a feed with a tight latency target. Auto compaction runs synchronously right after each write commits, so the occasional batch takes noticeably longer. If that matters more than file count, turn it off for that table, keep optimize write if its shuffle cost is acceptable, and schedule `OPTIMIZE` in a quiet window instead.

## Measure the raw zone before tuning it

Before anyone changes Spark settings, I want a list of which bronze tables are actually fragmented. `DESCRIBE DETAIL` returns the file count and total size, which is enough to rank them:

```python
from pyspark.sql import functions as F
from pyspark.sql.utils import AnalysisException

rows = []
for t in spark.sql("SHOW TABLES IN bronze").collect():
    if t.isTemporary:
        continue
    try:
        detail = spark.sql(f"DESCRIBE DETAIL bronze.{t.tableName}").collect()[0]
    except AnalysisException:
        continue  # not a Delta table (a stray CSV or Parquet table); skip it
    if detail["format"] != "delta":
        continue
    files = detail["numFiles"] or 0
    size_mb = (detail["sizeInBytes"] or 0) / 1024**2
    rows.append((f"bronze.{t.tableName}", files, round(size_mb, 1),
                 round(size_mb / files, 1) if files else 0.0))

health = spark.createDataFrame(
    rows, "table STRING, num_files LONG, size_mb DOUBLE, avg_file_mb DOUBLE")

# Fewer than ~50 files isn't worth compacting; under 25 MB average is fragmented.
display(health.filter((F.col("num_files") > 50) & (F.col("avg_file_mb") < 25))
              .orderBy(F.col("num_files").desc()))
```

My working threshold is an average under 25 MB; it's a heuristic, not a Microsoft number, so adjust it to your tables. For anything this flags, run `OPTIMIZE` once to compact the existing small files, then turn on auto compaction (`ALTER TABLE ... SET TBLPROPERTIES ('delta.autoOptimize.autoCompact' = 'true')`) so it stays clean. `OPTIMIZE` adds a commit rather than rewriting history, and the replaced files stay on storage until `VACUUM` removes them. Ad hoc runs are easiest from the table's **Maintenance** action in the lakehouse explorer. For scheduled runs, use a notebook, the [Lakehouse Maintenance pipeline activity](https://learn.microsoft.com/en-us/fabric/data-factory/lakehouse-maintenance-activity), or the lakehouse REST API.

The same dialog can run `VACUUM`. The default retention is seven days, and the portal and API reject anything shorter unless you disable the retention check. For bronze I keep at least the default. Bronze is your record of what the source sent, and time travel is part of that record when someone asks what the table looked like before last week's rerun.

## When this is more than you need

Skip most of this when:

- **The raw zone is small.** A few gigabytes of daily extracts won't feel fragmentation, and Spark reads them quickly regardless. Batch folders are still worth it; the health check isn't.
- **The source is already typed and governed.** A database copy into Delta doesn't have a header to check, and a well-behaved copy job may produce sensibly sized files already.
- **Nobody reads bronze incrementally.** If silver rebuilds from scratch on a weekly schedule, compaction buys little. (Rebuilding from scratch has its own problems, but that's a different post.)

The signal that you need it is a silver load whose runtime grows each week while the daily data volume doesn't. That's often the raw zone; check file counts before tuning the transform.

## What I'd do first

Put every batch in its own folder, and read it into bronze with `enforceSchema` set to false so a renamed or reordered column fails the load at the boundary. Turn on optimize write and auto compaction for bronze tables when you create them. Then run the file-count check once a month. It takes seconds, and it settles most "do we need a bigger capacity?" conversations before anyone has to change a Spark setting.
