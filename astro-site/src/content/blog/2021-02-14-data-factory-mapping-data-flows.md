---
title: Data Transformation with Azure Data Factory Mapping Data Flows
description: "Mapping Data Flows are the feature that ended most of my \"should I use PySpark or Spark SQL for this?\" debates. Visual, yes—but reviewable in JSON and…"
author: Michael John Peña
draft: false
date: 2021-02-14
url: /blog/data-factory-mapping-data-flows/
tags:
  - Azure
  - Data Factory
  - ETL
  - Data Engineering
  - Spark
---

Mapping Data Flows are the feature that ended most of my "should I use PySpark or Spark SQL for this?" debates. Visual, yes—but reviewable in JSON and deployable via ARM, which means they can live in source control and be reviewed like code. The key distinction from ADF copy activities is that Mapping Data Flows are transformations, not movements—they run on managed Spark clusters that spin up, execute the flow, and shut down. Debug mode keeps a cluster warm so you can iterate quickly; turn it off when you're done or you'll pay for idle cluster time.

## Understanding Mapping Data Flows

Mapping Data Flows offer:

- **Visual designer** - Drag-and-drop transformation logic
- **Spark-powered** - Automatic Spark code generation
- **Schema flexibility** - Handle schema drift dynamically
- **Integration** - Seamlessly integrate with ADF pipelines
- **Debug mode** - Interactive data preview during development

## Creating a Data Flow

Let's build a data flow that processes sales data:

### Source Configuration

```json
{
    "name": "source_sales",
    "type": "Source",
    "dataset": {
        "referenceName": "ds_blob_sales_raw",
        "type": "DatasetReference"
    },
    "typeProperties": {
        "allowSchemaDrift": true,
        "validateSchema": false,
        "inferDriftedColumnTypes": true,
        "samplingMethod": "none"
    }
}
```

### Data Flow Script

Data flows can also be defined using Data Flow Script:

```dataflow
source(output(
        OrderId as integer,
        CustomerId as string,
        ProductId as string,
        Quantity as integer,
        UnitPrice as decimal(10,2),
        OrderDate as timestamp,
        ShipCountry as string
    ),
    allowSchemaDrift: true,
    validateSchema: false) ~> SalesSource

SalesSource derive(
        TotalAmount = Quantity * UnitPrice,
        OrderYear = year(OrderDate),
        OrderMonth = month(OrderDate),
        OrderQuarter = quarter(OrderDate)
    ) ~> CalculatedColumns

CalculatedColumns filter(
        TotalAmount > 0 && !isNull(CustomerId)
    ) ~> FilterValidRecords

FilterValidRecords aggregate(
        groupBy(
            CustomerId,
            OrderYear,
            OrderMonth
        ),
        TotalRevenue = sum(TotalAmount),
        OrderCount = count(),
        AvgOrderValue = avg(TotalAmount),
        MaxOrderValue = max(TotalAmount)
    ) ~> AggregateByCustomer

AggregateByCustomer window(
        over(CustomerId),
        asc(OrderYear, true),
        asc(OrderMonth, true),
        PrevMonthRevenue = lag(TotalRevenue, 1),
        RevenueGrowth = iif(isNull(lag(TotalRevenue, 1)), 0,
            (TotalRevenue - lag(TotalRevenue, 1)) / lag(TotalRevenue, 1) * 100)
    ) ~> WindowFunctions

WindowFunctions select(
        mapColumn(
            CustomerId,
            Year = OrderYear,
            Month = OrderMonth,
            Revenue = TotalRevenue,
            Orders = OrderCount,
            AvgOrder = AvgOrderValue,
            MaxOrder = MaxOrderValue,
            MoMGrowth = RevenueGrowth
        )
    ) ~> SelectFinalColumns

SelectFinalColumns sink(
        allowSchemaDrift: true,
        validateSchema: false,
        format: 'parquet',
        partitionBy('key', 0, Year, Month)
    ) ~> SinkToDataLake
```

