---
title: "Who Gets Told? Owners, Error Codes and Runbooks in Fabric"
description: "A table contract is half the job: assigning owners per layer, collapsing load outcomes to three, and mapping Fabric pipeline failures to runbooks."
author: Michael John Peña
draft: false
date: 2026-03-14
tags:
  - Microsoft Fabric
  - Data Engineering
  - Data Factory
  - Operations
  - Governance
---


A lakehouse can have clean medallion layers, well-typed silver tables and a tidy gold model, and still be unreliable. The reason is usually not the data. It's that when a load fails at 6am, nobody knows whose problem it is, the error message is a 200-line Spark stack trace, and the fix lives in one engineer's head.

In [Table Contracts in a Fabric Lakehouse](/blog/2026-03-03-lakehouse-decisions-i-made-this-week-turning-messy-raw-zones-into-reliable-products/) I covered what a curated table promises and how to enforce it. This post is the other half: who acts when the promise breaks, how few ways a load is allowed to end, and what the person on call reads first.

## Ownership is per layer, not per platform

"The data team owns the lakehouse" is an ownership model for a budget line, not for a table. When a silver table is wrong, "the data team" can't decide whether the source sent bad data, the transformation has a bug, or the business rule changed. Three different people need to answer those three questions.

My rule of thumb is one accountable owner per layer, plus the source owner upstream of bronze, each with a clear handover point:

| Layer | Accountable owner | Owns | Does not own |
|---|---|---|---|
| Raw / bronze | Platform or ingestion engineer | Data landing on time, complete files, ingestion metadata | Whether the source values are correct |
| Source content | Source system owner (outside the data team) | What the source sends, schema changes, fixing bad records at source | How the data is modelled downstream |
| Silver | Domain data engineer | Contract, quarantine rules, reject thresholds, the load notebook | Business definitions of metrics |
| Gold / semantic model | Data product owner (often an analytics lead) | Metric definitions, endorsement, consumer communication | Upstream load failures |

The row people skip is the second one. If the source owner isn't named, every bad upstream record becomes the data engineer's problem, absorbed by ever more defensive cleaning code. Naming the source owner is what makes the quarantine table useful: it becomes the evidence you hand to them, not a dumping ground you clean up yourself.

Write the owner in the item description and the workspace contact list, not a wiki page that drifts. If you use Fabric domains, the domain admin is an escalation point above the table owners, not a substitute for them.

## Three outcomes, not seven

The second source of overhead is ambiguous run states. Pipelines grow branches: retry this activity, skip that one if the file is missing, continue on error for the "optional" source. Together they produce runs that are green in the Monitor hub but loaded half the data.

I collapse every silver load into exactly three outcomes:

- **OK.** Every row passed the contract. Nobody needs to look.
- **WARN.** The batch loaded, but some rows went to quarantine and the reject ratio is under the threshold. The source owner gets a summary. The run is green.
- **FAILED.** The batch didn't load. The run is red, it carries an error code, and the error code maps to a runbook.

The thing I remove is "continue on error" for anything feeding a curated table. An optional branch that silently skips a source is a fourth outcome nobody designed for, and it's the one that produces a dashboard that looks fine and is wrong. If a source is truly optional, give it its own pipeline and its own owner. If it isn't, its failure fails the run.

Unexpected exceptions, such as a bug in the notebook or a capacity problem, still fail the activity the normal way. That's fine. They're the one failure mode without one of *our* codes, and their runbook entry is simply "the silver owner investigates".

## Let the notebook decide, let the pipeline fail

In the contract post, the load notebook raised an exception for an empty batch, for a required column that arrived entirely null, and for a reject ratio over the threshold. That works, but the person on call gets a Python traceback that can't say whose problem it is. I prefer the load notebook to stop cleanly and say why, a check step to log the batch, and the pipeline to fail with a readable message and a stable code.

That means four changes to the load notebook. Three raises become exits, each of which stops the notebook before the `MERGE`, and a final exit means the notebook always returns a value. This is a fragment: each block replaces the matching block in the earlier notebook.

```python
# Fragment: changes to the load notebook from the contract post.

# Replaces the raise on an empty batch. Stays before the null-column check,
# because in an empty batch every column is "entirely null".
if raw.isEmpty():
    notebookutils.notebook.exit("empty")

# Replaces the raise on entirely null columns: the source stopped sending a field.
null_cols = [c for c in required if raw.filter(F.col(c).isNotNull()).limit(1).count() == 0]
if null_cols:
    notebookutils.notebook.exit("schema")

# Replaces the raise on the reject ratio; runs after the quarantine write, before the MERGE.
if total > 0 and rejected_count / total > max_reject_ratio:
    notebookutils.notebook.exit("skipped")

# New last line, after the MERGE and the unpersist.
notebookutils.notebook.exit("loaded")
```

