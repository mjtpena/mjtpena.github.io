---
title: "Fabric Real-Time Analytics: Stream Processing at Scale"
author: Michael John Peña
draft: false
date: 2023-07-19
tags:
  - Microsoft Fabric
  - Real-Time Analytics
  - Streaming
  - KQL

---

I wrote "Fabric Real-Time Analytics: Stream Processing at Scale" to share practical, production-minded guidance on this topic.

## What is Real-Time Analytics?

```python
# Real-Time Analytics components
rta_components = {
    "kql_database": "Time-series optimized database",
    "eventstream": "Streaming data ingestion",
    "kql_queryset": "Saved KQL queries",
    "real_time_dashboard": "Live visualizations"
}

# Use cases
use_cases = [
    "IoT telemetry analysis",
    "Application log analytics",
    "Clickstream analysis",
    "Financial market data",
    "Security event monitoring",
    "Real-time operational dashboards"
]
```

## Creating a KQL Database

```
1. In your workspace, click "+ New" > "KQL Database"
2. Name your database (e.g., "telemetry_db")
3. Click "Create"
```

## KQL Basics

### Querying Data

```kql
// Basic query structure
// database.table | operators

// Select all records from last hour
telemetry
| where ingestion_time() > ago(1h)

// Filter and project columns
telemetry
| where device_type == "sensor"
| where temperature > 30
| project device_id, temperature, timestamp

// Aggregations
telemetry
| where timestamp > ago(24h)
| summarize
    avg_temp = avg(temperature),
    max_temp = max(temperature),
    min_temp = min(temperature),
    reading_count = count()
    by device_id
| order by avg_temp desc
```

### Time-Based Analysis

```kql
// Time-series aggregation with bin()
telemetry
| where timestamp > ago(24h)
| summarize avg_temperature = avg(temperature) by bin(timestamp, 5m)
| render timechart

// Rolling windows
telemetry
| where timestamp > ago(1h)
| summarize
    avg_temp = avg(temperature),
    max_temp = max(temperature)
    by bin(timestamp, 1m), device_id
| order by timestamp desc

// Moving average
telemetry
| where timestamp > ago(24h)
| summarize avg_temp = avg(temperature) by bin(timestamp, 5m)
| serialize
| extend moving_avg = series_fir(avg_temp, repeat(1, 12), true, true)
```

### Joins and Lookups

```kql
// Join with dimension table
telemetry
| where timestamp > ago(1h)
| join kind=inner (
    device_metadata
    | project device_id, device_name, location
) on device_id
| project timestamp, device_name, location, temperature

// Lookup for enrichment
telemetry
| where timestamp > ago(1h)
| lookup kind=leftouter device_metadata on device_id
| project timestamp, device_name, temperature
```

### Anomaly Detection

```kql
// Built-in anomaly detection
telemetry
| where timestamp > ago(7d)
| summarize readings = make_list(temperature) by device_id
| extend anomalies = series_decompose_anomalies(readings, 1.5)
| mv-expand readings, anomalies
| where anomalies == 1
| project device_id, anomaly_value = readings

// Statistical anomaly detection
telemetry
| where timestamp > ago(24h)
| summarize
    avg_temp = avg(temperature),
    stdev_temp = stdev(temperature)
    by device_id
| extend
    upper_bound = avg_temp + (3 * stdev_temp),
    lower_bound = avg_temp - (3 * stdev_temp)
| join kind=inner (
    telemetry
    | where timestamp > ago(1h)
) on device_id
| where temperature > upper_bound or temperature < lower_bound
| project device_id, temperature, avg_temp, timestamp
```

## Creating Tables

