---
title: "Azure Arc Data Services: Azure SQL and PostgreSQL Anywhere"
author: Michael John Peña
draft: false
date: 2021-05-08
tags:
  - Azure
  - Azure Arc
  - SQL
  - PostgreSQL
  - Hybrid Cloud

---

I wrote "Azure Arc Data Services: Azure SQL and PostgreSQL Anywhere" to share practical, production-minded guidance on this topic.

## Why Arc Data Services?

Many organizations need:
- Cloud databases in regulated environments
- Low-latency access from on-premises applications
- Data sovereignty compliance
- Consistent management across locations

Arc data services let you run Azure-managed databases on your own infrastructure while using Azure tools for management.

## Architecture Overview

```
Your Infrastructure          Azure
+------------------+        +------------------+
|                  |        |                  |
| Kubernetes       |<------>| Azure Resource   |
| Cluster          |        | Manager          |
|                  |        |                  |
| +-------------+  |        | +-------------+  |
| | Arc Data    |  |        | | Azure       |  |
| | Controller  |  |        | | Portal      |  |
| +-------------+  |        | +-------------+  |
|                  |        |                  |
| +-------------+  |        | +-------------+  |
| | SQL MI      |  |        | | Monitoring  |  |
| | PostgreSQL  |  |        | | Billing     |  |
| +-------------+  |        | +-------------+  |
+------------------+        +------------------+
```

## Prerequisites

Before deploying, you need:
1. Kubernetes cluster (AKS, OpenShift, K3s, or any conformant cluster)
2. Azure subscription
3. Azure CLI with arcdata extension
4. kubectl configured for your cluster

```bash
# Install Azure CLI extensions
az extension add --name arcdata
az extension add --name k8s-extension
az extension add --name connectedk8s

# Connect your Kubernetes cluster to Azure Arc
az connectedk8s connect \
    --name my-arc-cluster \
    --resource-group my-rg \
    --location eastus
```

## Deploying the Data Controller

The data controller is the management plane for Arc data services:

```bash
# Create Azure Arc data controller
az arcdata dc create \
    --name arc-data-controller \
    --resource-group my-rg \
    --location eastus \
    --connectivity-mode indirect \
    --k8s-namespace arc-data \
    --storage-class managed-premium \
    --infrastructure azure \
    --use-k8s

# For direct connectivity (requires outbound connectivity to Azure)
az arcdata dc create \
    --name arc-data-controller \
    --resource-group my-rg \
    --location eastus \
    --connectivity-mode direct \
    --subscription <subscription-id> \
    --custom-location my-custom-location
```

## Connectivity Modes

**Direct Mode:**
- Real-time connection to Azure
- Azure Portal integration
- Automatic log/metrics upload
- Requires outbound connectivity

**Indirect Mode:**
- Works in air-gapped environments
- Manual export of logs/metrics
- Azure Portal shows last-known state
- Best for high-security environments

## Deploying SQL Managed Instance

Create a SQL MI on your Arc-enabled Kubernetes:

```bash
# Create SQL Managed Instance
az sql mi-arc create \
    --name sql-arc-instance \
    --resource-group my-rg \
    --location eastus \
    --custom-location my-custom-location \
    --tier GeneralPurpose \
    --cores-limit 4 \
    --cores-request 2 \
    --memory-limit 8Gi \
    --memory-request 4Gi \
    --storage-class-data managed-premium \
    --storage-class-logs managed-premium \
    --volume-size-data 32Gi \
    --volume-size-logs 5Gi \
    --admin-login-secret sql-admin-secret

# Check status
az sql mi-arc show --name sql-arc-instance --resource-group my-rg
```

Or using Kubernetes manifests directly:

```yaml
apiVersion: sql.arcdata.microsoft.com/v1
kind: SqlManagedInstance
metadata:
  name: sql-arc-instance
  namespace: arc-data
spec:
  scheduling:
    default:
      resources:
        requests:
          cpu: "2"
          memory: 4Gi
        limits:
          cpu: "4"
          memory: 8Gi
  services:
    primary:
      type: LoadBalancer
  storage:
    data:
      volumes:
      - className: managed-premium
        size: 32Gi
    logs:
      volumes:
      - className: managed-premium
        size: 5Gi
  tier: GeneralPurpose
  licenseType: LicenseIncluded
```

## Connecting to Arc SQL MI

