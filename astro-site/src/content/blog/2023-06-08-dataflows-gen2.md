---
title: "Dataflows Gen2: Low-Code Data Transformation in Fabric"
description: "Dataflows Gen2 provide an accessible way to build data transformations. Tomorrow, I will cover Mirroring in Fabric."
author: Michael John Peña
draft: false
date: 2023-06-08
tags:
  - Microsoft Fabric
  - Dataflows Gen2
  - Power Query
  - ETL
  - Low-Code
---

## Dataflows Gen2 Overview

```
┌─────────────────────────────────────────────────────┐
│                Dataflows Gen2                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              Power Query Editor                  ││
│  │  - Visual transformation                         ││
│  │  - M language support                            ││
│  │  - Query folding optimization                    ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Data Sources                        ││
│  │  - Databases (SQL, Oracle, etc.)                ││
│  │  - Files (CSV, Excel, JSON)                     ││
│  │  - Cloud services (Salesforce, Dynamics)        ││
│  │  - Web APIs                                      ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Destinations                        ││
│  │  - Lakehouse Tables                             ││
│  │  - Warehouse Tables                              ││
│  │  - Azure SQL Database                            ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Creating Dataflows

### M Language Basics

```m
// Basic query structure
let
    // Step 1: Connect to source
    Source = Sql.Database("server.database.windows.net", "SalesDB"),

    // Step 2: Navigate to table
    SalesTable = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Step 3: Transform
    FilteredRows = Table.SelectRows(SalesTable, each [Amount] > 0),

    // Step 4: Add columns
    WithYear = Table.AddColumn(FilteredRows, "Year", each Date.Year([OrderDate])),

    // Step 5: Rename columns
    RenamedColumns = Table.RenameColumns(WithYear, {
        {"CustomerID", "customer_id"},
        {"OrderDate", "order_date"},
        {"Amount", "amount"}
    }),

    // Step 6: Select final columns
    FinalColumns = Table.SelectColumns(RenamedColumns, {
        "customer_id", "order_date", "Year", "amount"
    })
in
    FinalColumns
```

### Common Transformations

```m
// Filtering
FilteredRows = Table.SelectRows(Source, each
    [Status] = "Active" and
    [Amount] > 100 and
    [OrderDate] >= #date(2023, 1, 1)
)

// Removing duplicates
Deduplicated = Table.Distinct(Source, {"CustomerID", "OrderDate"})

// Grouping and aggregation
Grouped = Table.Group(Source, {"Category", "Region"}, {
    {"TotalSales", each List.Sum([Amount]), type number},
    {"OrderCount", each Table.RowCount(_), Int64.Type},
    {"AvgOrderValue", each List.Average([Amount]), type number},
    {"MinDate", each List.Min([OrderDate]), type date},
    {"MaxDate", each List.Max([OrderDate]), type date}
})

// Pivoting
Pivoted = Table.Pivot(Source, List.Distinct(Source[Category]), "Category", "Amount", List.Sum)

// Unpivoting
Unpivoted = Table.UnpivotOtherColumns(Source, {"Product", "Region"}, "Month", "Sales")

// Merging tables (JOIN)
Merged = Table.NestedJoin(
    Sales, {"CustomerID"},
    Customers, {"CustomerID"},
    "CustomerDetails",
    JoinKind.LeftOuter
)
Expanded = Table.ExpandTableColumn(Merged, "CustomerDetails", {"CustomerName", "Segment"})

// Appending tables (UNION)
Combined = Table.Combine({Sales2022, Sales2023})

// Conditional column
WithCategory = Table.AddColumn(Source, "AmountCategory", each
    if [Amount] > 1000 then "High"
    else if [Amount] > 100 then "Medium"
    else "Low",
    type text
)

// Custom column with error handling
WithCalculated = Table.AddColumn(Source, "UnitPrice", each
    try [Amount] / [Quantity] otherwise 0,
    type number
)
```

### Data Type Conversions

```m
// Change column types
TypedTable = Table.TransformColumnTypes(Source, {
    {"OrderDate", type date},
    {"Amount", type number},
    {"Quantity", Int64.Type},
    {"CustomerID", type text},
    {"IsActive", type logical}
})

// Parse dates
WithParsedDate = Table.TransformColumns(Source, {
    {"DateString", each Date.FromText(_, "en-US"), type date}
})

