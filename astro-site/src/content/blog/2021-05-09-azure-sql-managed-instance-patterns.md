---
title: "Azure SQL Managed Instance: Migration Patterns and Best Practices"
author: Michael John Peña
draft: false
date: 2021-05-09
tags:
  - Azure
  - SQL
  - Database
  - Migration
  - Cloud
---

Azure SQL Managed Instance is the SQL Server target I recommend most for lift-and-shift migrations from on-premises SQL Server. It's PaaS—no OS to patch, automatic backups, built-in HA—but it's near-100% compatible with SQL Server features that Azure SQL Database doesn't support: SQL Agent, Service Broker, cross-database queries, linked servers, SSAS integration, and CLR assemblies. The deployment model (into a VNet subnet, not accessible from the public internet) means the networking setup is more involved than Azure SQL Database, but for applications that rely on those SQL Server-specific features, Managed Instance is often the difference between a three-month migration and a twelve-month re-architecture.

## Why Managed Instance?

SQL Database is great for new cloud-native applications, but existing applications often use SQL Server features that aren't supported:
- Cross-database queries
- SQL Agent jobs
- CLR integration
- Service Broker
- Linked servers

Managed Instance supports all of these while being fully managed.

## Migration Assessment

Start with the Data Migration Assistant to assess compatibility:

```powershell
# Install DMA
# Download from: https://www.microsoft.com/en-us/download/details.aspx?id=53595

# Run assessment via command line
DmaCmd.exe /AssessmentName="SQL MI Assessment" `
    /AssessmentDatabases="Server=localhost;Initial Catalog=MyDatabase;Integrated Security=true" `
    /AssessmentTargetPlatform=ManagedSqlServer `
    /AssessmentResultJson="assessment-result.json"
```

Review the output for:
- Breaking changes that prevent migration
- Behavior changes to be aware of
- Feature parity issues

## Online Migration with DMS

Azure Database Migration Service enables online migrations with minimal downtime:

```python
from azure.mgmt.datamigration import DataMigrationServiceClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
dms_client = DataMigrationServiceClient(credential, subscription_id)

# Create migration project
project = dms_client.projects.create_or_update(
    group_name="my-rg",
    service_name="my-dms-service",
    project_name="sql-to-mi-migration",
    parameters={
        "location": "eastus",
        "sourcePlatform": "SQL",
        "targetPlatform": "SQLMI",
        "sourceConnectionInfo": {
            "type": "SqlConnectionInfo",
            "dataSource": "source-server.database.windows.net",
            "authentication": "SqlAuthentication",
            "userName": "admin",
            "password": "***"
        },
        "targetConnectionInfo": {
            "type": "MiSqlConnectionInfo",
            "managedInstanceResourceId": "/subscriptions/.../managedInstances/my-mi"
        }
    }
)
```

## Backup and Restore Migration

For simpler scenarios, use native backup/restore:

```sql
-- On source: Create backup to Azure Blob Storage
BACKUP DATABASE [MyDatabase]
TO URL = 'https://mystorageaccount.blob.core.windows.net/backups/MyDatabase.bak'
WITH CREDENTIAL = 'AzureStorageCredential',
     COMPRESSION,
     STATS = 10;

-- On Managed Instance: Restore from Azure Blob Storage
RESTORE DATABASE [MyDatabase]
FROM URL = 'https://mystorageaccount.blob.core.windows.net/backups/MyDatabase.bak'
WITH CREDENTIAL = 'AzureStorageCredential',
     STATS = 10;
```

Set up the credential on Managed Instance:

```sql
CREATE CREDENTIAL [AzureStorageCredential]
WITH IDENTITY = 'SHARED ACCESS SIGNATURE',
SECRET = 'sv=2020-08-04&ss=b&srt=co&sp=rl...'; -- SAS token
```

## Instance Pools for Cost Optimization

For dev/test or multi-tenant scenarios, instance pools share resources:

```bash
# Create instance pool
az sql instance-pool create \
    --name my-instance-pool \
    --resource-group my-rg \
    --location eastus \
    --subnet /subscriptions/.../subnets/mi-subnet \
    --capacity 8 \
    --edition GeneralPurpose \
    --family Gen5 \
    --license-type BasePrice

# Create managed instance in pool
az sql mi create \
    --name mi-in-pool \
    --resource-group my-rg \
    --instance-pool-name my-instance-pool \
    --admin-user sqladmin \
    --admin-password <password> \
    --vcore 2
```

## Networking Configuration

Managed Instance requires a dedicated subnet with specific requirements:

```bash
# Create VNet and subnet for MI
az network vnet create \
    --name mi-vnet \
    --resource-group my-rg \
    --address-prefix 10.0.0.0/16

az network vnet subnet create \
    --name mi-subnet \
    --vnet-name mi-vnet \
    --resource-group my-rg \
    --address-prefix 10.0.0.0/24 \
    --delegations Microsoft.Sql/managedInstances

# Create route table
az network route-table create \
    --name mi-route-table \
    --resource-group my-rg

