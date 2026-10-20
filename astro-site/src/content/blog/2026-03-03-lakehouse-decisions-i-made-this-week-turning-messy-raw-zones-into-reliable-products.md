---
title: "Table Contracts in a Fabric Lakehouse: Where Raw Becomes a Product"
description: "Four decisions for a messy Fabric raw zone: contracts at silver, Delta constraints, quarantined rows with failed batches, and lakehouse schemas."
author: Michael John Peña
draft: false
date: 2026-03-03
tags:
  - Microsoft Fabric
  - Lakehouse
  - Delta Lake
  - Data Quality
  - Data Engineering
---

Most raw zones I see in Fabric aren't messy because the tooling is weak. They're messy because nobody has written down what a usable table promises, so every analyst and engineer reverse-engineers it from the data. A written contract and a few boring enforcement rules fix that, and four decisions do most of the work of turning "files we landed" into "tables people can build on".

## What I mean by a table contract

A contract is the short list of promises a table makes to its consumers. If a promise isn't written down, consumers will invent one, and it'll be wrong. For a curated table I want five things answered:

| Promise | Example for `silver.orders` |
|---|---|
| Grain | One row per `order_id`, latest version (by `source_updated_at`) wins |
| Required columns | `order_id`, `customer_id`, `order_date`, `order_total`, `currency`, `source_updated_at` |
| Allowed values | `order_total >= 0`, currency in a known list |
| Failure behaviour | Bad rows go to quarantine; a bad batch stops the load |
| Owner | A named person or team who answers questions and approves changes |

The written contract lives next to the code that enforces it: a `README.md` per table in the repo that holds the silver notebook, with a one-line summary and a link in the lakehouse item's description so consumers can find it from the portal. Changes go through a pull request the owner approves. A breaking change (a renamed column, a new grain, a tighter type) never lands in place: add the new column alongside the old one, or publish `orders_v2`, write both for an agreed period, and drop the old one only after every consumer has moved.

I deliberately leave out freshness SLAs, lineage and full column descriptions at first. They matter, but nobody reads a ten-page contract on a table they haven't started using yet. Add them once people are using the table.

## Decision 1: raw stays raw, contracts start at silver

The temptation is to clean data on the way into bronze. I don't. Bronze is append-only and adds only ingestion metadata: source file, load timestamp and a batch ID. That gives you a faithful record of what the source actually sent, which is what you need when someone asks "was it us or them?".

One deliberate choice sits on top of that. For file sources such as CSV and JSON, I land every column as a string rather than letting Spark infer types. Inference on a messy file guesses wrong or silently nulls what it can't parse, and the evidence is gone. As strings, the source's values survive, and type failures surface at silver where they can be quarantined with a reason. Sources that are already typed, such as a database extract or Parquet files, land as they are. Bronze appends are written with `mergeSchema` enabled, so a new source column is added to the table rather than failing the load, and a column the source stops sending stays in the table as nulls.

Contracts start at the first curated layer. Microsoft's [medallion architecture guidance for Fabric](https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture) describes the same split: bronze stores data as it arrives, in its original format, silver is cleaned and deduplicated, gold is shaped for consumption. My only addition is that silver is where the contract becomes enforceable. If you put contracts on bronze, every upstream schema change becomes an ingestion outage, and you lose the evidence you'd need to argue with the source owner.

## Decision 2: put the contract on the table, not only in the notebook

Most teams implement quality rules as checks in a notebook before the write. I covered that pattern, including volume and freshness gates, in [Running Data Pipelines in Production](/blog/2026-02-05-data-pipelines-production/). It works, but it has a gap: the rule only protects the table when that particular notebook does the writing. The next person who writes a quick fix-up script from a different notebook skips it.

Delta Lake lets you put the non-negotiable rules on the table itself with `NOT NULL` and `CHECK` constraints. Fabric Spark Runtime 1.3 ships Spark 3.5 and Delta Lake 3.2, which support both. In a schema-enabled lakehouse, the silver table looks like this:

