---
title: "IoT Hub Message Routing and Custom Endpoints"
author: "Michael John Peña"
draft: false
date: 2022-07-24
tags: ["Azure", "IoT Hub", "Message Routing", "Event Hub", "Service Bus"]

---

I wrote "IoT Hub Message Routing and Custom Endpoints" to share practical, production-minded guidance on this topic.

## Understanding Message Sources

IoT Hub can route messages from multiple sources:

- **Device Telemetry Messages**: Regular D2C messages
- **Device Twin Change Events**: When twin properties change
- **Device Lifecycle Events**: Connect, disconnect, create, delete
- **Digital Twin Change Events**: For IoT Plug and Play devices

## Creating Custom Endpoints

```bash
# Create Event Hub endpoint
az iot hub routing-endpoint create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --endpoint-name telemetryEventHub \
    --endpoint-type eventhub \
    --endpoint-resource-group myResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string "$EVENTHUB_CONNECTION_STRING"

# Create Service Bus Queue endpoint
az iot hub routing-endpoint create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --endpoint-name alertsQueue \
    --endpoint-type servicebusqueue \
    --endpoint-resource-group myResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string "$SERVICEBUS_CONNECTION_STRING"

# Create Blob Storage endpoint
az iot hub routing-endpoint create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --endpoint-name archiveStorage \
    --endpoint-type azurestoragecontainer \
    --endpoint-resource-group myResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string "$STORAGE_CONNECTION_STRING" \
    --container-name iot-archive \
    --encoding json \
    --batch-frequency-in-seconds 60 \
    --max-chunk-size-in-bytes 104857600 \
    --file-name-format "{iothub}/{partition}/{YYYY}/{MM}/{DD}/{HH}/{mm}"
```

## Routing Queries

### Basic Routing Rules

```bash
# Route all messages to storage
az iot hub route create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --route-name allToStorage \
    --source devicemessages \
    --endpoint-name archiveStorage \
    --condition "true" \
    --enabled true

# Route high-temperature alerts
az iot hub route create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --route-name temperatureAlerts \
    --source devicemessages \
    --endpoint-name alertsQueue \
    --condition '$body.temperature > 30' \
    --enabled true

# Route specific device types
az iot hub route create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --route-name sensorData \
    --source devicemessages \
    --endpoint-name telemetryEventHub \
    --condition '$twin.tags.deviceType = "sensor"' \
    --enabled true
```

### Advanced Query Syntax

```sql
-- Message body conditions
$body.temperature > 30 AND $body.humidity < 40

-- Application properties
$messageType = 'alert'

-- System properties
$connectionDeviceId = 'device001'

-- Twin tags
$twin.tags.location = 'building1'

-- Twin desired properties
$twin.properties.desired.alertThreshold < $body.temperature

-- Combined conditions
$body.temperature > $twin.properties.desired.maxTemp
    AND $twin.tags.critical = true
    AND $contentType = 'application/json'
```

## Sending Messages with Routing Properties

```python
from azure.iot.device import IoTHubDeviceClient, Message
import json

async def send_routable_message(client, telemetry, message_type):
    """Send message with routing properties"""

    # Create message
    message = Message(json.dumps(telemetry))

    # Set content type for body-based routing
    message.content_type = "application/json"
    message.content_encoding = "utf-8"

    # Set custom properties for routing
    message.custom_properties = {
        "messageType": message_type,
        "priority": "high" if telemetry.get("temperature", 0) > 30 else "normal",
        "deviceLocation": "building1-floor2"
    }

    await client.send_message(message)
    print(f"Sent {message_type} message")

# Usage
telemetry = {
    "temperature": 35.5,
    "humidity": 45.0,
    "timestamp": "2022-07-24T10:30:00Z"
}
await send_routable_message(client, telemetry, "telemetry")

# Alert message
alert = {
    "alertType": "highTemperature",
    "value": 35.5,
    "threshold": 30.0,
    "timestamp": "2022-07-24T10:30:00Z"
}
await send_routable_message(client, alert, "alert")
```

## Processing Routed Messages

### Event Hub Consumer

```python
from azure.eventhub.aio import EventHubConsumerClient
import json

async def process_telemetry_events():
    """Process telemetry routed to Event Hub"""

    async def on_event(partition_context, event):
        body = json.loads(event.body_as_str())

        # Get device ID from system properties
        device_id = event.system_properties.get(b'iothub-connection-device-id', b'').decode()

        print(f"Device: {device_id}")
        print(f"Temperature: {body.get('temperature')}")
        print(f"Custom Props: {dict(event.properties or {})}")

        # Process telemetry
        await save_to_database(device_id, body)

        await partition_context.update_checkpoint(event)

    client = EventHubConsumerClient.create_from_connection_string(
        conn_str=EVENTHUB_CONNECTION_STRING,
        consumer_group="$Default"
    )

    async with client:
        await client.receive(on_event=on_event, starting_position="-1")
```

### Service Bus Queue Consumer

```python
from azure.servicebus.aio import ServiceBusClient
import json

async def process_alerts():
    """Process alerts routed to Service Bus Queue"""

    async with ServiceBusClient.from_connection_string(SERVICEBUS_CONNECTION_STRING) as client:
        receiver = client.get_queue_receiver(queue_name="alerts")

        async with receiver:
            async for message in receiver:
                body = json.loads(str(message))

                print(f"Alert received: {body}")

                # Process alert
                await handle_alert(body)

                # Complete the message
                await receiver.complete_message(message)

async def handle_alert(alert):
    """Handle an alert message"""
    if alert.get("alertType") == "highTemperature":
        # Send notification
        await send_notification(
            f"High temperature alert: {alert.get('value')}°C"
        )
```

## Fallback Route

```bash
# Enable fallback route to built-in endpoint
az iot hub update \
    --name myIoTHub \
    --resource-group myResourceGroup \
    --set properties.routing.fallbackRoute.isEnabled=true

# Messages not matching any route go to built-in endpoint
```

## Testing Routes

```bash
# Test a routing query
az iot hub message-route test \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --route-name temperatureAlerts \
    --body '{"temperature": 35}' \
    --app-properties '{"messageType": "telemetry"}'
```

Message routing is the foundation for building sophisticated, event-driven IoT architectures on Azure.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
