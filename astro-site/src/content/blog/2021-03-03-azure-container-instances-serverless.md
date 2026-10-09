---
title: Azure Container Instances for Serverless Container Workloads
description: "ACI is the container service I reach for when I need a container running in under two minutes and I don't want to explain what a node pool is. Per-second…"
author: Michael John Pena
draft: false
date: 2021-03-03
url: /blog/azure-container-instances-serverless/
tags:
  - Azure
  - Containers
  - ACI
  - Serverless
  - Docker
---

ACI is the container service I reach for when I need a container running in under two minutes and I don't want to explain what a node pool is. Per-second billing, no cluster to manage, VNet integration when you need it, and GPU support for batch inferencing jobs. The use cases I keep shipping on it: CI/CD job runners (spin up on trigger, run the job, pay nothing while idle), short-lived background workers, and integration test environments that need a containerised dependency without a full orchestration layer. Not a Kubernetes replacement—ACI is the thing you use when Kubernetes is the wrong size for the problem.

## When to Use ACI

ACI is ideal for:
- Batch processing jobs
- CI/CD build agents
- Event-driven processing
- Simple web applications
- Development and testing
- Burstable workloads from AKS (Virtual Kubelet)

## Quick Start with Azure CLI

Deploy a container in seconds:

```bash
# Create a resource group
az group create --name myACIGroup --location eastus

# Deploy a container
az container create \
    --resource-group myACIGroup \
    --name mycontainer \
    --image mcr.microsoft.com/azuredocs/aci-helloworld \
    --dns-name-label aci-demo-$RANDOM \
    --ports 80

# Get the FQDN
az container show \
    --resource-group myACIGroup \
    --name mycontainer \
    --query ipAddress.fqdn \
    --output tsv
```

## Container Groups

Container groups allow multiple containers to share lifecycle, resources, and network:

```yaml
# container-group.yaml
apiVersion: 2019-12-01
location: eastus
name: multi-container-group
properties:
  containers:
  - name: web-app
    properties:
      image: nginx:alpine
      ports:
      - port: 80
      resources:
        requests:
          cpu: 1.0
          memoryInGb: 1.5
      volumeMounts:
      - name: shared-data
        mountPath: /usr/share/nginx/html
  - name: sidecar
    properties:
      image: myacr.azurecr.io/content-updater:v1
      resources:
        requests:
          cpu: 0.5
          memoryInGb: 0.5
      volumeMounts:
      - name: shared-data
        mountPath: /data
  volumes:
  - name: shared-data
    emptyDir: {}
  osType: Linux
  ipAddress:
    type: Public
    ports:
    - protocol: tcp
      port: 80
tags: {}
type: Microsoft.ContainerInstance/containerGroups
```

Deploy with:

```bash
az container create \
    --resource-group myACIGroup \
    --file container-group.yaml
```

## Deploying from Azure Container Registry

```bash
# Create ACR
az acr create \
    --resource-group myACIGroup \
    --name myacr \
    --sku Basic

# Build and push image
az acr build \
    --registry myacr \
    --image myapp:v1 \
    ./src

# Enable admin user (for simple scenarios)
az acr update --name myacr --admin-enabled true

# Get credentials
ACR_USERNAME=$(az acr credential show --name myacr --query username --output tsv)
ACR_PASSWORD=$(az acr credential show --name myacr --query passwords[0].value --output tsv)

# Deploy from ACR
az container create \
    --resource-group myACIGroup \
    --name myapp \
    --image myacr.azurecr.io/myapp:v1 \
    --registry-login-server myacr.azurecr.io \
    --registry-username $ACR_USERNAME \
    --registry-password $ACR_PASSWORD \
    --dns-name-label myapp-demo \
    --ports 80
```

## Environment Variables and Secrets

```bash
# With environment variables
az container create \
    --resource-group myACIGroup \
    --name myapp \
    --image myacr.azurecr.io/myapp:v1 \
    --environment-variables \
        'DATABASE_HOST'='myserver.database.windows.net' \
        'LOG_LEVEL'='INFO' \
    --secure-environment-variables \
        'DATABASE_PASSWORD'='secretpassword123' \
    --registry-login-server myacr.azurecr.io \
    --registry-username $ACR_USERNAME \
    --registry-password $ACR_PASSWORD
```

## Mounting Azure Files

