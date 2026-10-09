---
title: "Azure SQL Managed Instance Updates - September 2022"
description: "Instance pools allow you to host multiple Managed Instances with shared resources, optimizing costs for smaller workloads."
author: "Michael John Peña"
draft: false
date: 2022-09-17
tags: ["Azure", "SQL Managed Instance", "Database", "Migration"]
---

## New Features and Improvements

### Instance Pools

Instance pools allow you to host multiple Managed Instances with shared resources, optimizing costs for smaller workloads.

```bash
# Create an instance pool using Azure CLI
az sql instance-pool create \
    --resource-group myResourceGroup \
    --name myInstancePool \
    --location eastus \
    --subnet /subscriptions/{subscription-id}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/{vnet}/subnets/{subnet} \
    --edition GeneralPurpose \
    --family Gen5 \
    --capacity 8 \
    --license-type BasePrice

# Create a managed instance in the pool
az sql mi create \
    --resource-group myResourceGroup \
    --name myManagedInstance \
    --instance-pool myInstancePool \
    --admin-user sqladmin \
    --admin-password "ComplexP@ssw0rd!" \
    --storage 32GB \
    --vcore 2
```

### Cross-Database Queries

```sql
-- Managed Instance supports cross-database queries
USE Database1;

SELECT
    o.OrderID,
    o.OrderDate,
    c.CustomerName
FROM dbo.Orders o
JOIN Database2.dbo.Customers c ON o.CustomerID = c.CustomerID
WHERE o.OrderDate > '2022-01-01';

-- Cross-database transactions
BEGIN TRANSACTION;

UPDATE Database1.dbo.Inventory
SET Quantity = Quantity - 10
WHERE ProductID = 100;

INSERT INTO Database2.dbo.Orders (ProductID, Quantity, OrderDate)
VALUES (100, 10, GETDATE());

COMMIT TRANSACTION;
```

### SQL Server Agent Jobs

```sql
-- Create a SQL Agent job
EXEC msdb.dbo.sp_add_job
    @job_name = N'DailyDataCleanup',
    @enabled = 1,
    @description = N'Removes old audit records daily';

-- Add job step
EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'DailyDataCleanup',
    @step_name = N'Delete old records',
    @subsystem = N'TSQL',
    @command = N'
        DELETE FROM dbo.AuditLog
        WHERE EventDate < DATEADD(day, -90, GETDATE());

        DELETE FROM dbo.TempData
        WHERE CreatedDate < DATEADD(day, -7, GETDATE());
    ',
    @retry_attempts = 3,
    @retry_interval = 5;

-- Create schedule
EXEC msdb.dbo.sp_add_schedule
    @schedule_name = N'DailyAt2AM',
    @freq_type = 4,  -- Daily
    @freq_interval = 1,
    @active_start_time = 020000;  -- 2:00 AM

-- Attach schedule to job
EXEC msdb.dbo.sp_attach_schedule
    @job_name = N'DailyDataCleanup',
    @schedule_name = N'DailyAt2AM';

-- Enable the job
EXEC msdb.dbo.sp_update_job
    @job_name = N'DailyDataCleanup',
    @enabled = 1;
```

### Database Mail

```sql
-- Configure Database Mail
EXEC msdb.dbo.sysmail_add_account_sp
    @account_name = 'AlertNotifications',
    @email_address = 'alerts@company.com',
    @display_name = 'SQL Managed Instance Alerts',
    @replyto_address = 'noreply@company.com',
    @mailserver_name = 'smtp.sendgrid.net',
    @mailserver_type = 'SMTP',
    @port = 587,
    @enable_ssl = 1,
    @username = 'apikey',
    @password = 'your-sendgrid-api-key';

-- Create mail profile
EXEC msdb.dbo.sysmail_add_profile_sp
    @profile_name = 'AlertProfile';

-- Add account to profile
EXEC msdb.dbo.sysmail_add_profileaccount_sp
    @profile_name = 'AlertProfile',
    @account_name = 'AlertNotifications',
    @sequence_number = 1;

-- Send test email
EXEC msdb.dbo.sp_send_dbmail
    @profile_name = 'AlertProfile',
    @recipients = 'admin@company.com',
    @subject = 'Test Email from Managed Instance',
    @body = 'This is a test email from Azure SQL Managed Instance.';
```

## C# Management Operations

