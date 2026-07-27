---
title: "Azure Digital Twins: Model the Physical World"
author: Michael John Peña
draft: false
date: 2020-11-01
tags:
  - Azure
  - IoT
  - Digital Twins
  - Modeling
---

A facility manager I worked with last year asked the same question every IoT pitch eventually triggers: "great, you can stream sensor data—but can you tell me about the *building*?" Azure Digital Twins is the answer Microsoft has been building toward. You model rooms, floors, equipment, and the relationships between them, then map telemetry onto the model. It stops being "events from device 0x47" and starts being "Level 3 west wing is 4 degrees over setpoint."

## Digital Twin Definition Language (DTDL)

```json
{
    "@id": "dtmi:example:Room;1",
    "@type": "Interface",
    "displayName": "Room",
    "contents": [
        {
            "@type": "Property",
            "name": "temperature",
            "schema": "double"
        },
        {
            "@type": "Property",
            "name": "humidity",
            "schema": "double"
        },
        {
            "@type": "Telemetry",
            "name": "occupancy",
            "schema": "integer"
        },
        {
            "@type": "Relationship",
            "name": "contains",
            "target": "dtmi:example:Device;1"
        }
    ],
    "@context": "dtmi:dtdl:context;2"
}
```

## Creating Twins

```python
from azure.digitaltwins.core import DigitalTwinsClient
from azure.identity import DefaultAzureCredential

client = DigitalTwinsClient(
    "https://mytwins.api.eus.digitaltwins.azure.net",
    DefaultAzureCredential()
)

# Upload model
with open("room.json", "r") as f:
    models = [json.load(f)]
    client.create_models(models)

# Create twin instance
room_twin = {
    "$metadata": {
        "$model": "dtmi:example:Room;1"
    },
    "temperature": 72.0,
    "humidity": 45.0
}
client.upsert_digital_twin("room-101", room_twin)
```

## Twin Graph

```
Building-1
├── Floor-1
│   ├── Room-101
│   │   ├── Sensor-A (temperature)
│   │   └── Sensor-B (humidity)
│   └── Room-102
│       └── Sensor-C
└── Floor-2
    └── Room-201
        └── Sensor-D
```

## Relationships

```python
# Create relationship
relationship = {
    "$relationshipId": "floor1-contains-room101",
    "$sourceId": "floor-1",
    "$relationshipName": "contains",
    "$targetId": "room-101"
}
client.upsert_relationship("floor-1", "floor1-contains-room101", relationship)
```

## Query Language

```sql
-- Find all rooms with high temperature
SELECT * FROM digitaltwins T
WHERE IS_OF_MODEL(T, 'dtmi:example:Room;1')
AND T.temperature > 75

-- Find rooms on a specific floor
SELECT Room FROM digitaltwins Floor
JOIN Room RELATED Floor.contains
WHERE Floor.$dtId = 'floor-1'

-- Get twin with relationships
SELECT T, CT FROM digitaltwins T
JOIN CT RELATED T.contains
WHERE T.$dtId = 'building-1'
```

## Update Properties

```python
# Update twin property
patch = [
    {
        "op": "replace",
        "path": "/temperature",
        "value": 74.5
    }
]
client.update_digital_twin("room-101", patch)
```

## Event Routes

Route twin changes to other services:

```bash
# Create event route to Event Hubs
az dt route create \
    --dt-name mytwins \
    --route-name telemetry-route \
    --endpoint-name eventhub-endpoint \
    --filter "type = 'Microsoft.DigitalTwins.Twin.Update'"
```

## IoT Hub Integration

```python
# Function to process IoT telemetry and update twin
import azure.functions as func

def main(event: func.EventHubEvent):
    body = json.loads(event.get_body())
    device_id = event.iothub_metadata['connection-device-id']

    # Update corresponding twin
    patch = [
        {"op": "replace", "path": "/temperature", "value": body['temperature']}
    ]
    twins_client.update_digital_twin(device_id, patch)
```

## 3D Visualization

Integrate with Azure Maps, Power BI, or custom 3D viewers:

```javascript
// Azure Digital Twins 3D Scenes Studio
const scene = new ADT3DSceneViewer({
    sceneId: "factory-floor",
    adtInstanceUrl: "https://mytwins.api.eus.digitaltwins.azure.net"
});

scene.onTwinSelected((twin) => {
    console.log(`Selected: ${twin.$dtId}, Temp: ${twin.temperature}`);
});
```

Digital Twins bridge the physical and digital worlds.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
