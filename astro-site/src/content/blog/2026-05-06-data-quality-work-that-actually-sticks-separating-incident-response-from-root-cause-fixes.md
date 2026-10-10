---
title: "Write-Audit-Publish in Fabric: Stop Bad Data Before It Ships"
description: "Why many data quality root-cause fixes come down to where the check runs, and how to build a write-audit-publish boundary on a Fabric lakehouse."
author: Michael John Peña
draft: false
date: 2026-05-06
tags:
  - Data Quality
  - Microsoft Fabric
  - Data Engineering
  - Delta Lake
  - Observability
---

Most data quality checks run after the data has already been published. The load writes to the table the reports read, then a validation notebook runs, then someone gets an alert, and by then the semantic model has refreshed and a feature pipeline has picked up the bad rows. The check did its job, and consumers still saw the bad data. If your incident reviews keep ending with "we caught it, just not in time", the problem is where the check sits, not what it checks.

## The root cause is usually the order of operations

In [Two Tickets per Data Incident](/blog/2026-03-23-operational-data-quality-notes-separating-incident-response-from-root-cause-fixes/) I argued that every incident needs a containment ticket and a separate root-cause ticket, and that the root-cause ticket should produce a control. My view is that a large share of those controls turn out to be the same fix: move an existing check so it runs before consumers can read the data rather than after.

That's worth stating plainly, because the instinct after an incident is to add a new check. Often the check already existed. It ran on the published table, found the problem within minutes, and still lost the race against a scheduled refresh. A new check in the same position loses the same race.

Containment and root cause also feel very different once the boundary moves. With checks after publishing, containment means pausing pipelines, rolling back a Delta table and telling consumers. With checks before publishing, a failed audit means nothing was published: the batch sits in quarantine, yesterday's data stays live, and the incident is a delayed load rather than a wrong number. That is a much easier conversation to have with the business.

## What write-audit-publish means

Write-audit-publish (WAP) is a simple pattern with a precise rule: no batch reaches the table consumers read until it has passed its checks.

1. **Write** the incoming batch somewhere consumers don't read from.
2. **Audit** that batch with the checks you care about.
3. **Publish** it to the consumer-facing table in one atomic step, or quarantine it and fail the run.

