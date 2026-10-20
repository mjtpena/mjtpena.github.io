---
title: "Fabric Warehouse: Decide Fact Table Grain Before You Tune Anything"
description: "Why fact table grain, not clustering or statistics, sets the performance ceiling in Fabric Data Warehouse, and how to declare and test it in T-SQL."
author: Michael John Peña
draft: false
date: 2026-03-06
tags:
  - Microsoft Fabric
  - Data Warehouse
  - Data Modeling
  - T-SQL
---

When a Fabric Data Warehouse feels slow, the first instinct is to reach for a tuning feature: data clustering, tighter data types, updated statistics, a bigger capacity. Most of the time the real problem was decided weeks earlier, when someone built a fact table without writing down what one row means. No tuning knob fixes a fact table whose grain is muddled.

## Grain is a sentence, not a column list

The grain of a fact table is a plain-language statement of what a single row represents. "One row per sales order line." "One row per product per store per day." "One row per claim, updated as it moves through each milestone." If you can't finish that sentence, you don't have a fact table yet. You have a staging table with a business-sounding name.

Microsoft's own [dimensional modelling guidance for Fabric Warehouse](https://learn.microsoft.com/fabric/data-warehouse/dimensional-modeling-fact-tables) describes the three classic fact table types, and each one is really a grain decision:

| Fact type | Grain | Measures | Typical load pattern |
|---|---|---|---|
| Transaction | One row per business event (order line, payment) | Additive | Insert-only |
| Periodic snapshot | One row per entity per period (stock on hand per day) | Semi-additive | Insert a full period at a time |
| Accumulating snapshot | One row per process instance (claim, order fulfilment) | Durations between milestones | Insert, then update as milestones land |

