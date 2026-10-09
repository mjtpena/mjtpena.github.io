---
title: "External Tables in Azure Data Explorer"
description: "External tables in ADX expose data in Azure Blob Storage or ADLS Gen2 as queryable tables without ingesting the data into ADX—useful when the data is too…"
author: "Michael John Peña"
draft: false
date: 2021-10-17
tags: ["Azure", "Azure Data Explorer", "ADX", "External Tables", "Data Lake"]
---

External tables in ADX expose data in Azure Blob Storage or ADLS Gen2 as queryable tables without ingesting the data into ADX—useful when the data is too large or too cold to justify ingestion costs, but you still want to run KQL queries against it. The schema is defined in ADX (column names, types, and the external storage URI and folder pattern); at query time, ADX reads the data from external storage and processes it. Parquet format gives the best query performance for external tables because ADX can leverage column pruning and predicate pushdown. The common pattern: ADX handles hot data (recent months) in internal tables for fast queries; external tables expose archived data in ADLS Gen2 Parquet for occasional historical analysis. Cross-table `union` queries combine current and historical data transparently, though with the expected performance difference between hot and cold storage access.

## Types of External Tables

ADX supports external tables pointing to:
- Azure Blob Storage
- Azure Data Lake Storage Gen2
- Azure Data Lake Storage Gen1
- SQL Server (external SQL tables)

## Creating External Tables

### Azure Blob Storage

```kusto
// Create external table on Blob Storage
.create external table ArchivedLogs (
    TimeGenerated: datetime,
    Computer: string,
    ContainerID: string,
    LogEntry: string,
    Namespace: string,
    PodName: string
)
kind=storage
dataformat=parquet
(
    h@'https://mystorageaccount.blob.core.windows.net/logs;impersonate'
)
```

### With Partitioning

```kusto
// Create partitioned external table
.create external table PartitionedLogs (
    TimeGenerated: datetime,
    Computer: string,
    ContainerID: string,
    LogEntry: string,
    Namespace: string
)
kind=storage
partition by (Year: datetime = startofyear(TimeGenerated), Month: datetime = startofmonth(TimeGenerated))
pathformat = ("year=" datetime_pattern("yyyy", Year) "/month=" datetime_pattern("MM", Month))
dataformat=parquet
(
    h@'https://mystorageaccount.blob.core.windows.net/logs;impersonate'
)
```

### Azure Data Lake Gen2

```kusto
// Create external table on ADLS Gen2
.create external table DataLakeLogs (
    TimeGenerated: datetime,
    EventType: string,
    Message: string,
    Properties: dynamic
)
kind=storage
dataformat=json
(
    h@'abfss://container@storageaccount.dfs.core.windows.net/path;impersonate'
)
```

## Authentication Methods

### Managed Identity

```kusto
// Using managed identity (recommended)
.create external table ManagedIdentityTable (
    Column1: string,
    Column2: int
)
kind=storage
dataformat=csv
(
    h@'https://storage.blob.core.windows.net/container;impersonate'
)
```

### SAS Token

```kusto
// Using SAS token
.create external table SASTable (
    Column1: string,
    Column2: int
)
kind=storage
dataformat=csv
(
    h@'https://storage.blob.core.windows.net/container?sv=2020-08-04&ss=b&srt=co&sp=rl...'
)
```

### Storage Account Key (via secrets)

```kusto
// Store secret first
.set stored_credential StorageKey with (type="storage", password="<account-key>")

// Use in external table
.create external table KeyAuthTable (
    Column1: string
)
kind=storage
dataformat=csv
(
    h@'https://storage.blob.core.windows.net/container;StorageKey'
)
```

## Supported Data Formats

### CSV Format

```kusto
.create external table CsvTable (
    Id: int,
    Name: string,
    Value: real
)
kind=storage
dataformat=csv
with (ignoreFirstRecord=true)
(
    h@'https://storage.blob.core.windows.net/data;impersonate'
)
```

### JSON Format

```kusto
.create external table JsonTable (
    TimeGenerated: datetime,
    Level: string,
    Message: string,
    Properties: dynamic
)
kind=storage
dataformat=multijson
(
    h@'https://storage.blob.core.windows.net/json-data;impersonate'
)
```

### Parquet Format

```kusto
.create external table ParquetTable (
    Id: long,
    Timestamp: datetime,
    Value: real,
    Tags: dynamic
)
kind=storage
dataformat=parquet
(
    h@'https://storage.blob.core.windows.net/parquet-data;impersonate'
)
```

## Querying External Tables

### Basic Query

```kusto
// Query external table
external_table('ArchivedLogs')
| where TimeGenerated > datetime(2021-01-01)
| where LogEntry contains "error"
| take 100
```

