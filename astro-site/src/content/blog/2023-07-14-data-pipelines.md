---
title: "Fabric Data Pipelines: Orchestration Patterns"
description: "A Fabric pipeline isn't just a sequence of activities — it's an orchestration layer with conditional branching, parameter passing, loops, and error handling…"
author: Michael John Peña
draft: false
date: 2023-07-14
tags:
  - Microsoft Fabric
  - Data Pipelines
  - Orchestration
  - ETL
---

A Fabric pipeline isn't just a sequence of activities — it's an orchestration layer with conditional branching, parameter passing, loops, and error handling that determines whether your data platform behaves reliably or unexpectedly. The patterns that I find myself implementing for almost every client: a parent pipeline that iterates over a configuration table (entities to process, watermark values) and calls child pipelines for each entity via Execute Pipeline activity; error handling at the activity level with `on failure` dependency conditions that route to a notification or logging activity; and pipeline parameters to make the same pipeline reusable across environments by supplying different connection or path values at invocation time. Getting orchestration right is often the difference between a data platform that runs reliably at 6am and one that someone has to baby-sit every morning.

## Pipeline Orchestration Basics

```python
# Pipeline components
pipeline_components = {
    "activities": "Individual tasks (copy, transform, etc.)",
    "dependencies": "Activity execution order",
    "parameters": "Runtime inputs",
    "variables": "Mutable values within pipeline",
    "triggers": "Execution initiators"
}

# Activity dependency conditions
dependency_conditions = [
    "Succeeded",   # Run if previous succeeded
    "Failed",      # Run if previous failed
    "Completed",   # Run regardless of status
    "Skipped"      # Run if previous was skipped
]
```

## Pattern 1: Sequential Pipeline

```json
{
    "name": "SequentialETL",
    "activities": [
        {
            "name": "ExtractData",
            "type": "Copy",
            "dependsOn": []
        },
        {
            "name": "TransformData",
            "type": "TridentNotebook",
            "dependsOn": [
                {"activity": "ExtractData", "dependencyConditions": ["Succeeded"]}
            ]
        },
        {
            "name": "LoadToWarehouse",
            "type": "Copy",
            "dependsOn": [
                {"activity": "TransformData", "dependencyConditions": ["Succeeded"]}
            ]
        }
    ]
}
```

## Pattern 2: Parallel Execution

```json
{
    "name": "ParallelIngestion",
    "activities": [
        {
            "name": "CopySalesData",
            "type": "Copy",
            "dependsOn": []
        },
        {
            "name": "CopyInventoryData",
            "type": "Copy",
            "dependsOn": []
        },
        {
            "name": "CopyCustomerData",
            "type": "Copy",
            "dependsOn": []
        },
        {
            "name": "MergeAllData",
            "type": "TridentNotebook",
            "dependsOn": [
                {"activity": "CopySalesData", "dependencyConditions": ["Succeeded"]},
                {"activity": "CopyInventoryData", "dependencyConditions": ["Succeeded"]},
                {"activity": "CopyCustomerData", "dependencyConditions": ["Succeeded"]}
            ]
        }
    ]
}
```

## Pattern 3: Conditional Execution

```python
# If-Else pattern for different processing paths
conditional_pipeline = {
    "name": "ConditionalProcessing",
    "parameters": {
        "processType": {"type": "String", "defaultValue": "full"}
    },
    "activities": [
        {
            "name": "CheckProcessType",
            "type": "IfCondition",
            "expression": {
                "value": "@equals(pipeline().parameters.processType, 'incremental')",
                "type": "Expression"
            },
            "ifTrueActivities": [
                {
                    "name": "IncrementalLoad",
                    "type": "Copy",
                    "source": {
                        "query": "SELECT * FROM Orders WHERE ModifiedDate > '@{variables('lastRunDate')}'"
                    }
                }
            ],
            "ifFalseActivities": [
                {
                    "name": "FullLoad",
                    "type": "Copy",
                    "source": {
                        "query": "SELECT * FROM Orders"
                    }
                }
            ]
        }
    ]
}
```

## Pattern 4: Error Handling with Retry

```python
# Robust error handling pattern
error_handling_pipeline = {
    "name": "RobustPipeline",
    "variables": {
        "attempt": {"type": "Integer", "defaultValue": 0},
        "maxAttempts": {"type": "Integer", "defaultValue": 3},
        "success": {"type": "Boolean", "defaultValue": False}
    },
    "activities": [
        {
            "name": "AttemptProcessing",
            "type": "Until",
            "expression": "@or(variables('success'), greaterOrEquals(variables('attempt'), variables('maxAttempts')))",
            "timeout": "01:00:00",
            "activities": [
                {
                    "name": "IncrementAttempt",
                    "type": "SetVariable",
                    "variable": "attempt",
                    "value": "@add(variables('attempt'), 1)"
                },
                {
                    "name": "MainProcess",
                    "type": "Copy",
                    "dependsOn": [{"activity": "IncrementAttempt", "dependencyConditions": ["Succeeded"]}]
                },
                {
                    "name": "MarkSuccess",
                    "type": "SetVariable",
                    "variable": "success",
                    "value": True,
                    "dependsOn": [{"activity": "MainProcess", "dependencyConditions": ["Succeeded"]}]
                },
                {
                    "name": "WaitBeforeRetry",
                    "type": "Wait",
                    "waitTimeInSeconds": 60,
                    "dependsOn": [{"activity": "MainProcess", "dependencyConditions": ["Failed"]}]
                }
            ]
        },
        {
            "name": "HandleFailure",
            "type": "TridentNotebook",
            "notebook": "send_alert",
            "dependsOn": [{"activity": "AttemptProcessing", "dependencyConditions": ["Completed"]}],
            "condition": "@not(variables('success'))"
        }
    ]
}
```

