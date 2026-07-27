---
title: "Cost Optimization with Azure SQL Elastic Pools"
author: Michael John Peña
draft: false
date: 2020-08-10
tags:
  - Azure
  - SQL
  - Database
  - Cost Optimization
---

SaaS clients with per-tenant database isolation hit the same wall once they cross about 20 customers: the bill for a hundred half-idle Standard tier databases is genuinely silly. Elastic pools are the right tool for that shape — pool the DTUs, let the noisy tenants borrow from the quiet ones. The maths usually works out, but only if you've actually measured your tenant load distribution first. A working setup, plus the back-of-envelope I do before recommending one.

## When to Use Elastic Pools

Elastic pools are ideal when:
- You have multiple databases with variable usage patterns
- Peak usage times differ across databases
- You want predictable costs for multiple databases
- Individual databases use less than 100 DTUs on average

## Creating an Elastic Pool

```bash
# Create a SQL server
az sql server create \
    --name sql-server-2020 \
    --resource-group rg-sql \
    --location australiaeast \
    --admin-user sqladmin \
    --admin-password 'YourSecurePassword123!'

# Create an elastic pool
az sql elastic-pool create \
    --resource-group rg-sql \
    --server sql-server-2020 \
    --name pool-standard \
    --edition Standard \
    --capacity 100 \
    --db-min-capacity 0 \
    --db-max-capacity 100

# Create databases in the pool
az sql db create \
    --resource-group rg-sql \
    --server sql-server-2020 \
    --name tenant-db-1 \
    --elastic-pool pool-standard

az sql db create \
    --resource-group rg-sql \
    --server sql-server-2020 \
    --name tenant-db-2 \
    --elastic-pool pool-standard
```

## Understanding eDTUs vs DTUs

- **DTU** - Database Transaction Units for single databases
- **eDTU** - elastic Database Transaction Units shared across pool
- Same performance characteristics, just shared

## Sizing Your Pool

```sql
-- Check historical resource usage for existing databases
SELECT
    database_name,
    AVG(avg_cpu_percent) as avg_cpu,
    MAX(avg_cpu_percent) as max_cpu,
    AVG(avg_data_io_percent) as avg_io,
    MAX(avg_data_io_percent) as max_io
FROM sys.resource_stats
WHERE start_time > DATEADD(day, -14, GETDATE())
GROUP BY database_name;
```

## .NET Connection Management

```csharp
public class TenantDatabaseService
{
    private readonly string _serverName;
    private readonly string _poolName;

    public string GetConnectionString(string tenantId)
    {
        var databaseName = $"tenant-{tenantId}";
        return $"Server=tcp:{_serverName}.database.windows.net,1433;" +
               $"Initial Catalog={databaseName};" +
               "Persist Security Info=False;" +
               "User ID=sqladmin;" +
               "Password=YourSecurePassword123!;" +
               "MultipleActiveResultSets=False;" +
               "Encrypt=True;" +
               "TrustServerCertificate=False;" +
               "Connection Timeout=30;";
    }

    public async Task<SqlConnection> GetConnectionAsync(string tenantId)
    {
        var connectionString = GetConnectionString(tenantId);
        var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        return connection;
    }
}
```

## Entity Framework Core with Elastic Pools

```csharp
public class TenantDbContext : DbContext
{
    private readonly string _connectionString;

    public TenantDbContext(string connectionString)
    {
        _connectionString = connectionString;
    }

    protected override void OnConfiguring(DbContextOptionsBuilder options)
    {
        options.UseSqlServer(_connectionString);
    }

    public DbSet<Customer> Customers { get; set; }
    public DbSet<Order> Orders { get; set; }
}

// In Startup.cs or DI configuration
public class TenantDbContextFactory
{
    private readonly TenantDatabaseService _databaseService;

    public TenantDbContext CreateContext(string tenantId)
    {
        var connectionString = _databaseService.GetConnectionString(tenantId);
        return new TenantDbContext(connectionString);
    }
}
```

## Monitoring Pool Performance

```sql
-- View current pool resource usage
SELECT
    elastic_pool_name,
    avg_cpu_percent,
    avg_data_io_percent,
    avg_log_write_percent,
    avg_storage_percent
FROM sys.elastic_pool_resource_stats
WHERE elastic_pool_name = 'pool-standard'
ORDER BY end_time DESC;

-- View individual database usage within pool
SELECT
    database_name,
    avg_cpu_percent,
    avg_data_io_percent,
    max_worker_percent
FROM sys.dm_db_resource_stats;
```

## Scaling the Pool

```bash
# Scale up the pool
az sql elastic-pool update \
    --resource-group rg-sql \
    --server sql-server-2020 \
    --name pool-standard \
    --capacity 200

# Move a database to a different pool
az sql db update \
    --resource-group rg-sql \
    --server sql-server-2020 \
    --name tenant-db-1 \
    --elastic-pool pool-premium
```

## Automation for Tenant Provisioning

```csharp
public class TenantProvisioningService
{
    private readonly string _resourceGroup;
    private readonly string _serverName;
    private readonly string _poolName;

    public async Task ProvisionTenantAsync(string tenantId)
    {
        var databaseName = $"tenant-{tenantId}";

        // Create database using Azure Management SDK
        var sqlClient = new SqlManagementClient(credential);

        var database = new Database
        {
            Location = "australiaeast",
            ElasticPoolId = $"/subscriptions/{subscriptionId}/resourceGroups/{_resourceGroup}/providers/Microsoft.Sql/servers/{_serverName}/elasticPools/{_poolName}"
        };

        await sqlClient.Databases.CreateOrUpdateAsync(
            _resourceGroup,
            _serverName,
            databaseName,
            database);

        // Run migrations
        using var context = new TenantDbContext(GetConnectionString(tenantId));
        await context.Database.MigrateAsync();
    }
}
```

## Cost Comparison Example

For 10 databases with varying loads:

| Approach | Monthly Cost (estimate) |
|----------|------------------------|
| 10 x S1 (20 DTU each) | ~$150 |
| 1 x 100 eDTU Pool | ~$112 |
| Savings | ~25% |

The thing nobody tells you: pools work brilliantly when tenants have *uncorrelated* peak times. They work badly when everyone hits 9am and again at 4pm. Before recommending a pool, I always check `sys.resource_stats` and look for whether peaks overlap. If the answer is "yes, everyone hits at once," a pool just makes you size for the simultaneous peak — at which point you might as well use individual databases on a smaller tier.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
