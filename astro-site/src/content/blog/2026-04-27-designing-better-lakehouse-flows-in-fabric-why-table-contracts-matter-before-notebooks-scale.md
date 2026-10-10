---
title: "Changing a Shared Fabric Table Without Breaking Its Notebooks"
description: "How to version a Fabric lakehouse table contract once several notebooks depend on it: change classes, a writer guard, pinned readers and safe renames."
author: Michael John Peña
draft: false
date: 2026-04-27
tags:
  - Microsoft Fabric
  - Lakehouse
  - Delta Lake
  - Data Engineering
  - Data Quality
---

A lakehouse table with one writer notebook and one reader notebook doesn't need much ceremony. Once five notebooks, a semantic model and an AI team's feature pipeline read it, the table's schema has become an API, and every "small tidy-up" in the writer is a potential outage for someone you've never met. In my experience the outage at that stage is rarely caused by a missing feature; it's a hidden dependency, so the fix is to make the contract explicit and give it rules for change before the notebook count grows.

I've already written about [what a table contract should contain and where to enforce it](/blog/2026-03-03-lakehouse-decisions-i-made-this-week-turning-messy-raw-zones-into-reliable-products/). This post is about the next problem: how you *change* that contract once other people depend on it.

## The schema becomes an API before anyone notices

The data-to-AI handoff is the classic case. The engineering team owns `silver.orders`. An ML notebook builds features from it. A Direct Lake model reports on it. Nobody wrote down which columns each consumer uses, so nobody knows which changes are safe.