```kql
// Create a table
.create table telemetry (
    device_id: string,
    device_type: string,
    temperature: real,
    humidity: real,
    timestamp: datetime
)

// Create table mapping for JSON ingestion
.create table telemetry ingestion json mapping 'telemetry_mapping'
'['
'  {"column": "device_id", "path": "$.deviceId", "datatype": "string"},'
'  {"column": "device_type", "path": "$.deviceType", "datatype": "string"},'
'  {"column": "temperature", "path": "$.temperature", "datatype": "real"},'
'  {"column": "humidity", "path": "$.humidity", "datatype": "real"},'
'  {"column": "timestamp", "path": "$.timestamp", "datatype": "datetime"}'
']'

// Set retention policy
.alter-merge table telemetry policy retention
```
'{'
'  "SoftDeletePeriod": "30.00:00:00",'
'  "Recoverability": "Enabled"'
'}'
```
```

## Ingesting Data

### Manual Ingestion

```kql
// Inline ingestion (for testing)
.ingest inline into table telemetry <|
"device001", "sensor", 25.5, 60.0, datetime(2023-07-19 10:00:00)
"device002", "sensor", 26.0, 58.5, datetime(2023-07-19 10:00:00)

// Ingest from storage
.ingest into table telemetry (
    h'https://storage.blob.core.windows.net/container/data.json'
) with (
    format = 'json',
    ingestionMappingReference = 'telemetry_mapping'
)
```

### Eventstream Ingestion

```python
# Eventstream configuration
eventstream_sources = {
    "event_hubs": "Azure Event Hubs",
    "kafka": "Apache Kafka",
    "custom_app": "Custom application endpoint",
    "sample_data": "Built-in sample data"
}

# Create Eventstream in Fabric:
# 1. New > Eventstream
# 2. Add source (e.g., Event Hub)
# 3. Add destination (KQL Database)
# 4. Configure mapping
# 5. Start the stream
```

## Real-Time Dashboard

```kql
// Create queries for dashboard tiles

// Tile 1: Current reading count
telemetry
| where timestamp > ago(5m)
| summarize count()

// Tile 2: Temperature trend
telemetry
| where timestamp > ago(1h)
| summarize avg_temp = avg(temperature) by bin(timestamp, 1m)
| render timechart

// Tile 3: Device status
telemetry
| where timestamp > ago(5m)
| summarize last_reading = max(timestamp) by device_id
| extend status = iff(last_reading > ago(2m), "Online", "Offline")
| summarize count() by status

// Tile 4: Top devices by reading count
telemetry
| where timestamp > ago(1h)
| summarize readings = count() by device_id
| top 10 by readings
| render barchart
```

## Integration with Other Fabric Items

```kql
// Query KQL database from Spark notebook
// Use the Kusto Spark connector

// In PySpark:
df = spark.read \
    .format("com.microsoft.kusto.spark.synapse.datasource") \
    .option("kustoCluster", "https://kqldb.fabric.microsoft.com") \
    .option("kustoDatabase", "telemetry_db") \
    .option("kustoQuery", "telemetry | where timestamp > ago(1h)") \
    .load()

// Write Spark data to KQL
df.write \
    .format("com.microsoft.kusto.spark.synapse.datasource") \
    .option("kustoCluster", "https://kqldb.fabric.microsoft.com") \
    .option("kustoDatabase", "telemetry_db") \
    .option("kustoTable", "processed_telemetry") \
    .mode("Append") \
    .save()
```

## Best Practices

```python
best_practices = {
    "schema_design": [
        "Use appropriate data types",
        "Consider ingestion timestamp",
        "Plan for query patterns"
    ],
    "ingestion": [
        "Batch small events",
        "Use streaming for real-time",
        "Configure appropriate retention"
    ],
    "querying": [
        "Always filter by time first",
        "Use summarize for aggregations",
        "Leverage materialized views for common queries"
    ],
    "monitoring": [
        "Track ingestion latency",
        "Monitor query performance",
        "Set up alerts for anomalies"
    ]
}
```

Tomorrow we'll dive deeper into KQL databases and advanced patterns.

## Resources

- [Real-Time Analytics Documentation](https://learn.microsoft.com/en-us/fabric/real-time-analytics/overview)
- [KQL Quick Reference](https://learn.microsoft.com/en-us/azure/data-explorer/kql-quick-reference)
- [Eventstream Documentation](https://learn.microsoft.com/en-us/fabric/real-time-analytics/event-streams/overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
