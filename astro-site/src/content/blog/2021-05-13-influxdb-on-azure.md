---
title: "InfluxDB on Azure: Deploying Time-Series Infrastructure"
author: Michael John Peña
draft: false
date: 2021-05-13
tags:
  - Azure
  - InfluxDB
  - Time Series
  - Monitoring
  - Data

---

I wrote "InfluxDB on Azure: Deploying Time-Series Infrastructure" to share practical, production-minded guidance on this topic.

## Deployment Options

### Option 1: Azure Container Instance (Simple)

For development or small workloads:

```bash
# Create storage account for persistence
az storage account create \
    --name influxstorage \
    --resource-group my-rg \
    --location eastus \
    --sku Standard_LRS

# Create file share
az storage share create \
    --name influxdata \
    --account-name influxstorage

# Get storage key
STORAGE_KEY=$(az storage account keys list \
    --account-name influxstorage \
    --resource-group my-rg \
    --query '[0].value' -o tsv)

# Deploy InfluxDB container
az container create \
    --name influxdb \
    --resource-group my-rg \
    --image influxdb:2.0 \
    --cpu 2 \
    --memory 4 \
    --ports 8086 \
    --dns-name-label my-influxdb \
    --azure-file-volume-account-name influxstorage \
    --azure-file-volume-account-key $STORAGE_KEY \
    --azure-file-volume-share-name influxdata \
    --azure-file-volume-mount-path /var/lib/influxdb2 \
    --environment-variables \
        DOCKER_INFLUXDB_INIT_MODE=setup \
        DOCKER_INFLUXDB_INIT_USERNAME=admin \
        DOCKER_INFLUXDB_INIT_PASSWORD='<strong-password>' \
        DOCKER_INFLUXDB_INIT_ORG=myorg \
        DOCKER_INFLUXDB_INIT_BUCKET=default
```

### Option 2: Azure Kubernetes Service (Production)

For production workloads, use AKS with persistent volumes:

```yaml
# influxdb-deployment.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: influxdb
spec:
  serviceName: influxdb
  replicas: 1
  selector:
    matchLabels:
      app: influxdb
  template:
    metadata:
      labels:
        app: influxdb
    spec:
      containers:
      - name: influxdb
        image: influxdb:2.0
        ports:
        - containerPort: 8086
        env:
        - name: DOCKER_INFLUXDB_INIT_MODE
          value: setup
        - name: DOCKER_INFLUXDB_INIT_USERNAME
          valueFrom:
            secretKeyRef:
              name: influxdb-secrets
              key: username
        - name: DOCKER_INFLUXDB_INIT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: influxdb-secrets
              key: password
        - name: DOCKER_INFLUXDB_INIT_ORG
          value: myorg
        - name: DOCKER_INFLUXDB_INIT_BUCKET
          value: default
        volumeMounts:
        - name: influxdb-data
          mountPath: /var/lib/influxdb2
        resources:
          requests:
            cpu: "1"
            memory: "4Gi"
          limits:
            cpu: "4"
            memory: "16Gi"
  volumeClaimTemplates:
  - metadata:
      name: influxdb-data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: managed-premium
      resources:
        requests:
          storage: 100Gi\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
