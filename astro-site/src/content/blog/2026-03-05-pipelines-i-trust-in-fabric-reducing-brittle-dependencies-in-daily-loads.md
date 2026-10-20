---
title: "Fabric Daily Loads: Gate on Data Readiness, Not the Clock"
description: "How to remove brittle dependencies from daily Fabric loads with one orchestrating pipeline, readiness checks, idempotent writes and deliberate retries."
author: Michael John Peña
draft: false
date: 2026-03-05
tags:
  - Microsoft Fabric
  - Data Factory
  - Data Engineering
  - Architecture
---

Most daily loads in Microsoft Fabric don't break because a step fails. They break because step B assumed step A had finished, and nothing actually checked. The bronze load is scheduled for 5:00, the silver notebook for 5:45, the semantic model refresh for 6:30, and the whole thing works until the source system runs slow, the silver notebook reads a half-loaded table, and the report shows stale numbers with a green tick next to every run.

That is a dependency problem. Adding retries or extra buffer time only hides it. The fix is to make every dependency explicit: who runs after whom, what "ready" means, and what happens when the answer is no.

## Where brittle dependencies hide

Before changing anything, I list the dependencies a daily load actually relies on. They rarely look like dependencies on a diagram.

| Hidden dependency | What it looks like | Why it breaks |
|---|---|---|
| Time offsets | Separate schedules staggered by 30–60 minutes | A slow upstream run is invisible to the downstream schedule |
| Row-count optimism | "If the copy succeeded, the data is there" | A successful copy of zero rows is still a success |
| Shared staging tables | Two pipelines truncate and reload the same table | Concurrent or partial runs corrupt each other's input |
| Schema assumptions | A notebook selects columns by name with no check | An upstream column rename fails three steps later, far from the cause |
| Coupled refreshes | Semantic model refresh scheduled in the Power BI service | It refreshes whether or not the lakehouse load finished |

Every row in that table is a promise one team made to another without writing it down. The rest of this post is about turning those promises into checks.

## One pipeline owns the order

My first rule is that a daily load has exactly one schedule, attached to one parent pipeline, and that pipeline owns the sequence. Child pipelines and notebooks don't have their own schedules. If you find a child with a schedule "just in case", that's a second source of truth about ordering, and it will eventually disagree with the first.

