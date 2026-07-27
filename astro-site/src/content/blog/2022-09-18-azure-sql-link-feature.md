---
title: "Azure SQL Managed Instance Link Feature"
author: "Michael John Peña"
draft: false
date: 2022-09-18
tags: ["Azure", "SQL Managed Instance", "Hybrid", "Replication"]

---

I wrote "Azure SQL Managed Instance Link Feature" to share practical, production-minded guidance on this topic.

## Understanding the Link Feature

The Link creates a near real-time data replication from SQL Server (2016 or later) to Azure SQL Managed Instance using distributed availability groups technology.

### Prerequisites

```sql
-- On SQL Server, verify version and edition
SELECT
    SERVERPROPERTY('ProductVersion') AS Version,
    SERVERPROPERTY('ProductLevel') AS Level,
    SERVERPROPERTY('Edition') AS Edition;

-- Enable required features
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;

EXEC sp_configure 'Database Mail XPs', 1;
RECONFIGURE;

-- Create a database master key if not exists
USE master;
IF NOT EXISTS (SELECT * FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
BEGIN
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'StrongP@ssw0rd!';
END

-- Verify availability groups feature
SELECT SERVERPROPERTY('IsHadrEnabled') AS HADREnabled;

-- Enable if needed (requires restart)
-- ALTER SERVER CONFIGURATION SET HADR CLUSTER CONTEXT = WINDOWS;
```

### Setting Up the Link

```powershell
# PowerShell script to create the link
# Install the Az module if needed
# Install-Module -Name Az -AllowClobber -Scope CurrentUser

Connect-AzAccount

# Parameters
$resourceGroup = "myResourceGroup"
$miName = "myManagedInstance"
$linkName = "myLink"
$sqlServerName = "MySQLServer"
$databaseName = "MyDatabase"

# Get managed instance
$managedInstance = Get-AzSqlInstance -ResourceGroupName $resourceGroup -Name $miName

# Create the link
$linkParams = @{
    ResourceGroupName = $resourceGroup
    InstanceName = $miName
    Name = $linkName
    PrimaryServer = $sqlServerName
    Databases = @($databaseName)
}

New-AzSqlInstanceLink @linkParams
```

### SQL Server Configuration

```sql
-- Create certificate for endpoint authentication
USE master;

CREATE CERTIFICATE LinkCertificate
WITH SUBJECT = 'Certificate for MI Link';

BACKUP CERTIFICATE LinkCertificate
TO FILE = 'C:\Certs\LinkCertificate.cer';

-- Create database mirroring endpoint
CREATE ENDPOINT Hadr_endpoint
    STATE = STARTED
    AS TCP (
        LISTENER_PORT = 5022,
        LISTENER_IP = ALL
    )
    FOR DATA_MIRRORING (
        ROLE = ALL,
        AUTHENTICATION = CERTIFICATE LinkCertificate,
        ENCRYPTION = REQUIRED ALGORITHM AES
    );

-- Verify endpoint
SELECT
    name,
    type_desc,
    port,
    state_desc
FROM sys.tcp_endpoints
WHERE type = 4;

-- Create availability group
CREATE AVAILABILITY GROUP [AG-Link]
WITH (
    CLUSTER_TYPE = NONE,
    DB_FAILOVER = ON
)
FOR REPLICA ON
    N'MySQLServer' WITH (
        ENDPOINT_URL = N'TCP://MySQLServer.domain.com:5022',
        FAILOVER_MODE = MANUAL,
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        SEEDING_MODE = AUTOMATIC
    );

-- Add database to availability group
ALTER AVAILABILITY GROUP [AG-Link]
ADD DATABASE MyDatabase;
```

### Monitoring the Link

