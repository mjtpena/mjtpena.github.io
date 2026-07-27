---
title: "KQL for Real-Time Analytics: Patterns and Performance"
author: Michael John Peña
draft: false
date: 2024-01-20
tags:
  - KQL
  - Real-Time Analytics
  - Microsoft Fabric
  - Azure Data Explorer
  - Query Optimization
---

KQL is deceptively simple; over the years I've used it to squeeze sub-second insights from streaming data. Below are the query patterns and optimizations that mattered most in production.

## KQL Fundamentals

### Basic Query Structure

```kql
// KQL uses a pipe-based syntax
TableName
| where Timestamp > ago(1h)
| where Status == "Active"
| summarize Count = count() by Category
| order by Count desc
| take 10
```

### Essential Operators

```kql
// Filtering
DeviceTelemetry
| where Timestamp > ago(24h)
| where Temperature > 30 and Humidity < 50
| where DeviceId startswith "sensor-"
| where Location has "Building A"

// Projecting columns
DeviceTelemetry
| project Timestamp, DeviceId, Temperature, Humidity
| project-away RawEvent  // Remove column
| project-rename Temp = Temperature  // Rename column

// Extending with calculations
DeviceTelemetry
| extend TempFahrenheit = Temperature * 9/5 + 32
| extend IsHot = Temperature > 35
| extend HourOfDay = datetime_part("hour", Timestamp)

// Aggregating
DeviceTelemetry
| summarize
    AvgTemp = avg(Temperature),
    MaxTemp = max(Temperature),
    MinTemp = min(Temperature),
    StdTemp = stdev(Temperature),
    EventCount = count(),
    UniqueDevices = dcount(DeviceId)
    by bin(Timestamp, 1h)
```

## Time-Series Analysis

### Binning and Aggregation

```kql
// Hourly aggregation
DeviceTelemetry
| where Timestamp > ago(7d)
| summarize
    AvgTemp = avg(Temperature),
    P95Temp = percentile(Temperature, 95)
    by bin(Timestamp, 1h), DeviceId
| render timechart

// Dynamic binning based on time range
let timeRange = ago(7d);
let binSize = case(
    timeRange > ago(30d), 1d,
    timeRange > ago(7d), 1h,
    timeRange > ago(1d), 10m,
    1m
);
DeviceTelemetry
| where Timestamp > timeRange
| summarize avg(Temperature) by bin(Timestamp, binSize)
```

### Time Intelligence

```kql
// Previous period comparison
let currentPeriod = DeviceTelemetry
    | where Timestamp between (ago(7d) .. now())
    | summarize CurrentAvg = avg(Temperature);

let previousPeriod = DeviceTelemetry
    | where Timestamp between (ago(14d) .. ago(7d))
    | summarize PreviousAvg = avg(Temperature);

currentPeriod
| join kind=cross previousPeriod
| extend PercentChange = (CurrentAvg - PreviousAvg) / PreviousAvg * 100

// Year-over-year comparison
DeviceTelemetry
| where Timestamp > ago(365d)
| extend Year = datetime_part("year", Timestamp)
| extend Month = datetime_part("month", Timestamp)
| summarize AvgTemp = avg(Temperature) by Year, Month
| pivot Year on AvgTemp
```

### Moving Averages

```kql
// Simple moving average
DeviceTelemetry
| where Timestamp > ago(24h) and DeviceId == "sensor-001"
| order by Timestamp asc
| serialize
| extend MA_5 = row_window_session(Temperature, Timestamp, 5m, 1m)
| project Timestamp, Temperature, MA_5

// Using series functions
DeviceTelemetry
| where Timestamp > ago(7d) and DeviceId == "sensor-001"
| make-series AvgTemp = avg(Temperature) on Timestamp step 1h
| extend MA_24h = series_fir(AvgTemp, repeat(1, 24), true, true)
| render timechart
```

## Anomaly Detection

```kql
// Statistical anomaly detection
DeviceTelemetry
| where Timestamp > ago(24h)
| summarize
    AvgTemp = avg(Temperature),
    StdTemp = stdev(Temperature)
    by DeviceId
| join kind=inner (
    DeviceTelemetry
    | where Timestamp > ago(10m)
    | summarize CurrentTemp = avg(Temperature) by DeviceId
) on DeviceId
| extend ZScore = (CurrentTemp - AvgTemp) / StdTemp
| where abs(ZScore) > 2
| project DeviceId, CurrentTemp, AvgTemp, ZScore,
    AnomalyType = iff(ZScore > 0, "High", "Low")

// Built-in anomaly detection
DeviceTelemetry
| where Timestamp > ago(7d) and DeviceId == "sensor-001"
| make-series Temperature = avg(Temperature) on Timestamp step 1h
| extend anomalies = series_decompose_anomalies(Temperature)
| mv-expand Timestamp, Temperature, anomalies
| where anomalies != 0
| project Timestamp, Temperature, AnomalyDirection = iff(anomalies > 0, "Spike", "Drop")

// Detect outliers in multiple dimensions
DeviceTelemetry
| where Timestamp > ago(1h)
| summarize
    AvgTemp = avg(Temperature),
    AvgHumidity = avg(Humidity)
    by DeviceId
| extend TempOutlier = iff(AvgTemp > percentile(AvgTemp, 95) or AvgTemp < percentile(AvgTemp, 5), true, false)
| extend HumidityOutlier = iff(AvgHumidity > percentile(AvgHumidity, 95) or AvgHumidity < percentile(AvgHumidity, 5), true, false)
| where TempOutlier or HumidityOutlier
```

