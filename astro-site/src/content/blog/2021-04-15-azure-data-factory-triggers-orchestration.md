---
title: Azure Data Factory Triggers - Orchestrating Data Pipelines
description: "ADF trigger design is where data pipeline reliability is won or lost. Schedule triggers are obvious—run at midnight, run every hour—but the interesting…"
author: Michael John Peña
draft: false
date: 2021-04-15
url: /blog/azure-data-factory-triggers-orchestration/
tags:
  - Azure
  - Data Factory
  - ETL
  - Data Orchestration
  - Automation
---

ADF trigger design is where data pipeline reliability is won or lost. Schedule triggers are obvious—run at midnight, run every hour—but the interesting trigger types are Tumbling Window (for backfill and gap-free time windows with dependency tracking) and Event-based (blob created in a container, storage event, custom event from Event Grid). Tumbling Window triggers have a concurrency and delay configuration that lets you parallelise backfill without overwhelming downstream systems. The gotcha I hit repeatedly: using a schedule trigger for a pipeline that should use a tumbling window, then discovering there's no easy way to recover a missed execution window. Plan for recovery before you need it.

## Types of Triggers

ADF supports four trigger types:

1. **Schedule Trigger** - Time-based execution
2. **Tumbling Window Trigger** - Time-sliced processing with dependencies
3. **Event Trigger** - Blob storage events
4. **Custom Event Trigger** - Event Grid custom events

## Schedule Triggers

### Basic Schedule Trigger

```json
{
  "name": "DailyETLTrigger",
  "type": "ScheduleTrigger",
  "typeProperties": {
    "recurrence": {
      "frequency": "Day",
      "interval": 1,
      "startTime": "2021-04-15T02:00:00Z",
      "endTime": "2022-04-15T02:00:00Z",
      "timeZone": "UTC"
    }
  },
  "pipelines": [
    {
      "pipelineReference": {
        "referenceName": "DailyDataIngestion",
        "type": "PipelineReference"
      },
      "parameters": {
        "ProcessDate": "@trigger().scheduledTime"
      }
    }
  ]
}
```

### Complex Schedule Patterns

```json
{
  "name": "BusinessHoursETL",
  "type": "ScheduleTrigger",
  "typeProperties": {
    "recurrence": {
      "frequency": "Week",
      "interval": 1,
      "startTime": "2021-04-15T09:00:00",
      "timeZone": "Eastern Standard Time",
      "schedule": {
        "hours": [9, 12, 15, 18],
        "minutes": [0],
        "weekDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
      }
    }
  }
}
```

### Multiple Pipelines from One Trigger

```json
{
  "name": "MorningBatchTrigger",
  "type": "ScheduleTrigger",
  "typeProperties": {
    "recurrence": {
      "frequency": "Day",
      "interval": 1,
      "startTime": "2021-04-15T06:00:00Z",
      "timeZone": "UTC"
    }
  },
  "pipelines": [
    {
      "pipelineReference": {
        "referenceName": "SalesDataPipeline",
        "type": "PipelineReference"
      }
    },
    {
      "pipelineReference": {
        "referenceName": "InventoryDataPipeline",
        "type": "PipelineReference"
      }
    },
    {
      "pipelineReference": {
        "referenceName": "CustomerDataPipeline",
        "type": "PipelineReference"
      }
    }
  ]
}
```

## Tumbling Window Triggers

Tumbling windows provide non-overlapping, contiguous time intervals - perfect for processing data in time slices.

### Basic Tumbling Window

```json
{
  "name": "HourlyProcessingTrigger",
  "type": "TumblingWindowTrigger",
  "typeProperties": {
    "frequency": "Hour",
    "interval": 1,
    "startTime": "2021-04-15T00:00:00Z",
    "delay": "00:15:00",
    "maxConcurrency": 10,
    "retryPolicy": {
      "count": 3,
      "intervalInSeconds": 30
    }
  },
  "pipeline": {
    "pipelineReference": {
      "referenceName": "HourlyAggregation",
      "type": "PipelineReference"
    },
    "parameters": {
      "WindowStart": "@trigger().outputs.windowStartTime",
      "WindowEnd": "@trigger().outputs.windowEndTime"
    }
  }
}
```

### Tumbling Window with Dependencies

