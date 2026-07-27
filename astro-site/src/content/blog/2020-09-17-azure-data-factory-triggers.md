---
title: "Azure Data Factory Triggers: Scheduling and Event-Driven Pipelines"
author: Michael John Peña
draft: false
date: 2020-09-17
tags:
  - Azure
  - Data Factory
  - ETL
  - Scheduling
---

A Data Factory pipeline without a trigger is a stored procedure that nobody calls. Triggers are the boring half of orchestration that decides whether your pipelines actually do anything — and which trigger you pick affects everything from cost to reliability to how you handle late-arriving data. Schedule, tumbling window, and event-based each have a sweet spot, and confusing them is one of the most common ADF design mistakes I see in client projects.

## Trigger Types

### 1. Schedule Trigger

Run at specific times:

```json
{
  "name": "DailyTrigger",
  "type": "ScheduleTrigger",
  "typeProperties": {
    "recurrence": {
      "frequency": "Day",
      "interval": 1,
      "startTime": "2020-09-17T02:00:00Z",
      "timeZone": "AUS Eastern Standard Time"
    }
  },
  "pipelines": [
    {"pipelineReference": {"referenceName": "DailyETL"}}
  ]
}
```

### 2. Tumbling Window Trigger

For backfill and catch-up scenarios:

```json
{
  "name": "HourlyTumbling",
  "type": "TumblingWindowTrigger",
  "typeProperties": {
    "frequency": "Hour",
    "interval": 1,
    "startTime": "2020-09-01T00:00:00Z",
    "delay": "00:15:00",
    "maxConcurrency": 10,
    "retryPolicy": {
      "count": 3,
      "intervalInSeconds": 300
    }
  }
}
```

The tumbling window:
- Guarantees each window runs exactly once
- Supports dependencies between windows
- Handles catch-up automatically

### 3. Event Trigger (Storage Events)

React to blob creation:

```json
{
  "name": "BlobCreatedTrigger",
  "type": "BlobEventsTrigger",
  "typeProperties": {
    "blobPathBeginsWith": "/raw/sales/",
    "blobPathEndsWith": ".csv",
    "events": ["Microsoft.Storage.BlobCreated"],
    "scope": "/subscriptions/.../storageAccounts/mydatalake"
  }
}
```

### 4. Custom Event Trigger

Trigger from Event Grid custom events:

```json
{
  "type": "CustomEventsTrigger",
  "typeProperties": {
    "subjectBeginsWith": "orders/",
    "events": [{"eventType": "OrderReceived"}],
    "scope": "/subscriptions/.../topics/myEventGridTopic"
  }
}
```

## Passing Trigger Context to Pipeline

```json
{
  "pipelines": [{
    "pipelineReference": {"referenceName": "ProcessFile"},
    "parameters": {
      "fileName": "@trigger().outputs.body.fileName",
      "folderPath": "@trigger().outputs.body.folderPath"
    }
  }]
}
```

Choose the right trigger: Schedule for time-based, Tumbling Window for sequential windows, Event for reactive processing.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
