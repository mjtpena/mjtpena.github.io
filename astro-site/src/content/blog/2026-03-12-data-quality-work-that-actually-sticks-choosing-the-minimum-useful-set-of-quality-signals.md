---
title: "Five Data Quality Signals for the Data-to-AI Handoff"
description: "Why I'd track five quality signals per feature table at the data engineering to AI handoff, and how to compute them in a Fabric notebook without a new tool."
author: Michael John Peña
draft: false
date: 2026-03-12
tags:
  - Data Quality
  - Microsoft Fabric
  - Data Engineering
  - Observability
  - AI
---

When a model or a RAG pipeline starts producing worse answers, the first question is "did the data change?" Most teams can't answer that quickly, and it's not because they have too few checks. They have dozens of checks nobody owns, alerts nobody reads, and still no agreed definition of "the data is fine" at the point where data engineering hands a table to an AI team. The fix is a small, explicit set of quality signals that both sides agree on and that someone actually acts on.

## Why more checks make things worse

Data quality programmes tend to fail the same way. Someone installs a framework, profiles every table, generates hundreds of rules, and wires them all to a Teams channel. Within a month the channel is usually muted. The rules were never wrong, exactly. They just weren't tied to a decision.

A check earns its place only if three things are true:

1. **Someone owns it.** A named team, not "the platform".
2. **A failure changes what happens next.** The load stops, the consumer is told, or a ticket lands with the owner.
3. **The threshold was agreed by the producer and the consumer.** If the AI team can't say what a 5% null rate does to their model, the threshold is a guess.

Most auto-generated rules fail all three tests. That's why I'd rather start with fewer signals than with full coverage and trim later. Trimming never happens, because nobody wants to be the person who deleted the check that would have caught the next incident.

## The five signals I'd start with

For any table that crosses from data engineering into an AI workload (a feature table, a document index source, a training snapshot), these five signals cover most of the failures that actually reach a model.

| Signal | Question it answers | Typical action on failure |
|---|---|---|
| Freshness | Did the data arrive on time? | Hold downstream refresh, notify consumer |
| Volume | Did roughly the expected amount arrive? | Stop the load, page the producer |
| Schema contract | Are the agreed columns present with the agreed types? | Fail the pipeline, block the deploy |
| Completeness on key fields | Are the columns the model depends on populated? | Fail if above threshold, warn if near it |
| Validity of one critical field | Are values in the range or set the consumer expects? | Drop or quarantine rows, report the count |

### Freshness

Freshness is the signal people skip because it feels too obvious, and it's the one that catches the most silent failures. A pipeline that "succeeded" but read yesterday's extract looks perfectly healthy on every other check. Track the maximum load timestamp, not the pipeline run time. The run time tells you the orchestrator ran; the load timestamp tells you new data landed.

### Volume

Compare the row count of the latest load with a trailing median rather than a fixed number. Count the new batch, not the whole table: on an append-only table the total only grows, so a missed or half-loaded day would hide inside the tolerance band. Fixed thresholds break the first time the business has a good month. A tolerance band of 20–30% around the median of the previous seven batches is a reasonable start, then tighten it once you've seen a few weeks of real variance.

### Schema contract

This is the signal that matters most at the AI handoff. A renamed column or a type that drifts from integer to string won't always break a Spark job, but it will quietly break feature engineering downstream. The contract should be short: the columns the consumer actually reads and their types. Everything else in the table is the producer's business.

### Completeness on key fields

Pick the handful of columns the model or retrieval step genuinely depends on and track their null rate in the latest load. Not every column, and not the whole history, which dilutes one bad batch until it looks fine. If a column can be null 40% of the time without anyone noticing, it isn't a key field and doesn't need a check.

### Validity of one critical field

Choose the single field where a bad value does the most damage, such as a segment code used for routing, a negative tenure, or a currency that must be AUD. One well-chosen validity rule beats twenty generic range checks. Decide how it treats nulls, too: a check that only asks "is this value in the accepted set?" quietly skips nulls, so either count them as invalid or make sure the same column is also covered by the completeness check. The notebook below does both for `segment`.

## Computing the signals without a new tool

You don't need a dedicated observability product to start. A Fabric notebook that writes one row per signal into a Delta table gives you history, a place to point a Power BI report, and something an alert can watch. The fragment below assumes a lakehouse with a `customer_features` table that is appended to in batches stamped with a `_loaded_at` timestamp column, and uses the `spark` session a Fabric notebook provides.

