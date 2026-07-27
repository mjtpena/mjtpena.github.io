---
title: "Fabric Pipelines: Orchestrating Data Workflows"
author: Michael John Peña
draft: false
date: 2023-06-07
tags:
  - Microsoft Fabric
  - Data Pipelines
  - ETL
  - Orchestration
  - Data Factory

---

I wrote "Fabric Pipelines: Orchestrating Data Workflows" to share practical, production-minded guidance on this topic.

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Fabric Pipeline                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │                 Activities                       ││
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          ││
│  │  │ Copy │→│Notebook│→│Stored│→│IfCond │        ││
│  │  │      │ │       │ │ Proc │ │ition  │        ││
│  │  └──────┘ └──────┘ └──────┘ └──────┘          ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Control Flow                        ││
│  │  - ForEach loops                                 ││
│  │  - If conditions                                 ││
│  │  - Until loops                                   ││
│  │  - Switch cases                                  ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Triggers                            ││
│  │  - Schedule                                      ││
│  │  - Event (storage events)                        ││
│  │  - Manual                                        ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Pipeline Definition

```json
{
  "name": "SalesDataPipeline",
  "properties": {
    "activities": [
      {
        "name": "CopyRawData",
        "type": "Copy",
        "dependsOn": [],
        "policy": {
          "timeout": "0.12:00:00",
          "retry": 3,
          "retryIntervalInSeconds": 30
        },
        "typeProperties": {
          "source": {
            "type": "AzureSqlSource",
            "sqlReaderQuery": "SELECT * FROM Sales WHERE ModifiedDate > '@{pipeline().parameters.LastProcessedDate}'"
          },
          "sink": {
            "type": "LakehouseTableSink",
            "tableActionOption": "Append"
          }
        }
      },
      {
        "name": "TransformData",
        "type": "NotebookActivity",
        "dependsOn": [
          {
            "activity": "CopyRawData",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "notebook": {
            "referenceName": "TransformSalesNotebook",
            "type": "NotebookReference"
          },
          "parameters": {
            "process_date": {
              "value": "@pipeline().parameters.ProcessDate",
              "type": "String"
            }
          }
        }
      },
      {
        "name": "RefreshSemanticModel",
        "type": "SemanticModelRefresh",
        "dependsOn": [
          {
            "activity": "TransformData",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "datasetId": "semantic-model-guid"
        }
      }
    ],
    "parameters": {
      "ProcessDate": {
        "type": "String",
        "defaultValue": "@utcNow()"
      },
      "LastProcessedDate": {
        "type": "String"
      }
    }
  }
}
```

## Activity Types

### Copy Activity

```json
{
  "name": "IncrementalCopy",
  "type": "Copy",
  "typeProperties": {
    "source": {
      "type": "AzureSqlSource",
      "sqlReaderQuery": {
        "value": "SELECT * FROM @{pipeline().parameters.TableName} WHERE ModifiedDate > '@{activity('GetWatermark').output.firstRow.LastWatermark}'",
        "type": "Expression"
      }
    },
    "sink": {
      "type": "LakehouseTableSink",
      "tableActionOption": "Append"
    },
    "enableStaging": true,
    "stagingSettings": {
      "linkedServiceName": "StagingStorage"
    }
  }
}
```

### Notebook Activity

```json
{
  "name": "ProcessSales",
  "type": "NotebookActivity",
  "typeProperties": {
    "notebook": {
      "referenceName": "SalesProcessor",
      "type": "NotebookReference"
    },
    "parameters": {
      "source_table": {"value": "bronze_sales", "type": "String"},
      "target_table": {"value": "silver_sales", "type": "String"},
      "business_date": {
        "value": "@formatDateTime(pipeline().parameters.ProcessDate, 'yyyy-MM-dd')",
        "type": "Expression"
      }
    }
  }
}
```

### Stored Procedure Activity

```json
{
  "name": "UpdateWatermark",
  "type": "SqlServerStoredProcedure",
  "typeProperties": {
    "storedProcedureName": "sp_UpdateWatermark",
    "storedProcedureParameters": {
      "TableName": {"value": "@pipeline().parameters.TableName", "type": "String"},
      "NewWatermark": {"value": "@utcNow()", "type": "DateTime"}
    }
  }
}
```

## Control Flow

### ForEach Loop

```json
{
  "name": "ProcessTables",
  "type": "ForEach",
  "typeProperties": {
    "items": {
      "value": "@pipeline().parameters.TableList",
      "type": "Expression"
    },
    "isSequential": false,
    "batchCount": 10,
    "activities": [
      {
        "name": "CopyTable",
        "type": "Copy",
        "typeProperties": {
          "source": {
            "type": "AzureSqlSource",
            "sqlReaderQuery": "SELECT * FROM @{item().TableName}"
          },
          "sink": {
            "type": "LakehouseTableSink",
            "tableName": "@{item().TableName}"
          }
        }
      }
    ]
  }
}
```

