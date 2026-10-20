---
title: "Idempotent Writes, and Why Retries Duplicate Data"
author: Michael John Peña
draft: false
date: 2026-10-21T12:00:00Z
description: "Every pipeline gets retried eventually, and a non-idempotent write turns each retry into duplicates. Four patterns that make a write safe to repeat."
tags:
  - Data Engineering
  - Spark
  - Delta Lake
  - Reliability
  - Pipelines
---

A load step fails at 01:47. The orchestrator does what it was configured to do: waits thirty seconds and tries again. The retry succeeds, the run goes green, and nobody is woken up. At 09:00 finance asks why yesterday's revenue is exactly double.

Nothing was broken, and that's the uncomfortable part. The first attempt *did* write its rows. What failed was everything after the write: the acknowledgment timed out, the status call returned a 503, the driver was evicted a second after the sink accepted the data. The orchestrator saw a failed step. The table saw a successful one. The retry wrote everything a second time.

This is the most common way a healthy-looking pipeline produces wrong numbers. Fixing it doesn't need a new tool. It needs the write to be **idempotent**.

## The definition that matters

An operation is idempotent if doing it once and doing it N times leave the system in the same state. For a pipeline, that means running the job twice for the same input produces the same table as running it once.

That property matters because *every* layer of a data platform will re-execute work at some point:

- Orchestrators retry failed activities. Fabric and ADF pipelines, Airflow, and Dagster all have per-step retry policies.
- Spark re-runs failed tasks, and with speculative execution it launches duplicate copies of slow ones.
- Streaming jobs restart from their last checkpoint and replay any micro-batch that wasn't recorded as complete.
- Kafka consumers re-read anything after the last committed offset.
- People rerun jobs and backfill date ranges.

None of these systems promises to run your code exactly once. What they offer is **at-least-once** execution. "Exactly-once" isn't a feature you can switch on in the transport. It's something you build at the sink.

<div class="cl cl-key">
<div class="cl-tag">The equation</div>
<div class="cl-body">

**Exactly-once results = at-least-once delivery + an idempotent write.** The platform guarantees the first half. The second half is your job, and it lives in how you write to the target.

