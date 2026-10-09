---
title: "Designing End-to-End IoT Solution Architecture on Azure"
description: "This architecture provides a scalable, secure foundation for enterprise IoT solutions on Azure."
author: "Michael John Peña"
draft: false
date: 2022-07-31
tags: ["Azure", "IoT", "Architecture", "Solution Design", "Best Practices"]
---

## Reference Architecture

A typical Azure IoT solution includes these layers:

1. **Device Layer**: IoT devices and edge gateways
2. **Ingestion Layer**: IoT Hub and Event Hub
3. **Processing Layer**: Stream Analytics, Functions, Databricks
4. **Storage Layer**: Cosmos DB, Data Lake, Time Series Insights
5. **Presentation Layer**: Power BI, Custom dashboards, APIs

## Device Connectivity Patterns

### Direct Connection

```python
from azure.iot.device.aio import IoTHubDeviceClient
import asyncio

class DirectConnectedDevice:
    def __init__(self, connection_string):
        self.client = IoTHubDeviceClient.create_from_connection_string(connection_string)

    async def run(self):
        await self.client.connect()

        while True:
            telemetry = self.collect_telemetry()
            await self.client.send_message(json.dumps(telemetry))
            await asyncio.sleep(60)

    def collect_telemetry(self):
        return {
            "temperature": read_sensor(),
            "timestamp": datetime.utcnow().isoformat()
        }
```

### Edge Gateway Pattern

```python
# Edge gateway aggregating multiple leaf devices
class EdgeGateway:
    def __init__(self, gateway_connection_string):
        self.gateway_client = IoTHubDeviceClient.create_from_connection_string(
            gateway_connection_string
        )
        self.leaf_devices = {}

    async def register_leaf_device(self, device_id, protocol='modbus'):
        """Register a downstream leaf device"""
        self.leaf_devices[device_id] = {
            'protocol': protocol,
            'last_data': None
        }

    async def collect_and_forward(self):
        """Collect data from leaf devices and forward to cloud"""
        aggregated_data = []

        for device_id, info in self.leaf_devices.items():
            data = await self.read_leaf_device(device_id, info['protocol'])
            aggregated_data.append({
                'deviceId': device_id,
                'data': data,
                'timestamp': datetime.utcnow().isoformat()
            })

        # Send as batch message
        message = Message(json.dumps(aggregated_data))
        message.content_type = "application/json"
        await self.gateway_client.send_message(message)
```

## Data Processing Pipeline

### Stream Analytics for Real-Time Processing

```sql
-- Stream Analytics job for real-time anomaly detection
WITH AnomalyDetection AS (
    SELECT
        deviceId,
        temperature,
        EventEnqueuedUtcTime as eventTime,
        AnomalyDetection_SpikeAndDip(temperature, 95, 120, 'spikesanddips')
            OVER (PARTITION BY deviceId LIMIT DURATION(minute, 10)) AS anomalyResult
    FROM IoTHubInput
)
SELECT
    deviceId,
    temperature,
    eventTime,
    anomalyResult.Score as anomalyScore,
    anomalyResult.IsAnomaly as isAnomaly
INTO AlertOutput
FROM AnomalyDetection
WHERE anomalyResult.IsAnomaly = 1
```

### Azure Functions for Event Processing

```python
import azure.functions as func
import json
from azure.cosmos import CosmosClient

cosmos_client = CosmosClient.from_connection_string(os.environ['COSMOS_CONNECTION'])
container = cosmos_client.get_database_client('iot').get_container_client('telemetry')

def main(events: func.EventHubEvent):
    """Process IoT events and store in Cosmos DB"""

    for event in events:
        body = json.loads(event.get_body().decode('utf-8'))
        device_id = event.iothub_metadata.get('connection-device-id')

        # Enrich with metadata
        document = {
            'id': f"{device_id}-{body['timestamp']}",
            'deviceId': device_id,
            'partitionKey': device_id,
            'data': body,
            'processedAt': datetime.utcnow().isoformat()
        }

        # Store in Cosmos DB
        container.upsert_item(document)

        # Check for alerts
        if body.get('temperature', 0) > 30:
            send_alert(device_id, body)
```

