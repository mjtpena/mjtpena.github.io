---
title: "Dataflow Gen2: Power Query Transformations in Fabric"
author: Michael John Peña
draft: false
date: 2023-07-13
tags:
  - Microsoft Fabric
  - Dataflow Gen2
  - Power Query
  - ETL
---

A month into production-style Fabric testing and Dataflow Gen2 has become my go-to recommendation for teams without Spark expertise who need repeatable data transformation. The Power Query M experience is genuinely intuitive for data analysts who already know Power BI Desktop — same function library, same step-by-step transformation model. The architectural improvement over Gen1 is significant in practice: the intermediate staging in an internal Fabric Lakehouse means large-dataset refreshes don't blow up in memory the way Gen1 could, and the output can land directly in a Lakehouse Table as a Delta table with incremental refresh enabled. The current limitation to plan around: complex transformations with many fold steps can be slower than equivalent PySpark because not all M functions fold to the source. Profiling your dataflow against a PySpark alternative is worth doing if refresh time is critical.

## What is Dataflow Gen2?

```python
# Dataflow Gen2 characteristics
dataflow_gen2 = {
    "engine": "Power Query M language",
    "interface": "Visual query editor",
    "output": "Direct to Lakehouse tables",
    "staging": "Built-in Lakehouse staging",
    "compute": "Enhanced compute engine",
    "comparison_to_gen1": {
        "performance": "Faster with staging",
        "destinations": "Native Fabric integration",
        "scale": "Better large dataset handling"
    }
}
```

## Creating a Dataflow Gen2

```
1. In your workspace, click "+ New" > "Dataflow Gen2"
2. You enter the Power Query editor
3. Add data sources
4. Apply transformations
5. Set destination (Lakehouse)
6. Publish
```

## Power Query M Basics

### Getting Data

```powerquery
// Connect to various sources

// From SQL Database
let
    Source = Sql.Database("server.database.windows.net", "SalesDB"),
    Sales_Orders = Source{[Schema="Sales", Item="Orders"]}[Data]
in
    Sales_Orders

// From REST API
let
    Source = Json.Document(Web.Contents("https://api.example.com/data")),
    Data = Source[results],
    ToTable = Table.FromList(Data, Splitter.SplitByNothing())
in
    ToTable

// From CSV file
let
    Source = Csv.Document(
        File.Contents("Files/raw/data.csv"),
        [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.None]
    ),
    PromotedHeaders = Table.PromoteHeaders(Source)
in
    PromotedHeaders

// From Lakehouse table
let
    Source = Lakehouse.Contents(null),
    Navigation = Source{[workspaceId="..."]}[Data],
    Table = Navigation{[Id="sales"]}[Data]
in
    Table
```

### Common Transformations

```powerquery
// Filter rows
let
    Source = Sales_Orders,
    FilteredRows = Table.SelectRows(Source, each [Amount] > 100)
in
    FilteredRows

// Add calculated column
let
    Source = Sales_Orders,
    AddedColumn = Table.AddColumn(Source, "AmountWithTax",
        each [Amount] * 1.1, type number)
in
    AddedColumn

// Remove columns
let
    Source = Sales_Orders,
    RemovedColumns = Table.RemoveColumns(Source, {"TempColumn", "DebugColumn"})
in
    RemovedColumns

// Rename columns
let
    Source = Sales_Orders,
    RenamedColumns = Table.RenameColumns(Source, {
        {"OrderID", "order_id"},
        {"CustomerID", "customer_id"},
        {"OrderDate", "order_date"}
    })
in
    RenamedColumns

// Change data types
let
    Source = Sales_Orders,
    ChangedTypes = Table.TransformColumnTypes(Source, {
        {"order_date", type date},
        {"amount", type number},
        {"quantity", Int64.Type}
    })
in
    ChangedTypes
```

### Aggregations

```powerquery
// Group by with aggregations
let
    Source = Sales_Orders,
    Grouped = Table.Group(Source, {"customer_id"}, {
        {"total_orders", each Table.RowCount(_), Int64.Type},
        {"total_amount", each List.Sum([amount]), type number},
        {"avg_amount", each List.Average([amount]), type number},
        {"first_order", each List.Min([order_date]), type date},
        {"last_order", each List.Max([order_date]), type date}
    })
in
    Grouped
```

### Joins and Merges

```powerquery
// Inner join
let
    Orders = Sales_Orders,
    Customers = Customer_Table,
    Merged = Table.NestedJoin(
        Orders, {"customer_id"},
        Customers, {"id"},
        "CustomerData",
        JoinKind.Inner
    ),
    Expanded = Table.ExpandTableColumn(
        Merged, "CustomerData",
        {"name", "email", "segment"}
    )
in
    Expanded

// Left outer join
let
    Merged = Table.NestedJoin(
        Orders, {"product_id"},
        Products, {"id"},
        "ProductData",
        JoinKind.LeftOuter
    )
in
    Merged

// Append (union) tables
let
    Combined = Table.Combine({Orders_2022, Orders_2023})
in
    Combined
```