</div>
</div>

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 322" role="img" aria-label="Two lanes compare a retry. In the naive append lane, attempt one writes ten thousand rows, the acknowledgment is lost, the orchestrator retries, attempt two appends ten thousand rows again, and the table ends with twenty thousand rows. In the idempotent lane, both attempts merge on order_id, the second attempt matches existing rows, and the table ends with ten thousand rows.">
<defs>
<marker id="iwN" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker>
<marker id="iwR" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-read"/></marker>
</defs>
<rect x="20" y="20" width="860" height="130" rx="16" class="ff-zone ff-zone-danger"/>
<text x="40" y="42" class="ff-zlabel">NAIVE APPEND · AT-LEAST-ONCE BECOMES DUPLICATES</text>
<rect x="36" y="60" width="148" height="70" rx="11" class="ff-node"/>
<text x="110" y="90" text-anchor="middle" class="ff-title">Attempt 1</text>
<text x="110" y="110" text-anchor="middle" class="ff-tok">append 10,000</text>
<rect x="206" y="60" width="148" height="70" rx="11" class="ff-node"/>
<text x="280" y="90" text-anchor="middle" class="ff-title">Write commits</text>
<text x="280" y="110" text-anchor="middle" class="ff-sub">ack never arrives</text>
<rect x="376" y="60" width="148" height="70" rx="11" class="ff-node ff-node-am"/>
<text x="450" y="90" text-anchor="middle" class="ff-title">Retry</text>
<text x="450" y="110" text-anchor="middle" class="ff-sub">step marked failed</text>
<rect x="546" y="60" width="148" height="70" rx="11" class="ff-node"/>
<text x="620" y="90" text-anchor="middle" class="ff-title">Attempt 2</text>
<text x="620" y="110" text-anchor="middle" class="ff-tok">append 10,000</text>
<rect x="716" y="60" width="148" height="70" rx="11" class="ff-node ff-node-dn"/>
<text x="790" y="90" text-anchor="middle" class="ff-title">Target table</text>
<text x="790" y="110" text-anchor="middle" class="ff-tok ff-amt">20,000 rows</text>
<line x1="186" y1="95" x2="204" y2="95" class="ff-edge" marker-end="url(#iwN)"/>
<line x1="356" y1="95" x2="374" y2="95" class="ff-edge" marker-end="url(#iwN)"/>
<line x1="526" y1="95" x2="544" y2="95" class="ff-edge" marker-end="url(#iwN)"/>
<line x1="696" y1="95" x2="714" y2="95" class="ff-edge" marker-end="url(#iwN)"/>
<rect x="20" y="172" width="860" height="130" rx="16" class="ff-zone ff-zone-read"/>
<text x="40" y="194" class="ff-zlabel">IDEMPOTENT WRITE · A RETRY IS A NO-OP</text>
<rect x="36" y="212" width="148" height="70" rx="11" class="ff-node ff-node-cy"/>
<text x="110" y="242" text-anchor="middle" class="ff-title">Attempt 1</text>
<text x="110" y="262" text-anchor="middle" class="ff-tok">MERGE on order_id</text>
<rect x="206" y="212" width="148" height="70" rx="11" class="ff-node"/>
<text x="280" y="242" text-anchor="middle" class="ff-title">Write commits</text>
<text x="280" y="262" text-anchor="middle" class="ff-sub">ack never arrives</text>
<rect x="376" y="212" width="148" height="70" rx="11" class="ff-node ff-node-am"/>
<text x="450" y="242" text-anchor="middle" class="ff-title">Retry</text>
<text x="450" y="262" text-anchor="middle" class="ff-sub">step marked failed</text>
<rect x="546" y="212" width="148" height="70" rx="11" class="ff-node ff-node-cy"/>
<text x="620" y="242" text-anchor="middle" class="ff-title">Attempt 2</text>
<text x="620" y="262" text-anchor="middle" class="ff-sub">every key matches</text>
<rect x="716" y="212" width="148" height="70" rx="11" class="ff-node ff-node-cy"/>
<text x="790" y="242" text-anchor="middle" class="ff-title">Target table</text>
<text x="790" y="262" text-anchor="middle" class="ff-tok">10,000 rows</text>
<line x1="186" y1="247" x2="204" y2="247" class="ff-edge-read" marker-end="url(#iwR)"/>
<line x1="356" y1="247" x2="374" y2="247" class="ff-edge-read" marker-end="url(#iwR)"/>
<line x1="526" y1="247" x2="544" y2="247" class="ff-edge-read" marker-end="url(#iwR)"/>
<line x1="696" y1="247" x2="714" y2="247" class="ff-edge-read" marker-end="url(#iwR)"/>
</svg>
<figcaption><b>Same failure, same retry, different outcome.</b> The retry is identical in both lanes. Only the shape of the write decides whether it doubles the data.</figcaption>
</figure>

## Where the second copy comes from

It helps to list the mechanisms that re-execute work, because each one replays a different unit and breaks a different kind of write.

| Re-execution source | What gets replayed | Duplicates when the write is… |
|---|---|---|
| Orchestrator retry | The whole activity | An append (`INSERT INTO`, copy activity in append mode) |
| Spark task retry / speculation | One task's partition of output | Non-transactional: JDBC, REST calls, files written outside the commit protocol |
| Streaming restart | The last uncommitted micro-batch | A plain append inside `foreachBatch` |
| Manual rerun or backfill | A date range | Anything keyed on "rows I haven't seen", or plain appends |
| Upstream redelivery | Events you already have | Trusting the producer never to resend |

The Spark row is the subtle one. Files written through `DataFrameWriter` into a Delta table go through a commit protocol: a failed task's output is never committed, so task retries are safe. The JDBC writer is different. It commits one database transaction per partition, so a task that commits and then loses its executor before reporting success gets rescheduled, and its rows go in a second time. Anything you do inside `foreachPartition`, like calling an API or writing to a queue, has the same exposure.

## Four patterns that make a write safe to repeat

### 1. Replace the unit of work

If the job's logical unit is one day of data, make the write *replace* that day instead of adding to it. Rerunning then replaces the previous attempt's output with an identical copy.

<div class="code-title">silver/orders_daily.py</div>

```python
def load_day(spark, logical_date: str):
    day = (
        spark.read.table("bronze.orders")
        .where(f"order_date = '{logical_date}'")
        .transform(clean_orders)          # deterministic: same input -> same rows
    )

    (day.write.format("delta")
        .mode("overwrite")
        .option("replaceWhere", f"order_date = '{logical_date}'")
        .saveAsTable("silver.orders"))
```

