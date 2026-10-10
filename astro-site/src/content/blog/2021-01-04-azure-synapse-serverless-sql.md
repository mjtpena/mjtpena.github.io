---
title: "Synapse Serverless SQL After GA: Designing a Lake Query Layer"
description: "How I'd structure Synapse serverless SQL now it's GA: a user database, credentials, views over the lake, CETAS, and habits that keep the per-TB bill small."
author: Michael John Peña
draft: false
date: 2021-01-04
tags:
  - Azure
  - Synapse
  - SQL
  - Data Lake
  - Cost Optimization
---

Azure Synapse Analytics went generally available in early December, and the built-in serverless SQL pool came with it. Pointing `OPENROWSET` at a Parquet file is the easy part. What decides whether serverless SQL becomes a useful layer or an expensive mess is everything around that query: where objects live, how identity flows to storage, and how you stop analysts scanning the whole lake every time Power BI refreshes.

I covered the basics in my [preview notes on serverless SQL](/blog/2020-10-02-azure-synapse-serverless-sql/) and the wider launch in [Synapse GA](/blog/2020-12-05-azure-synapse-analytics-ga/). This post is about the design a month later: how I'd lay out a serverless SQL "logical data warehouse" over Azure Data Lake Storage Gen2, and where I'd stop using it.

## What you're actually paying for