## Storage Strategy

### Hot Path (Real-Time)

```python
from azure.cosmos.aio import CosmosClient
import asyncio

class HotPathStorage:
    def __init__(self, connection_string, database, container):
        self.client = CosmosClient.from_connection_string(connection_string)
        self.container = self.client.get_database_client(database).get_container_client(container)

    async def store_telemetry(self, device_id, data):
        """Store recent telemetry for real-time queries"""
        document = {
            'id': str(uuid.uuid4()),
            'deviceId': device_id,
            'partitionKey': device_id,
            'data': data,
            'ttl': 86400 * 7  # 7 days retention
        }
        await self.container.upsert_item(document)

    async def get_recent_telemetry(self, device_id, hours=24):
        """Get recent telemetry for a device"""
        query = f"""
            SELECT * FROM c
            WHERE c.deviceId = '{device_id}'
            AND c._ts > {int(time.time()) - (hours * 3600)}
            ORDER BY c._ts DESC
        """
        return [item async for item in self.container.query_items(query)]
```

### Cold Path (Historical)

```python
from azure.storage.filedatalake import DataLakeServiceClient
import pandas as pd

class ColdPathStorage:
    def __init__(self, connection_string, file_system):
        self.service_client = DataLakeServiceClient.from_connection_string(connection_string)
        self.file_system_client = self.service_client.get_file_system_client(file_system)

    def archive_data(self, data, partition_date):
        """Archive data to Data Lake in Parquet format"""
        df = pd.DataFrame(data)

        # Partition by date
        path = f"telemetry/year={partition_date.year}/month={partition_date.month:02d}/day={partition_date.day:02d}"
        directory_client = self.file_system_client.get_directory_client(path)
        directory_client.create_directory()

        # Write as Parquet
        parquet_buffer = df.to_parquet()
        file_client = directory_client.get_file_client(f"data_{uuid.uuid4()}.parquet")
        file_client.upload_data(parquet_buffer, overwrite=True)
```

## API Layer

```python
from fastapi import FastAPI, HTTPException
from azure.cosmos import CosmosClient

app = FastAPI()

cosmos_client = CosmosClient.from_connection_string(COSMOS_CONNECTION)
container = cosmos_client.get_database_client('iot').get_container_client('telemetry')

@app.get("/devices/{device_id}/telemetry")
async def get_device_telemetry(device_id: str, hours: int = 24):
    """Get recent telemetry for a device"""
    query = f"""
        SELECT c.data, c._ts as timestamp
        FROM c
        WHERE c.deviceId = '{device_id}'
        AND c._ts > {int(time.time()) - (hours * 3600)}
        ORDER BY c._ts DESC
    """

    items = list(container.query_items(query, enable_cross_partition_query=True))

    if not items:
        raise HTTPException(status_code=404, detail="Device not found")

    return {"deviceId": device_id, "telemetry": items}

@app.get("/devices/{device_id}/status")
async def get_device_status(device_id: str):
    """Get device status from IoT Hub"""
    registry = IoTHubRegistryManager.from_connection_string(IOT_HUB_CONNECTION)
    twin = registry.get_twin(device_id)

    return {
        "deviceId": device_id,
        "status": twin.properties.reported.get('status'),
        "lastSeen": twin.properties.reported.get('lastHeartbeat'),
        "firmwareVersion": twin.properties.reported.get('firmwareVersion')
    }
```

## Complete Solution Terraform

```hcl
# Main infrastructure for IoT solution
resource "azurerm_iothub" "main" {
  name                = "iot-hub-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku {
    name     = "S1"
    capacity = 1
  }
}

resource "azurerm_cosmosdb_account" "main" {
  name                = "cosmos-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }
}

resource "azurerm_storage_account" "datalake" {
  name                     = "datalake${var.environment}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  is_hns_enabled           = true
}
```

This architecture provides a scalable, secure foundation for enterprise IoT solutions on Azure.
