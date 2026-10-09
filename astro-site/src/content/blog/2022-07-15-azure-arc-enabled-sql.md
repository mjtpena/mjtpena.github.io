---
title: "Azure Arc-Enabled SQL Managed Instance"
description: "Azure Arc-enabled SQL Managed Instance delivers enterprise SQL Server capabilities with cloud-native operations on any infrastructure."
author: "Michael John Peña"
draft: false
date: 2022-07-15
tags: ["Azure", "Azure Arc", "SQL Server", "Hybrid Cloud", "Kubernetes"]
---

## Benefits of Arc-Enabled SQL MI

- **SQL Server compatibility**: Near 100% compatibility with SQL Server
- **Evergreen SQL**: Always up-to-date patches and features
- **Elastic scale**: Scale compute and storage independently
- **High availability**: Built-in HA with synchronous replicas
- **Unified management**: Azure portal, CLI, and APIs

## Deploying SQL Managed Instance

```yaml
# sql-managed-instance.yaml
apiVersion: sql.arcdata.microsoft.com/v1
kind: SqlManagedInstance
metadata:
  name: my-sql-mi
  namespace: arc
spec:
  scheduling:
    default:
      resources:
        requests:
          memory: "4Gi"
          cpu: "2"
        limits:
          memory: "8Gi"
          cpu: "4"
  storage:
    data:
      className: managed-premium
      size: 100Gi
    logs:
      className: managed-premium
      size: 50Gi
    backups:
      className: azurefile
      size: 100Gi
  replicas: 3
  tier: BusinessCritical
  licenseType: LicenseIncluded
```

```bash
# Deploy using kubectl
kubectl apply -f sql-managed-instance.yaml

# Or use Azure CLI
az sql mi-arc create \
    --name my-sql-mi \
    --k8s-namespace arc \
    --replicas 3 \
    --cores-request 2 \
    --cores-limit 4 \
    --memory-request 4Gi \
    --memory-limit 8Gi \
    --storage-class-data managed-premium \
    --volume-size-data 100Gi \
    --tier BusinessCritical \
    --use-k8s
```

## Connecting to SQL Managed Instance

```bash
# Get connection endpoint
az sql mi-arc endpoint list \
    --name my-sql-mi \
    --k8s-namespace arc \
    --use-k8s
```

```python
import pyodbc

# Connection string for Arc-enabled SQL MI
conn_str = (
    "Driver={ODBC Driver 18 for SQL Server};"
    "Server=my-sql-mi.arc.svc.cluster.local,1433;"
    "Database=master;"
    "UID=sa;"
    "PWD=YourPassword123!;"
    "TrustServerCertificate=yes;"
)

conn = pyodbc.connect(conn_str)
cursor = conn.cursor()

# Check SQL Server version
cursor.execute("SELECT @@VERSION")
print(cursor.fetchone()[0])

# Create a database
cursor.execute("CREATE DATABASE SampleDB")
conn.commit()
```

## High Availability Configuration

```sql
-- Check availability group status
SELECT
    ag.name AS ag_name,
    ar.replica_server_name,
    ar.availability_mode_desc,
    ars.role_desc,
    ars.synchronization_health_desc
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id = ars.replica_id;

-- Check database replica states
SELECT
    db.name AS database_name,
    drs.synchronization_state_desc,
    drs.synchronization_health_desc,
    drs.log_send_queue_size,
    drs.redo_queue_size
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.databases db ON drs.database_id = db.database_id;
```

## Point-in-Time Restore

```bash
# Create a backup
az sql mi-arc backup create \
    --name my-sql-mi \
    --k8s-namespace arc \
    --use-k8s

# Restore to a point in time
az sql mi-arc restore \
    --name my-sql-mi \
    --dest-name my-sql-mi-restored \
    --k8s-namespace arc \
    --time "2022-07-15T10:00:00Z" \
    --use-k8s
```

## Monitoring and Diagnostics

```sql
-- Enable Query Store
ALTER DATABASE [SampleDB] SET QUERY_STORE = ON;

-- View top resource-consuming queries
SELECT TOP 10
    q.query_id,
    qt.query_sql_text,
    rs.avg_cpu_time,
    rs.avg_logical_io_reads,
    rs.avg_duration,
    rs.count_executions
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
ORDER BY rs.avg_cpu_time DESC;
```

```bash
# View logs
kubectl logs -f my-sql-mi-0 -n arc -c arc-sqlmi

# Export diagnostics
az sql mi-arc get-diagnostics \
    --name my-sql-mi \
    --k8s-namespace arc \
    --use-k8s
```

## Failover Testing

```bash
# Initiate a manual failover
az sql mi-arc failover \
    --name my-sql-mi \
    --k8s-namespace arc \
    --use-k8s
```

Azure Arc-enabled SQL Managed Instance delivers enterprise SQL Server capabilities with cloud-native operations on any infrastructure.
