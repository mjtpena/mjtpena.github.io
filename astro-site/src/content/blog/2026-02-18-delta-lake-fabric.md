---
title: "Delta Lake in Fabric: Not Every Engine Reads Every Table"
description: "Every Fabric engine speaks Delta Lake, but not the same features. How to use the interoperability matrix so Spark tables still work in SQL and Power BI."
author: Michael John Peña
draft: false
date: 2026-02-18
tags:
  - Microsoft Fabric
  - Delta Lake
  - Lakehouse
  - Spark
  - Direct Lake
---

When I tell clients "everything in Fabric uses Delta Lake format," data engineers nod, everyone else looks blank, and the engineers aren't quite right either. Fabric does store tables as Delta, but each engine supports a different slice of the Delta protocol. A table that works fine in a Spark notebook can still be a problem for the SQL analytics endpoint, a pipeline or a Direct Lake semantic model.

The basics of Delta (ACID transactions, time travel, `MERGE`, schema evolution) are covered in my earlier posts on [Delta tables in Fabric](/blog/2023-07-07-delta-tables-in-fabric/) and [time travel and schema evolution](/blog/2025-11-06-november-ai-topic/). This post is about the part that causes problems in production: which Delta features each Fabric engine can read and write, and how to keep a shared table usable by all of them.

## "Delta" is a protocol with versions, not one format

A Delta table is Parquet files plus a transaction log in `_delta_log`. The log also holds a **protocol**: a minimum reader version, a minimum writer version and, on newer tables, a list of named **table features** such as deletion vectors, column mapping or liquid clustering. An engine that doesn't understand a feature the protocol lists can't safely read or write that table.

