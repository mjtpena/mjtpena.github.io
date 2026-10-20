---
title: "Running Data Pipelines in Production: Reruns, Late Data and Drift"
description: "Eight years of data pipelines taught me to plan for reruns, late data and schema drift. The habits that matter, with Delta MERGE and Fabric examples."
author: Michael John Peña
draft: false
date: 2026-02-05
tags:
  - Data Engineering
  - Microsoft Fabric
  - Delta Lake
  - Data Quality
  - Lessons
---

I've built data pipelines for eight years. Tutorials teach you to move data from A to B once, on a good day. Production asks something harder: move it every day, correctly, when the source is late, the schema has changed and the job has already half-run twice.

I keep seeing teams learn the habits below the expensive way. The examples use Microsoft Fabric and Delta Lake because that's where most of my work sits right now, but the ideas carry to Databricks, Synapse or plain Spark.

## Treat the data contract as a rumour

Every source comes with promises. "These fields are always populated." "Dates are ISO 8601." "IDs are unique." Treat each one as a hypothesis you test on every load, not a fact you design around.

The record you were promised and the record that arrives at 3 AM are rarely the same:

```json
{"id": 123, "name": "John", "order_date": "2026-02-05"}
```

```json
{"id": null, "name": "", "order_date": "02/05/26", "extra_field": "surprise"}
```

That second record breaks three promises at once: a missing key, an ambiguous date (5 February or 2 May?) and an unannounced column. The fix isn't to write a parser clever enough to guess. It's to decide, per rule, what happens on violation: **fail the load, quarantine the row, or accept and flag it.**

