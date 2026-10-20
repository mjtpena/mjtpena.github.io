---
title: "Synapse Serverless varchar(8000): Fixing Strings for Spark and Power BI"
author: Michael John Peña
draft: false
date: 2026-06-23
description: "Why Synapse serverless SQL infers strings as varchar(8000), why Spark-created lake tables behave differently, and where Power BI string contracts belong."
tags:
  - Synapse
  - Serverless
  - Power BI
  - PySpark
  - Data Engineering
---

The failure usually looks like this: a Gold table in the lake has a free-text column with values well past 8,000 characters, Spark reads it without complaint, and the first Power BI refresh through Azure Synapse serverless SQL pool fails with "String or binary data would be truncated". The column is `varchar(8000)` on the SQL side, even though no one chose that length.

No one had to. The number comes from schema inference, and where you fix it depends on how the table reaches serverless SQL in the first place. Get that wrong and you end up with `varchar(max)` on every column, which trades a refresh failure for slower queries.

## Where varchar(8000) comes from

When you query Parquet or Delta files with `OPENROWSET` and no `WITH` clause, serverless SQL pool infers each column's type from the file. Parquet stores a string as a UTF-8 byte array with no declared maximum length. The [serverless SQL pool best practices](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/best-practices-serverless-sql-pool#check-inferred-data-types) put it plainly: "Parquet files don't contain metadata about maximum character column length. So serverless SQL pool infers it as varchar(8000)." Delta follows the same rule because its data files are Parquet.

That one default causes two separate problems:

