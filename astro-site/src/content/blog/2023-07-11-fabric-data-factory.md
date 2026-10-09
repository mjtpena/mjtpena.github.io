---
title: "Fabric Data Factory: Data Integration Reimagined"
author: Michael John Peña
draft: false
date: 2023-07-11
tags:
  - Microsoft Fabric
  - Data Factory
  - ETL
  - Data Integration
---

## Data Factory in Fabric Overview

```python
# Fabric Data Factory components
data_factory_components = {
    "data_pipelines": "Orchestration and workflow",
    "dataflow_gen2": "Power Query-based transformations",
    "copy_activity": "Data movement between sources"
}

# Key differences from Azure Data Factory:
differences = {
    "deployment": "SaaS (no ARM resources)",
    "storage": "Native OneLake integration",
    "compute": "Fabric capacity (CU-based)",
    "linked_services": "Simplified connection management",
    "monitoring": "Unified Fabric monitoring"
}
```

## Creating a Data Pipeline

### Basic Pipeline Structure

```python
# In your workspace:
# 1. Click "+ New" > "Data pipeline"
# 2. Name your pipeline (e.g., "daily_sales_ingestion")

# Pipeline components:
pipeline_structure = {
    "activities": [
        "Copy data",
        "Dataflow",
        "Notebook",
        "Stored procedure",
        "Wait",
        "Set variable",
        "If condition",
        "ForEach",
        "Until"
    ],
    "parameters": "Runtime values passed to pipeline",
    "variables": "Pipeline-scoped mutable values",
    "triggers": "Schedule or event-based execution"
}
```

### Simple Copy Pipeline Example

```json
{
    "name": "CopySalesData",
    "activities": [
        {
            "name": "CopyFromSQL",
            "type": "Copy",
            "inputs": [
                {
                    "source": {
                        "type": "AzureSqlSource",
                        "query": "SELECT * FROM Sales.Orders WHERE ModifiedDate > @{pipeline().parameters.lastRunDate}"
                    }
                }
            ],
            "outputs": [
                {
                    "sink": {
                        "type": "LakehouseSink",
                        "tableOption": "Tables/sales_raw"
                    }
                }
            ]
        }
    ],
    "parameters": {
        "lastRunDate": {
            "type": "String",
            "defaultValue": "2023-01-01"
        }
    }
}
```

## Data Sources and Connections

```python
# Fabric supports numerous data sources
supported_sources = {
    "cloud_databases": [
        "Azure SQL Database",
        "Azure Synapse Analytics",
        "Azure Cosmos DB",
        "Amazon RDS",
        "Google BigQuery"
    ],
    "cloud_storage": [
        "Azure Blob Storage",
        "Azure Data Lake Gen2",
        "Amazon S3",
        "Google Cloud Storage"
    ],
    "on_premises": [
        "SQL Server",
        "Oracle",
        "MySQL",
        "PostgreSQL",
        "File system"
    ],
    "saas": [
        "Salesforce",
        "Dynamics 365",
        "SharePoint",
        "SAP"
    ],
    "fabric_native": [
        "Lakehouse",
        "Warehouse",
        "KQL Database"
    ]
}

# Creating a connection:
# 1. In pipeline, add Copy activity
# 2. Select source > New connection
# 3. Choose connector type
# 4. Enter credentials
# 5. Test connection
```

## Pipeline Parameters and Variables

```python
# Parameters: Input values at runtime
# Define in pipeline settings

pipeline_parameters = {
    "source_table": "Sales.Orders",
    "start_date": "2023-07-01",
    "end_date": "2023-07-31",
    "incremental": True
}

# Access in expressions:
# @{pipeline().parameters.source_table}
# @{pipeline().parameters.start_date}

# Variables: Mutable values within pipeline
pipeline_variables = {
    "record_count": 0,
    "status": "running",
    "error_message": ""
}

# Set variable activity:
# @{activity('CopyData').output.rowsCopied}
```

## Control Flow Activities

### If Condition

```json
{
    "name": "CheckRecordCount",
    "type": "IfCondition",
    "expression": {
        "value": "@greater(activity('CountRecords').output.firstRow.count, 0)",
        "type": "Expression"
    },
    "ifTrueActivities": [
        {
            "name": "ProcessData",
            "type": "Copy"
        }
    ],
    "ifFalseActivities": [
        {
            "name": "LogNoData",
            "type": "SetVariable"
        }
    ]
}
```

### ForEach Loop

