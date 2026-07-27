---
title: "Fabric Eventstreams Patterns: From Ingestion to Analytics"
author: Michael John Peña
draft: false
date: 2024-01-19
tags:
  - Eventstreams
  - Microsoft Fabric
  - Streaming
  - Event Processing
  - Architecture
---

Eventstreams lets teams deliver streaming analytics without managing complex infra. From deployments I've supported, these patterns make ingestion and routing predictable and observable.

## Core Concepts

### Event Processing Topology

```
Sources (Input)           Processing              Destinations (Output)
───────────────           ──────────              ────────────────────
Azure Event Hubs    ─┐                        ┌─→  KQL Database
Azure IoT Hub       ─┤                        ├─→  Lakehouse
Kafka              ─┼─→  Eventstream  ────────┼─→  Custom Endpoint
Custom App          ─┤    (Transform)         ├─→  Reflex (Alerts)
Sample Data         ─┘                        └─→  Derived Stream
```

## Pattern 1: Simple Passthrough

For basic ingestion without transformation:

```json
{
  "name": "simple-passthrough",
  "source": {
    "type": "AzureEventHubs",
    "eventHubNamespace": "my-namespace",
    "eventHubName": "raw-events",
    "consumerGroup": "$Default"
  },
  "destinations": [
    {
      "type": "KqlDatabase",
      "database": "TelemetryDB",
      "table": "RawEvents",
      "mappingName": "RawEventsMapping"
    },
    {
      "type": "Lakehouse",
      "lakehouse": "RawDataLake",
      "table": "raw_events",
      "format": "Delta"
    }
  ]
}
```

## Pattern 2: Filter and Route

Route events to different destinations based on content:

```sql
-- Eventstream transformation SQL

-- Route high-priority events to alerts
SELECT *
INTO AlertsDestination
FROM InputStream
WHERE priority = 'HIGH' OR severity > 8

-- Route normal events to analytics
SELECT *
INTO AnalyticsDestination
FROM InputStream
WHERE priority != 'HIGH' AND severity <= 8

-- Route error events to error handling
SELECT *
INTO ErrorsDestination
FROM InputStream
WHERE eventType = 'ERROR'
```

```python
# Python representation of routing logic
def route_event(event: dict) -> list[str]:
    """Determine destinations for an event."""

    destinations = []

    if event.get("priority") == "HIGH" or event.get("severity", 0) > 8:
        destinations.append("alerts")

    if event.get("eventType") == "ERROR":
        destinations.append("error_handling")
    else:
        destinations.append("analytics")

    return destinations
```

## Pattern 3: Windowed Aggregation

Aggregate events over time windows:

```sql
-- Tumbling window: Non-overlapping fixed windows
SELECT
    deviceId,
    System.Timestamp() as windowEnd,
    COUNT(*) as eventCount,
    AVG(temperature) as avgTemperature,
    MAX(temperature) as maxTemperature,
    MIN(temperature) as minTemperature
INTO TumblingAggregates
FROM InputStream
TIMESTAMP BY eventTime
GROUP BY
    deviceId,
    TumblingWindow(minute, 5)

-- Hopping window: Overlapping windows
SELECT
    deviceId,
    System.Timestamp() as windowEnd,
    AVG(temperature) as rollingAvgTemperature
INTO HoppingAggregates
FROM InputStream
TIMESTAMP BY eventTime
GROUP BY
    deviceId,
    HoppingWindow(minute, 10, 1)  -- 10-minute window, 1-minute hop

-- Sliding window: Window that moves with each event
SELECT
    deviceId,
    System.Timestamp() as windowEnd,
    COUNT(*) as eventsInWindow
INTO SlidingAggregates
FROM InputStream
TIMESTAMP BY eventTime
GROUP BY
    deviceId,
    SlidingWindow(minute, 5)
HAVING COUNT(*) > 100  -- Only output if more than 100 events
```

## Pattern 4: Stream Enrichment

Join streaming data with reference data:

