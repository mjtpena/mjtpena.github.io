---
title: "Data Factory in Microsoft Fabric: Modern Data Integration"
description: "Data Pipelines in Fabric are similar to Azure Data Factory pipelines but with deeper Fabric integration."
author: Michael John Peña
draft: false
date: 2023-05-05
tags:
  - Microsoft Fabric
  - Data Factory
  - ETL
  - Data Integration
  - Pipelines
---

## Data Factory Components in Fabric

Fabric's Data Factory includes two main artifact types:

1. **Data Pipelines**: Orchestration workflows for data movement and transformation
2. **Dataflows Gen2**: Power Query-based data transformation

```
┌─────────────────────────────────────────────────────┐
│              Data Factory in Fabric                  │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐          │
│  │  Data Pipelines │  │  Dataflows Gen2 │          │
│  │                 │  │                 │          │
│  │  - Orchestrate  │  │  - Transform    │          │
│  │  - Copy data    │  │  - Power Query  │          │
│  │  - Call APIs    │  │  - Low-code     │          │
│  │  - Run Spark    │  │  - Citizen dev  │          │
│  └─────────────────┘  └─────────────────┘          │
├─────────────────────────────────────────────────────┤
│                      OneLake                         │
└─────────────────────────────────────────────────────┘
```

## Data Pipelines

Data Pipelines in Fabric are similar to Azure Data Factory pipelines but with deeper Fabric integration.

### Creating a Copy Pipeline

```json
{
  "name": "CopyExternalDataToLakehouse",
  "properties": {
    "activities": [
      {
        "name": "CopySalesData",
        "type": "Copy",
        "inputs": [
          {
            "type": "AzureBlobStorageDataset",
            "linkedService": "ExternalBlobStorage",
            "path": "sales/*.csv"
          }
        ],
        "outputs": [
          {
            "type": "LakehouseTable",
            "lakehouse": "SalesLakehouse",
            "table": "raw_sales"
          }
        ],
        "typeProperties": {
          "source": {
            "type": "DelimitedTextSource"
          },
          "sink": {
            "type": "LakehouseSink",
            "tableActionOption": "Append"
          }
        }
      }
    ]
  }
}
```

### Orchestrating Fabric Workloads

```json
{
  "name": "EndToEndDataPipeline",
  "properties": {
    "activities": [
      {
        "name": "CopyRawData",
        "type": "Copy",
        "typeProperties": {
          "source": { "type": "SqlServerSource" },
          "sink": { "type": "LakehouseTableSink" }
        }
      },
      {
        "name": "TransformWithNotebook",
        "type": "NotebookActivity",
        "dependsOn": [
          {
            "activity": "CopyRawData",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "notebook": {
            "referenceName": "TransformSalesData",
            "type": "NotebookReference"
          },
          "parameters": {
            "input_table": "raw_sales",
            "output_table": "curated_sales"
          }
        }
      },
      {
        "name": "RefreshSemanticModel",
        "type": "SemanticModelRefresh",
        "dependsOn": [
          {
            "activity": "TransformWithNotebook",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "semanticModel": "Sales Analytics Model"
        }
      }
    ]
  }
}
```

### Pipeline Parameters and Variables

```python
# In a Notebook activity, access pipeline parameters
from notebookutils import mssparkutils

# Get pipeline parameters
input_table = mssparkutils.notebook.run_context["parameters"]["input_table"]
output_table = mssparkutils.notebook.run_context["parameters"]["output_table"]

# Process data
df = spark.read.format("delta").table(input_table)
# ... transformation logic ...
df.write.format("delta").mode("overwrite").saveAsTable(output_table)
```

## Dataflows Gen2

Dataflows Gen2 provide a low-code transformation experience using Power Query:

```m
// Power Query M code for Dataflow Gen2
let
    // Connect to source
    Source = Sql.Database("server.database.windows.net", "SalesDB"),

    // Select table
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Filter recent data
    FilteredRows = Table.SelectRows(Sales, each [OrderDate] > #date(2023, 1, 1)),

    // Add calculated columns
    AddedColumns = Table.AddColumn(FilteredRows, "TotalAmount",
        each [Quantity] * [UnitPrice], type number),

    // Group by region
    GroupedRows = Table.Group(AddedColumns, {"Region"}, {
        {"TotalSales", each List.Sum([TotalAmount]), type number},
        {"OrderCount", each Table.RowCount(_), Int64.Type}
    }),

    // Sort results
    SortedRows = Table.Sort(GroupedRows, {{"TotalSales", Order.Descending}})
in
    SortedRows

// Output: Lakehouse > Tables > regional_sales_summary
```

