---
title: "KQL Querysets in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-03
tags:
  - Microsoft Fabric
  - KQL
  - Real-Time Intelligence
  - Data Analysis
  - Queries
---

KQL Querysets are the analysis layer of Real-Time Intelligence in Fabric. Today I'm exploring how to write effective KQL for real-time analytics.

## What are KQL Querysets?

KQL Querysets are saved, shareable collections of Kusto Query Language queries that:
- Connect to Eventhouses
- Can be scheduled
- Support parameters
- Integrate with dashboards
- Version controlled

## KQL Fundamentals

### Basic Query Structure

```kusto
// Table | operator1 | operator2 | ...
SensorData
| where EventTime > ago(1h)
| where DeviceId startswith "sensor-"
| summarize avg(Value) by DeviceId
| order by avg_Value desc
| take 10
```

### Filtering Data

```kusto
// Time-based filtering
SensorData
| where EventTime between (datetime(2024-06-01) .. datetime(2024-06-02))

// String filtering
SensorData
| where DeviceId has "production"
| where SensorType in ("temperature", "humidity")
| where Location.building == "HQ"

// Numeric filtering
SensorData
| where Value > 0 and Value < 100
| where Value !between (40 .. 60)  // Outside normal range
```

### Aggregations

```kusto
// Basic aggregations
SensorData
| where EventTime > ago(24h)
| summarize
    count(),
    avg(Value),
    min(Value),
    max(Value),
    stdev(Value),
    percentile(Value, 95)
    by DeviceId

// Time-based aggregations
SensorData
| where EventTime > ago(7d)
| summarize avg(Value) by bin(EventTime, 1h), DeviceId
| render timechart
```

### Joins

```kusto
// Inner join
let Devices = datatable(DeviceId: string, Location: string)
[
    "D001", "Floor 1",
    "D002", "Floor 2"
];

SensorData
| join kind=inner Devices on DeviceId
| summarize avg(Value) by Location

// Left outer join
SensorData
| join kind=leftouter Devices on DeviceId
| extend LocationName = coalesce(Location, "Unknown")

// Time-based join (within time window)
SensorData
| join kind=inner (
    AlertsTable
    | where AlertTime > ago(1h)
) on DeviceId
| where abs(datetime_diff('second', EventTime, AlertTime)) < 60
```

## Time Series Analysis

### Creating Time Series

```kusto
// Make series from data
SensorData
| where EventTime > ago(7d)
| make-series Value = avg(Value) default=0
    on EventTime
    step 1h
    by DeviceId

// With multiple metrics
SensorData
| where EventTime > ago(7d)
| make-series
    AvgValue = avg(Value),
    MaxValue = max(Value),
    Count = count()
    on EventTime step 1h
    by DeviceId
```

### Time Series Functions

```kusto
// Fill missing values
SensorData
| make-series Value = avg(Value) default=real(null) on EventTime step 5m
| extend Value = series_fill_linear(Value)

// Smoothing with moving average
SensorData
| make-series Value = avg(Value) on EventTime step 1m by DeviceId
| extend SmoothedValue = series_fir(Value, repeat(1, 5), true, true)

// Decomposition (trend, seasonal, residual)
SensorData
| make-series Value = avg(Value) on EventTime step 1h by DeviceId
| extend (seasonal, trend, residual) = series_decompose(Value)
```

### Anomaly Detection

```kusto
// Spike detection
SensorData
| where EventTime > ago(24h)
| make-series Value = avg(Value) on EventTime step 5m by DeviceId
| extend (anomalies, score, baseline) = series_decompose_anomalies(Value, 1.5)
| mv-expand EventTime to typeof(datetime),
            Value to typeof(real),
            anomalies to typeof(int),
            score to typeof(real),
            baseline to typeof(real)
| where anomalies != 0
| project EventTime, DeviceId, Value, AnomalyScore = score, Expected = baseline

// Changepoint detection
SensorData
| where DeviceId == "D001"
| make-series Value = avg(Value) on EventTime step 1h
| extend changepoints = series_decompose_anomalies(Value, 3, -1, 'linefit')
```

### Forecasting

```kusto
// Simple forecast
SensorData
| where DeviceId == "D001"
| where EventTime > ago(30d)
| make-series Value = avg(Value) on EventTime step 1h
| extend Forecast = series_decompose_forecast(Value, 24)  // 24 hours ahead

// With confidence intervals
SensorData
| where DeviceId == "D001"
| make-series Value = avg(Value) on EventTime step 1h
| extend (Forecast, LowerBound, UpperBound) = series_decompose_forecast(Value, 24)
| mv-expand EventTime, Value, Forecast, LowerBound, UpperBound
```

