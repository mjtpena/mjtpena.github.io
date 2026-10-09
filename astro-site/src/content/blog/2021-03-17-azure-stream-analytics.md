---
title: Azure Stream Analytics for Real-Time Data Processing
description: "Azure Stream Analytics sits in a specific niche that I've come to appreciate: SQL-native stream processing for teams who shouldn't have to learn Spark or…"
author: Michael John Pena
draft: false
date: 2021-03-17
url: /blog/azure-stream-analytics/
tags:
  - Azure
  - Stream Analytics
  - Real-Time
  - IoT
  - Event Processing
---

Azure Stream Analytics sits in a specific niche that I've come to appreciate: SQL-native stream processing for teams who shouldn't have to learn Spark or Flink. If you have an IoT Hub or Event Hubs stream and you need to filter, aggregate over a tumbling window, join with reference data, and route results to Blob Storage or Cosmos DB—all of that is a fifteen-line ASA query. No cluster to manage, no JARs to deploy, pay-per-unit-of-streaming. The limitation is expressiveness: complex ML inference, stateful pattern detection, and custom aggregations push you toward Spark Structured Streaming or Azure Functions. Within its domain, ASA is remarkably efficient to operate.

## Creating a Stream Analytics Job

```bash
# Create Stream Analytics job
az stream-analytics job create \
    --resource-group myResourceGroup \
    --name myStreamJob \
    --location eastus \
    --output-error-policy Stop \
    --events-outoforder-policy Adjust \
    --events-outoforder-max-delay-in-seconds 5 \
    --events-late-arrival-max-delay-in-seconds 10 \
    --data-locale "en-US" \
    --compatibility-level "1.2" \
    --sku Standard
```

## Input Configuration

### Event Hubs Input

```json
{
  "name": "EventHubInput",
  "properties": {
    "type": "Stream",
    "datasource": {
      "type": "Microsoft.ServiceBus/EventHub",
      "properties": {
        "serviceBusNamespace": "myeventhubnamespace",
        "sharedAccessPolicyName": "RootManageSharedAccessKey",
        "sharedAccessPolicyKey": "...",
        "eventHubName": "myeventhub",
        "consumerGroupName": "$Default"
      }
    },
    "serialization": {
      "type": "Json",
      "properties": {
        "encoding": "UTF8"
      }
    }
  }
}
```

### IoT Hub Input

```json
{
  "name": "IoTHubInput",
  "properties": {
    "type": "Stream",
    "datasource": {
      "type": "Microsoft.Devices/IotHubs",
      "properties": {
        "iotHubNamespace": "myiothub",
        "sharedAccessPolicyName": "iothubowner",
        "sharedAccessPolicyKey": "...",
        "consumerGroupName": "$Default",
        "endpoint": "messages/events"
      }
    },
    "serialization": {
      "type": "Json",
      "properties": {
        "encoding": "UTF8"
      }
    }
  }
}
```

### Reference Data Input

```json
{
  "name": "ProductReference",
  "properties": {
    "type": "Reference",
    "datasource": {
      "type": "Microsoft.Storage/Blob",
      "properties": {
        "storageAccounts": [
          {
            "accountName": "mystorageaccount",
            "accountKey": "..."
          }
        ],
        "container": "reference",
        "pathPattern": "products/{date}/{time}/products.json",
        "dateFormat": "yyyy/MM/dd",
        "timeFormat": "HH"
      }
    },
    "serialization": {
      "type": "Json",
      "properties": {
        "encoding": "UTF8"
      }
    }
  }
}
```

## Stream Analytics Query Language

### Basic Queries

```sql
-- Simple passthrough
SELECT *
FROM EventHubInput

-- Filter and transform
SELECT
    deviceId,
    temperature,
    humidity,
    CAST(eventTime AS datetime) AS eventTime,
    System.Timestamp() AS processingTime
FROM IoTHubInput
WHERE temperature > 30

-- Type conversion
SELECT
    CAST(deviceId AS nvarchar(max)) AS deviceId,
    CAST(temperature AS float) AS temperature,
    TRY_CAST(humidity AS float) AS humidity
FROM IoTHubInput
```