### With Partition Pruning

```kusto
// Efficient query using partitions
external_table('PartitionedLogs')
| where Year == datetime(2021-01-01) and Month == datetime(2021-06-01)
| summarize count() by Namespace
```

### Joining with Internal Tables

```kusto
// Join archived and current data
let archived = external_table('ArchivedLogs')
    | where TimeGenerated between (datetime(2021-01-01) .. datetime(2021-06-30));

let current = ContainerLogs
    | where TimeGenerated > datetime(2021-07-01);

union archived, current
| summarize count() by bin(TimeGenerated, 1d)
| render timechart
```

## External SQL Tables

Query SQL databases directly from ADX:

```kusto
// Create external SQL table
.create external table SqlOrders (
    OrderId: int,
    CustomerId: int,
    OrderDate: datetime,
    TotalAmount: real
)
kind=sql
table=Orders
(
    h@'Server=myserver.database.windows.net;Database=mydb;Authentication=Active Directory Integrated'
)
```

### Query SQL External Table

```kusto
// Query SQL data
external_table('SqlOrders')
| where OrderDate > ago(30d)
| summarize TotalRevenue = sum(TotalAmount) by CustomerId
| top 10 by TotalRevenue
```

## Virtual Columns

Add computed columns to external tables:

```kusto
// Create external table with virtual column
.create external table LogsWithVirtual (
    TimeGenerated: datetime,
    LogEntry: string,
    ['$filepath']: string  // Virtual column for file path
)
kind=storage
dataformat=csv
(
    h@'https://storage.blob.core.windows.net/logs;impersonate'
)

// Use virtual column in queries
external_table('LogsWithVirtual')
| extend FileName = ['$filepath']
| summarize count() by FileName
```

## Schema Mapping

Define custom mappings for complex data:

```kusto
// Create mapping
.create external table LogsWithMapping ingestion json mapping 'LogMapping'
```

```json
[
    {"column": "TimeGenerated", "path": "$.timestamp", "transform": "DateTimeFromUnixSeconds"},
    {"column": "Level", "path": "$.log_level"},
    {"column": "Message", "path": "$.message"},
    {"column": "Properties", "path": "$", "transform": "SourceLineNumber"}
]
```

## Managing External Tables

### Show External Tables

```kusto
// List all external tables
.show external tables

// Show specific table details
.show external table ArchivedLogs

// Show table schema
.show external table ArchivedLogs schema
```

### Alter External Tables

```kusto
// Add storage path
.alter external table ArchivedLogs add_storage_path h@'https://newstorage.blob.core.windows.net/logs;impersonate'

// Drop external table
.drop external table ArchivedLogs
```

### Refresh External Table

```kusto
// Refresh artifacts (discover new files)
.refresh external table ArchivedLogs
```

## Performance Optimization

### Use Partitioning

```kusto
// Well-partitioned query is much faster
external_table('PartitionedLogs')
| where Year == datetime(2021-01-01)  // Partition pruning
| where TimeGenerated > ago(7d)
| take 1000
```

### Filter Early

```kusto
// Push filters as early as possible
external_table('ArchivedLogs')
| where TimeGenerated > datetime(2021-06-01)  // Filter first
| where Namespace == "production"
| where LogEntry contains "error"
```

### Project Needed Columns

```kusto
// Select only needed columns
external_table('ArchivedLogs')
| project TimeGenerated, LogEntry  // Don't select unnecessary columns
| take 1000
```

## Hybrid Query Pattern

Combine hot (ADX) and cold (external) data seamlessly:

```kusto
// Function to query both hot and cold data
.create-or-alter function GetAllLogs(startTime: datetime, endTime: datetime) {
    let hotCutoff = ago(30d);
    let coldData = external_table('ArchivedLogs')
        | where TimeGenerated between (startTime .. min_of(endTime, hotCutoff));
    let hotData = ContainerLogs
        | where TimeGenerated between (max_of(startTime, hotCutoff) .. endTime);
    union coldData, hotData
}

// Use the function
GetAllLogs(datetime(2021-01-01), now())
| summarize count() by bin(TimeGenerated, 1d)
```

## Best Practices

1. **Use Parquet format** - Best performance for external queries
2. **Partition wisely** - Enable partition pruning
3. **Use managed identity** - Avoid key management
4. **Filter early** - Reduce data scanned
5. **Project columns** - Don't read unnecessary data
6. **Cache appropriately** - Use ADX caching for frequent queries

## Conclusion

External tables extend ADX's reach to data lakes and archives without ingestion costs. By combining internal and external tables, you can build efficient hybrid analytics solutions.

Tomorrow, we'll shift focus to Azure Synapse serverless SQL pools for big data analytics.
