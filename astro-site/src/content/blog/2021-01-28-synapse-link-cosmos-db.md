---
title: "Synapse Link for Cosmos DB: Is It Time to Retire the Nightly ETL?"
description: "When Azure Synapse Link can replace a Cosmos DB export pipeline, the limits to check first, and how to query the analytical store from SQL and Spark."
author: Michael John Pena
draft: false
date: 2021-01-28
url: /blog/synapse-link-cosmos-db/
tags:
  - Azure
  - Cosmos DB
  - Synapse
  - HTAP
  - Spark
---

Running analytics on Cosmos DB data without burning the RU/s your application depends on has usually meant a nightly export to a lake or warehouse. That pipeline costs money, adds a day of latency and breaks every time someone adds a field. Azure Synapse Link removes most of that work. The first time I demoed a Spark notebook aggregating a busy ecommerce database while live orders kept flowing, the architect on the call cancelled the ETL pipeline they had planned. That reaction is right more often than not. It isn't right every time, though, and the exceptions are what this post is about.

I covered the basic mechanics in [an earlier introduction to Synapse Link](/blog/2020-09-28-azure-synapse-link-cosmos/). This post covers the decision: what you give up when you drop the pipeline, which limits to check before you commit, and the query patterns I'd use from serverless SQL and Spark.

## What you are actually buying

