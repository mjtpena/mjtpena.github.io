---
title: "Power BI Dataflows: Self-Service ETL"
description: "Dataflows bridge the gap between self-service BI and governed enterprise data."
author: Michael John Peña
draft: false
date: 2020-09-06
tags:
  - Power BI
  - Dataflows
  - ETL
  - Self-Service
---

## Creating a Dataflow

1. Power BI Service → Workspace → New → Dataflow
2. Choose data source (SQL, Excel, API, etc.)
3. Apply transformations in Power Query Editor
4. Save and schedule refresh

## M Query Transformations

```powerquery
let
    Source = Sql.Database("server.database.windows.net", "sales_db"),
    Orders = Source{[Schema="dbo",Item="Orders"]}[Data],

    // Filter to recent orders
    FilteredRows = Table.SelectRows(Orders, each [OrderDate] >= Date.AddMonths(DateTime.LocalNow(), -12)),

    // Add calculated column
    AddedMargin = Table.AddColumn(FilteredRows, "Margin", each [Revenue] - [Cost]),

    // Clean up types
    ChangedTypes = Table.TransformColumnTypes(AddedMargin, {
        {"OrderDate", type date},
        {"Revenue", type number},
        {"Cost", type number},
        {"Margin", type number}
    })
in
    ChangedTypes
```

## Benefits

1. **Reusability**: Multiple reports consume the same dataflow
2. **Consistency**: One source of truth for calculations
3. **Governance**: IT reviews and approves logic
4. **Performance**: Computed tables in premium capacity use enhanced compute

## Premium Features

With Premium capacity:
- Linked entities (reference other dataflows)
- Computed entities (incremental refresh)
- DirectQuery for dataflows
- Enhanced compute engine

Dataflows bridge the gap between self-service BI and governed enterprise data.