## Common Transformation Patterns

### Deduplication

```dataflow
source ~> Source1
Source1 aggregate(
        groupBy(
            CustomerId,
            OrderId
        ),
        each(match(true()), $$ = first($$))
    ) ~> Deduplicate
```

### Pivot Data

```dataflow
source ~> Source1
Source1 pivot(
        groupBy(CustomerId),
        pivotBy(Category),
        TotalSales = sum(Amount)
    ) ~> PivotByCategory
```

### Unpivot Data

```dataflow
source ~> Source1
Source1 unpivot(
        output(
            MetricName as string,
            MetricValue as double
        ),
        ungroupBy(ProductId),
        lateral: true,
        ignoreNullPivots: false
    ) (
        Revenue as 'Revenue',
        Cost as 'Cost',
        Margin as 'Margin'
    ) ~> UnpivotMetrics
```

### Slowly Changing Dimension Type 2

```dataflow
// Source: Current records
currentRecords derive(
        HashKey = md5(columns()),
        EffectiveDate = currentTimestamp(),
        ExpirationDate = toTimestamp('9999-12-31'),
        IsCurrent = true
    ) ~> AddSCDColumns

// Lookup existing records
currentRecords, existingDimension lookup(
        currentRecords@BusinessKey == existingDimension@BusinessKey,
        multiple: false,
        pickup: 'any'
    ) ~> LookupExisting

// Split based on change detection
LookupExisting split(
        isNull(existingDimension@BusinessKey),
        currentRecords@HashKey != existingDimension@HashKey,
        disjoint: true
    ) ~> SplitForSCD @(NewRecords, ChangedRecords, UnchangedRecords)

// New records go directly to insert
SplitForSCD@NewRecords sink() ~> InsertNew

// Changed records: expire old, insert new
SplitForSCD@ChangedRecords derive(
        ExpirationDate = currentTimestamp(),
        IsCurrent = false
    ) ~> ExpireOld

ExpireOld sink(
        updateCondition: true
    ) ~> UpdateExpired

SplitForSCD@ChangedRecords sink() ~> InsertChanged
```

## ARM Template for Data Flow

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "resources": [
        {
            "type": "Microsoft.DataFactory/factories/dataflows",
            "apiVersion": "2018-06-01",
            "name": "[concat(parameters('factoryName'), '/df_sales_transform')]",
            "properties": {
                "type": "MappingDataFlow",
                "typeProperties": {
                    "sources": [
                        {
                            "dataset": {
                                "referenceName": "ds_sales_raw",
                                "type": "DatasetReference"
                            },
                            "name": "SalesSource"
                        }
                    ],
                    "sinks": [
                        {
                            "dataset": {
                                "referenceName": "ds_sales_curated",
                                "type": "DatasetReference"
                            },
                            "name": "SalesSink"
                        }
                    ],
                    "transformations": [
                        {
                            "name": "DeriveColumns",
                            "description": "Calculate derived columns"
                        },
                        {
                            "name": "FilterRecords",
                            "description": "Remove invalid records"
                        },
                        {
                            "name": "AggregateData",
                            "description": "Aggregate by dimensions"
                        }
                    ],
                    "script": "source(output(...)) ~> SalesSource\nSalesSource derive(...) ~> DeriveColumns\nDeriveColumns filter(...) ~> FilterRecords\nFilterRecords aggregate(...) ~> AggregateData\nAggregateData sink(...) ~> SalesSink"
                }
            }
        }
    ]
}
```

## Pipeline Integration

Integrate data flows into ADF pipelines:

```json
{
    "name": "pipeline_sales_etl",
    "properties": {
        "activities": [
            {
                "name": "Run Sales Data Flow",
                "type": "ExecuteDataFlow",
                "dependsOn": [],
                "policy": {
                    "timeout": "1.00:00:00",
                    "retry": 3,
                    "retryIntervalInSeconds": 30
                },
                "typeProperties": {
                    "dataflow": {
                        "referenceName": "df_sales_transform",
                        "type": "DataFlowReference"
                    },
                    "compute": {
                        "coreCount": 8,
                        "computeType": "General"
                    },
                    "traceLevel": "Fine",
                    "runConcurrently": true,
                    "continueOnError": false
                }
            },
            {
                "name": "Log Success",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "Run Sales Data Flow",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "sp_LogPipelineExecution",
                    "storedProcedureParameters": {
                        "Status": {"value": "Success"},
                        "RowsProcessed": {
                            "value": "@activity('Run Sales Data Flow').output.runStatus.metrics.sink1.rowsWritten",
                            "type": "Int32"
                        }
                    }
                }
            }
        ]
    }
}
```

## Performance Optimization

### Partitioning Strategies

```dataflow
// Hash partitioning
source ~> Source1
Source1 sink(
        partitionBy('hash', 10, CustomerId)
    ) ~> Sink1

