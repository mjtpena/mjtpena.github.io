---
title: "Fabric Real-Time Intelligence: Building Streaming Analytics Solutions"
author: Michael John Peña
draft: false
date: 2024-01-18
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - Streaming
  - KQL
  - Eventstreams
---

I've built several streaming pipelines on Fabric; the combination of Eventstreams, KQL, and Data Activator covers most real-time needs. This post shows patterns that worked for reliability and low latency.

## Architecture Overview

```
Data Sources          Ingestion           Processing          Action
─────────────         ─────────           ──────────          ──────
IoT Devices    ─┐
Event Hubs     ─┼─→  Eventstream  ─→  KQL Database  ─→  Data Activator
Kafka          ─┤                          │               (Reflex)
Custom Apps    ─┘                          ↓                  │
                                      Power BI              ↓
                                      Real-Time         Alerts
                                      Dashboard         Actions
```

## Eventstreams Setup

### 1. Creating an Eventstream

```python
# Eventstream configuration via Fabric REST API
import requests

def create_eventstream(
    workspace_id: str,
    name: str,
    token: str
) -> dict:
    """Create a new Eventstream in Fabric."""

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/eventstreams"

    payload = {
        "displayName": name,
        "description": "Real-time data ingestion stream"
    }

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}"},
        json=payload
    )

    return response.json()

# Create eventstream
eventstream = create_eventstream(
    workspace_id="your-workspace-id",
    name="iot-telemetry-stream",
    token=access_token
)
```

### 2. Source Configuration

```json
{
  "source": {
    "type": "AzureEventHubs",
    "properties": {
      "eventHubNamespace": "your-namespace.servicebus.windows.net",
      "eventHubName": "telemetry",
      "consumerGroup": "$Default",
      "dataFormat": "JSON",
      "authentication": {
        "type": "ManagedIdentity"
      }
    }
  }
}
```

### 3. Transformations in Eventstream

```sql
-- Eventstream transformation (uses streaming SQL)

-- Filter events
SELECT *
FROM InputStream
WHERE temperature > 30

-- Aggregate over windows
SELECT
    deviceId,
    TUMBLING(eventTime, INTERVAL '5' MINUTE) as window,
    AVG(temperature) as avgTemp,
    MAX(temperature) as maxTemp,
    COUNT(*) as eventCount
FROM InputStream
GROUP BY deviceId, TUMBLING(eventTime, INTERVAL '5' MINUTE)

-- Join with reference data
SELECT
    i.deviceId,
    i.temperature,
    r.location,
    r.deviceType
FROM InputStream i
JOIN ReferenceData r ON i.deviceId = r.deviceId
```

## KQL Database Patterns

### 1. Table Schema Design

```kql
// Create optimized table for telemetry data
.create table DeviceTelemetry (
    Timestamp: datetime,
    DeviceId: string,
    Temperature: real,
    Humidity: real,
    Pressure: real,
    BatteryLevel: real,
    Location: dynamic,
    RawEvent: dynamic
)

// Create ingestion mapping
.create table DeviceTelemetry ingestion json mapping 'TelemetryMapping'
```
```
[
    {"column": "Timestamp", "path": "$.timestamp", "datatype": "datetime"},
    {"column": "DeviceId", "path": "$.deviceId", "datatype": "string"},
    {"column": "Temperature", "path": "$.sensors.temperature", "datatype": "real"},
    {"column": "Humidity", "path": "$.sensors.humidity", "datatype": "real"},
    {"column": "Pressure", "path": "$.sensors.pressure", "datatype": "real"},
    {"column": "BatteryLevel", "path": "$.battery", "datatype": "real"},
    {"column": "Location", "path": "$.location", "datatype": "dynamic"},
    {"column": "RawEvent", "path": "$", "datatype": "dynamic"}
]
```

### 2. Materialized Views

```kql
// Create materialized view for hourly aggregates
.create materialized-view HourlyDeviceStats on table DeviceTelemetry
{
    DeviceTelemetry
    | summarize
        AvgTemperature = avg(Temperature),
        MaxTemperature = max(Temperature),
        MinTemperature = min(Temperature),
        AvgHumidity = avg(Humidity),
        EventCount = count()
        by DeviceId, bin(Timestamp, 1h)
}

// Create materialized view for device health
.create materialized-view DeviceHealth on table DeviceTelemetry
{
    DeviceTelemetry
    | summarize
        LastSeen = max(Timestamp),
        LastBattery = arg_max(Timestamp, BatteryLevel),
        EventsLast24h = countif(Timestamp > ago(24h))
        by DeviceId
}
```

