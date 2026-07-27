---
title: "Azure Arc-Enabled Data Services: Run Azure Data Anywhere"
author: Michael John Pena
draft: false
date: 2021-11-18
tags:
  - Azure
  - Azure Arc
  - SQL
  - PostgreSQL
  - Data
  - Kubernetes

---

I wrote "Azure Arc-Enabled Data Services: Run Azure Data Anywhere" to share practical, production-minded guidance on this topic.

## What Are Arc-Enabled Data Services?

Arc-enabled data services provide:

- **Azure SQL Managed Instance**: Full SQL Server compatibility
- **Azure PostgreSQL Hyperscale**: Distributed PostgreSQL with Citus
- **Evergreen updates**: Always current with Azure SQL updates
- **Flexible deployment**: Direct or indirect connectivity modes
- **Azure integration**: Billing, monitoring, and security from Azure

## Architecture Overview

```plaintext
                    ┌─────────────────────────────────────────┐
                    │              Azure                        │
                    │  ┌──────────────┐  ┌──────────────────┐  │
                    │  │ Azure Portal │  │ Azure Monitor    │  │
                    │  └──────────────┘  └──────────────────┘  │
                    │  ┌──────────────┐  ┌──────────────────┐  │
                    │  │ ARM/Billing  │  │ Azure AD         │  │
                    │  └──────────────┘  └──────────────────┘  │
                    └───────────────────▲──────────────────────┘
                                        │
                    ┌───────────────────┼──────────────────────┐
                    │    Kubernetes     │   (On-Prem/Edge/Cloud)│
                    │  ┌────────────────┴─────────────────────┐│
                    │  │         Data Controller              ││
                    │  │   (orchestrates data services)       ││
                    │  └──────────────────────────────────────┘│
                    │  ┌──────────────┐  ┌──────────────────┐  │
                    │  │ SQL MI #1    │  │ PostgreSQL #1    │  │
                    │  │ SQL MI #2    │  │ PostgreSQL #2    │  │
                    │  └──────────────┘  └──────────────────┘  │
                    └─────────────────────────────────────────┘
```

## Deploying the Data Controller

### Prerequisites

```bash
# Install Azure Data CLI extension
az extension add --name arcdata

# Verify Kubernetes cluster
kubectl get nodes
kubectl get storageclasses
```

### Create Data Controller

```bash
# Create the data controller (direct connected mode)
az arcdata dc create \
    --name arc-dc \
    --resource-group rg-arc-data \
    --location eastus \
    --connectivity-mode direct \
    --k8s-namespace arc-data \
    --subscription your-subscription-id \
    --use-k8s

# For indirect mode (air-gapped environments)
az arcdata dc create \
    --name arc-dc \
    --resource-group rg-arc-data \
    --location eastus \
    --connectivity-mode indirect \
    --k8s-namespace arc-data \
    --subscription your-subscription-id \
    --use-k8s
```

Using a configuration profile:

```yaml
# data-controller-config.yaml
apiVersion: arcdata.microsoft.com/v1
kind: DataController
metadata:
  name: arc-dc
  namespace: arc-data
spec:
  credentials:
    controllerAdmin: controller-login
    dockerRegistry: arc-private-registry
    serviceAccount: sa-arc-controller
  docker:
    imagePullPolicy: Always
    imageTag: v1.2.0_2021-11-02
    registry: mcr.microsoft.com
    repository: arcdata
  infrastructure: kubernetes
  security:
    allowDumps: true
    allowNodeMetricsCollection: true
    allowPodMetricsCollection: true
  services:
    - name: controller
      port: 30080
      serviceType: LoadBalancer
  settings:
    ElasticSearch:
      vm.max_map_count: "-1"
    azure:
      connectionMode: direct
      location: eastus
      resourceGroup: rg-arc-data
      subscription: your-subscription-id
  storage:
    data:
      accessMode: ReadWriteOnce
      className: managed-premium
      size: 15Gi
    logs:
      accessMode: ReadWriteOnce
      className: managed-premium
      size: 10Gi
```

