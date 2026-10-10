---
title: "Azure Synapse Analytics in Preview: What's GA and Where to Start"
description: "A first-day tour of Azure Synapse Analytics in August 2020: which parts are GA, which are preview, and why I start with SQL on-demand before a SQL pool."
author: Michael John Peña
draft: false
date: 2020-08-23
tags:
  - Azure
  - Synapse
  - Data Warehouse
  - Data Lake
  - Big Data
---

A common pattern is a data warehouse alongside a separate Hadoop or Spark estate that barely share data. Azure Synapse Analytics is Microsoft's answer: one workspace where a provisioned SQL warehouse, serverless SQL over the lake, Apache Spark, and Data Factory-style pipelines sit side by side. The unified experience is real: you can read a Parquet folder from a notebook, then query the same files with T-SQL without moving them. What the marketing glosses over is that most of that experience is still in preview, and that matters a lot when you're deciding what to build on.

## What Synapse actually is right now

The name covers two things, and you need to keep them apart.

At Ignite in November 2019, Azure SQL Data Warehouse was renamed Azure Synapse Analytics. The provisioned MPP warehouse, now called a **SQL pool**, is the same engine SQL DW customers have been running for years, and it is generally available. Then, during 2020, the wider **Synapse workspace** entered public preview: Synapse Studio, SQL on-demand, Apache Spark pools, and pipelines, all inside one workspace resource.

Here is how the pieces stand as of this month:

| Component | What it is | Status (August 2020) | How you pay |
|---|---|---|---|
| SQL pool | Provisioned MPP warehouse (formerly SQL DW) | GA | Per DWU-hour while running; can pause |
| SQL on-demand | Serverless T-SQL over files in the lake | Preview | Per TB of data processed |
| Apache Spark pools | Managed Spark 2.4 clusters with notebooks | Preview | Per vCore-hour (node size x node count) while the pool is running |
| Pipelines | Data Factory integration engine inside the workspace | Preview | Per activity run and integration runtime hour, as in ADF |
| Synapse Studio | Web UI at `web.azuresynapse.net` tying it together | Preview | No separate charge |

