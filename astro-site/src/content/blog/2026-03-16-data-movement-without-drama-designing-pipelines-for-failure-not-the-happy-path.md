---
title: "Fabric Data Movement: Design for the Half-Finished Copy"
description: "How to design Fabric Copy jobs and copy activities so a failed, partial or repeated copy never leaves duplicates, gaps or a watermark that moved too far."
author: Michael John Peña
draft: false
date: 2026-03-16
tags:
  - Microsoft Fabric
  - Data Factory
  - Data Engineering
  - Delta Lake
  - Architecture
---

The copy step is the part of a Fabric pipeline people trust most and think about least. It's usually the first activity, it usually goes green, and when it doesn't, the instinct is to press rerun. That instinct is where most data movement drama starts: a rerun that appends the same rows twice, a watermark that moved forward even though the write never landed, or a "successful" copy that quietly skipped the rows that didn't fit.

Designing for failure here means deciding, before the first run, what a half-finished copy leaves behind and what a second attempt will do to it. Getting the happy path working is the easy part. The rerun is the design.

## Four ways a copy goes wrong

A copy rarely fails in one clean way. These are the four outcomes I design for, and only the first one is honest about itself.

| Outcome | What you see | What it leaves behind |
|---|---|---|
| Fails cleanly | Red run, nothing written | Nothing, if the destination write is a single commit |
| Fails partway | Red run, some data written | Partial files or rows, and a question about where to resume |
| Succeeds but wrong | Green run | Skipped rows, zero rows, or a truncated window |
| Succeeds twice | Two green runs for one batch | Duplicates, unless the write is idempotent |

The first row is the only one where pressing rerun is obviously safe. Every other row needs a rule written down before the incident, not worked out during it. The rest of this post is those rules.

## Decide who owns the state

Incremental movement has state: the high-water mark of what has already been copied. The single most important design choice is whether you own that state or Fabric does.