```json
{
    "name": "ProcessEachTable",
    "type": "ForEach",
    "items": {
        "value": "@pipeline().parameters.tableList",
        "type": "Expression"
    },
    "activities": [
        {
            "name": "CopyTable",
            "type": "Copy",
            "inputs": {
                "tableName": "@{item().name}"
            }
        }
    ],
    "isSequential": false,
    "batchCount": 5
}
```

### Until Loop

```json
{
    "name": "WaitForCompletion",
    "type": "Until",
    "expression": {
        "value": "@equals(variables('status'), 'completed')",
        "type": "Expression"
    },
    "timeout": "01:00:00",
    "activities": [
        {
            "name": "CheckStatus",
            "type": "Lookup"
        },
        {
            "name": "UpdateStatus",
            "type": "SetVariable"
        },
        {
            "name": "WaitInterval",
            "type": "Wait",
            "waitTimeInSeconds": 60
        }
    ]
}
```

## Integrating Notebooks

```python
# Call Fabric notebooks from pipelines
notebook_activity = {
    "name": "RunTransformNotebook",
    "type": "TridentNotebook",  # Fabric notebook type
    "notebook": {
        "workspaceId": "@{pipeline().parameters.workspaceId}",
        "notebookId": "transform_notebook"
    },
    "parameters": {
        "input_table": "@{pipeline().parameters.source}",
        "output_table": "@{pipeline().parameters.target}",
        "process_date": "@{utcNow()}"
    }
}

# The notebook receives parameters via dbutils.widgets
# dbutils.widgets.get("input_table")
```

## Error Handling

```python
# Implement error handling patterns

# 1. Activity-level retry
activity_retry = {
    "name": "CopyWithRetry",
    "type": "Copy",
    "policy": {
        "retry": 3,
        "retryIntervalInSeconds": 30,
        "timeout": "00:30:00"
    }
}

# 2. Try-catch pattern using If Condition
# Check activity status in subsequent activities
# @{equals(activity('PreviousActivity').Status, 'Succeeded')}

# 3. Error handling activity
error_handler = {
    "name": "LogError",
    "type": "SetVariable",
    "dependsOn": [
        {
            "activity": "MainProcess",
            "dependencyConditions": ["Failed"]
        }
    ],
    "variables": {
        "error_message": "@{activity('MainProcess').Error.message}"
    }
}
```

## Scheduling Pipelines

```python
# Schedule-based triggers
schedule_trigger = {
    "name": "DailyTrigger",
    "type": "ScheduleTrigger",
    "recurrence": {
        "frequency": "Day",
        "interval": 1,
        "startTime": "2023-07-01T06:00:00Z",
        "timeZone": "UTC"
    },
    "pipelines": [
        {
            "pipelineReference": "DailySalesIngestion",
            "parameters": {
                "runDate": "@trigger().scheduledTime"
            }
        }
    ]
}

# Event-based triggers (preview in Fabric)
# Trigger on file arrival, etc.
```

## Monitoring and Debugging

```python
# Access run history:
# 1. Open pipeline
# 2. Click "View run history"
# 3. Select a run to see details

# Key monitoring views:
monitoring_views = {
    "gantt_view": "Activity timeline and duration",
    "list_view": "Activity status and details",
    "pipeline_json": "Full pipeline definition",
    "activity_output": "Output from each activity"
}

# Debug mode:
# 1. Click "Debug" to run pipeline
# 2. View real-time execution
# 3. Check activity inputs/outputs
# 4. Fix issues and re-run

# Common troubleshooting:
# - Check connection credentials
# - Verify source data exists
# - Review expression syntax
# - Check capacity availability
```

## Best Practices

```python
# 1. Use parameters for flexibility
# 2. Implement error handling
# 3. Log key metrics
# 4. Use meaningful names
# 5. Keep pipelines focused

best_practices = {
    "naming": "Use snake_case, be descriptive",
    "modularity": "Break large pipelines into smaller ones",
    "parameters": "Externalize environment-specific values",
    "logging": "Add activities to log start/end/errors",
    "documentation": "Add descriptions to activities"
}
```

Tomorrow we'll dive deeper into Copy Activity patterns.

## Resources

- [Data Factory in Fabric](https://learn.microsoft.com/en-us/fabric/data-factory/data-factory-overview)
- [Data Pipeline Documentation](https://learn.microsoft.com/en-us/fabric/data-factory/create-first-pipeline)
- [Pipeline Expressions](https://learn.microsoft.com/en-us/azure/data-factory/control-flow-expression-language-functions)
