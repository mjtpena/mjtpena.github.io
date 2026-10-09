---
title: Edge Computing with Azure Stack Edge
author: Michael John Pena
draft: false
date: 2021-09-30
tags:
  - Azure
  - Edge Computing
  - Azure Stack Edge
  - IoT
  - Hybrid Cloud
---

## Azure Stack Edge Devices

| Model | GPU | Use Case |
|-------|-----|----------|
| Pro (GPU) | NVIDIA T4 | AI inference, video analytics |
| Pro (FPGA) | Intel Arria 10 | Hardware acceleration |
| Pro R | Rugged | Harsh environments |
| Mini R | Portable | Mobile edge |

## Architecture Overview

```
+-------------------+      +------------------+      +---------------+
|   Local Apps      | ---> |  Azure Stack     | ---> |   Azure       |
|   IoT Devices     |      |  Edge Device     |      |   Cloud       |
|   Sensors         |      +------------------+      +---------------+
+-------------------+      |  - Kubernetes    |      |  - IoT Hub    |
                           |  - VM Workloads  |      |  - Storage    |
                           |  - AI Inference  |      |  - ML Service |
                           |  - Local Storage |      |  - Analytics  |
                           +------------------+      +---------------+
```

## Managing Azure Stack Edge

```python
from azure.mgmt.databoxedge import DataBoxEdgeManagementClient
from azure.mgmt.databoxedge.models import (
    DataBoxEdgeDevice,
    Sku,
    Share,
    StorageAccountCredential,
    User,
    Role,
    IoTRole,
    AsymmetricEncryptedSecret
)
from azure.identity import DefaultAzureCredential

class StackEdgeManager:
    def __init__(self, subscription_id: str, resource_group: str):
        self.credential = DefaultAzureCredential()
        self.client = DataBoxEdgeManagementClient(self.credential, subscription_id)
        self.resource_group = resource_group

    def create_device(self, device_name: str, location: str,
                     sku: str = "Edge") -> DataBoxEdgeDevice:
        """Create an Azure Stack Edge device resource."""

        device = DataBoxEdgeDevice(
            location=location,
            sku=Sku(name=sku)
        )

        return self.client.devices.begin_create_or_update(
            device_name,
            self.resource_group,
            device
        ).result()

    def get_activation_key(self, device_name: str) -> str:
        """Get activation key for device setup."""

        key = self.client.devices.generate_activation_key(
            device_name,
            self.resource_group
        )
        return key.activation_key

    def create_storage_account_credential(self, device_name: str,
                                         name: str,
                                         storage_account_name: str,
                                         storage_account_key: str):
        """Create storage account credential for data sync."""

        # Encrypt the storage account key
        encrypted_key = AsymmetricEncryptedSecret(
            value=storage_account_key,
            encryption_cert_thumbprint="...",
            encryption_algorithm="RSA1_5"
        )

        credential = StorageAccountCredential(
            alias=name,
            storage_account_name=storage_account_name,
            storage_account_type="GeneralPurposeStorage",
            account_key=encrypted_key,
            ssl_status="Enabled"
        )

        return self.client.storage_account_credentials.begin_create_or_update(
            device_name,
            name,
            self.resource_group,
            credential
        ).result()

    def create_share(self, device_name: str, share_name: str,
                    credential_name: str, container_name: str):
        """Create a share for data tiering to cloud."""

        share = Share(
            share_status="Online",
            monitoring_status="Enabled",
            azure_container_info={
                "storage_account_credential_id": f"/subscriptions/.../storageAccountCredentials/{credential_name}",
                "container_name": container_name,
                "data_format": "BlockBlob"
            },
            access_protocol="SMB",
            data_policy="Cloud"  # Data tiers to cloud
        )

        return self.client.shares.begin_create_or_update(
            device_name,
            share_name,
            self.resource_group,
            share
        ).result()

# Usage
edge_manager = StackEdgeManager("subscription-id", "edge-rg")

# Create device resource
device = edge_manager.create_device("factory-edge-01", "westus")

# Get activation key
activation_key = edge_manager.get_activation_key("factory-edge-01")
print(f"Activate device with: {activation_key}")
```

## Deploying Kubernetes Workloads

```python
from azure.mgmt.databoxedge.models import (
    KubernetesRole,
    KubernetesRoleCompute,
    KubernetesRoleStorage,
    KubernetesRoleNetwork,
    MountPointMap,
    LoadBalancerConfig
)

def configure_kubernetes(edge_manager: StackEdgeManager, device_name: str):
    """Configure Kubernetes on Azure Stack Edge."""

    kubernetes_role = KubernetesRole(
        host_platform="Linux",
        host_platform_type="KubernetesCluster",
        kubernetes_cluster_info={
            "version": "1.21"
        },
        kubernetes_role_resources={
            "compute": KubernetesRoleCompute(
                vm_profile="DS3_v2"
            ),
            "storage": KubernetesRoleStorage(
                endpoints=[
                    {"storage_account_name": "edgestorage", "container_name": "data"}
                ]
            ),
            "network": KubernetesRoleNetwork(
                load_balancer_config=LoadBalancerConfig(
                    type="MetalLB",
                    ip_ranges=[
                        {"start": "10.0.0.100", "end": "10.0.0.110"}
                    ]
                )
            )
        }
    )

    return edge_manager.client.roles.begin_create_or_update(
        device_name,
        "kubernetes-role",
        edge_manager.resource_group,
        kubernetes_role
    ).result()
```

## Deploying IoT Edge Modules

```python
from azure.mgmt.databoxedge.models import (
    IoTRole,
    IoTDeviceInfo,
    MountPointMap
)

def configure_iot_edge(edge_manager: StackEdgeManager, device_name: str,
                       iot_hub_resource_id: str):
    """Configure IoT Edge on Azure Stack Edge."""

    iot_role = IoTRole(
        host_platform="Linux",
        iot_device_details=IoTDeviceInfo(
            device_id=f"{device_name}-iot",
            iot_host_hub=iot_hub_resource_id,
            authentication={
                "symmetric_key": {
                    "connection_string": "HostName=..."
                }
            }
        ),
        iot_edge_device_details=IoTDeviceInfo(
            device_id=f"{device_name}-edge",
            iot_host_hub=iot_hub_resource_id
        ),
        share_mappings=[
            MountPointMap(
                share_id=f"/subscriptions/.../shares/data-share",
                role_type="IoT",
                mount_point="/data"
            )
        ]
    )

    return edge_manager.client.roles.begin_create_or_update(
        device_name,
        "iot-role",
        edge_manager.resource_group,
        iot_role
    ).result()
```

## Running AI Workloads

```python
# Kubernetes deployment for AI inference
ai_deployment_yaml = """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-inference
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ai-inference
  template:
    metadata:
      labels:
        app: ai-inference
    spec:
      containers:
      - name: inference
        image: myregistry.azurecr.io/inference:latest
        ports:
        - containerPort: 8080
        resources:
          limits:
            nvidia.com/gpu: 1
        volumeMounts:
        - name: data-volume
          mountPath: /data
      volumes:
      - name: data-volume
        persistentVolumeClaim:
          claimName: edge-pvc
```
