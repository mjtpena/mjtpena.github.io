---
title: "Power BI Composite Models: The Best of Both Worlds"
description: "Composite models let you use both in the same dataset. Composite models unlock new scenarios in Power BI, enabling enterprise-scale analytics with the…"
author: Michael John Peña
draft: false
date: 2022-01-27
url: /blog/power-bi-composite-models/
tags:
  - power-bi
  - data-modeling
  - directquery
  - Analytics
---

## Understanding Composite Models

Traditional Power BI models required choosing between:
- **Import Mode**: Fast but scheduled refresh
- **DirectQuery**: Real-time but potentially slower

Composite models let you use both in the same dataset.

## When to Use Composite Models

- Large fact tables that can't be imported
- Real-time dashboards with historical context
- Combining enterprise data warehouse with Excel budgets
- Chaining Power BI datasets

## Creating a Composite Model

```powerquery-m
// Import mode for dimension tables
let
    Source = Sql.Database("server.database.windows.net", "DW"),
    DimProduct = Source{[Schema="dbo",Item="DimProduct"]}[Data]
in
    DimProduct

// DirectQuery for large fact tables
let
    Source = Sql.Database("server.database.windows.net", "DW", [EnableFolding=true]),
    FactSales = Source{[Schema="dbo",Item="FactSales"]}[Data]
in
    FactSales
```

## Storage Mode Configuration

Switch storage modes per table:

```json
{
  "model": {
    "tables": [
      {
        "name": "DimDate",
        "mode": "import",
        "dataSource": "AzureSQL_DW"
      },
      {
        "name": "DimProduct",
        "mode": "import",
        "dataSource": "AzureSQL_DW"
      },
      {
        "name": "DimCustomer",
        "mode": "dual",
        "dataSource": "AzureSQL_DW"
      },
      {
        "name": "FactSales",
        "mode": "directQuery",
        "dataSource": "AzureSQL_DW"
      }
    ]
  }
}
```

## Dual Storage Mode

Dual mode tables can act as either Import or DirectQuery depending on the query:

```dax
// This query uses Import mode (DimProduct is Dual)
EVALUATE
SUMMARIZECOLUMNS(
    DimProduct[Category],
    "Total", SUM(ImportedBudget[Amount])
)

// This query uses DirectQuery mode (joined with DirectQuery fact)
EVALUATE
SUMMARIZECOLUMNS(
    DimProduct[Category],
    "Total", SUM(FactSales[SalesAmount])
)
```

## Performance Optimization

### Aggregation Tables

Create aggregation tables for common queries:

```dax
// Create aggregation table in DAX
SalesAggregated =
SUMMARIZE(
    FactSales,
    DimDate[Year],
    DimDate[Month],
    DimProduct[Category],
    "TotalSales", SUM(FactSales[SalesAmount]),
    "TotalQuantity", SUM(FactSales[Quantity])
)
```

Configure aggregations:

```json
{
  "table": "SalesAggregated",
  "mode": "import",
  "aggregations": [
    {
      "column": "TotalSales",
      "summarization": "Sum",
      "detailColumn": "FactSales[SalesAmount]"
    },
    {
      "column": "TotalQuantity",
      "summarization": "Sum",
      "detailColumn": "FactSales[Quantity]"
    }
  ]
}
```

### Query Reduction

```dax
// Efficient measure that respects storage modes
Total Sales =
VAR AggLevel = HASONEVALUE(DimDate[Date])
RETURN
IF(
    AggLevel,
    CALCULATE(SUM(FactSales[SalesAmount])),  // DirectQuery for detail
    CALCULATE(SUM(SalesAggregated[TotalSales]))  // Import for aggregated
)
```

## Chaining Power BI Datasets

Connect to published datasets:

```powerquery-m
// Connect to existing Power BI dataset
let
    Source = PowerBI.Datasets(null),
    FinanceDataset = Source{[Name="Finance Analytics", Workspace="Finance Team"]}[Data],
    BudgetTable = FinanceDataset{[Name="Budget"]}[Data]
in
    BudgetTable
```

Create composite model combining datasets:

```json
{
  "model": {
    "connections": [
      {
        "name": "SalesDataset",
        "type": "powerBIDataset",
        "workspaceId": "workspace-guid",
        "datasetId": "sales-dataset-guid"
      },
      {
        "name": "FinanceDataset",
        "type": "powerBIDataset",
        "workspaceId": "workspace-guid",
        "datasetId": "finance-dataset-guid"
      }
    ],
    "tables": [
      {
        "name": "Sales",
        "source": "SalesDataset",
        "mode": "directQuery"
      },
      {
        "name": "Budget",
        "source": "FinanceDataset",
        "mode": "directQuery"
      },
      {
        "name": "LocalDimensions",
        "mode": "import",
        "source": "Excel"
      }
    ]
  }
}
```

## Monitoring Composite Model Performance

```dax
// Performance analyzer DAX query
EVALUATE
ROW(
    "DirectQueryRows", COUNTROWS(FactSales),
    "ImportedRows", COUNTROWS(DimProduct),
    "StorageMode", "Composite"
)
```

Use Performance Analyzer in Power BI Desktop to track:
- DirectQuery duration
- Import refresh time
- Aggregation hits

## Best Practices

1. **Import dimensions** - Small, slowly changing tables
2. **DirectQuery facts** - Large, frequently updated tables
3. **Use Dual mode strategically** - For tables joining both modes
4. **Create aggregations** - Pre-aggregate common queries
5. **Monitor performance** - Track DirectQuery vs Import query times
6. **Test thoroughly** - Composite models add complexity

Composite models unlock new scenarios in Power BI, enabling enterprise-scale analytics with the flexibility modern businesses need.