### Date Transformations

```powerquery
// Extract date parts
let
    Source = Sales_Orders,
    WithDateParts = Table.AddColumn(Source, "year",
        each Date.Year([order_date]), Int64.Type),
    WithMonth = Table.AddColumn(WithDateParts, "month",
        each Date.Month([order_date]), Int64.Type),
    WithQuarter = Table.AddColumn(WithMonth, "quarter",
        each Date.QuarterOfYear([order_date]), Int64.Type),
    WithDayOfWeek = Table.AddColumn(WithQuarter, "day_of_week",
        each Date.DayOfWeekName([order_date]), type text)
in
    WithDayOfWeek

// Date calculations
let
    Source = Sales_Orders,
    WithAge = Table.AddColumn(Source, "days_since_order",
        each Duration.Days(DateTime.LocalNow() - [order_date]), Int64.Type)
in
    WithAge
```

### Text Transformations

```powerquery
// Clean and transform text
let
    Source = Customers,
    Cleaned = Table.TransformColumns(Source, {
        {"name", Text.Trim},
        {"email", Text.Lower},
        {"state", Text.Upper}
    }),
    WithProperCase = Table.TransformColumns(Cleaned, {
        {"name", Text.Proper}
    })
in
    WithProperCase

// Split columns
let
    Source = Data,
    Split = Table.SplitColumn(
        Source, "full_name",
        Splitter.SplitTextByDelimiter(" ", QuoteStyle.Csv),
        {"first_name", "last_name"}
    )
in
    Split

// Combine columns
let
    Source = Data,
    Combined = Table.CombineColumns(
        Source,
        {"first_name", "last_name"},
        Combiner.CombineTextByDelimiter(" ", QuoteStyle.None),
        "full_name"
    )
in
    Combined
```

## Setting Destination

```powerquery
// In Dataflow Gen2, set output to Lakehouse
// 1. Click the table in the Queries pane
// 2. In the bottom right, click "+" next to Data destination
// 3. Select "Lakehouse"
// 4. Choose workspace and Lakehouse
// 5. Select or create table
// 6. Configure update method:
//    - Replace: Overwrite entire table
//    - Append: Add to existing data

// Update method options
destination_options = {
    "Replace": "Full refresh - replaces all data",
    "Append": "Incremental - adds new rows"
}
```

## Dataflow Gen2 Best Practices

```python
# 1. Use query folding
# Power Query can push operations to source
# Check: View > Query dependencies > Folding indicators

# 2. Reference queries for reuse
# Create base queries, reference for transformations
# Reduces data retrieval operations

# 3. Disable unnecessary columns early
# Remove unneeded columns before transformations
# Improves performance

# 4. Use staging
# Dataflow Gen2 uses Lakehouse staging by default
# Improves performance for large datasets

# 5. Error handling
# Use try...otherwise for robust transforms
```

```powerquery
// Error handling example
let
    Source = Sales_Data,
    SafeConvert = Table.TransformColumns(Source, {
        {"amount", each try Number.From(_) otherwise 0}
    })
in
    SafeConvert
```

## Scheduling Dataflows

```python
# Schedule dataflow refreshes
# 1. Click on the dataflow in workspace
# 2. Click "Settings" (gear icon)
# 3. Configure refresh schedule

schedule_config = {
    "refresh_frequency": "Daily",
    "time_zone": "UTC",
    "times": ["06:00", "18:00"],
    "send_notifications": True,
    "failure_notification": "owner"
}
```

## Comparison: Dataflow Gen2 vs Notebooks

```python
comparison = {
    "dataflow_gen2": {
        "best_for": [
            "Visual data preparation",
            "Business user transformations",
            "Power Query expertise",
            "Quick prototyping"
        ],
        "limitations": [
            "Complex logic harder to express",
            "Limited ML integration",
            "Fixed compute"
        ]
    },
    "notebooks": {
        "best_for": [
            "Complex transformations",
            "ML/data science",
            "Code-first approach",
            "Large scale processing"
        ],
        "limitations": [
            "Requires Python/Spark skills",
            "More setup",
            "Less visual"
        ]
    }
}

# Recommendation:
# - Simple transforms: Dataflow Gen2
# - Complex processing: Notebooks
# - Often: Combination of both
```

Tomorrow we'll explore Data Pipelines and orchestration patterns.

## Resources

- [Dataflow Gen2 Documentation](https://learn.microsoft.com/en-us/fabric/data-factory/dataflows-gen2-overview)
- [Power Query M Reference](https://learn.microsoft.com/en-us/powerquery-m/)
- [Dataflow Best Practices](https://learn.microsoft.com/en-us/power-query/best-practices)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
