---
title: "Power Query Online: Data Preparation in the Cloud"
description: "Power Query Online democratizes data preparation, enabling business users and data professionals to prepare data without code."
author: Michael John Peña
draft: false
date: 2022-02-06
url: /blog/power-query-online/
tags:
  - power-query
  - data-preparation
  - power-bi
  - Dataflows
---

## Understanding Power Query Online

Power Query Online provides:
- Browser-based data transformation
- Shared dataflows across Power Platform
- Scheduled refresh
- AI-powered features

## Creating a Dataflow

```powerquery-m
// Connect to multiple sources
let
    // Azure SQL source
    SqlSource = Sql.Database("server.database.windows.net", "salesdb"),
    SalesTable = SqlSource{[Schema="dbo",Item="Sales"]}[Data],

    // Transform data
    FilteredRows = Table.SelectRows(SalesTable, each [OrderDate] >= #date(2022, 1, 1)),

    // Add computed columns
    AddedYear = Table.AddColumn(FilteredRows, "Year", each Date.Year([OrderDate])),
    AddedMonth = Table.AddColumn(AddedYear, "Month", each Date.Month([OrderDate])),

    // Change types
    ChangedTypes = Table.TransformColumnTypes(AddedMonth, {
        {"Amount", type number},
        {"Year", Int64.Type},
        {"Month", Int64.Type}
    })
in
    ChangedTypes
```

## Combining Multiple Sources

```powerquery-m
let
    // Get data from multiple sources
    AzureSql = Sql.Database("server.database.windows.net", "db"),
    CosmosDb = CosmosDB.Contents("https://account.documents.azure.com:443/"),
    ExcelFile = Excel.Workbook(Web.Contents("https://storage.blob.core.windows.net/data/budget.xlsx")),

    // Extract tables
    SqlSales = AzureSql{[Schema="dbo", Item="Sales"]}[Data],
    CosmoOrders = CosmosDb{[Database="orders", Collection="orderitems"]}[Data],
    ExcelBudget = ExcelFile{[Item="Budget", Kind="Sheet"]}[Data],

    // Standardize schemas
    SqlStandardized = Table.SelectColumns(SqlSales, {"OrderID", "CustomerID", "Amount", "Date"}),
    CosmoStandardized = Table.RenameColumns(
        Table.SelectColumns(CosmoOrders, {"id", "customerId", "total", "orderDate"}),
        {{"id", "OrderID"}, {"customerId", "CustomerID"}, {"total", "Amount"}, {"orderDate", "Date"}}
    ),

    // Combine
    Combined = Table.Combine({SqlStandardized, CosmoStandardized})
in
    Combined
```

## AI-Powered Transformations

```powerquery-m
// Use AI Insights in Power Query
let
    Source = Table.FromRecords({
        [Text = "I love this product! Best purchase ever."],
        [Text = "Terrible experience, want my money back."],
        [Text = "Product is okay, nothing special."]
    }),

    // Sentiment Analysis
    SentimentAnalysis = Table.AddColumn(Source, "Sentiment",
        each AzureML.Invoke("SentimentAnalysis", [Text = [Text]])),

    // Key Phrase Extraction
    KeyPhrases = Table.AddColumn(SentimentAnalysis, "KeyPhrases",
        each AzureML.Invoke("KeyPhraseExtraction", [Text = [Text]]))
in
    KeyPhrases
```

## Error Handling

```powerquery-m
let
    Source = Sql.Database("server.database.windows.net", "db"),
    Data = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Handle potential errors
    SafeConversion = Table.TransformColumns(Data, {
        {"Amount", each try Number.FromText(_) otherwise 0}
    }),

    // Remove error rows
    CleanedData = Table.RemoveRowsWithErrors(SafeConversion),

    // Replace nulls
    ReplaceNulls = Table.ReplaceValue(CleanedData, null, 0,
        Replacer.ReplaceValue, {"Quantity"})
in
    ReplaceNulls
```

## Incremental Refresh Setup

```powerquery-m
let
    // Define parameters for incremental refresh
    // RangeStart and RangeEnd are created automatically
    Source = Sql.Database("server.database.windows.net", "salesdb"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Filter for incremental window
    FilteredRows = Table.SelectRows(Sales, each
        [ModifiedDate] >= RangeStart and
        [ModifiedDate] < RangeEnd
    )
in
    FilteredRows
```

Configuration in dataflow settings:

```json
{
  "incrementalRefresh": {
    "enabled": true,
    "refreshRange": {
      "detect": "ModifiedDate",
      "refreshPeriod": "30 days",
      "archivePeriod": "3 years"
    },
    "pollingInterval": "1 hour"
  }
}
```

## Dataflow Computed Tables

```powerquery-m
// Create computed table that references another entity
let
    // Reference linked entity
    SalesData = PowerPlatform.Dataflows([OrgUrl])
        {[WorkspaceName = "Sales Analytics"]}[Data]
        {[DataflowName = "SalesDataflow"]}[Data]
        {[EntityName = "Sales"]}[Data],

    // Build aggregation
    Aggregated = Table.Group(SalesData, {"CustomerID", "Year", "Month"}, {
        {"TotalSales", each List.Sum([Amount]), type number},
        {"OrderCount", each Table.RowCount(_), Int64.Type},
        {"AvgOrderValue", each List.Average([Amount]), type number}
    })
in
    Aggregated
```

## Performance Best Practices

```powerquery-m
// Optimize query folding
let
    Source = Sql.Database("server.database.windows.net", "db"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],

    // These operations fold to SQL:
    Filtered = Table.SelectRows(Sales, each [Year] = 2022),
    Selected = Table.SelectColumns(Filtered, {"CustomerID", "Amount", "OrderDate"}),
    Sorted = Table.Sort(Selected, {{"OrderDate", Order.Descending}}),

    // Check query folding
    // Right-click step > View Native Query

    // This breaks folding (avoid if possible):
    // CustomColumn = Table.AddColumn(Sorted, "Custom", each [Amount] * 1.1)
in
    Sorted
```

## Sharing Dataflows

```json
{
  "dataflow": {
    "name": "Enterprise Sales Dataflow",
    "certified": true,
    "endorsement": "promoted",
    "permissions": {
      "view": ["sales-team@company.com"],
      "edit": ["data-engineers@company.com"],
      "reshare": false
    }
  }
}
```

Power Query Online democratizes data preparation, enabling business users and data professionals to prepare data without code.
