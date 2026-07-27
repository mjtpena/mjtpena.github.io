---
title: "Azure Time Series Insights: IoT Analytics at Scale"
author: Michael John Peña
draft: false
date: 2020-11-09
tags:
  - Azure
  - IoT
  - Time Series
  - Analytics
---

A general-purpose database can store time-stamped data. It just gets sad about it once you're past a few hundred million rows and someone wants a five-year heatmap. Time Series Insights is purpose-built for the shape IoT actually produces: high-cardinality, append-heavy, queried by time window. I've used it for plant telemetry where we needed "last 30 days, by sensor, by minute" to render in a browser without crying. TSI was built for that.

## Architecture

```
IoT Devices → IoT Hub → Time Series Insights → Power BI / Apps
                ↓
           Event Hubs
```

## Creating TSI Environment

```bash
# Create Gen2 environment
az tsi environment gen2 create \
    --name my-tsi \
    --resource-group myRG \
    --location eastus \
    --sku name=L1 capacity=1 \
    --time-series-id-properties "[{\"name\":\"deviceId\",\"type\":\"String\"}]" \
    --storage-configuration account-name=mystorageaccount management-key=xxx
```

## Time Series ID

Choose carefully—immutable after creation:

```json
// Single property
"timeSeriesIdProperties": [
    {"name": "deviceId", "type": "String"}
]

// Composite (up to 3 properties)
"timeSeriesIdProperties": [
    {"name": "plantId", "type": "String"},
    {"name": "lineId", "type": "String"},
    {"name": "deviceId", "type": "String"}
]
```

## Event Source (IoT Hub)

```bash
az tsi event-source iothub create \
    --environment-name my-tsi \
    --name iothub-source \
    --resource-group myRG \
    --location eastus \
    --consumer-group tsi-consumer \
    --iot-hub-name my-iothub \
    --key-name iothubowner \
    --shared-access-key xxx \
    --timestamp-property-name eventTimestamp
```

## Time Series Model

### Types (Templates)

```json
{
    "id": "sensor-type-001",
    "name": "Temperature Sensor",
    "description": "Standard temperature sensor",
    "variables": {
        "temperature": {
            "kind": "numeric",
            "value": {"tsx": "$event.temperature"},
            "aggregation": {"tsx": "avg($value)"}
        },
        "status": {
            "kind": "categorical",
            "value": {"tsx": "$event.status"},
            "categories": [
                {"label": "Normal", "values": [0]},
                {"label": "Warning", "values": [1]},
                {"label": "Critical", "values": [2]}
            ]
        }
    }
}
```

### Hierarchies

```json
{
    "id": "facility-hierarchy",
    "name": "Facility Location",
    "source": {
        "instanceFieldNames": ["facility", "building", "floor", "room"]
    }
}
```

### Instances

```json
{
    "timeSeriesId": ["device-001"],
    "name": "Sensor A",
    "typeId": "sensor-type-001",
    "hierarchyIds": ["facility-hierarchy"],
    "instanceFields": {
        "facility": "Seattle",
        "building": "Building A",
        "floor": "1",
        "room": "Server Room"
    }
}
```

## Query API

```python
import requests

# Get access token
token_url = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
token_response = requests.post(token_url, data={
    "client_id": client_id,
    "client_secret": client_secret,
    "scope": "https://api.timeseries.azure.com/.default",
    "grant_type": "client_credentials"
})
access_token = token_response.json()["access_token"]

# Query time series
query_url = f"https://{env_fqdn}/timeseries/query?api-version=2020-07-31"
query = {
    "getSeries": {
        "timeSeriesId": ["device-001"],
        "searchSpan": {
            "from": "2020-11-01T00:00:00Z",
            "to": "2020-11-09T00:00:00Z"
        },
        "inlineVariables": {
            "avgTemp": {
                "kind": "numeric",
                "value": {"tsx": "$event.temperature"},
                "aggregation": {"tsx": "avg($value)"}
            }
        },
        "projectedVariables": ["avgTemp"]
    }
}

response = requests.post(query_url,
    headers={"Authorization": f"Bearer {access_token}"},
    json=query
)
```

## Aggregate Queries

```json
{
    "aggregateSeries": {
        "timeSeriesId": ["device-001"],
        "searchSpan": {"from": "2020-11-01", "to": "2020-11-09"},
        "interval": "PT1H",
        "inlineVariables": {
            "avgTemp": {
                "kind": "numeric",
                "value": {"tsx": "$event.temperature"},
                "aggregation": {"tsx": "avg($value)"}
            },
            "maxTemp": {
                "kind": "numeric",
                "value": {"tsx": "$event.temperature"},
                "aggregation": {"tsx": "max($value)"}
            }
        }
    }
}
```

## Warm vs Cold Store

| Warm Store | Cold Store |
|------------|------------|
| 7-31 days retention | Unlimited |
| Fast queries | Lower cost |
| Included in SKU | ADLS Gen2 |

Time Series Insights: IoT analytics made accessible.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
