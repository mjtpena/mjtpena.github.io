---
title: "Eventhouses in Microsoft Fabric: Deep Dive"
description: "Eventhouses are the foundation of Real-Time Intelligence in Fabric. Today I'm exploring their architecture and capabilities in depth."
author: Michael John Peña
draft: false
date: 2024-06-02
tags:
  - Microsoft Fabric
  - Eventhouses
  - Real-Time Analytics
  - KQL
  - Data Platform
---

Eventhouses are the foundation of Real-Time Intelligence in Fabric. Today I'm exploring their architecture and capabilities in depth.

## What is an Eventhouse?

An Eventhouse is a fully managed, scalable analytical database optimized for:
- High-velocity data ingestion
- Time-series analytics
- Log and telemetry data
- Real-time queries

Think of it as Azure Data Explorer (Kusto) integrated into the Fabric ecosystem.

## Architecture

```
Eventhouse Architecture:
├── Ingestion Layer
│   ├── Streaming ingestion (< 1s latency)
│   ├── Queued ingestion (batched)
│   └── Event Streams integration
├── Storage Layer
│   ├── Hot cache (SSD)
│   ├── Warm storage (managed)
│   └── Delta Lake integration
├── Query Engine
│   ├── KQL processor
│   ├── Materialized views
│   └── Query caching
└── Management
    ├── Auto-scaling
    ├── Retention policies
    └── Security
```

## Creating and Configuring Eventhouses

### Basic Setup

```kusto
// Create database
.create database IoTAnalytics persist (
    @"https://storage.blob.core.windows.net/container"
)

// Create table with schema
.create table SensorData (
    EventTime: datetime,
    DeviceId: string,
    SensorType: string,
    Value: real,
    Unit: string,
    Location: dynamic,
    Metadata: dynamic
)

// Set ingestion mapping
.create table SensorData ingestion json mapping 'SensorMapping'
'['
'  {"column": "EventTime", "path": "$.timestamp", "datatype": "datetime"},'
'  {"column": "DeviceId", "path": "$.device_id", "datatype": "string"},'
'  {"column": "SensorType", "path": "$.sensor_type", "datatype": "string"},'
'  {"column": "Value", "path": "$.value", "datatype": "real"},'
'  {"column": "Unit", "path": "$.unit", "datatype": "string"},'
'  {"column": "Location", "path": "$.location", "datatype": "dynamic"},'
'  {"column": "Metadata", "path": "$.metadata", "datatype": "dynamic"}'
']'
```

### Retention and Caching

```kusto
// Set retention policy (keep data for 365 days)
.alter table SensorData policy retention
```
softdelete = 365d
recoverability = disabled
```

// Set caching policy
// Hot cache: 30 days on SSD for fast queries
.alter table SensorData policy caching hot = 30d

// Show current policies
.show table SensorData policy retention
.show table SensorData policy caching
```

### Partitioning

```kusto
// Partition by DeviceId for better query performance
.alter table SensorData policy partitioning
```
{
  "PartitionKeys": [
    {
      "ColumnName": "DeviceId",
      "Kind": "Hash",
      "Properties": {
        "Function": "XxHash64",
        "MaxPartitionCount": 64
      }
    }
  ]
}
```
```

## Ingestion Patterns

### Streaming Ingestion

```python
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

kcsb = KustoConnectionStringBuilder.with_aad_application_key_authentication(
    eventhouse_uri,
    client_id,
    client_secret,
    tenant_id
)

client = KustoClient(kcsb)

# Enable streaming on table
client.execute_mgmt("IoTAnalytics", """
    .alter table SensorData policy streamingingestion enable
""")

# Stream single record
import json
from datetime import datetime

record = {
    "timestamp": datetime.utcnow().isoformat(),
    "device_id": "device001",
    "sensor_type": "temperature",
    "value": 23.5,
    "unit": "celsius",
    "location": {"lat": 47.6, "lon": -122.3},
    "metadata": {"firmware": "1.2.3"}
}

client.execute_streaming_ingest(
    "IoTAnalytics",
    "SensorData",
    json.dumps(record),
    "json",
    mapping_name="SensorMapping"
)
```

### Batch Ingestion

```python
from azure.kusto.ingest import QueuedIngestClient, IngestionProperties

ingest_client = QueuedIngestClient(kcsb)

# Ingest from Azure Blob
ingestion_props = IngestionProperties(
    database="IoTAnalytics",
    table="SensorData",
    data_format="json",
    ingestion_mapping_reference="SensorMapping",
    additional_properties={
        "ignoreFirstRecord": "false"
    }
)

# Ingest multiple blobs
blobs = [
    "https://storage.blob.core.windows.net/data/sensors_20240601.json",
    "https://storage.blob.core.windows.net/data/sensors_20240602.json"
]

for blob_uri in blobs:
    ingest_client.ingest_from_blob(
        blob_uri,
        ingestion_properties=ingestion_props
    )
```

