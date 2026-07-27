---
title: "Power BI Incremental Refresh: Handle Large Datasets"
author: Michael John Peña
draft: false
date: 2020-10-14
tags:
  - Power BI
  - Data
  - Analytics
  - Performance

---

I wrote "Power BI Incremental Refresh: Handle Large Datasets" to share practical, production-minded guidance on this topic.

## How It Works

1. Define date range parameters
2. Configure retention policy
3. Power BI partitions data by date
4. Only refreshes recent partitions

## Setting Up Parameters

In Power Query, create two parameters:

```
RangeStart (DateTime): 1/1/2020 12:00:00 AM
RangeEnd (DateTime): 1/1/2021 12:00:00 AM
```

## Filtering Your Query

```powerquery
let
    Source = Sql.Database("server", "database"),
    Sales = Source{[Schema="dbo",Item="Sales"]}[Data],
    #"Filtered Rows" = Table.SelectRows(Sales, each
        [OrderDate] >= RangeStart and [OrderDate] < RangeEnd
    )
in
    #"Filtered Rows"
```

## Configuring Incremental Refresh

Right-click table → Incremental refresh

```
Store rows in the last: 3 Years
Refresh rows in the last: 10 Days
Detect data changes (optional): ModifiedDate column
```

## Policy Breakdown

| Setting | Purpose |
|---------|---------|
| Store rows | Total historical data to keep |
| Refresh rows | Recent period to refresh each time |
| Detect changes | Only refresh if data actually changed |

## Best Practices

### 1. Use Query Folding

Ensure filters push to source database:

```powerquery
// Good: Foldable filter
Table.SelectRows(Sales, each [OrderDate] >= RangeStart)

// Bad: Prevents folding
Table.SelectRows(Sales, each Date.Year([OrderDate]) >= 2020)
```

### 2. Index Your Date Column

```sql
-- SQL Server index for efficient filtering
CREATE INDEX IX_Sales_OrderDate ON Sales(OrderDate)
INCLUDE (Amount, ProductId, CustomerId)
```

### 3. Partition Granularity

For Premium capacity, customize partition size:

```json
{
    "incrementalRefresh": {
        "pollingInterval": "PT2H",
        "sourceExpression": {
            "refreshPolicy": {
                "incrementalGranularity": "day"
            }
        }
    }
}
```

## XMLA Endpoint (Premium)

Manage partitions programmatically:

```csharp
using Microsoft.AnalysisServices.Tabular;

var server = new Server();
server.Connect("powerbi://api.powerbi.com/v1.0/myorg/MyWorkspace");

var database = server.Databases["MyDataset"];
var table = database.Model.Tables["Sales"];

// Refresh specific partition
var partition = table.Partitions["Sales_2020-10"];
partition.RequestRefresh(RefreshType.Full);
database.Model.SaveChanges();
```

## Monitoring Refresh

```sql
-- Check partition refresh status (XMLA query)
SELECT
    [TableName],
    [PartitionName],
    [RefreshedTime],
    [RowCount]
FROM $SYSTEM.TMSCHEMA_PARTITIONS
WHERE [TableName] = 'Sales'
```

## Limitations

- Requires Power BI Pro/Premium
- Source must support query folding
- Date column required
- Parameters must be DateTime type

Incremental refresh transforms multi-hour refreshes into minutes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