The load activity now succeeds with a reason, the check turns that reason into a code, and silver is never touched, which is what FAILED has to mean. Keep the raises and the check never runs, so no code is emitted. Drop the reject raise without the exit and the `MERGE` runs, leaving silver holding a batch the run log calls FAILED.

One guard still raises on purpose: the missing-column check at the top. A bronze table rebuilt without a contract column is a defect on our side, not the source's, so it falls under the generic "silver owner investigates" entry. An entirely null column is different. Bronze is intact, but the source stopped sending a field, so it gets its own code and goes to the source owner.

Re-runs stay clean because the load notebook deletes the batch's earlier rejects from `quarantine.orders` before writing new ones. That delete only happens if the load gets that far, so the check counts quarantine rows only for `loaded` and `skipped`.

The check notebook runs after the load activity, in the same schema-enabled lakehouse as the earlier post (`bronze.orders_raw` and `quarantine.orders`, both carrying a `_batch_id` column). The pipeline passes it two parameters: the batch ID, and the load notebook's exit value, set with `@activity('Load orders').output.result.exitValue`. The quarantine table only exists once some batch has had rejects, so a missing table means zero. `notebookutils` is built into Fabric notebooks.

```python
import json
from datetime import datetime, timezone

from pyspark.sql import functions as F
from pyspark.sql.types import (
    DoubleType, LongType, StringType, StructField, StructType, TimestampType,
)

batch_id = "<batch-id>"       # notebook parameter, set by the pipeline
load_result = "loaded"        # notebook parameter: the load notebook's exit value
source_name = "orders"
max_reject_ratio = 0.05       # per-source threshold, agreed with the silver owner

total = spark.table("bronze.orders_raw").filter(F.col("_batch_id") == batch_id).count()

# Count rejects only when the load reached the quarantine write. An "empty" or
# "schema" exit stops earlier, so any rows for this batch are from a previous run.
if load_result in ("loaded", "skipped") and spark.catalog.tableExists("quarantine.orders"):
    rejected = (
        spark.table("quarantine.orders").filter(F.col("_batch_id") == batch_id).count()
    )
else:
    rejected = 0
ratio = rejected / total if total else 0.0

if load_result == "empty" or total == 0:
    status, code = "FAILED", "RAW-EMPTY"
    message = f"{source_name} batch {batch_id}: no rows landed in bronze."
elif load_result == "schema":
    status, code = "FAILED", "RAW-SCHEMA"
    message = (
        f"{source_name} batch {batch_id}: a required column arrived entirely null; "
        "the source feed changed."
    )
elif load_result == "skipped" or ratio > max_reject_ratio:
    status, code = "FAILED", "RAW-REJECTS"
    message = (
        f"{source_name} batch {batch_id}: {rejected} of {total} rows quarantined "
        f"({ratio:.1%}), above the {max_reject_ratio:.0%} threshold."
    )
elif rejected > 0:
    status, code = "WARN", "RAW-QUARANTINE"
    message = f"{source_name} batch {batch_id}: {rejected} of {total} rows quarantined."
else:
    status, code = "OK", "NONE"
    message = f"{source_name} batch {batch_id}: {total} rows loaded."

spark.sql("CREATE SCHEMA IF NOT EXISTS ops")

run_schema = StructType([
    StructField("source_name", StringType()),
    StructField("batch_id", StringType()),
    StructField("status", StringType()),
    StructField("code", StringType()),
    StructField("total_rows", LongType()),
    StructField("rejected_rows", LongType()),
    StructField("reject_ratio", DoubleType()),
    StructField("checked_at", TimestampType()),
])

run_row = [(source_name, batch_id, status, code, total, rejected, ratio,
            datetime.now(timezone.utc))]

(spark.createDataFrame(run_row, run_schema)
    .write.format("delta").mode("append")
    .saveAsTable("ops.load_runs"))

notebookutils.notebook.exit(json.dumps({"status": status, "code": code, "message": message}))
```

