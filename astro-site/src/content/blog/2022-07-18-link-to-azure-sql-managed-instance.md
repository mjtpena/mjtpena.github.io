---
title: "Link Feature for Azure SQL Managed Instance"
description: "The Link feature for Azure SQL Managed Instance enables replicating databases from SQL Server 2019 and SQL Server 2022 to Azure SQL Managed Instance in…"
author: "Michael John Peña"
draft: false
date: 2022-07-18
tags: ["Azure", "SQL Server", "Azure SQL", "Managed Instance", "Hybrid"]
---

The Link feature for Azure SQL Managed Instance enables replicating databases from SQL Server 2019 and SQL Server 2022 to Azure SQL Managed Instance in near-real-time over an encrypted connection—without requiring ExpressRoute, VPN Gateway, or any on-premises firewall changes beyond allowing outbound HTTPS to Azure. The replication mechanism: Distributed Availability Groups technology adapted for a hybrid SQL Server to SQL MI scenario; transaction log records flow from the on-premises SQL Server primary to the Azure SQL MI secondary with typical latency in the sub-second to low-seconds range. The migration scenarios: lift-and-shift where on-premises SQL Server replicates to Azure SQL MI while the migration is tested and validated, then failover cuts production to Azure with minimal downtime; disaster recovery where Azure SQL MI is the cloud-based DR target for the on-premises primary; and read offload where the Azure SQL MI secondary serves read-only queries from cloud-based analytics workloads without impacting the on-premises primary. The network requirement that surprised people: the Distributed AG communication requires the SQL Server instance to be able to reach Azure SQL MI's endpoint—no inbound connections from Azure to on-premises are required, which simplified firewall approval for most organisations I worked with.

## Understanding the Link Feature

The Link creates a distributed availability group between your on-premises SQL Server and Azure SQL MI, enabling:

- Real-time data synchronization
- Read-scale workloads on Azure
- Disaster recovery to the cloud
- Staged migration approach

## Prerequisites

```sql
-- Check SQL Server version (2019 or later required)
SELECT @@VERSION;

-- Enable availability groups
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'hadr enabled', 1;
RECONFIGURE;

-- Verify certificate for endpoint authentication
SELECT name, certificate_id, pvt_key_encryption_type_desc
FROM sys.certificates
WHERE name LIKE 'AG%';
```

## Setting Up the Link

### Step 1: Prepare SQL Server

```sql
-- Create database mirroring endpoint
CREATE ENDPOINT Hadr_endpoint
    STATE = STARTED
    AS TCP (LISTENER_PORT = 5022)
    FOR DATABASE_MIRRORING (
        ROLE = ALL,
        AUTHENTICATION = CERTIFICATE AG_Cert,
        ENCRYPTION = REQUIRED ALGORITHM AES
    );

-- Create the database for replication
CREATE DATABASE SalesDB;
ALTER DATABASE SalesDB SET RECOVERY FULL;
BACKUP DATABASE SalesDB TO DISK = 'C:\Backups\SalesDB.bak';
BACKUP LOG SalesDB TO DISK = 'C:\Backups\SalesDB.trn';
```

### Step 2: Configure Azure SQL MI

```bash
# Get SQL MI endpoint info
az sql mi show \
    --name mysqlmi \
    --resource-group myResourceGroup \
    --query "{endpoint:fullyQualifiedDomainName,state:state}"
```

### Step 3: Create the Distributed AG

```sql
-- On SQL Server
CREATE AVAILABILITY GROUP [DAG_Link]
    WITH (DISTRIBUTED)
    AVAILABILITY GROUP ON
        'OnPremAG' WITH (
            LISTENER_URL = 'TCP://sqlserver.domain.com:5022',
            AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT,
            FAILOVER_MODE = MANUAL,
            SEEDING_MODE = AUTOMATIC
        ),
        'MI_AG' WITH (
            LISTENER_URL = 'TCP://mysqlmi.12345.database.windows.net:5022',
            AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT,
            FAILOVER_MODE = MANUAL,
            SEEDING_MODE = AUTOMATIC
        );
```

## Using PowerShell for Link Setup

```powershell
# Install the SQL MI Link module
Install-Module -Name Az.Sql -Force

# Connect to Azure
Connect-AzAccount

# Create the link
$linkParams = @{
    ResourceGroupName = "myResourceGroup"
    InstanceName = "mysqlmi"
    Name = "SalesDBLink"
    PrimaryAvailabilityGroupName = "OnPremAG"
    SecondaryAvailabilityGroupName = "MI_AG"
    TargetDatabase = "SalesDB"
    SourceEndpoint = "TCP://sqlserver.domain.com:5022"
}

New-AzSqlInstanceLink @linkParams
```

## Monitoring Link Status

```sql
-- On SQL Server: Check distributed AG status
SELECT
    ag.name AS distributed_ag_name,
    ar.replica_server_name,
    ars.role_desc,
    ars.synchronization_health_desc,
    ars.connected_state_desc
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id = ars.replica_id
WHERE ag.is_distributed = 1;

-- Check database synchronization
SELECT
    db_name(database_id) AS database_name,
    synchronization_state_desc,
    synchronization_health_desc,
    log_send_queue_size,
    redo_queue_size
FROM sys.dm_hadr_database_replica_states;
```

## Python Application for Read-Scale

```python
import pyodbc

class HybridSQLConnection:
    def __init__(self):
        self.write_conn_str = (
            "Driver={ODBC Driver 18 for SQL Server};"
            "Server=sqlserver.domain.com;"
            "Database=SalesDB;"
            "Trusted_Connection=yes;"
        )

        self.read_conn_str = (
            "Driver={ODBC Driver 18 for SQL Server};"
            "Server=mysqlmi.database.windows.net;"
            "Database=SalesDB;"
            "Authentication=ActiveDirectoryInteractive;"
        )

    def execute_write(self, query, params=None):
        """Execute write operations on-premises"""
        with pyodbc.connect(self.write_conn_str) as conn:
            cursor = conn.cursor()
            cursor.execute(query, params or [])
            conn.commit()
            return cursor.rowcount

    def execute_read(self, query, params=None):
        """Execute read operations on Azure SQL MI"""
        with pyodbc.connect(self.read_conn_str) as conn:
            cursor = conn.cursor()
            cursor.execute(query, params or [])
            return cursor.fetchall()

# Usage
db = HybridSQLConnection()

# Writes go to on-premises
db.execute_write("INSERT INTO Orders (CustomerID, Total) VALUES (?, ?)", [1, 99.99])

# Reads go to Azure SQL MI
orders = db.execute_read("SELECT * FROM Orders WHERE CustomerID = ?", [1])
```

## Failover to Azure SQL MI

```sql
-- Break the link and promote Azure SQL MI
ALTER AVAILABILITY GROUP [DAG_Link]
    FAILOVER;

-- After failover, MI becomes read-write
-- Update connection strings in your applications
```

The Link feature provides a low-risk path to cloud migration while enabling hybrid scenarios during the transition.
