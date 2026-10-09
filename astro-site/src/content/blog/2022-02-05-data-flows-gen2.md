---
title: "Data Flows Gen2: Visual Data Transformation at Scale"
description: "Data Flows Gen2 democratize data transformation, enabling both developers and data analysts to build scalable ETL solutions."
author: Michael John Peña
draft: false
date: 2022-02-05
url: /blog/data-flows-gen2/
tags:
  - Azure
  - data-factory
  - Synapse
  - ETL
---

## Data Flow Architecture

Data flows run on auto-scaling Spark clusters managed by Azure:

```json
{
  "name": "SalesTransformationFlow",
  "properties": {
    "type": "MappingDataFlow",
    "typeProperties": {
      "sources": [
        {
          "name": "SalesSource",
          "dataset": {
            "referenceName": "AzureDataLakeSales",
            "type": "DatasetReference"
          }
        }
      ],
      "sinks": [
        {
          "name": "SalesSink",
          "dataset": {
            "referenceName": "SynapseWarehouse",
            "type": "DatasetReference"
          }
        }
      ],
      "transformations": [],
      "scriptLines": []
    }
  }
}
```

## Source Configuration

```json
{
  "source": {
    "name": "SalesData",
    "type": "source",
    "dataset": {
      "type": "DelimitedText",
      "linkedService": "AzureDataLakeStorage",
      "location": {
        "type": "AzureBlobFSLocation",
        "fileName": "*.csv",
        "folderPath": "raw/sales",
        "fileSystem": "data"
      }
    },
    "settings": {
      "format": {
        "type": "csv",
        "columnDelimiter": ",",
        "rowDelimiter": "\n",
        "quoteChar": "\"",
        "escapeChar": "\\",
        "firstRowAsHeader": true
      },
      "wildcardPaths": ["raw/sales/**/*.csv"],
      "partitionRootPath": "raw/sales"
    }
  }
}
```

## Transformation Examples

### Derived Column

```
// Data flow script for derived columns
source(output(
    OrderID as string,
    CustomerID as string,
    Amount as decimal(10,2),
    OrderDate as string
)) ~> SalesSource

SalesSource derive(
    Year = year(toDate(OrderDate, 'yyyy-MM-dd')),
    Month = month(toDate(OrderDate, 'yyyy-MM-dd')),
    Quarter = case(
        Month <= 3, 'Q1',
        Month <= 6, 'Q2',
        Month <= 9, 'Q3',
        'Q4'
    ),
    AmountWithTax = Amount * 1.1,
    IsHighValue = Amount > 1000
) ~> DerivedColumns
```

### Aggregation

```
// Aggregate transformation
DerivedColumns aggregate(
    groupBy(CustomerID, Year, Month),
    TotalAmount = sum(Amount),
    OrderCount = count(),
    AvgOrderValue = avg(Amount),
    MaxOrder = max(Amount),
    MinOrder = min(Amount)
) ~> SalesAggregation
```

### Lookup and Join

```
// Join with dimension table
SalesAggregation, CustomerDimension join(
    SalesAggregation@CustomerID == CustomerDimension@CustomerKey,
    joinType: 'left',
    matchType: 'exact',
    ignoreSpaces: false,
    broadcast: 'auto'
) ~> JoinedData
```

### Conditional Split

```
// Split data based on conditions
JoinedData split(
    Amount > 10000,
    Amount > 1000,
    disjoint: false
) ~> SplitByValue@(HighValue, MediumValue, LowValue)
```

### Slowly Changing Dimension (SCD Type 2)

```
// SCD Type 2 transformation
CustomerSource alterRow(
    insertIf(isNull(lookup(CustomerKey))),
    updateIf(!isNull(lookup(CustomerKey)) &&
             hasChanged(CustomerName, lookup(CustomerName))),
    upsertIf(true())
) ~> DetermineAction

DetermineAction sink(
    allowSchemaDrift: false,
    validateSchema: true,
    deletable: false,
    insertable: true,
    updateable: true,
    upsertable: true,
    keys: ['CustomerKey'],
    skipDuplicateMapInputs: true,
    skipDuplicateMapOutputs: true,
    saveOrder: 1,
    mapColumn(
        CustomerKey,
        CustomerName,
        Email,
        EffectiveDate = currentDate(),
        ExpirationDate = toDate('9999-12-31'),
        IsCurrent = true()
    )
) ~> CustomerDimSink
```

## Performance Optimization

### Partitioning Settings

```json
{
  "transformation": {
    "name": "OptimizedPartitioning",
    "partition": {
      "type": "hash",
      "columns": ["CustomerID"],
      "numberOfPartitions": 200
    }
  }
}
```

### Debug Settings

```json
{
  "debug": {
    "sourceSettings": {
      "rowLimit": 1000,
      "sourceSampling": {
        "samplingMethod": "Top",
        "count": 1000
      }
    },
    "parameters": {
      "environment": "dev",
      "dateFilter": "2022-01-01"
    }
  }
}
```

## Integration with Pipeline

```json
{
  "name": "ExecuteDataFlow",
  "type": "ExecuteDataFlow",
  "dependsOn": [],
  "policy": {
    "timeout": "1.00:00:00",
    "retry": 3,
    "retryIntervalInSeconds": 30
  },
  "typeProperties": {
    "dataFlow": {
      "referenceName": "SalesTransformationFlow",
      "type": "DataFlowReference"
    },
    "compute": {
      "computeType": "MemoryOptimized",
      "coreCount": 16
    },
    "traceLevel": "Fine",
    "staging": {
      "linkedService": {
        "referenceName": "StagingStorage",
        "type": "LinkedServiceReference"
      },
      "folderPath": "staging"
    }
  }
}
```

## Monitoring and Debugging

```kusto
// Monitor data flow execution
ADFActivityRun
| where OperationName == "ExecuteDataFlow"
| extend
    DataFlowName = parse_json(Output).dataFlowName,
    Duration = datetime_diff('second', End, Start),
    RowsRead = parse_json(Output).runStatus.metrics.source1.rowsRead,
    RowsWritten = parse_json(Output).runStatus.metrics.sink1.rowsWritten
| project
    TimeGenerated,
    DataFlowName,
    Duration,
    RowsRead,
    RowsWritten,
    Status
| order by TimeGenerated desc
```

Data Flows Gen2 democratize data transformation, enabling both developers and data analysts to build scalable ETL solutions.