// Parse JSON
WithParsedJSON = Table.TransformColumns(Source, {
    {"JsonColumn", each Json.Document(_)}
})
Expanded = Table.ExpandRecordColumn(WithParsedJSON, "JsonColumn", {"field1", "field2"})
```

### Working with Dates

```m
// Date transformations
let
    Source = SalesTable,

    // Extract date parts
    WithDateParts = Table.AddColumn(Source, "Year", each Date.Year([OrderDate])),
    WithMonth = Table.AddColumn(WithDateParts, "Month", each Date.Month([OrderDate])),
    WithMonthName = Table.AddColumn(WithMonth, "MonthName", each Date.MonthName([OrderDate])),
    WithQuarter = Table.AddColumn(WithMonthName, "Quarter", each Date.QuarterOfYear([OrderDate])),
    WithWeekday = Table.AddColumn(WithQuarter, "Weekday", each Date.DayOfWeekName([OrderDate])),

    // Date calculations
    WithDaysAgo = Table.AddColumn(WithWeekday, "DaysAgo", each
        Duration.Days(DateTime.LocalNow() - [OrderDate])
    ),

    // Fiscal year (July start)
    WithFiscalYear = Table.AddColumn(WithDaysAgo, "FiscalYear", each
        if Date.Month([OrderDate]) >= 7
        then Date.Year([OrderDate]) + 1
        else Date.Year([OrderDate])
    )
in
    WithFiscalYear

// Create date dimension
let
    StartDate = #date(2020, 1, 1),
    EndDate = #date(2025, 12, 31),
    DayCount = Duration.Days(EndDate - StartDate) + 1,
    DateList = List.Dates(StartDate, DayCount, #duration(1, 0, 0, 0)),
    DateTable = Table.FromList(DateList, Splitter.SplitByNothing(), {"Date"}, null, ExtraValues.Error),
    TypedDate = Table.TransformColumnTypes(DateTable, {{"Date", type date}}),

    WithYear = Table.AddColumn(TypedDate, "Year", each Date.Year([Date]), Int64.Type),
    WithMonth = Table.AddColumn(WithYear, "Month", each Date.Month([Date]), Int64.Type),
    WithMonthName = Table.AddColumn(WithMonth, "MonthName", each Date.MonthName([Date]), type text),
    WithQuarter = Table.AddColumn(WithMonthName, "Quarter", each "Q" & Text.From(Date.QuarterOfYear([Date])), type text),
    WithDayOfWeek = Table.AddColumn(WithQuarter, "DayOfWeek", each Date.DayOfWeek([Date], Day.Monday) + 1, Int64.Type),
    WithDayName = Table.AddColumn(WithDayOfWeek, "DayName", each Date.DayOfWeekName([Date]), type text),
    WithIsWeekend = Table.AddColumn(WithDayName, "IsWeekend", each Date.DayOfWeek([Date], Day.Monday) >= 5, type logical),
    WithDateKey = Table.AddColumn(WithIsWeekend, "DateKey", each Date.Year([Date]) * 10000 + Date.Month([Date]) * 100 + Date.Day([Date]), Int64.Type)
in
    WithDateKey
```

## Staging with Lakehouse

```m
// Enable staging for improved performance
// In Dataflow settings, select a Lakehouse for staging

// This enables:
// 1. Query folding to Lakehouse
// 2. Faster incremental refresh
// 3. Parallel query execution

// Example: Large transformation with staging
let
    // This will be staged to Lakehouse
    Source = Sql.Database("server.database.windows.net", "LargeDB"),
    LargeTable = Source{[Schema="dbo", Item="Transactions"]}[Data],

    // Complex transformations run on staged data
    Filtered = Table.SelectRows(LargeTable, each [Year] = 2023),
    Grouped = Table.Group(Filtered, {"Category"}, {{"Total", each List.Sum([Amount])}}),
    Sorted = Table.Sort(Grouped, {{"Total", Order.Descending}})
in
    Sorted
```

## Output Destinations

```m
// Output to Lakehouse table
// Configure in Dataflow > Data destination

// Destination settings:
destination_config = {
    "type": "Lakehouse",
    "lakehouse": "SalesLakehouse",
    "table": "processed_sales",
    "update_method": "Replace",  // or "Append"
    "schema_handling": "Dynamic"  // Automatically update schema
}

// Output to Warehouse
warehouse_config = {
    "type": "Warehouse",
    "warehouse": "SalesWarehouse",
    "table": "fact_sales",
    "update_method": "Replace"
}
```

## Best Practices

```python
dataflow_best_practices = {
    "performance": [
        "Enable staging for large datasets",
        "Use query folding when possible",
        "Reduce columns early in the query",
        "Filter data as early as possible",
        "Avoid calculated columns on large datasets"
    ],
    "maintainability": [
        "Use descriptive step names",
        "Document complex transformations",
        "Organize queries in folders",
        "Use parameters for dynamic values"
    ],
    "error_handling": [
        "Use try/otherwise for error handling",
        "Set appropriate null handling",
        "Validate data types",
        "Handle date parsing errors"
    ]
}
```

Dataflows Gen2 provide an accessible way to build data transformations. Tomorrow, I will cover Mirroring in Fabric.

## Resources

- [Dataflows Gen2 Overview](https://learn.microsoft.com/en-us/fabric/data-factory/dataflows-gen2-overview)
- [Power Query M Reference](https://learn.microsoft.com/en-us/powerquery-m/)
- [Dataflow Best Practices](https://learn.microsoft.com/en-us/power-query/best-practices)
