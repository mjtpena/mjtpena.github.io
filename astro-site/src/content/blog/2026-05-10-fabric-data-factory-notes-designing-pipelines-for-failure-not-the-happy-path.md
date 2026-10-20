---
title: "Rerun From Failed Activity in Fabric: Design for the Second Run"
description: "What a Fabric pipeline rerun actually runs again, why utcNow() and run IDs break recovery, and how to make rerun from failed activity safe."
author: Michael John Peña
draft: false
date: 2026-05-10
tags:
  - Microsoft Fabric
  - Data Factory
  - Data Engineering
  - Reliability
---

Most failure design in Fabric pipelines stops at the moment of failure: the catch path, the alert, the red run in Monitoring hub. Then someone clicks rerun, often hours later and often not the person who built it. Whether that click finishes the batch or quietly loads it twice depends on choices made when the pipeline was built, not when it broke.

This follows earlier notes on [catching an error and still failing the run](/blog/2026-03-27-orchestration-lessons-in-fabric-designing-pipelines-for-failure-not-the-happy-path/) and [copies that fail halfway](/blog/2026-03-16-data-movement-without-drama-designing-pipelines-for-failure-not-the-happy-path/).

## What the rerun button actually does

Fabric's [Monitoring hub](https://learn.microsoft.com/fabric/data-factory/monitoring-hub-pipeline-runs) lets you rerun a failed run in full, from the failed activity, or from an activity you select, but says little about what a rerun does inside the pipeline. Fabric pipelines run on the same orchestration engine as Azure Data Factory, and the [ADF documentation on rerunning pipelines and activities](https://learn.microsoft.com/azure/data-factory/monitor-visually#rerun-pipelines-and-activities) spells out the rules more fully. Three of them matter most for recovery:

- A ForEach always loops over the items it receives, and inner activities may still be skipped under the rerun rules.
- For an Execute Pipeline activity (Invoke pipeline in Fabric), the child is triggered again, but activities inside it may still be skipped.
- A rerun with **new parameters** is treated as a brand-new run, not part of the original run's rerun history.

The same page covers If, Switch and Until, and says Set variable "will behave as before", which doesn't say whether a skipped Set variable keeps its original value.

Activities that already succeeded show as **Skipped** on the rerun, and the rerun reuses the original parameter values. Change anything and you're starting a new run, and the "skip what already succeeded" guarantee goes with it.