- **Values longer than 8,000 bytes fail.** The [serverless SQL troubleshooting guide](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/resources-self-help-sql-on-demand#string-or-binary-data-would-be-truncated) says that with schema inference "all string columns are automatically defined as the `VARCHAR(8000)` type" and that the fix is an explicit `WITH` schema using `VARCHAR(MAX)`.
- **Short values get an oversized type.** A three-character state code inferred as `varchar(8000)` costs performance and concurrency; the same page tells you to use the smallest type that fits.

You can see what serverless SQL pool inferred before anything downstream depends on it:

```sql
EXEC sp_describe_first_result_set N'
    SELECT *
    FROM OPENROWSET(
        BULK ''https://<storage-account>.dfs.core.windows.net/<container>/gold/dim_provider/'',
        FORMAT = ''DELTA''
    ) AS r';
```

Every string column shows up as `varchar(8000)` in `system_type_name`. That is your to-do list.

## Lake database tables behave differently

Tables you create in a Synapse Spark pool as Parquet, CSV or Delta (Delta access is still documented as public preview) are synchronised into a lake database that serverless SQL can query. They skip `OPENROWSET` inference and use the [Spark-to-SQL type mapping for shared tables](https://learn.microsoft.com/en-us/azure/synapse-analytics/metadata/table#share-spark-tables):

| Spark column type | Serverless SQL type |
|---|---|
| `StringType` (no length) | `varchar(max)` |
| `VARCHAR(n)` declared in the table DDL | `varchar(n)` |
| Partition column with a declared length | `varchar(n)`, `n` at most 2048 |
| `array`, `map`, `struct` | `varchar(max)` serialised as JSON |

So if a Spark-created table shows `varchar(8000)` in serverless SQL, something is almost certainly reading the files with `OPENROWSET` and inference, not the synchronised table. Check which object Power BI connects to first: the Power Query source names it, and running `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS` in the lake database and again in your user database shows which one reports 8000 (`-1` means `max`).

It also means that "you can't control string length from Spark" isn't quite right. `StringType` has no length, and `VarcharType` takes only an integer, so there is no `max` to declare. But a table created with `VARCHAR(64)` in Spark SQL DDL does arrive in serverless SQL as `varchar(64)`. The catch is that Spark enforces that length on write: a single over-length value fails the whole write.

Microsoft's troubleshooting guide does suggest this route for lake database tables: increase the string column size in the Spark pool. I still wouldn't push SQL sizing decisions into Spark DDL just to shape a BI contract. A report width can now break an ingestion job, and you can't change a BI column width without altering the Spark table.

## Put the contract in a typed view

My default for anything Power BI consumes is a view in a serverless SQL database you own, with every column typed explicitly. This follows Microsoft's explicit schema guidance for querying Delta Lake, including the UTF-8 collation that Delta string data needs:

```sql
USE <your-serverless-db>;
GO

IF SCHEMA_ID('gold') IS NULL EXEC('CREATE SCHEMA gold');
GO

CREATE OR ALTER VIEW gold.dim_provider AS
SELECT *
FROM OPENROWSET(
    BULK 'https://<storage-account>.dfs.core.windows.net/<container>/gold/dim_provider/',
    FORMAT = 'DELTA'
)
WITH (
    provider_business_key varchar(64)  COLLATE Latin1_General_100_BIN2_UTF8,
    provider_name         varchar(400) COLLATE Latin1_General_100_BIN2_UTF8,
    abn                   char(11)     COLLATE Latin1_General_100_BIN2_UTF8,
    state_code            varchar(3)   COLLATE Latin1_General_100_BIN2_UTF8,
    description           varchar(max) COLLATE Latin1_General_100_BIN2_UTF8,
    updated_at            datetime2(6)
) AS r;
```

Run this in a user database you created, not `master`. The column names in the `WITH` clause must match the column names in the Delta table. Only `description` gets `varchar(max)`. Keys and codes get tight types for the reasons in the next section. Every string gets the `BIN2_UTF8` collation because, per the same best practices page, predicate pushdown on Parquet character columns only works with `Latin1_General_100_BIN2_UTF8`. If you'd rather not repeat the collation on every column, set it once with `ALTER DATABASE CURRENT COLLATE Latin1_General_100_BIN2_UTF8;`.

Why a view rather than an external table? Serverless SQL external tables don't support partitioning on Delta folders (no partition elimination), so the documentation points you at partitioned views instead. A view also lets you rename, cast and add columns without touching the Spark job. External tables still make sense for Parquet or CSV when you want a table-shaped object, but the typing rule is the same: never let a consumed column fall back to inference.

### When not to reach for varchar(max)

The lazy fix is to declare every string as `varchar(max)`. It ends the errors, but the troubleshooting guide warns that `VARCHAR(MAX)` can impair performance, and it hides the fact that your data has no agreed shape. My rule of thumb: `varchar(max)` only for columns where you've confirmed values can exceed 8,000 bytes. Remember that the limit is bytes, not characters, and UTF-8 text with accents or non-Latin scripts uses more than one byte per character. Everything else gets a measured length with some headroom.

### The ANSI_WARNINGS escape hatch

The troubleshooting guide also documents `SET ANSI_WARNINGS OFF`, which makes serverless SQL truncate oversized values silently instead of failing. Fine for exploring a file; in a view feeding a report, users see clipped text and no one gets an error. I treat it as a diagnostic, never a fix.

## Generate the view DDL from your Spark schemas

If your Gold layer already defines schemas in Python as `StructType` objects, you don't need a second hand-maintained contract. Generate the view from the same definitions, with an override map for columns that need specific sizes:

```python
from pyspark.sql.types import (
    StructType, StructField, StringType, IntegerType, LongType,
    BooleanType, DateType, TimestampType, DecimalType, DoubleType,
)

COLLATION = "Latin1_General_100_BIN2_UTF8"

def sql_type(field: StructField, overrides: dict) -> str:
    if field.name in overrides:
        return overrides[field.name]
    t = field.dataType
    if isinstance(t, StringType):
        return f"varchar(8000) COLLATE {COLLATION}"
    if isinstance(t, IntegerType):
        return "int"
    if isinstance(t, LongType):
        return "bigint"
    if isinstance(t, BooleanType):
        return "bit"
    if isinstance(t, DateType):
        return "date"
    if isinstance(t, TimestampType):
        return "datetime2(6)"
    if isinstance(t, DoubleType):
        return "float"
    if isinstance(t, DecimalType):
        return f"decimal({t.precision},{t.scale})"
    raise ValueError(f"No SQL mapping for {field.name}: {t}")

def view_ddl(view: str, path: str, schema: StructType, overrides: dict) -> str:
    cols = ",\n    ".join(
        f"[{f.name.replace(']', ']]')}] {sql_type(f, overrides)}" for f in schema.fields
    )
    return (
        f"CREATE OR ALTER VIEW {view} AS\nSELECT *\nFROM OPENROWSET(\n"
        f"    BULK '{path}',\n    FORMAT = 'DELTA'\n)\nWITH (\n    {cols}\n) AS r;"
    )

dim_provider = StructType([
    StructField("provider_business_key", StringType(), False),
    StructField("provider_name", StringType(), True),
    StructField("abn", StringType(), True),
    StructField("state_code", StringType(), True),
    StructField("description", StringType(), True),
    StructField("updated_at", TimestampType(), True),
])

print(view_ddl(
    "gold.dim_provider",
    "https://<storage-account>.dfs.core.windows.net/<container>/gold/dim_provider/",
    dim_provider,
    {
        "provider_business_key": f"varchar(64) COLLATE {COLLATION}",
        "provider_name": f"varchar(400) COLLATE {COLLATION}",
        "abn": f"char(11) COLLATE {COLLATION}",
        "state_code": f"varchar(3) COLLATE {COLLATION}",
        "description": f"varchar(max) COLLATE {COLLATION}",
    },
))
```

The default for unlisted strings is deliberately `varchar(8000)`, not `varchar(max)`, so wide columns become an explicit decision in code review. The generator raises an error on unmapped types rather than guessing, so a new nested column breaks the build instead of the report. Any type not in the mapping, including `FloatType`, `ShortType`, `ByteType` and `BinaryType`, raises an error until you add it. `TimestampNTZType` falls through to the error on purpose, because serverless SQL can't read Delta's timestamp-without-timezone type. With those overrides the output gives equivalent column definitions (names are bracket-quoted, so a column with a space or a reserved word still produces valid DDL). It doesn't emit the `USE` or schema statements, so apply it from your deployment pipeline against the user database that holds the `gold` schema.

The trade-off: you now own a mapping table. For a small, stable Gold layer, hand-written views are simpler to review. The generator pays off at a few dozen tables or more, or when schemas change often.

## What Power BI sees

Power BI takes column types from whatever serverless SQL returns. Fix the view and Power BI picks it up on the next refresh.

### Text length in the model

The length contract stops at SQL: Power BI maps every `varchar` and `char` length to its single Text type, so `varchar(3)` and `varchar(max)` look the same in the model. Microsoft's Power BI Desktop data types page gives Text a maximum of 268,435,456 characters, but Power Query has long silently truncated text values above 32,766 characters when loading into an Import model (Chris Webb documented it in 2019, and it is still widely reported). Test with a known long value before you rely on it. If a value really is longer, split it across rows or columns in the view, or keep only a preview column in the model.

After the first refresh, check the longest value with a `LEN` measure against the source. If they don't match and the source value is over 32,766 characters, suspect that reported Power Query truncation; otherwise something between the view and the model is still clipping text.

### Refresh identity and storage credentials

A view that works in Synapse Studio under your own Entra ID pass-through can fail on a scheduled refresh, because the service connects with the credential stored on the semantic model. If that's a SQL login, serverless SQL can't pass an Entra identity to storage. Because the view calls `OPENROWSET` with an absolute URL and no `DATA_SOURCE`, a SQL login uses a server-level credential whose name matches the storage URL, per the [storage access control guide](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-storage-files-storage-access-control). Either create one in `master` and grant the login access to it, or rewrite the view to use `DATA_SOURCE =` an external data source backed by a database-scoped credential. A database-scoped credential on its own isn't picked up by an absolute-URL `OPENROWSET`.

```sql
USE master;
GO

CREATE CREDENTIAL [https://<storage-account>.dfs.core.windows.net/<container>]
WITH IDENTITY = 'Managed Identity';
GO

GRANT REFERENCES ON CREDENTIAL::[https://<storage-account>.dfs.core.windows.net/<container>] TO [<sql-login>];
```

With `IDENTITY = 'Managed Identity'`, the workspace managed identity also needs the Storage Blob Data Reader role on the storage account, or the refresh fails on access instead of on string length.

### Import vs DirectQuery

The serverless best practices recommend caching results in Power BI Import mode or Azure Analysis Services, and say serverless SQL can't provide an interactive experience in DirectQuery for complex queries or large data volumes. I covered the wider serverless performance picture in [an earlier post on Synapse serverless SQL performance](/blog/2022-02-02-synapse-serverless-sql-performance/). Long free text compresses poorly in the model, so ask whether a report really needs a 50,000-character description; a preview column plus a drill-through to the source is often better.

## If you're weighing Fabric instead

The same 8 KB problem exists in a Microsoft Fabric Lakehouse, with less room to fix it. The difference is who controls the type:

| | Synapse serverless SQL | Fabric Lakehouse SQL analytics endpoint |
|---|---|---|
| Delta string column type | Inferred `varchar(8000)`, or whatever your `WITH` clause says | `STRING`: `varchar(8000)`; Spark `VARCHAR(n)` (n < 2000): `varchar(4n)` |
| Values over 8 KB | Error (or silent truncation with `ANSI_WARNINGS OFF`) | Truncated at 8 KB |
| Override | Typed view with `OPENROWSET ... WITH` | Spark `VARCHAR(n)` for narrower types only; no `varchar(max)` on Lakehouse tables |

As of June 2026, the [Fabric data types reference](https://learn.microsoft.com/en-us/fabric/data-warehouse/data-types) and the SQL analytics endpoint limitations restrict `varchar(max)` to the SQL analytics endpoints of mirrored items and Fabric databases (for tables created after 10 November 2025, or older tables after their next schema change), not Lakehouse tables. If you need full long text in Fabric, land it in a Fabric Warehouse table, where `varchar(max)` holds up to 16 MB.

## When a view is the wrong tool

If Power BI genuinely needs the full long text, or the queries behind the report are complex, a CETAS or Spark-materialised table, or Import directly from the lake, may beat a view over `OPENROWSET`.

## The short version

- `varchar(8000)` is what serverless SQL infers for Parquet and Delta strings when there's no `WITH` clause. It isn't a Spark setting.
- Spark-created lake database tables map `StringType` to `varchar(max)`, so if you're seeing 8000, find the `OPENROWSET` that's inferring.
- Exploring files: inference and `ANSI_WARNINGS OFF` are fine. Anything Power BI refreshes from: typed view with UTF-8 collation, no exceptions.
- Spark-owned table already `varchar(max)` and small: leave it. Only size it in Spark DDL if you're happy for writes to fail on over-length values.
- `varchar(max)` only where you've confirmed values exceed 8,000 bytes. Power Query has long been reported to truncate text above 32,766 characters on Import, so test with a known long value.