## Deploying SQL Managed Instance

### Create SQL MI

```bash
# Create SQL Managed Instance
az sql mi-arc create \
    --name sql-mi-prod \
    --resource-group rg-arc-data \
    --location eastus \
    --k8s-namespace arc-data \
    --use-k8s \
    --cores-limit 4 \
    --cores-request 2 \
    --memory-limit 8Gi \
    --memory-request 4Gi \
    --storage-class-data managed-premium \
    --storage-class-logs managed-premium \
    --volume-size-data 100Gi \
    --volume-size-logs 20Gi \
    --tier GeneralPurpose \
    --license-type BasePrice
```

Using YAML:

```yaml
# sql-mi.yaml
apiVersion: sql.arcdata.microsoft.com/v1
kind: SqlManagedInstance
metadata:
  name: sql-mi-prod
  namespace: arc-data
spec:
  dev: false
  licenseType: BasePrice
  tier: GeneralPurpose
  scheduling:
    default:
      resources:
        limits:
          cpu: "4"
          memory: 8Gi
        requests:
          cpu: "2"
          memory: 4Gi
  security:
    adminLoginSecret: sql-login-secret
  services:
    primary:
      type: LoadBalancer
      port: 1433
  storage:
    data:
      volumes:
        - className: managed-premium
          size: 100Gi
    logs:
      volumes:
        - className: managed-premium
          size: 20Gi
    backups:
      volumes:
        - className: azurefile
          size: 50Gi
```

### Connect and Use SQL MI

```bash
# Get connection endpoint
az sql mi-arc show \
    --name sql-mi-prod \
    --resource-group rg-arc-data \
    --query "properties.primaryEndpoint"

# Connect using sqlcmd
sqlcmd -S 10.0.0.100,1433 -U sa -P 'YourPassword' -Q "SELECT @@VERSION"
```

Application connection string:

```csharp
using Microsoft.Data.SqlClient;

var connectionString = "Server=10.0.0.100,1433;Database=MyDatabase;User Id=sa;Password=YourPassword;Encrypt=True;TrustServerCertificate=True";

using var connection = new SqlConnection(connectionString);
await connection.OpenAsync();

using var command = new SqlCommand("SELECT TOP 10 * FROM Customers", connection);
using var reader = await command.ExecuteReaderAsync();

while (await reader.ReadAsync())
{
    Console.WriteLine($"{reader["Id"]}: {reader["Name"]}");
}
```

## High Availability Configuration

### Business Critical Tier with Availability Groups

```yaml
apiVersion: sql.arcdata.microsoft.com/v1
kind: SqlManagedInstance
metadata:
  name: sql-mi-ha
  namespace: arc-data
spec:
  tier: BusinessCritical
  replicas: 3
  scheduling:
    default:
      resources:
        limits:
          cpu: "8"
          memory: 32Gi
        requests:
          cpu: "4"
          memory: 16Gi
  services:
    primary:
      type: LoadBalancer
    readableSecondaries:
      type: LoadBalancer
  storage:
    data:
      volumes:
        - className: managed-premium
          size: 500Gi
```

Query read replicas:

```sql
-- Connect to readable secondary
-- Connection string: Server=10.0.0.101,1433;ApplicationIntent=ReadOnly

-- Check replica role
SELECT
    replica_server_name,
    role_desc,
    synchronization_health_desc
FROM sys.dm_hadr_availability_replica_states;
```

## PostgreSQL Hyperscale

### Deploy PostgreSQL

```bash
# Create PostgreSQL Hyperscale server group
az postgres arc-server create \
    --name pg-hyperscale \
    --resource-group rg-arc-data \
    --k8s-namespace arc-data \
    --use-k8s \
    --cores-limit 4 \
    --cores-request 2 \
    --memory-limit 8Gi \
    --memory-request 4Gi \
    --workers 2 \
    --storage-class-data managed-premium \
    --volume-size-data 100Gi
```

