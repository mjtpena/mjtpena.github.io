---
title: Deploying Cognitive Services on Azure IoT Edge
description: "IoT Edge with Cognitive Services enables intelligent edge scenarios, bringing AI capabilities directly to where data is generated."
author: Michael John Pena
draft: false
date: 2021-09-12
tags:
  - Azure
  - IoT Edge
  - Cognitive Services
  - Edge Computing
  - AI at the Edge
---

## IoT Edge Architecture

```
+------------------+      +------------------+      +------------------+
|   IoT Sensors    | ---> |   IoT Edge       | ---> |   Azure Cloud    |
|   & Cameras      |      |   Device         |      |   (IoT Hub)      |
+------------------+      +------------------+      +------------------+
                          |  Edge Modules:   |
                          |  - Custom Vision |
                          |  - Speech        |
                          |  - Text Analytics|
                          +------------------+
```

## Prerequisites

1. Azure IoT Hub
2. IoT Edge device (Linux)
3. Azure Cognitive Services resource
4. Docker on the edge device

## Setting Up IoT Edge Device

```bash
# Install IoT Edge runtime on Ubuntu
curl https://packages.microsoft.com/config/ubuntu/18.04/multiarch/prod.list > ./microsoft-prod.list
sudo cp ./microsoft-prod.list /etc/apt/sources.list.d/

curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo cp ./microsoft.gpg /etc/apt/trusted.gpg.d/

sudo apt-get update
sudo apt-get install aziot-edge defender-iot-micro-agent-edge

# Configure with connection string
sudo iotedge config mp --connection-string "your-connection-string"
sudo iotedge config apply
```

## Deployment Manifest

```json
{
  "modulesContent": {
    "$edgeAgent": {
      "properties.desired": {
        "schemaVersion": "1.1",
        "runtime": {
          "type": "docker",
          "settings": {
            "minDockerVersion": "v1.25",
            "loggingOptions": "",
            "registryCredentials": {
              "mcr": {
                "address": "mcr.microsoft.com",
                "username": "",
                "password": ""
              }
            }
          }
        },
        "systemModules": {
          "edgeAgent": {
            "type": "docker",
            "settings": {
              "image": "mcr.microsoft.com/azureiotedge-agent:1.2",
              "createOptions": "{}"
            }
          },
          "edgeHub": {
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "mcr.microsoft.com/azureiotedge-hub:1.2",
              "createOptions": "{\"HostConfig\":{\"PortBindings\":{\"5671/tcp\":[{\"HostPort\":\"5671\"}],\"8883/tcp\":[{\"HostPort\":\"8883\"}],\"443/tcp\":[{\"HostPort\":\"443\"}]}}}"
            }
          }
        },
        "modules": {
          "sentiment": {
            "version": "1.0",
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest",
              "createOptions": "{\"HostConfig\":{\"Memory\":8589934592,\"PortBindings\":{\"5000/tcp\":[{\"HostPort\":\"5000\"}]}}}"
            },
            "env": {
              "Eula": {"value": "accept"},
              "Billing": {"value": "https://westus.api.cognitive.microsoft.com/"},
              "ApiKey": {"value": "${COGNITIVE_SERVICES_KEY}"}
            }
          },
          "speech-to-text": {
            "version": "1.0",
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text:latest",
              "createOptions": "{\"HostConfig\":{\"Memory\":4294967296,\"PortBindings\":{\"5001/tcp\":[{\"HostPort\":\"5001\"}]}}}"
            },
            "env": {
              "Eula": {"value": "accept"},
              "Billing": {"value": "https://westus.api.cognitive.microsoft.com/"},
              "ApiKey": {"value": "${COGNITIVE_SERVICES_KEY}"}
            }
          },
          "inference-module": {
            "version": "1.0",
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "yourregistry.azurecr.io/inference-module:latest",
              "createOptions": "{}"
            }
          }
        }
      }
    },
    "$edgeHub": {
      "properties.desired": {
        "schemaVersion": "1.1",
        "routes": {
          "sensorToInference": "FROM /messages/modules/sensor/* INTO BrokeredEndpoint(\"/modules/inference-module/inputs/sensor\")",
          "inferenceToCloud": "FROM /messages/modules/inference-module/outputs/* INTO $upstream"
        },
        "storeAndForwardConfiguration": {
          "timeToLiveSecs": 7200
        }
      }
    }
  }
}
```

## Custom Inference Module

