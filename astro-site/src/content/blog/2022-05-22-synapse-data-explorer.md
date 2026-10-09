---
title: "Synapse Data Explorer: Real-Time Analytics at Scale"
description: "// Enable streaming ingestion .alter database SensorAnalytics policy streamingingestion enable"
author: Michael John Peña
draft: false
date: 2022-05-22
tags:
  - Azure
  - Synapse
  - data-explorer
  - Kusto
---

## Creating a Data Explorer Pool

```bash
# Create Data Explorer pool via CLI
az synapse kusto pool create \
    --name "analytics-pool" \
    --workspace-name "my-synapse-workspace" \
    --resource-group "analytics-rg" \
    --location "eastus" \
    --sku name="Compute optimized" size="Small"
```

## Data Ingestion

Set up streaming ingestion:

```kql
// Create database
.create database SensorAnalytics

// Create table for IoT sensor data
.create table SensorReadings (
    Timestamp: datetime,
    SensorId: string,
    DeviceType: string,
    Temperature: real,
    Humidity: real,
    Pressure: real,
    Location: dynamic
)

// Create ingestion mapping
.create table SensorReadings ingestion json mapping 'SensorMapping' ```
[
    {"column": "Timestamp", "path": "$.timestamp", "datatype": "datetime"},
    {"column": "SensorId", "path": "$.sensorId", "datatype": "string"},
    {"column": "DeviceType", "path": "$.deviceType", "datatype": "string"},
    {"column": "Temperature", "path": "$.readings.temperature", "datatype": "real"},
    {"column": "Humidity", "path": "$.readings.humidity", "datatype": "real"},
    {"column": "Pressure", "path": "$.readings.pressure", "datatype": "real"},
    {"column": "Location", "path": "$.location", "datatype": "dynamic"}
]
```

// Enable streaming ingestion
.alter database SensorAnalytics policy streamingingestion enable

// Create Event Hub connection for streaming
.create table SensorReadings ingestion batching policy
```
{
    "MaximumBatchingTimeSpan": "00:00:10",
    "MaximumNumberOfItems": 500,
    "MaximumRawDataSizeMB": 1
}
```
```

## Kusto Query Language Basics

Essential KQL queries:

```kql
// Basic filtering and aggregation
SensorReadings
| where Timestamp > ago(1h)
| where DeviceType == "TemperatureSensor"
| summarize
    AvgTemp = avg(Temperature),
    MaxTemp = max(Temperature),
    MinTemp = min(Temperature),
    Readings = count()
    by SensorId
| order by AvgTemp desc

// Time-series analysis with binning
SensorReadings
| where Timestamp > ago(24h)
| summarize AvgTemperature = avg(Temperature) by bin(Timestamp, 15m), SensorId
| render timechart

// Parse JSON from dynamic column
SensorReadings
| where Timestamp > ago(1h)
| extend
    Latitude = toreal(Location.lat),
    Longitude = toreal(Location.lon),
    Building = tostring(Location.building)
| summarize ReadingCount = count() by Building
| render piechart

// Join with reference data
let DeviceInfo = datatable(SensorId: string, Zone: string, Threshold: real)
[
    "SENSOR-001", "Zone-A", 30.0,
    "SENSOR-002", "Zone-A", 28.0,
    "SENSOR-003", "Zone-B", 32.0
];
SensorReadings
| where Timestamp > ago(1h)
| join kind=inner DeviceInfo on SensorId
| where Temperature > Threshold
| project Timestamp, SensorId, Zone, Temperature, Threshold, Deviation = Temperature - Threshold
```

## Anomaly Detection

Built-in machine learning functions:

