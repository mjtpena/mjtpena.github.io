---
title: "Azure IoT Security Best Practices"
author: "Michael John Peña"
draft: false
date: 2022-07-30
tags: ["Azure", "IoT", "Security", "Best Practices", "Authentication"]

---

I wrote "Azure IoT Security Best Practices" to share practical, production-minded guidance on this topic.

## Authentication Options

### Symmetric Key Authentication

```python
from azure.iot.device import IoTHubDeviceClient

# Simple but requires secure key distribution
device_client = IoTHubDeviceClient.create_from_connection_string(
    "HostName=myhub.azure-devices.net;DeviceId=device001;SharedAccessKey=..."
)
```

### X.509 Certificate Authentication (Recommended)

```python
from azure.iot.device import IoTHubDeviceClient, X509

# More secure - certificate-based authentication
x509 = X509(
    cert_file="./device_cert.pem",
    key_file="./device_key.pem"
)

device_client = IoTHubDeviceClient.create_from_x509_certificate(
    hostname="myhub.azure-devices.net",
    device_id="device001",
    x509=x509
)
```

### Generate Device Certificates

```bash
# Generate CA certificate
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
    -subj "/CN=MyIoTCA"

# Generate device certificate
openssl genrsa -out device001.key 2048
openssl req -new -key device001.key -out device001.csr \
    -subj "/CN=device001"
openssl x509 -req -in device001.csr -CA ca.crt -CAkey ca.key \
    -CAcreateserial -out device001.crt -days 365

# Verify certificate chain
openssl verify -CAfile ca.crt device001.crt
```

## SAS Token Management

```python
import base64
import hmac
import hashlib
import time
from urllib.parse import quote_plus

class SASTokenGenerator:
    @staticmethod
    def generate_token(uri, key, policy_name=None, expiry=3600):
        """Generate a SAS token for IoT Hub authentication"""
        ttl = int(time.time()) + expiry
        sign_key = f"{quote_plus(uri)}\n{ttl}"

        signature = base64.b64encode(
            hmac.new(
                base64.b64decode(key),
                sign_key.encode('utf-8'),
                hashlib.sha256
            ).digest()
        ).decode('utf-8')

        token = f"SharedAccessSignature sr={quote_plus(uri)}&sig={quote_plus(signature)}&se={ttl}"

        if policy_name:
            token += f"&skn={policy_name}"

        return token

# Generate device token
token = SASTokenGenerator.generate_token(
    uri="myhub.azure-devices.net/devices/device001",
    key="device_symmetric_key",
    expiry=86400  # 24 hours
)
```

## Network Security

### Private Endpoints

```bash
# Create private endpoint for IoT Hub
az network private-endpoint create \
    --name myIoTHubPrivateEndpoint \
    --resource-group myResourceGroup \
    --vnet-name myVNet \
    --subnet mySubnet \
    --private-connection-resource-id "/subscriptions/.../providers/Microsoft.Devices/IotHubs/myIoTHub" \
    --group-id iotHub \
    --connection-name myConnection

# Disable public network access
az iot hub update \
    --name myIoTHub \
    --resource-group myResourceGroup \
    --set properties.publicNetworkAccess=Disabled
```

### IP Filtering

```bash
# Allow only specific IP ranges
az iot hub update \
    --name myIoTHub \
    --resource-group myResourceGroup \
    --set properties.ipFilterRules='[
        {
            "filterName": "AllowCorporate",
            "action": "Accept",
            "ipMask": "10.0.0.0/8"
        },
        {
            "filterName": "DenyAll",
            "action": "Reject",
            "ipMask": "0.0.0.0/0"
        }
    ]'
```

## Access Control

### Role-Based Access Control

```bash
# Create custom role for device operators
az role definition create --role-definition '{
    "Name": "IoT Device Operator",
    "Description": "Can manage devices but not hub settings",
    "Actions": [
        "Microsoft.Devices/IotHubs/devices/read",
        "Microsoft.Devices/IotHubs/devices/write",
        "Microsoft.Devices/IotHubs/devices/delete"
    ],
    "NotActions": [
        "Microsoft.Devices/IotHubs/write",
        "Microsoft.Devices/IotHubs/delete"
    ],
    "AssignableScopes": ["/subscriptions/{subscription-id}"]
}'

# Assign role
az role assignment create \
    --assignee user@domain.com \
    --role "IoT Device Operator" \
    --scope "/subscriptions/.../resourceGroups/.../providers/Microsoft.Devices/IotHubs/myIoTHub"
```

### Shared Access Policies

```bash
# Create restricted policy for device management
az iot hub policy create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --name deviceManager \
    --permissions RegistryRead RegistryWrite

# Create policy for service operations
az iot hub policy create \
    --hub-name myIoTHub \
    --resource-group myResourceGroup \
    --name serviceOperator \
    --permissions ServiceConnect
```

## Secure Device Provisioning

```python
from azure.iot.device.aio import ProvisioningDeviceClient
import os

async def secure_provisioning():
    """Provision device with attestation"""

    # Use TPM attestation for hardware security
    provisioning_client = ProvisioningDeviceClient.create_from_tpm(
        provisioning_host="global.azure-devices-provisioning.net",
        registration_id=os.environ["REGISTRATION_ID"],
        id_scope=os.environ["ID_SCOPE"]
    )

    # Or use X.509 certificate attestation
    from azure.iot.device import X509
    x509 = X509(
        cert_file="./device.crt",
        key_file="./device.key"
    )

    provisioning_client = ProvisioningDeviceClient.create_from_x509_certificate(
        provisioning_host="global.azure-devices-provisioning.net",
        registration_id=os.environ["REGISTRATION_ID"],
        id_scope=os.environ["ID_SCOPE"],
        x509=x509
    )

    result = await provisioning_client.register()
    return result
```

## Data Encryption

```python
from cryptography.fernet import Fernet
import json

class SecureTelemetry:
    def __init__(self, encryption_key):
        self.cipher = Fernet(encryption_key)

    def encrypt_payload(self, data):
        """Encrypt sensitive telemetry data"""
        json_data = json.dumps(data).encode('utf-8')
        return self.cipher.encrypt(json_data)

    def decrypt_payload(self, encrypted_data):
        """Decrypt telemetry data"""
        decrypted = self.cipher.decrypt(encrypted_data)
        return json.loads(decrypted.decode('utf-8'))

# Usage
secure = SecureTelemetry(Fernet.generate_key())

# Encrypt before sending
encrypted = secure.encrypt_payload({
    'temperature': 25.5,
    'patientId': 'confidential'
})

await device_client.send_message(encrypted)
```

## Security Monitoring

```python
from azure.monitor.query import LogsQueryClient
from azure.identity import DefaultAzureCredential

def query_security_events():
    """Query IoT Hub security events"""
    credential = DefaultAzureCredential()
    client = LogsQueryClient(credential)

    query = """
    AzureDiagnostics
    | where ResourceType == "IOTHUBS"
    | where Category == "Connections"
    | where ResultType == "Failure"
    | summarize FailedConnections = count() by DeviceId, bin(TimeGenerated, 1h)
    | order by FailedConnections desc
    """

    response = client.query_workspace(
        workspace_id="your-workspace-id",
        query=query,
        timespan="P1D"
    )

    return response.tables[0].rows
```

Implementing these security best practices creates a defense-in-depth approach for your IoT solutions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