### 3. Real-Time Queries

```kql
// Last 15 minutes of data
DeviceTelemetry
| where Timestamp > ago(15m)
| summarize
    CurrentTemp = avg(Temperature),
    TempTrend = (avg(Temperature) - avg(prev(Temperature, 1))) / avg(prev(Temperature, 1)) * 100
    by DeviceId
| order by CurrentTemp desc

// Detect anomalies
DeviceTelemetry
| where Timestamp > ago(1h)
| summarize
    AvgTemp = avg(Temperature),
    StdTemp = stdev(Temperature)
    by DeviceId
| join kind=inner (
    DeviceTelemetry
    | where Timestamp > ago(5m)
    | summarize CurrentTemp = avg(Temperature) by DeviceId
) on DeviceId
| extend ZScore = (CurrentTemp - AvgTemp) / StdTemp
| where abs(ZScore) > 2
| project DeviceId, CurrentTemp, AvgTemp, ZScore, AnomalyType = iff(ZScore > 0, "High", "Low")

// Device connectivity status
DeviceTelemetry
| summarize LastSeen = max(Timestamp) by DeviceId
| extend
    MinutesSinceLastSeen = datetime_diff('minute', now(), LastSeen),
    Status = case(
        datetime_diff('minute', now(), LastSeen) < 5, "Online",
        datetime_diff('minute', now(), LastSeen) < 30, "Degraded",
        "Offline"
    )
| order by MinutesSinceLastSeen asc
```

## Data Activator (Reflex)

### 1. Creating Alerts

```python
# Define Data Activator trigger via API
trigger_config = {
    "name": "High Temperature Alert",
    "description": "Alert when device temperature exceeds threshold",
    "source": {
        "type": "KqlDatabase",
        "database": "TelemetryDB",
        "query": """
            DeviceTelemetry
            | where Timestamp > ago(5m)
            | where Temperature > 40
            | project DeviceId, Temperature, Timestamp
        """
    },
    "condition": {
        "type": "RowCount",
        "threshold": 1,
        "operator": "GreaterThanOrEqual"
    },
    "actions": [
        {
            "type": "Email",
            "recipients": ["ops-team@company.com"],
            "subject": "High Temperature Alert - {{DeviceId}}",
            "body": "Device {{DeviceId}} reported temperature of {{Temperature}}C at {{Timestamp}}"
        },
        {
            "type": "Teams",
            "webhookUrl": "https://company.webhook.office.com/...",
            "message": "Temperature alert for device {{DeviceId}}: {{Temperature}}C"
        }
    ],
    "schedule": {
        "frequency": "Every5Minutes"
    }
}
```

### 2. Custom Action Integration

```python
# Send alerts to custom endpoints
from azure.functions import FunctionApp
import json
import requests

app = FunctionApp()

@app.function_name("ProcessReflexAlert")
@app.route(route="alert")
def process_alert(req):
    """Process incoming Reflex alert and take action."""

    alert_data = req.get_json()

    device_id = alert_data.get("DeviceId")
    temperature = alert_data.get("Temperature")

    # Custom business logic
    if temperature > 50:
        # Critical - trigger immediate action
        trigger_emergency_shutdown(device_id)
        notify_on_call_engineer(device_id, temperature)

    elif temperature > 40:
        # Warning - log and monitor
        log_warning(device_id, temperature)
        update_monitoring_dashboard(device_id, "warning")

    return json.dumps({"status": "processed"})

def trigger_emergency_shutdown(device_id: str):
    """Send shutdown command to device."""
    requests.post(
        f"https://device-api.company.com/devices/{device_id}/shutdown",
        headers={"Authorization": f"Bearer {device_api_token}"}
    )
```

## Power BI Real-Time Dashboard

### 1. KQL as DirectQuery Source