The load pattern column is where this stops being theory. Fabric Warehouse stores tables as Delta Parquet in OneLake, and every `UPDATE` or `DELETE` writes new files. The [performance guidelines](https://learn.microsoft.com/fabric/data-warehouse/guidelines-warehouse-performance) are explicit that trickle inserts, updates and deletes fragment row groups and lean on background compaction to recover. An accumulating snapshot is a legitimate design, but it's an update-heavy one, and you should choose it knowing that. A transaction table at order-line grain is insert-only and plays to the engine's strengths.

## Why grain comes before tuning

Grain shapes three things that tuning can't change afterwards:

### Grain decides row count, and row count decides almost everything else

Moving from daily snapshots to one row per transaction can multiply a table by a few hundred. Moving the other way can shrink it to something a Direct Lake semantic model barely notices. Clustering, statistics and data types all work on whatever rows you give them. They can make a scan cheaper; they can't make a billion rows into ten million. If a report only ever needs daily totals, a daily periodic snapshot will beat a perfectly tuned transaction table every time.

### Grain decides which joins are safe

Mixed grain is where most silent errors come from. Put monthly targets in the same table as daily sales, or let a "header" row sit next to its "line" rows, and every `SUM` either double counts or needs a `WHERE` clause that only one person remembers. The fix isn't a smarter query. It's two fact tables, each with a declared grain, that share conformed dimensions. The Fabric guidance uses the same example: a sales fact table at date grain and a separate sales target fact table at quarter grain.

### Grain decides which tuning features make sense

[Data clustering](https://learn.microsoft.com/fabric/data-warehouse/data-clustering) is in preview as of this post. You define it at table creation with `CLUSTER BY` on up to four columns, and it co-locates similar values so queries with `WHERE` predicates can skip files. The docs say it pays off on large tables, on mid-to-high cardinality columns, and on filters that recur in reports. Those are all properties of the grain. A transaction table at order-line grain filtered by date is a strong candidate. A small daily snapshot probably isn't worth the extra ingestion cost, which the docs call out: clustered tables take more time and capacity units to load because the engine has to order the data. Clustering columns are also fixed at `CREATE TABLE`, so changing them means a CTAS rebuild. The docs also want DML batches of at least a million rows for clustering to apply inline. Both are reasons to settle grain and load pattern first.

The same logic applies elsewhere. Fabric Warehouse doesn't support partitioned tables, so you can't partition your way out of a bad grain the way you might have on Synapse dedicated SQL pools. [Statistics](https://learn.microsoft.com/fabric/data-warehouse/statistics) are created automatically at query time, synchronously, the first time the optimiser needs them. Proactive statistics refresh (on by default) moves refreshes of existing auto-generated statistics to after data changes. The manual win that's left is running `CREATE STATISTICS` after a big load on columns that don't have statistics yet, so the first report query doesn't pay to create them. Once the grain is right, the remaining tuning work is small and specific.

## Declaring grain in the table itself

I want the grain written in three places: a comment in the DDL, a declared key, and a test that runs on every load. Here's a transaction fact table at order-line grain. It's a complete script you can run in a Fabric Warehouse, with placeholder names.

```sql
-- Grain: one row per sales order line.
-- Natural key: (SalesOrderNumber, SalesOrderLineNumber).
CREATE TABLE dbo.FactSalesOrderLine
(
    SalesOrderNumber      varchar(20)   NOT NULL,
    SalesOrderLineNumber  smallint      NOT NULL,
    OrderDateKey          int           NOT NULL,
    CustomerKey           int           NOT NULL,
    ProductKey            int           NOT NULL,
    StoreKey              int           NOT NULL,
    OrderQuantity         int           NOT NULL,
    UnitPrice             decimal(18,4) NOT NULL,
    SalesAmount           decimal(18,4) NOT NULL,
    LoadBatchId           int           NOT NULL
)
-- Data clustering is in preview. To avoid preview features, remove the
-- WITH (CLUSTER BY ...) clause and keep the closing semicolon.
WITH (CLUSTER BY (OrderDateKey));

ALTER TABLE dbo.FactSalesOrderLine
    ADD CONSTRAINT PK_FactSalesOrderLine
    PRIMARY KEY NONCLUSTERED (SalesOrderNumber, SalesOrderLineNumber) NOT ENFORCED;
```

A few deliberate choices are in there. The data types are as narrow as the data allows: integers for keys and `varchar(20)` rather than `varchar(8000)`, which the performance guidelines recommend because statistics and cost estimates are more accurate. The clustering column is the date key, because date is the predicate almost every report on this table will use.

The primary key is the part people misread. In Fabric Warehouse, [primary key, unique and foreign key constraints](https://learn.microsoft.com/fabric/data-warehouse/table-constraints) are only supported as `NOT ENFORCED`, and you add them with `ALTER TABLE` rather than inline. The engine won't stop a duplicate row from landing. The constraint documents the grain and gives modelling tools metadata, but it isn't a guard. That's why the third piece matters.

### Test the grain on every load

```sql
-- Returns rows only when the declared grain is violated.
-- Run after each load; fail the pipeline if anything comes back.
SELECT
    SalesOrderNumber,
    SalesOrderLineNumber,
    COUNT(*) AS RowsAtGrain
FROM dbo.FactSalesOrderLine
GROUP BY SalesOrderNumber, SalesOrderLineNumber
HAVING COUNT(*) > 1;
```

Wire this into the pipeline or stored procedure that loads the table, and treat a non-empty result as a failed load, not a warning. In my experience, duplicates at grain are one of the most common causes of "the numbers in the warehouse don't match the source", and they're far cheaper to catch at load time than in a finance meeting. Nothing downstream will flag them either: a semantic model or report that trusts the declared key will simply sum both copies. When the test fails, quarantine the batch rather than patching rows by hand: delete everything with that `LoadBatchId`, fix the source or the load logic, and reload it. If the source legitimately sends repeats (a re-sent file, a corrected line), deduplicate in the load itself with `ROW_NUMBER() OVER (PARTITION BY SalesOrderNumber, SalesOrderLineNumber ORDER BY <your-change-timestamp> DESC)` and keep only the first row.

### What about surrogate keys?

`IDENTITY` columns are available in Fabric Warehouse in preview as of this post, as `bigint` with system-managed values. The [IDENTITY documentation](https://learn.microsoft.com/fabric/data-warehouse/identity) is clear that values are unique but can have gaps and aren't allocated in order across ingestion tasks. That's fine for dimension surrogate keys. For a transaction fact table, I usually skip a surrogate row key entirely: the natural key at grain is already unique, and an extra `bigint` on billions of rows is storage you pay for and never filter on. `IDENTITY` columns also can't be used as clustering columns, so a surrogate row key wouldn't help file skipping anyway.

## When not to be strict about this

Not every table needs a full Kimball treatment.

- **Exploratory work.** If an analyst is answering a one-off question in a lakehouse or a scratch warehouse, declaring grain and wiring tests is overhead. Do it when the table becomes something a report depends on.
- **Raw and bronze layers.** Landing tables should mirror the source, whatever its shape. Grain discipline belongs in the layer people query.
- **Event data with no stable natural key.** Some telemetry has no reliable uniqueness. Declare the grain as "one row per event received", accept that duplicates may exist, and handle deduplication explicitly upstream rather than pretending a `NOT ENFORCED` key protects you.

## The decision I'd make

Before you open a query plan, write the grain sentence for every fact table in the model and check it with the duplicate test above. If two tables share a grain and describe the same business process, merge them. If one table has two grains, split it. Only then look at clustering, data types and capacity sizing, and expect them to refine a model that already performs, not rescue one that doesn't.

If you're new to the Warehouse itself, my earlier [Fabric Warehouse overview](/blog/2023-07-15-fabric-warehouse/) covers the T-SQL surface; it was written during the preview, so check current limits in the docs. The grain decision hasn't changed since then and won't change with the next feature release: you make it once, on paper, before anything ships.