```sql
CREATE SCHEMA IF NOT EXISTS silver;

CREATE TABLE IF NOT EXISTS silver.orders (
    order_id     STRING        NOT NULL,
    customer_id  STRING        NOT NULL,
    order_date   DATE          NOT NULL,
    order_total  DECIMAL(18,2) NOT NULL,
    currency     STRING        NOT NULL,
    source_updated_at TIMESTAMP NOT NULL,
    _source_file STRING,
    _loaded_at   TIMESTAMP
) USING DELTA;

ALTER TABLE silver.orders
    ADD CONSTRAINT order_total_non_negative CHECK (order_total >= 0);

ALTER TABLE silver.orders
    ADD CONSTRAINT currency_known CHECK (currency IN ('AUD', 'NZD', 'USD'));
```

A few behaviours are worth knowing before you rely on this, all documented in the [Delta Lake constraints docs](https://docs.delta.io/latest/delta-constraints.html):

- **A violation fails the whole transaction.** One bad row in a million rejects the entire write. That's the right behaviour for a backstop, but it's a bad primary filter, which is why Decision 3 exists.
- **Adding a constraint checks the existing data.** `ADD CONSTRAINT` fails if any current row breaks the rule, so clean the table first.
- **Adding a constraint raises the table's writer protocol version (to 3 for `CHECK`).** Readers aren't affected, but check the [Delta interoperability matrix](https://learn.microsoft.com/en-us/fabric/fundamentals/delta-lake-interoperability) before letting any engine other than Spark write to the table. My rule is simpler: silver tables have exactly one writer, a Spark notebook or job, and I explain why in [Delta Lake in Fabric: Not Every Engine Reads Every Table](/blog/2026-02-18-delta-lake-fabric/).

I made every checked column `NOT NULL` as well. That way nobody has to remember how a `CHECK` treats a null value, because there are no nulls to check.

Keep constraints for rules that are true by definition: a key is never missing, money is never negative, currency is one of the ones you trade in. Business rules that change every quarter, such as "orders over $50,000 need review", belong in code or a downstream check, not in a table constraint you'd have to drop and recreate. The currency list is borderline by that test: it's hard-coded in both the constraint and the notebook, so a new market means touching both. If you add markets more than once a year, keep the list in a reference table and check it in the notebook only.

## Decision 3: quarantine bad rows, fail bad batches

If the constraint is the backstop, the notebook is the filter. The pattern I use separates two failure modes that teams often treat as one:

- **Row-level problems** (a missing key, an unparseable date, a currency nobody expected) go to a quarantine table with a reason. The load continues.
- **Batch-level problems** (a missing source column, too many rejects, a constraint violation that got past the filter) stop the load and page someone.

Mix them up and either one malformed row blocks a day's data, or a broken feed quietly loses 40% of its rows while the dashboard looks fine.

This is the silver load for the table above. It runs in a Fabric notebook attached to a schema-enabled lakehouse, with `bronze.orders_raw` holding every source column as a string, and the pipeline passing in the batch ID as a parameter.

```python
from delta.tables import DeltaTable
from pyspark.sql import functions as F
from pyspark.sql.window import Window

batch_id = "<batch-id>"          # notebook parameter, set by the pipeline
allowed_currencies = ["AUD", "NZD", "USD"]
max_reject_ratio = 0.05          # more than 5% rejected means the batch is broken

raw = spark.table("bronze.orders_raw").filter(F.col("_batch_id") == batch_id)

# Guards against a bronze table that was rebuilt without a contract column.
required = ["order_id", "customer_id", "order_date", "order_total", "currency", "source_updated_at"]
missing = set(required + ["_source_file", "_loaded_at", "_batch_id"]) - set(raw.columns)
if missing:
    raise ValueError(f"Batch {batch_id}: bronze.orders_raw is missing {sorted(missing)}. Silver not updated.")

# An empty batch gets its own error, rather than tripping the null-column check below.
if raw.isEmpty():
    raise ValueError(f"Batch {batch_id}: no rows in bronze.orders_raw. Silver not updated.")

# Batch-level check: bronze keeps every column it has ever seen, so a source that dropped
# or renamed a column shows up as a column that is entirely null in this batch.
null_cols = [c for c in required if raw.filter(F.col(c).isNotNull()).limit(1).count() == 0]
if null_cols:
    raise ValueError(f"Batch {batch_id}: {null_cols} entirely null; the source feed is broken. Silver not updated.")

typed = raw.select(
    F.trim("order_id").alias("order_id"),
    F.trim("customer_id").alias("customer_id"),
    F.expr("try_cast(order_date AS DATE)").alias("order_date"),
    F.expr("try_cast(order_total AS DECIMAL(18,2))").alias("order_total"),
    F.upper(F.trim("currency")).alias("currency"),
    F.expr("try_cast(source_updated_at AS TIMESTAMP)").alias("source_updated_at"),
    F.col("order_id").alias("raw_order_id"),
    F.col("customer_id").alias("raw_customer_id"),
    F.col("order_date").alias("raw_order_date"),
    F.col("order_total").alias("raw_order_total"),
    F.col("currency").alias("raw_currency"),
    F.col("source_updated_at").alias("raw_source_updated_at"),
    "_source_file",
    "_loaded_at",
)

# One reason per broken rule; concat_ws skips the nulls, so "" means the row is clean.
reason = F.concat_ws(
    "; ",
    F.when(F.col("order_id").isNull() | (F.col("order_id") == ""), F.lit("missing order_id")),
    F.when(F.col("customer_id").isNull() | (F.col("customer_id") == ""), F.lit("missing customer_id")),
    F.when(F.col("order_date").isNull(), F.lit("unparseable order_date")),
    F.when(F.col("order_total").isNull() | (F.col("order_total") < 0), F.lit("invalid order_total")),
    F.when(F.col("currency").isNull() | ~F.col("currency").isin(allowed_currencies), F.lit("unknown currency")),
    F.when(F.col("source_updated_at").isNull(), F.lit("unparseable source_updated_at")),
)

checked = typed.withColumn("_reject_reason", reason).cache()
total = checked.count()
rejected = checked.filter(F.col("_reject_reason") != "")
rejected_count = rejected.count()

# Quarantine keeps every contract column as it arrived (the raw_* columns), so the source
# owner can see exactly what was sent. It lives in its own schema, outside silver.
# Clear this batch's earlier rejects first, so a rerun doesn't quarantine the same rows twice.
spark.sql("CREATE SCHEMA IF NOT EXISTS quarantine")
if spark.catalog.tableExists("quarantine.orders"):
    DeltaTable.forName(spark, "quarantine.orders").delete(F.col("_batch_id") == batch_id)

if rejected_count > 0:
    (rejected
        .withColumn("_batch_id", F.lit(batch_id))
        .withColumn("_quarantined_at", F.current_timestamp())
        .write.format("delta").mode("append")
        .saveAsTable("quarantine.orders"))

if total > 0 and rejected_count / total > max_reject_ratio:
    raise ValueError(
        f"Batch {batch_id}: {rejected_count} of {total} rows rejected; "
        f"exceeds {max_reject_ratio:.0%}. Silver not updated."
    )

# Enforce the grain: one row per order_id, latest source version wins.
# _loaded_at is the same for every row in a batch, so it can't break ties here.
latest = (Window.partitionBy("order_id")
          .orderBy(F.col("source_updated_at").desc(), F.col("_source_file").desc()))
accepted = (
    checked.filter(F.col("_reject_reason") == "")
    .withColumn("_rn", F.row_number().over(latest))
    .filter("_rn = 1")
    .select("order_id", "customer_id", "order_date", "order_total",
            "currency", "source_updated_at", "_source_file", "_loaded_at")
)

(DeltaTable.forName(spark, "silver.orders").alias("t")
    .merge(accepted.alias("s"), "t.order_id = s.order_id")
    # Only overwrite when the incoming version is at least as new, so replaying an old batch is harmless.
    .whenMatchedUpdateAll(condition="s.source_updated_at >= t.source_updated_at")
    .whenNotMatchedInsertAll()
    .execute())

checked.unpersist()
print(f"Batch {batch_id}: {total - rejected_count} accepted, {rejected_count} quarantined")
```

The quarantine is written before the threshold check on purpose: when a batch fails, the first question is "what was wrong with it?", and the answer is already in a table. An empty batch fails fast with its own message; the volume gate from the pipelines post covers batches that are suspiciously small but not empty. `try_cast` returns null instead of throwing, so a bad date becomes a rejected row rather than a crashed notebook, whatever the ANSI setting. Deduplicate before the `MERGE`, because Delta refuses a merge where several source rows match one target row, and order by the source's change timestamp: every row in a batch shares `_loaded_at`, so ordering by it would pick a winner arbitrarily. If two rows still tie on `order_id`, `source_updated_at` and `_source_file`, they're exact duplicates from the same file, so whichever one `row_number` keeps doesn't matter.

The notebook is also safe to rerun, the normal recovery path after a failed batch: the quarantine delete clears that batch's earlier rejects, and the conditional `MERGE` means a replayed older batch can't roll a row back.

The 5% threshold is a starting point, not a rule. A feed of hand-keyed data might reject 2% every day and be perfectly healthy. A machine-generated feed that rejects 0.5% is probably broken. Set it per source once you've seen a few weeks of quarantine counts.

## Decision 4: let schemas carry the layer boundaries

[Lakehouse schemas](https://learn.microsoft.com/en-us/fabric/data-engineering/lakehouse-schemas) reached general availability in late 2025, and new lakehouses created in the portal are schema-enabled by default. The REST API still needs `enableSchemas: true` in the creation payload, which matters if you deploy with infrastructure as code: forget it and your pipeline creates a lakehouse without schemas.

That changes a decision I used to make differently. Microsoft's medallion guidance still recommends a separate lakehouse (or a warehouse for gold) per layer, each in its own workspace, and for multi-team or multi-domain platforms I follow it. For a single domain owned by one team, I deliberately depart from it and use one lakehouse with `bronze`, `silver` and `gold` schemas: the same people own every layer, so separate items add workspaces, shortcuts and deployment steps without adding a real boundary. The names in the code above (`bronze.orders_raw`, `silver.orders`) say which layer and which contract applies without anyone opening a wiki. That's also why the quarantine table lives in its own `quarantine` schema rather than as `silver.orders_quarantine`: everything in `silver` is a contract table consumers can build on, and rejected rows are evidence for the data team and source owners, not a product.

I still split into separate lakehouses, or separate workspaces, when the access boundary is different. If analysts must never see raw data containing personal information, that's a security boundary, and I'd rather it live at the item or workspace level than depend on everyone getting schema permissions right. Schemas are for organisation. Don't let them become your only access control for sensitive data.

## Where materialized lake views fit

Fabric's [materialized lake views](https://learn.microsoft.com/en-us/fabric/data-engineering/materialized-lake-views/data-quality) let you declare a silver table as a Spark SQL query with `CHECK` constraints that either drop violating rows or fail the refresh. That's close to Decisions 2 and 3 in a single statement, and for simple transformations it's appealing.

As of early March 2026 they're still in preview, so I'm not moving existing production loads onto them yet. FAIL stops the whole refresh when any row violates a constraint, so it behaves like a Delta constraint, not a quarantine. DROP records how many rows each constraint dropped (in lineage and the data quality report), not the rows themselves, so you lose the quarantine evidence I rely on. I'd try them on a new, low-risk silver table and compare the effort with the notebook pattern.

## When this is overkill

Not every table needs a contract. Skip the constraints and quarantine when:

- **The table is exploratory or short-lived.** A one-off analysis doesn't need a quarantine table.
- **There's only one consumer and it's the same team.** The contract can be a comment in the notebook until a second consumer turns up.
- **The source is already governed.** If you're copying a curated warehouse table that has its own contract, re-validating every rule adds cost without adding trust. Check row counts and keys, then move on.

The signal that you need this is a second team building on the table. From that point, a column rename you'd have shrugged off breaks their report.

## The short version

Keep bronze faithful, and start the contract at silver. Put the rules that are true by definition on the table as Delta constraints, so they hold no matter who writes. Filter in the notebook first, so one bad row goes to quarantine instead of blocking the batch, and keep the failure threshold per source. Use schemas to make layers obvious, but keep sensitive boundaries at the item or workspace level. And keep the first contract small: grain, required columns, failure behaviour and an owner. That's enough to change how people treat a table.
