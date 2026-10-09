---
title: "Microsoft Fabric June 2024 Updates: Real-Time Intelligence GA"
description: "Real-Time Intelligence is Fabric's answer to streaming analytics, combining the power of Azure Data Explorer with the unified Fabric experience."
author: Michael John Peña
draft: false
date: 2024-06-01
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - Data Platform
  - Azure
  - Analytics
---

## Real-Time Intelligence GA

Real-Time Intelligence is Fabric's answer to streaming analytics, combining the power of Azure Data Explorer with the unified Fabric experience.

### Key Components

```
Real-Time Intelligence:
├── Eventhouses (data storage)
├── KQL Querysets (analysis)
├── Real-time Dashboards (visualization)
└── Data Activator (automation)
```

## Getting Started with Real-Time Intelligence

### Creating an Eventhouse

```python
# Using Fabric REST API
import requests

fabric_endpoint = "https://api.fabric.microsoft.com/v1"
workspace_id = "your-workspace-id"

# Create Eventhouse
response = requests.post(
    f"{fabric_endpoint}/workspaces/{workspace_id}/eventhouses",
    headers={"Authorization": f"Bearer {access_token}"},
    json={
        "displayName": "IoTEventhouse",
        "description": "Eventhouse for IoT sensor data"
    }
)

eventhouse_id = response.json()["id"]
print(f"Created Eventhouse: {eventhouse_id}")
```

### Ingesting Data

```python
from azure.kusto.data import KustoConnectionStringBuilder
from azure.kusto.ingest import QueuedIngestClient, IngestionProperties

# Connect to Eventhouse
kcsb = KustoConnectionStringBuilder.with_aad_application_key_authentication(
    f"https://{eventhouse_name}.kusto.fabric.microsoft.com",
    client_id,
    client_secret,
    tenant_id
)

ingest_client = QueuedIngestClient(kcsb)

# Ingest from blob
ingestion_props = IngestionProperties(
    database="IoTDatabase",
    table="SensorReadings",
    data_format="json"
)

ingest_client.ingest_from_blob(
    "https://storage.blob.core.windows.net/data/sensors.json",
    ingestion_properties=ingestion_props
)
```

### Streaming Ingestion

```python
from azure.kusto.data import KustoClient

client = KustoClient(kcsb)

# Enable streaming ingestion
client.execute_mgmt(
    "IoTDatabase",
    ".alter table SensorReadings policy streamingingestion enable"
)

# Stream data directly
data = [
    {"timestamp": "2024-06-01T10:00:00Z", "sensor_id": "S001", "value": 23.5},
    {"timestamp": "2024-06-01T10:00:01Z", "sensor_id": "S002", "value": 45.2}
]

import json
json_data = "\n".join(json.dumps(row) for row in data)

client.execute_streaming_ingest(
    "IoTDatabase",
    "SensorReadings",
    json_data,
    "json"
)
```

## KQL Queries in Fabric

### Basic KQL

```kusto
// Get recent sensor readings
SensorReadings
| where timestamp > ago(1h)
| summarize avg(value) by sensor_id, bin(timestamp, 5m)
| order by timestamp desc

// Detect anomalies
SensorReadings
| where timestamp > ago(24h)
| summarize avg_value = avg(value), stdev_value = stdev(value) by sensor_id
| join kind=inner (
    SensorReadings
    | where timestamp > ago(1h)
) on sensor_id
| where value > avg_value + 3 * stdev_value or value < avg_value - 3 * stdev_value
| project timestamp, sensor_id, value, avg_value, deviation = abs(value - avg_value) / stdev_value
```

### Time Series Analysis

```kusto
// Moving average
SensorReadings
| where timestamp > ago(7d)
| make-series avg_value = avg(value) on timestamp step 1h by sensor_id
| extend moving_avg = series_fir(avg_value, repeat(1, 24), true, true)
| mv-expand timestamp to typeof(datetime), avg_value to typeof(real), moving_avg to typeof(real)

// Seasonality detection
SensorReadings
| where timestamp > ago(30d)
| make-series value = avg(value) on timestamp step 1h by sensor_id
| extend (seasonal, trend, residual) = series_decompose(value)
| mv-expand timestamp to typeof(datetime), value, seasonal, trend, residual
```

### Forecasting

