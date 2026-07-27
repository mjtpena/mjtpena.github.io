---
title: "Why Your Synapse Serverless Strings Are varchar(8000) — And How to Fix It Properly Across Spark, SQL, and Power BI"
author: Michael John Peña
draft: false
date: 2026-06-23
description: "Synapse serverless SQL infers long text columns as varchar(8000), and you can't fix it from PySpark. Here's why it happens — and how to fix it properly across Spark, SQL, and Power BI."
tags:
  - Synapse
  - Serverless SQL
  - Power BI
  - PySpark
  - Data Engineering
---

If you've worked with Azure Synapse Analytics serverless SQL pool over a Delta or Parquet lake, you've probably hit this surprise at least once: your source column is clearly a free-text field — sometimes 200,000+ characters — and yet Synapse insists on returning it as `varchar(8000)`. Worse, you start seeing the error `String or binary data would be truncated while reading column of type 'VARCHAR(8000)'.`

This isn't a bug. It's documented, deliberate behaviour — and once you understand where the boundary sits between Spark, Synapse, and Power BI, the fix becomes obvious and architecturally clean.

### What you'll learn

- Why `varchar(8000)` appears in the first place
- Why you cannot fix this from PySpark `StructType` / `StructField`
- How to fix it properly at the Synapse layer
- How this impacts Power BI semantic models
- A reference design pattern for Gold tables consumed by BI

## 1. Why Synapse Serverless Returns varchar(8000)

When you query files directly with `OPENROWSET` without an explicit schema, serverless SQL pool infers types from the file. Microsoft's [Best practices for serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/best-practices-serverless-sql-pool) article explicitly states:

> Parquet files don't contain metadata about maximum character column length. So serverless SQL pool infers it as varchar(8000).

This is reinforced in [How to use OPENROWSET in serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-openrowset), which shows that you can declare an explicit schema using a `WITH` clause containing types like `varchar(max)`:

```sql
SELECT *
FROM OPENROWSET(
    BULK N'https://account.dfs.core.windows.net/container/folder/data.parquet',
    FORMAT = 'PARQUET'
) WITH (C1 int, C2 varchar(20), C3 varchar(max)) AS rows;
```

When inference picks `varchar(8000)` and your data is longer, you hit the classic truncation error. The [Troubleshoot serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/resources-self-help-sql-on-demand) article confirms the remedy: if you use schema inference (without the `WITH` clause), all string columns are automatically defined as `VARCHAR(8000)`. To resolve the error, explicitly define the schema in a `WITH` clause with the larger `VARCHAR(MAX)` column type.

So the root cause is schema inference, and the fix is to be explicit.

## 2. Can You Fix It in PySpark StructType / StructField?

Short answer: **No.** This is one of the most common misconceptions, so it's worth being precise.

### What Spark actually supports

