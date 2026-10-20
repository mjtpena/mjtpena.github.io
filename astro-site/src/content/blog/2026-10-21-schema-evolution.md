---
title: "Schema Evolution: Surviving the Day Upstream Renames a Column"
author: Michael John Peña
draft: false
date: 2026-10-21T12:09:00Z
description: "Every source schema changes eventually. What matters is which changes your pipeline accepts on its own, which it rejects loudly, and which it can't detect at all. A taxonomy of schema changes, what Delta Lake actually does with each, a contract-per-layer policy, and the semantic changes that no schema check will catch."
tags:
  - Data Engineering
  - Delta Lake
  - Spark
  - Data Contracts
  - Data Quality
---

The source team renames `cust_id` to `customer_id` in a tidy-up release. Bronze ingestion has `mergeSchema` enabled "so it never breaks", so it doesn't break. The table gets a new `customer_id` column, `cust_id` is `NULL` for every new row, and the silver join on `cust_id` starts quietly dropping all orders from the release onward. Revenue stays roughly flat for two days while it should be growing, and on day three someone asks why.

The pipeline did what it was configured to do. It accepted the change, raised no error, failed no runs, and triggered no alerts. **Schema evolution** isn't about *whether* schemas change, because they always do. It's about deciding which changes are accepted automatically, which stop the pipeline, and how you detect the ones that look harmless.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 300" role="img" aria-label="Source version 1 has columns order_id, amount and cust_id. Source version 2 renames cust_id to customer_id. Both are appended into silver.orders with mergeSchema enabled. The target now has both columns: old rows have cust_id filled and customer_id null; new rows have cust_id null and customer_id filled. A join on cust_id silently drops every row written since the rename.">
<defs>
<marker id="seN" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker>
</defs>
<rect x="40" y="36" width="220" height="104" rx="12" class="ff-node"/>
<text x="60" y="62" class="ff-title">source · v1</text>
<text x="60" y="88" class="ff-tok">order_id</text><text x="176" y="88" class="ff-sub">BIGINT</text>
<text x="60" y="106" class="ff-tok">amount</text><text x="176" y="106" class="ff-sub">DECIMAL</text>
<text x="60" y="124" class="ff-tok">cust_id</text><text x="176" y="124" class="ff-sub">STRING</text>
<rect x="40" y="160" width="220" height="104" rx="12" class="ff-node ff-node-am"/>
<text x="60" y="186" class="ff-title">source · v2 (renamed)</text>
<text x="60" y="212" class="ff-tok">order_id</text><text x="176" y="212" class="ff-sub">BIGINT</text>
<text x="60" y="230" class="ff-tok">amount</text><text x="176" y="230" class="ff-sub">DECIMAL</text>
<text x="60" y="248" class="ff-tok ff-amt">customer_id</text><text x="176" y="248" class="ff-sub">STRING</text>
<path d="M262,88 C380,88 380,150 496,150" class="ff-edge" marker-end="url(#seN)"/>
<path d="M262,212 C380,212 380,172 496,172" class="ff-edge" marker-end="url(#seN)"/>
<rect x="318" y="152" width="124" height="17" rx="4" class="ff-elabel-bg"/>
<text x="380" y="164" text-anchor="middle" class="ff-elabel">mergeSchema=true</text>
<rect x="500" y="36" width="360" height="228" rx="12" class="ff-node ff-node-dn"/>
<text x="520" y="62" class="ff-title">silver.orders</text>
<text x="520" y="80" class="ff-sub">accepted both shapes; now has four columns</text>
<text x="520" y="110" class="ff-zlabel">ORDER_ID</text>
<text x="608" y="110" class="ff-zlabel">AMOUNT</text>
<text x="680" y="110" class="ff-zlabel">CUST_ID</text>
<text x="760" y="110" class="ff-zlabel">CUSTOMER_ID</text>
<text x="520" y="128" class="ff-tok">1001</text><text x="608" y="128" class="ff-tok">40.00</text><text x="680" y="128" class="ff-tok">C-17</text><text x="760" y="128" class="ff-sub">NULL</text>
<text x="520" y="146" class="ff-tok">1002</text><text x="608" y="146" class="ff-tok">25.00</text><text x="680" y="146" class="ff-tok">C-42</text><text x="760" y="146" class="ff-sub">NULL</text>
<line x1="520" y1="162" x2="840" y2="162" stroke="#e0a04a" stroke-width="1" stroke-dasharray="3 3"/>
<text x="840" y="177" text-anchor="end" class="ff-elabel ff-amt">rename deployed</text>
<text x="520" y="194" class="ff-tok">1003</text><text x="608" y="194" class="ff-tok">90.00</text><text x="680" y="194" class="ff-tok" style="fill:#e0554a">NULL</text><text x="760" y="194" class="ff-tok">C-17</text>
<text x="520" y="212" class="ff-tok">1004</text><text x="608" y="212" class="ff-tok">12.50</text><text x="680" y="212" class="ff-tok" style="fill:#e0554a">NULL</text><text x="760" y="212" class="ff-tok">C-08</text>
<text x="520" y="238" class="ff-sub">JOIN ON cust_id drops every row since the rename.</text>
<text x="520" y="254" class="ff-sub">No error. No failed run. No alert.</text>
</svg>
<figcaption><b>A rename looks like a drop plus an add.</b> With schema merging on, the table accepts both. The old column goes null and the new column appears, and nothing downstream knows that they're the same field.</figcaption>
</figure>