```bash
# Create storage account and file share
az storage account create \
    --resource-group myACIGroup \
    --name mystorageaccount \
    --sku Standard_LRS

az storage share create \
    --name myshare \
    --account-name mystorageaccount

# Get storage key
STORAGE_KEY=$(az storage account keys list \
    --resource-group myACIGroup \
    --account-name mystorageaccount \
    --query '[0].value' \
    --output tsv)

# Deploy with volume mount
az container create \
    --resource-group myACIGroup \
    --name myapp \
    --image myacr.azurecr.io/myapp:v1 \
    --azure-file-volume-account-name mystorageaccount \
    --azure-file-volume-account-key $STORAGE_KEY \
    --azure-file-volume-share-name myshare \
    --azure-file-volume-mount-path /data
```

## Running Batch Jobs with ACI

Python script for batch processing:

```python
# batch_processor.py
import os
import json
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential

def process_batch():
    connection_string = os.environ['STORAGE_CONNECTION_STRING']
    input_container = os.environ.get('INPUT_CONTAINER', 'input')
    output_container = os.environ.get('OUTPUT_CONTAINER', 'output')

    blob_service = BlobServiceClient.from_connection_string(connection_string)
    input_client = blob_service.get_container_client(input_container)
    output_client = blob_service.get_container_client(output_container)

    # Process each blob in input container
    for blob in input_client.list_blobs():
        print(f"Processing: {blob.name}")

        # Download and process
        blob_data = input_client.download_blob(blob.name).readall()
        processed_data = transform_data(blob_data)

        # Upload result
        output_blob = output_client.get_blob_client(f"processed_{blob.name}")
        output_blob.upload_blob(processed_data, overwrite=True)

        print(f"Completed: {blob.name}")

def transform_data(data):
    # Your transformation logic here
    result = data.upper()  # Simple example
    return result

if __name__ == "__main__":
    process_batch()
    print("Batch processing complete!")
```

Dockerfile:

```dockerfile
FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY batch_processor.py .

CMD ["python", "batch_processor.py"]
```

Deploy as a job:

```bash
az container create \
    --resource-group myACIGroup \
    --name batch-job \
    --image myacr.azurecr.io/batch-processor:v1 \
    --restart-policy Never \
    --environment-variables \
        'INPUT_CONTAINER'='raw-data' \
        'OUTPUT_CONTAINER'='processed-data' \
    --secure-environment-variables \
        'STORAGE_CONNECTION_STRING'='your-connection-string' \
    --cpu 2 \
    --memory 4
```

## Virtual Network Integration

Deploy ACI into a virtual network for private connectivity:

```bash
# Create VNet and subnet
az network vnet create \
    --resource-group myACIGroup \
    --name myVNet \
    --address-prefix 10.0.0.0/16 \
    --subnet-name aci-subnet \
    --subnet-prefix 10.0.1.0/24

# Delegate subnet to ACI
az network vnet subnet update \
    --resource-group myACIGroup \
    --vnet-name myVNet \
    --name aci-subnet \
    --delegations Microsoft.ContainerInstance/containerGroups

# Deploy container in VNet
az container create \
    --resource-group myACIGroup \
    --name private-container \
    --image myacr.azurecr.io/myapp:v1 \
    --vnet myVNet \
    --subnet aci-subnet \
    --registry-login-server myacr.azurecr.io \
    --registry-username $ACR_USERNAME \
    --registry-password $ACR_PASSWORD
```

## GPU Workloads

ACI supports GPU containers for ML inference:

```bash
az container create \
    --resource-group myACIGroup \
    --name gpu-container \
    --image myacr.azurecr.io/ml-inference:v1 \
    --sku gpu \
    --gpu-count 1 \
    --gpu-sku K80 \
    --cpu 4 \
    --memory 14
```

## Monitoring and Logging

```bash
# View logs
az container logs \
    --resource-group myACIGroup \
    --name mycontainer

# Stream logs
az container attach \
    --resource-group myACIGroup \
    --name mycontainer

# Execute command in running container
az container exec \
    --resource-group myACIGroup \
    --name mycontainer \
    --exec-command "/bin/bash"
```

## Conclusion

Azure Container Instances provides a lightweight, serverless approach to running containers. It excels for scenarios where you need quick deployment without infrastructure management. Combined with Azure Functions, Logic Apps, or Event Grid, ACI becomes a powerful tool for event-driven containerized workloads.

For long-running services or complex orchestration, consider AKS. But for batch jobs, burst workloads, and simple applications, ACI offers unmatched simplicity and cost efficiency.
