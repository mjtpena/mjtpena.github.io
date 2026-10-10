---
title: "Power BI Composite Models: Choosing Import, DirectQuery or Dual"
description: "How to set storage modes table by table in a Power BI composite model, when Dual earns its place, and how aggregations keep DirectQuery facts fast."
author: Michael John Peña
draft: false
date: 2022-01-27
url: /blog/power-bi-composite-models/
tags:
  - Power BI
  - Data Modeling
  - Performance
  - Analytics
---

Most Power BI models start life as all-Import, and that's fine until the fact table outgrows your capacity or the business asks for figures fresher than the last scheduled refresh. The usual reaction is to flip the whole model to DirectQuery and accept slow visuals. Composite models offer a better answer: decide the storage mode per table, so the small, stable tables live in memory and only the big or volatile ones are queried at the source. The catch is that the choice is easy to get wrong, and a badly mixed model can be slower than either pure option.

## What a composite model actually is

A composite model is any Power BI dataset that combines more than one storage mode, or more than one DirectQuery source. Microsoft introduced it in preview in the [July 2018 Power BI Desktop release](https://powerbi.microsoft.com/en-us/blog/power-bi-desktop-july-2018-feature-summary/), alongside many-to-many relationships, and it has been part of standard modelling practice since. Each table has a storage mode, set in Model view under **Properties > Advanced > Storage mode**:

| Storage mode | Where the data lives | Query behaviour | Good fit |
|---|---|---|---|
| Import | Compressed in the dataset (VertiPaq) | Answered from memory; only as fresh as the last refresh | Dimensions, budgets, reference data, anything small or slow-changing |
| DirectQuery | Stays in the source | Every visual generates a native query against the source | Very large or near-real-time fact tables |
| Dual | Imported **and** available via DirectQuery | The engine picks per query: cache when it can, source when it must | Dimensions shared between Import and DirectQuery tables |

The [storage mode documentation](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-storage-mode) covers the mechanics. The important point is that storage mode belongs to the table (strictly, to its partitions), not to the data source connection. Your Power Query code looks the same whichever mode you choose.

One constraint to know before you start: you can change a table from DirectQuery to Dual or Import, but setting a table to Import is irreversible: it can't go back to DirectQuery or Dual. If you're unsure, start a large table in DirectQuery and import it later.

## Source groups and limited relationships

The concept that explains most composite model performance problems is the *source group*. All Import tables form one source group, and each DirectQuery source forms its own. A relationship between tables in different source groups is a *limited relationship* (earlier documentation called these weak relationships). The engine can't resolve a limited relationship inside a single storage engine query, so it has to fetch data from both sides and join them in the formula engine, or push the list of filter values into the DirectQuery SQL as a large `IN` clause.

That's why Dual exists. If `DimDate`, `DimProduct` and `DimCustomer` come from the same database as a DirectQuery `FactSales` and you set them to Dual, then:

- A slicer that only lists product categories is answered from the in-memory copy, with no round trip to the warehouse.
- A visual that sums `FactSales[SalesAmount]` by category is sent to the source as one SQL query with the join done in the database, because the dimension and the fact are now in the same source group.

If those same dimensions were Import, the second visual would cross a limited relationship. You'd see it as a larger, slower native query in Performance Analyzer, and on high-cardinality columns such as customer, it can hit the one-million-row limit for intermediate DirectQuery results.

My rule of thumb: **any dimension that filters a DirectQuery fact table should be Dual, provided it comes from the same source.** Dual only helps when both tables are in the same source; a Dual table can't remove the boundary between an Excel import and an Azure SQL database.

Dual isn't free, though. A Dual table is refreshed and held in memory exactly like an Import table, so it adds to refresh time and dataset size. Its cached copy can also lag the live fact: a slicer answered from the cache won't list a product added since the last refresh, even though DirectQuery visuals already show that product's sales. Schedule dimension refreshes at least as often as the business adds new members.

## A typical layout

For a star schema over Azure SQL Database or Azure Synapse Analytics dedicated SQL pool, this is where I'd start:

| Table | Mode | Why |
|---|---|---|
| `FactSales` (hundreds of millions of rows) | DirectQuery | Too large to refresh comfortably; users want today's numbers |
| `DimDate`, `DimProduct`, `DimCustomer` | Dual | Filter the DirectQuery fact without limited relationships; slicers stay fast |
| `SalesAgg_MonthCategory` | Import (hidden) | User-defined aggregation that answers most summary visuals from memory |
| `Budget` (from SharePoint/Excel) | Import | Small, different source, refreshed when finance updates it |

If you manage the model through Tabular Editor or the XMLA endpoint (Premium or Premium Per User), the storage mode appears as the `mode` property on each partition in the model's TMSL. This is a fragment of the `tables` array from a `model.bim`, showing just the partition definitions (columns omitted for brevity, so it won't deploy as shown); the M expressions are the same as Power Query would generate:

```json
[
  {
    "name": "FactSales",
    "partitions": [
      {
        "name": "FactSales",
        "mode": "directQuery",
        "source": {
          "type": "m",
          "expression": [
            "let",
            "    Source = Sql.Database(\"<your-server>.database.windows.net\", \"<your-database>\"),",
            "    FactSales = Source{[Schema=\"dbo\", Item=\"FactSales\"]}[Data]",
            "in",
            "    FactSales"
          ]
        }
      }
    ]
  },
  {
    "name": "DimProduct",
    "partitions": [
      {
        "name": "DimProduct",
        "mode": "dual",
        "source": {
          "type": "m",
          "expression": [
            "let",
            "    Source = Sql.Database(\"<your-server>.database.windows.net\", \"<your-database>\"),",
            "    DimProduct = Source{[Schema=\"dbo\", Item=\"DimProduct\"]}[Data]",
            "in",
            "    DimProduct"
          ]
        }
      }
    ]
  }
]
```