```json
{
  "name": "DailyReportTrigger",
  "type": "TumblingWindowTrigger",
  "typeProperties": {
    "frequency": "Day",
    "interval": 1,
    "startTime": "2021-04-15T00:00:00Z",
    "delay": "02:00:00",
    "maxConcurrency": 1,
    "dependsOn": [
      {
        "type": "TumblingWindowTriggerDependencyReference",
        "referenceTrigger": {
          "referenceName": "HourlyProcessingTrigger",
          "type": "TriggerReference"
        },
        "offset": "-1.00:00:00",
        "size": "1.00:00:00"
      }
    ]
  }
}
```

### Self-Dependency (Sequential Processing)

```json
{
  "name": "SequentialBatchTrigger",
  "type": "TumblingWindowTrigger",
  "typeProperties": {
    "frequency": "Hour",
    "interval": 1,
    "startTime": "2021-04-15T00:00:00Z",
    "maxConcurrency": 1,
    "dependsOn": [
      {
        "type": "SelfDependencyTumblingWindowTriggerReference",
        "offset": "-01:00:00",
        "size": "01:00:00"
      }
    ]
  }
}
```

## Event Triggers (Blob Storage)

### Blob Created Trigger

```json
{
  "name": "NewFilesTrigger",
  "type": "BlobEventsTrigger",
  "typeProperties": {
    "blobPathBeginsWith": "/raw/incoming/",
    "blobPathEndsWith": ".csv",
    "ignoreEmptyBlobs": true,
    "scope": "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{storage-account}",
    "events": ["Microsoft.Storage.BlobCreated"]
  },
  "pipelines": [
    {
      "pipelineReference": {
        "referenceName": "ProcessNewFile",
        "type": "PipelineReference"
      },
      "parameters": {
        "FileName": "@triggerBody().fileName",
        "FolderPath": "@triggerBody().folderPath"
      }
    }
  ]
}
```

### Blob Deleted Trigger

```json
{
  "name": "FileDeletedTrigger",
  "type": "BlobEventsTrigger",
  "typeProperties": {
    "blobPathBeginsWith": "/processed/",
    "scope": "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{storage-account}",
    "events": ["Microsoft.Storage.BlobDeleted"]
  },
  "pipelines": [
    {
      "pipelineReference": {
        "referenceName": "HandleDeletedFile",
        "type": "PipelineReference"
      }
    }
  ]
}
```

## Custom Event Triggers

For integration with Event Grid topics:

```json
{
  "name": "OrderEventTrigger",
  "type": "CustomEventsTrigger",
  "typeProperties": {
    "scope": "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.EventGrid/topics/order-events",
    "events": [
      {
        "eventType": "Orders.OrderCreated"
      },
      {
        "eventType": "Orders.OrderUpdated"
      }
    ],
    "subjectBeginsWith": "orders/",
    "subjectEndsWith": ""
  },
  "pipelines": [
    {
      "pipelineReference": {
        "referenceName": "ProcessOrderEvent",
        "type": "PipelineReference"
      },
      "parameters": {
        "EventType": "@triggerBody().eventType",
        "EventData": "@triggerBody().data"
      }
    }
  ]
}
```

## Pipeline Parameters from Triggers

### Accessing Trigger Information

```json
{
  "pipeline": {
    "parameters": {
      "TriggerName": "@trigger().name",
      "TriggerTime": "@trigger().startTime",
      "ScheduledTime": "@trigger().scheduledTime",
      "TriggerType": "@trigger().type"
    }
  }
}
```

### Tumbling Window Parameters

```json
{
  "parameters": {
    "WindowStart": "@trigger().outputs.windowStartTime",
    "WindowEnd": "@trigger().outputs.windowEndTime",
    "WindowStartFormatted": "@formatDateTime(trigger().outputs.windowStartTime, 'yyyy-MM-dd')"
  }
}
```

### Blob Event Parameters

```json
{
  "parameters": {
    "FileName": "@triggerBody().fileName",
    "FolderPath": "@triggerBody().folderPath",
    "FileUrl": "@triggerBody().fileUrl",
    "ContentType": "@triggerBody().contentType",
    "EventType": "@triggerBody().eventType"
  }
}
```

## Managing Triggers with PowerShell

```powershell
# Get trigger
$trigger = Get-AzDataFactoryV2Trigger `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -TriggerName "DailyETLTrigger"