In Fabric Data Factory the parent calls children with the [Invoke pipeline activity](https://learn.microsoft.com/fabric/data-factory/invoke-pipeline-activity) and chains them with dependency conditions: on success, on fail, on completion and on skip. There are two versions of that activity. The newer one previewed in 2024 and is now generally available.

| | Invoke pipeline (legacy) | Invoke pipeline (newer, GA) |
|---|---|---|
| Scope | Same workspace only | Same or other workspaces |
| Authentication | None to manage | Fabric connection: organisational account, service principal or workspace identity |
| Azure Data Factory and Synapse pipelines | Not supported | Supported |
| Child-run monitoring | No | Yes, in Monitor hub |

The trade-off is ownership. The newer activity needs a connection object and credentials that someone has to own and rotate, while the legacy one has nothing to manage. My preference is to keep the daily chain inside one workspace where I can, and treat cross-workspace calls as a boundary between teams that needs its own contract.

The parent pipeline also becomes the single place to look when someone asks "did last night's load finish?" With the newer Invoke pipeline activity, Monitor hub shows child runs alongside the parent. With the legacy one you only see the parent, so have each child log its own `@pipeline().RunId` and `@pipeline()?.TriggeredByPipelineRunId` (the parent's run ID, [a documented system variable](https://learn.microsoft.com/fabric/data-factory/parameters)) to your control table. Either way, one failed parent run tells you where to look instead of five independently green ones.

When a sequence is genuinely event-shaped, such as a partner dropping a file at an unpredictable time, don't fake it with a frequent schedule. [OneLake events](https://learn.microsoft.com/fabric/real-time-hub/explore-fabric-onelake-events) are generally available in Real-Time hub, and a `FileCreated` event can feed an Activator rule that starts the pipeline when a file lands. The triggered pipeline must tolerate being started twice for the same file.

## Gate on readiness

An activity succeeding tells you the activity ran. It doesn't tell you the data is fit for the next step. So between each layer I put a readiness gate: a small check that returns a yes or no the pipeline can branch on.

The simplest version I trust is a control table in the lakehouse that every load writes to, plus a notebook that reads it and answers one question: is this batch complete and plausible? The notebook exits with a small JSON payload, and the pipeline decides what to do with it.

The control table is deliberately small. This Spark SQL fragment creates it once in the lakehouse:

```sql
CREATE TABLE IF NOT EXISTS ops_load_control (
    table_name   STRING,
    batch_date   DATE,
    status       STRING,
    row_count    BIGINT,
    completed_at TIMESTAMP
) USING DELTA;
```

The upstream loader writes one row as its very last step, after its own data write has committed. This PySpark fragment from the bronze loader assumes `batch_date` came in as a pipeline parameter and `row_count` from the write result:

```python
spark.sql(
    f"INSERT INTO ops_load_control VALUES "
    f"('bronze_sales_orders', DATE'{batch_date}', 'complete', {row_count}, current_timestamp())"
)
```

This notebook is complete as shown for a Fabric PySpark notebook attached to a lakehouse, with placeholder table names. It has two cells, and the split matters: Fabric injects pipeline overrides in a new cell directly after the cell marked as the parameter cell, so anything that should use the overridden values has to live below it. `notebookutils` is the built-in utility library in Fabric notebooks.

Cell 1 (parameter cell, toggled with "Toggle parameter cell" in the notebook):

```python
batch_date = ""
source_table = "bronze_sales_orders"
control_table = "ops_load_control"
min_expected_rows = 1000
required_columns = "order_id,order_date,customer_id,amount"
```

Cell 2:

```python
import json

from pyspark.sql import functions as F

result = {"batch_date": batch_date, "ready": False, "reason": ""}
columns = [c.strip() for c in required_columns.split(",") if c.strip()]

if not batch_date:
    result["reason"] = "No batch_date was passed by the orchestrating pipeline"
else:
    source_df = spark.table(source_table)
    missing = [c for c in columns if c not in source_df.columns]

    if missing:
        result["reason"] = f"Missing columns: {missing}"
    else:
        upstream_done = (
            spark.table(control_table)
            .where(
                (F.col("table_name") == source_table)
                & (F.col("batch_date") == F.lit(batch_date))
                & (F.col("status") == "complete")
            )
            .limit(1)
            .count()
            == 1
        )

        if not upstream_done:
            result["reason"] = "Upstream load has not marked this batch complete"
        else:
            df = source_df.where(F.to_date(F.col("order_date")) == F.lit(batch_date).cast("date"))
            row_count = df.count()
            if row_count < int(min_expected_rows):
                result["reason"] = f"Only {row_count} rows; expected at least {min_expected_rows}"
            else:
                result["ready"] = True
                result["row_count"] = row_count

notebookutils.notebook.exit(json.dumps(result))
```

`required_columns` is a comma-separated string because Notebook activity base parameters only accept string, int, float and bool values, so a Python list can't be overridden from the pipeline.

`batch_date` is the business date being loaded: yesterday's Sydney calendar day, which the 5:00 run picks up. The gate compares it with `order_date` (wrapped in `to_date` so a timestamp column still matches), so it only makes sense for a closed batch; checking today at 5:00 would fail every morning. If your loader writes its own load-date column, filter on that instead. The parameter deliberately defaults to empty, and the gate fails if nothing is passed, because the orchestrator owns the batch date. Fabric notebook sessions run in UTC, so Python's `date.today()` (and Spark's `current_date()` unless `spark.sql.session.timeZone` is changed) depends on when the notebook happens to start relative to UTC midnight, and the offset to Sydney shifts with daylight saving. Deriving the date inside each notebook invites two steps to disagree. The parent pipeline computes it once and passes the same value to every gate and write:

```text
@formatDateTime(addDays(convertFromUtc(utcNow(), 'AUS Eastern Standard Time'), -1), 'yyyy-MM-dd')
```

That also makes reruns honest: rerunning an earlier batch means passing that batch's date, with no reliance on when the clock happens to fire.

In the parent pipeline, an If Condition activity reads the exit value. This is a pipeline expression fragment, not a complete pipeline definition:

```text
@equals(json(activity('Check_bronze_ready').output.result.exitValue).ready, true)
```

The true branch runs the silver transformation. The false branch runs a Fail activity with the `reason` in its message, so the run goes red with a sentence a human can act on, rather than going green with stale data.

A few deliberate choices in that check:

- **The thresholds are dull on purpose.** A minimum row count and a column list catch most real incidents. Statistical anomaly detection is worth adding later, but a check nobody understands is a check nobody maintains.
- **The upstream writer marks completion.** Whoever loads `bronze_sales_orders` writes `status = 'complete'` as its last step. Readers never infer it from file timestamps.
- **Failing is the correct outcome.** If the gate says no, the downstream steps should not run. A late report is an inconvenience. A wrong report that nobody flagged is an incident.

## Make every step safe to run twice

Explicit ordering only helps if a rerun is cheap and safe. If rerunning the silver step after a partial failure duplicates rows, people stop rerunning and start patching by hand, and that's where trust goes.

My rule is that every write is scoped to a batch and is idempotent for that batch. In practice that means one of two patterns on Delta tables: a `MERGE` on a business key, or an overwrite scoped to the batch with `replaceWhere`. Both land as a single Delta commit, so readers see either the old batch or the new one. This fragment assumes the silver table has a `batch_date` column and `silver_df` holds the transformed batch:

```python
(
    silver_df.write.format("delta")
    .mode("overwrite")
    .option("replaceWhere", f"batch_date = '{batch_date}'")
    .saveAsTable("silver_sales_orders")
)
```

I avoid a `DELETE` followed by an `INSERT`: that's two commits, and any reader between them, including a Direct Lake model that reframes automatically, sees the batch missing. I also stop sharing staging tables between pipelines. Each load gets its own staging location, so two runs can't truncate each other's input.

Idempotency is also what makes duplicate file events and activity retries safe: the second run produces the same result as the first.

## Retry what's transient, fail what's not

Activities such as Copy and Notebook have timeout, retry and retry interval settings on their General tab (not every activity does), and the temptation is to set retries to three everywhere and call it resilience. I don't. Retries are for transient faults: a throttled source, a brief network error, a capacity that was momentarily busy. They are useless against a missing column or an incomplete upstream batch, and on a slow failure they multiply the time before anyone finds out.

So copy activities and calls to external sources get a small number of retries with a sensible interval. Readiness gates and transformations get none. If a gate fails, retrying in 30 seconds won't make the upstream system finish faster.

The same thinking applies at the end of the chain. Instead of a separate refresh schedule in the Power BI service, the parent pipeline runs the [semantic model refresh activity](https://learn.microsoft.com/fabric/data-factory/semantic-model-refresh-activity) after the gold layer passes its own gate. The activity is generally available, and it can also refresh selected tables or partitions. The semantic model now refreshes when the data is ready, whatever the clock says.

Direct Lake models need one more step. By default they reframe automatically whenever the underlying Delta tables change, so a gold layer that is half-updated across tables, or not yet validated, can reach reports no matter what your gate says. For a gated load, turn off "Keep your Direct Lake data up to date" in the semantic model's settings and let the pipeline's semantic model refresh activity do the reframe once the gold gate passes. Microsoft's [Direct Lake framing documentation](https://learn.microsoft.com/fabric/fundamentals/direct-lake-how-it-works#framing) covers how reframing and automatic updates work. For tuning, see my [Direct Lake best practices](/blog/2024-01-17-direct-lake-best-practices/) post.

## When this is overkill

Not every load needs a control table and gates between every layer. I'd skip most of this when:

- **One person owns the whole chain** and it runs in minutes. A single pipeline with dependency conditions is enough; the gates exist to make cross-team promises explicit, and there's no cross-team promise.
- **The data is low stakes.** An exploratory dataset that someone checks by eye doesn't need a Fail activity paging anyone.
- **You're adding gates to compensate for an unreliable source.** Gates make bad data visible; they don't fix it. If a source fails twice a week, the conversation belongs with that source's owner.

The opposite mistake is common too: building a generic, metadata-driven orchestration framework before you have three loads that need it. Start with one parent pipeline and one gate on the dependency that hurts most, then generalise once the pattern has proven itself.

## The short version

If you take one change from this, remove the staggered schedules. Give the daily load one parent pipeline, make each layer prove it's ready before the next one starts, and make every write safe to rerun. The pipeline will go red more often at first. That's the point: the failures were always there, and now they show up at 5:10 with a reason attached instead of at 9:00 in a meeting.