```csharp
using Microsoft.Data.SqlClient;

public class LinkMonitoringService
{
    private readonly string _sqlServerConnection;
    private readonly string _miConnection;

    public LinkMonitoringService(string sqlServerConn, string miConn)
    {
        _sqlServerConnection = sqlServerConn;
        _miConnection = miConn;
    }

    public async Task<LinkStatus> GetLinkStatusAsync()
    {
        var status = new LinkStatus();

        // Check SQL Server side
        using (var connection = new SqlConnection(_sqlServerConnection))
        {
            await connection.OpenAsync();

            var query = @"
                SELECT
                    ag.name AS ag_name,
                    ar.replica_server_name,
                    ars.role_desc,
                    ars.synchronization_health_desc,
                    drs.synchronization_state_desc,
                    drs.log_send_queue_size,
                    drs.log_send_rate,
                    drs.redo_queue_size,
                    drs.redo_rate
                FROM sys.dm_hadr_database_replica_states drs
                JOIN sys.availability_groups ag ON drs.group_id = ag.group_id
                JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id
                JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id = ars.replica_id";

            using var command = new SqlCommand(query, connection);
            using var reader = await command.ExecuteReaderAsync();

            while (await reader.ReadAsync())
            {
                status.Replicas.Add(new ReplicaStatus
                {
                    AvailabilityGroup = reader.GetString(0),
                    ReplicaServer = reader.GetString(1),
                    Role = reader.GetString(2),
                    SyncHealth = reader.GetString(3),
                    SyncState = reader.GetString(4),
                    LogSendQueueSize = reader.IsDBNull(5) ? 0 : reader.GetInt64(5),
                    LogSendRate = reader.IsDBNull(6) ? 0 : reader.GetInt64(6),
                    RedoQueueSize = reader.IsDBNull(7) ? 0 : reader.GetInt64(7),
                    RedoRate = reader.IsDBNull(8) ? 0 : reader.GetInt64(8)
                });
            }
        }

        return status;
    }

    public async Task<long> GetReplicationLagAsync()
    {
        using var connection = new SqlConnection(_sqlServerConnection);
        await connection.OpenAsync();

        var query = @"
            SELECT
                DATEDIFF(second, last_commit_time, GETUTCDATE()) AS lag_seconds
            FROM sys.dm_hadr_database_replica_states
            WHERE is_local = 0";

        using var command = new SqlCommand(query, connection);
        var result = await command.ExecuteScalarAsync();

        return result == DBNull.Value ? -1 : Convert.ToInt64(result);
    }
}

public class LinkStatus
{
    public List<ReplicaStatus> Replicas { get; set; } = new();
    public bool IsHealthy => Replicas.All(r => r.SyncHealth == "HEALTHY");
}

public class ReplicaStatus
{
    public string AvailabilityGroup { get; set; }
    public string ReplicaServer { get; set; }
    public string Role { get; set; }
    public string SyncHealth { get; set; }
    public string SyncState { get; set; }
    public long LogSendQueueSize { get; set; }
    public long LogSendRate { get; set; }
    public long RedoQueueSize { get; set; }
    public long RedoRate { get; set; }
}
```

### Failover Operations

```sql
-- Planned failover to Managed Instance (from SQL Server)
-- Step 1: Ensure synchronization is complete
SELECT
    database_id,
    synchronization_state_desc,
    synchronization_health_desc
FROM sys.dm_hadr_database_replica_states
WHERE is_local = 1;

-- Step 2: Initiate failover
-- This converts MI replica to primary
ALTER AVAILABILITY GROUP [AG-Link] FAILOVER;

-- After failover, link is broken and MI becomes standalone
-- The SQL Server database is no longer part of AG
```

### Use Cases

```csharp
public class LinkUseCases
{
    // Use Case 1: Reporting offload
    public async Task<ReportData> GetReportDataFromMIAsync(SqlConnection miConnection)
    {
        // Run expensive reports against MI replica
        // without impacting production SQL Server
        var query = @"
            SELECT
                YEAR(OrderDate) AS Year,
                MONTH(OrderDate) AS Month,
                COUNT(*) AS OrderCount,
                SUM(TotalAmount) AS Revenue
            FROM dbo.Orders
            GROUP BY YEAR(OrderDate), MONTH(OrderDate)
            ORDER BY Year, Month";

        using var command = new SqlCommand(query, miConnection);
        // Execute report query
        return new ReportData();
    }

    // Use Case 2: Cloud migration testing
    public async Task ValidateMigrationAsync(
        SqlConnection sqlServer,
        SqlConnection managedInstance)
    {
        // Compare data between sources
        var countQuery = "SELECT COUNT(*) FROM dbo.Orders";

        int sqlServerCount, miCount;

        using (var cmd = new SqlCommand(countQuery, sqlServer))
            sqlServerCount = (int)await cmd.ExecuteScalarAsync();

        using (var cmd = new SqlCommand(countQuery, managedInstance))
            miCount = (int)await cmd.ExecuteScalarAsync();

        if (sqlServerCount != miCount)
        {
            throw new Exception($"Count mismatch: SQL Server={sqlServerCount}, MI={miCount}");
        }
    }

    // Use Case 3: DR testing
    public async Task TestFailoverReadinessAsync(string connectionString)
    {
        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        // Check replication lag
        var query = @"
            SELECT MAX(DATEDIFF(second, last_commit_time, GETUTCDATE()))
            FROM sys.dm_hadr_database_replica_states
            WHERE is_local = 0";

        using var command = new SqlCommand(query, connection);
        var lag = (int)await command.ExecuteScalarAsync();

        if (lag > 60)
        {
            throw new Exception($"Replication lag too high: {lag} seconds");
        }
    }
}

public class ReportData { }
```

## Benefits

1. **Zero downtime migration** - Migrate to cloud with minimal cutover
2. **Disaster recovery** - Cloud-based DR without Always On
3. **Reporting offload** - Run analytics in the cloud
4. **Hybrid flexibility** - Keep primary on-premises, replica in Azure
5. **Testing environment** - Test applications against cloud copy

The Link feature bridges on-premises SQL Server with Azure SQL Managed Instance for flexible hybrid architectures.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