## Advanced Patterns

### Sessionization

```kusto
// Group events into sessions (30 min gap = new session)
SensorData
| where DeviceId == "D001"
| order by EventTime asc
| extend SessionBreak = iif(
    datetime_diff('minute', EventTime, prev(EventTime)) > 30,
    1, 0
)
| extend SessionId = row_cumsum(SessionBreak)
| summarize
    SessionStart = min(EventTime),
    SessionEnd = max(EventTime),
    EventCount = count(),
    AvgValue = avg(Value)
    by SessionId
```

### Funnel Analysis

```kusto
// User journey funnel
let Step1 = Events | where Action == "ViewProduct" | distinct UserId;
let Step2 = Events | where Action == "AddToCart" | distinct UserId;
let Step3 = Events | where Action == "Checkout" | distinct UserId;
let Step4 = Events | where Action == "Purchase" | distinct UserId;

print
    ViewProduct = toscalar(Step1 | count),
    AddToCart = toscalar(Step1 | join kind=inner Step2 on UserId | count),
    Checkout = toscalar(Step1 | join kind=inner Step2 on UserId | join kind=inner Step3 on UserId | count),
    Purchase = toscalar(Step1 | join kind=inner Step2 on UserId | join kind=inner Step3 on UserId | join kind=inner Step4 on UserId | count)
```

### Correlation Analysis

```kusto
// Correlate two metrics
let Metric1 = SensorData | where SensorType == "temperature" | make-series Value on EventTime step 1h;
let Metric2 = SensorData | where SensorType == "humidity" | make-series Value on EventTime step 1h;

Metric1
| join Metric2 on EventTime
| extend Correlation = series_pearson_correlation(Value, Value1)
```

## Parameters and Functions

### Parameterized Queries

```kusto
// Define parameters
declare query_parameters(
    StartTime: datetime = ago(24h),
    EndTime: datetime = now(),
    DeviceFilter: string = "*"
);

SensorData
| where EventTime between (StartTime .. EndTime)
| where DeviceId has DeviceFilter or DeviceFilter == "*"
| summarize avg(Value) by DeviceId, bin(EventTime, 1h)
```

### User-Defined Functions

```kusto
// Create reusable function
.create-or-alter function
    with (docstring = "Get device statistics", folder = "Analytics")
    GetDeviceStats(DeviceId: string, TimeRange: timespan) {
        SensorData
        | where DeviceId == DeviceId
        | where EventTime > ago(TimeRange)
        | summarize
            AvgValue = avg(Value),
            MinValue = min(Value),
            MaxValue = max(Value),
            StdDev = stdev(Value),
            Count = count()
}

// Use function
GetDeviceStats("D001", 7d)
```

## Query Optimization

### Best Practices

```kusto
// Good: Filter early, reduce data
SensorData
| where EventTime > ago(1h)  // Filter first
| where DeviceId == "D001"   // Then narrow
| summarize avg(Value)

// Bad: Aggregate then filter
SensorData
| summarize avg(Value) by DeviceId, bin(EventTime, 1h)
| where DeviceId == "D001"  // Too late!

// Good: Use has/contains instead of regex when possible
SensorData
| where DeviceId has "production"  // Faster

// Avoid if possible
SensorData
| where DeviceId matches regex "prod.*"  // Slower
```

### Explain Query

```kusto
// Understand query execution
.show query plan
SensorData
| where EventTime > ago(1h)
| summarize avg(Value) by DeviceId
```

## Visualization

```kusto
// Time chart
SensorData
| where EventTime > ago(24h)
| summarize avg(Value) by bin(EventTime, 15m), DeviceId
| render timechart

// Bar chart
SensorData
| where EventTime > ago(24h)
| summarize count() by DeviceId
| render barchart

// Pie chart
SensorData
| where EventTime > ago(24h)
| summarize count() by SensorType
| render piechart

// Scatter plot
SensorData
| where EventTime > ago(1h)
| project Value, EventTime
| render scatterchart
```

## What's Next

Tomorrow I'll cover real-time dashboards in Fabric.

## Resources

- [KQL Reference](https://learn.microsoft.com/kusto/query/)
- [Time Series Analysis](https://learn.microsoft.com/kusto/query/time-series-analysis)
- [Query Best Practices](https://learn.microsoft.com/kusto/query/best-practices)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
