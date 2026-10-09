---
title: "Real-Time Streaming Analytics with Azure Stream Analytics and Event Hubs"
description: "Enrich streaming data with reference data lookups for context-aware processing and alerting in real-time scenarios."
author: Michael John Peña
draft: false
date: 2025-10-07
tags:
  - Azure Stream Analytics
  - Event Hubs
  - Real-Time Analytics
  - Streaming
  - IoT
---

## Designing Event Hub Partitioning Strategy

Proper partitioning is crucial for performance and ordering guarantees:

```python
from azure.eventhub import EventHubProducerClient, EventData
from azure.identity import DefaultAzureCredential
import json

class StreamingProducer:
    def __init__(self, namespace: str, eventhub_name: str):
        self.client = EventHubProducerClient(
            fully_qualified_namespace=f"{namespace}.servicebus.windows.net",
            eventhub_name=eventhub_name,
            credential=DefaultAzureCredential()
        )
        self.eventhub_name = eventhub_name

    def send_events_with_partition_key(self, events: list[dict], partition_key_field: str):
        """Send events with consistent partition key for ordering."""

        for event in events:
            partition_key = str(event.get(partition_key_field, "default"))

            event_data = EventData(json.dumps(event))
            event_data.properties = {
                "content-type": "application/json",
                "event-type": event.get("type", "unknown")
            }

            batch = self.client.create_batch(partition_key=partition_key)
            batch.add(event_data)
            self.client.send_batch(batch)

    def send_high_throughput_batch(self, events: list[dict]):
        """Send events in optimized batches for high throughput."""

        batch = self.client.create_batch()

        for event in events:
            event_data = EventData(json.dumps(event))
            try:
                batch.add(event_data)
            except ValueError:
                self.client.send_batch(batch)
                batch = self.client.create_batch()
                batch.add(event_data)

        if len(batch) > 0:
            self.client.send_batch(batch)
```

## Stream Analytics Query Patterns

Common streaming patterns in Azure Stream Analytics SQL:

```sql
-- Tumbling window aggregation for metrics
SELECT
    DeviceId,
    System.Timestamp() AS WindowEnd,
    AVG(Temperature) AS AvgTemperature,
    MAX(Temperature) AS MaxTemperature,
    COUNT(*) AS ReadingCount
INTO [temperature-metrics]
FROM [sensor-events]
TIMESTAMP BY EventTime
GROUP BY DeviceId, TumblingWindow(minute, 5)

-- Session window for user activity
SELECT
    UserId,
    MIN(EventTime) AS SessionStart,
    MAX(EventTime) AS SessionEnd,
    DATEDIFF(second, MIN(EventTime), MAX(EventTime)) AS SessionDurationSec,
    COUNT(*) AS EventCount
INTO [user-sessions]
FROM [clickstream-events]
TIMESTAMP BY EventTime
GROUP BY UserId, SessionWindow(minute, 5, 30)
```

## Reference Data Joins

Enrich streaming data with reference data lookups for context-aware processing and alerting in real-time scenarios.
