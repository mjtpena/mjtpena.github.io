---
title: "Synapse Real-Time Analytics in Microsoft Fabric: Streaming at Scale"
author: Michael John Peña
draft: false
date: 2023-05-09
tags:
  - Microsoft Fabric
  - Real-Time Analytics
  - KQL
  - Streaming
  - Event Hubs

---

I wrote "Synapse Real-Time Analytics in Microsoft Fabric: Streaming at Scale" to share practical, production-minded guidance on this topic.

## Real-Time Analytics Overview

The Real-Time Analytics workload includes:
- **KQL Database**: Time-optimized data store
- **KQL Queryset**: Saved queries and analytics
- **Eventstream**: Stream processing pipelines
- **Real-Time Dashboards**: Live visualizations

```
┌─────────────────────────────────────────────────────┐
│           Synapse Real-Time Analytics               │
├─────────────────────────────────────────────────────┤
│  ┌───────────┐    ┌───────────┐    ┌───────────┐   │
│  │Eventstream│───▶│KQL        │───▶│Real-Time  │   │
│  │(Ingest)   │    │Database   │    │Dashboard  │   │
│  └───────────┘    └───────────┘    └───────────┘   │
│        │                │                          │
│        │          ┌─────┴─────┐                    │
│        │          │           │                    │
│  ┌─────▼─────┐  ┌─▼───────┐ ┌─▼───────┐          │
│  │Event Hubs │  │KQL      │ │Lakehouse│          │
│  │Kafka      │  │Queryset │ │(Export) │          │
│  │IoT Hub    │  └─────────┘ └─────────┘          │
│  └───────────┘                                    │
└─────────────────────────────────────────────────────┘
```

## Creating a KQL Database

```kql
// KQL databases are created through the Fabric UI
// Once created, you can create tables and ingest data

// Create a table for IoT telemetry
.create table device_telemetry (
    device_id: string,
    timestamp: datetime,
    temperature: real,
    humidity: real,
    pressure: real,
    battery_level: int,
    location: dynamic
)

// Create a table for web events
.create table web_events (
    event_id: string,
    user_id: string,
    session_id: string,
    event_type: string,
    page_url: string,
    timestamp: datetime,
    properties: dynamic
)
```

## Data Ingestion

### Streaming Ingestion from Event Hubs

```kql
// Create ingestion mapping
.create table device_telemetry ingestion json mapping 'telemetry_mapping'
'['
'   {"column": "device_id", "path": "$.deviceId"},'
'   {"column": "timestamp", "path": "$.timestamp"},'
'   {"column": "temperature", "path": "$.readings.temperature"},'
'   {"column": "humidity", "path": "$.readings.humidity"},'
'   {"column": "pressure", "path": "$.readings.pressure"},'
'   {"column": "battery_level", "path": "$.batteryLevel"},'
'   {"column": "location", "path": "$.location"}'
']'

// Enable streaming ingestion
.alter table device_telemetry policy streamingingestion enable
```

### Eventstream Configuration

```python
# Eventstream connects sources to KQL Database
# Configuration in the Fabric UI:

eventstream_config = {
    "name": "IoT Telemetry Stream",
    "source": {
        "type": "EventHub",
        "connection": "Endpoint=sb://myhub.servicebus.windows.net/;...",
        "consumerGroup": "$Default"
    },
    "transformations": [
        {
            "type": "Filter",
            "condition": "temperature IS NOT NULL"
        },
        {
            "type": "AddTimestamp",
            "field": "ingestion_time"
        }
    ],
    "destination": {
        "type": "KQLDatabase",
        "database": "TelemetryDB",
        "table": "device_telemetry"
    }
}
```

## KQL Queries

### Basic Queries

```kql
// Get recent telemetry
device_telemetry
| where timestamp > ago(1h)
| take 100

// Filter by device
device_telemetry
| where device_id == "device-001"
| where timestamp > ago(24h)
| order by timestamp desc

// Count events by type
web_events
| where timestamp > ago(1d)
| summarize event_count = count() by event_type
| order by event_count desc
```

### Time Series Analysis

