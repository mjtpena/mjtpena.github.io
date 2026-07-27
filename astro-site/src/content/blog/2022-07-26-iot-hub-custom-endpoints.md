---
title: "Configuring Custom Endpoints in Azure IoT Hub"
author: "Michael John Peña"
draft: false
date: 2022-07-26
tags: ["Azure", "IoT Hub", "Custom Endpoints", "Event Hub", "Service Bus", "Storage"]

---

I wrote "Configuring Custom Endpoints in Azure IoT Hub" to share practical, production-minded guidance on this topic.

## Supported Endpoint Types

IoT Hub supports four types of custom endpoints:

1. **Event Hubs**: High-throughput event streaming
2. **Service Bus Queues**: Reliable message queuing
3. **Service Bus Topics**: Pub/sub messaging
4. **Azure Blob Storage**: Long-term archival

## Event Hub Endpoint

```bash
# Create Event Hub namespace and hub
az eventhubs namespace create \
    --name myEventHubNamespace \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard

az eventhubs eventhub create \
    --name telemetryHub \
    --namespace-name myEventHubNamespace \
    --resource-group myResourceGroup \
    --partition-count 4 \
    --message-retention 7

# Get connection string
EVENTHUB_CONN=$(az eventhubs eventhub authorization-rule keys list \
    --resource-group myResourceGroup \
    --namespace-name myEventHubNamespace \
    --eventhub-name telemetryHub \
    --name RootManageSharedAccessKey \
    --query primaryConnectionString -o tsv)

# Add as IoT Hub endpoint
az iot hub routing-endpoint create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --endpoint-name telemetryEventHub \
    --endpoint-type eventhub \
    --endpoint-resource-group myResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string "$EVENTHUB_CONN"
```

## Service Bus Queue Endpoint

```bash
# Create Service Bus namespace and queue
az servicebus namespace create \
    --name myServiceBusNamespace \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard

az servicebus queue create \
    --name alertsQueue \
    --namespace-name myServiceBusNamespace \
    --resource-group myResourceGroup \
    --max-size 1024 \
    --default-message-time-to-live P14D

# Get connection string
SERVICEBUS_CONN=$(az servicebus namespace authorization-rule keys list \
    --resource-group myResourceGroup \
    --namespace-name myServiceBusNamespace \
    --name RootManageSharedAccessKey \
    --query primaryConnectionString -o tsv)

# Add as IoT Hub endpoint
az iot hub routing-endpoint create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --endpoint-name alertsQueue \
    --endpoint-type servicebusqueue \
    --endpoint-resource-group myResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string "$SERVICEBUS_CONN;EntityPath=alertsQueue"
```

## Service Bus Topic Endpoint

```bash
# Create Service Bus topic
az servicebus topic create \
    --name deviceEvents \
    --namespace-name myServiceBusNamespace \
    --resource-group myResourceGroup

# Create subscriptions for different consumers
az servicebus topic subscription create \
    --name analyticsSubscription \
    --topic-name deviceEvents \
    --namespace-name myServiceBusNamespace \
    --resource-group myResourceGroup

az servicebus topic subscription create \
    --name alertingSubscription \
    --topic-name deviceEvents \
    --namespace-name myServiceBusNamespace \
    --resource-group myResourceGroup \
    --filter-sql-expression "priority = 'high'"

# Add as IoT Hub endpoint
az iot hub routing-endpoint create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --endpoint-name deviceEventsTopic \
    --endpoint-type servicebustopic \
    --endpoint-resource-group myResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string "$SERVICEBUS_CONN;EntityPath=deviceEvents"
```

## Blob Storage Endpoint

```bash
# Create storage account and container
az storage account create \
    --name myiotarchive \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard_LRS

az storage container create \
    --name telemetry-archive \
    --account-name myiotarchive

# Get connection string
STORAGE_CONN=$(az storage account show-connection-string \
    --name myiotarchive \
    --resource-group myResourceGroup \
    --query connectionString -o tsv)

# Add as IoT Hub endpoint with custom file naming
az iot hub routing-endpoint create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --endpoint-name archiveStorage \
    --endpoint-type azurestoragecontainer \
    --endpoint-resource-group myResourceGroup \
    --endpoint-subscription-id $SUBSCRIPTION_ID \
    --connection-string "$STORAGE_CONN" \
    --container-name telemetry-archive \
    --encoding json \
    --batch-frequency-in-seconds 300 \
    --max-chunk-size-in-bytes 104857600 \
    --file-name-format "{iothub}/{partition}/{YYYY}/{MM}/{DD}/{HH}/{mm}"
```

## Processing Messages from Custom Endpoints

### Event Hub Consumer

```python
from azure.eventhub.aio import EventHubConsumerClient
import json

async def process_eventhub_messages():
    """Process messages from Event Hub endpoint"""
    client = EventHubConsumerClient.create_from_connection_string(
        conn_str=EVENTHUB_CONNECTION_STRING,
        consumer_group="$Default",
        eventhub_name="telemetryHub"
    )

    async def on_event(partition_context, event):
        data = json.loads(event.body_as_str())
        device_id = event.system_properties.get(b'iothub-connection-device-id', b'').decode()

        # Process telemetry
        await process_telemetry(device_id, data)
        await partition_context.update_checkpoint(event)

    async with client:
        await client.receive(on_event=on_event, starting_position="-1")
```

### Service Bus Queue Consumer

```python
from azure.servicebus.aio import ServiceBusClient
import json

async def process_queue_messages():
    """Process messages from Service Bus Queue endpoint"""
    async with ServiceBusClient.from_connection_string(SERVICEBUS_CONNECTION_STRING) as client:
        receiver = client.get_queue_receiver(queue_name="alertsQueue")

        async with receiver:
            async for message in receiver:
                data = json.loads(str(message))

                # Get IoT Hub metadata from application properties
                device_id = message.application_properties.get(b'iothub-connection-device-id', b'').decode()

                # Process alert
                await handle_alert(device_id, data)

                await receiver.complete_message(message)
```

### Service Bus Topic Consumer

```python
async def process_topic_messages():
    """Process messages from Service Bus Topic endpoint"""
    async with ServiceBusClient.from_connection_string(SERVICEBUS_CONNECTION_STRING) as client:
        receiver = client.get_subscription_receiver(
            topic_name="deviceEvents",
            subscription_name="analyticsSubscription"
        )

        async with receiver:
            async for message in receiver:
                data = json.loads(str(message))
                await process_analytics(data)
                await receiver.complete_message(message)
```

### Reading from Blob Storage

```python
from azure.storage.blob import BlobServiceClient
import json

def read_archived_data(date, hour):
    """Read archived IoT data from blob storage"""
    blob_service = BlobServiceClient.from_connection_string(STORAGE_CONNECTION_STRING)
    container = blob_service.get_container_client("telemetry-archive")

    # List blobs for specific time period
    prefix = f"myIoTHub/0/{date.year:04d}/{date.month:02d}/{date.day:02d}/{hour:02d}"

    messages = []
    for blob in container.list_blobs(name_starts_with=prefix):
        blob_client = container.get_blob_client(blob)
        content = blob_client.download_blob().readall().decode('utf-8')

        # Parse JSON lines format
        for line in content.strip().split('\n'):
            if line:
                messages.append(json.loads(line))

    return messages
```

Custom endpoints enable you to build flexible, scalable IoT data processing architectures tailored to your specific requirements.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
