---
title: "Azure IoT Hub Updates and New Features in 2022"
description: "These IoT Hub updates enable more sophisticated device management and data processing scenarios."
author: "Michael John Peña"
draft: false
date: 2022-07-22
tags: ["Azure", "IoT Hub", "IoT", "Cloud", "Updates"]
---

## Enhanced Device Provisioning

```python
from azure.iot.device import ProvisioningDeviceClient
from azure.iot.device import IoTHubDeviceClient
import os

async def provision_device():
    """Provision a device using DPS with symmetric key"""
    provisioning_client = ProvisioningDeviceClient.create_from_symmetric_key(
        provisioning_host="global.azure-devices-provisioning.net",
        registration_id=os.environ["REGISTRATION_ID"],
        id_scope=os.environ["ID_SCOPE"],
        symmetric_key=os.environ["SYMMETRIC_KEY"]
    )

    # Register the device
    registration_result = await provisioning_client.register()

    print(f"Registration status: {registration_result.status}")
    print(f"Assigned hub: {registration_result.registration_state.assigned_hub}")
    print(f"Device ID: {registration_result.registration_state.device_id}")

    # Connect to the assigned IoT Hub
    device_client = IoTHubDeviceClient.create_from_symmetric_key(
        symmetric_key=os.environ["SYMMETRIC_KEY"],
        hostname=registration_result.registration_state.assigned_hub,
        device_id=registration_result.registration_state.device_id
    )

    await device_client.connect()
    return device_client
```

## Improved Message Routing

```json
{
    "routes": [
        {
            "name": "TelemetryToStorage",
            "source": "DeviceMessages",
            "condition": "true",
            "endpointNames": ["storageEndpoint"],
            "isEnabled": true
        },
        {
            "name": "AlertsToServiceBus",
            "source": "DeviceMessages",
            "condition": "$body.temperature > 30",
            "endpointNames": ["alertServiceBus"],
            "isEnabled": true
        },
        {
            "name": "LifecycleEvents",
            "source": "DeviceLifecycleEvents",
            "condition": "true",
            "endpointNames": ["eventHubEndpoint"],
            "isEnabled": true
        }
    ]
}
```

```bash
# Configure a custom endpoint
az iot hub routing-endpoint create \
    --hub-name MyIoTHub \
    --endpoint-name storageEndpoint \
    --endpoint-type azurestoragecontainer \
    --endpoint-resource-group MyResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string $STORAGE_CONNECTION_STRING \
    --container-name telemetry \
    --encoding json \
    --file-name-format "{iothub}/{partition}/{YYYY}/{MM}/{DD}/{HH}/{mm}"

# Create a route
az iot hub route create \
    --hub-name MyIoTHub \
    --route-name TelemetryToStorage \
    --source devicemessages \
    --endpoint-name storageEndpoint \
    --condition "true" \
    --enabled true
```

## Device Twin Enhancements

```python
from azure.iot.device import IoTHubDeviceClient
import json

class DeviceTwinManager:
    def __init__(self, connection_string):
        self.client = IoTHubDeviceClient.create_from_connection_string(connection_string)

    async def connect(self):
        await self.client.connect()
        # Set up twin update handler
        self.client.on_twin_desired_properties_patch_received = self._handle_twin_update

    async def _handle_twin_update(self, patch):
        """Handle desired property updates"""
        print(f"Received twin update: {json.dumps(patch, indent=2)}")

        # Process the update
        if "telemetryInterval" in patch:
            self.telemetry_interval = patch["telemetryInterval"]
            print(f"Updated telemetry interval to {self.telemetry_interval}s")

        # Report the new state
        reported = {
            "telemetryInterval": self.telemetry_interval,
            "lastConfigUpdate": datetime.utcnow().isoformat()
        }
        await self.client.patch_twin_reported_properties(reported)

    async def get_twin(self):
        """Get the full device twin"""
        twin = await self.client.get_twin()
        print(f"Device Twin: {json.dumps(twin, indent=2)}")
        return twin

    async def update_reported_properties(self, properties):
        """Update reported properties"""
        await self.client.patch_twin_reported_properties(properties)
```

## Direct Methods with Improved Reliability

```python
from azure.iot.device import MethodResponse

class DeviceMethodHandler:
    def __init__(self, device_client):
        self.client = device_client
        self.client.on_method_request_received = self._handle_method

    async def _handle_method(self, method_request):
        """Handle incoming direct method calls"""
        print(f"Method called: {method_request.name}")
        print(f"Payload: {method_request.payload}")

        try:
            if method_request.name == "reboot":
                result = await self._handle_reboot(method_request.payload)
            elif method_request.name == "firmwareUpdate":
                result = await self._handle_firmware_update(method_request.payload)
            elif method_request.name == "getDiagnostics":
                result = await self._get_diagnostics()
            else:
                result = {"error": f"Unknown method: {method_request.name}"}
                status = 404

            status = 200
        except Exception as e:
            result = {"error": str(e)}
            status = 500

        response = MethodResponse.create_from_method_request(
            method_request, status, result
        )
        await self.client.send_method_response(response)

    async def _handle_reboot(self, payload):
        delay = payload.get("delay", 0)
        print(f"Scheduling reboot in {delay} seconds")
        # Schedule reboot logic
        return {"status": "reboot_scheduled", "delay": delay}

    async def _handle_firmware_update(self, payload):
        firmware_url = payload.get("firmwareUrl")
        version = payload.get("version")
        print(f"Updating firmware to {version} from {firmware_url}")
        # Firmware update logic
        return {"status": "update_started", "version": version}

    async def _get_diagnostics(self):
        return {
            "cpuUsage": 45.2,
            "memoryUsage": 62.1,
            "diskUsage": 35.8,
            "uptime": 86400,
            "firmwareVersion": "1.2.3"
        }
```

## Message Enrichments

```bash
# Add message enrichments to include device metadata
az iot hub message-enrichment create \
    --hub-name MyIoTHub \
    --key "deviceLocation" \
    --value "\$twin.tags.location" \
    --endpoints "storageEndpoint" "eventHubEndpoint"

az iot hub message-enrichment create \
    --hub-name MyIoTHub \
    --key "deviceType" \
    --value "\$twin.tags.deviceType" \
    --endpoints "storageEndpoint"

# Messages now automatically include enriched properties
```

## Built-in Endpoint Integration

```python
from azure.eventhub import EventHubConsumerClient
import json

connection_str = "Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."

def process_event(partition_context, event):
    """Process events from IoT Hub's built-in endpoint"""
    body = event.body_as_json()
    properties = event.system_properties

    print(f"Device ID: {properties[b'iothub-connection-device-id'].decode()}")
    print(f"Enqueued: {properties[b'iothub-enqueuedtime']}")
    print(f"Body: {json.dumps(body, indent=2)}")

    # Check for enrichments
    if event.properties:
        print(f"Enrichments: {dict(event.properties)}")

    partition_context.update_checkpoint(event)

async def receive_events():
    client = EventHubConsumerClient.create_from_connection_string(
        connection_str,
        consumer_group="$Default"
    )

    async with client:
        await client.receive(
            on_event=process_event,
            starting_position="-1"  # Start from beginning
        )
```

These IoT Hub updates enable more sophisticated device management and data processing scenarios.