```kql
// Aggregate by time buckets
device_telemetry
| where timestamp > ago(24h)
| summarize
    avg_temp = avg(temperature),
    max_temp = max(temperature),
    min_temp = min(temperature),
    reading_count = count()
    by bin(timestamp, 1h)
| order by timestamp asc

// Moving average
device_telemetry
| where timestamp > ago(7d)
| where device_id == "device-001"
| order by timestamp asc
| extend moving_avg = series_fir(temperature, dynamic([1,1,1,1,1]), false, false)
| project timestamp, temperature, moving_avg

// Detect anomalies
device_telemetry
| where timestamp > ago(24h)
| where device_id == "device-001"
| make-series temp_series = avg(temperature) on timestamp step 5m
| extend anomalies = series_decompose_anomalies(temp_series, 1.5)
| mv-expand timestamp, temp_series, anomalies
| where anomalies != 0
| project timestamp, temperature = temp_series, anomaly_score = anomalies
```

### Aggregations and Statistics

```kql
// Percentiles
device_telemetry
| where timestamp > ago(1d)
| summarize
    p50_temp = percentile(temperature, 50),
    p90_temp = percentile(temperature, 90),
    p99_temp = percentile(temperature, 99)
    by device_id

// Histogram
device_telemetry
| where timestamp > ago(1d)
| summarize count() by bin(temperature, 5)
| render columnchart

// Correlation
device_telemetry
| where timestamp > ago(1d)
| where device_id == "device-001"
| project timestamp, temperature, humidity
| evaluate pearson_correlation_coefficient(temperature, humidity)
```

### Sessionization

```kql
// Sessionize web events (30-minute gap)
web_events
| where timestamp > ago(7d)
| order by user_id, timestamp asc
| extend prev_timestamp = prev(timestamp, 1)
| extend prev_user = prev(user_id, 1)
| extend is_new_session = iif(
    user_id != prev_user or timestamp - prev_timestamp > 30m,
    1, 0)
| extend session_number = row_cumsum(is_new_session)
| summarize
    session_start = min(timestamp),
    session_end = max(timestamp),
    event_count = count(),
    pages_viewed = dcount(page_url)
    by user_id, session_number
| extend session_duration = session_end - session_start
```

### Funnel Analysis

```kql
// Conversion funnel
let step1 = web_events | where event_type == "page_view" | where page_url contains "/products" | distinct user_id;
let step2 = web_events | where event_type == "add_to_cart" | distinct user_id;
let step3 = web_events | where event_type == "checkout_started" | distinct user_id;
let step4 = web_events | where event_type == "purchase_completed" | distinct user_id;
print
    step1_count = toscalar(step1 | count),
    step2_count = toscalar(step2 | where user_id in (step1) | count),
    step3_count = toscalar(step3 | where user_id in (step2) | count),
    step4_count = toscalar(step4 | where user_id in (step3) | count)
| extend
    step1_to_step2 = round(100.0 * step2_count / step1_count, 2),
    step2_to_step3 = round(100.0 * step3_count / step2_count, 2),
    step3_to_step4 = round(100.0 * step4_count / step3_count, 2),
    overall_conversion = round(100.0 * step4_count / step1_count, 2)
```

## Real-Time Dashboards

```kql
// Dashboard tile: Current active devices
device_telemetry
| where timestamp > ago(5m)
| summarize last_seen = max(timestamp) by device_id
| count
| render card with (title="Active Devices")

// Dashboard tile: Temperature heatmap
device_telemetry
| where timestamp > ago(1h)
| summarize avg_temp = avg(temperature) by device_id, bin(timestamp, 5m)
| render timechart with (title="Temperature by Device")

// Dashboard tile: Alert on high temperature
device_telemetry
| where timestamp > ago(5m)
| where temperature > 80
| project device_id, timestamp, temperature
| order by temperature desc
```

## Integration with Lakehouse

```kql
// Export to Lakehouse for long-term storage
.export to table lakehouse://workspace/lakehouse.Lakehouse/Tables/telemetry_archive
<|
device_telemetry
| where timestamp between (ago(30d) .. ago(7d))

// Create shortcut to historical data
// (Done through Fabric UI - creates a shortcut in KQL Database to Lakehouse data)
```

Real-Time Analytics in Fabric provides powerful streaming capabilities for time-sensitive workloads. Tomorrow, I will cover Power BI integration in Fabric.

## Resources

- [Real-Time Analytics in Fabric](https://learn.microsoft.com/en-us/fabric/real-time-analytics/)
- [KQL Quick Reference](https://learn.microsoft.com/en-us/azure/data-explorer/kql-quick-reference)
- [Eventstream](https://learn.microsoft.com/en-us/fabric/real-time-analytics/event-streams/overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
