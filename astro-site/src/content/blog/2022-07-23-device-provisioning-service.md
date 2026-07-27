---
title: "Azure IoT Hub Device Provisioning Service Deep Dive"
author: "Michael John Peña"
draft: false
date: 2022-07-23
tags: ["Azure", "IoT", "DPS", "Device Provisioning", "Security"]

---

I wrote "Azure IoT Hub Device Provisioning Service Deep Dive" to share practical, production-minded guidance on this topic.

## Understanding DPS Architecture

DPS provides:
- Zero-touch provisioning
- Load balancing across multiple IoT Hubs
- Multi-tenancy support
- Geo-distribution of devices
- Re-provisioning support

## Setting Up DPS

```bash
# Create a DPS instance
az iot dps create \
    --name myDPS \
    --resource-group myResourceGroup \
    --location eastus

# Link to IoT Hub
az iot dps linked-hub create \
    --dps-name myDPS \
    --resource-group myResourceGroup \
    --hub-name myIoTHub \
    --connection-string "$(az iot hub connection-string show --hub-name myIoTHub --query connectionString -o tsv)"
```

## Enrollment Types

### Individual Enrollment with Symmetric Key

```bash
# Create individual enrollment
az iot dps enrollment create \
    --dps-name myDPS \
    --resource-group myResourceGroup \
    --enrollment-id device001 \
    --attestation-type symmetrickey \
    --primary-key "primary_key_here" \
    --secondary-key "secondary_key_here" \
    --initial-twin-properties '{"tags":{"location":"building1"},"properties":{"desired":{"telemetryInterval":60}}}'
```

### Group Enrollment with X.509

```bash
# Upload root CA certificate
az iot dps certificate create \
    --dps-name myDPS \
    --resource-group myResourceGroup \
    --name rootCA \
    --path ./root-ca.cer

# Create enrollment group
az iot dps enrollment-group create \
    --dps-name myDPS \
    --resource-group myResourceGroup \
    --enrollment-id myEnrollmentGroup \
    --certificate-name rootCA \
    --allocation-policy hashed \
    --iot-hubs "myIoTHub1.azure-devices.net myIoTHub2.azure-devices.net"
```

## Device-Side Provisioning Code

```python
from azure.iot.device.aio import ProvisioningDeviceClient
from azure.iot.device.aio import IoTHubDeviceClient
import asyncio
import os

class DeviceProvisioner:
    def __init__(self, id_scope, registration_id, symmetric_key):
        self.id_scope = id_scope
        self.registration_id = registration_id
        self.symmetric_key = symmetric_key
        self.provisioning_host = "global.azure-devices-provisioning.net"

    async def provision_and_connect(self):
        """Provision device and return connected client"""

        # Create provisioning client
        provisioning_client = ProvisioningDeviceClient.create_from_symmetric_key(
            provisioning_host=self.provisioning_host,
            registration_id=self.registration_id,
            id_scope=self.id_scope,
            symmetric_key=self.symmetric_key
        )

        # Add custom payload for allocation policy
        provisioning_client.provisioning_payload = {
            "modelId": "dtmi:com:example:Thermostat;1",
            "region": "us-west"
        }

        print("Registering device...")
        registration_result = await provisioning_client.register()

        if registration_result.status == "assigned":
            print(f"Device registered to {registration_result.registration_state.assigned_hub}")

            # Create device client
            device_client = IoTHubDeviceClient.create_from_symmetric_key(
                symmetric_key=self.symmetric_key,
                hostname=registration_result.registration_state.assigned_hub,
                device_id=registration_result.registration_state.device_id
            )

            await device_client.connect()
            print("Connected to IoT Hub")
            return device_client
        else:
            raise Exception(f"Registration failed: {registration_result.status}")

# Usage
async def main():
    provisioner = DeviceProvisioner(
        id_scope=os.environ["DPS_ID_SCOPE"],
        registration_id=os.environ["DEVICE_REGISTRATION_ID"],
        symmetric_key=os.environ["DEVICE_SYMMETRIC_KEY"]
    )

    client = await provisioner.provision_and_connect()

    # Send telemetry
    await client.send_message('{"temperature": 25.5}')

asyncio.run(main())
```

## X.509 Certificate Provisioning

```python
from azure.iot.device.aio import ProvisioningDeviceClient
import ssl

class X509DeviceProvisioner:
    def __init__(self, id_scope, registration_id, cert_file, key_file):
        self.id_scope = id_scope
        self.registration_id = registration_id
        self.cert_file = cert_file
        self.key_file = key_file

    def create_ssl_context(self):
        """Create SSL context with device certificate"""
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ssl_context.load_cert_chain(
            certfile=self.cert_file,
            keyfile=self.key_file
        )
        ssl_context.load_verify_locations(cafile="./azure-iot-root-ca.pem")
        return ssl_context

    async def provision(self):
        """Provision using X.509 certificate"""
        provisioning_client = ProvisioningDeviceClient.create_from_x509_certificate(
            provisioning_host="global.azure-devices-provisioning.net",
            registration_id=self.registration_id,
            id_scope=self.id_scope,
            x509=self.create_x509()
        )

        return await provisioning_client.register()

    def create_x509(self):
        from azure.iot.device import X509
        return X509(
            cert_file=self.cert_file,
            key_file=self.key_file
        )
```

## Custom Allocation Policy with Azure Functions

```python
import azure.functions as func
import json
import logging

def main(req: func.HttpRequest) -> func.HttpResponse:
    """Custom allocation policy for DPS"""
    logging.info('Custom allocation policy triggered')

    try:
        req_body = req.get_json()
        logging.info(f"Request: {json.dumps(req_body)}")

        # Extract device information
        registration_id = req_body.get('deviceRuntimeContext', {}).get('registrationId')
        payload = req_body.get('deviceRuntimeContext', {}).get('payload', {})

        # Get available IoT Hubs
        iot_hubs = req_body.get('linkedHubs', [])

        # Custom allocation logic based on device payload
        region = payload.get('region', 'default')

        if region == 'us-west':
            selected_hub = next((h for h in iot_hubs if 'westus' in h['name']), iot_hubs[0])
        elif region == 'us-east':
            selected_hub = next((h for h in iot_hubs if 'eastus' in h['name']), iot_hubs[0])
        else:
            # Default: select hub with lowest weight
            selected_hub = min(iot_hubs, key=lambda h: h.get('allocationWeight', 1))

        response = {
            "iotHubHostName": selected_hub['name'],
            "initialTwin": {
                "tags": {
                    "region": region,
                    "provisionedBy": "custom-allocation"
                },
                "properties": {
                    "desired": {
                        "telemetryInterval": 60
                    }
                }
            }
        }

        return func.HttpResponse(
            json.dumps(response),
            status_code=200,
            mimetype="application/json"
        )

    except Exception as e:
        logging.error(f"Error: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500
        )
```

## Re-provisioning Scenarios

```python
async def handle_reprovisioning(device_client, current_hub):
    """Handle device re-provisioning when hub changes"""

    async def connection_state_handler(new_state):
        if new_state == "disconnected":
            print("Disconnected from IoT Hub")
            # Check if re-provisioning is needed
            await check_and_reprovision()

    device_client.on_connection_state_change = connection_state_handler

async def check_and_reprovision():
    """Check if device needs to re-provision"""
    provisioner = DeviceProvisioner(...)
    result = await provisioner.provision_and_connect()

    if result.registration_state.assigned_hub != current_hub:
        print("Hub assignment changed, reconnecting to new hub")
        # Update connection to new hub
```

DPS is essential for deploying and managing IoT devices at scale across multiple regions and IoT Hubs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
