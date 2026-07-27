---
title: "Real-Time Analytics on Azure: Building Live Dashboards"
author: Michael John Peña
draft: false
date: 2022-06-26
tags:
  - azure
  - analytics
  - real-time
  - streaming

---

I wrote "Real-Time Analytics on Azure: Building Live Dashboards" to share practical, production-minded guidance on this topic.

## Architecture Overview

```
Event Sources -> Event Hubs -> Stream Analytics -> Power BI/Storage
     |                              |
     v                              v
  IoT Hub                    Azure Functions
```

## Event Ingestion

```csharp
using Azure.Messaging.EventHubs.Producer;

var producerClient = new EventHubProducerClient(connectionString, eventHubName);

var batch = await producerClient.CreateBatchAsync();
batch.TryAdd(new EventData(JsonSerializer.SerializeToUtf8Bytes(new
{
    deviceId = "sensor-001",
    temperature = 23.5,
    timestamp = DateTime.UtcNow
})));

await producerClient.SendAsync(batch);
```

## Stream Analytics Query

```sql
SELECT
    System.Timestamp() AS WindowEnd,
    deviceId,
    AVG(temperature) AS AvgTemperature,
    MIN(temperature) AS MinTemperature,
    MAX(temperature) AS MaxTemperature,
    COUNT(*) AS ReadingCount
INTO
    [PowerBI-Output]
FROM
    [EventHub-Input]
GROUP BY
    TumblingWindow(minute, 1),
    deviceId
HAVING
    AVG(temperature) > 30
```

## Power BI Real-Time

```javascript
// Streaming dataset push
const response = await fetch(pushUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{
        timestamp: new Date().toISOString(),
        temperature: 24.5,
        humidity: 65
    }])
});
```

## Summary

Azure's real-time analytics stack enables instant insights from millions of events per second, powering live dashboards and alerts.