The [What is Azure Synapse Analytics](https://learn.microsoft.com/azure/synapse-analytics/overview-what-is) page is the best single overview, but read it with that status column in mind. A GA warehouse with preview tooling around it is a different proposition from a GA platform.

## The workspace and its data lake

Every workspace is created with a primary Azure Data Lake Storage Gen2 account (a storage account with hierarchical namespace enabled) and a default file system. That account is where Spark writes by default, where SQL on-demand reads from, and where Studio's data hub browses.

Two things trip people up on day one:

- **The workspace managed identity needs data access on the lake.** Pipelines and SQL pool loads authenticate as the workspace identity, so grant it *Storage Blob Data Contributor* on the account or container. Owner on the subscription is not the same as data-plane access.
- **Your own account needs data access too.** Being able to open Studio doesn't mean you can read the files. If a query or notebook fails with a 403 against storage, check your own role assignment on the container before anything else.

I create the workspace in the portal for now. Treat the first one as a sandbox: one resource group, one storage account, no production data, and delete it when the preview tour is done.

## SQL on-demand: the part I'd start with

SQL on-demand is the piece that surprises people. There is nothing to provision. Each workspace gets an on-demand endpoint, you point `OPENROWSET` at files in the lake, and you pay for the data your queries process, metered per TB. The list price is USD 5 per TB processed, rounded up to the nearest MB with a 10 MB minimum per query ([data processed and cost control](https://learn.microsoft.com/azure/synapse-analytics/sql/data-processed)). There is no idle cost because nothing sits running, but a careless `SELECT *` over a large CSV folder is billed in full.

```sql
-- SQL on-demand: aggregate Parquet files directly in the lake.
-- Replace the storage account and path with your own.
SELECT
    s.CustomerKey,
    SUM(s.TotalAmount) AS TotalRevenue,
    COUNT(*)           AS OrderCount
FROM OPENROWSET(
    BULK 'https://<your-storage-account>.dfs.core.windows.net/<your-container>/sales/2020/*.parquet',
    FORMAT = 'PARQUET'
) AS s
GROUP BY s.CustomerKey
ORDER BY TotalRevenue DESC;
```

That query is the whole pitch. An analyst who knows T-SQL can explore lake data from SSMS, Azure Data Studio or Studio without waiting for anyone to build a load process.

The trade-offs are real, though:

- **You pay for bytes scanned, so file layout is your cost model.** Parquet beats CSV because the engine reads only the columns you select. Folder-per-date partitioning lets you narrow the `BULK` path instead of scanning everything.
- **It's preview.** No SLA, and behaviour can change. That's fine for exploration and prototyping; it's not where I'd hang a board-level dashboard yet.
- **It's not a warehouse.** There's no data stored in it, no distribution choices, and no workload isolation. Heavy, repeated, high-concurrency reporting belongs on something provisioned.

My rule of thumb: start on SQL on-demand, look at the query patterns that keep coming back, and only then decide whether they justify a SQL pool. The [SQL on-demand overview](https://learn.microsoft.com/azure/synapse-analytics/sql/on-demand-workspace-overview) lists the supported T-SQL surface, which is narrower than a full SQL Server, and I go further into views, external tables and cost control in [Azure Synapse serverless SQL](/blog/2020-10-02-azure-synapse-serverless-sql/).

## SQL pools: the GA warehouse

If you already run SQL DW, nothing about your warehouse changed with the rename. Same MPP engine, same distributions, same DWU scaling from DW100c upwards, same pause and resume. It is the one part of Synapse with a GA SLA, and it's where I'd put production star schemas today.

The design decisions haven't changed either. Hash-distribute large fact tables on a column with many distinct values that you join on, replicate small dimensions (heap or clustered index), and default large facts to clustered columnstore:

```sql
-- SQL pool: a replicated dimension and a hash-distributed fact table.
CREATE TABLE dbo.DimCustomer
(
    CustomerKey  INT           NOT NULL,
    CustomerName NVARCHAR(100) NOT NULL,
    Country      NVARCHAR(50)  NULL
)
WITH (DISTRIBUTION = REPLICATE, CLUSTERED INDEX (CustomerKey));

CREATE TABLE dbo.FactSales
(
    SalesKey    BIGINT         NOT NULL,
    CustomerKey INT            NOT NULL,
    OrderDate   DATE           NOT NULL,
    Quantity    INT            NOT NULL,
    TotalAmount DECIMAL(18, 2) NOT NULL
)
WITH (DISTRIBUTION = HASH(CustomerKey), CLUSTERED COLUMNSTORE INDEX);
```

One thing I'd skip on day one is partitioning. Columnstore wants roughly a million rows per row group in each of the 60 distributions, so partitioning a modest fact table by quarter splits it into segments too small to compress well. Add partitions when the table is big enough and you have a switching or retention reason.

For loading, the new [COPY statement](https://learn.microsoft.com/sql/t-sql/statements/copy-into-transact-sql) is much simpler than setting up PolyBase external tables, and it can authenticate as the workspace managed identity. It's currently in preview, so I use it for new work and keep existing PolyBase loads where they are until it reaches GA.

```sql
-- SQL pool: load Parquet from the lake with COPY (preview).
-- Assumes the Parquet columns match dbo.FactSales in order and type.
COPY INTO dbo.FactSales
FROM 'https://<your-storage-account>.dfs.core.windows.net/<your-container>/sales/2020/*.parquet'
WITH (
    FILE_TYPE  = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);
```

The cost model is the opposite of on-demand. A SQL pool bills for every hour it's running, whether or not anyone queries it. Pausing outside business hours is the easiest saving available, as long as nothing upstream expects it to be awake.

## Spark pools

Spark pools give you managed Apache Spark 2.4 with notebooks in Studio. You can write PySpark, Scala, Spark SQL or .NET for Spark (C#), and pools can auto-pause after an idle period, so a forgotten cluster doesn't run all weekend. I cover pool creation, shared metadata and cost control in [Azure Synapse Spark pools](/blog/2020-10-01-azure-synapse-spark-pools/).

```python
# Synapse notebook (PySpark): `spark` is predefined in the session.
from pyspark.sql import functions as F

lake = "abfss://<your-container>@<your-storage-account>.dfs.core.windows.net"

sales = spark.read.parquet(f"{lake}/sales/2020/")

summary = (
    sales.groupBy("CustomerKey")
         .agg(F.sum("TotalAmount").alias("TotalRevenue"),
              F.count("*").alias("OrderCount"))
)

summary.write.mode("overwrite").parquet(f"{lake}/curated/customer_revenue/")
```

Writing the result back as Parquet in the lake is deliberate. SQL on-demand can query that output immediately, which is the lake-first pattern Synapse is built around.

If you need to push a DataFrame into a SQL pool, the built-in connector is currently Scala-only. In a PySpark notebook you hand off through a temporary view and a `%%spark` cell:

```scala
// %%spark cell, fragment: assumes a temp view "customer_revenue" was
// registered from PySpark and the SQL pool database already exists.
// PySpark: summary.createOrReplaceTempView("customer_revenue")
import com.microsoft.spark.sqlanalytics.utils.Constants
import org.apache.spark.sql.SqlAnalyticsConnector._

val df = spark.sqlContext.sql("SELECT * FROM customer_revenue")
// Creates the table; fails if dbo.CustomerRevenue already exists, so drop it
// or write to a staging name first.
df.write.sqlanalytics("<your-sql-pool>.dbo.CustomerRevenue", Constants.INTERNAL)
```

Don't copy Azure Databricks code for this. The `com.databricks.spark.sqldw` connector belongs to the Databricks runtime and isn't the integration Synapse Spark uses.

Should you move Spark work here from Databricks? Not yet, in my view. Synapse Spark is preview, on Spark 2.4, and Databricks is a mature GA service with its own optimised Delta Lake implementation, a faster release cadence and a far richer runtime; Synapse Spark ships open-source Delta Lake 0.6.1 on Spark 2.4. Synapse Spark is worth trying when your data and users already live in the workspace and you want one fewer service to secure.

## Pipelines

Synapse pipelines are the Data Factory engine inside the workspace: same activities, same linked services, same expression language, plus a notebook activity for Spark. Everything in my [first rerunnable Data Factory pipeline](/blog/2020-08-15-azure-data-factory-pipelines/) applies unchanged: parameterise by date, make loads idempotent, keep secrets in Key Vault.

The catch is that pipelines here are preview and don't yet do everything ADF does. The SSIS integration runtime is the obvious gap. If you have production ADF factories, leave them alone. Use Synapse pipelines for new work that lives entirely inside a workspace.

## How I'd approach it this month

Synapse is two products at different maturity levels, sold under one name. Here's what I'd do with that:

- **Production warehouse:** use a SQL pool. It's GA, it's the SQL DW engine, and the rename changed nothing about running it.
- **Exploring lake data:** start with SQL on-demand. No idle cost, and it shows you which queries deserve a provisioned warehouse.
- **Spark and pipelines:** prototype in a sandbox workspace, keep production on Databricks and ADF, and revisit when they reach GA.
- **Security:** sort out managed identity and storage role assignments before anyone builds anything. Most day-one failures are 403s, not bugs.

The unified workspace is the right direction. Analysts, engineers and data scientists working over the same lake files is better than three copies in three services. Just keep track of which parts carry an SLA, and build production on those.