```kql
// Time-series anomaly detection
SensorReadings
| where Timestamp > ago(7d)
| where SensorId == "SENSOR-001"
| make-series
    AvgTemp = avg(Temperature)
    on Timestamp step 1h
| extend anomalies = series_decompose_anomalies(AvgTemp, 2.5)
| mv-expand Timestamp to typeof(datetime), AvgTemp to typeof(real), anomalies to typeof(int)
| where anomalies != 0
| project Timestamp, AvgTemp, AnomalyType = iff(anomalies > 0, "High", "Low")

// Seasonal decomposition
SensorReadings
| where Timestamp > ago(30d)
| make-series AvgTemp = avg(Temperature) on Timestamp step 1h
| extend (baseline, seasonal, trend, residual) = series_decompose(AvgTemp)
| render timechart

// Forecast future values
SensorReadings
| where Timestamp > ago(30d)
| where SensorId == "SENSOR-001"
| make-series AvgTemp = avg(Temperature) on Timestamp step 1h
| extend forecast = series_decompose_forecast(AvgTemp, 24)  // 24 hours ahead
| render timechart

// Pattern detection in logs
AppLogs
| where Timestamp > ago(1h)
| where Level == "Error"
| summarize Count = count() by bin(Timestamp, 5m)
| make-series ErrorCount = sum(Count) on Timestamp step 5m
| extend (anomalies, score, baseline) = series_decompose_anomalies(ErrorCount, 1.5, -1, 'linefit')
| mv-expand Timestamp, ErrorCount, anomalies, score, baseline
| where toint(anomalies) != 0
```

## User-Defined Functions

Create reusable functions:

```kql
// Create function for temperature alerts
.create-or-alter function GetTemperatureAlerts(
    sensorId: string,
    threshold: real,
    lookback: timespan
) {
    SensorReadings
    | where Timestamp > ago(lookback)
    | where SensorId == sensorId
    | where Temperature > threshold
    | project Timestamp, SensorId, Temperature, Deviation = Temperature - threshold
    | order by Timestamp desc
}

// Use the function
GetTemperatureAlerts("SENSOR-001", 30.0, 24h)

// Create function for rolling statistics
.create-or-alter function RollingStats(
    sensorId: string,
    metric: string,
    windowSize: timespan
) {
    SensorReadings
    | where SensorId == sensorId
    | sort by Timestamp asc
    | extend
        RollingAvg = avg(Temperature) over (order by Timestamp rows between 60 preceding and current),
        RollingMax = max(Temperature) over (order by Timestamp rows between 60 preceding and current),
        RollingMin = min(Temperature) over (order by Timestamp rows between 60 preceding and current)
}

// Materialized view for common aggregations
.create materialized-view HourlySensorStats on table SensorReadings
{
    SensorReadings
    | summarize
        AvgTemperature = avg(Temperature),
        MaxTemperature = max(Temperature),
        MinTemperature = min(Temperature),
        AvgHumidity = avg(Humidity),
        ReadingCount = count()
        by SensorId, bin(Timestamp, 1h)
}
```

## Integration with Spark

Query Data Explorer from Spark:

```python
# PySpark code to query Data Explorer
from pyspark.sql import SparkSession

# Configure Kusto connection
kusto_options = {
    "kustoCluster": "https://mypool.eastus.kusto.azuresynapse.net",
    "kustoDatabase": "SensorAnalytics",
    "kustoTable": "SensorReadings",
    "kustoQuery": """
        SensorReadings
        | where Timestamp > ago(7d)
        | summarize AvgTemp = avg(Temperature) by SensorId, bin(Timestamp, 1h)
    """,
    "accessToken": dbutils.secrets.get(scope="kusto", key="token")
}

# Read from Data Explorer
df = spark.read \
    .format("com.microsoft.kusto.spark.synapse.datasource") \
    .options(**kusto_options) \
    .load()

# Process with Spark ML
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.clustering import KMeans

# Continue with analysis...
df.show()
```

## Real-Time Dashboard

Create Power BI dashboards:

```kql
// Query optimized for Power BI DirectQuery
let timeRange = ago(24h);
SensorReadings
| where Timestamp > timeRange
| summarize
    AvgTemperature = round(avg(Temperature), 2),
    MaxTemperature = round(max(Temperature), 2),
    MinTemperature = round(min(Temperature), 2),
    Readings = count()
    by SensorId, DeviceType, Hour = bin(Timestamp, 1h)
| order by Hour desc, SensorId asc

// KPI query for current status
SensorReadings
| where Timestamp > ago(15m)
| summarize
    CurrentTemp = round(avg(Temperature), 1),
    TempTrend = round(avg(Temperature) - avg(prev(Temperature, 1)), 2),
    AlertCount = countif(Temperature > 35)
    by SensorId
```

## Summary

Synapse Data Explorer provides:

- Real-time analytics on streaming data
- Powerful KQL for data exploration
- Built-in anomaly detection
- Time-series analysis capabilities
- Integration with Synapse ecosystem

Perfect for IoT, logs, and telemetry analytics.