[Copy job](https://learn.microsoft.com/fabric/data-factory/what-is-copy-job) owns it for you. Copy job went GA at FabCon in March 2025, and incremental copy went GA in mid-2025. On the first run it copies everything; after that it copies rows whose watermark column (typically a datetime column or an increasing integer) is higher than anything it has copied before, or new and modified files for storage sources. The behaviour that matters for failure design is documented plainly: a failed run doesn't change the state Copy job manages, and the next run resumes from the end of the last successful run. State unchanged doesn't mean destination unchanged, though: with Append, anything a failed run already wrote can be written again when the next run resumes from the last successful state, so pair incremental Copy job with Merge or a downstream dedupe. CDC-based incremental copy, which also captures deletes, is still in preview, so I don't build production loads that depend on it yet.

A copy activity inside a pipeline gives you no such thing. If you build a watermark pattern with a Lookup, a parameterised query and a control table, you own every edge case: when the watermark advances, what happens on partial failure, how late rows get picked up, and whether deletes are captured at all.

My default for new ingestion is Copy job, and since the [Copy job activity](https://learn.microsoft.com/fabric/data-factory/copy-job-activity) went GA in November 2025 it can sit inside an orchestrating pipeline with readiness gates around it. I only hand-build a watermark when the source genuinely doesn't fit: no reliable incremental column, a window that has to be computed from business rules, or a source that needs a query Copy job can't express.

## Pick the write behaviour for the second run

Most people choose the destination write behaviour by thinking about the first run. Choose it by thinking about the second run of the same batch.

- **Append** is only safe if a batch can never be copied twice. That's a strong promise. A manual rerun, a retry after a timeout, or an event trigger firing twice all break it. Append is fine for a raw landing zone you deduplicate downstream; it's a poor choice for a table anyone queries directly.
- **Overwrite** into a Lakehouse table is a single Delta commit. Readers see the old version until the new one lands, and a failed overwrite leaves the old data intact. For small reference tables and for landing tables that hold exactly one window, this is the simplest safe option.
- **Upsert/merge** on a business key makes a repeated copy harmless. Copy job supports merge into database destinations, and the Lakehouse connector added an Upsert table action (preview) for both Copy job and copy activity in mid-2025. It's still in preview, and it doesn't support partitioned Lakehouse tables yet. Check the [Lakehouse connector settings](https://learn.microsoft.com/fabric/data-factory/connector-lakehouse-copy-activity) for your scenario before relying on it, because preview behaviour can change.

One trap catches people with Copy job specifically. **Reset incremental copy** clears the watermark so the next run does a full copy, which is exactly what you want after a source discrepancy. It does not touch the destination. With Append, a reset duplicates everything already loaded. Either clear the destination first, use the truncate-before-full-load option, or don't combine reset with append. The [Copy job documentation](https://learn.microsoft.com/fabric/data-factory/what-is-copy-job#automatic-table-creation-and-truncation-on-destination) covers the truncate option and how it interacts with reset. Read it before the first incident.

## If you own the watermark, move it last

When I do hand-build incremental movement, the pipeline has three steps in a fixed order:

1. Read the current watermark and subtract a lookback (30 minutes in this example).
2. Copy rows newer than that lower bound into a landing table with **Overwrite**, so the landing table holds exactly one window.
3. Merge the landing table into the target, then advance the watermark to the highest value actually written.

That order matters because Fabric doesn't give you a transaction across the merge and the control table, so don't pretend it does. Instead, make each step safe to repeat. If the copy fails, the watermark hasn't moved and the next run reads the same window. If the merge fails, same thing. If the merge succeeds and the watermark update fails, the next run re-reads a window that's already merged, and the merge makes that a no-op.

All of that assumes one window at a time. A slow run that overlaps the next scheduled one, or a manual rerun started during a scheduled run, will Overwrite the shared landing table while the first run's merge is still reading it. Make sure only one run can process a window at a time (a pipeline concurrency limit if your setup exposes one, or a lock row in the control table), or give each run its own landing table.

The lookback exists because source timestamps lie a little. A row can be committed with a `modified_at` earlier than a row you've already copied, because the transaction that wrote it was still open when you read. Reading a slightly overlapping window and merging on the key catches those rows without duplicating anything; you need both the lookback and the merge. Size the lookback to the source's longest realistic open transaction or replication lag, not to a round number. Anything committed with a timestamp older than the watermark minus the lookback will still be missed.

This notebook is step 3. It's complete for a Fabric PySpark notebook attached to a lakehouse, with placeholder table names, and assumes the control table already exists with `table_name` and `watermark_value` columns. It's two cells. The first holds only the parameters; toggle it to a parameter cell so the pipeline's overrides are injected before any logic runs.

Cell 1 (parameter cell):

```python
landing_table = "landing_sales_orders"
target_table = "silver_sales_orders"
control_table = "ops_watermarks"
key_column = "order_id"
watermark_column = "modified_at"
tiebreak_column = "source_rowversion"
```

Cell 2:

```python
from delta.tables import DeltaTable
from pyspark.sql import Window
from pyspark.sql import functions as F

landing = spark.table(landing_table)

# The lookback window can return the same key more than once; keep the latest version.
# The tiebreaker keeps the choice deterministic when two versions share a timestamp.
latest = (
    landing.withColumn(
        "_rn",
        F.row_number().over(
            Window.partitionBy(key_column).orderBy(
                F.col(watermark_column).desc(), F.col(tiebreak_column).desc()
            )
        ),
    )
    .where(F.col("_rn") == 1)
    .drop("_rn")
)

new_watermark = latest.agg(F.max(watermark_column).alias("wm")).collect()[0]["wm"]

if new_watermark is None:
    # Empty window: nothing to merge, and the watermark must not move.
    notebookutils.notebook.exit("no_rows")

(
    DeltaTable.forName(spark, target_table)
    .alias("t")
    .merge(latest.alias("s"), f"t.{key_column} = s.{key_column}")
    .whenMatchedUpdateAll(condition=f"s.{watermark_column} >= t.{watermark_column}")
    .whenNotMatchedInsertAll()
    .execute()
)

# Advance the watermark only after the merge has committed.
# This control-table schema assumes watermark_column is a timestamp.
watermark_row = spark.createDataFrame(
    [(target_table, new_watermark)], "table_name string, watermark_value timestamp"
)
(
    DeltaTable.forName(spark, control_table)
    .alias("c")
    .merge(watermark_row.alias("w"), "c.table_name = w.table_name")
    .whenMatchedUpdate(
        condition="w.watermark_value > c.watermark_value",
        set={"watermark_value": "w.watermark_value"},
    )
    .whenNotMatchedInsertAll()
    .execute()
)

notebookutils.notebook.exit(f"merged_to_{new_watermark}")
```

Three details are deliberate. The tiebreaker (here a source ROWVERSION copied into the landing table; an ingestion sequence works too) means two versions of a key with the same `modified_at` always resolve to the same winner, so reruns can't flip the result. The update condition `s.modified_at >= t.modified_at` stops an older version of a row from overwriting a newer one if windows ever overlap more than expected. And the watermark update only ever moves forward, so a rerun of an old window can't drag it backwards.

## Treat skipped rows as a failure until proven otherwise

The copy activity's **Fault tolerance** setting lets it skip incompatible rows or problem files and carry on. It's useful, and it's also the easiest way to turn a loud failure into silent data loss. A run that skips 4,000 rows still goes green.

My rule: only enable fault tolerance together with logging, and always check the result. The [copy activity output](https://learn.microsoft.com/fabric/data-factory/monitor-copy-activity) includes `rowsRead`, `rowsCopied`, `rowsSkipped` and, for file sources, `filesSkipped`, plus a `logPath` to the session log. An If Condition after the copy can fail the run when anything was skipped. This is a pipeline expression fragment, not a full definition:

```text
@greater(coalesce(activity('Copy_sales_orders').output?.rowsSkipped, 0), 0)
```

The true branch runs a Fail activity with the log path in the message. Someone then decides whether skipping was acceptable. Comparing `rowsRead` with `rowsCopied` is a cheap second check that catches the same thing from a different angle.

Zero rows deserves the same suspicion. A copy of zero rows is a success as far as the activity is concerned, and on a weekday that's usually an upstream problem. I covered readiness gates and retry policy in [gating daily loads on data readiness](/blog/2026-03-05-pipelines-i-trust-in-fabric-reducing-brittle-dependencies-in-daily-loads/), so I won't repeat that here; the short version is that retries are for transient faults, and they're only safe once the write behaviour makes a repeat harmless, which is the point of this post.

## When this is more than you need

Not every copy needs a watermark, a landing table and a merge.

- **Small reference tables** should just be overwritten in full every run. A few thousand rows don't justify incremental logic, and a full overwrite is trivially safe to rerun.
- **A straight replica of a supported database** may be better served by Mirroring than by any copy. If nobody needs to shape the data on the way in, don't own the movement at all.
- **One-off migrations** need a reconciliation check at the end, not a resumable design.

The opposite failure is common too: a hand-built watermark framework for 40 tables that Copy job would have handled with less code and fewer edge cases. If the source has a clean incremental column and you're not doing anything unusual, let Fabric own the state.

## The rule I'd keep

Before a copy goes to production, answer one question in writing: if this runs twice for the same window, what does the destination look like? If the answer is "the same as running it once", the copy is safe to retry, reset and rerun, and most data movement incidents become a button press. If the answer is "it depends", fix the write behaviour before you fix anything else. When it does fail, the [ownership and runbook model](/blog/2026-03-14-fabric-architecture-notes-turning-messy-raw-zones-into-reliable-products/) decides who presses the button.