## Classify the change

Schema changes aren't equally risky. Classify them before choosing a policy:

| Change | Example | Risk to readers | Delta Lake default on append |
|---|---|---|---|
| **Add a column** | New `channel` field | Low: existing queries ignore it | **Rejected** (schema mismatch) unless `mergeSchema` |
| **Drop a column** | `discount` stops being sent | High for anything that reads it | **Accepted silently.** Missing columns are written as `NULL` |
| **Rename** | `cust_id` → `customer_id` | High | The "add" part is rejected, unless `mergeSchema`, in which case both halves are accepted silently |
| **Widen a type** | `INT` → `BIGINT`, `DECIMAL(10,2)` → `(18,2)` | Low | **Rejected** unless type widening is enabled |
| **Narrow or change a type** | `STRING` → `INT`, `DOUBLE` → `DECIMAL` | High | **Rejected**. `mergeSchema` doesn't allow incompatible types |
| **Reorder** | Columns arrive in a different order | None by name. **High** by position | Matched by name: harmless |
| **Semantic change** | `amount` switches from cents to dollars | Very high | **Invisible.** The schema is identical |

Two rows in that table are surprising. The first is **drop**: Delta fills missing columns with nulls without complaining, so a source that stops sending a field produces no error at all. The second is **reorder**. It's harmless when columns are matched by name, as with `saveAsTable` in append mode. It's dangerous anywhere columns are matched by position: `DataFrameWriter.insertInto`, SQL `INSERT INTO t SELECT ...` without a column list, and headerless CSV. When two swapped columns have compatible types, such as two strings, the data lands in the wrong columns without any error.

<div class="cl cl-warn">
<div class="cl-tag">Watch for</div>
<div class="cl-body">

`mergeSchema` and `autoMerge` don't make a pipeline more robust. They change a loud failure into a quiet one. That's the right trade in bronze, where losing raw data is worse than storing an odd shape. It's the wrong trade anywhere people query.

</div>
</div>

## What Delta Lake gives you

The relevant controls, so you can decide where each belongs:

<div class="code-title">delta_schema_controls.py</div>

```python
# Append that may add new columns (additive evolution)
df.write.format("delta").mode("append").option("mergeSchema", "true").saveAsTable("bronze.orders")

# MERGE that may add new columns from the source
spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", "true")

# Overwrite that replaces the schema entirely (rebuilds, not routine loads)
df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("silver.orders")
```

```sql
-- Metadata-only renames and drops (no data rewrite)
ALTER TABLE silver.orders SET TBLPROPERTIES (
  'delta.columnMapping.mode' = 'name',
  'delta.minReaderVersion'   = '2',
  'delta.minWriterVersion'   = '5');
ALTER TABLE silver.orders RENAME COLUMN cust_id TO customer_id;

-- In-place type widening (e.g. INT -> BIGINT) on runtimes that support it
ALTER TABLE silver.orders SET TBLPROPERTIES ('delta.enableTypeWidening' = 'true');
ALTER TABLE silver.orders ALTER COLUMN quantity TYPE BIGINT;

-- A tripwire: required columns can't silently become NULL
ALTER TABLE silver.orders ALTER COLUMN customer_id SET NOT NULL;
```

