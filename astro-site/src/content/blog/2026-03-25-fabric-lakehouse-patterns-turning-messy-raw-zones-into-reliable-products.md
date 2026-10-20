---
title: "Break Your Silver Layer on Purpose: Bad-Input Tests in Fabric"
description: "Why I keep a library of deliberately broken raw files for every Fabric bronze-to-silver transform, and how to run them as plain PySpark tests before release."
author: Michael John Peña
draft: false
date: 2026-03-25
tags:
  - Microsoft Fabric
  - Lakehouse
  - Data Quality
  - PySpark
  - Testing
---

Most bronze-to-silver notebooks in a Fabric lakehouse are tested against exactly one input: whatever landed last Tuesday, which happened to be clean. The transform looks reliable until a source system sends a header row twice, switches its date format, or replays a day of corrections. Then the "reliable" silver table quietly double-counts revenue, and nobody can say what the notebook was supposed to do with those rows, because nobody ever decided.

My fix is unglamorous: keep a small library of deliberately broken inputs for each silver table, and run the transform against all of them before every release. The tests matter less than the decisions they force you to write down.

## Messy inputs are a design question, not a data question

When a raw file contains an order with a negative amount, there are only a few things the transform can do: drop it, fix it, quarantine it, accept it, or fail the batch. Every one of those is a business decision with a cost. Quarantining a refund that should have been accepted understates revenue. Accepting a corrupted amount overstates it.

Too often, that decision lives in someone's head or in a hallway conversation. It surfaces when the finance report doesn't match and an engineer reads a 300-line notebook to work out what happened. A bad-input fixture turns the hallway decision into an executable statement: "a negative amount is rejected with reason `negative_amount`". If the business later says refunds are valid, you change the fixture first, and the change shows up in a pull request instead of a post-incident review.

That is also how a technical rule gets tied to something the business cares about. The fixture name and reason code should read like a sentence a finance analyst would recognise, not like `test_case_7`.

I've written before about [where table contracts start and why I quarantine rows but fail batches](/blog/2026-03-03-lakehouse-decisions-i-made-this-week-turning-messy-raw-zones-into-reliable-products/). This post is about proving the transform actually honours that contract before it meets production data.

## The fixtures worth writing first

You don't need a hundred cases. These nine cover most of the raw-zone failures I'd expect from file-based and API-based sources:

| Fixture | What it simulates | Decision it forces |
|---|---|---|
| Replayed correction | Source resends an order with a new amount, then an old file is re-landed | Which version wins, and on what column |
| Original and hand-fixed file in one batch | Identical timestamps, different amounts | Pick a winner, or refuse to guess |
| Exact duplicate row | Same row delivered twice | Keep one, record the other |
| Padded key, lowercase code | `" A2 "`, `"aud"` | Do we normalise or reject? |
| Missing business key | Empty `order_id` | Reject; it can never be joined |
| Unparseable timestamp | `20/03/2026` from a regional export | Reject, or add the format explicitly |
| Formatted number | `"1,200.00"` | Reject, or strip separators knowingly |
| Out-of-domain value | Unknown currency, negative amount | What "valid" means for the product |
| Header row as data | A concatenated CSV | Should never reach silver, and say why |

Two properties matter more than the cases themselves. First, every input row must end up either in the clean output or in the rejected output with a reason; rows that vanish are the bug you're hunting. Second, the transform must be a plain function from a DataFrame to DataFrames, with no reads or writes inside it. That's what makes it testable at all.

## A transform built to be tested

Here is the shape I'd use. It runs in a Fabric notebook on [Runtime 1.3](https://learn.microsoft.com/fabric/data-engineering/runtime-1-3) (Spark 3.5, Delta Lake 3.2) and equally on a laptop with `pyspark` installed, plus a JDK (Java 11 or 17). I use the SQL `try_cast` and [`try_to_timestamp`](https://spark.apache.org/docs/3.5.0/api/sql/index.html#try_to_timestamp) functions so that bad values become nulls, which keeps behaviour the same whether or not ANSI mode is enabled.