```sql
-- Join with reference data
SELECT
    i.deviceId,
    i.temperature,
    i.humidity,
    i.eventTime,
    r.deviceName,
    r.location,
    r.deviceType,
    r.owner
INTO EnrichedStream
FROM InputStream i
TIMESTAMP BY eventTime
JOIN ReferenceData r
ON i.deviceId = r.deviceId

-- Reference data from Lakehouse table
-- Updated periodically (e.g., daily)
```

```python
# Reference data management
def update_reference_data(eventstream_id: str, lakehouse_table: str):
    """Update reference data for stream enrichment."""

    # Read latest reference data
    reference_df = spark.read.table(lakehouse_table)

    # Publish to Eventstream reference data
    # This is conceptual - actual implementation uses Fabric APIs
    eventstream_api.update_reference_data(
        eventstream_id=eventstream_id,
        data=reference_df.toPandas().to_dict('records'),
        key_column="deviceId"
    )

# Schedule daily refresh
# 0 0 * * * python update_reference_data.py
```

## Pattern 5: Sessionization

Group events into logical sessions:

```sql
-- Session window: Groups events with gaps
SELECT
    userId,
    System.Timestamp() as sessionEnd,
    MIN(eventTime) as sessionStart,
    COUNT(*) as eventsInSession,
    COLLECT(eventType) as eventSequence,
    DATEDIFF(second, MIN(eventTime), MAX(eventTime)) as sessionDurationSeconds
INTO UserSessions
FROM InputStream
TIMESTAMP BY eventTime
GROUP BY
    userId,
    SessionWindow(minute, 30)  -- 30-minute session timeout
```

## Pattern 6: Anomaly Detection

Detect anomalies in real-time:

```sql
-- Statistical anomaly detection
WITH StatsByDevice AS (
    SELECT
        deviceId,
        AVG(temperature) as avgTemp,
        STDEV(temperature) as stdTemp
    FROM InputStream
    TIMESTAMP BY eventTime
    GROUP BY
        deviceId,
        HoppingWindow(minute, 60, 5)  -- 1-hour lookback, 5-min update
)

SELECT
    i.deviceId,
    i.temperature,
    i.eventTime,
    s.avgTemp,
    s.stdTemp,
    (i.temperature - s.avgTemp) / s.stdTemp as zScore,
    CASE
        WHEN (i.temperature - s.avgTemp) / s.stdTemp > 3 THEN 'HIGH_ANOMALY'
        WHEN (i.temperature - s.avgTemp) / s.stdTemp < -3 THEN 'LOW_ANOMALY'
        ELSE 'NORMAL'
    END as anomalyStatus
INTO AnomalyDetection
FROM InputStream i
TIMESTAMP BY eventTime
JOIN StatsByDevice s
ON i.deviceId = s.deviceId
WHERE ABS((i.temperature - s.avgTemp) / s.stdTemp) > 2
```

## Pattern 7: Late Arrival Handling

Handle events that arrive out of order:

```sql
-- Configure watermark for late arrivals
-- Events up to 5 minutes late will still be processed

SELECT
    deviceId,
    System.Timestamp() as windowEnd,
    COUNT(*) as eventCount,
    SUM(CASE WHEN eventTime < DATEADD(minute, -5, System.Timestamp()) THEN 1 ELSE 0 END) as lateArrivals
INTO LateArrivalAnalysis
FROM InputStream
TIMESTAMP BY eventTime OVER eventId
-- WATERMARK allows 5 minutes of lateness
GROUP BY
    deviceId,
    TumblingWindow(minute, 5)
```

```python
# Monitor late arrivals
def analyze_late_arrivals(kql_client, database: str):
    """Analyze late arrival patterns."""

    query = """
    LateArrivalAnalysis
    | where windowEnd > ago(24h)
    | summarize
        TotalEvents = sum(eventCount),
        TotalLateArrivals = sum(lateArrivals),
        LateArrivalPercent = sum(lateArrivals) * 100.0 / sum(eventCount)
        by bin(windowEnd, 1h)
    | order by windowEnd asc
    """

    results = kql_client.execute(database, query)

    for row in results.primary_results[0]:
        if row['LateArrivalPercent'] > 5:
            print(f"Warning: {row['LateArrivalPercent']:.2f}% late arrivals at {row['windowEnd']}")

    return results
```

## Pattern 8: Multi-Destination Fan-Out

Send processed events to multiple destinations:

