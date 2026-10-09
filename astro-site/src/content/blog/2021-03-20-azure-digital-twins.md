---
title: Azure Digital Twins for Smart Environment Modeling
description: "Azure Digital Twins was the service that reframed how I think about IoT data. Most IoT architectures I'd built treated device telemetry as a stream: events…"
author: Michael John Pena
draft: false
date: 2021-03-20
url: /blog/azure-digital-twins/
tags:
  - Azure
  - Digital Twins
  - IoT
  - Modeling
  - Smart Buildings
---

Azure Digital Twins was the service that reframed how I think about IoT data. Most IoT architectures I'd built treated device telemetry as a stream: events in, processing, events out. Digital Twins adds a layer that matters enormously at scale—a live model of the physical environment, with the relationships between entities explicitly represented. A building where floors contain rooms, rooms contain HVAC zones, HVAC zones relate to sensors: when a sensor fires an alert, the graph tells you exactly which occupants are affected and which building systems are downstream. That relational context is what makes Digital Twins genuinely different from a time-series database with a dashboard.

## Understanding Digital Twins

Digital Twins creates a knowledge graph of your environment:
- **Models**: Define the types of entities (DTDL - Digital Twins Definition Language)
- **Twins**: Instances of models representing physical entities
- **Relationships**: Connections between twins
- **Properties**: Current state of each twin

## Setting Up Azure Digital Twins

```bash
# Create Digital Twins instance
az dt create \
    --dt-name mydigitaltwins \
    --resource-group myResourceGroup \
    --location eastus

# Assign role to yourself
az dt role-assignment create \
    --dt-name mydigitaltwins \
    --assignee "user@company.com" \
    --role "Azure Digital Twins Data Owner"

# Get endpoint
az dt show \
    --dt-name mydigitaltwins \
    --query hostName \
    --output tsv
```

## Defining Models with DTDL

```json
// Building model
{
    "@id": "dtmi:example:Building;1",
    "@type": "Interface",
    "displayName": "Building",
    "@context": "dtmi:dtdl:context;2",
    "contents": [
        {
            "@type": "Property",
            "name": "name",
            "schema": "string"
        },
        {
            "@type": "Property",
            "name": "address",
            "schema": "string"
        },
        {
            "@type": "Property",
            "name": "totalFloors",
            "schema": "integer"
        },
        {
            "@type": "Property",
            "name": "yearBuilt",
            "schema": "integer"
        },
        {
            "@type": "Relationship",
            "name": "hasFloor",
            "target": "dtmi:example:Floor;1"
        }
    ]
}

// Floor model
{
    "@id": "dtmi:example:Floor;1",
    "@type": "Interface",
    "displayName": "Floor",
    "@context": "dtmi:dtdl:context;2",
    "contents": [
        {
            "@type": "Property",
            "name": "floorNumber",
            "schema": "integer"
        },
        {
            "@type": "Property",
            "name": "totalRooms",
            "schema": "integer"
        },
        {
            "@type": "Relationship",
            "name": "hasRoom",
            "target": "dtmi:example:Room;1"
        }
    ]
}

// Room model with telemetry
{
    "@id": "dtmi:example:Room;1",
    "@type": "Interface",
    "displayName": "Room",
    "@context": "dtmi:dtdl:context;2",
    "contents": [
        {
            "@type": "Property",
            "name": "roomName",
            "schema": "string"
        },
        {
            "@type": "Property",
            "name": "roomType",
            "schema": {
                "@type": "Enum",
                "valueSchema": "string",
                "enumValues": [
                    { "name": "conference", "enumValue": "conference" },
                    { "name": "office", "enumValue": "office" },
                    { "name": "restroom", "enumValue": "restroom" },
                    { "name": "lobby", "enumValue": "lobby" }
                ]
            }
        },
        {
            "@type": "Property",
            "name": "capacity",
            "schema": "integer"
        },
        {
            "@type": ["Property", "Temperature"],
            "name": "temperature",
            "schema": "double",
            "unit": "degreeCelsius"
        },
        {
            "@type": "Property",
            "name": "humidity",
            "schema": "double"
        },
        {
            "@type": "Property",
            "name": "occupancy",
            "schema": "integer"
        },
        {
            "@type": "Relationship",
            "name": "hasSensor",
            "target": "dtmi:example:Sensor;1"
        }
    ]
}

// Sensor model
{
    "@id": "dtmi:example:Sensor;1",
    "@type": "Interface",
    "displayName": "Sensor",
    "@context": "dtmi:dtdl:context;2",
    "contents": [
        {
            "@type": "Property",
            "name": "sensorId",
            "schema": "string"
        },
        {
            "@type": "Property",
            "name": "sensorType",
            "schema": "string"
        },
        {
            "@type": "Property",
            "name": "lastReading",
            "schema": "double"
        },
        {
            "@type": "Property",
            "name": "lastReadingTime",
            "schema": "dateTime"
        },
        {
            "@type": "Property",
            "name": "batteryLevel",
            "schema": "double"
        }
    ]
}
```

