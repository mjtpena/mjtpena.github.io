---
title: Visual ETL with Azure Synapse Data Flows
author: Michael John Pena
draft: false
date: 2021-03-10
url: /blog/synapse-data-flows/
tags:
  - Azure
  - Synapse
  - ETL
  - Data Engineering
  - Spark
---

## Understanding Data Flows

Data flows in Synapse run on Spark clusters and offer:
- Visual drag-and-drop interface
- 80+ built-in transformations
- Schema drift handling
- Data preview and debugging
- Code generation for advanced scenarios

## Creating a Data Flow

### Source Configuration

```json
{
  "name": "SalesDataFlow",
  "properties": {
    "type": "MappingDataFlow",
    "typeProperties": {
      "sources": [
        {
          "dataset": {
            "referenceName": "DelimitedText_Sales",
            "type": "DatasetReference"
          },
          "name": "SalesSource",
          "description": "Read sales data from CSV files"
        }
      ]
    }
  }
}
```

### Transformation Examples

#### Filter Transformation

Filter rows based on conditions:

```
// Data flow expression for filtering
filter(
    Year >= 2020 &&
    TotalAmount > 0 &&
    !isNull(CustomerID)
)
```

#### Derived Column

Create calculated columns:

```
// Calculate profit margin
ProfitMargin = (TotalAmount - Cost) / TotalAmount * 100,

// Extract year and month
SalesYear = year(OrderDate),
SalesMonth = month(OrderDate),
SalesQuarter = case(
    month(OrderDate) <= 3, 1,
    month(OrderDate) <= 6, 2,
    month(OrderDate) <= 9, 3,
    4
),

// Customer segment classification
CustomerSegment = case(
    TotalAmount > 10000, 'Premium',
    TotalAmount > 1000, 'Regular',
    'Basic'
)
```

#### Aggregate Transformation

Perform aggregations:

```
// Group by configuration
groupBy(CustomerID, SalesYear, SalesMonth)

// Aggregations
TotalSales = sum(TotalAmount),
OrderCount = count(OrderID),
AvgOrderValue = avg(TotalAmount),
MaxOrderValue = max(TotalAmount),
MinOrderValue = min(TotalAmount),
UniqueProducts = countDistinct(ProductID)
```

#### Join Transformation

Join multiple sources:

```
// Left outer join on customer
join(
    CustomerDim,
    SalesSource@CustomerID == CustomerDim@CustomerKey,
    joinType: 'left'
)

// Lookup join for product data
lookup(
    ProductDim,
    SalesSource@ProductID == ProductDim@ProductKey,
    multiple: false,
    pickup: 'any'
)
```

#### Pivot Transformation

Pivot rows to columns:

```
// Pivot sales by month
pivot(
    groupBy(CustomerID, ProductCategory),
    pivotBy(SalesMonth),
    SalesAmount = sum(TotalAmount)
)
```

#### Unpivot Transformation

Convert columns to rows:

```
// Unpivot monthly columns back to rows
unpivot(
    output(
        Month as string,
        SalesValue as decimal
    ),
    skipDuplicateMapInputs: false,
    skipDuplicateMapOutputs: false,
    Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec
)
```

## Complete Data Flow Example

Here's a complete sales data transformation pipeline:

```
// Source: Read raw sales data
source(
    output(
        TransactionID as string,
        OrderDate as timestamp,
        CustomerID as string,
        ProductID as string,
        Quantity as integer,
        UnitPrice as decimal(18,2),
        Discount as decimal(5,2)
    ),
    allowSchemaDrift: true,
    format: 'delimited',
    columnDelimiter: ',',
    escapeChar: '\\',
    quoteChar: '"',
    columnNamesAsHeader: true
) ~> SalesSource

// Derived: Calculate amounts and date parts
SalesSource derive(
    TotalAmount = Quantity * UnitPrice * (1 - Discount/100),
    NetAmount = Quantity * UnitPrice,
    DiscountAmount = Quantity * UnitPrice * (Discount/100),
    OrderYear = year(OrderDate),
    OrderMonth = month(OrderDate),
    OrderQuarter = ceil(month(OrderDate) / 3.0),
    DayOfWeek = dayOfWeek(OrderDate)
) ~> CalculateAmounts

// Filter: Remove invalid records
CalculateAmounts filter(
    !isNull(CustomerID) &&
    !isNull(ProductID) &&
    TotalAmount > 0
) ~> ValidRecords

// Lookup: Enrich with customer data
ValidRecords, CustomerDim lookup(
    CustomerID == CustomerKey,
    multiple: false,
    pickup: 'any',
    broadcast: 'auto'
) ~> EnrichCustomer

// Lookup: Enrich with product data
EnrichCustomer, ProductDim lookup(
    ProductID == ProductKey,
    multiple: false,
    pickup: 'any',
    broadcast: 'auto'
) ~> EnrichProduct

// Select: Choose final columns
EnrichProduct select(
    TransactionID,
    OrderDate,
    OrderYear,
    OrderMonth,
    OrderQuarter,
    CustomerID,
    CustomerName,
    CustomerSegment,
    CustomerRegion,
    ProductID,
    ProductName,
    Category,
    SubCategory,
    Quantity,
    UnitPrice,
    Discount,
    TotalAmount,
    NetAmount,
    DiscountAmount
) ~> SelectColumns

// Aggregate: Create summary
SelectColumns aggregate(
    groupBy(CustomerID, CustomerName, CustomerSegment, OrderYear, OrderMonth),
    MonthlySales = sum(TotalAmount),
    MonthlyOrders = count(TransactionID),
    AvgOrderValue = avg(TotalAmount),
    TotalQuantity = sum(Quantity),
    UniqueProducts = countDistinct(ProductID)
) ~> MonthlySummary

// Sink: Write to data lake
SelectColumns sink(
    input(
        // schema matches SelectColumns output
    ),
    allowSchemaDrift: true,
    format: 'parquet',
    partitionBy('key', 0, OrderYear, OrderMonth)
) ~> FactSalesSink

// Sink: Write summary to SQL
MonthlySummary sink(
    input(
        // schema matches MonthlySummary output
    ),
    allowSchemaDrift: true,
    truncate: false,
    skipDuplicateMapInputs: true,
    skipDuplicateMapOutputs: true
) ~> SummarySink
```

## Pipeline Integration

Embed data flow in a Synapse pipeline:

```json
{
  "name": "SalesETLPipeline",
  "properties": {
    "activities": [
      {
        "name": "CopyRawData",
        "type": "Copy",
        "dependsOn": [],
        "typeProperties": {
          "source": {
            "type": "BlobSource"
          },
          "sink": {
            "type": "BlobSink"
          }
        }
      },
      {
        "name": "TransformSalesData",
        "type": "ExecuteDataFlow",
        "dependsOn": [
          {
            "activity": "CopyRawData",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "dataFlow": {
            "referenceName": "SalesDataFlow",
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
        "name": "UpdateMetadata",
        "type": "SqlPoolStoredProcedure",
        "dependsOn": [
          {
            "activity": "TransformSalesData",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "storedProcedureName": "dbo.UpdateLoadMetadata"
        }
      }
    ],
    "parameters": {
      "LoadDate": {
        "type": "string",
        "defaultValue": "@utcnow()"
      }
    }
  }
}
```

## Performance Optimization

### Partition Settings

```
// Optimize partitioning for large datasets
optimizedPartitioning = true,
partitionOption = 'Hash',
partitionColumn = 'CustomerID',
numberOfPartitions = 50
```

### Caching Strategy

```
// Cache dimension lookups
lookup(
    DimProduct,
    broadcast: 'fixed'  // Broadcasts smaller dataset
)
```

### Debug Settings

```json
{
  "debugSettings": {
    "sourceSettings": [
      {
        "sourceName": "SalesSource",
        "rowLimit": 1000
      }
    ],
    "parameters": {
      "LoadDate": "2021-03-01"
    }
  }
}
```

## Monitoring Data Flows

```python
# Monitor data flow execution using Synapse SDK
from azure.synapse.artifacts import ArtifactsClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = ArtifactsClient(
    endpoint="https://mysynapse.dev.azuresynapse.net",
    credential=credential
)

# Get pipeline run status
run = client.pipeline_run.get_pipeline_run(
    run_id="<run-id>"
)

print(f"Status: {run.status}")
print(f"Duration: {run.duration_in_ms}ms")

# Get activity runs
activities = client.activity_runs.query_activity_runs_by_pipeline_run(
    pipeline_name="SalesETLPipeline",
    run_id="<run-id>",
    filter_parameters={}
)

for activity in activities.value:
    if activity.activity_type == "ExecuteDataFlow":
        print(f"Data Flow: {activity.activity_name}")
        print(f"Status: {activity.status}")
        print(f"Rows Written: {activity.output.get('runStatus', {}).get('metrics', {})}")
```

## Conclusion

Azure Synapse Data Flows democratize data engineering by providing:

- **Visual development** without Spark expertise required
- **Powerful transformations** for complex ETL scenarios
- **Scalable execution** on managed Spark clusters
- **Integration** with Synapse pipelines and monitoring

Data flows are ideal for:
- Business analysts building transformation logic
- Rapid prototyping of ETL processes
- Teams transitioning from SSIS or similar tools
- Scenarios requiring visual documentation of data lineage