### Event Streams Integration

```python
# Configure Event Stream to Eventhouse via REST API
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

# Create Eventstream via Fabric REST API
workspace_id = "your-workspace-id"
url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/eventstreams"

eventstream_payload = {
    "displayName": "IoT-EventStream",
    "description": "Stream IoT data to Eventhouse"
}

response = requests.post(url, headers=headers, json=eventstream_payload)
eventstream_id = response.json().get("id")

# Note: Source and destination configuration is typically done
# via the Fabric portal UI or additional REST API calls
# for the specific source (Event Hubs) and destination (Eventhouse)
print(f"Created Eventstream: {eventstream_id}")
print("Configure source and destinations in Fabric portal")
```

## Advanced KQL Queries

### Time Series Functions

```kusto
// Fill gaps in time series
SensorData
| where DeviceId == "device001"
| where EventTime > ago(1h)
| make-series Value = avg(Value) default=real(null)
    on EventTime step 1m
| extend Value = series_fill_linear(Value)

// Detect spikes
SensorData
| where EventTime > ago(24h)
| make-series Value = avg(Value) on EventTime step 5m by DeviceId
| extend (anomalies, score, baseline) = series_decompose_anomalies(Value, 1.5)
| mv-expand EventTime to typeof(datetime), Value to typeof(real),
            anomalies to typeof(int), score to typeof(real), baseline to typeof(real)
| where anomalies != 0
| project EventTime, DeviceId, Value, anomaly_score = score
```

### Machine Learning Functions

```kusto
// Clustering devices by behavior
SensorData
| where EventTime > ago(7d)
| summarize
    avg_value = avg(Value),
    std_value = stdev(Value),
    min_value = min(Value),
    max_value = max(Value)
    by DeviceId
| evaluate autocluster()

// Forecasting
SensorData
| where DeviceId == "device001"
| where EventTime > ago(30d)
| make-series Value = avg(Value) on EventTime step 1h
| extend forecast = series_decompose_forecast(Value, 24*7)  // 7 day forecast
```

### Joins and Lookups

```kusto
// Join with dimension table
let DeviceMetadata = datatable(DeviceId: string, Location: string, Type: string)
[
    "device001", "Building A", "Indoor",
    "device002", "Building B", "Outdoor"
];

SensorData
| where EventTime > ago(1h)
| lookup DeviceMetadata on DeviceId
| summarize avg(Value) by Location, Type
```

## Materialized Views

```kusto
// Create materialized view for hourly aggregations
.create materialized-view with (backfill=true) HourlyMetrics on table SensorData
{
    SensorData
    | summarize
        AvgValue = avg(Value),
        MinValue = min(Value),
        MaxValue = max(Value),
        Count = count()
        by DeviceId, SensorType, bin(EventTime, 1h)
}

// Query benefits from materialized view automatically
SensorData
| summarize avg(Value) by DeviceId, bin(EventTime, 1h)
// KQL engine uses HourlyMetrics instead of scanning raw data
```

## Security Configuration

```kusto
// Create function with row-level security
.create function with (view=true, docstring="Filtered sensor data")
FilteredSensorData() {
    SensorData
    | where DeviceId in (
        current_principal_details()["ObjectId"] == "admin-id"
        ? SensorData | distinct DeviceId
        : DevicePermissions | where UserId == current_principal_details()["ObjectId"] | project DeviceId
    )
}

// Set row level security policy
.alter table SensorData policy row_level_security enable "FilteredSensorData"
```

## Monitoring and Diagnostics

```kusto
// Query performance statistics
.show queries
| where StartedOn > ago(1h)
| summarize
    count(),
    avg(Duration),
    percentile(Duration, 95),
    sum(CacheStatistics.Memory.Hits)
    by User

// Ingestion statistics
.show ingestion failures
| where FailedOn > ago(24h)
| summarize count() by ErrorCode, Table

// Storage usage
.show database IoTAnalytics extents
| summarize
    TotalSize = sum(ExtentSize),
    RowCount = sum(RowCount),
    ExtentCount = count()
    by TableName
```

## Best Practices

1. **Use streaming for low-latency** - When sub-second ingestion matters
2. **Batch for high volume** - More efficient for large data loads
3. **Set appropriate caching** - Balance performance and cost
4. **Create materialized views** - Pre-aggregate common queries
5. **Monitor ingestion failures** - Catch issues early

## What's Next

Tomorrow I'll cover KQL querysets and advanced querying patterns.

## Resources

- [Eventhouse Documentation](https://learn.microsoft.com/fabric/real-time-intelligence/eventhouse)
- [KQL Quick Reference](https://learn.microsoft.com/kusto/query/kql-quick-reference)
- [Data Ingestion Best Practices](https://learn.microsoft.com/azure/data-explorer/ingest-data-overview)