```python
import pyodbc

# Connection string
conn_str = (
    "Driver={ODBC Driver 17 for SQL Server};"
    "Server=sql-arc-instance-external-svc.arc-data.svc.cluster.local,1433;"
    "Database=master;"
    "UID=sa;"
    "PWD=<your-password>"
)

# Connect and query
with pyodbc.connect(conn_str) as conn:
    cursor = conn.cursor()
    cursor.execute("SELECT @@VERSION")
    row = cursor.fetchone()
    print(row[0])
```

## Deploying PostgreSQL Hyperscale

PostgreSQL Hyperscale on Arc provides distributed PostgreSQL with Citus:

```bash
# Create PostgreSQL Hyperscale server group
az postgres arc-server create \
    --name postgres-arc \
    --resource-group my-rg \
    --custom-location my-custom-location \
    --workers 2 \
    --cores-limit 4 \
    --cores-request 2 \
    --memory-limit 8Gi \
    --memory-request 4Gi \
    --storage-class-data managed-premium \
    --volume-size-data 32Gi \
    --admin-login-secret postgres-admin-secret
```

Connect and use distributed queries:

```python
import psycopg2

conn = psycopg2.connect(
    host="postgres-arc-external-svc.arc-data.svc.cluster.local",
    port=5432,
    database="postgres",
    user="postgres",
    password="<your-password>"
)

with conn.cursor() as cur:
    # Create distributed table
    cur.execute("""
        CREATE TABLE events (
            id SERIAL,
            tenant_id INT,
            event_data JSONB,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    # Distribute the table
    cur.execute("SELECT create_distributed_table('events', 'tenant_id');")

    # Insert data - automatically distributed across workers
    cur.execute("""
        INSERT INTO events (tenant_id, event_data)
        VALUES (%s, %s)
    """, (1, '{"type": "click", "page": "/home"}'))

    conn.commit()
```

## Monitoring and Management

Arc data services integrate with Azure Monitor:

```bash
# Export logs to Azure (indirect mode)
az arcdata dc export \
    --type logs \
    --path ./logs-export \
    --k8s-namespace arc-data

# Upload to Azure
az arcdata dc upload \
    --path ./logs-export

# Export metrics
az arcdata dc export \
    --type metrics \
    --path ./metrics-export \
    --k8s-namespace arc-data
```

Query using Azure Resource Graph:

```kusto
Resources
| where type == "microsoft.azurearcdata/sqlmanagedinstances"
| project name, location, properties.k8sRaw.status.state
```

## High Availability

Configure HA for SQL MI:

```yaml
apiVersion: sql.arcdata.microsoft.com/v1
kind: SqlManagedInstance
metadata:
  name: sql-arc-ha
spec:
  replicas: 3  # Enables Always On Availability Groups
  services:
    primary:
      type: LoadBalancer
    readableSecondaries:
      type: LoadBalancer
  storage:
    data:
      volumes:
      - className: managed-premium
        size: 64Gi
  tier: BusinessCritical  # Required for HA
```

## Backup and Restore

Arc SQL MI supports automated backups:

```bash
# Configure backup storage
az sql mi-arc update \
    --name sql-arc-instance \
    --resource-group my-rg \
    --retention-days 7 \
    --automated-backup enabled

# Restore to a point in time
az sql mi-arc restore \
    --source-database MyDB \
    --dest-name MyDB-Restored \
    --managed-instance sql-arc-instance \
    --resource-group my-rg \
    --time "2021-05-08T12:00:00Z"
```

## Pricing Considerations

Arc data services follow a hybrid pricing model:
- **License-included**: Full price, includes SQL license
- **Azure Hybrid Benefit**: Bring your existing SQL licenses
- **Dev/Test**: Reduced pricing for non-production

```bash
# Apply Azure Hybrid Benefit
az sql mi-arc update \
    --name sql-arc-instance \
    --resource-group my-rg \
    --license-type BasePrice
```

## Best Practices

1. **Size appropriately**: Start small, scale up based on metrics
2. **Use persistent storage**: Production workloads need reliable storage classes
3. **Plan for networking**: External access requires proper LoadBalancer or Ingress
4. **Monitor continuously**: Set up alerting on key metrics
5. **Test failover**: Validate HA configuration regularly

## Resources

- [Azure Arc Data Services Documentation](https://docs.microsoft.com/en-us/azure/azure-arc/data/)
- [SQL Managed Instance on Arc](https://docs.microsoft.com/en-us/azure/azure-arc/data/managed-instance-overview)
- [PostgreSQL Hyperscale on Arc](https://docs.microsoft.com/en-us/azure/azure-arc/data/what-is-azure-arc-enabled-postgres-hyperscale)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