```kql
// Query optimized for real-time dashboard

// Current status card
DeviceTelemetry
| where Timestamp > ago(5m)
| summarize
    ActiveDevices = dcount(DeviceId),
    AvgTemperature = avg(Temperature),
    AlertCount = countif(Temperature > 40)

// Time series for chart
DeviceTelemetry
| where Timestamp > ago(1h)
| summarize AvgTemp = avg(Temperature) by bin(Timestamp, 1m)
| order by Timestamp asc

// Device status table
DeviceTelemetry
| summarize
    LastSeen = max(Timestamp),
    LastTemp = arg_max(Timestamp, Temperature),
    LastBattery = arg_max(Timestamp, BatteryLevel)
    by DeviceId
| extend Status = iff(LastSeen > ago(5m), "Online", "Offline")
| project DeviceId, Status, Temperature = LastTemp, Battery = LastBattery, LastSeen
| order by Status asc, DeviceId asc
```

### 2. Auto-Refresh Configuration

```json
{
  "reportSettings": {
    "autoRefresh": {
      "enabled": true,
      "interval": "30s",
      "showTimestamp": true
    },
    "filterPane": {
      "timeRange": {
        "default": "Last1Hour",
        "options": ["Last15Minutes", "Last1Hour", "Last24Hours"]
      }
    }
  }
}
```

## End-to-End Example: IoT Monitoring

```python
# Complete IoT monitoring pipeline

# 1. Simulate IoT data (for testing)
import json
import random
from datetime import datetime
from azure.eventhub import EventHubProducerClient, EventData

def generate_telemetry(device_id: str) -> dict:
    return {
        "deviceId": device_id,
        "timestamp": datetime.utcnow().isoformat(),
        "sensors": {
            "temperature": random.uniform(20, 45),
            "humidity": random.uniform(30, 80),
            "pressure": random.uniform(980, 1020)
        },
        "battery": random.uniform(10, 100),
        "location": {
            "lat": 37.7749 + random.uniform(-0.1, 0.1),
            "lon": -122.4194 + random.uniform(-0.1, 0.1)
        }
    }

def send_telemetry(producer: EventHubProducerClient, count: int = 100):
    devices = [f"device-{i:03d}" for i in range(10)]

    batch = producer.create_batch()

    for _ in range(count):
        device = random.choice(devices)
        telemetry = generate_telemetry(device)
        batch.add(EventData(json.dumps(telemetry)))

    producer.send_batch(batch)
    print(f"Sent {count} events")

# 2. KQL queries for monitoring
monitoring_queries = {
    "device_count": """
        DeviceTelemetry
        | where Timestamp > ago(5m)
        | summarize dcount(DeviceId)
    """,

    "anomalies": """
        DeviceTelemetry
        | where Timestamp > ago(1h)
        | summarize avg_temp = avg(Temperature), std_temp = stdev(Temperature) by DeviceId
        | join kind=inner (
            DeviceTelemetry | where Timestamp > ago(5m) | summarize current_temp = avg(Temperature) by DeviceId
        ) on DeviceId
        | where abs(current_temp - avg_temp) > 2 * std_temp
    """,

    "trend": """
        DeviceTelemetry
        | where Timestamp > ago(24h)
        | summarize avg(Temperature) by bin(Timestamp, 1h)
        | order by Timestamp asc
    """
}

# 3. Alert configuration
alert_config = {
    "high_temp": {
        "query": "DeviceTelemetry | where Timestamp > ago(5m) | where Temperature > 40",
        "threshold": 1,
        "action": "email"
    },
    "device_offline": {
        "query": """
            DeviceTelemetry
            | summarize LastSeen = max(Timestamp) by DeviceId
            | where LastSeen < ago(30m)
        """,
        "threshold": 1,
        "action": "teams"
    }
}
```

## Best Practices

1. **Design for scale** - Partition data by time, use materialized views
2. **Optimize queries** - Filter early, aggregate efficiently
3. **Handle late arrivals** - Use watermarks and windowing
4. **Monitor pipeline health** - Track latency and throughput
5. **Plan retention** - Set appropriate data retention policies

## Conclusion

Fabric Real-Time Intelligence provides a complete streaming analytics stack. The key is understanding how Eventstreams, KQL databases, and Data Activator work together. Start with simple pipelines and add complexity as needed. The platform handles the heavy lifting of stream processing at scale.