### Windowed Aggregations

```sql
-- Tumbling window (non-overlapping)
SELECT
    deviceId,
    System.Timestamp() AS windowEnd,
    AVG(temperature) AS avgTemperature,
    MAX(temperature) AS maxTemperature,
    MIN(temperature) AS minTemperature,
    COUNT(*) AS readingCount
FROM IoTHubInput
TIMESTAMP BY eventTime
GROUP BY deviceId, TumblingWindow(minute, 5)

-- Hopping window (overlapping)
SELECT
    deviceId,
    System.Timestamp() AS windowEnd,
    AVG(temperature) AS avgTemperature
FROM IoTHubInput
TIMESTAMP BY eventTime
GROUP BY deviceId, HoppingWindow(minute, 10, 5)  -- 10 min window, 5 min hop

-- Sliding window (event-triggered)
SELECT
    deviceId,
    System.Timestamp() AS windowEnd,
    AVG(temperature) AS avgTemperature
FROM IoTHubInput
TIMESTAMP BY eventTime
GROUP BY deviceId, SlidingWindow(minute, 5)

-- Session window (gap-based)
SELECT
    userId,
    System.Timestamp() AS sessionEnd,
    COUNT(*) AS clickCount,
    DATEDIFF(second, MIN(eventTime), MAX(eventTime)) AS sessionDurationSeconds
FROM ClickStream
TIMESTAMP BY eventTime
GROUP BY userId, SessionWindow(minute, 10, 30)  -- timeout 10 min, max 30 min
```

### Temporal Joins

```sql
-- Stream-stream join with time bounds
SELECT
    clicks.clickId,
    impressions.impressionId,
    impressions.adId,
    impressions.userId,
    DATEDIFF(second, impressions.eventTime, clicks.eventTime) AS timeToClick
FROM ClickStream clicks
TIMESTAMP BY clicks.eventTime
JOIN ImpressionStream impressions
TIMESTAMP BY impressions.eventTime
ON clicks.impressionId = impressions.impressionId
AND DATEDIFF(minute, impressions, clicks) BETWEEN 0 AND 30

-- Stream to reference join
SELECT
    sensor.deviceId,
    sensor.temperature,
    device.location,
    device.deviceType,
    device.threshold
FROM IoTHubInput sensor
TIMESTAMP BY sensor.eventTime
JOIN DeviceReference device
ON sensor.deviceId = device.deviceId
```

### Pattern Detection (MATCH_RECOGNIZE)

```sql
-- Detect temperature spike pattern
SELECT *
FROM IoTHubInput
TIMESTAMP BY eventTime
MATCH_RECOGNIZE (
    PARTITION BY deviceId
    ORDER BY eventTime
    MEASURES
        FIRST(A.temperature) AS startTemp,
        LAST(B.temperature) AS peakTemp,
        FIRST(A.eventTime) AS startTime,
        LAST(C.eventTime) AS endTime
    PATTERN (A+ B+ C+)
    DEFINE
        A AS A.temperature < 50,
        B AS B.temperature >= 50 AND B.temperature > PREV(B.temperature),
        C AS C.temperature < PREV(C.temperature)
) AS spikes
```

### Anomaly Detection (Built-in ML)

```sql
-- Spike and dip detection
SELECT
    deviceId,
    eventTime,
    temperature,
    AnomalyDetection_SpikeAndDip(temperature, 95, 120, 'spikesanddips')
        OVER(PARTITION BY deviceId LIMIT DURATION(second, 120) WHEN temperature IS NOT NULL) AS spikeAndDipScores
FROM IoTHubInput

-- Change point detection
SELECT
    deviceId,
    eventTime,
    temperature,
    AnomalyDetection_ChangePoint(temperature, 95, 120, 'spikesanddips')
        OVER(PARTITION BY deviceId LIMIT DURATION(minute, 20)) AS changePointScore
FROM IoTHubInput
```

