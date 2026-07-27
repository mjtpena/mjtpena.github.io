---
title: "Azure IoT Central: Managed IoT Platform"
author: Michael John Peña
draft: false
date: 2020-12-25
tags:
  - Azure
  - IoT
  - IoT Central
  - Managed Services
---

Christmas Day, and a quiet thought from a quiet house: most "IoT projects" never get past slide three because the team doesn't have the platform to back the demo. IoT Central is the on-ramp I keep recommending. Pick a device template, ship a handful of devices, point them at the application, and you have dashboards, rules, and exports working before lunch. It's not a replacement for IoT Hub when you need full custom platform work—but it's the right place to validate whether a use case is even real before investing.

## IoT Central vs IoT Hub

| Feature | IoT Central | IoT Hub |
|---------|-------------|---------|
| Management | Fully managed | Self-managed |
| UI | Built-in dashboards | Build your own |
| Device templates | Visual designer | Code-based |
| Rules | No-code rules | Functions/Stream Analytics |
| Best for | Quick deployment | Full customization |

## Create IoT Central App

```bash
az iot central app create \
    --name my-iot-app \
    --resource-group myRG \
    --subdomain my-iot-app \
    --sku ST2 \
    --template iotc-pnp-preview \
    --display-name "My IoT Application"
```

## Device Templates

Define device capabilities:

```json
{
    "@type": "Interface",
    "@context": "dtmi:dtdl:context;2",
    "@id": "dtmi:mycompany:TemperatureSensor;1",
    "displayName": "Temperature Sensor",
    "contents": [
        {
            "@type": "Telemetry",
            "name": "temperature",
            "schema": "double",
            "displayName": "Temperature",
            "unit": "degreeCelsius"
        },
        {
            "@type": "Telemetry",
            "name": "humidity",
            "schema": "double",
            "displayName": "Humidity",
            "unit": "percent"
        },
        {
            "@type": "Property",
            "name": "firmwareVersion",
            "schema": "string",
            "displayName": "Firmware Version"
        },
        {
            "@type": "Property",
            "name": "targetTemperature",
            "schema": "double",
            "displayName": "Target Temperature",
            "writable": true
        },
        {
            "@type": "Command",
            "name": "reboot",
            "displayName": "Reboot Device",
            "request": {
                "name": "delay",
                "schema": "integer"
            }
        }
    ]
}
```

## Device Connectivity

```python
import asyncio
from azure.iot.device.aio import IoTHubDeviceClient
from azure.iot.device import Message

# Connect using device connection string
device_client = IoTHubDeviceClient.create_from_connection_string(connection_string)
await device_client.connect()

# Send telemetry
async def send_telemetry():
    while True:
        telemetry = {
            "temperature": 22.5,
            "humidity": 65
        }
        msg = Message(json.dumps(telemetry))
        msg.content_type = "application/json"
        msg.content_encoding = "utf-8"
        await device_client.send_message(msg)
        await asyncio.sleep(10)

# Handle commands
async def command_handler(command):
    if command.name == "reboot":
        delay = command.payload.get("delay", 0)
        print(f"Rebooting in {delay} seconds")
        return {"status": "success"}

device_client.on_command_request_received = command_handler

# Report properties
await device_client.patch_twin_reported_properties({
    "firmwareVersion": "1.2.3"
})
```

## Rules and Actions

Define rules in IoT Central:

```
Rule: High Temperature Alert
Condition: temperature > 30 for 5 minutes
Actions:
  - Send email to operators@company.com
  - Call webhook: https://api.company.com/alerts
  - Run Azure Logic App
```

## Data Export

```json
{
    "destinations": [
        {
            "id": "blob-storage",
            "type": "blobstorage@v1",
            "connectionString": "DefaultEndpointsProtocol=https;..."
        },
        {
            "id": "event-hubs",
            "type": "eventhubs@v1",
            "connectionString": "Endpoint=sb://..."
        }
    ],
    "exports": [
        {
            "displayName": "Telemetry Export",
            "enabled": true,
            "source": "telemetry",
            "destination": "blob-storage"
        }
    ]
}
```

## Dashboards

Built-in visualizations:
- Line/bar charts
- KPIs and gauges
- Maps
- Tables
- Device images

## Device Groups

```
Groups:
├── All Devices
├── Production Floor
│   ├── Line 1 Sensors
│   └── Line 2 Sensors
└── Testing
    └── Lab Devices
```

## Jobs

```json
{
    "displayName": "Update Firmware",
    "group": "all-sensors",
    "data": [
        {
            "type": "property",
            "target": "firmwareVersion",
            "value": "2.0.0"
        }
    ]
}
```

## REST API

```bash
# Get devices
curl -X GET \
    "https://my-iot-app.azureiotcentral.com/api/devices" \
    -H "Authorization: SharedAccessSignature sr=..."

# Send command
curl -X POST \
    "https://my-iot-app.azureiotcentral.com/api/devices/{deviceId}/commands/reboot" \
    -H "Authorization: SharedAccessSignature sr=..." \
    -H "Content-Type: application/json" \
    -d '{"request": {"delay": 5}}'
```

IoT Central: from concept to connected solution in minutes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
