---
title: "Mastering Azure SQL Elastic Pools for Cost-Effective Multi-Tenant Solutions"
description: "The key benefit of elastic pools is resource sharing. If you have 100 databases that each spike at different times, you don't need to provision for 100…"
author: "Michael John Peña"
draft: false
date: 2021-08-02
tags: ["Azure", "SQL", "Elastic Pools", "Multi-Tenant", "Database"]
---

## Understanding Elastic Pool Economics

The key benefit of elastic pools is resource sharing. If you have 100 databases that each spike at different times, you don't need to provision for 100 simultaneous peaks.

### Creating an Elastic Pool

```bash
# Create an elastic pool using Azure CLI
az sql elastic-pool create \
    --resource-group myResourceGroup \
    --server myserver \
    --name myElasticPool \
    --edition GeneralPurpose \
    --family Gen5 \
    --capacity 4 \
    --db-max-capacity 2 \
    --db-min-capacity 0.25 \
    --max-size 256GB
```

Using PowerShell:

```powershell
# Create elastic pool with PowerShell
New-AzSqlElasticPool `
    -ResourceGroupName "myResourceGroup" `
    -ServerName "myserver" `
    -ElasticPoolName "myElasticPool" `
    -Edition "GeneralPurpose" `
    -ComputeGeneration "Gen5" `
    -vCore 4 `
    -DatabaseVCoreMin 0.25 `
    -DatabaseVCoreMax 2 `
    -StorageMB 262144
```

## Adding Databases to the Pool

```sql
-- Move existing database to elastic pool
ALTER DATABASE MyDatabase
MODIFY (SERVICE_OBJECTIVE = ELASTIC_POOL(name = myElasticPool));
```

```bash
# Create a new database directly in the pool
az sql db create \
    --resource-group myResourceGroup \
    --server myserver \
    --name NewTenantDB \
    --elastic-pool myElasticPool
```

## Monitoring Pool Performance

```sql
-- Monitor elastic pool resource utilization
SELECT
    elastic_pool_name,
    start_time,
    end_time,
    avg_cpu_percent,
    avg_data_io_percent,
    avg_log_write_percent,
    avg_storage_percent
FROM sys.elastic_pool_resource_stats
WHERE elastic_pool_name = 'myElasticPool'
ORDER BY end_time DESC;

-- Check individual database resource consumption
SELECT
    database_name,
    AVG(avg_cpu_percent) AS avg_cpu,
    MAX(avg_cpu_percent) AS max_cpu,
    AVG(avg_data_io_percent) AS avg_io,
    MAX(avg_data_io_percent) AS max_io
FROM sys.dm_db_resource_stats
GROUP BY database_name;
```

## Implementing Multi-Tenant Architecture

```csharp
// C# multi-tenant connection resolver
public class TenantConnectionResolver
{
    private readonly string _serverName;
    private readonly string _poolName;

    public TenantConnectionResolver(string serverName, string poolName)
    {
        _serverName = serverName;
        _poolName = poolName;
    }

    public string GetConnectionString(string tenantId)
    {
        var databaseName = $"tenant_{tenantId}";

        return new SqlConnectionStringBuilder
        {
            DataSource = $"{_serverName}.database.windows.net",
            InitialCatalog = databaseName,
            Authentication = SqlAuthenticationMethod.ActiveDirectoryManagedIdentity,
            ConnectTimeout = 30,
            Encrypt = true
        }.ConnectionString;
    }

    public async Task<bool> ProvisionTenantAsync(string tenantId)
    {
        var masterConnection = GetMasterConnectionString();

        using var connection = new SqlConnection(masterConnection);
        await connection.OpenAsync();

        var command = connection.CreateCommand();
        command.CommandText = $@"
            CREATE DATABASE [tenant_{tenantId}]
            (SERVICE_OBJECTIVE = ELASTIC_POOL(name = {_poolName}))";

        await command.ExecuteNonQueryAsync();
        return true;
    }
}
```

## Auto-Scaling Elastic Pools

```python
# Python script for elastic pool auto-scaling
from azure.identity import DefaultAzureCredential
from azure.mgmt.sql import SqlManagementClient
import statistics

def auto_scale_pool(subscription_id, resource_group, server, pool_name):
    credential = DefaultAzureCredential()
    client = SqlManagementClient(credential, subscription_id)

    # Get current metrics
    metrics = client.elastic_pool_activities.list_by_elastic_pool(
        resource_group, server, pool_name
    )

    cpu_values = [m.avg_cpu_percent for m in metrics]
    avg_cpu = statistics.mean(cpu_values) if cpu_values else 0

    # Get current pool configuration
    pool = client.elastic_pools.get(resource_group, server, pool_name)
    current_vcores = pool.sku.capacity

    # Scale decision logic
    if avg_cpu > 80 and current_vcores < 16:
        new_vcores = min(current_vcores * 2, 16)
        scale_pool(client, resource_group, server, pool_name, new_vcores)
    elif avg_cpu < 20 and current_vcores > 2:
        new_vcores = max(current_vcores // 2, 2)
        scale_pool(client, resource_group, server, pool_name, new_vcores)

def scale_pool(client, resource_group, server, pool_name, vcores):
    pool_params = {
        'sku': {'name': 'GP_Gen5', 'capacity': vcores}
    }
    client.elastic_pools.begin_create_or_update(
        resource_group, server, pool_name, pool_params
    )
```

## Cost Optimization Tips

1. **Right-size per-database limits**: Set realistic min/max vCores
2. **Monitor utilization trends**: Look for consistent patterns
3. **Consider zone redundancy**: Only for production workloads
4. **Use reserved capacity**: Save up to 33% with 1-year commitment

Elastic pools remain one of the most effective ways to optimize costs in multi-tenant SaaS applications while maintaining performance isolation between tenants.