## Joins and Correlations

```kql
// Inner join with reference data
DeviceTelemetry
| where Timestamp > ago(1h)
| join kind=inner (
    DeviceMetadata
    | project DeviceId, Location, DeviceType, Owner
) on DeviceId
| project Timestamp, DeviceId, Temperature, Location, DeviceType

// Left outer join
DeviceTelemetry
| where Timestamp > ago(1h)
| join kind=leftouter (
    MaintenanceLog
    | where MaintenanceDate > ago(30d)
    | summarize LastMaintenance = max(MaintenanceDate) by DeviceId
) on DeviceId
| extend DaysSinceMaintenance = datetime_diff('day', now(), LastMaintenance)

// Time-based join (events within time window)
AlertEvents
| where Timestamp > ago(24h)
| join kind=inner (
    DeviceTelemetry
    | where Timestamp > ago(24h)
) on DeviceId
| where abs(datetime_diff('second', AlertEvents.Timestamp, DeviceTelemetry.Timestamp)) < 60
| project AlertTime = AlertEvents.Timestamp, AlertType, DeviceId, Temperature, Humidity
```

## Performance Optimization

```kql
// Use query hints for large datasets
DeviceTelemetry
| where Timestamp > ago(30d)
| where DeviceId == "sensor-001"  // Filter early
| summarize hint.shufflekey=DeviceId avg(Temperature) by bin(Timestamp, 1h), DeviceId

// Limit data scanned
DeviceTelemetry
| where Timestamp > ago(1h)  // Always filter by time first
| where DeviceId in ("sensor-001", "sensor-002", "sensor-003")  // Use in() for multiple values
| sample 10000  // Sample for exploration

// Use materialized views for frequent queries
// .create materialized-view is admin operation, shown for reference
// .create materialized-view HourlyStats on table DeviceTelemetry
// {
//     DeviceTelemetry
//     | summarize AvgTemp = avg(Temperature) by bin(Timestamp, 1h), DeviceId
// }

// Query the materialized view
HourlyStats
| where Timestamp > ago(7d)
| summarize AvgTemp = avg(AvgTemp) by bin(Timestamp, 1d), DeviceId
```

## Visualization

```kql
// Time chart
DeviceTelemetry
| where Timestamp > ago(24h)
| summarize AvgTemp = avg(Temperature) by bin(Timestamp, 10m), DeviceId
| render timechart with (title="Temperature Over Time")

// Bar chart
DeviceTelemetry
| where Timestamp > ago(24h)
| summarize EventCount = count() by DeviceId
| top 10 by EventCount
| render barchart with (title="Events by Device")

// Pie chart
DeviceTelemetry
| where Timestamp > ago(24h)
| summarize EventCount = count() by DeviceType
| render piechart with (title="Events by Device Type")

// Scatter plot for correlation
DeviceTelemetry
| where Timestamp > ago(1h)
| project Temperature, Humidity, DeviceId
| render scatterchart with (xcolumn=Temperature, ycolumns=Humidity)

// Area chart
DeviceTelemetry
| where Timestamp > ago(7d)
| summarize TotalEvents = count() by bin(Timestamp, 1h)
| render areachart with (title="Event Volume Over Time")
```

## Common Patterns

### Device Monitoring Dashboard

```kql
// Current status of all devices
let DeviceStatus = DeviceTelemetry
    | summarize
        LastSeen = max(Timestamp),
        LastTemp = arg_max(Timestamp, Temperature),
        LastHumidity = arg_max(Timestamp, Humidity)
        by DeviceId
    | extend
        MinutesSinceLastSeen = datetime_diff('minute', now(), LastSeen),
        Status = case(
            datetime_diff('minute', now(), LastSeen) < 5, "Online",
            datetime_diff('minute', now(), LastSeen) < 30, "Degraded",
            "Offline"
        );

DeviceStatus
| join kind=leftouter (
    DeviceMetadata
    | project DeviceId, Location, DeviceType
) on DeviceId
| project DeviceId, Status, LastSeen, Temperature = LastTemp, Location, DeviceType
| order by Status asc, LastSeen desc
```

### Trend Analysis

```kql
// Calculate trend direction
DeviceTelemetry
| where Timestamp > ago(7d)
| summarize AvgTemp = avg(Temperature) by bin(Timestamp, 1d), DeviceId
| order by DeviceId, Timestamp asc
| serialize
| extend PrevAvgTemp = prev(AvgTemp, 1)
| extend TrendDirection = case(
    AvgTemp > PrevAvgTemp * 1.05, "Increasing",
    AvgTemp < PrevAvgTemp * 0.95, "Decreasing",
    "Stable"
)
| summarize TrendCounts = count() by DeviceId, TrendDirection
| evaluate pivot(TrendDirection, sum(TrendCounts))
```

## Conclusion

KQL's power comes from its expressiveness and performance on time-series data. Key patterns:

1. **Filter early** - Reduce data volume at query start
2. **Use time bins** - Aggregate appropriately for your time range
3. **Leverage built-ins** - Anomaly detection, forecasting functions
4. **Materialize frequent queries** - Pre-compute common aggregations
5. **Visualize inline** - Use render for quick insights

Master these patterns and you'll unlock real-time insights from your streaming data.