```csharp
using Azure;
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.Sql;

public class ManagedInstanceManager
{
    private readonly ArmClient _armClient;
    private readonly string _subscriptionId;
    private readonly string _resourceGroup;

    public ManagedInstanceManager(string subscriptionId, string resourceGroup)
    {
        _subscriptionId = subscriptionId;
        _resourceGroup = resourceGroup;
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task<ManagedInstanceResource> GetInstanceAsync(string instanceName)
    {
        var subscription = await _armClient.GetDefaultSubscriptionAsync();
        var resourceGroup = await subscription.GetResourceGroupAsync(_resourceGroup);

        var managedInstance = await resourceGroup.Value
            .GetManagedInstanceAsync(instanceName);

        return managedInstance.Value;
    }

    public async Task<IEnumerable<ManagedDatabaseResource>> GetDatabasesAsync(string instanceName)
    {
        var instance = await GetInstanceAsync(instanceName);
        var databases = instance.GetManagedDatabases();

        var result = new List<ManagedDatabaseResource>();
        await foreach (var db in databases.GetAllAsync())
        {
            result.Add(db);
        }

        return result;
    }

    public async Task CreateDatabaseAsync(string instanceName, string databaseName)
    {
        var instance = await GetInstanceAsync(instanceName);
        var databases = instance.GetManagedDatabases();

        var data = new ManagedDatabaseData(instance.Data.Location);

        await databases.CreateOrUpdateAsync(
            WaitUntil.Completed,
            databaseName,
            data);
    }

    public async Task RestoreDatabaseAsync(
        string instanceName,
        string targetDatabaseName,
        string sourceDatabaseId,
        DateTime restorePointInTime)
    {
        var instance = await GetInstanceAsync(instanceName);
        var databases = instance.GetManagedDatabases();

        var data = new ManagedDatabaseData(instance.Data.Location)
        {
            CreateMode = ManagedDatabaseCreateMode.PointInTimeRestore,
            SourceDatabaseId = new ResourceIdentifier(sourceDatabaseId),
            RestorePointInTime = restorePointInTime
        };

        await databases.CreateOrUpdateAsync(
            WaitUntil.Completed,
            targetDatabaseName,
            data);
    }
}
```

### Monitoring and Diagnostics

```sql
-- Check instance resource utilization
SELECT
    end_time,
    avg_cpu_percent,
    avg_data_io_percent,
    avg_log_write_percent,
    avg_memory_usage_percent,
    avg_instance_cpu_percent,
    avg_instance_memory_percent
FROM sys.server_resource_stats
ORDER BY end_time DESC;

-- Active queries
SELECT
    r.session_id,
    r.status,
    r.command,
    r.wait_type,
    r.cpu_time,
    r.total_elapsed_time,
    DB_NAME(r.database_id) AS database_name,
    t.text AS query_text
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id > 50
ORDER BY r.total_elapsed_time DESC;

-- Tempdb usage
SELECT
    SUM(user_object_reserved_page_count) * 8 / 1024 AS user_objects_mb,
    SUM(internal_object_reserved_page_count) * 8 / 1024 AS internal_objects_mb,
    SUM(version_store_reserved_page_count) * 8 / 1024 AS version_store_mb
FROM tempdb.sys.dm_db_file_space_usage;

-- Long-running transactions
SELECT
    t.session_id,
    t.transaction_begin_time,
    DATEDIFF(minute, t.transaction_begin_time, GETDATE()) AS duration_minutes,
    t.transaction_type,
    t.transaction_state,
    s.login_name,
    s.host_name
FROM sys.dm_tran_active_transactions t
JOIN sys.dm_exec_sessions s ON t.transaction_id = s.transaction_id
WHERE DATEDIFF(minute, t.transaction_begin_time, GETDATE()) > 5
ORDER BY t.transaction_begin_time;
```

### Failover Groups

```csharp
public class FailoverGroupManager
{
    private readonly string _connectionString;

    public async Task<FailoverGroupInfo> GetFailoverGroupInfoAsync()
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var query = @"
            SELECT
                ag.name AS failover_group_name,
                ar.replica_server_name,
                ar.endpoint_url,
                ars.role_desc,
                ars.synchronization_health_desc,
                ars.connected_state_desc
            FROM sys.dm_hadr_availability_replica_states ars
            JOIN sys.availability_replicas ar ON ars.replica_id = ar.replica_id
            JOIN sys.availability_groups ag ON ar.group_id = ag.group_id";

        using var command = new SqlCommand(query, connection);
        using var reader = await command.ExecuteReaderAsync();

        var info = new FailoverGroupInfo();
        while (await reader.ReadAsync())
        {
            info.GroupName = reader.GetString(0);
            info.Replicas.Add(new ReplicaInfo
            {
                ServerName = reader.GetString(1),
                EndpointUrl = reader.GetString(2),
                Role = reader.GetString(3),
                SyncHealth = reader.GetString(4),
                ConnectionState = reader.GetString(5)
            });
        }

        return info;
    }
}

public class FailoverGroupInfo
{
    public string GroupName { get; set; }
    public List<ReplicaInfo> Replicas { get; set; } = new();
}

public class ReplicaInfo
{
    public string ServerName { get; set; }
    public string EndpointUrl { get; set; }
    public string Role { get; set; }
    public string SyncHealth { get; set; }
    public string ConnectionState { get; set; }
}
```

## Migration Considerations

1. **Network requirements** - Requires VNet integration
2. **Instance size** - Plan for vCores and storage
3. **Feature compatibility** - Most SQL Server features supported
4. **Maintenance windows** - Configure preferred maintenance times
5. **Backup retention** - Configure PITR retention (1-35 days)

Azure SQL Managed Instance bridges the gap between on-premises SQL Server and fully managed cloud databases.