Delta Lake protects you from some of this, but less than people assume. Its [schema validation rules](https://docs.delta.io/delta-batch/#schema-validation) reject a write that adds an unknown column or changes a column's type. They do **not** reject a write that is missing a column: columns present in the table but absent from the DataFrame are quietly set to null. So the most common real-world break, where a writer refactor drops a column and every downstream feature turns null, passes straight through. `NOT NULL` constraints, which the earlier post recommends for required columns, do catch that case for the columns you declared required. The gap is everything else: optional columns that go silently null, and columns nobody declared at all. And when someone "fixes" a failing write with a write option, the protections shrink further: `mergeSchema` quietly accepts new columns, and `overwriteSchema` replaces the schema outright.

That's why I think of the contract as three things the platform won't give you by default: a declared schema in Git, a check that runs before every write, and a version number consumers can pin to.

## Classify every change before you make it

The most useful thing a team can agree on is a short table of change classes. It turns "is this safe?" from a debate into a lookup.

| Change | Class | What consumers need to do |
|---|---|---|
| Add a nullable column | Minor (non-breaking) | Nothing, as long as readers select explicit columns |
| Tighten a rule (new CHECK constraint, stricter allowed values) | Minor, with notice | Nothing, but upstream loads may start failing. A CHECK constraint also adds the `checkConstraints` writer feature (writer version 3), so before rolling it out, run `DESCRIBE DETAIL` to see the current `minWriterVersion` and test one Copy activity and one Dataflow Gen2 refresh against a cloned table |
| Rename a column | Major (breaking) | Update every reference; run the deprecation window below |
| Drop a column | Major | Remove references first |
| Change a column's type | Major | Treat as add-new-column, migrate, drop old |
| Change the grain (one row per order becomes one row per order line) | New table | Build `orders_lines`; don't mutate `orders` |

I use semantic versioning for the contract: minor bumps for additive changes, major bumps for anything in the breaking rows. Grain changes don't get a version at all. A table whose grain changes is a different table, and pretending otherwise is how aggregates start double counting without any write ever failing.

On type changes specifically: Fabric Runtime 1.3 ships Delta Lake 3.2, where type widening is still a preview feature, and as of April 2026 the [Delta Lake interoperability page](https://learn.microsoft.com/en-us/fabric/fundamentals/delta-lake-interoperability) lists type widening under its current limitations: outside Lakehouse and Spark notebooks and jobs, Fabric engines don't support it. Runtime 2.0 (public preview at the time of writing, Spark 4.0 / Delta 4.0) doesn't change that yet: Delta 4.0 supports type widening, but only Spark experiences can use it, so the SQL analytics endpoint and Direct Lake can't follow. I don't rely on in-place type changes on shared tables.

## A writer guard that runs before every write

The contract lives as code in the same Git-connected workspace as the notebooks, so a contract change shows up in the same pull request as the writer change. This is the guard I put in front of the writer. It's plain PySpark against the `spark` session a Fabric notebook already provides, and it assumes the notebook's default lakehouse is schema-enabled with a `silver` schema (otherwise use `lakehouse.table` names):

```python
import logging

from pyspark.sql import DataFrame, functions as F
from pyspark.sql.types import (
    DateType, DecimalType, StringType, StructField, StructType, TimestampType,
)

log = logging.getLogger(__name__)

# 2.0.0 matches the silver.orders DDL from the earlier contract post.
# 2.1.0 (minor) added the nullable channel column.
# 2.2.0 (minor) started renaming channel to sales_channel; both are written.
ORDERS_CONTRACT = {
    "table": "silver.orders",
    "version": "2.2.0",
    "schema": StructType([
        StructField("order_id", StringType()),
        StructField("customer_id", StringType()),
        StructField("order_date", DateType()),
        StructField("order_total", DecimalType(18, 2)),
        StructField("currency", StringType()),
        StructField("source_updated_at", TimestampType()),
        StructField("_source_file", StringType()),
        StructField("_loaded_at", TimestampType()),
        StructField("channel", StringType()),
        StructField("sales_channel", StringType()),
    ]),
    "required": [
        "order_id", "customer_id", "order_date",
        "order_total", "currency", "source_updated_at",
    ],
    # column -> removal date; still written and checked, but flagged on every load
    "deprecated": {"channel": "2026-07-01"},
}


def check_contract(df: DataFrame, contract: dict) -> list[str]:
    """Return a list of contract violations; an empty list means the DataFrame conforms.

    Pure check with no side effects, so it's safe to call from unit tests.
    """
    problems = []
    expected = {f.name: f.dataType for f in contract["schema"].fields}
    actual = {f.name: f.dataType for f in df.schema.fields}

    for name, dtype in expected.items():
        if name not in actual:
            problems.append(f"missing column: {name}")
        elif actual[name] != dtype:
            problems.append(
                f"{name}: expected {dtype.simpleString()}, got {actual[name].simpleString()}"
            )
    for name in sorted(actual.keys() - expected.keys()):
        problems.append(f"undeclared column: {name}")

    required = [c for c in contract["required"] if c in actual]
    if required:
        null_counts = df.select(
            [F.sum(F.col(c).isNull().cast("int")).alias(c) for c in required]
        ).first()
        for c in required:
            if null_counts[c]:
                problems.append(f"{null_counts[c]} nulls in required column: {c}")
    return problems


def check_table(contract: dict) -> list[str]:
    """Compare the live table's schema with the contract.

    Delta fills table columns missing from a write with nulls, so a column the
    table has but the contract doesn't would be nulled silently on every load.
    """
    if not spark.catalog.tableExists(contract["table"]):
        return []
    expected = {f.name: f.dataType for f in contract["schema"].fields}
    actual = {f.name: f.dataType for f in spark.table(contract["table"]).schema.fields}
    problems = [f"table has undeclared column: {n}" for n in sorted(actual.keys() - expected.keys())]
    problems += [f"table lacks contract column: {n}" for n in sorted(expected.keys() - actual.keys())]
    problems += [
        f"table {n}: expected {expected[n].simpleString()}, got {actual[n].simpleString()}"
        for n in sorted(expected.keys() & actual.keys())
        if expected[n] != actual[n]
    ]
    return problems


def write_with_contract(df: DataFrame, contract: dict, mode: str = "append") -> None:
    # The null check and the write are two Spark actions; persisting stops the
    # upstream transforms running twice.
    df = df.persist()
    try:
        problems = check_table(contract) + check_contract(df, contract)
        if problems:
            raise ValueError(
                f"{contract['table']} contract {contract['version']} violated:\n- "
                + "\n- ".join(problems)
            )
        # Warn once per load, only after the check has passed.
        for name, removal_date in contract.get("deprecated", {}).items():
            log.warning("%s.%s is deprecated, removal on %s", contract["table"], name, removal_date)
        columns = [f.name for f in contract["schema"].fields]
        (
            df.select(*columns)
            .write.format("delta")
            .mode(mode)
            .option("userMetadata", f"contract={contract['version']}")
            .saveAsTable(contract["table"])
        )
    finally:
        df.unpersist()

    # The table property is advisory: it's a separate commit after the data
    # commit, so it can lag if the notebook fails in between. The userMetadata
    # on each commit is the authoritative record. Only touch table metadata
    # when the version changes, so a routine load stays one commit.
    table = contract["table"]
    props = {
        row.key: row.value
        for row in spark.sql(f"SHOW TBLPROPERTIES {table}").collect()
    }
    if props.get("contract.version") != contract["version"]:
        spark.sql(
            f"ALTER TABLE {table} "
            f"SET TBLPROPERTIES ('contract.version' = '{contract['version']}')"
        )
```

Four details matter more than the code itself:

- **Missing columns fail, in both directions.** `check_contract` rejects a DataFrame missing a contract column; `check_table` rejects a table with a column the contract doesn't declare, such as one added by a stray `ALTER TABLE`. Either way, Delta's silent null-fill can't happen.
- **Undeclared columns fail.** A writer can't sneak a new column in without a contract bump.
- **The version travels with the data.** The `userMetadata` option stamps each commit, so `DESCRIBE HISTORY` shows which contract version wrote which data. The table property gives readers one place to check the current version, but it's a convenience; if the two ever disagree, the commit history wins, and `DESCRIBE HISTORY silver.orders LIMIT 1` shows the latest commit with its `userMetadata`. I'd rather set that property in the reviewed migration that bumps the contract; the guarded `ALTER TABLE` is a fallback that runs once per version, not once per load, so a routine append stays one atomic commit. That also keeps you clear of metadata-change conflicts if you ever have more than one writer, or a maintenance job such as `OPTIMIZE` running alongside.
- **No `mergeSchema`.** Schema evolution happens through an explicit `ALTER TABLE` in a reviewed change, never as a side effect of a write.

The guard isn't free. The required-column null count is a full Spark action; without the `persist()` the lineage would run once for the check and again for the write. Even cached, it costs an extra pass and executor memory. On small and medium silver loads that cost is noise. On very large loads I keep the schema checks, which are metadata-only and cost nothing, and leave required columns to `NOT NULL` constraints, which Delta enforces during the write itself.

Where the guard lives is a real trade-off. A shared notebook pulled in with `%run` is the fastest to start with, but every consumer then depends on a notebook path. Packaging the contracts as a wheel and installing it as a custom library in a [Fabric environment](https://learn.microsoft.com/en-us/fabric/data-engineering/environment-manage-library) gives you a proper version and one install point, at the cost of an environment publish for every contract change. I start with `%run` and move to an environment library once a second team consumes the tables.

## Readers pin a major version

The other half of the contract is on the consumer side, and it's the half teams skip. Two rules:

1. Select explicit columns. `select *` turns every additive change into a breaking one for anything that writes the result somewhere with a fixed schema.
2. Check the major version before reading.

Readers check the table property, not the commit history, and that's safe because of ordering: the reviewed migration sets the property *before* the writer change ships, so a major bump fails readers early, before any 3.x data lands. This fragment runs in the consumer notebook, against the same schema-enabled lakehouse:

```python
props = {
    row.key: row.value
    for row in spark.sql("SHOW TBLPROPERTIES silver.orders").collect()
}
contract_version = props.get("contract.version", "0.0.0")
if contract_version.split(".")[0] != "2":
    raise RuntimeError(
        f"feature build expects silver.orders contract 2.x, found {contract_version}"
    )

orders = spark.table("silver.orders").select(
    "order_id", "customer_id", "order_date", "order_total", "currency"
)
```

This matters most at the data-to-AI handoff. A feature pipeline that fails loudly with "expects 2.x, found 3.0" on the morning of a release is annoying. A feature pipeline that silently trains on a renamed column full of nulls is much worse, and usually gets noticed in a model metric weeks later.

## Renames and drops: use a deprecation window

Renames are where people reach for [Delta column mapping](https://docs.delta.io/delta-column-mapping/), which lets you run `ALTER TABLE ... RENAME COLUMN` and `DROP COLUMN` without rewriting Parquet files. It works in Fabric Spark, and the interoperability matrix shows name-mode column mapping as readable by the SQL analytics endpoint and Direct Lake models. Two cautions before you enable it on a shared table:

- Enabling it upgrades the table protocol (reader version 2, writer version 5), and the [Fabric runtime docs](https://learn.microsoft.com/en-us/fabric/data-engineering/runtime#upgrade-delta-lake-protocol) warn that protocol upgrades are irreversible; Delta 3.2 in Runtime 1.3 can't drop column mapping. Pipelines in the matrix don't support column mapping, so a Copy activity that reads or writes the table can break.
- An instant rename is still a breaking change for every consumer. Column mapping makes the *storage* operation cheap; it does nothing for the notebooks that still reference the old name.

So for shared tables I run renames as a window rather than a single statement:

1. Minor bump: add the new column and have the writer populate both old and new. Mark the old one in the contract's `deprecated` map with a removal date, so every load logs a warning until it goes.
2. Consumers move to the new column at their own pace, inside the window.
3. Major bump: stop writing the old column, then drop it (with column mapping enabled, or by rewriting the table if Pipelines need to keep reading it).

It's slower than a rename. It's also the only version that doesn't need everyone in the same meeting.

## Tables that don't need a version number

Bronze is already out of scope under the earlier post's "raw stays raw, contracts start at silver" rule. Within silver and gold, I still skip versioning for:

- **Tables with one consumer that the same person owns.** The contract is in that person's head, and the guard costs more than it saves.
- **Exploratory and sandbox lakehouses.** If it's not on a schedule, it doesn't need change control.

The trigger for me is the second consumer owned by a different team. That's when "I'll just rename it" stops being your decision alone. It's also why I'd do this before the notebook count grows: retrofitting version checks into twenty consumers is far harder than adding them to the first three.

If you want the inputs side of this, the [bad-input fixtures post](/blog/2026-03-25-fabric-lakehouse-patterns-turning-messy-raw-zones-into-reliable-products/) covers testing the transform before it reaches the writer guard.

## The rule I'd write on the wall

Treat a shared table like a published API: declare the schema in Git, check it before every write, stamp a version on the table, make readers pin a major version, and run breaking changes through a deprecation window. The code is small. The real work is agreeing on the change classes, and that agreement is worth more than any validation framework you could add on top.