Two warnings about these:

- **Column mapping and type widening upgrade the table protocol.** Every engine that reads the table, including other Spark runtimes, SQL endpoints, BI connectors, and anything using an older Delta reader, has to support the new features, or it won't be able to read the table at all. Check every reader before enabling them, not after.
- **`NOT NULL` is the cheapest schema-drift alarm available.** It makes a dropped or renamed critical column fail the write instead of filling it with nulls. Put it on every column that a join or business key depends on.

## A policy per layer

The answer to "should the pipeline accept schema changes?" depends on the layer:

### Bronze: accept everything, lose nothing

Bronze has one job: record exactly what arrived. A schema change should never cause ingestion to fail, because a failed ingestion loses data or creates a backlog. Store the raw payload alongside the extracted fields, so any field you don't yet know about can be recovered later:

<div class="code-title">bronze/ingest_orders.py</div>

```python
from pyspark.sql import functions as F

raw = spark.read.text("Files/landing/orders/2026/10/21/")      # one JSON document per line

bronze = raw.select(
    F.col("value").alias("_raw"),                                # the payload, verbatim
    F.get_json_object("value", "$.order_id").alias("order_id"),
    F.current_timestamp().alias("_ingested_at"),
    F.col("_metadata.file_path").alias("_source_file"),
)

bronze.write.format("delta").mode("append").option("mergeSchema", "true").saveAsTable("bronze.orders")
```

With `_raw` stored, a renamed or added field is never lost. It's in bronze, ready to be extracted once you've decided how to handle it. Databricks Auto Loader offers similar protection with its `_rescued_data` column, which collects fields that don't match the expected schema.

### Silver: an explicit contract

Silver is where the schema becomes a promise. It should **never** use `SELECT *` from bronze. It projects a declared set of columns with declared types, fails if required columns disappear or change type, and ignores new columns until someone adds them on purpose:

<div class="code-title">silver/contract.py</div>

```python
import logging
from pyspark.sql import functions as F
from pyspark.sql.types import StructType

log = logging.getLogger(__name__)

CONTRACT = {                       # the silver.orders contract: name -> type
    "order_id":    "bigint",
    "customer_id": "string",
    "amount":      "decimal(18,2)",
    "order_ts":    "timestamp",
}

def schema_diff(expected: dict, actual: StructType) -> dict:
    a = {f.name.lower(): f.dataType.simpleString() for f in actual.fields}
    e = {k.lower(): v for k, v in expected.items()}
    return {
        "added":   sorted(a.keys() - e.keys()),
        "removed": sorted(e.keys() - a.keys()),
        "changed": sorted(k for k in e.keys() & a.keys() if a[k] != e[k]),
    }

def conform(df):
    diff = schema_diff(CONTRACT, df.schema)
    if diff["removed"] or diff["changed"]:
        raise ValueError(f"silver.orders contract broken: {diff}")
    if diff["added"]:
        log.warning("silver.orders: new upstream columns ignored: %s", diff["added"])

    return df.select([F.col(c).cast(t).alias(c) for c, t in CONTRACT.items()])
```

If this contract had been written against v1, with `cust_id`, the first run after the rename release fails with `removed: ['cust_id']`. Someone gets paged about a schema change at deploy time, which is far easier to deal with than three days of missing revenue.

Remember that `cast` can hide problems too. With ANSI mode off, a value that can't be cast becomes `NULL` without an error. Either run with `spark.sql.ansi.enabled = true` so bad casts fail, or count the nulls each cast introduces and alert when the count goes above zero.

### Gold: version breaking changes

Gold tables are used by reports, semantic models, and other teams. A breaking change there needs a migration path, not just a deploy. Add the new column next to the old one, give consumers a deprecation period, and then remove the old column, or publish a `_v2` table and retire `_v1` on a date announced in advance. That's how any public interface is changed safely, and a gold table is a public interface.