My rule of thumb: fail on anything that would make downstream numbers wrong (null keys, duplicate keys you can't resolve deterministically, unparseable amounts), and quarantine anything that only makes a row incomplete. Silently coercing bad values is the worst option, because the pipeline goes green and the report goes wrong.

## Check every batch before it lands

You won't anticipate every failure, so the goal shifts from prevention to detection. The checks that have paid for themselves, in rough order of value:

| Check | What it catches | Typical action |
|---|---|---|
| Freshness | Source stopped sending, or job didn't run | Alert |
| Row count vs recent baseline | Partial extracts, filter bugs, duplicate loads | Fail or alert |
| Null rate on required fields | Upstream schema or mapping changes | Fail |
| Key uniqueness | Joins fanning out, bad merges | Fail |
| Value distribution | A column suddenly 90% one value | Alert |

A minimal quality gate in the same notebook runs before the MERGE in the next section and stops the load if a hard rule breaks:

```python
from pyspark.sql import functions as F

batch = spark.read.table("staging_orders")
total = batch.count()

if total == 0:
    raise ValueError("Quality gate: staging_orders is empty")

null_keys = batch.filter(F.col("order_id").isNull()).count()
if null_keys > 0:
    raise ValueError(f"Quality gate: {null_keys} rows have a null order_id")

duplicate_keys = (
    batch.filter(F.col("order_id").isNotNull())
    .groupBy("order_id")
    .count()
    .filter("count > 1")
    .count()
)
print(f"Rows: {total}, null keys: {null_keys}, keys with duplicates: {duplicate_keys}")
```

Freshness and row count need history to compare against, so every run writes one row to a small run-log table: `run_id`, `run_at`, `table_name`, `row_count`, `max_event_time` and `status`. Write it from a `try`/`finally` around the gates, or from a small activity on the pipeline's on-fail and on-success paths, so a run that raises is still logged as `failed` instead of vanishing. The volume check then compares this batch with the median of the last seven successful runs. This fragment continues the gate above, so `total` is already set:

```python
baseline = spark.sql("""
    SELECT percentile_approx(row_count, 0.5) AS median_rows
    FROM (
        SELECT row_count
        FROM run_log
        WHERE table_name = 'staging_orders' AND status = 'succeeded'
        ORDER BY run_at DESC
        LIMIT 7
    ) AS recent
""").first()["median_rows"]

if baseline and not (0.5 * baseline <= total <= 1.5 * baseline):
    raise ValueError(
        f"Quality gate: {total} rows is outside 50-150% of the 7-run median ({baseline})"
    )
```

Using a median rather than an average means one bad day doesn't drag the baseline with it, and only successful runs count, so a failed partial load can't lower the bar for the next one. Freshness works the same way: fail or alert when `max(event_time)` in the batch is older than the source's normal lag, say 26 hours for a daily feed. Be honest about where the rule gives false alarms: month-end and quarter-end spikes, public holidays, and seasonal sources such as retail in December will all breach a flat 50-150% band. For those tables, compare against the same weekday or the same period last year, or downgrade the volume check from fail to alert.

Raising an exception fails the notebook activity and the pipeline run, which is what your alerting watches. A check that only logs a warning is one nobody reads. Null keys fail the load outright, in line with the contract rule above: a null key never matches in the MERGE (`NULL = NULL` isn't true in SQL), so every rerun inserts that row again as a new duplicate. Duplicate keys are reported rather than failed here because the MERGE step resolves them deterministically; change that if your source should never send them.

If you'd rather declare rules than code them, Fabric's [materialized lake views](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality) let you attach `CHECK` constraints that either drop violating rows or fail the refresh. As of February 2026 they're still in preview, and the docs list a known issue where the FAIL action can break creation and refresh with a "delta table not found" error, so I'd stick to DROP for now and use them for new medallion layers you can afford to rework, not to replace gates already protecting production tables. The broader monitoring picture is in [Data Observability: Monitoring Your Data Pipelines](/blog/2021-12-26-data-observability/).

## Make every load safe to rerun

Your pipeline will fail halfway, and someone will rerun it, possibly twice. If the load appends blindly, every rerun adds duplicates, and duplicates are the hardest defect to spot because totals still look plausible.

The pattern that fixes this is a **deduplicated MERGE keyed on the business key**, with a guard so older records can't overwrite newer ones. Here it is as a Fabric notebook cell (PySpark, where `spark` is already defined). The table and column names are placeholders:

```python
from delta.tables import DeltaTable
from pyspark.sql import Window
from pyspark.sql import functions as F

staging = spark.read.table("staging_orders")

# Keep only the latest version of each order within this batch.
# _source_seq is unique per row (a CDC LSN, change version, or file name
# plus line number stamped at landing), so ties on modified_at always
# resolve the same way on a rerun.
# Null order_id rows never reach this point: the quality gate above fails the load first.
# silver_orders has the same columns as staging_orders, including _source_seq,
# because updateAll/insertAll copy every target column from the source.
latest = Window.partitionBy("order_id").orderBy(
    F.col("modified_at").desc(), F.col("_source_seq").desc()
)
deduped = (
    staging
    .withColumn("rn", F.row_number().over(latest))
    .filter("rn = 1")
    .drop("rn")
)

target = DeltaTable.forName(spark, "silver_orders")

(
    target.alias("t")
    .merge(deduped.alias("s"), "t.order_id = s.order_id")
    .whenMatchedUpdateAll(condition="s.modified_at > t.modified_at")
    .whenNotMatchedInsertAll()
    .execute()
)
```

Three details matter more than the MERGE itself:

- **Deduplicate the source first.** Delta Lake's [MERGE](https://docs.delta.io/delta-update/#upsert-into-a-table-using-merge) can fail when more than one source row matches the same target row, because it can't tell which one should win. If two staging rows also share a `modified_at`, the window needs a tiebreaker that is unique per row (here a source sequence) or a rerun can pick a different winner. A batch-level load timestamp doesn't qualify, because every row in the batch shares it; if your source has nothing unique per row, fail on duplicate keys instead. That error is a feature: it's telling you the batch has duplicates you haven't decided how to resolve.
- **The `modified_at` guard** makes reruns and out-of-order batches harmless. Replaying Monday's file after Tuesday's can't roll a record back.
- **Don't use MERGE for everything.** For large, immutable, append-only facts (clickstream, sensor readings), an idempotent partition overwrite is cheaper: rewrite the whole day's partition rather than matching row by row. In a Fabric notebook that's a Delta write with `.mode("overwrite").option("replaceWhere", "event_date = '2026-02-04'")`, which replaces only the rows matching the predicate and fails if the new data falls outside it. MERGE earns its cost on mutable entities like orders, customers and accounts.

## Configure before you code

In Fabric, pipelines (formerly "data pipelines") and Copy job cover most data movement without custom code. Copy job's [incremental copy](https://learn.microsoft.com/fabric/data-factory/what-is-copy-job) is GA and handles the watermark bookkeeping that teams used to hand-roll. Its [CDC mode](https://learn.microsoft.com/fabric/data-factory/cdc-copy-job), which also replicates deletes, is still in preview, so test it before you rely on it for deletes. Pipelines add scheduling, dependencies, per-activity retry and a monitoring hub without Python.

Configuration wins for copying sources into a lakehouse, scheduling and simple column mapping. Code wins for business rules that need testing, quality gates, and anything you'll debug line by line.

The trade-off is visibility. A notebook is code you can diff, review and unit test. A pipeline's logic lives in JSON behind a canvas, and once a pipeline grows past a dozen activities with nested expressions, it's harder to review than the code it replaced. My rule: **pipelines orchestrate and move, notebooks transform.** When a pipeline expression needs a comment to explain it, it belongs in a notebook.

## Expect late data

Data arrives late: an overnight store sync, an offline mobile app, a resent partner file. If your incremental load uses "rows modified since the last run" as its only filter, late rows either get missed or land in the wrong day's numbers.

Three habits handle most of it:

1. **Separate event time from load time.** Store both. Report on when it happened, debug on when it arrived.
2. **Use a lookback window.** Instead of loading strictly after the last watermark, reload the last *n* days and let the idempotent MERGE above absorb the overlap. Pick *n* from how late your data actually arrives, not a guess. The `modified_at` guard in that MERGE assumes the source's `modified_at` is reliable: a late row whose timestamp isn't newer than the target's is skipped without a word. If the source has clock skew across systems, or no `modified_at` at all, use a different tiebreaker (a source sequence number or change version) or rewrite the whole lookback window with `replaceWhere` instead of merging into it.
3. **Make restatement explicit.** If last month's revenue can change, the business needs to know that. A "data as of" timestamp on reports is cheap.

When *not* to bother: if consumers only ever need a daily snapshot and late rows are rare, a full reload of a small table is simpler than any watermark scheme. Incremental logic is a cost you pay to save compute. Pay it only when the table is big enough to matter.

## Decide your schema drift policy now

Sources add columns, rename fields and change types without telling you. Delta Lake can [evolve the schema automatically](https://docs.delta.io/delta-update/#automatic-schema-evolution) on write or MERGE, and it's tempting to switch that on everywhere.

I don't, at least not past bronze. My policy:

- **Bronze (raw):** allow new columns. Losing data at the landing zone is worse than an untidy table.
- **Silver and gold:** fail on drift. A new column should be a deliberate change with a pull request, not something that appears in a semantic model because a vendor shipped an update.
- **Type changes:** always fail. A decimal that becomes a string is a bug report, not a migration.

One catch: "fail on drift" doesn't happen by itself in a MERGE. With auto-merge off, `updateAll` and `insertAll` ignore source columns the target doesn't have, so a new vendor column is dropped quietly rather than rejected. If silver should fail on drift, compare the staging schema with the target's in the quality gate. This fragment continues the gate, so `batch` is already set:

```python
incoming = set(batch.schema.fieldNames())
expected = set(spark.read.table("silver_orders").schema.fieldNames())
if incoming != expected:
    raise ValueError(
        f"Schema drift: new {sorted(incoming - expected)}, missing {sorted(expected - incoming)}"
    )
```

The cost is more 3 AM alerts early on. The benefit is that every curated column is one somebody chose.

## What I'd tell a team starting today

Most of a production pipeline's life is spent running, not being built. If I could hand a new team one checklist, it would be this: make every load rerunnable, put a quality gate in front of every merge, store event time and load time separately, and write down your schema drift policy before the first source changes. Do those four things and most of your incidents become a failed run with a clear message instead of a wrong number someone finds a week later.

Boring to operate is the goal, the same argument I made about code in [Boring Code on Purpose](/blog/2026-01-22-building-for-maintenance/).
