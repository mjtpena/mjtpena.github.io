---
title: "Enhancing IoT Data with Message Enrichments"
description: "Message enrichments simplify downstream processing by providing device context at the point of ingestion."
author: "Michael John Peña"
draft: false
date: 2022-07-27
tags: ["Azure", "IoT Hub", "Message Enrichments", "Device Twin", "Data Processing"]
---

## Understanding Message Enrichments

Message enrichments can add:
- Static values
- Device twin tags
- Device twin desired properties
- Device twin reported properties
- IoT Hub properties

## Creating Message Enrichments

```bash
# Add static enrichment
az iot hub message-enrichment create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --key "region" \
    --value "us-east" \
    --endpoints "storageEndpoint" "eventHubEndpoint"

# Add device twin tag enrichment
az iot hub message-enrichment create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --key "deviceLocation" \
    --value "\$twin.tags.location" \
    --endpoints "storageEndpoint" "eventHubEndpoint"

# Add device twin property enrichment
az iot hub message-enrichment create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --key "firmwareVersion" \
    --value "\$twin.properties.reported.firmwareVersion" \
    --endpoints "storageEndpoint"

# Add IoT Hub name
az iot hub message-enrichment create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --key "hubName" \
    --value "\$iothubname" \
    --endpoints "storageEndpoint" "eventHubEndpoint"
```

## Setting Up Device Twins for Enrichment

```python
from azure.iot.hub import IoTHubRegistryManager
import json

registry_manager = IoTHubRegistryManager.from_connection_string(IOT_HUB_CONNECTION_STRING)

def setup_device_twin(device_id):
    """Configure device twin with tags for enrichment"""
    twin = registry_manager.get_twin(device_id)

    # Set tags for enrichment
    twin.tags = {
        "location": "building-1-floor-2",
        "deviceType": "temperature-sensor",
        "owner": "facilities",
        "criticality": "high",
        "installDate": "2022-01-15"
    }

    # Set desired properties
    twin.properties.desired = {
        "telemetryInterval": 60,
        "alertThreshold": 30
    }

    registry_manager.update_twin(device_id, twin, twin.etag)
    print(f"Twin updated for {device_id}")

# Update device reported properties from device side
async def report_device_properties(device_client):
    """Report device properties that can be used for enrichment"""
    reported_properties = {
        "firmwareVersion": "1.2.3",
        "ipAddress": "192.168.1.100",
        "status": "online",
        "lastBootTime": "2022-07-27T08:00:00Z"
    }
    await device_client.patch_twin_reported_properties(reported_properties)
```

## Available Enrichment Values

```bash
# Static value
--value "my-static-value"

# Device twin tags
--value "\$twin.tags.location"
--value "\$twin.tags.deviceType"

# Device twin desired properties
--value "\$twin.properties.desired.telemetryInterval"

# Device twin reported properties
--value "\$twin.properties.reported.firmwareVersion"
--value "\$twin.properties.reported.status"

# IoT Hub properties
--value "\$iothubname"
--value "\$connectionDeviceId"
--value "\$connectionModuleId"
```

## Processing Enriched Messages

```python
from azure.eventhub.aio import EventHubConsumerClient
import json

async def process_enriched_message(partition_context, event):
    """Process message with enrichments"""

    # Get the original message body
    body = json.loads(event.body_as_str())

    # Get enriched properties from message properties
    enrichments = {}
    if event.properties:
        enrichments = {
            key.decode() if isinstance(key, bytes) else key:
            value.decode() if isinstance(value, bytes) else value
            for key, value in event.properties.items()
        }

    # Now you have device context without additional lookups
    device_location = enrichments.get('deviceLocation')
    device_type = enrichments.get('deviceType')
    firmware = enrichments.get('firmwareVersion')

    print(f"Telemetry from {device_location} ({device_type}):")
    print(f"  Firmware: {firmware}")
    print(f"  Temperature: {body.get('temperature')}")

    # Route based on enriched data
    if enrichments.get('criticality') == 'high' and body.get('temperature', 0) > 30:
        await send_high_priority_alert(body, enrichments)

    await partition_context.update_checkpoint(event)
```

## Enrichment Scenarios

### Multi-tenant Data Routing

```python
async def route_by_tenant(event):
    """Route messages based on enriched tenant info"""
    enrichments = dict(event.properties or {})
    tenant_id = enrichments.get(b'tenantId', b'').decode()

    # Route to tenant-specific storage
    storage_clients = {
        'tenant-a': TenantAStorage(),
        'tenant-b': TenantBStorage(),
    }

    client = storage_clients.get(tenant_id, DefaultStorage())
    await client.store(event.body_as_json())
```

### Geo-distributed Processing

```python
async def process_by_region(event):
    """Process based on enriched region info"""
    enrichments = dict(event.properties or {})
    region = enrichments.get(b'region', b'default').decode()

    processors = {
        'us-east': USEastProcessor(),
        'us-west': USWestProcessor(),
        'eu-west': EUWestProcessor(),
    }

    processor = processors.get(region, DefaultProcessor())
    await processor.process(event)
```

### Compliance Tagging

```python
async def tag_for_compliance(event):
    """Tag data based on device compliance enrichments"""
    enrichments = dict(event.properties or {})

    compliance_record = {
        'data': event.body_as_json(),
        'device_owner': enrichments.get(b'owner', b'').decode(),
        'data_classification': enrichments.get(b'dataClassification', b'general').decode(),
        'retention_policy': enrichments.get(b'retentionPolicy', b'standard').decode(),
        'collected_at': event.system_properties.get(b'iothub-enqueuedtime'),
    }

    await store_with_compliance_metadata(compliance_record)
```

## Managing Enrichments

```bash
# List all enrichments
az iot hub message-enrichment list \
    --hub-name myIoTHub \
    --resource-group myResourceGroup

# Update an enrichment
az iot hub message-enrichment update \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --key "region" \
    --value "us-west" \
    --endpoints "storageEndpoint"

# Delete an enrichment
az iot hub message-enrichment delete \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --key "region"
```

Message enrichments simplify downstream processing by providing device context at the point of ingestion.
