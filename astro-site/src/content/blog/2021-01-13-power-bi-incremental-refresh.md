---
title: "Power BI Incremental Refresh: Efficient Large Dataset Updates"
author: Michael John Peña
draft: false
date: 2021-01-13
tags:
  - Power BI
  - Data
  - Analytics
  - Performance
---

"Why is the dataset refresh taking three hours?" is the question that eventually leads every Power BI shop to incremental refresh. The first time I switched on a properly configured incremental refresh policy on a multi-billion-row sales fact, the daily refresh dropped from two hours to seven minutes. The cost is a small ceremony up front—RangeStart/RangeEnd parameters, partition policies, query folding discipline—but it's the single highest-leverage change you can make on a slow dataset.

## How It Works

1. Define a date/time column for filtering
2. Set historical data retention period
3. Set incremental refresh window
4. Power BI partitions data automatically
5. Only new partitions refresh

## Configure in Power BI Desktop

```powerquery
// Create RangeStart and RangeEnd parameters
// Name: RangeStart, Type: DateTime
// Name: RangeEnd, Type: DateTime

// Use in your query
let
    Source = Sql.Database("server.database.windows.net", "SalesDB"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],
    FilteredRows = Table.SelectRows(Sales, each
        [OrderDate] >= RangeStart and
        [OrderDate] < RangeEnd
    )
in
    FilteredRows
```

## Set Incremental Refresh Policy

Right-click the table → Incremental refresh:

```
Archive data starting: 5 years before refresh date
Incrementally refresh data starting: 10 days before refresh date

Options:
☑ Detect data changes (using LastModifiedDate column)
☑ Only refresh complete days
```

## Query Folding Requirements

```powerquery
// Ensure query folding - filter early in the query
let
    Source = Sql.Database("server", "database"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Filter BEFORE any transformations that break folding
    FilteredRows = Table.SelectRows(Sales, each
        [OrderDate] >= RangeStart and
        [OrderDate] < RangeEnd
    ),

    // Transformations after filtering
    AddedColumn = Table.AddColumn(FilteredRows, "Year",
        each Date.Year([OrderDate]))
in
    AddedColumn
```

## Verify Query Folding

```powerquery
// In Power Query Editor:
// Right-click the last step → "View Native Query"
// If grayed out, query folding is broken

// The native query should show WHERE clause:
-- SELECT * FROM Sales
-- WHERE OrderDate >= @RangeStart
-- AND OrderDate < @RangeEnd
```

## XMLA Endpoint for Advanced Management

```powershell
# Connect via XMLA endpoint (Premium)
Install-Module -Name SqlServer

$connectionString = "Data Source=powerbi://api.powerbi.com/v1.0/myorg/WorkspaceName"

# View partitions
Invoke-ASCmd -Server $connectionString -Query @"
<Discover xmlns="urn:schemas-microsoft-com:xml-analysis">
  <RequestType>TMSCHEMA_PARTITIONS</RequestType>
  <Restrictions>
    <RestrictionList>
      <DatabaseID>DatasetName</DatabaseID>
      <TableID>Sales</TableID>
    </RestrictionList>
  </Restrictions>
</Discover>
"@
```

## Refresh Specific Partitions

```csharp
// Using TOM (Tabular Object Model)
using Microsoft.AnalysisServices.Tabular;

var server = new Server();
server.Connect("powerbi://api.powerbi.com/v1.0/myorg/Workspace");

var database = server.Databases["MyDataset"];
var table = database.Model.Tables["Sales"];

// Refresh only recent partition
var partition = table.Partitions["Sales-2021-01"];
partition.RequestRefresh(RefreshType.Full);

database.Model.SaveChanges();
```

## Best Practices

| Practice | Reason |
|----------|--------|
| Use date columns | Required for partitioning |
| Ensure query folding | Performance critical |
| Set appropriate window | Balance freshness vs cost |
| Enable change detection | Only refresh changed data |
| Monitor partition sizes | Avoid skewed partitions |

## Partition Strategy

```
Dataset: 5 years of daily sales data

Without incremental refresh:
- Full refresh: ~2 hours
- Data: 500M rows

With incremental refresh:
- Initial load: ~2 hours (once)
- Daily refresh: ~5 minutes (last 10 days only)
- Partitions: 60 monthly + 10 daily
```

## Limitations

- Requires Power BI Premium or Premium Per User
- Table must have a date/time column
- Query folding must work for filters
- Publish from Desktop overwrites policy
- Real-time data needs hybrid approach

Incremental refresh: hours of refreshing reduced to minutes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