### Dataflow Gen2 Features

```m
// Staging with Lakehouse
// Dataflows Gen2 can use Lakehouse for staging, improving performance

// Enable staging in dataflow settings:
// - Staging Lakehouse: "StagingLakehouse"
// - Staging location: "Files/dataflow_staging/"

// This enables:
// - Faster query folding
// - Incremental refresh
// - Better performance for large datasets
```

## Key Differences from Azure Data Factory

| Feature | Azure Data Factory | Fabric Data Factory |
|---------|-------------------|---------------------|
| Linked Services | Manual configuration | Simplified with OneLake |
| Datasets | Required for each source/sink | Often implicit |
| Integration Runtime | Self-hosted or Azure | Fabric-managed |
| Monitoring | Azure Monitor | Fabric Monitoring Hub |
| Pricing | Per activity + DIU | Included in capacity |

## Common Pipeline Patterns

### Pattern 1: Incremental Load

```json
{
  "name": "IncrementalLoadPipeline",
  "properties": {
    "activities": [
      {
        "name": "GetLastWatermark",
        "type": "Lookup",
        "typeProperties": {
          "source": {
            "type": "SqlSource",
            "sqlReaderQuery": "SELECT MAX(ModifiedDate) as LastWatermark FROM watermarks WHERE TableName = 'Sales'"
          }
        }
      },
      {
        "name": "CopyIncrementalData",
        "type": "Copy",
        "dependsOn": [{"activity": "GetLastWatermark", "dependencyConditions": ["Succeeded"]}],
        "typeProperties": {
          "source": {
            "type": "SqlSource",
            "sqlReaderQuery": {
              "value": "SELECT * FROM Sales WHERE ModifiedDate > '@{activity('GetLastWatermark').output.firstRow.LastWatermark}'",
              "type": "Expression"
            }
          },
          "sink": {
            "type": "LakehouseSink",
            "tableActionOption": "Append"
          }
        }
      },
      {
        "name": "UpdateWatermark",
        "type": "SqlServerStoredProcedure",
        "dependsOn": [{"activity": "CopyIncrementalData", "dependencyConditions": ["Succeeded"]}],
        "typeProperties": {
          "storedProcedureName": "UpdateWatermark",
          "storedProcedureParameters": {
            "TableName": "Sales",
            "Watermark": "@{utcnow()}"
          }
        }
      }
    ]
  }
}
```

### Pattern 2: Dynamic Pipeline with ForEach

```json
{
  "name": "DynamicTableCopy",
  "properties": {
    "parameters": {
      "tables": {
        "type": "array",
        "defaultValue": ["customers", "orders", "products"]
      }
    },
    "activities": [
      {
        "name": "ForEachTable",
        "type": "ForEach",
        "typeProperties": {
          "items": "@pipeline().parameters.tables",
          "isSequential": false,
          "batchCount": 5,
          "activities": [
            {
              "name": "CopyTable",
              "type": "Copy",
              "typeProperties": {
                "source": {
                  "type": "SqlSource",
                  "sqlReaderQuery": "SELECT * FROM @{item()}"
                },
                "sink": {
                  "type": "LakehouseSink",
                  "tableName": "@{item()}"
                }
              }
            }
          ]
        }
      }
    ]
  }
}
```

## Scheduling and Triggers

```python
# Pipelines can be triggered by:
# 1. Schedule triggers
# 2. Event triggers (blob created)
# 3. Manual execution
# 4. API calls

# Example: Schedule trigger configuration
trigger_config = {
    "name": "DailyRefresh",
    "type": "ScheduleTrigger",
    "recurrence": {
        "frequency": "Day",
        "interval": 1,
        "startTime": "2023-05-05T06:00:00Z",
        "timeZone": "UTC"
    },
    "pipelines": [
        {"pipelineReference": "EndToEndDataPipeline"}
    ]
}
```

Data Factory in Fabric provides familiar orchestration capabilities with deeper integration into the unified platform. Tomorrow, I will cover Synapse Data Engineering for Spark-based workloads.

## Resources

- [Data Factory in Fabric](https://learn.microsoft.com/en-us/fabric/data-factory/)
- [Data Pipelines Tutorial](https://learn.microsoft.com/en-us/fabric/data-factory/create-first-pipeline-with-sample-data)
- [Dataflows Gen2](https://learn.microsoft.com/en-us/fabric/data-factory/create-first-dataflow-gen2)