```kusto
// Predict next 24 hours
SensorReadings
| where timestamp > ago(7d)
| make-series value = avg(value) on timestamp step 1h by sensor_id
| extend forecast = series_decompose_forecast(value, 24)
| mv-expand timestamp to typeof(datetime), value to typeof(real), forecast to typeof(real)
| project timestamp, sensor_id, value, forecast
```

## Real-Time Dashboards

### Creating a Dashboard

```python
# Create real-time dashboard via API
dashboard_config = {
    "displayName": "IoT Monitoring Dashboard",
    "tiles": [
        {
            "title": "Current Readings",
            "query": """
                SensorReadings
                | where timestamp > ago(5m)
                | summarize latest_value = arg_max(timestamp, value) by sensor_id
            """,
            "visualization": "table"
        },
        {
            "title": "Trend (Last Hour)",
            "query": """
                SensorReadings
                | where timestamp > ago(1h)
                | summarize avg(value) by bin(timestamp, 1m)
            """,
            "visualization": "timechart"
        },
        {
            "title": "Anomaly Count",
            "query": """
                SensorReadings
                | where timestamp > ago(1h)
                | where value > 100 or value < 0
                | count
            """,
            "visualization": "stat"
        }
    ]
}

response = requests.post(
    f"{fabric_endpoint}/workspaces/{workspace_id}/dashboards",
    headers={"Authorization": f"Bearer {access_token}"},
    json=dashboard_config
)
```

### Auto-Refresh Configuration

```json
{
  "autoRefresh": {
    "enabled": true,
    "minInterval": "30s",
    "defaultInterval": "1m"
  },
  "parameters": [
    {
      "name": "timeRange",
      "type": "timespan",
      "default": "1h"
    },
    {
      "name": "sensorId",
      "type": "string",
      "default": "*"
    }
  ]
}
```

## Integration with Other Fabric Components

### From Lakehouse to Eventhouse

```kusto
// Create external table from Lakehouse
.create external table LakehouseData (
    id: string,
    timestamp: datetime,
    data: dynamic
)
kind=delta
(
    h@'abfss://container@account.dfs.fabric.microsoft.com/lakehouse/Tables/events'
)

// Query across Eventhouse and Lakehouse
let historical = external_table('LakehouseData') | where timestamp < ago(7d);
let recent = SensorReadings | where timestamp >= ago(7d);
union historical, recent
| summarize count() by bin(timestamp, 1d)
```

### Event Streams Integration

```python
# Create Event Stream to Eventhouse
eventstream_config = {
    "displayName": "IoT Event Stream",
    "source": {
        "type": "EventHub",
        "connectionString": event_hub_connection,
        "consumerGroup": "$Default"
    },
    "destination": {
        "type": "Eventhouse",
        "eventhouseId": eventhouse_id,
        "database": "IoTDatabase",
        "table": "SensorReadings"
    },
    "transformation": {
        "type": "NoTransformation"
    }
}
```

## Performance Optimization

### Materialized Views

```kusto
// Create materialized view for common aggregations
.create materialized-view HourlySummary on table SensorReadings
{
    SensorReadings
    | summarize
        avg_value = avg(value),
        min_value = min(value),
        max_value = max(value),
        count = count()
        by sensor_id, bin(timestamp, 1h)
}

// Query uses materialized view automatically
SensorReadings
| summarize avg(value) by sensor_id, bin(timestamp, 1h)
```

### Caching Policies

```kusto
// Set caching for hot data
.alter table SensorReadings policy caching hot = 7d

// Different caching per column
.alter table SensorReadings policy caching
    hot = 7d,
    hotindex = 14d
```

## Cost Considerations

| Eventhouse SKU | Compute | Storage | Use Case |
|---------------|---------|---------|----------|
| EH1 | 2 cores | 100 GB | Dev/test |
| EH2 | 4 cores | 500 GB | Small production |
| EH4 | 8 cores | 2 TB | Medium production |
| EH8 | 16 cores | 5 TB | Large production |

## What's Next

Tomorrow I'll dive deep into Eventhouses and their capabilities.

## Resources

- [Real-Time Intelligence Documentation](https://learn.microsoft.com/fabric/real-time-intelligence/)
- [KQL Reference](https://learn.microsoft.com/kusto/query/)
- [Fabric Pricing](https://azure.microsoft.com/pricing/details/microsoft-fabric/)