This is where "everything is Delta" falls short. Fabric has at least eight engines touching OneLake tables. Microsoft groups them by role on the [Delta Lake table format interoperability](https://learn.microsoft.com/en-us/fabric/fundamentals/delta-lake-interoperability) page:

- **Writers only:** Warehouse, eventstreams, and Power BI semantic models exported to OneLake.
- **Readers only:** the SQL analytics endpoint and Direct Lake semantic models.
- **Both:** Fabric Spark, Dataflows Gen2, pipelines and KQL databases.

Each of those engines supports a different set of features. I treat that page as the contract for any table more than one engine will touch.

## The matrix, trimmed to what bites

The full matrix on Learn has more columns and rows. This is the subset I check most often, as of February 2026:

| Engine | Column mapping | Deletion vectors | Liquid clustering | TIMESTAMP_NTZ | Writes V-Order |
|---|---|---|---|---|---|
| Spark Runtime 1.3 | Name and ID | Yes | Yes | Yes | Yes |
| SQL analytics endpoint (read) | Name only | Yes | Yes | No | N/A |
| Direct Lake (read) | Name and ID | Yes | Yes | No | N/A |
| Dataflows Gen2 | Name only | Yes | Read only | No | Yes |
| Pipelines (copy) | No | No | Read only | No | Yes |
| Warehouse (writer) | Name only | Yes | No | No | Yes |
| Eventstreams (writer) | No | No | No | No | No |

The matrix also gives pipelines "overwrite only" for writes, and lists the Delta protocol versions each writer produces. Warehouse tables come out at reader 3 / writer 7 with deletion vectors and name-based column mapping on. Spark, Dataflows Gen2 and pipelines write reader 1 / writer 2 by default.

Three columns in that table are where most problems come from.

### TIMESTAMP_NTZ

Spark Runtime 1.3 (Spark 3.5, Delta 3.2) can write `TIMESTAMP_NTZ` columns. The matrix marks the SQL analytics endpoint and Direct Lake as not supporting them. If a gold table is meant for SQL users or a semantic model, I cast to a regular `TIMESTAMP` (or a `DATE`) before writing. It's a one-line fix during the write. Once the table exists, the fix is a rewrite: create a new table with `CREATE TABLE ... AS SELECT` that casts the column to `TIMESTAMP`, then repoint consumers. If Spark jobs still need the NTZ version, keep it and publish a compatible gold copy alongside it, which is the multiple-copies pattern I come back to in the V-Order section.

### Column mapping by ID

Spark can create tables with `delta.columnMapping.mode = 'id'`. Direct Lake reads them, but the SQL analytics endpoint and Dataflows Gen2 only support **name** mode. Pipelines support neither. No Fabric experience writes ID-mode column mapping by default. The usual way these tables get in is through a shortcut to a table another platform wrote. The Learn page states it directly: "Delta Lake tables produced by third-party services may have incompatible table features." If you share tables between Databricks and Fabric (see [Databricks or Fabric in 2026](/blog/2026-01-14-databricks-vs-fabric/)), check the producer's defaults before assuming a shortcut will just work. If an ID-mode table is already in place, the practical recovery is the same as for TIMESTAMP_NTZ: materialise a Fabric-written copy (Spark writes name-mode or no column mapping by default) and point SQL and Dataflows consumers at that copy instead of the shortcut.

### Pipelines are the lowest common denominator

Copy activity in pipelines doesn't support column mapping or deletion vectors, and it writes to Delta tables in overwrite mode only. That's fine for landing raw data in bronze. I wouldn't point a pipeline at a curated table that Spark jobs have enabled deletion vectors on.

## Features Fabric doesn't support yet

The same page lists the features that aren't supported across Fabric as of this month:

- **V2 checkpoints:** only Spark notebooks and Spark job definitions handle them. The Lakehouse explorer and SQL analytics endpoint don't list tables with V2 checkpoint files correctly. If one slips onto a shared table, Delta 3.2 in Runtime 1.3 can remove it with `ALTER TABLE <table-name> DROP FEATURE v2Checkpoint`, followed by a second run with `TRUNCATE HISTORY` once the retention period has passed.
- **Delta UniForm:** Spark compute only.
- **Writing identity columns** and **Lakeflow Spark Declarative Pipelines** (both Azure Databricks features).
- **Delta 4.x features:** type widening, collations, the variant type and coordinated commits.

The last item matters because [Fabric Runtime 2.0](https://learn.microsoft.com/en-us/fabric/data-engineering/runtime-2-0) is in **experimental preview** with Spark 4.0 and Delta Lake 4.0. It's worth trying in a dev workspace, but Microsoft's guidance is explicit: Delta 4.0 features only work in Spark experiences, so don't enable them on tables other Fabric workloads read. The early release also leaves out V-Order, optimize write, autocompaction, `MERGE`, schema evolution and time travel, so it isn't a production runtime yet.

Protocol upgrades are **irreversible**. The [runtime documentation](https://learn.microsoft.com/en-us/fabric/data-engineering/runtime) warns about this when you call `upgradeTableProtocol`. Some features can later be removed with `ALTER TABLE ... DROP FEATURE`, but only a short list supports it, and the drop involves truncating the table's history, so it isn't something to plan around. Treat enabling a feature on a shared table as a breaking change. My rule is that nobody enables a new table feature on a shared table without checking the matrix first.

## Check what your tables actually use

You don't need to guess. Delta records the protocol in the table, so a short notebook can audit a lakehouse. This runs in a Fabric notebook attached to the lakehouse you want to check. It lists each table's protocol versions and features, and flags the cases from the matrix that break SQL or Direct Lake consumers.

```python
from pyspark.sql.types import TimestampNTZType

# Features that only some Fabric engines support (see the interoperability matrix).
SPARK_ONLY_FEATURES = {"v2Checkpoint", "typeWidening", "typeWidening-preview",
                       "variantType", "variantType-preview"}

def audit_table(table_name: str) -> dict:
    detail = spark.sql(f"DESCRIBE DETAIL `{table_name}`").collect()[0].asDict()
    features = set(detail.get("tableFeatures") or [])
    props = {r["key"]: r["value"] for r in spark.sql(f"SHOW TBLPROPERTIES `{table_name}`").collect()}
    schema = spark.table(table_name).schema

    issues = []
    if props.get("delta.columnMapping.mode") == "id":
        issues.append("column mapping by ID: SQL endpoint, Dataflows Gen2 and pipelines can't use it")
    ntz_cols = [f.name for f in schema.fields if isinstance(f.dataType, TimestampNTZType)]
    if ntz_cols:
        issues.append(f"TIMESTAMP_NTZ columns {ntz_cols}: not supported by SQL endpoint or Direct Lake")
    if features & SPARK_ONLY_FEATURES:
        issues.append(f"Spark-only features: {sorted(features & SPARK_ONLY_FEATURES)}")

    return {
        "table": table_name,
        "reader": detail["minReaderVersion"],
        "writer": detail["minWriterVersion"],
        "features": sorted(features),
        "issues": issues,
    }

for t in spark.catalog.listTables():
    # Skip views and temporary views; DESCRIBE DETAIL only works on tables.
    if t.tableType in ("VIEW", "TEMPORARY") or t.isTemporary:
        continue
    try:
        result = audit_table(t.name)
    except Exception as e:
        # Non-Delta tables and anything DESCRIBE DETAIL can't read.
        print(f"[SKIP] {t.name}: {e}")
        continue
    status = "OK" if not result["issues"] else "CHECK"
    print(f"[{status}] {result['table']} r{result['reader']}/w{result['writer']} {result['features']}")
    for issue in result["issues"]:
        print(f"    - {issue}")
```

On legacy-protocol tables (for example reader 1 / writer 2), `tableFeatures` lists only the features those versions imply, such as `appendOnly` and `invariants`. Named features like `deletionVectors` or `v2Checkpoint` appear once a table moves to reader 3 / writer 7. The `or []` guard covers engines that return null. On a schema-enabled lakehouse, pass the schema to `spark.catalog.listTables("<schema-name>")` and qualify the table names.

## V-Order is now a decision, not a default

One more thing has changed since Fabric's early days. New workspaces default to the `writeHeavy` [Spark resource profile](https://learn.microsoft.com/en-us/fabric/data-engineering/configure-resource-profile-configurations), and that profile turns V-Order **off**. A lot of older Fabric guidance assumed V-Order was always on (I compared the two orderings in [Z-Order vs V-Order](/blog/2024-08-19-zorder-vs-vorder/)). That's no longer true for new workspaces.

Microsoft's [cross-workload table maintenance guidance](https://learn.microsoft.com/en-us/fabric/fundamentals/table-maintenance-optimization) gives the trade-off in numbers. It estimates 40-60% faster cold-cache queries for Direct Lake and about 10% faster reads for the SQL analytics endpoint and Warehouse. Spark reads see no benefit, and writes are 15-33% slower. I set it per table, not per session, so the decision stays with the table:

```sql
ALTER TABLE gold.fact_sales
SET TBLPROPERTIES ('delta.parquet.vorder.enabled' = 'true');

-- Rewrite existing files so the setting applies to current data, not just new writes
OPTIMIZE gold.fact_sales VORDER;
```

Bronze tables that only Spark reads don't need V-Order. Gold tables behind a Direct Lake model should have it. Silver depends on who's querying it. The same guidance also says it's fine to keep separate copies of a table tuned for different consumers. I agree: storage is cheap compared with capacity spent working around a poor file layout.

## When the matrix doesn't matter

If a table is only ever read and written by Spark (staging tables, feature engineering scratch space, intermediate silver tables no one queries in SQL), use whatever Delta features help. Deletion vectors, liquid clustering and even V2 checkpoints are fine there. The matrix only matters at the boundaries: tables exposed through the SQL analytics endpoint, Direct Lake models, Dataflows Gen2, pipelines, or shortcuts from another platform.

## The takeaway

"Everything in Fabric is Delta" is true, and it's still the main reason the platform hangs together. Spark writes a table, the SQL endpoint and Power BI read it, and nothing gets copied. But it's a shared protocol with versions, and each engine supports a different part of it. Treat the interoperability matrix as an API contract. Decide which engines consume each layer, and keep gold tables to features every consumer supports. Audit the protocol before someone enables a new table feature and quietly breaks a report.