Notice that nothing in the M code says "DirectQuery". Folding happens automatically when a step can be translated to SQL; steps that can't fold aren't allowed in a DirectQuery table at all, which is a good reason to push transformations into views rather than Power Query.

## Aggregations: making the DirectQuery fact feel imported

Dual dimensions remove the join penalty, but every visual on `FactSales` still goes to the warehouse. [User-defined aggregations](https://learn.microsoft.com/en-us/power-bi/transform-model/aggregations-advanced) fix the common case. You add a smaller, pre-summarised table in Import mode, map its columns to the detail table in the **Manage aggregations** dialog, and hide it. The engine then redirects any query it can answer at that grain to the in-memory aggregation, and falls back to DirectQuery for anything more detailed. Report authors and measures keep referencing `FactSales`; they never see the aggregation table.

I build the aggregation as a view in the source so the grain is explicit and reviewable:

```sql
CREATE VIEW dbo.SalesAgg_MonthCategory
AS
SELECT
    d.MonthKey,
    p.ProductCategoryKey,
    SUM(f.SalesAmount)  AS SalesAmount,
    SUM(f.OrderQuantity) AS OrderQuantity,
    COUNT_BIG(*)        AS SalesRowCount
FROM dbo.FactSales AS f
JOIN dbo.DimDate    AS d ON d.DateKey    = f.OrderDateKey
JOIN dbo.DimProduct AS p ON p.ProductKey = f.ProductKey
GROUP BY d.MonthKey, p.ProductCategoryKey;
```

Then, in Manage aggregations, `SalesAmount` and `OrderQuantity` map to **Sum** of the matching `FactSales` columns, `SalesRowCount` maps to **Count table rows** on `FactSales`, and the key columns map as **GroupBy**: `MonthKey` to `DimDate[MonthKey]` and `ProductCategoryKey` to `DimProduct[ProductCategoryKey]`. (If you have month-grain and category-grain dimensions such as `DimMonth` and `DimProductCategory`, you can rely on one-to-many relationships to them instead of GroupBy mappings. `DimDate` and `DimProduct` themselves won't do, because they're keyed at day and product grain.) Two details that trip people up:

- Relationship-based aggregation hits need the dimensions to be Dual. If they're Import, the relationship to the DirectQuery detail table is limited and the aggregation won't be used for those queries.
- The aggregation is only as fresh as its last refresh, while the detail table is live. If a visual at month grain must show today's sales, an Import aggregation will show yesterday's. Decide which visuals need freshness before building aggregations.

A pattern that still circulates is a DAX measure that uses `HASONEVALUE` to switch manually between an aggregation table and the fact table. Don't do that. It duplicates what the engine already does, breaks as soon as someone adds a new grouping column, and exposes the aggregation table to report authors. Let the aggregation mapping handle it.

If you're on Premium, automatic aggregations (in preview) can train and maintain aggregation tables for you; I cover that in [Power BI Automatic Aggregations](/blog/2022-01-30-power-bi-automatic-aggregations/).

## Checking it's working

Open **Performance Analyzer** in Power BI Desktop, refresh the visuals, and look at the **DirectQuery** duration for each visual. A visual answered entirely from Dual dimension caches (a slicer, say) or from an Import aggregation shows no DirectQuery time at all. Copy the query into DAX Studio or connect SQL Server Profiler to Desktop to see the native SQL and aggregation hits (the *Aggregate Table Rewrite Query* event shows whether a query matched an aggregation and, if not, why).

Run the checks against production-sized data. A DirectQuery table over a development database with ten thousand rows tells you nothing about how the model behaves against the real warehouse.

## When not to use a composite model

Composite models add moving parts, and they aren't always the right answer:

- **If the data fits in Import and daily or hourly refresh is acceptable, stay all-Import.** It's simpler and faster, and every DAX function works. Use [incremental refresh](/blog/2021-01-13-power-bi-incremental-refresh/) before reaching for DirectQuery.
- **If the source can't handle the load, don't put it behind DirectQuery.** Every user interaction becomes a query. An OLTP database or a small Azure SQL tier will struggle with a busy dashboard.
- **If you mix sources, think about data leakage.** When a query spans source groups, values from one source can be sent to another inside the generated SQL (for example, a list of customer IDs from an imported Excel file pushed into a query to the warehouse). Desktop shows a security warning for exactly this reason; read it before dismissing it. The [composite model guidance](https://learn.microsoft.com/en-us/power-bi/guidance/composite-model-guidance) covers it in more detail.
- **If you need "last 7 days live, the rest imported" on one table**, that's a hybrid table rather than a composite model across tables. Hybrid tables arrived in preview for Premium in December 2021; see [Power BI Hybrid Tables](/blog/2022-01-29-power-bi-hybrid-tables/).

Composite models can also connect to published Power BI datasets and Azure Analysis Services models through DirectQuery, which lets a team extend a certified dataset with its own tables. As of January 2022 that capability, *DirectQuery for Power BI datasets and Azure Analysis Services*, is still in preview, with its own limits on chaining and security. I've written it up separately in [DirectQuery for Power BI Datasets](/blog/2022-01-28-power-bi-directquery-datasets/).

## The decision in one paragraph

Set the storage mode for each table based on its size, freshness and source, not for the model as a whole, and treat every Dual table and aggregation as a refresh commitment as well as a speed-up. Then confirm the behaviour in Performance Analyzer and the aggregation trace events rather than assuming it. Done this way, a composite model lets most visuals run from memory while still allowing drill-through to live detail. Done carelessly, every visual queries the source and gets slower.