That "may still be skipped" is where the docs stop being useful, and user reports on the Fabric Community forum are less tidy. One [user report on rerunning a ForEach from a failed activity](https://community.fabric.microsoft.com/t5/Data-Engineering/Data-Pipeline-Rerun-from-failed-activity/td-p/4846577) describes iterations that had already succeeded running again. Another, titled ["Re-Run from failed activity re-runs also skipped activities"](https://community.fabric.microsoft.com/t5/Data-Pipeline/Re-Run-from-failed-activity-re-runs-also-skipped-acitivties/td-p/3995304), describes activities marked Skipped whose values were evaluated again. They're user reports, not documented contracts, so I test the behaviour (below).

## The three things that change on a rerun

When I review a pipeline for recoverability, I look for values that depend on *when* or *which* run is executing.

| Value | First run | Rerun |
|---|---|---|
| `@utcNow()` | Time of the original run | Time of the rerun, possibly the next day |
| `@pipeline().RunId` | Original run ID | A new run ID |
| Variables set before the failure | Set by that run | Not guaranteed to keep the first run's value (see above) |

`utcNow()` is the one that bites. A pipeline that computes "yesterday" with `@adddays(utcNow(), -1)` loads 9 May when it runs on 10 May. Rerun it from the failed activity on the morning of 11 May and the remaining steps load 10 May. The upstream steps were skipped, so they still hold 9 May's data. Nothing fails. You get a gold table built from two different days, and the run is green.

Stamping `@pipeline().RunId` on every row is sensible for tracing. If the same run ID also decides "have I already processed this?", a rerun gets a new ID and the check passes when it shouldn't.

## Name the batch, don't compute it

My rule: the logical batch a run is processing is a **pipeline parameter**, resolved once at the start of the run, never an expression evaluated mid-run by each step. An orchestrating pipeline or an API call can supply it; a scheduled run that doesn't set it falls back to the default, which is why the Set variable below resolves an empty value. Every step then receives the resolved value, including Invoke pipeline children: pass `batch_date` to them as a parameter, never let a child compute its own, because a child is triggered again on a rerun and would resolve the date afresh.

For a daily load, I give the pipeline a `batch_date` string parameter with an empty default, and a single Set variable activity at the top resolves it:

```text
Variable:  batch_date
Value:     @if(empty(pipeline().parameters.batch_date),
               formatDateTime(adddays(convertFromUtc(pipeline().TriggerTime, 'AUS Eastern Standard Time'), -1), 'yyyy-MM-dd'),
               pipeline().parameters.batch_date)
```

That's a fragment of the Set variable settings. I use `pipeline().TriggerTime` rather than `utcNow()` because it identifies when the run was triggered, not when an activity happened to execute. But what `TriggerTime` returns on a rerun isn't documented, and if the skipped Set variable re-evaluates, a next-day rerun has exactly the clock dependency the table warns about. So when recovery happens on a later day, I start a new run with `batch_date` set explicitly, giving up the rerun grouping in Monitoring hub. The functions used are all in the [pipeline expression reference](https://learn.microsoft.com/fabric/data-factory/expression-language).

The run ID stays, but as an audit column. It answers "which run wrote this row?". The batch key answers "has this batch been done?". Keep the two separate.

## Make each step check its own work

Skipping succeeded activities is coarse idempotency. A notebook that wrote three of five tables before failing is one failed activity, and the rerun runs all of it again. So each step that writes data needs its own answer to "what if I've already run for this batch?"

For writes, the answer is usually a Delta `MERGE` on a business key or a partition overwrite scoped to the batch, which [I covered for production pipelines generally](/blog/2026-02-05-data-pipelines-production/). For expensive steps or side effects, such as calling an external API or sending a partner a file, I add a guard against a small control table.

These are two cells for a Fabric PySpark notebook attached to a lakehouse, with a minimal write standing in for the step's real work. The table and step names are placeholders. The split matters: a pipeline run [inserts a cell beneath the parameter cell](https://learn.microsoft.com/fabric/data-engineering/author-execute-notebook) that overwrites the defaults, so logic in the parameter cell would run against placeholders.

The first cell, toggled as the parameter cell, holds only the defaults:

```python
batch_date = "<yyyy-mm-dd>"
step_name = "<step-name>"
pipeline_run_id = "<pipeline-run-id>"
control_table = "ops_step_completions"
source_table = "<source-table>"
target_table = "<target-table>"
```

The second cell does the check, the work and the completion record:

```python
from datetime import datetime, timezone

from delta.tables import DeltaTable
from pyspark.sql import functions as F

if batch_date.startswith("<") or step_name.startswith("<"):
    raise ValueError("batch_date and step_name must be supplied by the pipeline")

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {control_table} (
        batch_date string, step_name string,
        pipeline_run_id string, completed_at_utc timestamp
    ) USING DELTA
""")

already_done = not (
    spark.table(control_table)
    .where((F.col("batch_date") == batch_date) & (F.col("step_name") == step_name))
    .isEmpty()
)

if already_done:
    notebookutils.notebook.exit("skipped: already completed for this batch")

# Placeholder for the step's real work: overwrite only this batch's rows, so a partial
# earlier attempt is replaced rather than duplicated. target_table must already exist
# with a batch_date string column.
(
    spark.table(source_table)
    .where(F.col("batch_date") == batch_date)
    .write.format("delta")
    .mode("overwrite")
    .option("replaceWhere", f"batch_date = '{batch_date}'")
    .saveAsTable(target_table)
)

completion = spark.createDataFrame(
    [(batch_date, step_name, pipeline_run_id, datetime.now(timezone.utc))],
    "batch_date string, step_name string, pipeline_run_id string, completed_at_utc timestamp",
)

(
    DeltaTable.forName(spark, control_table).alias("t")
    .merge(completion.alias("s"), "t.batch_date = s.batch_date AND t.step_name = s.step_name")
    .whenNotMatchedInsertAll()
    .execute()
)

notebookutils.notebook.exit("completed")
```

Three details are deliberate. The completion row is written *last*, after the work, so a crash halfway leaves no record and the rerun does the work again. The key is batch plus step, not the run ID, so a rerun or a fresh run for the same batch both see the earlier completion. And the record is a merge, which keeps the control table to one row per batch and step. It doesn't stop two concurrent attempts both doing the work, so pair it with Concurrency = 1 (below).

The guard is also what makes the ForEach behaviour tolerable. Inside the ForEach, set the notebook's `step_name` base parameter to an expression such as `@concat('load_', item().table_name)`, not the whole `item()` object. Then if the whole loop runs again on a rerun, iterations that already finished exit in seconds instead of reprocessing.

## Stop the rerun colliding with the next schedule

A manual rerun started at 8:55 can still be running when the 9:00 scheduled run starts, and both write the same tables. Fabric pipelines have a **Concurrency** setting in the pipeline Settings tab. On the shared ADF engine, reaching the concurrency limit means extra runs queue until earlier ones finish. Set it to 1 and runs queue rather than overlap. The queue isn't unbounded: Fabric's [Data Factory limits](https://learn.microsoft.com/fabric/data-factory/data-factory-limitations) cap queued runs per pipeline at 100, and runs beyond that limit aren't queued.

On slow hourly pipelines, several runs can queue behind a long one, which is only safe if the batch key matches the schedule's grain. A daily `batch_date` resolves to the same value for every run that day, so an hourly pipeline needs an hour-grain key instead, such as a `batch_hour` resolved from `formatDateTime(pipeline().TriggerTime, 'yyyy-MM-dd-HH')`. With that, queued runs process the right batches; they just finish late. If late isn't acceptable, have the first activity check whether an earlier run is still in progress and exit early.

Event triggers need more thought. When a file landing starts the pipeline, queuing one run per file can build a long backlog, and a single run that picks up everything outstanding is often the better design.

## Rehearse the failure

Because so much rerun behaviour is loosely documented, I break each pipeline on purpose in a development workspace before it goes to production. A parameter can't be the failure switch, since a rerun keeps the original values, so the switch lives in data. I add a small `ops_failure_injection` table in the development lakehouse, and each critical notebook raises an exception at the start if a row exists for its step name. Then:

1. Insert a row for the middle step and run the pipeline. It fails where you expect.
2. Delete the row and rerun from the failed activity.
3. Check which activities ran, which were skipped, which Invoke pipeline children did real work, and whether any table now holds a second copy of the batch.
4. Repeat the rerun on a later day, or check the values it used, to confirm nothing depends on the clock.

If the rerun loads anything twice or the wrong day, you found it in dev, not in a finance report.

## When this is more than you need

Not every pipeline deserves a control table.

- **Full reloads.** A pipeline that truncates and reloads small reference tables is already safe to run any number of times.
- **Steps that already merge.** If every write is a `MERGE` on a business key, the guard only saves compute. Add it where a rerun is expensive or has side effects, not everywhere.
- **Copy job ingestion.** [Copy job](https://learn.microsoft.com/fabric/data-factory/what-is-copy-job) manages its own incremental state and resumes from the last successful run, so don't wrap a second state table around it.

What every pipeline does need is the batch as a parameter. It costs one parameter and one Set variable, and removes the most common way a rerun silently loads the wrong data.

## The question for the runbook

The runbook for a failed pipeline should answer one question before anything else: is rerun from failed activity safe for this pipeline, yes or no? If nobody can say yes with evidence from a rehearsal, the honest answer is no, and the runbook should say what to do instead. Most of the time, the work to turn that into a yes is a parameter, a merge and an afternoon breaking things on purpose.