## Working with Digital Twins SDK

```python
from azure.digitaltwins.core import DigitalTwinsClient
from azure.identity import DefaultAzureCredential
import json

# Connect to Digital Twins
credential = DefaultAzureCredential()
client = DigitalTwinsClient(
    "https://mydigitaltwins.api.eus.digitaltwins.azure.net",
    credential
)

# Upload models
models = [building_model, floor_model, room_model, sensor_model]
created_models = client.create_models(models)

# Create Building twin
building_twin = {
    "$metadata": {
        "$model": "dtmi:example:Building;1"
    },
    "name": "Headquarters",
    "address": "123 Main St, Seattle, WA",
    "totalFloors": 5,
    "yearBuilt": 2015
}
client.upsert_digital_twin("building-hq", building_twin)

# Create Floor twins
for floor_num in range(1, 6):
    floor_twin = {
        "$metadata": {
            "$model": "dtmi:example:Floor;1"
        },
        "floorNumber": floor_num,
        "totalRooms": 10
    }
    client.upsert_digital_twin(f"floor-{floor_num}", floor_twin)

    # Create relationship to building
    relationship = {
        "$relationshipId": f"building-hq-floor-{floor_num}",
        "$sourceId": "building-hq",
        "$relationshipName": "hasFloor",
        "$targetId": f"floor-{floor_num}"
    }
    client.upsert_relationship(
        "building-hq",
        f"building-hq-floor-{floor_num}",
        relationship
    )

# Create Room twins
room_configs = [
    {"id": "room-101", "name": "Conference A", "type": "conference", "floor": 1, "capacity": 20},
    {"id": "room-102", "name": "Executive Office", "type": "office", "floor": 1, "capacity": 1},
    {"id": "room-201", "name": "Open Space", "type": "office", "floor": 2, "capacity": 50},
]

for room in room_configs:
    room_twin = {
        "$metadata": {
            "$model": "dtmi:example:Room;1"
        },
        "roomName": room["name"],
        "roomType": room["type"],
        "capacity": room["capacity"],
        "temperature": 22.0,
        "humidity": 45.0,
        "occupancy": 0
    }
    client.upsert_digital_twin(room["id"], room_twin)

    # Relationship to floor
    client.upsert_relationship(
        f"floor-{room['floor']}",
        f"floor-{room['floor']}-{room['id']}",
        {
            "$relationshipId": f"floor-{room['floor']}-{room['id']}",
            "$sourceId": f"floor-{room['floor']}",
            "$relationshipName": "hasRoom",
            "$targetId": room["id"]
        }
    )
```

## Querying Digital Twins

```python
# Query all buildings
query = "SELECT * FROM digitaltwins WHERE IS_OF_MODEL('dtmi:example:Building;1')"
result = client.query_twins(query)
for twin in result:
    print(f"Building: {twin['name']}")

# Query rooms with high temperature
query = """
    SELECT room
    FROM digitaltwins room
    WHERE IS_OF_MODEL(room, 'dtmi:example:Room;1')
    AND room.temperature > 25
"""
hot_rooms = list(client.query_twins(query))

# Query with relationships - find all rooms in a building
query = """
    SELECT room
    FROM digitaltwins building
    JOIN floor RELATED building.hasFloor
    JOIN room RELATED floor.hasRoom
    WHERE building.$dtId = 'building-hq'
"""
rooms_in_building = list(client.query_twins(query))

# Aggregate queries
query = """
    SELECT COUNT()
    FROM digitaltwins room
    WHERE IS_OF_MODEL(room, 'dtmi:example:Room;1')
    AND room.occupancy > 0
"""
occupied_count = list(client.query_twins(query))

# Complex query with multiple conditions
query = """
    SELECT room, floor
    FROM digitaltwins floor
    JOIN room RELATED floor.hasRoom
    WHERE floor.floorNumber = 2
    AND room.roomType = 'conference'
    AND room.occupancy < room.capacity
"""
available_conference_rooms = list(client.query_twins(query))
```