### If Condition

```json
{
  "name": "CheckRowCount",
  "type": "IfCondition",
  "typeProperties": {
    "expression": {
      "value": "@greater(activity('CopyData').output.rowsCopied, 0)",
      "type": "Expression"
    },
    "ifTrueActivities": [
      {
        "name": "ProcessNewData",
        "type": "NotebookActivity"
      }
    ],
    "ifFalseActivities": [
      {
        "name": "LogNoData",
        "type": "SetVariable"
      }
    ]
  }
}
```

### Until Loop

```json
{
  "name": "WaitForCompletion",
  "type": "Until",
  "typeProperties": {
    "expression": {
      "value": "@equals(variables('JobStatus'), 'Completed')",
      "type": "Expression"
    },
    "timeout": "0.01:00:00",
    "activities": [
      {
        "name": "CheckStatus",
        "type": "WebActivity",
        "typeProperties": {
          "url": "https://api.example.com/job/@{variables('JobId')}/status",
          "method": "GET"
        }
      },
      {
        "name": "UpdateStatus",
        "type": "SetVariable",
        "typeProperties": {
          "variableName": "JobStatus",
          "value": "@activity('CheckStatus').output.status"
        }
      },
      {
        "name": "Wait30Seconds",
        "type": "Wait",
        "typeProperties": {
          "waitTimeInSeconds": 30
        }
      }
    ]
  }
}
```

## Error Handling

```json
{
  "activities": [
    {
      "name": "ProcessData",
      "type": "NotebookActivity",
      "dependsOn": [],
      "policy": {
        "retry": 2,
        "retryIntervalInSeconds": 60
      }
    },
    {
      "name": "OnSuccess",
      "type": "SetVariable",
      "dependsOn": [
        {"activity": "ProcessData", "dependencyConditions": ["Succeeded"]}
      ],
      "typeProperties": {
        "variableName": "Status",
        "value": "Success"
      }
    },
    {
      "name": "OnFailure",
      "type": "WebActivity",
      "dependsOn": [
        {"activity": "ProcessData", "dependencyConditions": ["Failed"]}
      ],
      "typeProperties": {
        "url": "https://hooks.slack.com/services/xxx",
        "method": "POST",
        "body": {
          "text": "Pipeline @{pipeline().Pipeline} failed: @{activity('ProcessData').error.message}"
        }
      }
    }
  ]
}
```

## Parameterized Pipelines

```python
# Pipeline with dynamic parameters
pipeline_parameters = {
    "environment": {
        "type": "String",
        "defaultValue": "dev",
        "allowed": ["dev", "test", "prod"]
    },
    "tables": {
        "type": "Array",
        "defaultValue": ["sales", "customers", "products"]
    },
    "startDate": {
        "type": "String",
        "defaultValue": "@addDays(utcNow(), -1)"
    },
    "endDate": {
        "type": "String",
        "defaultValue": "@utcNow()"
    },
    "fullLoad": {
        "type": "Bool",
        "defaultValue": False
    }
}

# Using parameters in expressions
# @pipeline().parameters.environment
# @pipeline().parameters.tables
# @if(pipeline().parameters.fullLoad, 'full', 'incremental')
```

## Schedule Triggers

```json
{
  "name": "DailyTrigger",
  "type": "ScheduleTrigger",
  "typeProperties": {
    "recurrence": {
      "frequency": "Day",
      "interval": 1,
      "startTime": "2023-06-01T06:00:00Z",
      "timeZone": "UTC"
    }
  },
  "pipelines": [
    {
      "pipelineReference": {
        "referenceName": "SalesDataPipeline",
        "type": "PipelineReference"
      },
      "parameters": {
        "ProcessDate": "@trigger().scheduledTime"
      }
    }
  ]
}
```

## Monitoring

```python
# Monitor pipeline runs via API
from azure.identity import DefaultAzureCredential
import requests

def get_pipeline_runs(workspace_id: str, pipeline_name: str, days: int = 7):
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/pipelines/{pipeline_name}/runs"

    params = {
        "startTime": (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"
    }

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {token.token}"},
        params=params
    )

    runs = response.json()["value"]

    for run in runs:
        print(f"Run ID: {run['runId']}")
        print(f"  Status: {run['status']}")
        print(f"  Start: {run['runStart']}")
        print(f"  Duration: {run['durationInMs']}ms")
        print()

    return runs
```

Fabric Pipelines enable robust data orchestration with full control flow capabilities. Tomorrow, I will cover Dataflows Gen2.

## Resources

- [Fabric Pipelines](https://learn.microsoft.com/en-us/fabric/data-factory/pipeline-overview)
- [Pipeline Activities](https://learn.microsoft.com/en-us/fabric/data-factory/activity-overview)
- [Pipeline Monitoring](https://learn.microsoft.com/en-us/fabric/data-factory/monitor-pipeline-runs)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