# Start trigger
Start-AzDataFactoryV2Trigger `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -TriggerName "DailyETLTrigger"

# Stop trigger
Stop-AzDataFactoryV2Trigger `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -TriggerName "DailyETLTrigger"

# Get trigger runs
Get-AzDataFactoryV2TriggerRun `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -TriggerName "DailyETLTrigger" `
    -TriggerRunStartedAfter "2021-04-01" `
    -TriggerRunStartedBefore "2021-04-15"
```

## Managing Triggers with REST API

```python
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://management.azure.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

base_url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.DataFactory/factories/{factory_name}"

# Create or update trigger
trigger_definition = {
    "properties": {
        "type": "ScheduleTrigger",
        "typeProperties": {
            "recurrence": {
                "frequency": "Day",
                "interval": 1,
                "startTime": "2021-04-15T02:00:00Z"
            }
        },
        "pipelines": [
            {
                "pipelineReference": {
                    "referenceName": "MyPipeline",
                    "type": "PipelineReference"
                }
            }
        ]
    }
}

response = requests.put(
    f"{base_url}/triggers/MyTrigger?api-version=2018-06-01",
    headers=headers,
    json=trigger_definition
)

# Start trigger
response = requests.post(
    f"{base_url}/triggers/MyTrigger/start?api-version=2018-06-01",
    headers=headers
)

# Query trigger runs
query = {
    "lastUpdatedAfter": "2021-04-01T00:00:00Z",
    "lastUpdatedBefore": "2021-04-15T00:00:00Z",
    "filters": [
        {
            "operand": "TriggerName",
            "operator": "Equals",
            "values": ["MyTrigger"]
        }
    ]
}

response = requests.post(
    f"{base_url}/queryTriggerRuns?api-version=2018-06-01",
    headers=headers,
    json=query
)

trigger_runs = response.json()["value"]
```

## Backfill and Rerun Patterns

### Tumbling Window Backfill

```python
def backfill_tumbling_window(factory_client, factory_name, trigger_name, start_time, end_time):
    """Rerun tumbling window trigger for historical data"""

    # Get trigger runs that need reprocessing
    filter_params = {
        "lastUpdatedAfter": start_time.isoformat(),
        "lastUpdatedBefore": end_time.isoformat(),
        "filters": [
            {"operand": "TriggerName", "operator": "Equals", "values": [trigger_name]},
            {"operand": "Status", "operator": "Equals", "values": ["Failed"]}
        ]
    }

    runs = factory_client.trigger_runs.query_by_factory(
        resource_group_name, factory_name, filter_params
    )

    for run in runs.value:
        # Rerun the failed window
        factory_client.trigger_runs.rerun(
            resource_group_name,
            factory_name,
            trigger_name,
            run.run_id
        )
        print(f"Rerun initiated for window: {run.trigger_run_timestamp}")
```

## Monitoring Trigger Execution

### Azure Monitor Alerts

```json
{
  "type": "Microsoft.Insights/metricAlerts",
  "properties": {
    "description": "Alert when trigger fails",
    "severity": 2,
    "enabled": true,
    "scopes": ["/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DataFactory/factories/{factory}"],
    "evaluationFrequency": "PT5M",
    "windowSize": "PT5M",
    "criteria": {
      "odata.type": "Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria",
      "allOf": [
        {
          "name": "TriggerFailedRuns",
          "metricName": "TriggerFailedRuns",
          "operator": "GreaterThan",
          "threshold": 0,
          "timeAggregation": "Total"
        }
      ]
    }
  }
}
```

## Best Practices

1. **Use appropriate trigger types** - Schedule for regular batches, tumbling window for time-sliced processing, events for real-time
2. **Set delays wisely** - Allow time for source data to be complete
3. **Configure retry policies** - Handle transient failures
4. **Monitor trigger runs** - Set up alerts for failures
5. **Use parameters** - Pass trigger context to pipelines
6. **Test thoroughly** - Verify trigger configurations before production
7. **Document dependencies** - Clear understanding of trigger chains

## Conclusion

Azure Data Factory triggers provide flexible orchestration options for your data pipelines. By understanding the differences between schedule, tumbling window, and event triggers, you can design robust data workflows that meet your timing and dependency requirements. The key is choosing the right trigger type for your use case and configuring it properly for reliability.