# Associate with subnet
az network vnet subnet update \
    --name mi-subnet \
    --vnet-name mi-vnet \
    --resource-group my-rg \
    --route-table mi-route-table
```

## Private Endpoint Access

Configure private endpoints for secure access:

```python
from azure.mgmt.network import NetworkManagementClient

# Create private endpoint
private_endpoint = network_client.private_endpoints.begin_create_or_update(
    resource_group_name="my-rg",
    private_endpoint_name="mi-private-endpoint",
    parameters={
        "location": "eastus",
        "subnet": {
            "id": "/subscriptions/.../subnets/endpoint-subnet"
        },
        "privateLinkServiceConnections": [{
            "name": "mi-connection",
            "privateLinkServiceId": "/subscriptions/.../managedInstances/my-mi",
            "groupIds": ["managedInstance"]
        }]
    }
).result()
```

## Query Performance Insights

Use Query Store for performance analysis:

```sql
-- Enable Query Store (enabled by default)
ALTER DATABASE [MyDatabase] SET QUERY_STORE = ON;

-- Find top resource-consuming queries
SELECT TOP 20
    q.query_id,
    qt.query_sql_text,
    SUM(rs.count_executions) AS total_executions,
    SUM(rs.avg_duration * rs.count_executions) / 1000000 AS total_duration_seconds,
    AVG(rs.avg_cpu_time) / 1000 AS avg_cpu_ms,
    AVG(rs.avg_logical_io_reads) AS avg_logical_reads
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
WHERE rs.last_execution_time > DATEADD(day, -7, GETUTCDATE())
GROUP BY q.query_id, qt.query_sql_text
ORDER BY total_duration_seconds DESC;
```

## Automated Backups and PITR

Managed Instance handles backups automatically:

```sql
-- Check backup history
SELECT
    database_name,
    backup_type,
    backup_start_date,
    backup_finish_date,
    backup_size / 1024 / 1024 AS backup_size_mb
FROM msdb.dbo.backupset
ORDER BY backup_start_date DESC;

-- Restore database to point in time (via Azure Portal/CLI)
-- az sql midb restore --dest-name MyDB-Restored \
--     --dest-mi my-mi \
--     --dest-resource-group my-rg \
--     --name MyDatabase \
--     --mi my-mi \
--     --resource-group my-rg \
--     --time "2021-05-09T12:00:00Z"
```

## SQL Agent Jobs Migration

Migrate SQL Agent jobs to Managed Instance:

```sql
-- Jobs work the same way
USE msdb;
GO

EXEC dbo.sp_add_job
    @job_name = N'Daily ETL Job',
    @enabled = 1,
    @description = N'Extract, transform, load daily data';

EXEC dbo.sp_add_jobstep
    @job_name = N'Daily ETL Job',
    @step_name = N'Execute ETL',
    @subsystem = N'TSQL',
    @command = N'EXEC dbo.usp_ExecuteDailyETL',
    @database_name = N'MyDatabase';

EXEC dbo.sp_add_schedule
    @schedule_name = N'Daily at 2 AM',
    @freq_type = 4, -- Daily
    @freq_interval = 1,
    @active_start_time = 020000;

EXEC dbo.sp_attach_schedule
    @job_name = N'Daily ETL Job',
    @schedule_name = N'Daily at 2 AM';

EXEC dbo.sp_add_jobserver
    @job_name = N'Daily ETL Job';
```

## Monitoring with Azure Monitor

Configure diagnostics for comprehensive monitoring:

```bash
# Enable diagnostics
az monitor diagnostic-settings create \
    --name mi-diagnostics \
    --resource /subscriptions/.../managedInstances/my-mi \
    --workspace /subscriptions/.../workspaces/my-workspace \
    --logs '[
        {"category": "SQLInsights", "enabled": true},
        {"category": "QueryStoreRuntimeStatistics", "enabled": true},
        {"category": "QueryStoreWaitStatistics", "enabled": true},
        {"category": "Errors", "enabled": true}
    ]' \
    --metrics '[{"category": "AllMetrics", "enabled": true}]'
```

Query logs in Log Analytics:

```kusto
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.SQL"
| where Category == "Errors"
| project TimeGenerated, Message, error_number_d, severity_d
| order by TimeGenerated desc
```

## Cost Optimization Tips

1. **Right-size your instance**: Use Azure Advisor recommendations
2. **Use Azure Hybrid Benefit**: Save up to 55% with existing licenses
3. **Reserved capacity**: 1-3 year commitments for predictable workloads
4. **Instance pools**: Share resources for dev/test environments

```bash
# Apply reserved capacity
az sql mi update \
    --name my-mi \
    --resource-group my-rg \
    --license-type BasePrice  # Use existing license
```

## Resources

- [SQL Managed Instance Documentation](https://docs.microsoft.com/en-us/azure/azure-sql/managed-instance/)
- [Migration Guide](https://docs.microsoft.com/en-us/azure/azure-sql/migration-guides/managed-instance/sql-server-to-managed-instance-guide)
- [Networking Requirements](https://docs.microsoft.com/en-us/azure/azure-sql/managed-instance/connectivity-architecture-overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
