---
title: Power BI Dataflows - Best Practices for Enterprise Data Preparation
author: Michael John Peña
draft: false
date: 2021-02-04
url: /blog/power-bi-dataflows-best-practices/
tags:
  - Power BI
  - Data
  - Analytics
  - ETL
  - Microsoft

---

I wrote "2021-02-04-power-bi-dataflows-best-practices" to share practical, production-minded guidance on this topic.

## What are Power BI Dataflows?

Dataflows are collections of entities (tables) that are created and managed in workspaces in the Power BI service. They allow you to:

- Connect to various data sources
- Transform data using Power Query
- Store the transformed data in Azure Data Lake Storage
- Reuse the prepared data across multiple reports and datasets

## Creating Your First Dataflow

Let's create a dataflow that combines sales data from multiple sources:

1. Navigate to your Power BI workspace
2. Click **New** > **Dataflow**
3. Choose **Define new entities**

### Connecting to SQL Server

```m
let
    Source = Sql.Database("sqlserver.database.windows.net", "SalesDB"),
    Sales_Table = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Filter to recent data
    FilteredRows = Table.SelectRows(Sales_Table, each [OrderDate] >= #date(2020, 1, 1)),

    // Add calculated columns
    AddedProfit = Table.AddColumn(FilteredRows, "Profit",
        each [Revenue] - [Cost], Currency.Type),

    AddedProfitMargin = Table.AddColumn(AddedProfit, "ProfitMargin",
        each if [Revenue] > 0 then [Profit] / [Revenue] else 0, Percentage.Type),

    // Set column types
    TypedTable = Table.TransformColumnTypes(AddedProfitMargin, {
        {"OrderDate", type date},
        {"Revenue", Currency.Type},
        {"Cost", Currency.Type},
        {"Profit", Currency.Type},
        {"ProfitMargin", Percentage.Type}
    })
in
    TypedTable
```

### Merging Data from Multiple Sources

```m
let
    // Load Sales data
    Sales = SalesEntity,

    // Load Customer data from another source
    Customers = Json.Document(Web.Contents("https://api.example.com/customers")),
    CustomersTable = Table.FromList(Customers, Splitter.SplitByNothing()),
    ExpandedCustomers = Table.ExpandRecordColumn(CustomersTable, "Column1",
        {"CustomerId", "CustomerName", "Region", "Segment"}),

    // Merge Sales with Customers
    MergedTables = Table.NestedJoin(
        Sales, {"CustomerId"},
        ExpandedCustomers, {"CustomerId"},
        "CustomerDetails",
        JoinKind.LeftOuter
    ),

    // Expand customer columns
    ExpandedMerge = Table.ExpandTableColumn(
        MergedTables,
        "CustomerDetails",
        {"CustomerName", "Region", "Segment"}
    )
in
    ExpandedMerge
```

## Computed Entities for Reusability

One of the most powerful features of dataflows is computed entities. These reference other entities within the same dataflow, enabling a modular approach:

### Base Entity: Raw Sales Data

```m
// Entity: RawSales
let
    Source = Sql.Database("sqlserver.database.windows.net", "SalesDB"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data]
in
    Sales
```

### Computed Entity: Aggregated Sales

```m
// Entity: MonthlySalesAggregates (references RawSales)
let
    Source = RawSales,

    // Add month column
    AddedMonth = Table.AddColumn(Source, "Month",
        each Date.StartOfMonth([OrderDate]), type date),

    // Group by month and product
    Grouped = Table.Group(AddedMonth, {"Month", "ProductCategory"}, {
        {"TotalRevenue", each List.Sum([Revenue]), Currency.Type},
        {"TotalOrders", each Table.RowCount(_), Int64.Type},
        {"AvgOrderValue", each List.Average([Revenue]), Currency.Type}
    })
in
    Grouped
```

### Computed Entity: YoY Comparison

```m
// Entity: YoYComparison (references MonthlySalesAggregates)
let
    Source = MonthlySalesAggregates,

    // Add previous year reference
    AddedPrevYear = Table.AddColumn(Source, "PrevYearMonth",
        each Date.AddYears([Month], -1), type date),

    // Self-join for previous year data
    Joined = Table.NestedJoin(
        Source, {"PrevYearMonth", "ProductCategory"},
        Source, {"Month", "ProductCategory"},
        "PrevYearData",
        JoinKind.LeftOuter
    ),

    // Expand and calculate YoY growth
    Expanded = Table.ExpandTableColumn(Joined, "PrevYearData",
        {"TotalRevenue"}, {"PrevYearRevenue"}),

    AddedYoY = Table.AddColumn(Expanded, "YoYGrowth",
        each if [PrevYearRevenue] <> null and [PrevYearRevenue] > 0
             then ([TotalRevenue] - [PrevYearRevenue]) / [PrevYearRevenue]
             else null,
        Percentage.Type)
in
    AddedYoY
```