Some table formats support this natively. Apache Iceberg, for example, can [stage a write on an audit branch](https://iceberg.apache.org/docs/latest/branching/) and publish it later by fast-forwarding the main branch. Delta Lake, which is what a Fabric lakehouse uses, doesn't have table branches, so you build the boundary yourself with a staging table and a single `MERGE`. That turns out to be enough, because a Delta `MERGE` is one transaction: readers of the published table see the version before it or the version after it, never a half-applied batch.

This is different from the readiness gate I described in [Fabric Daily Loads: Gate on Data Readiness, Not the Clock](/blog/2026-03-05-pipelines-i-trust-in-fabric-reducing-brittle-dependencies-in-daily-loads/). A readiness gate asks "is the source ready to be read?" before the load starts. WAP asks "is what we produced fit to publish?" after the transformation and before anyone can see it. You want both; they catch different failures.

## Building the boundary on a Fabric lakehouse

The notebook below is the whole pattern for one table. It lands the batch in `orders_staging`, audits it, records the result, and then either merges into `orders` or copies the batch to `orders_quarantine` and fails. It assumes a Fabric notebook attached to a lakehouse that already contains an `orders` table with the same schema, and a landing folder of Parquet files. Run it from a pipeline Notebook activity so a failed audit fails the pipeline run.

For brevity the staging and quarantine tables sit next to `orders`, but in a real deployment they belong somewhere report and semantic-model identities can't read: a separate lakehouse, or a schema such as `staging.orders` in a schema-enabled lakehouse with access granted only to the pipeline's identity. Any managed table in the consumer lakehouse also shows up in its SQL analytics endpoint, so "staging" by name alone isn't a boundary.

```python
from datetime import datetime, timezone

# Parameters (mark this cell as a parameter cell in the Fabric notebook)
landing_path = "Files/landing/orders/<batch-folder>/"
min_volume_ratio = 0.5   # fail if fewer than 50% of the usual row count arrives
max_volume_ratio = 2.0   # fail if more than double the usual row count arrives

batch_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

# 1. WRITE: land the batch where consumers don't read from
(spark.read.parquet(landing_path)
    .write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("orders_staging"))

# 2. AUDIT: batch-level checks against the staged data
stats = spark.sql("""
    SELECT
        COUNT(*)                                AS row_count,
        COUNT_IF(order_id IS NULL)              AS null_keys,
        COUNT(order_id) - COUNT(DISTINCT order_id) AS duplicate_keys,
        COUNT_IF(order_total < 0)               AS negative_totals
    FROM orders_staging
""").first()

failures = []
if stats["row_count"] == 0:
    failures.append("empty batch")
if stats["null_keys"] > 0:
    failures.append(f"{stats['null_keys']} rows with null order_id")
if stats["duplicate_keys"] > 0:
    failures.append(f"{stats['duplicate_keys']} duplicate order_id values")
if stats["negative_totals"] > 0:
    failures.append(f"{stats['negative_totals']} rows with negative order_total")

# Volume against the median of the last 14 batches that passed and were published
if spark.catalog.tableExists("orders_audit_log"):
    baseline = spark.sql("""
        SELECT percentile_approx(row_count, 0.5) AS median_rows
        FROM (
            SELECT row_count FROM orders_audit_log
            WHERE passed AND published
            ORDER BY audited_at DESC
            LIMIT 14
        )
    """).first()["median_rows"]
    if baseline:
        ratio = stats["row_count"] / baseline
        if ratio < min_volume_ratio or ratio > max_volume_ratio:
            failures.append(f"row count {stats['row_count']} vs median {baseline}")

passed = not failures

def log_audit(published):
    # Append one row per audit; the baseline only uses batches that passed AND published
    spark.createDataFrame(
        [(batch_id, datetime.now(timezone.utc), stats["row_count"],
          passed, published, "; ".join(failures))],
        "batch_id string, audited_at timestamp, row_count long, "
        "passed boolean, published boolean, failures string",
    ).write.format("delta").mode("append").saveAsTable("orders_audit_log")

# 3. PUBLISH or QUARANTINE
if passed:
    try:
        spark.sql("""
            MERGE INTO orders AS t
            USING orders_staging AS s
            ON t.order_id = s.order_id
            WHEN MATCHED THEN UPDATE SET *
            WHEN NOT MATCHED THEN INSERT *
        """)
    except Exception:
        log_audit(published=False)   # passed the audit, but never reached consumers
        raise
    log_audit(published=True)
else:
    (spark.table("orders_staging")
        .selectExpr(f"'{batch_id}' AS batch_id", "*")
        .write.format("delta")
        .mode("append")
        .option("mergeSchema", "true")
        .saveAsTable("orders_quarantine"))
    log_audit(published=False)
    raise ValueError(f"Batch {batch_id} failed audit: {'; '.join(failures)}")
```

A few design choices in there are deliberate.

**The audit is batch-level, not row-level.** Null keys, duplicates and volume are properties of the batch. A row-level filter that quietly drops bad rows would make the symptom disappear and hide the next instance, which is the opposite of what a root-cause fix should do.

**The run fails loudly.** Raising an exception fails the Notebook activity, so the pipeline run shows red and whatever alerting you already have on pipeline failures fires. I'd rather wire alerts to that than invent a second channel. If you want the pipeline to branch instead, for example to send a specific message, `notebookutils.notebook.exit()` can [return a value to the calling pipeline](https://learn.microsoft.com/fabric/data-engineering/notebookutils/notebookutils-notebook-run); just don't call it inside a `try` block, where it won't take effect.

**The audit log is the baseline.** Volume thresholds based on a hard-coded number go stale within a quarter. Using the median of recent batches that passed and were actually published means the check adapts to growth, a batch whose `MERGE` failed after a clean audit (schema drift, capacity throttling, a concurrent-write conflict) never skews the baseline, and the same table answers "when did this last fail, and why?" in a review.

**The quarantine keeps the evidence.** When the audit fails, the batch is preserved with its `batch_id`, so the root-cause work starts from the actual rows rather than from a description of them. Set a retention rule for that table; it's evidence, not an archive.

## Where row-level rules belong

Not every rule needs this machinery. True invariants on a single row, such as "order_id is never null", can live in the table itself as Delta Lake [`CHECK` and `NOT NULL` constraints](https://docs.delta.io/delta-constraints/), which reject the whole write if one row violates them. That's a good backstop on the published table even with WAP in front of it.

If your silver layer is built from materialized lake views, row-level rules can be declared there too. [Materialized lake views](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/overview-materialized-lake-view) became generally available at FabCon Atlanta in March 2026, and they support constraints with `ON MISMATCH DROP` (drop the row and count it in the lineage view) or `ON MISMATCH FAIL` (stop the refresh), with `FAIL` the default. The [data quality in materialized lake views](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality) page covers the syntax. What a constraint can't express is a batch-level rule like "row count fell by 60% against the usual run", which is exactly the failure that tends to slip through. I treat them as complementary: declarative row rules in the view, batch audits at the boundary.

| Rule type | Example | Where I'd put it |
|---|---|---|
| Row invariant | `order_id` is never null | Delta constraint or MLV `ON MISMATCH FAIL` |
| Row validity you'd rather drop | Malformed postcode on a marketing table | MLV `ON MISMATCH DROP`, with the drop count watched |
| Batch property | Volume, duplicates, empty batch | WAP audit before publish |
| Cross-table expectation | Every order has a known customer | WAP audit before publish |

## What it costs

WAP isn't free, and I wouldn't apply it to every table.

- **Latency.** Each batch is written twice and audited in between. On a large table that's real compute and minutes of wall-clock time. For a daily load it rarely matters; for a near-real-time table it might.
- **Stale over wrong.** A failed audit means consumers see yesterday's data. That's the right default for financial and regulatory reporting, and the wrong one for an operational dashboard where slightly wrong but current is more useful. Decide this per table with the people who own the decision, and write it down.
- **Single writer.** The staging table is overwritten on every run, so two runs for the same table must never overlap. One orchestrating pipeline per table, with concurrency set to one, keeps that true.
- **More tables to maintain.** Staging, quarantine and the audit log are ordinary Delta tables with their own file housekeeping. Staging is the one that bites: every overwrite leaves the previous version's files behind until something vacuums them. Schedule `VACUUM` and `OPTIMIZE` (or lakehouse table maintenance) on all three, and give each a retention period that matches what it's for.
- **Thresholds need an owner.** A volume ratio that nobody revisits will either cry wolf or wave things through. Each audit should have a named owner, the same way every alert should.

## When not to bother

Skip WAP for exploratory tables, sandbox lakehouses and anything without a downstream consumer who would make a decision on it. Skip it where the source is already contract-tested by the producing team and the table is a straight copy. And don't use it as a substitute for fixing upstream: if the same audit fails every week for the same reason, the root-cause fix belongs with the team producing the data, and the audit is only buying you time.

## The decision to make

For each table that feeds a report or a model, ask one question: when this data is wrong, do consumers see it before we do? If the answer is yes, your next root-cause fix probably isn't a new check. It's moving the checks you already have to the other side of the publish step, so the worst outcome of a bad batch is a late table rather than a wrong number.