When you turn on Synapse Link, Cosmos DB keeps a second copy of each enabled container in the [analytical store](https://learn.microsoft.com/azure/cosmos-db/analytical-store-introduction). This copy is column-oriented and fully isolated from the transactional store. Cosmos DB syncs inserts, updates and deletes into it automatically. Microsoft documents the sync as usually completing within two minutes, or up to five minutes for containers in a shared-throughput database with many containers. Queries against the analytical store don't consume provisioned RU/s, so a heavy aggregation in Synapse can't throttle your checkout API.

Billing is separate too. You pay for analytical storage and for analytical write and read operations, and not through your RU/s. Synapse compute (Spark pools or serverless SQL) is billed on top.

Here is where everything stood at the end of January 2021:

| Capability | Status (January 2021) |
|---|---|
| Synapse Link for the Core (SQL) API and the API for MongoDB | Generally available (Dec 2020 with Synapse GA); public preview from Build 2020, MongoDB API added Sept 2020 |
| Query from Synapse Spark pools | Generally available |
| Query from Synapse serverless SQL pools | Public preview, added October 2020 |
| Query from dedicated SQL pools | Not supported |
| Gremlin, Cassandra and Table APIs | Not supported |
| Enable on an existing container | Not supported. Only new containers |
| Cosmos DB serverless accounts | Not supported |

The last two rows decide most designs, so I'll start with them. Since general availability the analytical store is also billed, so the free preview period is over.

## The constraints that decide it

### You can only enable the analytical store on new containers

You can turn on Synapse Link at the account level for an existing account. You can't turn on the analytical store for a container that already exists. If your orders live in a container created two years ago, "turning on Synapse Link" really means creating a new container and migrating the data into it. The change feed is the usual tool for that, and I wrote about [running change feed consumers in production](/blog/2021-01-26-cosmosdb-change-feed-patterns/) earlier this week. Plan this as a migration with a cut-over, not a toggle.

The reverse is also true. Once you create a container with the analytical store, you can't turn the analytical store off for that container. Enable it only where you mean it.

### Serverless accounts are out

If you picked [Cosmos DB serverless](/blog/2020-12-14-azure-cosmos-db-serverless/) for a spiky or low-volume workload, Synapse Link isn't available on that account. If analytics on that data matters, that is a reason to rethink the capacity mode.

### The schema is inferred, and the first type wins

For the Core (SQL) API, the analytical store uses a well-defined schema representation. Top-level properties become columns. Each nesting level can hold at most 200 properties and nesting can go at most 5 levels deep. An item that breaks either limit is left out of the analytical store entirely. The bigger trap is type drift. A property's type is registered from the first item that carries it in the lifetime of the container. If `totalAmount` first arrives as a number and some service later writes `"129.95"` as a string, later documents where `totalAmount` is a string are dropped from the analytical store entirely, so whole orders go missing from your totals. Nothing errors. Your revenue numbers are just quietly low. The API for MongoDB uses a full-fidelity representation that keeps each type. For the Core API, full fidelity wasn't self-service; you had to ask the Cosmos DB team to enable it.

My rule of thumb: if more than one team or service writes to the container, put schema validation in the application layer before you trust the analytical store for financial reporting.

### Three more limits worth knowing before you commit

The [Synapse Link documentation](https://learn.microsoft.com/azure/cosmos-db/synapse-link) lists a few limitations that rarely come up in demos but matter in production:

| Limit | Why it matters |
|---|---|
| Synapse Link can't be disabled on an account once enabled | There is no billing impact without analytical-store containers, but treat the account-level switch as permanent |
| Automatic backup and restore doesn't cover the analytical store | A restored container comes back with only the transactional store and no analytical store, so restoring means another migration |
| Managed private endpoints to the analytical store aren't supported | If your security baseline requires network isolation for the Synapse workspace's traffic, this path doesn't meet it yet |

The backup gap is the one I'd raise with the operations team first. Your disaster recovery runbook for the container now needs a second step to rebuild analytics.

### Analytical TTL is its own retention policy

The analytical store has its own time-to-live (`analyticalStorageTtl`), separate from the transactional TTL. You can keep 30 days of hot operational data and seven years of history in the analytical store. That is a real advantage over a hand-rolled export. A delete in the transactional store still propagates to the analytical store, though. A long analytical TTL protects you from transactional TTL expiry, not from an application that hard-deletes records.

## Wiring it up

Enabling the feature on an account and creating an analytical-store-enabled container needs Azure CLI 2.14.0 or later, the first release with the `--analytical-storage-ttl` parameter.

```bash
# Enable Synapse Link on the account (works on new or existing accounts).
# This can't be undone: once enabled at the account level it can't be disabled.
az cosmosdb update \
    --name <your-cosmos-account> \
    --resource-group <your-resource-group> \
    --enable-analytical-storage true

# Create a NEW container with the analytical store enabled.
# -1 keeps analytical data indefinitely; a positive number is retention in seconds.
az cosmosdb sql container create \
    --account-name <your-cosmos-account> \
    --resource-group <your-resource-group> \
    --database-name ecommerce \
    --name orders \
    --partition-key-path "/customerId" \
    --throughput 400 \
    --analytical-storage-ttl -1
```

In the Synapse workspace, add a linked service to the Cosmos DB account (Data hub, then Connect to external data, then Azure Cosmos DB). Spark notebooks refer to it by name.

## Querying from serverless SQL (preview)

Serverless SQL is the path most BI teams want, because Power BI and any other T-SQL client can connect to it directly. The [OPENROWSET syntax for Cosmos DB](https://learn.microsoft.com/azure/synapse-analytics/sql/query-cosmos-db-analytical-store) takes a connection string, a container name and, for views, a credential that holds the account key. Use a database with a UTF-8 collation, because Cosmos DB strings are UTF-8 and the default collation causes conversion problems on text columns.

```sql
-- Server-scoped credential holding the read-only account key.
-- The view references it by name, so the key never appears in the view definition.
CREATE CREDENTIAL [<your-credential>]
WITH IDENTITY = 'SHARED ACCESS SIGNATURE',
     SECRET = '<your-cosmos-read-only-key>';
GO

CREATE DATABASE CosmosAnalytics COLLATE Latin1_General_100_CI_AS_SC_UTF8;
GO

USE CosmosAnalytics;
GO

CREATE VIEW dbo.Orders AS
SELECT
    orderId,
    customerId,
    status,
    totalAmount,
    TRY_CONVERT(datetime2, orderDate) AS orderDate,
    items
FROM OPENROWSET(
    PROVIDER = 'CosmosDB',
    CONNECTION = 'Account=<your-cosmos-account>;Database=ecommerce',
    OBJECT = 'orders',
    SERVER_CREDENTIAL = '<your-credential>'
)
WITH (
    orderId     VARCHAR(50)   '$.orderId',
    customerId  VARCHAR(50)   '$.customerId',
    status      VARCHAR(20)   '$.status',
    totalAmount FLOAT         '$.totalAmount',
    orderDate   VARCHAR(30)   '$.orderDate',
    items       VARCHAR(MAX)  '$.items'
) AS rows;
GO

-- Top customers over the last 30 days
SELECT TOP 20
    customerId,
    COUNT(*)         AS orderCount,
    SUM(totalAmount) AS revenue
FROM dbo.Orders
WHERE status = 'Completed'
  AND orderDate >= DATEADD(day, -30, GETUTCDATE())
GROUP BY customerId
ORDER BY revenue DESC;
```

Two things here are deliberate. First, the `WITH` clause. Without it, serverless SQL infers the column types, and inferred string columns come back far wider than you need. Explicit types make queries cheaper and keep the view contract stable when the documents change. The types follow the documented mappings: numbers map to `FLOAT`, and ISO date strings map to `VARCHAR(30)`, so the view converts `orderDate` with `TRY_CONVERT`. A malformed date becomes `NULL` instead of failing every query that touches the view. Second, nested arrays such as `items` come back as JSON text. Use `CROSS APPLY OPENJSON` to flatten them in a second view instead of writing that logic into every report.

OPENROWSET also accepts the key inline in the connection string, which is handy for an ad hoc query. Don't do that in a view: anyone who can read the view definition can read the key, and Microsoft's own guidance says to keep it in a separate credential. Put the read-only key, never the primary key, in a server-scoped credential as shown, and control who can use it. Also remember that serverless SQL support is still in preview, even though Synapse Link itself is now generally available. I'd put it in front of internal dashboards, not a contractual SLA.

## Querying from Spark

[Spark in Synapse](https://learn.microsoft.com/azure/synapse-analytics/synapse-link/how-to-query-analytical-store-spark) reads the analytical store through the `cosmos.olap` format and your linked service. This is the right tool when you need joins against lake data, feature engineering, or anything beyond what T-SQL handles comfortably.

```python
from pyspark.sql.functions import col, count, countDistinct, sum as sum_, to_date

orders = (
    spark.read.format("cosmos.olap")
    .option("spark.synapse.linkedService", "<your-cosmos-linked-service>")
    .option("spark.cosmos.container", "orders")
    .load()
)

daily = (
    orders.filter(col("status") == "Completed")
    .withColumn("orderDay", to_date(col("orderDate")))
    .groupBy("orderDay")
    .agg(
        count("*").alias("orders"),
        sum_("totalAmount").alias("revenue"),
        countDistinct("customerId").alias("customers"),
    )
)

daily.write.mode("overwrite").parquet(
    "abfss://<your-container>@<your-storage-account>.dfs.core.windows.net/curated/daily_orders"
)
```

Each `cosmos.olap` read is a point-in-time snapshot of the analytical store. Streaming isn't supported from the analytical store. The streaming option in Synapse reads the change feed through `cosmos.oltp`, which hits the transactional store and consumes RU/s. If you see `cosmos.oltp` in a notebook that is meant to be "free" analytics, someone has misread the docs.

Persisting curated output to the lake, as the last step does, is still worth doing. The analytical store is a fresh copy of operational data. It is not a modelled, conformed layer, and Power BI imports work better against a small curated table than against a full scan of every order.

## When I would keep the pipeline

Synapse Link is not a universal replacement. I'd keep or build a conventional pipeline when:

- **The container already exists and migrating isn't worth it.** A scheduled copy with Data Factory, plus a change-feed consumer for freshness, can cost less effort than a container migration.
- **You need transformations on the way in.** The analytical store is a mirror. You can't reshape, mask or filter data before it lands.
- **The data must land in a dedicated SQL pool.** That isn't supported, so you'll be copying anyway.
- **Your writers disagree about types.** Until the schema is under control, a pipeline with explicit casting and validation is safer than inferred columns.
- **The account is serverless, or uses Gremlin, Cassandra or Table.** Synapse Link doesn't cover them.

## The call

If you are designing a new Cosmos DB workload on the Core or MongoDB API with provisioned throughput, enable the analytical store on day one for any container you might want to report on. It is cheap insurance, and you can't add it later. For existing workloads, decide container by container: migrate the ones where fresh, RU-free analytics changes a business decision, and leave the rest on the pipeline you already trust. Treat the serverless SQL path as the less mature of the two for now and lean on Spark for anything heavy. The [Synapse Link overview](https://learn.microsoft.com/azure/cosmos-db/synapse-link) is worth re-reading as the limits and the serverless SQL preview change.