```python
# Eventstream configuration with multiple destinations
eventstream_config = {
    "name": "multi-destination-stream",
    "source": {
        "type": "AzureEventHubs",
        "eventHubName": "incoming-events"
    },
    "transformations": [
        {
            "name": "enrich",
            "query": """
                SELECT
                    *,
                    CASE WHEN temperature > 40 THEN 'CRITICAL' ELSE 'NORMAL' END as status
                FROM InputStream
            """
        }
    ],
    "destinations": [
        {
            "name": "kql-realtime",
            "type": "KqlDatabase",
            "database": "RealtimeDB",
            "table": "Events"
        },
        {
            "name": "lakehouse-archive",
            "type": "Lakehouse",
            "lakehouse": "ArchiveLake",
            "table": "events_archive"
        },
        {
            "name": "critical-alerts",
            "type": "Reflex",
            "filter": "status = 'CRITICAL'",
            "trigger": "CriticalEventsTrigger"
        },
        {
            "name": "external-system",
            "type": "CustomEndpoint",
            "url": "https://external-api.company.com/events",
            "headers": {
                "Authorization": "Bearer {{secret:api-key}}"
            }
        }
    ]
}
```

## Pattern 9: Schema Evolution

Handle changing event schemas:

```sql
-- Flexible schema handling
SELECT
    eventId,
    eventTime,
    eventType,
    -- Handle optional fields with defaults
    COALESCE(temperature, 0) as temperature,
    COALESCE(humidity, -1) as humidity,
    -- Handle new fields that may not exist in old events
    TRY_CAST(pressure as float) as pressure,
    -- Preserve unknown fields in a catch-all column
    UDF.ExtractUnknownFields(rawEvent) as additionalFields
INTO SchemaFlexibleOutput
FROM InputStream
```

## Monitoring and Troubleshooting

```python
# Eventstream health monitoring
class EventstreamMonitor:
    def __init__(self, workspace_id: str, eventstream_id: str, token: str):
        self.workspace_id = workspace_id
        self.eventstream_id = eventstream_id
        self.token = token

    def get_metrics(self) -> dict:
        """Get Eventstream metrics."""

        url = f"https://api.fabric.microsoft.com/v1/workspaces/{self.workspace_id}/eventstreams/{self.eventstream_id}/metrics"

        response = requests.get(
            url,
            headers={"Authorization": f"Bearer {self.token}"}
        )

        return response.json()

    def check_health(self) -> dict:
        """Check Eventstream health status."""

        metrics = self.get_metrics()

        health = {
            "status": "healthy",
            "issues": []
        }

        # Check input rate
        if metrics.get("inputEventsPerSecond", 0) == 0:
            health["issues"].append("No incoming events")
            health["status"] = "warning"

        # Check backlog
        if metrics.get("backloggedEvents", 0) > 10000:
            health["issues"].append(f"High backlog: {metrics['backloggedEvents']} events")
            health["status"] = "degraded"

        # Check errors
        if metrics.get("errors", 0) > 0:
            health["issues"].append(f"Processing errors: {metrics['errors']}")
            health["status"] = "error"

        # Check watermark delay
        if metrics.get("watermarkDelaySeconds", 0) > 300:
            health["issues"].append(f"High watermark delay: {metrics['watermarkDelaySeconds']}s")
            health["status"] = "degraded"

        return health

# Usage
monitor = EventstreamMonitor(workspace_id, eventstream_id, token)
health = monitor.check_health()
print(f"Eventstream health: {health['status']}")
for issue in health["issues"]:
    print(f"  - {issue}")
```

## Best Practices

1. **Start simple** - Begin with passthrough, add transformations incrementally
2. **Choose appropriate windows** - Match window size to business requirements
3. **Handle late data** - Set watermarks based on expected delays
4. **Monitor throughput** - Track input/output rates and backlog
5. **Use reference data** - Enrich streams without impacting performance
6. **Plan destinations** - Consider query patterns when choosing outputs

## Conclusion

Eventstreams patterns provide building blocks for real-time data processing. Combine these patterns to build sophisticated streaming pipelines without writing infrastructure code. Start with simple patterns and compose them as requirements evolve.