```python
# inference_module/main.py
import asyncio
import json
import os
import requests
from azure.iot.device.aio import IoTHubModuleClient

# Cognitive Services endpoints on the edge
SENTIMENT_ENDPOINT = "http://sentiment:5000"
SPEECH_ENDPOINT = "http://speech-to-text:5001"

async def analyze_text(text: str) -> dict:
    """Analyze text sentiment using local container."""
    response = requests.post(
        f"{SENTIMENT_ENDPOINT}/text/analytics/v3.1/sentiment",
        json={
            "documents": [{"id": "1", "language": "en", "text": text}]
        }
    )
    return response.json()

async def process_sensor_data(message, module_client):
    """Process incoming sensor data and enrich with AI."""
    data = json.loads(message.data.decode('utf-8'))

    # If there's text data, analyze sentiment
    if 'text' in data:
        sentiment_result = await analyze_text(data['text'])
        data['sentiment'] = sentiment_result['documents'][0]['sentiment']
        data['confidence'] = sentiment_result['documents'][0]['confidenceScores']

    # Send enriched data to cloud
    output_message = json.dumps(data)
    await module_client.send_message_to_output(output_message, "enriched")

async def main():
    module_client = IoTHubModuleClient.create_from_edge_environment()
    await module_client.connect()

    # Set up message handler
    async def message_handler(message):
        await process_sensor_data(message, module_client)

    module_client.on_message_received = message_handler

    print("Inference module started. Waiting for messages...")

    # Keep running
    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
```

## Dockerfile for Custom Module

```dockerfile
# Dockerfile
FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

CMD ["python", "main.py"]
```

```text
# requirements.txt
azure-iot-device
requests
```

## Deploying with Azure CLI

```bash
# Set deployment manifest
az iot edge set-modules \
  --hub-name your-iot-hub \
  --device-id your-edge-device \
  --content deployment.json

# Monitor deployment
az iot edge deployment show-metric \
  --deployment-id your-deployment \
  --hub-name your-iot-hub \
  --metric-id reportedSuccessfulCount
```

## Python Deployment Script

```python
# deploy_edge.py
from azure.iot.hub import IoTHubRegistryManager
from azure.iot.hub.models import ConfigurationContent
import json

def deploy_modules(connection_string: str, device_id: str, manifest_path: str):
    """Deploy IoT Edge modules to a device."""

    registry_manager = IoTHubRegistryManager(connection_string)

    with open(manifest_path, 'r') as f:
        manifest = json.load(f)

    content = ConfigurationContent(
        modules_content=manifest['modulesContent']
    )

    registry_manager.apply_configuration_content_on_device(
        device_id,
        content
    )

    print(f"Deployment applied to {device_id}")

# Deploy
deploy_modules(
    connection_string="HostName=...",
    device_id="edge-device-001",
    manifest_path="deployment.json"
)
```

## Monitoring Edge Modules

```python
# monitor_edge.py
from azure.iot.hub import IoTHubRegistryManager

def get_module_status(connection_string: str, device_id: str):
    """Get status of all modules on an edge device."""

    registry_manager = IoTHubRegistryManager(connection_string)

    modules = registry_manager.get_modules(device_id)

    for module in modules:
        print(f"""
        Module: {module.module_id}
        Connection State: {module.connection_state}
        Last Activity: {module.last_activity_time}
        """)

# Check status
get_module_status(
    connection_string="HostName=...",
    device_id="edge-device-001"
)
```

## Offline Operation

One key benefit of edge deployment is offline capability:

```python
# offline_queue.py
import json
import sqlite3
from datetime import datetime

class OfflineQueue:
    """Queue messages when cloud connectivity is lost."""

    def __init__(self, db_path: str = "offline_queue.db"):
        self.conn = sqlite3.connect(db_path)
        self._create_table()

    def _create_table(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.commit()

    def enqueue(self, message: dict):
        """Add message to offline queue."""
        self.conn.execute(
            "INSERT INTO queue (message) VALUES (?)",
            (json.dumps(message),)
        )
        self.conn.commit()

    def dequeue_batch(self, batch_size: int = 100) -> list:
        """Get and remove messages from queue."""
        cursor = self.conn.execute(
            "SELECT id, message FROM queue ORDER BY id LIMIT ?",
            (batch_size,)
        )
        rows = cursor.fetchall()

        if rows:
            ids = [row[0] for row in rows]
            self.conn.execute(
                f"DELETE FROM queue WHERE id IN ({','.join('?' * len(ids))})",
                ids
            )
            self.conn.commit()

        return [json.loads(row[1]) for row in rows]
```

## Best Practices

1. **Resource Planning**: Ensure edge device has sufficient resources
2. **Offline Handling**: Implement message queuing for connectivity loss
3. **Module Updates**: Use CI/CD for edge module deployments
4. **Monitoring**: Set up alerts for module health
5. **Security**: Use HSM for storing secrets on edge devices
6. **Testing**: Test modules locally before edge deployment

IoT Edge with Cognitive Services enables intelligent edge scenarios, bringing AI capabilities directly to where data is generated.