```python
import statistics

from pyspark.sql import functions as F
from pyspark.sql.types import (
    DoubleType, StringType, StructField, StructType, TimestampType,
)

TABLE = "customer_features"
SIGNALS_TABLE = "quality_signals"
CONTRACT = {
    "columns": {
        "customer_id": "string",
        "tenure_days": "int",
        "segment": "string",
        "_loaded_at": "timestamp",
    },
    "key_columns": ["customer_id", "segment"],
    "accepted_segments": ["consumer", "smb", "enterprise"],
    "max_staleness_hours": 26.0,
    "volume_tolerance": 0.3,
    "max_null_rate": 0.01,
    "max_invalid_rate": 0.0,
}

df = spark.read.table(TABLE)
latest = df.agg(F.max("_loaded_at")).first()[0]
batch = df.where(F.col("_loaded_at") == latest)
results = []

def record(signal, value, threshold=None, passed=None):
    # threshold always holds a limit; rows with no limit are informational
    status = "info" if passed is None else ("pass" if passed else "fail")
    results.append((TABLE, signal, float(value),
                    None if threshold is None else float(threshold),
                    status, latest))

# 1. Freshness: hours since the newest row landed. This is an epoch
# difference, so it doesn't depend on the session timezone.
staleness = df.agg(
    ((F.unix_timestamp(F.current_timestamp())
      - F.unix_timestamp(F.max("_loaded_at"))) / 3600).alias("h")
).first()["h"]
staleness = staleness if staleness is not None else float("inf")
record("freshness_hours", staleness, CONTRACT["max_staleness_hours"],
       staleness <= CONTRACT["max_staleness_hours"])

# 2. Volume: latest batch row count against the median of the previous
# seven batches. One value per batch, so re-running the notebook on the
# same batch doesn't skew the baseline.
row_count = batch.count()
history = []
if spark.catalog.tableExists(SIGNALS_TABLE):
    history = [r["value"] for r in (
        spark.read.table(SIGNALS_TABLE)
        .where((F.col("table_name") == TABLE)
               & (F.col("signal") == "row_count")
               & (F.col("batch_loaded_at") != F.lit(latest)))
        .groupBy("batch_loaded_at")
        .agg(F.max_by("value", "checked_at").alias("value"))
        .orderBy(F.col("batch_loaded_at").desc()).limit(7).collect())]
baseline = statistics.median(history) if history else row_count
if baseline:
    deviation = abs(row_count - baseline) / baseline
else:
    deviation = float("inf") if row_count else 0.0
record("row_count", row_count)  # raw count, kept for the baseline
record("row_count_deviation", deviation, CONTRACT["volume_tolerance"],
       deviation <= CONTRACT["volume_tolerance"])

# 3. Schema contract: agreed columns present with agreed types
actual = dict(df.dtypes)
broken = [c for c, t in CONTRACT["columns"].items() if actual.get(c) != t]
record("schema_violations", len(broken), 0, not broken)

# 4. Completeness: worst null rate across key columns in the latest batch
null_rates = batch.agg(*[
    F.avg(F.col(c).isNull().cast("double")).alias(c)
    for c in CONTRACT["key_columns"]
]).first().asDict()
# An empty batch gives null averages, so signals 4 and 5 pass on 0.0;
# that's deliberate, because freshness and volume already fail it.
worst_null = max((v or 0.0) for v in null_rates.values())
record("max_null_rate", worst_null, CONTRACT["max_null_rate"],
       worst_null <= CONTRACT["max_null_rate"])

# 5. Validity: share of latest-batch rows with an unexpected segment.
# coalesce makes a null segment count as invalid instead of being skipped.
# As with completeness, an empty batch passes here; freshness/volume catch it.
invalid_rate = batch.agg(F.avg(F.coalesce(
    ~F.col("segment").isin(CONTRACT["accepted_segments"]), F.lit(True)
).cast("double")).alias("r")).first()["r"] or 0.0
record("invalid_segment_rate", invalid_rate, CONTRACT["max_invalid_rate"],
       invalid_rate <= CONTRACT["max_invalid_rate"])

schema = StructType([
    StructField("table_name", StringType()),
    StructField("signal", StringType()),
    StructField("value", DoubleType()),
    StructField("threshold", DoubleType()),
    StructField("status", StringType()),
    StructField("batch_loaded_at", TimestampType()),
])
(spark.createDataFrame(results, schema)
    .withColumn("checked_at", F.current_timestamp())
    .write.mode("append").saveAsTable(SIGNALS_TABLE))

failed = [r[1] for r in results if r[4] == "fail"]
if failed:
    raise RuntimeError(f"{TABLE} failed quality signals: {failed}")
```