Serverless SQL has no compute to size or pause. You pay per terabyte of data processed, which Microsoft lists at US$5 per TB at the time of writing, with a 10 MB minimum per query; check the price for your region before you budget, and read the [data processed docs](https://learn.microsoft.com/azure/synapse-analytics/sql/data-processed) for exactly what's counted. "Data processed" includes data read from storage, intermediate data moved between nodes, and data written back by CETAS. DDL (except creating statistics, which reads data) and metadata-only queries aren't billed.

That model changes how you think about design. With a dedicated SQL pool, a wasteful query costs you concurrency and time. With serverless, it costs money directly, and the person running it rarely sees the bill. So every decision below comes back to one question: how many bytes does this query have to touch?

## Put objects in a user database, not master

Every workspace gets a serverless endpoint at `<workspace-name>-ondemand.sql.azuresynapse.net`. Out of the box you land in `master`, which is fine for ad-hoc exploration and wrong for anything you want to share. Views, external tables, credentials and schemas belong in a user database, and that database needs a UTF-8 collation if you'll be filtering on strings in Parquet files.

```sql
CREATE DATABASE lakehouse
    COLLATE Latin1_General_100_BIN2_UTF8;
GO

USE lakehouse;
GO

CREATE SCHEMA curated;
GO
```

The collation matters more than it looks. Parquet stores strings as UTF-8, and Microsoft's [serverless SQL best practices](https://learn.microsoft.com/azure/synapse-analytics/sql/best-practices-serverless-sql-pool) recommend a `_UTF8` collation so string predicates can be pushed down to the Parquet reader. Without it, you can get conversion warnings, wrong-looking characters, and filters that read more data than they need to.

The trade-off is that `BIN2` compares and sorts case-sensitively, so `WHERE country = 'australia'` won't match `'Australia'`. If that will trip up your report authors, keep a friendlier database default and set a `_UTF8` collation per string column in the `OPENROWSET` `WITH` clause instead, as the view below does for `region`.

## Decide how identity reaches storage

There are two sensible patterns, and you should choose one on purpose.

| Approach | Who storage sees | Good for | Watch out for |
|---|---|---|---|
| Azure AD passthrough | The calling user | Analysts exploring data they're already entitled to | Every user needs ACLs or RBAC on the lake |
| Database scoped credential (workspace managed identity) | The Synapse workspace | Shared views consumed by Power BI and apps | Access control moves into SQL permissions on views |

For a shared semantic layer I prefer the managed identity route. Grant the workspace managed identity **Storage Blob Data Reader** on the raw container and **Storage Blob Data Contributor** on the curated container. The curated grant needs write access because the CETAS step later in this post writes Parquet files back through the same credential, and Reader alone fails there with a storage permission error. Then control who can see what with SQL permissions on schemas and views. It keeps the lake ACLs simple and puts the access model where a SQL person expects to find it.

```sql
USE lakehouse;
GO

CREATE MASTER KEY ENCRYPTION BY PASSWORD = '<strong-password-here>';
GO

CREATE DATABASE SCOPED CREDENTIAL WorkspaceIdentity
WITH IDENTITY = 'Managed Identity';
GO

CREATE EXTERNAL DATA SOURCE CuratedLake
WITH (
    LOCATION = 'https://<storage-account>.dfs.core.windows.net/curated',
    CREDENTIAL = WorkspaceIdentity
);
GO

CREATE EXTERNAL DATA SOURCE RawLake
WITH (
    LOCATION = 'https://<storage-account>.dfs.core.windows.net/raw',
    CREDENTIAL = WorkspaceIdentity
);
GO

CREATE USER [<analyst@your-domain.com>] FROM EXTERNAL PROVIDER;
GO

CREATE ROLE report_readers;
GO

ALTER ROLE report_readers ADD MEMBER [<analyst@your-domain.com>];
GRANT SELECT ON SCHEMA::curated TO report_readers;
GRANT REFERENCES ON DATABASE SCOPED CREDENTIAL::WorkspaceIdentity TO report_readers;
GO
```

That last `GRANT` is the one people miss. `SELECT` on the view isn't enough: anyone querying a view that reads through the credential also needs `REFERENCES` on the credential itself, or the query fails before it touches storage.

The [storage access control docs](https://learn.microsoft.com/azure/synapse-analytics/sql/develop-storage-files-storage-access-control) also cover SAS tokens. I'd avoid them for anything long-lived; they expire, they get pasted into scripts, and nobody remembers who has one.

## Views over the lake, with partition pruning built in

Serverless SQL doesn't own data. It reads files. The cleanest way to give consumers a stable interface is a view per dataset that hides paths, formats and folder layout. If your data lands in Hive-style folders (`year=2020/month=12/`), expose the folder values as columns with `filepath()` so a filter on those columns skips whole folders instead of opening every file.

```sql
USE lakehouse;
GO

CREATE VIEW curated.sales
AS
SELECT
    CAST(s.filepath(1) AS INT) AS sale_year,
    CAST(s.filepath(2) AS INT) AS sale_month,
    s.sale_id,
    s.customer_id,
    s.product_id,
    s.region,
    s.quantity,
    s.amount,
    s.sale_date
FROM OPENROWSET(
    BULK 'sales/year=*/month=*/*.parquet',
    DATA_SOURCE = 'CuratedLake',
    FORMAT = 'PARQUET'
)
WITH (
    sale_id BIGINT,
    customer_id INT,
    product_id INT,
    region VARCHAR(50) COLLATE Latin1_General_100_BIN2_UTF8,
    quantity INT,
    amount DECIMAL(18, 2),
    sale_date DATE
) AS s;
GO
```

Two details are deliberate. The `WITH` clause pins the schema and data types rather than relying on inference, which otherwise tends to hand you `varchar(8000)` for strings and makes downstream tools guess. The `_UTF8` collation on `region` is what lets a filter such as `WHERE region = 'APAC'` be pushed down to the Parquet reader (it matches the database default here, but stating it keeps the view correct if it's ever created somewhere else). And `filepath(1)` and `filepath(2)` map to the first and second wildcards in the path, so this query only touches December's files:

```sql
SELECT customer_id, SUM(amount) AS total_amount
FROM curated.sales
WHERE sale_year = 2020
  AND sale_month = 12
GROUP BY customer_id;
```

A filter on `sale_date` alone would be logically identical and could cost far more, because the engine can't skip folders based on a column inside the files. That is the single most important habit to teach report authors. The docs on [`filepath` and `filename`](https://learn.microsoft.com/azure/synapse-analytics/sql/query-specific-files) explain the mechanics.

### CSV and JSON still have a place

Raw zones are rarely all Parquet. For CSV, use `PARSER_VERSION = '2.0'`, which is faster and supports `HEADER_ROW`. For line-delimited JSON, the documented trick is to read each line as a single text column and parse it with `JSON_VALUE`:

```sql
SELECT
    JSON_VALUE(doc, '$.orderId') AS order_id,
    JSON_VALUE(doc, '$.customer.id') AS customer_id,
    CAST(JSON_VALUE(doc, '$.total') AS DECIMAL(18, 2)) AS total
FROM OPENROWSET(
    BULK 'https://<storage-account>.dfs.core.windows.net/raw/orders/*.json',
    FORMAT = 'CSV',
    FIELDTERMINATOR = '0x0b',
    FIELDQUOTE = '0x0b',
    ROWTERMINATOR = '0x0a'
)
WITH (doc NVARCHAR(MAX)) AS j;
```

This one uses an absolute URL with no data source, so it runs as the calling user via Azure AD passthrough, which suits exploration. It works, but every query parses every byte of every file. I'd use it to explore and to feed a conversion step, never as the layer Power BI hits.

## Use CETAS to stop paying for the same scan twice

`CREATE EXTERNAL TABLE AS SELECT` (CETAS) runs a query and writes the result back to the lake as Parquet, registering an external table over it. In serverless SQL it's the closest thing you get to a materialised view, and it's how I'd turn expensive raw-zone reads into cheap curated reads.

```sql
USE lakehouse;
GO

CREATE EXTERNAL FILE FORMAT ParquetSnappy
WITH (
    FORMAT_TYPE = PARQUET,
    DATA_COMPRESSION = 'org.apache.hadoop.io.compress.SnappyCodec'
);
GO

CREATE EXTERNAL TABLE curated.monthly_customer_sales
WITH (
    LOCATION = 'aggregates/monthly_customer_sales/2020-12/',
    DATA_SOURCE = CuratedLake,
    FILE_FORMAT = ParquetSnappy
)
AS
SELECT
    sale_year,
    sale_month,
    customer_id,
    SUM(amount) AS total_amount,
    COUNT_BIG(*) AS order_count
FROM curated.sales
WHERE sale_year = 2020
  AND sale_month = 12
GROUP BY sale_year, sale_month, customer_id;
GO
```

Know the limits before you build a pipeline on it. CETAS writes to a folder that must be empty, it won't overwrite or append, and `DROP EXTERNAL TABLE` removes the metadata but leaves the files. So a monthly refresh means writing to a new folder (as above) or cleaning up the old one with a pipeline step first. The [CETAS docs](https://learn.microsoft.com/azure/synapse-analytics/sql/develop-tables-cetas) are short and worth reading in full.

## Help the optimiser with statistics

The serverless engine builds a distributed plan, and its row estimates are only as good as its statistics. For Parquet you mostly get this for free: when you query Parquet files with `OPENROWSET`, serverless SQL creates statistics automatically on the columns used in predicates and joins. The gaps are CSV sources read through `OPENROWSET`, and external tables. For CSV, create single-column statistics with `sys.sp_create_openrowset_statistics`; for external tables, use `CREATE STATISTICS`. I'd add them on columns used in joins and selective filters.

```sql
USE lakehouse;
GO

EXEC sys.sp_create_openrowset_statistics N'
SELECT customer_id
FROM OPENROWSET(
    BULK ''customers/*.csv'',
    DATA_SOURCE = ''RawLake'',
    FORMAT = ''CSV'',
    PARSER_VERSION = ''2.0'',
    HEADER_ROW = TRUE
)
WITH (customer_id INT) AS c
';
```

The statement uses the same `RawLake` data source, relative path and options as the queries it's meant to help. That way it reads storage through the same managed identity, and the optimiser can match the statistics to those `OPENROWSET` calls. Creating statistics reads data and is billed, so build them once on stable columns, not on every refresh.

## Habits that keep the bill boring

Most of the cost control in serverless SQL is about file layout and query shape, not settings:

- **Land curated data as Parquet.** Columnar files mean `SELECT customer_id, amount` reads two columns, not the whole row.
- **Aim for files in the 100 MB to 10 GB range.** Thousands of tiny files add overhead on every query; a few huge ones limit parallelism.
- **Partition by how people filter**, usually date, and expose the folders through `filepath()` in views.
- **Keep the workspace and storage account in the same region** to avoid latency and egress.
- **Never let Power BI DirectQuery hit a raw-zone view.** Every visual refresh is a fresh scan. Import mode on top of a CETAS aggregate is usually the cheaper design.

I'd also put an Azure Cost Management budget on the subscription or resource group from day one, so the first surprise is an email, not an invoice.

## When I wouldn't use serverless SQL

Serverless SQL is a query layer, not a database engine you can lean on for everything. I'd pick something else when:

- **You need updates, deletes or transactions.** Serverless SQL reads files and CETAS writes new ones; there's no `UPDATE` against the lake. That work belongs in Spark pools or Data Factory.
- **Hundreds of users run the same dashboards all day.** Paying per scan for predictable, repeated workloads usually loses to a dedicated SQL pool with result set caching, or to Power BI import mode.
- **Queries need consistent sub-second response.** Serverless performance is good for a lake engine, but it is still reading files over the network on every query.
- **The heavy lifting is transformation logic.** Complex multi-step engineering is easier to test and maintain in Spark notebooks or Data Factory mapping data flows, with serverless SQL reading the output.

## Where I'd start

If you're adopting serverless SQL this quarter, start small and deliberate: one user database with a UTF-8 collation, one managed-identity credential, a handful of views over well-partitioned Parquet, and CETAS for anything people query repeatedly. Treat raw CSV and JSON as inputs to that layer, not as the thing reports query. Get those foundations right and serverless SQL is one of the cheapest ways I know to put T-SQL on a data lake. Skip them, and it becomes the most expensive `SELECT *` in your subscription.