## Pattern 5: Parent-Child Pipelines

```python
# Master pipeline calling child pipelines
master_pipeline = {
    "name": "MasterOrchestrator",
    "activities": [
        {
            "name": "RunIngestion",
            "type": "ExecutePipeline",
            "pipeline": {
                "referenceName": "IngestionPipeline"
            },
            "parameters": {
                "source": "production",
                "date": "@pipeline().parameters.runDate"
            },
            "waitOnCompletion": True
        },
        {
            "name": "RunTransformation",
            "type": "ExecutePipeline",
            "pipeline": {
                "referenceName": "TransformationPipeline"
            },
            "dependsOn": [{"activity": "RunIngestion", "dependencyConditions": ["Succeeded"]}],
            "waitOnCompletion": True
        },
        {
            "name": "RunReporting",
            "type": "ExecutePipeline",
            "pipeline": {
                "referenceName": "ReportingPipeline"
            },
            "dependsOn": [{"activity": "RunTransformation", "dependencyConditions": ["Succeeded"]}],
            "waitOnCompletion": True
        }
    ]
}
```

## Pattern 6: Dynamic Pipeline with Metadata

```python
# Metadata-driven pipeline
metadata_driven = {
    "name": "MetadataDrivenPipeline",
    "activities": [
        {
            "name": "GetTableConfig",
            "type": "Lookup",
            "source": {
                "type": "LakehouseSource",
                "table": "config.table_metadata"
            },
            "firstRowOnly": False
        },
        {
            "name": "ProcessEachTable",
            "type": "ForEach",
            "items": "@activity('GetTableConfig').output.value",
            "isSequential": False,
            "batchCount": 10,
            "activities": [
                {
                    "name": "CopyTable",
                    "type": "Copy",
                    "source": {
                        "type": "@{item().source_type}",
                        "query": "@{item().source_query}"
                    },
                    "sink": {
                        "type": "LakehouseSink",
                        "tableOption": "@{item().target_table}"
                    }
                }
            ],
            "dependsOn": [{"activity": "GetTableConfig", "dependencyConditions": ["Succeeded"]}]
        }
    ]
}

# Metadata table structure:
"""
CREATE TABLE config.table_metadata (
    table_name STRING,
    source_type STRING,
    source_connection STRING,
    source_query STRING,
    target_table STRING,
    load_type STRING,
    is_active BOOLEAN
)
"""
```

## Scheduling and Triggers

```python
# Schedule trigger
schedule_trigger = {
    "name": "DailySchedule",
    "type": "ScheduleTrigger",
    "properties": {
        "recurrence": {
            "frequency": "Day",
            "interval": 1,
            "startTime": "2023-07-01T06:00:00Z",
            "timeZone": "UTC"
        },
        "pipelines": [
            {
                "pipelineReference": "DailyETLPipeline",
                "parameters": {
                    "runDate": "@trigger().scheduledTime"
                }
            }
        ]
    }
}

# Manual trigger via UI
# Click "Run" in pipeline editor
# Pass parameters at runtime
```

## Monitoring and Debugging

```python
# Key monitoring metrics
monitoring = {
    "pipeline_runs": {
        "status": ["Succeeded", "Failed", "Cancelled", "InProgress"],
        "duration": "Total execution time",
        "start_time": "When pipeline started",
        "end_time": "When pipeline completed"
    },
    "activity_runs": {
        "status": "Individual activity status",
        "duration": "Activity execution time",
        "input": "Activity input data",
        "output": "Activity output/result",
        "error": "Error details if failed"
    }
}

# Debugging tips:
# 1. Use Debug mode for testing
# 2. Check activity outputs
# 3. Review error messages
# 4. Add logging activities
# 5. Test with sample data first
```

## Pipeline Best Practices

```python
best_practices = {
    "naming": "Use consistent, descriptive names",
    "modularity": "Break large pipelines into smaller ones",
    "parameters": "Use parameters for environment flexibility",
    "error_handling": "Always implement failure paths",
    "logging": "Add activities to log key events",
    "testing": "Use debug mode before scheduling",
    "documentation": "Add descriptions to activities",
    "monitoring": "Set up alerts for failures"
}

# Example: Well-structured pipeline naming
naming_examples = {
    "pipelines": [
        "pl_sales_daily_ingestion",
        "pl_inventory_incremental_load",
        "pl_master_orchestrator"
    ],
    "activities": [
        "act_copy_orders_to_bronze",
        "act_transform_orders_silver",
        "act_check_data_quality"
    ]
}
```

Tomorrow we'll explore the Fabric Warehouse and its T-SQL capabilities.

## Resources

- [Data Pipeline Documentation](https://learn.microsoft.com/en-us/fabric/data-factory/pipeline-overview)
- [Pipeline Activities](https://learn.microsoft.com/en-us/fabric/data-factory/activity-overview)
- [Pipeline Monitoring](https://learn.microsoft.com/en-us/fabric/data-factory/monitor-pipeline)