```python
from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql.types import StringType, StructField, StructType

spark = SparkSession.builder.getOrCreate()

RAW_SCHEMA = StructType([
    StructField("order_id", StringType()),
    StructField("customer_id", StringType()),
    StructField("order_ts", StringType()),
    StructField("amount", StringType()),
    StructField("currency", StringType()),
    StructField("source_updated_at", StringType()),
    StructField("_ingested_at", StringType()),
])
RAW_COLS = [f.name for f in RAW_SCHEMA.fields]
VALID_CURRENCIES = ["AUD", "NZD", "USD"]


def to_silver_orders(raw: DataFrame) -> tuple[DataFrame, DataFrame]:
    """Return (clean, rejected). Every input row lands in exactly one of them."""
    typed = (
        raw.withColumn("order_id_c", F.trim("order_id"))
        .withColumn("currency_c", F.upper(F.trim("currency")))
        .withColumn("order_ts_c", F.expr("try_to_timestamp(order_ts)"))
        .withColumn("amount_c", F.expr("try_cast(amount AS DECIMAL(18,2))"))
        .withColumn("updated_at_c", F.expr("try_to_timestamp(source_updated_at)"))
        .withColumn("ingested_at_c", F.expr("try_to_timestamp(_ingested_at)"))
    )

    reason = (
        F.when(F.lower(F.col("order_id_c")) == "order_id", "header_row")
        .when(F.col("order_id_c").isNull() | (F.col("order_id_c") == ""), "missing_order_id")
        .when(
            F.col("order_ts_c").isNull()
            | F.col("updated_at_c").isNull()
            | F.col("ingested_at_c").isNull(),
            "bad_timestamp",
        )
        .when(F.col("amount_c").isNull(), "bad_amount")
        .when(F.col("amount_c") < 0, "negative_amount")
        .when(
            F.col("currency_c").isNull() | ~F.col("currency_c").isin(VALID_CURRENCIES),
            "unknown_currency",
        )
    )
    checked = typed.withColumn("reject_reason", reason)

    invalid = checked.filter(F.col("reject_reason").isNotNull()).select(*RAW_COLS, "reject_reason")

    # The source's own change time wins; ingestion time only breaks ties. Rows tied
    # on both share a rank; if they also disagree on content, there is no honest
    # winner, so none of them is published.
    latest_first = Window.partitionBy("order_id_c").orderBy(
        F.col("updated_at_c").desc(), F.col("ingested_at_c").desc()
    )
    same_rank = Window.partitionBy("order_id_c", "rk")
    ranked = (
        checked.filter(F.col("reject_reason").isNull())
        .withColumn("rk", F.rank().over(latest_first))
        .withColumn("rn", F.row_number().over(latest_first))
        .withColumn(
            "versions",
            F.size(F.collect_set(F.struct("customer_id", "amount_c", "currency_c")).over(same_rank)),
        )
    )
    ambiguous = (F.col("rk") == 1) & (F.col("versions") > 1)

    dedup_reason = (
        F.when(ambiguous, "ambiguous_duplicate")
        .when(F.col("rn") > 1, "duplicate_superseded")
    )
    deduped = ranked.withColumn("reject_reason", dedup_reason)

    duplicates = deduped.filter(F.col("reject_reason").isNotNull()).select(*RAW_COLS, "reject_reason")
    clean = deduped.filter(F.col("reject_reason").isNull()).select(
        F.col("order_id_c").alias("order_id"),
        "customer_id",
        F.col("order_ts_c").alias("order_ts"),
        F.col("amount_c").alias("amount"),
        F.col("currency_c").alias("currency"),
        F.col("updated_at_c").alias("source_updated_at"),
        F.col("ingested_at_c").alias("ingested_at"),
    )
    return clean, invalid.unionByName(duplicates)
```

Note that superseded duplicates go to the rejected output with their own reason rather than disappearing. That keeps the row-conservation check honest and gives you an audit trail when someone asks why yesterday's amount changed.

The ranking column is a deliberate choice. Ordering by `_ingested_at` alone looks reasonable until someone backfills or re-lands an old file: its rows get a fresh ingestion time and overwrite the newer correction. The source's own change timestamp, `source_updated_at` here, is what makes "latest version wins" true, so it ranks first and ingestion time only breaks ties. If your source doesn't send a change timestamp, ingestion order is the best you have, and that only holds if you can guarantee old files are never re-sent.

The ranking needs a rule for ties, too. `row_number()` over two rows with the same `source_updated_at` and `_ingested_at` picks one arbitrarily, which is exactly the silent behaviour this whole approach exists to stop. That happens when someone fixes a file by hand and the original and the fix land in the same batch with the same timestamps. If the tied rows are identical, keeping either is harmless. If they disagree, I'd rather publish neither and reject both as `ambiguous_duplicate` than let Spark's execution order decide revenue.

