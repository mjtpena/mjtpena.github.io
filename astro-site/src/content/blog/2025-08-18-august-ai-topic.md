---
title: "Real-Time Data Processing with Microsoft Fabric Eventstreams"
author: Michael John Peña
draft: false
date: 2025-08-18
tags:
  - Microsoft Fabric
  - Eventstreams
  - Real-Time Analytics
  - Streaming
  - Data Engineering

---

I wrote "Real-Time Data Processing with Microsoft Fabric Eventstreams" to share practical, production-minded guidance on this topic.

## Creating an Eventstream

Eventstreams support multiple source types including Azure Event Hubs, Azure IoT Hub, and custom applications. The visual designer makes it easy to configure transformations without writing code.

## Processing Events with KQL

Once events reach an Eventhouse, use Kusto Query Language (KQL) for real-time analytics.

```kql
// Real-time aggregation of IoT sensor data
SensorEvents
| where ingestion_time() > ago(5m)
| summarize
    AvgTemperature = avg(temperature),
    MaxTemperature = max(temperature),
    MinTemperature = min(temperature),
    ReadingCount = count()
    by bin(timestamp, 1m), device_id
| order by timestamp desc

// Anomaly detection using series analysis
SensorEvents
| where timestamp > ago(1h)
| make-series AvgTemp = avg(temperature) on timestamp step 1m by device_id
| extend anomalies = series_decompose_anomalies(AvgTemp)
| mv-expand timestamp, AvgTemp, anomalies
| where anomalies > 1.5
| project timestamp, device_id, AvgTemp, AnomalyScore = anomalies
```

## Configuring Destinations

```python
# Python SDK for sending events to Eventstream
from azure.eventhub import EventHubProducerClient, EventData
import json

producer = EventHubProducerClient.from_connection_string(
    conn_str=connection_string,
    eventhub_name=eventhub_name
)

async def send_telemetry(device_id: str, readings: dict):
    event_data = EventData(json.dumps({
        "device_id": device_id,
        "timestamp": datetime.utcnow().isoformat(),
        **readings
    }))

    async with producer:
        batch = await producer.create_batch()
        batch.add(event_data)
        await producer.send_batch(batch)
```

## Real-Time Dashboards

Connect Eventstreams to Power BI for live dashboards that update as events flow through the system. The combination of Eventstreams, Eventhouse, and Power BI creates a complete real-time analytics solution within Fabric.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