## Integrating with IoT Hub

```python
# Azure Function to process IoT Hub telemetry and update Digital Twins
import azure.functions as func
from azure.digitaltwins.core import DigitalTwinsClient
from azure.identity import ManagedIdentityCredential
import json

def main(event: func.EventHubEvent):
    # Parse IoT Hub message
    body = json.loads(event.get_body().decode('utf-8'))
    device_id = event.iothub_metadata['connection-device-id']

    # Connect to Digital Twins
    credential = ManagedIdentityCredential()
    client = DigitalTwinsClient(
        "https://mydigitaltwins.api.eus.digitaltwins.azure.net",
        credential
    )

    # Find the room twin associated with this sensor
    query = f"""
        SELECT room
        FROM digitaltwins sensor
        JOIN room RELATED sensor.installedIn
        WHERE sensor.sensorId = '{device_id}'
    """
    results = list(client.query_twins(query))

    if results:
        room_id = results[0]['room']['$dtId']

        # Update room properties based on sensor data
        update_patch = []

        if 'temperature' in body:
            update_patch.append({
                "op": "replace",
                "path": "/temperature",
                "value": body['temperature']
            })

        if 'humidity' in body:
            update_patch.append({
                "op": "replace",
                "path": "/humidity",
                "value": body['humidity']
            })

        if 'occupancy' in body:
            update_patch.append({
                "op": "replace",
                "path": "/occupancy",
                "value": body['occupancy']
            })

        client.update_digital_twin(room_id, update_patch)

        # Also update sensor's last reading
        sensor_patch = [
            {"op": "replace", "path": "/lastReading", "value": body.get('temperature', 0)},
            {"op": "replace", "path": "/lastReadingTime", "value": event.enqueued_time.isoformat()}
        ]
        client.update_digital_twin(device_id, sensor_patch)
```

## Event Routing

```bash
# Create Event Grid endpoint
az dt endpoint create eventgrid \
    --dt-name mydigitaltwins \
    --endpoint-name adt-eventgrid \
    --eventgrid-resource-group myResourceGroup \
    --eventgrid-topic myeventgridtopic

# Create event route
az dt route create \
    --dt-name mydigitaltwins \
    --endpoint-name adt-eventgrid \
    --route-name adt-route \
    --filter "type = 'Microsoft.DigitalTwins.Twin.Update'"
```

## Visualization with 3D Scenes

```javascript
// 3D Scene Studio configuration (simplified example)
const sceneConfig = {
    scenes: [
        {
            id: "building-view",
            displayName: "Building Overview",
            twins: [
                {
                    twinId: "building-hq",
                    primaryTwinIdExpression: "$dtId",
                    behaviors: [
                        {
                            id: "temperature-color",
                            type: "ColorChange",
                            valueExpression: "temperature",
                            colorRanges: [
                                { min: 0, max: 18, color: "#0000FF" },  // Cold - Blue
                                { min: 18, max: 24, color: "#00FF00" }, // Normal - Green
                                { min: 24, max: 35, color: "#FF0000" }  // Hot - Red
                            ]
                        }
                    ]
                }
            ]
        }
    ]
};
```

## Best Practices

1. **Model Design**: Start with clear entity relationships
2. **Naming Conventions**: Use consistent twin and relationship IDs
3. **Query Optimization**: Index frequently queried properties
4. **Event Handling**: Use routes for downstream processing
5. **Security**: Apply least privilege with RBAC

## Conclusion

Azure Digital Twins enables sophisticated modeling of physical environments:

- **Knowledge Graph**: Rich representation of entities and relationships
- **Real-Time Updates**: Live state from IoT devices
- **Powerful Queries**: SQL-like querying across the twin graph
- **Event Integration**: React to changes in real-time
- **Visualization**: 3D scene rendering for intuitive understanding

It's the foundation for smart building, manufacturing, and infrastructure solutions.
