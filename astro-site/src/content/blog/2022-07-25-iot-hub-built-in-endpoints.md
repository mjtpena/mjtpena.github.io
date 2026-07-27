---
title: "Working with IoT Hub Built-in Endpoints"
author: "Michael John Peña"
draft: false
date: 2022-07-25
tags: ["Azure", "IoT Hub", "Event Hub", "Endpoints", "Streaming"]

---

I wrote "Working with IoT Hub Built-in Endpoints" to share practical, production-minded guidance on this topic.

## Understanding Built-in Endpoints

IoT Hub exposes two types of built-in endpoints:

1. **Events Endpoint**: Event Hub-compatible endpoint for D2C messages
2. **Operations Monitoring**: Endpoint for operational logs (deprecated in favor of diagnostic settings)

## Getting Connection Information

```bash
# Get built-in endpoint connection string
az iot hub connection-string show \
    --hub-name myIoTHub \
    --default-eventhub \
    --output tsv

# Get Event Hub-compatible endpoint details
az iot hub show \
    --name myIoTHub \
    --query properties.eventHubEndpoints.events
```

## Consuming Messages with Event Hub SDK

```python
from azure.eventhub.aio import EventHubConsumerClient
from azure.eventhub.extensions.checkpointstoreblob import BlobCheckpointStore
import json
import asyncio

class IoTMessageConsumer:
    def __init__(self, connection_string, storage_connection_string, container_name):
        self.connection_string = connection_string
        self.checkpoint_store = BlobCheckpointStore.from_connection_string(
            storage_connection_string,
            container_name
        )

    async def start_consuming(self):
        """Start consuming messages from IoT Hub"""
        client = EventHubConsumerClient.create_from_connection_string(
            conn_str=self.connection_string,
            consumer_group="$Default",
            checkpoint_store=self.checkpoint_store
        )

        async with client:
            await client.receive(
                on_event=self._process_event,
                on_error=self._handle_error,
                on_partition_initialize=self._on_partition_initialize,
                on_partition_close=self._on_partition_close
            )

    async def _process_event(self, partition_context, event):
        """Process a single event"""
        if event:
            # Extract system properties
            device_id = event.system_properties.get(b'iothub-connection-device-id', b'').decode()
            enqueued_time = event.system_properties.get(b'iothub-enqueuedtime')
            message_id = event.system_properties.get(b'iothub-message-id', b'').decode()

            # Get message body
            try:
                body = json.loads(event.body_as_str())
            except json.JSONDecodeError:
                body = event.body_as_str()

            # Get custom properties
            custom_props = dict(event.properties) if event.properties else {}

            print(f"Device: {device_id}")
            print(f"Partition: {partition_context.partition_id}")
            print(f"Sequence: {event.sequence_number}")
            print(f"Body: {body}")

            # Process the message
            await self._handle_message(device_id, body, custom_props)

            # Checkpoint after processing
            await partition_context.update_checkpoint(event)

    async def _handle_error(self, partition_context, error):
        """Handle errors during event processing"""
        if partition_context:
            print(f"Error in partition {partition_context.partition_id}: {error}")
        else:
            print(f"Error: {error}")

    async def _on_partition_initialize(self, partition_context):
        """Called when a partition is initialized"""
        print(f"Partition {partition_context.partition_id} initialized")

    async def _on_partition_close(self, partition_context, reason):
        """Called when a partition is closed"""
        print(f"Partition {partition_context.partition_id} closed: {reason}")

    async def _handle_message(self, device_id, body, properties):
        """Custom message handling logic"""
        # Implement your business logic here
        pass

# Usage
async def main():
    consumer = IoTMessageConsumer(
        connection_string="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...",
        storage_connection_string="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=...",
        container_name="checkpoints"
    )
    await consumer.start_consuming()

asyncio.run(main())
```

## Partition Management

```python
from azure.eventhub import EventHubConsumerClient

def get_partition_info(connection_string):
    """Get partition information for the built-in endpoint"""
    client = EventHubConsumerClient.create_from_connection_string(
        conn_str=connection_string,
        consumer_group="$Default"
    )

    with client:
        # Get partition IDs
        partition_ids = client.get_partition_ids()
        print(f"Partition IDs: {partition_ids}")

        # Get properties for each partition
        for partition_id in partition_ids:
            props = client.get_partition_properties(partition_id)
            print(f"\nPartition {partition_id}:")
            print(f"  Begin sequence: {props['beginning_sequence_number']}")
            print(f"  Last sequence: {props['last_enqueued_sequence_number']}")
            print(f"  Last offset: {props['last_enqueued_offset']}")
            print(f"  Last enqueued: {props['last_enqueued_time_utc']}")
```

## Consumer Groups

```bash
# Create a consumer group
az iot hub consumer-group create \
    --hub-name myIoTHub \
    --name processingGroup

# List consumer groups
az iot hub consumer-group list \
    --hub-name myIoTHub \
    --output table
```

```python
# Use custom consumer group
client = EventHubConsumerClient.create_from_connection_string(
    conn_str=connection_string,
    consumer_group="processingGroup"  # Custom consumer group
)
```

## Real-time Processing with Azure Functions

```python
import azure.functions as func
import json
import logging

def main(events: func.EventHubEvent):
    """Azure Function triggered by IoT Hub events"""

    for event in events:
        # Get message body
        body = event.get_body().decode('utf-8')
        logging.info(f'Event body: {body}')

        # Get system properties
        device_id = event.iothub_metadata.get('connection-device-id')
        enqueued_time = event.iothub_metadata.get('enqueuedtime')

        logging.info(f'Device: {device_id}, Time: {enqueued_time}')

        # Process the message
        try:
            data = json.loads(body)
            process_telemetry(device_id, data)
        except json.JSONDecodeError:
            logging.warning(f'Invalid JSON from device {device_id}')

def process_telemetry(device_id, data):
    """Process telemetry data"""
    # Implement your logic
    pass
```

Function bindings in `function.json`:

```json
{
  "bindings": [
    {
      "type": "eventHubTrigger",
      "name": "events",
      "direction": "in",
      "eventHubName": "%IoTHubName%",
      "connection": "IoTHubConnection",
      "consumerGroup": "processingGroup",
      "cardinality": "many"
    }
  ]
}
```

## Monitoring Built-in Endpoint

```python
from azure.monitor.query import MetricsQueryClient
from azure.identity import DefaultAzureCredential

def query_endpoint_metrics():
    """Query metrics for the built-in endpoint"""
    credential = DefaultAzureCredential()
    client = MetricsQueryClient(credential)

    response = client.query_resource(
        resource_uri="/subscriptions/.../resourceGroups/.../providers/Microsoft.Devices/IotHubs/myIoTHub",
        metric_names=["d2c.endpoints.egress.builtIn.events", "d2c.endpoints.latency.builtIn.events"],
        timespan="PT1H"
    )

    for metric in response.metrics:
        print(f"{metric.name}: {metric.timeseries[0].data}")
```

The built-in endpoint provides a reliable, scalable way to consume IoT device telemetry for real-time processing.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