There is one way out of that rule. If bronze stores `_metadata.file_path` next to a landing sequence you generate explicitly (for example, the landing batch timestamp plus a row number assigned when the file is parsed), you can use them as a final tiebreaker. Don't reach for `monotonically_increasing_id()` here: its values are unique, but they follow Spark partitions, not the row order of a file. And only do it if "the last file wins" is a rule the business has actually agreed to.

The header row gets its own check for a similar reason. Without it, a stray header is still rejected, but only because the literal `order_ts` doesn't parse as a timestamp, so the quarantine says `bad_timestamp` and the analyst goes looking for a date-format problem. `header_row` says what actually happened. The same goes for `_ingested_at`: it is validated with the other timestamps, because an unparseable ingestion time would otherwise pass as clean and quietly sort last in the tiebreak.

### Replays across batches

This window only resolves replays within one batch. A correction that arrives in tomorrow's file is a cross-batch replay, and the transform can't see the row it replaces, which makes it the riskier case. It belongs to the `MERGE` into silver. Tighten the conditional merge from [the earlier post on table contracts](/blog/2026-03-03-lakehouse-decisions-i-made-this-week-turning-messy-raw-zones-into-reliable-products/) from `s.source_updated_at >= t.source_updated_at` to `>`, because `>=` lets whichever file lands last win on a tie. An equal change time with different content is the same tie as above, just spread across two days, so it shouldn't overwrite. It shouldn't vanish either, so a check before the `MERGE` routes it to quarantine:

```sql
-- Fragment: run before the MERGE. `incoming` is a temp view over the clean output.
SELECT s.*, 'ambiguous_duplicate' AS reject_reason
FROM incoming AS s
JOIN silver.orders AS t
  ON s.order_id = t.order_id
WHERE s.source_updated_at = t.source_updated_at
  AND NOT (s.customer_id <=> t.customer_id
           AND s.amount <=> t.amount
           AND s.currency <=> t.currency)
```

Write those rows to quarantine and anti-join them out of the merge source. The null-safe `<=>` keeps a null on either side from hiding a difference. This path needs a fixture of its own, run against a scratch Delta table rather than a DataFrame:

1. Merge the newer version of an order, then the older one, and assert silver still holds the newer amount.
2. Merge a row with the same `source_updated_at` and a different amount, and assert silver is unchanged.
3. Assert that row is in quarantine as `ambiguous_duplicate`.

## The fixture runner

The tests are data, not code. Adding a case is a pull request that adds one dictionary. Saved after the transform in a file named `test_silver_orders.py`, the same code works three ways: as a notebook cell, with plain `python`, and under `pytest`, which collects the `test_` function.

