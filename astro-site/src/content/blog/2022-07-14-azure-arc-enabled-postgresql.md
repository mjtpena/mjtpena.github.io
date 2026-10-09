---
title: "Azure Arc-Enabled PostgreSQL Hyperscale"
description: "Azure Arc-enabled PostgreSQL Hyperscale brings the best of Azure's managed database services to wherever your data needs to live."
author: "Michael John Peña"
draft: false
date: 2022-07-14
tags: ["Azure", "Azure Arc", "PostgreSQL", "Hybrid Cloud", "Kubernetes"]
---

## Understanding Azure Arc Data Services

Azure Arc extends Azure management to any infrastructure. With Arc-enabled data services, you get:

- Azure-managed PostgreSQL on your own infrastructure
- Elastic scale-out with Citus
- Always up-to-date with automated updates
- Unified management through Azure portal

## Prerequisites

```bash
# Install Azure CLI extensions
az extension add --name arcdata
az extension add --name k8s-extension
az extension add --name connectedk8s

# Connect your Kubernetes cluster to Azure Arc
az connectedk8s connect \
    --name myArcCluster \
    --resource-group myResourceGroup \
    --location eastus
```

## Deploying the Data Controller

```bash
# Create the data controller
az arcdata dc create \
    --name arc-dc \
    --resource-group myResourceGroup \
    --location eastus \
    --connectivity-mode indirect \
    --k8s-namespace arc \
    --use-k8s

# Or use direct connectivity for full Azure integration
az arcdata dc create \
    --name arc-dc \
    --resource-group myResourceGroup \
    --location eastus \
    --connectivity-mode direct \
    --subscription $SUBSCRIPTION_ID \
    --custom-location myCustomLocation \
    --k8s-namespace arc
```

## Creating PostgreSQL Hyperscale Server Group

```yaml
# postgresql-hyperscale.yaml
apiVersion: arcdata.microsoft.com/v1
kind: PostgreSql
metadata:
  name: my-postgres-hs
  namespace: arc
spec:
  scheduling:
    default:
      resources:
        requests:
          memory: "2Gi"
          cpu: "1"
        limits:
          memory: "4Gi"
          cpu: "2"
  storage:
    data:
      className: managed-premium
      size: 100Gi
    logs:
      className: managed-premium
      size: 10Gi
  scale:
    workers: 3
  engine:
    extensions:
      - name: citus
      - name: pg_stat_statements
```

```bash
# Apply the configuration
kubectl apply -f postgresql-hyperscale.yaml

# Or use Azure CLI
az postgres arc-server create \
    --name my-postgres-hs \
    --k8s-namespace arc \
    --workers 3 \
    --cores-request 1 \
    --cores-limit 2 \
    --memory-request 2Gi \
    --memory-limit 4Gi \
    --storage-class-data managed-premium \
    --volume-size-data 100Gi \
    --use-k8s
```

## Connecting to Your Server Group

```bash
# Get connection endpoint
az postgres arc-server endpoint list \
    --name my-postgres-hs \
    --k8s-namespace arc \
    --use-k8s

# Connect using psql
PGPASSWORD='mypassword' psql -h <endpoint> -U postgres -d postgres
```

```python
import psycopg2

# Connection to Arc-enabled PostgreSQL
conn = psycopg2.connect(
    host="my-postgres-hs.arc.svc.cluster.local",
    port=5432,
    database="postgres",
    user="postgres",
    password="mypassword"
)

# Test distributed table creation
with conn.cursor() as cur:
    cur.execute("SELECT citus_version();")
    print(cur.fetchone())

    cur.execute("""
        CREATE TABLE events (
            id bigserial,
            tenant_id int,
            data jsonb
        );
        SELECT create_distributed_table('events', 'tenant_id');
    """)
    conn.commit()
```

## Scaling Operations

```bash
# Scale out workers
az postgres arc-server edit \
    --name my-postgres-hs \
    --k8s-namespace arc \
    --workers 5 \
    --use-k8s

# Scale up resources
az postgres arc-server edit \
    --name my-postgres-hs \
    --k8s-namespace arc \
    --cores-request 2 \
    --memory-request 4Gi \
    --use-k8s
```

## Monitoring with Grafana

```bash
# Get Grafana endpoint
az arcdata dc endpoint list \
    --k8s-namespace arc \
    --use-k8s

# Access dashboards at https://<grafana-endpoint>/dashboards
```

## Backup and Restore

```bash
# Create a backup
az postgres arc-server backup create \
    --name my-postgres-hs \
    --k8s-namespace arc \
    --use-k8s

# List backups
az postgres arc-server backup list \
    --name my-postgres-hs \
    --k8s-namespace arc \
    --use-k8s

# Restore from backup
az postgres arc-server backup restore \
    --name my-postgres-hs \
    --k8s-namespace arc \
    --backup-id <backup-id> \
    --use-k8s
```

Azure Arc-enabled PostgreSQL Hyperscale brings the best of Azure's managed database services to wherever your data needs to live.