## Output Configuration

### Azure SQL Database Output

```sql
-- Query for SQL output
SELECT
    deviceId,
    System.Timestamp() AS windowEnd,
    AVG(temperature) AS avgTemperature,
    COUNT(*) AS readingCount
INTO SqlOutput
FROM IoTHubInput
TIMESTAMP BY eventTime
GROUP BY deviceId, TumblingWindow(minute, 5)
```

### Power BI Output

```sql
-- Real-time dashboard data
SELECT
    'TotalReadings' AS metric,
    COUNT(*) AS value,
    System.Timestamp() AS timestamp
INTO PowerBIOutput
FROM IoTHubInput
TIMESTAMP BY eventTime
GROUP BY TumblingWindow(second, 10)
```

### Azure Functions Output

```sql
-- Alerts to Azure Function
SELECT
    deviceId,
    temperature,
    eventTime,
    'HighTemperatureAlert' AS alertType
INTO FunctionOutput
FROM IoTHubInput
WHERE temperature > 80
```

### Multiple Outputs

```sql
-- Raw data to Blob Storage
SELECT *
INTO BlobOutput
FROM IoTHubInput

-- Aggregates to SQL
SELECT
    deviceId,
    System.Timestamp() AS windowEnd,
    AVG(temperature) AS avgTemp
INTO SqlOutput
FROM IoTHubInput
TIMESTAMP BY eventTime
GROUP BY deviceId, TumblingWindow(minute, 5)

-- Alerts to Event Hub
SELECT
    deviceId,
    temperature,
    'ALERT: High Temperature' AS message
INTO AlertEventHub
FROM IoTHubInput
WHERE temperature > 100
```

## User-Defined Functions (UDF)

### JavaScript UDF

```javascript
// udf_parseJson.js
function parseCustomJson(input) {
    try {
        var obj = JSON.parse(input);
        return {
            deviceId: obj.device.id,
            sensorType: obj.sensor.type,
            value: parseFloat(obj.reading.value),
            unit: obj.reading.unit
        };
    } catch (e) {
        return null;
    }
}
```

```sql
-- Use JavaScript UDF in query
SELECT
    udf.parseCustomJson(rawData) AS parsedData
FROM RawInput
WHERE udf.parseCustomJson(rawData) IS NOT NULL
```

### Azure Machine Learning UDF

```sql
-- Call Azure ML model for prediction
SELECT
    deviceId,
    temperature,
    humidity,
    AzureML.PredictMaintenance(temperature, humidity, pressure, vibration) AS maintenancePrediction
FROM IoTHubInput
```

## Error Handling and Monitoring

```bash
# Get job metrics
az stream-analytics job show \
    --resource-group myResourceGroup \
    --name myStreamJob \
    --query "properties.jobState"

# View diagnostic logs
az monitor diagnostic-settings create \
    --resource /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.StreamAnalytics/streamingjobs/{job} \
    --name "stream-analytics-diagnostics" \
    --logs '[{"category": "Execution", "enabled": true}]' \
    --workspace /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}
```

## Best Practices

1. **Partition alignment**: Match input partitions with output partitions
2. **Watermark handling**: Configure late arrival policies appropriately
3. **Testing**: Use local testing before deploying to production
4. **Monitoring**: Set up alerts on input/output events and SU utilization

```sql
-- Optimize for parallelization
SELECT
    deviceId,
    PartitionId,  -- Include partition key
    AVG(temperature) AS avgTemp
FROM IoTHubInput PARTITION BY PartitionId  -- Partition input
TIMESTAMP BY eventTime
GROUP BY deviceId, PartitionId, TumblingWindow(minute, 1)
```

## Conclusion

Azure Stream Analytics provides:
- **Low barrier to entry**: SQL-like queries for streaming
- **Built-in ML**: Anomaly detection without custom models
- **Enterprise integration**: Native connectors to Azure services
- **Serverless**: No infrastructure to manage

It's ideal for IoT scenarios, real-time dashboards, and event-driven architectures requiring quick time-to-value.