[`replaceWhere`](https://docs.delta.io/latest/delta-batch.html) atomically deletes the rows matching the predicate and writes the new ones in a single Delta commit. Readers see either the old day or the new day, never half of each. Since Delta 2.0 the predicate can be on any column, not only partition columns, and by default Delta rejects the write if any incoming row falls outside the predicate.

<div class="cl cl-warn">
<div class="cl-tag">Classic 2 AM</div>
<div class="cl-body">

`mode("overwrite")` **without** `replaceWhere` on a partitioned table replaces the *entire table* under Spark's default static overwrite mode. A backfill of one day that deletes three years of history is one missing option away. Either always pass `replaceWhere`, or set `partitionOverwriteMode` to `dynamic` explicitly and know which one your job relies on.

</div>
</div>

This pattern requires one thing: the job must recompute the whole unit from its source every time. If it computes "only rows since my last cursor", replacing the day with that partial set deletes data. That leads to the second pattern.

### 2. Upsert on a natural key

When the unit of work isn't a clean slice, as with CDC feeds, API extracts, or event streams with updates, key the write on something that identifies the real-world entity and `MERGE` on it.

<div class="code-title">silver/merge_orders.sql</div>

```sql
MERGE INTO silver.orders AS t
USING (
  SELECT *
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY order_id
             ORDER BY source_updated_at DESC, source_lsn DESC
           ) AS rn
    FROM bronze.orders_changes
    WHERE batch_date = '2026-10-01'
  )
  WHERE rn = 1
) AS s
ON t.order_id = s.order_id
WHEN MATCHED AND s.source_updated_at > t.source_updated_at THEN
  UPDATE SET *
WHEN NOT MATCHED THEN
  INSERT *
```

Three details make this idempotent rather than just "an upsert":

1. **The source is deduplicated first.** Delta [fails a `MERGE`](https://docs.delta.io/latest/delta-update.html) when more than one source row matches the same target row. Even if it didn't, the result would depend on which row won. Deduplicate inside the batch with a deterministic ordering.
2. **The tiebreak is total.** `source_updated_at` alone can tie. Add a second column that can't, like a log sequence number or offset, so two runs always choose the same row.
3. **The update is guarded.** `s.source_updated_at > t.source_updated_at` means replaying an *older* batch can't overwrite newer state. Without the guard, a rerun of last Tuesday quietly rolls today's rows back to Tuesday's values.

`rn` ends up in the table here because of `INSERT *`. In production, list the columns explicitly. That habit also protects you from [schema drift](/blog/2026-10-21-schema-evolution/).

### 3. Let the sink remember what it has already committed

Structured Streaming into a Delta sink is exactly-once on its own: the checkpoint and the Delta log together record which batch IDs have been written. As soon as you use `foreachBatch`, which you need for `MERGE` or for writing to several tables, that guarantee goes away. A batch that wrote its data but crashed before the checkpoint recorded it gets replayed after the restart.

Delta gives you a direct fix, [idempotent table writes](https://docs.delta.io/latest/delta-streaming.html): tag each write with an application ID and a monotonically increasing version, and Delta skips any write whose version it has already seen for that ID.

<div class="code-title">bronze/stream_orders.py</div>

```python
APP_ID = "bronze_orders_ingest_v1"

def write_batch(batch_df, batch_id: int):
    (batch_df.write.format("delta")
        .mode("append")
        .option("txnAppId", APP_ID)
        .option("txnVersion", batch_id)
        .saveAsTable("bronze.orders"))

(spark.readStream.table("landing.orders_raw")
    .writeStream
    .foreachBatch(write_batch)
    .option("checkpointLocation", "Files/checkpoints/bronze_orders")
    .start())
```

<div class="cl cl-warn">
<div class="cl-tag">Gotcha</div>
<div class="cl-body">

If you ever delete or replace the checkpoint, `batch_id` restarts from 0. Delta still remembers the old high version for `APP_ID`, so it will **silently skip** every new batch until the counter catches up. Treat the app ID as belonging to the checkpoint: new checkpoint, new app ID (`_v2`).

</div>
</div>

### 4. Idempotency keys for side effects

Some writes aren't to tables: sending an email, posting to a billing API, publishing an event. For these, give each logical operation a deterministic key, derived from the input (for example `sha2(concat(order_id, ':', 'invoice'), 256)`) and never from `uuid()` at runtime. Then either:

- send the key to a service that honours it (many payment and messaging APIs accept an `Idempotency-Key` header), or
- record processed keys in a ledger table and skip any key already present. The ledger insert and the side effect can't share a transaction across systems, so prefer writing the *intent* to an outbox table in the same transaction as your data, with a separate sender that is itself keyed.

## What quietly breaks idempotence

Most pipelines that duplicate data were meant to be idempotent. They stopped being idempotent through one of these:

- **Relative dates in the job body.** `WHERE order_date = current_date() - 1` processes a different day if the retry happens after midnight. Pass the logical date in from the orchestrator as a parameter and never derive it from the clock inside the job. [Event time vs processing time](/blog/2026-10-21-event-time-vs-processing-time/) goes deeper on this.
- **Generated values used as keys.** `uuid()`, `monotonically_increasing_id()`, `current_timestamp()`, and identity columns all produce new values on every run, so a `MERGE` on them never matches. Ingestion timestamps are fine as attributes. They must never be part of the key.
- **Cursors that move before the data lands.** If the high-watermark ("last processed `updated_at`") is saved before the write commits, a failure between the two skips data. If it's saved after, in a separate system, a failure between the two duplicates data. Derive the cursor from the target (`SELECT max(source_updated_at) FROM silver.orders`) or commit it in the same transaction.
- **A non-deterministic transform.** `dropDuplicates()` without a defined order, `first()` over an unordered group, or sampling: the row count stays stable across reruns, but the *content* doesn't. That is still a correctness bug.
- **Copy activities in append mode.** The default behaviour of many low-code copy tools is to append. Write to a staging table that you truncate, then `MERGE` or `replaceWhere` from staging.

## The test: run it twice

Idempotence is easy to assert and almost nobody does. Run the job, fingerprint the target, run it again with the same parameters, and compare.

<div class="code-title">tests/test_idempotence.py</div>

```python
def fingerprint(spark, table: str, key: str, measure: str):
    return spark.sql(f"""
        SELECT count(*)              AS row_count,
               count(DISTINCT {key}) AS key_count,
               sum({measure})        AS total
        FROM {table}
    """).first()

def test_orders_load_is_idempotent(spark, seeded_bronze):
    load_day(spark, logical_date="2026-10-01")
    first = fingerprint(spark, "silver.orders", "order_id", "amount")

    load_day(spark, logical_date="2026-10-01")
    second = fingerprint(spark, "silver.orders", "order_id", "amount")

    assert first == second
    assert first.row_count == first.key_count   # one row per order: the grain holds
```

The last assertion checks something slightly different: that the table has the [grain](/blog/2026-10-21-the-grain-of-a-table/) it claims to have. Duplicates from retries and fan-out from bad joins look the same in a dashboard, and the same assertion catches both.

## On Monday

- For each job, write down its unit of work and how it's written: replace, merge, or append. Every append needs a reason.
- Make the logical date a parameter. Remove `current_date()` from job bodies.
- Make sure every `MERGE` source is deduplicated with a total ordering and guarded against older data.
- For `foreachBatch` sinks, add `txnAppId` and `txnVersion`, and tie the app ID to the checkpoint.
- Add the run-it-twice test to CI for the tables people make decisions from.

The orchestrator's retry button is a promise that running the job again is safe. Idempotent writes are what keep that promise.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 1 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li class="on">Idempotent writes, and why retries duplicate data</li>
<li><a href="/blog/2026-10-21-the-grain-of-a-table/">The grain of a table</a></li>
<li><a href="/blog/2026-10-21-event-time-vs-processing-time/">Event time vs processing time</a></li>
<li><a href="/blog/2026-10-21-late-arriving-data/">Late-arriving data</a></li>
<li><a href="/blog/2026-10-21-data-skew-in-spark/">Data skew</a></li>
<li><a href="/blog/2026-10-21-reading-a-spark-query-plan/">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-10-21-partition-pruning/">Partition pruning</a></li>
<li><a href="/blog/2026-10-21-the-small-files-problem/">The small files problem</a></li>
<li><a href="/blog/2026-10-21-slowly-changing-dimensions/">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution/">Schema evolution</a></li>
</ol>
</nav>