```python
from decimal import Decimal

FIXTURES = [
    {
        "name": "replayed correction wins, re-landed old file does not",
        "rows": [
            ("A1", "C1", "2026-03-20 10:00:00", "10.00", "AUD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A1", "C1", "2026-03-20 10:00:00", "12.00", "AUD", "2026-03-21 09:00:00", "2026-03-21 11:00:00"),
            ("A1", "C1", "2026-03-20 10:00:00", "10.00", "AUD", "2026-03-20 10:05:00", "2026-03-22 11:00:00"),
        ],
        "expect_clean": 1,
        "expect_reasons": {"duplicate_superseded": 2},
        "expect_amount": "12.00",
    },
    {
        "name": "original and hand-fixed rows tie: nobody wins",
        "rows": [
            ("A9", "C9", "2026-03-20 10:00:00", "10.00", "AUD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A9", "C9", "2026-03-20 10:00:00", "15.00", "AUD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
        ],
        "expect_clean": 0,
        "expect_reasons": {"ambiguous_duplicate": 2},
    },
    {
        "name": "exact duplicate row: keep one",
        "rows": [
            ("A10", "C10", "2026-03-20 10:00:00", "7.00", "NZD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A10", "C10", "2026-03-20 10:00:00", "7.00", "NZD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
        ],
        "expect_clean": 1,
        "expect_reasons": {"duplicate_superseded": 1},
    },
    {
        "name": "padded key and lowercase currency are normalised",
        "rows": [(" A2 ", "C2", "2026-03-20 09:00:00", "5.50", "aud", "2026-03-20 10:05:00", "2026-03-20 11:00:00")],
        "expect_clean": 1,
        "expect_reasons": {},
    },
    {
        "name": "each broken field gets its own reason",
        "rows": [
            ("", "C3", "2026-03-20 09:00:00", "1.00", "AUD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A4", "C4", "20/03/2026", "1.00", "AUD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A5", "C5", "2026-03-20 09:00:00", "1,200.00", "AUD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A6", "C6", "2026-03-20 09:00:00", "-5.00", "AUD", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A7", "C7", "2026-03-20 09:00:00", "3.00", "XYZ", "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A8", "C8", "2026-03-20 09:00:00", "3.00", None, "2026-03-20 10:05:00", "2026-03-20 11:00:00"),
            ("A11", "C11", "2026-03-20 09:00:00", "3.00", "AUD", "2026-03-20 10:05:00", "not-a-time"),
        ],
        "expect_clean": 0,
        "expect_reasons": {
            "missing_order_id": 1, "bad_timestamp": 2, "bad_amount": 1,
            "negative_amount": 1, "unknown_currency": 2,
        },
    },
    {
        "name": "header row inside the file never reaches silver",
        "rows": [tuple(RAW_COLS)],
        "expect_clean": 0,
        "expect_reasons": {"header_row": 1},
    },
]


def test_silver_orders_fixtures():
    failures = []
    for fx in FIXTURES:
        raw = spark.createDataFrame(fx["rows"], RAW_SCHEMA)
        clean, rejected = to_silver_orders(raw)
        reasons = {r["reject_reason"]: r["count"] for r in rejected.groupBy("reject_reason").count().collect()}
        n_clean = clean.count()

        if n_clean != fx["expect_clean"] or reasons != fx["expect_reasons"]:
            failures.append(f"{fx['name']}: clean={n_clean}, reasons={reasons}")
        if n_clean + sum(reasons.values()) != raw.count():
            failures.append(f"{fx['name']}: rows were lost or duplicated")
        if "expect_amount" in fx and n_clean == 1:
            got = clean.first()["amount"]
            if got != Decimal(fx["expect_amount"]):
                failures.append(f"{fx['name']}: amount={got}")

    assert not failures, "\n".join(failures)
    print(f"{len(FIXTURES)} fixtures passed")


if __name__ == "__main__":
    test_silver_orders_fixtures()
```

The nine cases from the table map to six entries because the single-field failures share one batch, each with its own expected reason.

## Where the tests run

I'd keep the runner in its own notebook in the development workspace and call it as the first activity of the release, or from an orchestration notebook with `notebookutils.notebook.run` (covered in the [notebook utilities documentation](https://learn.microsoft.com/fabric/data-engineering/notebook-utilities)). Because the transform has no I/O, the same file also runs under `pytest` on a build agent with a local Spark session, without touching capacity. Use whichever your team will actually look at; a test that runs where nobody reads the output is decoration.

Two habits make the library grow in the right direction:

- **Every production rejection spike becomes a fixture.** When a real file breaks something, cut the offending rows down to the smallest reproducing sample, anonymise them, and add them. Landing bronze with Spark's `_metadata.file_path` column makes finding that file much faster.
- **Batch-level rules stay outside the transform.** "Fail if more than 5% of rows are rejected" is a pipeline decision that depends on the source and the day. Keep it next to the orchestration, as described in [who gets paged when a load fails](/blog/2026-03-14-fabric-architecture-notes-turning-messy-raw-zones-into-reliable-products/), so the transform stays a pure function you can test.

Fixtures don't replace runtime checks. Delta table constraints and [materialized lake view data quality constraints](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality) (in preview at the time of writing, so check its status before you depend on it) still catch the case you didn't imagine. Fixtures cover the ones you did, before a bad row reaches a report.

## When this is not worth it

Skip it for bronze itself, which should land data as received in line with the [medallion pattern in OneLake](https://learn.microsoft.com/fabric/onelake/onelake-medallion-lakehouse-architecture); there is nothing to decide there. Skip it for exploratory tables with one consumer who can see the raw data anyway. And if the transform is a handful of renames with no validation, a single schema assertion is enough.

It also doesn't help if the function under test isn't the function that runs in production. If your notebook still mixes reads, transformations and writes in one cell, refactoring that apart is the first job, and it's worth doing even if you never write a fixture.

## Point at a fixture, not a notebook

For any silver table that someone reports on, I want to be able to answer "what happens to a row like this?" by pointing at a fixture, not by reading a notebook. Start with the nine cases above, require that no row disappears without a reason, and add a fixture every time production surprises you. The library ends up as the most accurate documentation the table has.