The Apache Spark documentation for [pyspark.sql.types.VarcharType](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.types.VarcharType.html) confirms the constructor takes a single integer `length` parameter — there is no `max` overload. And [StringType](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.types.StringType.html) itself is unbounded — it has no length parameter at all. The full list of available PySpark data types is documented in the [PySpark data types reference](https://learn.microsoft.com/en-us/azure/databricks/pyspark/reference/datatypes).

So these are the only options you have in PySpark:

```python
StructField("description", StringType(), True)         # ✅ unbounded
StructField("description", VarcharType(8000), True)    # ⚠️ bounded
StructField("description", CharType(10), True)         # ⚠️ fixed length
StructField("description", StringType(max=True))       # ❌ does not exist
StructField("description", VarcharType("max"))         # ❌ does not exist
```

### Why this matters

Spark's type system doesn't model SQL engine–specific concepts like `varchar(max)`, `nvarchar`, or `text`. Length semantics belong to the sink, not to the DataFrame. So no matter what you do at the `StructField` level, you cannot persuade Synapse serverless to project a column as `varchar(max)` purely from PySpark.

This is confirmed in community threads such as this [Stack Overflow Q&A](https://stackoverflow.com/questions/76506104/azure-synapse-pyspark-translates-string-datatype-into-varchar8000-for-external) where a developer running `spark.sql()` with `STRING` columns found their data landing as `varchar(8000)` in Synapse serverless. The community confirmation matches the Microsoft docs: serverless infers `STRING` → `varchar(8000)` by length inference.

## 3. The Right Fix: Be Explicit at the Synapse Layer

Once you accept that Spark cannot express `varchar(max)`, the architecture becomes clean. There are three patterns Microsoft documents.

### Pattern A — OPENROWSET with WITH

The simplest, directly from the [Access files on storage in serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-storage-files-overview) article:

```sql
SELECT *
FROM OPENROWSET(
    BULK 'https://account.dfs.core.windows.net/gold/dim_provider/',
    FORMAT = 'DELTA'
)
WITH (
    provider_business_key varchar(64),
    provider_name         varchar(max),
    abn                   varchar(11),
    description           varchar(max)
) AS r;
```

### Pattern B — Typed view

Wrap Pattern A in a view, so consumers (including Power BI) see a stable contract:

```sql
CREATE OR ALTER VIEW gold.dim_provider AS
SELECT *
FROM OPENROWSET(
    BULK 'https://account.dfs.core.windows.net/gold/dim_provider/',
    FORMAT = 'DELTA'
)
WITH (
    provider_business_key varchar(64),
    provider_name         varchar(max),
    abn                   varchar(11)
) AS r;
```

### Pattern C — CREATE EXTERNAL TABLE

If you prefer external tables for governance, the same explicit typing applies. Both views and external tables are valid surfaces, as described in the [serverless SQL pool storage access overview](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-storage-files-overview).

### The escape-hatch (do not rely on this)

For ad-hoc exploration only, you can suppress truncation errors:

```sql
SET ANSI_WARNINGS OFF;
SELECT TOP 100 * FROM OPENROWSET(BULK '...', FORMAT='DELTA') AS r;
SET ANSI_WARNINGS ON;
```

This is a temporary investigation tool, not a production fix.

## 4. What About Lake Databases?

If you're using Synapse Lake databases (Spark-created tables exposed automatically to the SQL engine), the [Access lake databases using serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/metadata/database) article is clear about the boundary:

> Tables in the lake databases can't be modified from a serverless SQL pool. Use the database designer or Apache Spark pools to modify a lake database.

In other words: when the table is owned by Spark, you must adjust it on the Spark side, or expose it via a serverless view that re-projects the columns explicitly.

For Gold tables consumed by Power BI, I recommend not relying on Lake database auto-exposure for wide-string columns. Instead, define your own SQL database with views (Pattern B). This:

- Decouples your Spark physical layout from your BI contract
- Lets you declare `varchar(max)` for every wide column
- Avoids drift if Spark schemas change

## 5. Power BI Consumption

Power BI is a passive consumer of whatever Synapse projects. So if Synapse says `varchar(8000)`, Power BI sees `varchar(8000)` — and your long-text columns will silently truncate or throw errors.

### Import mode (recommended for Synapse serverless)

Microsoft's [Best practices for serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/best-practices-serverless-sql-pool) article is unambiguous:

> Consider caching the results on the client side by using Power BI import mode or Azure Analysis Services, and periodically refresh them. Serverless SQL pools can't provide an interactive experience in Power BI Direct Query mode if you're using complex queries or processing a large amount of data.

In Import mode, as described in [Semantic model modes in the Power BI service](https://learn.microsoft.com/en-us/power-bi/connect-data/service-dataset-modes-understand), Power BI reads the SQL projection's metadata, ingests the values, and compresses them via VertiPaq. Once imported, there's no SQL length concept inside the semantic model — long strings (over 8k) work fine, as long as Synapse projected them as `varchar(max)`.

### DirectQuery mode

Microsoft's [DirectQuery in Power BI](https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-directquery-about) article documents that DirectQuery passes queries through to the source, so SQL types and folding behaviour matter more. For Synapse serverless plus wide text, Import mode is the safer choice, exactly as the best practices article advises.

## 6. A Reference Pattern for Gold Tables

If your Gold layer is Python-driven (e.g. you maintain a `GOLD_TABLE_SCHEMAS` dict of `StructType` definitions), you don't need to abandon Python. The pragmatic pattern is:

1. **Spark side:** keep `StringType()` everywhere. It is unbounded by definition.
2. **Generator step:** write a small Python helper that walks each `StructType` and emits Synapse view DDL where `StringType` becomes `varchar(max)` by default, and known-narrow columns (codes, ABN, postcode, surrogate keys) get tight types via an override dictionary.
3. **Synapse side:** deploy generated views per Gold table. Power BI connects to these views.

### Why this works

- The single source of truth stays in Python, beside your transformation code.
- Synapse gets an explicit contract — no inference, no `varchar(8000)`, no truncation.
- Power BI sees stable, predictable column types.
- Schema changes flow through one generator step, eliminating drift between layers.

### Avoid these patterns

- Relying on Lake database auto-exposure for wide-string columns (you lose typing control).
- `OPENROWSET` without a `WITH` clause for anything consumed downstream.
- Trying to model `varchar(max)` in PySpark — it doesn't exist.
- DirectQuery against complex serverless queries for interactive reports.

## 7. TL;DR

- Synapse serverless defaults to `varchar(8000)` when inferring schema, because Parquet doesn't store string length metadata.
- This is documented behaviour, not a bug.
- PySpark has no `varchar(max)` concept. `StringType` is unbounded; `VarcharType(n)` is bounded with no `max` overload.
- The only correct fix is to declare the schema explicitly at the Synapse layer — via `OPENROWSET … WITH (…)`, a typed view, or an external table.
- Power BI inherits whatever Synapse projects. Use Import mode for Synapse serverless, and make sure your wide-string columns are projected as `varchar(max)`.
- Keep Spark schemas simple (`StringType`) and put the type contract in Synapse. Optionally generate the Synapse DDL from your Python schemas to keep one source of truth.

## References

1. [Best practices for serverless SQL pool — Azure Synapse Analytics (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/best-practices-serverless-sql-pool)
2. [How to use OPENROWSET in serverless SQL pool — Azure Synapse Analytics (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-openrowset)
3. [Troubleshoot serverless SQL pool in Azure Synapse Analytics (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/resources-self-help-sql-on-demand)
4. [Query Parquet files using serverless SQL pool — Azure Synapse Analytics (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/query-parquet-files)
5. [Serverless SQL pool in Azure Synapse Analytics — overview (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/on-demand-workspace-overview)
6. [Access files on storage in serverless SQL pool — Azure Synapse Analytics (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-storage-files-overview)
7. [Access lake databases using serverless SQL pool — Azure Synapse Analytics (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/synapse-analytics/metadata/database)
8. [PySpark API — pyspark.sql.types.VarcharType (Apache Spark)](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.types.VarcharType.html)
9. [PySpark API — pyspark.sql.types.StringType (Apache Spark)](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.types.StringType.html)
10. [PySpark data types reference (Microsoft Learn — Azure Databricks)](https://learn.microsoft.com/en-us/azure/databricks/pyspark/reference/datatypes)
11. [DirectQuery in Power BI — when to use, limitations, alternatives (Microsoft Learn)](https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-directquery-about)
12. [Semantic model modes in the Power BI service (Microsoft Learn)](https://learn.microsoft.com/en-us/power-bi/connect-data/service-dataset-modes-understand)
13. [Azure Synapse pyspark translates STRING datatype into varchar(8000) for external table (Stack Overflow)](https://stackoverflow.com/questions/76506104/azure-synapse-pyspark-translates-string-datatype-into-varchar8000-for-external)