// Round-robin partitioning
source ~> Source1
Source1 sink(
        partitionBy('roundRobin', 8)
    ) ~> Sink1

// Key-based partitioning
source ~> Source1
Source1 sink(
        partitionBy('key', 0, Year, Month)
    ) ~> Sink1
```

### Caching for Lookups

```dataflow
// Small dimension table - broadcast join
smallDimension cache(
        cacheMode: 'single'
    ) ~> CachedDimension

largeFactTable, CachedDimension lookup(
        FactKey == DimKey,
        broadcast: 'auto'
    ) ~> JoinWithCache
```

## Monitoring Data Flow Execution

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.datafactory import DataFactoryManagementClient
import pandas as pd

def get_dataflow_run_metrics(subscription_id, resource_group, factory_name, run_id):
    """Get detailed metrics for a data flow run."""

    credential = DefaultAzureCredential()
    client = DataFactoryManagementClient(credential, subscription_id)

    # Get pipeline run
    run = client.pipeline_runs.get(
        resource_group_name=resource_group,
        factory_name=factory_name,
        run_id=run_id
    )

    # Get activity runs
    activities = client.activity_runs.query_by_pipeline_run(
        resource_group_name=resource_group,
        factory_name=factory_name,
        run_id=run_id,
        filter_parameters={}
    )

    metrics = []
    for activity in activities.value:
        if activity.activity_type == "ExecuteDataFlow":
            output = activity.output
            if output and "runStatus" in output:
                run_status = output["runStatus"]
                metrics.append({
                    "activity": activity.activity_name,
                    "status": activity.status,
                    "duration": activity.duration_in_ms,
                    "rowsRead": run_status.get("metrics", {}).get("source1", {}).get("rowsRead"),
                    "rowsWritten": run_status.get("metrics", {}).get("sink1", {}).get("rowsWritten"),
                    "profile": run_status.get("profile", {})
                })

    return pd.DataFrame(metrics)

# Usage
metrics_df = get_dataflow_run_metrics(
    "subscription-id",
    "rg-datafactory",
    "adf-demo",
    "run-id-12345"
)
print(metrics_df)
```

## Best Practices

1. **Enable data flow debug** during development for quick iterations
2. **Use appropriate cluster size** based on data volume
3. **Partition large datasets** for optimal parallel processing
4. **Cache small lookup tables** to avoid shuffle operations
5. **Monitor execution metrics** to identify bottlenecks
6. **Use parameterization** for reusable data flows

## Conclusion

Mapping Data Flows in Azure Data Factory democratize data transformation by providing a visual interface backed by Spark's distributed computing power. Whether you're performing simple transformations or complex slowly changing dimension logic, data flows can handle it without requiring Spark expertise.

Start with simple transformations and gradually add complexity as you become comfortable with the visual designer and data flow script syntax.