[`notebookutils.notebook.exit()`](https://learn.microsoft.com/en-us/fabric/data-engineering/notebookutils/notebookutils-notebook-run) hands its string back to the calling pipeline, where the notebook activity's output exposes it as `output.result.exitValue`. It's a string, so the pipeline parses it with `json()`. Confirm that path in the activity's Output pane before wiring expressions to it.

The pipeline then runs in this order: `Load orders`, `Check batch`, a Switch for notifications, and an If Condition joined to the Switch with an **On completion** dependency, holding a Fail activity. The Switch routes on the code:

```text
@json(activity('Check batch').output.result.exitValue).code
```

The If Condition tests the status:

```text
@equals(json(activity('Check batch').output.result.exitValue).status, 'FAILED')
```

In its True branch, a [Fail activity](https://learn.microsoft.com/en-us/fabric/data-factory/fail-activity) ends the run as failed with a custom message and error code, both shown in the run history:

```text
@json(activity('Check batch').output.result.exitValue).message
@json(activity('Check batch').output.result.exitValue).code
```

Two choices are deliberate. The run log is written before the pipeline fails, so every batch, failed ones included, sits in a table you can query. And WARN doesn't fail anything: the source owner reads the quarantine summary on their own schedule. If WARN interrupts someone, people learn to ignore the interruptions.

### Who actually gets told

A red run in the Monitor hub only helps if someone is looking, so routing belongs in the pipeline. A single Teams activity has one fixed recipient, which is why the Switch exists: one case per code, each with its own notification. `RAW-REJECTS` and `RAW-SCHEMA` get a [Teams activity](https://learn.microsoft.com/en-us/fabric/data-factory/teams-activity) posting to the source owner's channel. `RAW-EMPTY` posts to the platform channel. `RAW-QUARANTINE`, the WARN case, gets an [Office 365 Outlook activity](https://learn.microsoft.com/en-us/fabric/data-factory/outlook-activity) emailing the source owner the batch ID and reject count. The default case (`NONE`) stays empty. Neither activity carries a preview label in the docs as of early 2026. A paging tool can subscribe to the platform channel.

The connection's account can only post to teams and channels it belongs to, and the source owner usually sits outside the data team. If that account can't join their channel, email them instead. Outlook mail is sent as the connection's user, so connect it with a dedicated service account, not someone's personal mailbox.

The bigger trap is deployment. Both activities' docs list them as inactive when using CI/CD, and both go inactive in a new workspace when they use a user-authentication connection, until someone creates one there. A pipeline promoted to production can silently lose its alerts. Check these activities after every deployment, or move notifications into one dedicated notification pipeline that owns the connection and that the others call with an Invoke pipeline activity.

On completion matters because notification is the step most likely to break for reasons unrelated to the data. With On success, an expired connection would stop the run before the Fail activity, which is exactly the unreadable failure this design removes. With On completion, the run still ends with our code.

## One page per error code

A runbook only works if it's short enough to read while something is broken. I keep one entry per error code, and every entry has the same four parts:

1. **What it means**, in one sentence a non-engineer can follow.
2. **Who owns it**, from the ownership table above.
3. **First three checks**, in order, with the query or screen to look at.
4. **When to escalate**, and to whom.

For `RAW-REJECTS` the first check is always the quarantine table grouped by reject reason. Usually one reason dominates, such as a new currency code or a date format change. That points straight at the source owner, and the conversation is about evidence rather than blame. `RAW-SCHEMA` goes to the same person with a shorter question: which field did you stop sending, and was it deliberate?

For `RAW-EMPTY` the first check is whether the source delivered anything at all, before anyone touches Fabric. An empty batch is usually an upstream schedule or credential problem, and the platform engineer owns that one.

Keep the runbook in the same Git repo as the notebooks and pipeline definitions, so a new error code and its runbook entry land in the same pull request.

## Endorse the product, not the plumbing

Fabric's [endorsement badges](https://learn.microsoft.com/en-us/fabric/governance/endorsement-overview) are where ownership becomes visible to consumers. Promoted means the creator thinks the item is ready to share. Certified can only be applied by reviewers a Fabric administrator authorises or, where certification is delegated, a domain admin authorises for that domain. Master data, still in preview, marks an item, such as a lakehouse or semantic model, as the authoritative source for core data like customer or product lists, and also has to be applied by authorised users.

My rule: nothing gets Certified until it has a named owner, a runbook for every error code it can raise, and a few weeks of run log showing it's stable. Certification is a promise that someone will answer when it breaks. If you certify before the operating model exists, the badge is decoration, and analysts learn that it means nothing.

I'd certify the gold semantic model or the gold tables people actually query. Bronze shouldn't carry an endorsement at all. Endorsing it tells consumers it's safe to build on raw data, which undoes the whole point of having a contract at silver.

## Deciding whether you need it yet

Not every lakehouse needs error codes and runbooks. If one team builds and consumes its own data, the owner is obvious and a notebook comment does the job. Prototype workspaces shouldn't have runbooks at all: nobody depends on the output. The ownership table and five runbook entries cost an afternoon, which is cheap once anyone downstream depends on the table.

If two people have ever each assumed the other was fixing a load, write the ownership table this week; certification waits until the runbooks exist.