Three design choices are worth calling out. The `threshold` column only ever holds a limit: the raw row count is written as an `info` row with no threshold, and the volume check is stored as a deviation against the tolerance, so a report or alert can treat every `fail` row the same way. The notebook also records every signal before it raises, so a failure still leaves history behind for the post-mortem. And it raises rather than logging, so a pipeline that calls the notebook stops instead of happily refreshing the AI team's index with broken data. If the "fail" path never stops anything, you've built a dashboard, not a quality gate.

For a fuller treatment of rule types in a Fabric lakehouse, see my earlier post on [implementing data quality checks in Fabric lakehouses](/blog/2025-11-02-november-ai-topic/).

## Push hard rules into the table itself

Some rules should never be "checked" at all; they should be impossible to violate. Delta Lake supports [`CHECK` constraints](https://docs.delta.io/delta-constraints/) that reject any write containing a bad row, and they work on lakehouse tables in Fabric Spark:

```sql
ALTER TABLE customer_features
ADD CONSTRAINT tenure_non_negative CHECK (tenure_days >= 0);
```

Adding the constraint validates the existing data first, so clean the table before you add it. The trade-off is bluntness: one bad row fails the whole write. That's right for invariants such as "tenure is never negative", and wrong for anything you'd rather quarantine than block. Adding a constraint also upgrades the table's writer protocol, so any older or non-Spark writer that doesn't support the feature will be refused; confirm that every engine writing to the table supports Delta `CHECK` constraints first.

If you're building medallion layers with Fabric's materialized lake views, they let you declare constraints with `ON MISMATCH DROP` or `ON MISMATCH FAIL`, and Fabric reports how many rows each constraint dropped in a data quality report. Materialized lake views have been in public preview since mid-2025, so I'd use them for new silver-layer work rather than retrofitting production pipelines. (If you're reading this later, the [Fabric What's new](https://learn.microsoft.com/fabric/fundamentals/whats-new) page will tell you whether that has changed.) The [data quality in materialized lake views](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality) page covers the syntax. It's the same idea as expectations in Databricks Lakeflow Spark Declarative Pipelines (formerly Delta Live Tables, which I covered [in an earlier post](/blog/2022-03-22-dlt-expectations-quality/)), which is a good sign: drop-or-fail is a pattern, not a product feature.

## Make the signal reach a person

A signal nobody sees is a signal that doesn't exist. Once the results are in a Delta table, you can put [Fabric Activator](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-introduction) on a Power BI report. An Activator rule on a Power BI visual evaluates a measure plotted in that visual, not a text column changing value, so build the measure first:

```dax
Failed Signals =
VAR LastCheck = MAX ( quality_signals[checked_at] )
RETURN
    CALCULATE (
        COUNTROWS ( quality_signals ),
        quality_signals[status] = "fail",
        quality_signals[checked_at] = LastCheck
    )
```

Put it in a table or bar chart sliced by `table_name`, so `MAX(checked_at)` is evaluated per table and each table's latest run is counted on its own. Without that slice, the measure only sees whichever table was checked most recently. Then set an Activator alert on that visual for when `Failed Signals` rises above zero. Route freshness and volume failures to the producing team, and schema and validity failures to both sides, because those are contract conversations.

## When not to do this

- **Exploratory or one-off data.** If nobody depends on the table yet, a contract is premature. Add one when the first consumer appears.
- **Tables with no AI or reporting consumer.** Staging and raw layers need freshness and volume at most. Save the rest for the handoff point.
- **When the real problem is ownership.** If nobody will act on a failed check, adding the check just moves the blame. Agree on the owner first.
- **When a catalogue already does it.** If your organisation already runs data quality scans in a governance tool such as [Microsoft Purview Unified Catalog](https://learn.microsoft.com/purview/data-quality-overview), wire those results into the same decision path rather than building a parallel set. In practice that means exporting or reading the scan's rule scores and landing them as rows in the same `quality_signals` table, so one Activator rule and one owner list cover both sources.

## What to take away

Start with five signals per handoff table: freshness, volume, schema contract, completeness on key fields, and one critical validity rule. Agree the thresholds with the consuming team, make a failure stop something, and record every result so you can see trends. Add a sixth signal only when an incident proves you needed it. A short list that both teams trust will do more for model quality than a long one that nobody reads.