### Scale Out with Workers

```bash
# Add worker nodes
az postgres arc-server edit \
    --name pg-hyperscale \
    --resource-group rg-arc-data \
    --workers 4 \
    --cores-limit 8 \
    --use-k8s
```

### Distributed Tables with Citus

```sql
-- Connect to coordinator
psql -h 10.0.0.200 -p 5432 -U postgres -d citus

-- Create distributed table
CREATE TABLE events (
    event_id bigserial,
    tenant_id int NOT NULL,
    event_type text,
    event_data jsonb,
    created_at timestamptz DEFAULT now()
);

-- Distribute by tenant_id
SELECT create_distributed_table('events', 'tenant_id');

-- Create reference table (replicated to all nodes)
CREATE TABLE event_types (
    type_id serial PRIMARY KEY,
    type_name text,
    description text
);

SELECT create_reference_table('event_types');

-- Query runs in parallel across workers
SELECT
    tenant_id,
    event_type,
    COUNT(*) as event_count
FROM events
WHERE created_at > now() - interval '1 day'
GROUP BY tenant_id, event_type
ORDER BY event_count DESC
LIMIT 100;
```

## Monitoring and Logs

### View Metrics in Azure Portal

```bash
# Export metrics (indirect mode)
az arcdata dc export \
    --type metrics \
    --path metrics.json \
    --k8s-namespace arc-data \
    --use-k8s

az arcdata dc upload \
    --path metrics.json
```

### Grafana Dashboards

```bash
# Get Grafana endpoint
kubectl get svc -n arc-data | grep grafana

# Port forward for local access
kubectl port-forward svc/metricsui-external-svc -n arc-data 3000:3000
```

### Log Analytics Integration

```bash
# Configure Log Analytics workspace
az arcdata dc update \
    --name arc-dc \
    --resource-group rg-arc-data \
    --auto-upload-logs true \
    --auto-upload-metrics true
```

KQL queries:

```kql
// SQL MI performance
SqlManagedInstance_sqlmi_logs_CL
| where TimeGenerated > ago(1h)
| where instance_name_s == "sql-mi-prod"
| project TimeGenerated, cpu_percent_d, memory_percent_d, io_percent_d

// PostgreSQL queries
PostgreSQL_pg_stat_statements_CL
| where TimeGenerated > ago(24h)
| summarize
    TotalCalls = sum(calls_d),
    AvgTime = avg(mean_time_d)
    by query_s
| order by TotalCalls desc
| take 20
```

## Backup and Restore

### Point-in-Time Restore

```bash
# List available restore points
az sql mi-arc list-restore-points \
    --name sql-mi-prod \
    --k8s-namespace arc-data \
    --use-k8s

# Restore to point in time
az sql mi-arc restore \
    --source-database AdventureWorks \
    --dest-name sql-mi-restore \
    --time "2021-11-18T10:30:00Z" \
    --k8s-namespace arc-data \
    --use-k8s
```

### Automated Backups

```yaml
# Backup configuration
apiVersion: sql.arcdata.microsoft.com/v1
kind: SqlManagedInstance
metadata:
  name: sql-mi-prod
spec:
  backup:
    retentionPeriodInDays: 14
    fullBackupDays: 7
    differentialBackupHours: 12
    transactionLogBackupMinutes: 5
  storage:
    backups:
      volumes:
        - className: azurefile
          size: 100Gi
```

Arc-enabled data services bring cloud-native database capabilities to any environment. Whether you need SQL Server or PostgreSQL, you can run managed database services on your own infrastructure while maintaining Azure integration.

## Resources

- [Arc-Enabled Data Services Documentation](https://docs.microsoft.com/en-us/azure/azure-arc/data/overview)
- [SQL Managed Instance](https://docs.microsoft.com/en-us/azure/azure-arc/data/managed-instance-overview)
- [PostgreSQL Hyperscale](https://docs.microsoft.com/en-us/azure/azure-arc/data/what-is-azure-arc-enabled-postgres-hyperscale)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