## Incremental Refresh for Large Datasets

For large datasets, configure incremental refresh to only load new or changed data:

```m
let
    // Parameters for incremental refresh
    RangeStart = #datetime(2020, 1, 1, 0, 0, 0),
    RangeEnd = #datetime(2021, 12, 31, 23, 59, 59),

    Source = Sql.Database("sqlserver.database.windows.net", "SalesDB"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Filter based on range parameters
    FilteredSales = Table.SelectRows(Sales, each
        [ModifiedDate] >= RangeStart and [ModifiedDate] < RangeEnd)
in
    FilteredSales
```

To enable incremental refresh:

1. Define `RangeStart` and `RangeEnd` parameters
2. Use these parameters in your filter
3. Configure refresh settings in the dataflow properties

## Best Practices

### 1. Organize with Folders

Structure your dataflow entities logically:

```
Dataflow: Sales Analytics
├── Raw Data
│   ├── RawSales
│   ├── RawProducts
│   └── RawCustomers
├── Staging
│   ├── CleanedSales
│   ├── EnrichedProducts
│   └── CustomerDimension
└── Analytics
    ├── DailySalesMetrics
    ├── ProductPerformance
    └── CustomerSegmentation
```

### 2. Use Query Folding When Possible

Ensure transformations are pushed back to the source:

```m
// Good - Query folds to SQL
let
    Source = Sql.Database("server", "db"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],
    Filtered = Table.SelectRows(Sales, each [Year] = 2021),  // Folds
    Selected = Table.SelectColumns(Filtered, {"OrderId", "Amount"})  // Folds
in
    Selected

// Check if folding works by right-clicking step > "View Native Query"
```

### 3. Handle Errors Gracefully

```m
let
    Source = try Sql.Database("server", "db") otherwise #table({}, {}),

    // Replace errors in specific column
    ReplacedErrors = Table.ReplaceErrorValues(Source, {
        {"Amount", 0},
        {"Quantity", 1}
    }),

    // Remove rows with critical errors
    RemovedErrorRows = Table.RemoveRowsWithErrors(ReplacedErrors, {"OrderId"})
in
    RemovedErrorRows
```

### 4. Parameterize Connections

```m
let
    // Define parameters
    ServerName = "sqlserver.database.windows.net",
    DatabaseName = "SalesDB",
    SchemaName = "dbo",

    // Use parameters in connection
    Source = Sql.Database(ServerName, DatabaseName),
    Table = Source{[Schema=SchemaName, Item="Sales"]}[Data]
in
    Table
```

### 5. Document Your Transformations

```m
let
    // =====================================================
    // Entity: CleanedSalesData
    // Purpose: Clean and standardize raw sales records
    // Author: Michael John Pena
    // Last Updated: 2021-02-04
    // =====================================================

    Source = RawSales,

    // Step 1: Remove duplicates based on OrderId
    Deduplicated = Table.Distinct(Source, {"OrderId"}),

    // Step 2: Standardize region names
    StandardizedRegion = Table.TransformColumns(Deduplicated, {
        {"Region", each Text.Upper(Text.Trim(_))}
    }),

    // Step 3: Handle null values
    ReplacedNulls = Table.ReplaceValue(StandardizedRegion,
        null, "UNKNOWN", Replacer.ReplaceValue, {"Region"})
in
    ReplacedNulls
```

## Linking Dataflows to Azure Data Lake

For enterprise scenarios, link your dataflow storage to your own Azure Data Lake:

1. Go to **Settings** > **Admin portal** > **Dataflow settings**
2. Click **Connect Azure Data Lake Storage Gen2**
3. Provide your storage account details

Benefits:
- Full control over data storage
- Access data with other Azure services
- Compliance with data residency requirements
- Direct access via Spark, Databricks, or Synapse

## Monitoring and Management

Monitor dataflow refreshes using the REST API:

```powershell
# Get dataflow refresh history
$workspaceId = "your-workspace-id"
$dataflowId = "your-dataflow-id"

$headers = @{
    "Authorization" = "Bearer $accessToken"
    "Content-Type" = "application/json"
}

$url = "https://api.powerbi.com/v1.0/myorg/groups/$workspaceId/dataflows/$dataflowId/transactions"

$response = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
$response.value | Format-Table startTime, endTime, status
```

## Conclusion

Power BI Dataflows are a powerful tool for creating reusable, self-service data preparation pipelines. By following best practices like using computed entities, implementing incremental refresh, and organizing your transformations logically, you can build scalable data solutions that serve your entire organization.

The key is to think of dataflows as a shared data preparation layer, not just a means to load data into a single report.

