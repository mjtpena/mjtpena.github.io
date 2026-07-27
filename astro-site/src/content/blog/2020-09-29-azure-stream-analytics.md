---
title: "Azure Stream Analytics: Real-Time Data Processing"
author: Michael John Peña
draft: false
date: 2020-09-29
tags:
  - Azure
  - Stream Analytics
  - Real-Time
  - IoT
---

Stream Analytics is one of those services I keep recommending and clients keep being surprised by — SQL on top of an event firehose, with windowing and joins, no Spark cluster to babysit. It's the right answer for a surprising range of problems: anomaly detection on IoT telemetry, real-time dashboard aggregations, simple alerting on event patterns. The ceiling is real (complex transformations want Databricks or Stream Analytics-on-Edge), but the floor is impressively low.

## Basic Query

```sql
SELECT
    DeviceId,
    AVG(Temperature) AS AvgTemp,
    MAX(Temperature) AS MaxTemp,
    System.Timestamp() AS WindowEnd
FROM IoTInput TIMESTAMP BY EventTime
GROUP BY
    DeviceId,
    TumblingWindow(minute, 5)
```

## Window Types

### Tumbling Window
Fixed, non-overlapping intervals:
```sql
TumblingWindow(minute, 5)
-- |---5min---|---5min---|---5min---|
```

### Hopping Window
Fixed intervals that overlap:
```sql
HoppingWindow(minute, 10, 5)
-- 10-minute windows every 5 minutes
```

### Sliding Window
Window slides with each event:
```sql
SlidingWindow(minute, 5)
-- Triggers on every event, includes last 5 minutes
```

### Session Window
Groups events with gaps:
```sql
SessionWindow(minute, 5, 30)
-- 5-minute timeout, 30-minute max duration
```

## Anomaly Detection

```sql
SELECT
    DeviceId,
    Temperature,
    AnomalyDetection_SpikeAndDip(Temperature, 95, 120, 'spikesanddips') AS SpikeAndDip
FROM IoTInput
```

## Reference Data Join

```sql
SELECT
    i.DeviceId,
    d.DeviceName,
    d.Location,
    i.Temperature
FROM IoTInput i TIMESTAMP BY EventTime
JOIN DeviceReference d ON i.DeviceId = d.DeviceId
```

## Output to Multiple Sinks

```sql
-- To Power BI for dashboards
SELECT * INTO PowerBIOutput FROM AggregatedData

-- To Blob for archival
SELECT * INTO BlobOutput FROM RawData

-- To Event Hub for downstream processing
SELECT * INTO EventHubOutput WHERE IsAnomaly = 1
```

Stream Analytics bridges the gap between raw event streams and actionable insights.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