## Changes no schema check can see

The most dangerous change in the taxonomy is the one where the schema stays the same:

- `amount` changes from cents to dollars, so every value is 100× smaller.
- `event_ts` changes from UTC to local time, and every [daily aggregate](/blog/2026-10-21-event-time-vs-processing-time) shifts by a few hours.
- `status` gains a new value, `'PARTIALLY_SHIPPED'`, that a `CASE` expression drops into `ELSE NULL`.
- `country` changes from ISO codes to full names.

Schema diffs can't detect these. Data tests can, provided they check the data's **behaviour** and not only its shape:

| Check | Catches |
|---|---|
| Accepted values for enums and codes | New status values, code format changes |
| Mean, median, and percentiles against a trailing baseline | Unit changes (100×), scale changes |
| Null rate per column against a baseline | Dropped or renamed fields filling with nulls |
| Hour-of-day distribution of timestamps | Time zone changes |
| Row count against a trailing baseline | Upstream filters, partial loads |

Most data quality tools provide these checks. What matters is running them on the boundary between bronze and silver, on every load, with thresholds tuned so that they actually alert.

## Contracts with producers

All of the above protects you from changes after they happen. A contract with the producer lets you hear about them beforehand:

- **For event streams**, a schema registry with an enforced compatibility mode. `BACKWARD` (the Confluent default) means consumers using the new schema can read data written with the old one, so **consumers upgrade first**. `FORWARD` means old consumers can read new data, so **producers upgrade first**. `FULL` requires both. Choose the mode deliberately. The default only suits you if consumers usually deploy before producers.
- **For databases and SaaS sources**, a written agreement that covers the schema, the meaning of key fields, who owns them, and how breaking changes are announced. It can be a short markdown file in the producer's repo. The aim is that a rename is preceded by a pull request you're asked to review, rather than discovered three days later.

## On Monday

- Find every `mergeSchema` and `autoMerge` outside bronze, and justify or remove each one.
- Replace `SELECT *` from bronze with explicit projections against a declared contract.
- Add `NOT NULL` to every join key and business key in silver.
- Search for `insertInto` and `INSERT INTO ... SELECT` without column lists.
- Add accepted-values and distribution checks to the three columns that would hurt most if their meaning changed.
- Store the raw payload in bronze, so any schema mistake can be fixed by reprocessing.

## Ten concepts, one idea

That's the end of the series. Looking back across the ten topics, they share one idea: **make the implicit explicit before it fails at a bad time.**

[Idempotence](/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data) makes explicit what a retry does. [Grain](/blog/2026-10-21-the-grain-of-a-table) makes explicit what a row is. [Event time](/blog/2026-10-21-event-time-vs-processing-time) and [late data](/blog/2026-10-21-late-arriving-data) make explicit which clock you're using and how long you'll wait. [Skew](/blog/2026-10-21-data-skew-in-spark), [query plans](/blog/2026-10-21-reading-a-spark-query-plan), [pruning](/blog/2026-10-21-partition-pruning), and [small files](/blog/2026-10-21-the-small-files-problem) make explicit what the engine is really doing. [Slowly changing dimensions](/blog/2026-10-21-slowly-changing-dimensions) and schema evolution make explicit how things change over time. None of them is hard on its own. They're just easy to skip until one of them causes an incident.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 10 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-10-21-the-grain-of-a-table">The grain of a table</a></li>
<li><a href="/blog/2026-10-21-event-time-vs-processing-time">Event time vs processing time</a></li>
<li><a href="/blog/2026-10-21-late-arriving-data">Late-arriving data</a></li>
<li><a href="/blog/2026-10-21-data-skew-in-spark">Data skew</a></li>
<li><a href="/blog/2026-10-21-reading-a-spark-query-plan">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-10-21-partition-pruning">Partition pruning</a></li>
<li><a href="/blog/2026-10-21-the-small-files-problem">The small files problem</a></li>
<li><a href="/blog/2026-10-21-slowly-changing-dimensions">Slowly changing dimensions</a></li>
<li class="on">Schema evolution</li>
</ol>
</nav>
