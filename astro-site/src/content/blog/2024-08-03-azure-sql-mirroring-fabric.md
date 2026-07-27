---
title: "Azure SQL Mirroring to Fabric: Complete Setup Guide"
author: Michael John Peña
draft: false
date: 2024-08-03
tags:
  - Microsoft Fabric
  - Azure SQL
  - Mirroring
  - Database
  - Tutorial

---

I wrote "Azure SQL Mirroring to Fabric: Complete Setup Guide" to share practical, production-minded guidance on this topic.

## Prerequisites Checklist

```python
prerequisites = {
    "azure_sql": {
        "version": "Azure SQL Database (not on-premises)",
        "tier": "Basic or higher (not serverless)",
        "networking": "Public endpoint or private endpoint to Fabric",
        "authentication": "AAD authentication enabled"
    },
    "fabric": {
        "capacity": "F2 or higher",
        "workspace": "With contributor access",
        "region": "Same region as SQL recommended"
    },
    "permissions": {
        "sql": "db_owner or equivalent",
        "fabric": "Workspace admin or contributor"
    }
}
```

## Step 1: Prepare Azure SQL Database

### Enable Change Tracking

```sql
-- Connect to your database
USE [YourDatabase];

-- Enable at database level
IF NOT EXISTS (
    SELECT 1 FROM sys.change_tracking_databases
    WHERE database_id = DB_ID()
)
BEGIN
    ALTER DATABASE [YourDatabase]
    SET CHANGE_TRACKING = ON
    (CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);
    PRINT 'Change tracking enabled at database level';
END

-- Enable for each table you want to mirror
DECLARE @tables TABLE (SchemaName NVARCHAR(128), TableName NVARCHAR(128));
INSERT INTO @tables VALUES
    ('dbo', 'Customers'),
    ('dbo', 'Orders'),
    ('dbo', 'OrderItems'),
    ('dbo', 'Products'),
    ('sales', 'Transactions');

DECLARE @schema NVARCHAR(128), @table NVARCHAR(128), @sql NVARCHAR(MAX);

DECLARE table_cursor CURSOR FOR
SELECT SchemaName, TableName FROM @tables;

OPEN table_cursor;
FETCH NEXT FROM table_cursor INTO @schema, @table;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'
    IF NOT EXISTS (
        SELECT 1 FROM sys.change_tracking_tables
        WHERE object_id = OBJECT_ID(''' + @schema + '.' + @table + ''')
    )
    BEGIN
        ALTER TABLE [' + @schema + '].[' + @table + ']
        ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);
        PRINT ''Change tracking enabled for ' + @schema + '.' + @table + ''';
    END';

    EXEC sp_executesql @sql;
    FETCH NEXT FROM table_cursor INTO @schema, @table;
END

CLOSE table_cursor;
DEALLOCATE table_cursor;
```

### Verify Configuration

```sql
-- Check database settings
SELECT
    DB_NAME() AS DatabaseName,
    d.compatibility_level,
    d.is_read_committed_snapshot_on,
    ct.is_auto_cleanup_on,
    ct.retention_period,
    ct.retention_period_units_desc
FROM sys.databases d
LEFT JOIN sys.change_tracking_databases ct ON d.database_id = ct.database_id
WHERE d.name = DB_NAME();

-- Check table tracking status
SELECT
    SCHEMA_NAME(t.schema_id) AS SchemaName,
    t.name AS TableName,
    ct.is_track_columns_updated_on,
    t.type_desc
FROM sys.tables t
LEFT JOIN sys.change_tracking_tables ct ON t.object_id = ct.object_id
WHERE SCHEMA_NAME(t.schema_id) IN ('dbo', 'sales')
ORDER BY SchemaName, TableName;

-- Verify primary keys (required for mirroring)
SELECT
    SCHEMA_NAME(t.schema_id) AS SchemaName,
    t.name AS TableName,
    CASE WHEN pk.object_id IS NOT NULL THEN 'Yes' ELSE 'NO - REQUIRED' END AS HasPrimaryKey
FROM sys.tables t
LEFT JOIN (
    SELECT DISTINCT parent_object_id AS object_id
    FROM sys.key_constraints
    WHERE type = 'PK'
) pk ON t.object_id = pk.object_id
WHERE SCHEMA_NAME(t.schema_id) IN ('dbo', 'sales')
ORDER BY HasPrimaryKey DESC, SchemaName, TableName;
```

## Step 2: Configure Network Access

### Option A: Public Endpoint

```sql
-- Allow Azure services (in Azure portal or via script)
-- Firewall rule: Allow Azure services and resources

-- In SQL, verify connectivity
SELECT
    client_net_address,
    local_net_address,
    auth_scheme
FROM sys.dm_exec_connections
WHERE session_id = @@SPID;
```

### Option B: Private Endpoint (Recommended)

```bicep
// Create private endpoint for Fabric access
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: 'pe-sql-fabric'
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'sql-connection'
        properties: {
          privateLinkServiceId: sqlServerId
          groupIds: ['sqlServer']
        }
      }
    ]
  }
}
```

## Step 3: Create the Mirror in Fabric

### Using Fabric Portal

1. Navigate to your workspace
2. Click **New** > **Mirrored Database**
3. Select **Azure SQL Database**
4. Configure connection:
   - Server name
   - Database name
   - Authentication method (recommend Managed Identity)
5. Select tables to mirror
6. Review and create

### Using REST API

```python
import requests
from azure.identity import DefaultAzureCredential
import json

class FabricMirrorManager:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.base_url = "https://api.fabric.microsoft.com/v1"
        self.credential = DefaultAzureCredential()

    def _get_headers(self):
        token = self.credential.get_token("https://api.fabric.microsoft.com/.default")
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def create_mirror(
        self,
        display_name: str,
        server: str,
        database: str,
        tables: list[dict]
    ) -> dict:
        """Create Azure SQL mirror."""

        payload = {
            "displayName": display_name,
            "description": f"Mirror of {database} from {server}",
            "definition": {
                "parts": [
                    {
                        "path": "definition.json",
                        "payloadType": "InlineBase64",
                        "payload": self._encode_definition({
                            "source": {
                                "type": "AzureSqlDatabase",
                                "server": server,
                                "database": database,
                                "authentication": {
                                    "type": "ServicePrincipal"  # Or "ManagedIdentity"
                                }
                            },
                            "tables": tables,
                            "settings": {
                                "syncMode": "Continuous",
                                "initialLoad": "Full"
                            }
                        })
                    }
                ]
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/mirroredDatabases",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

    def _encode_definition(self, definition: dict) -> str:
        import base64
        return base64.b64encode(json.dumps(definition).encode()).decode()

    def get_mirror_status(self, mirror_id: str) -> dict:
        """Get mirror sync status."""
        response = requests.get(
            f"{self.base_url}/workspaces/{self.workspace_id}/mirroredDatabases/{mirror_id}",
            headers=self._get_headers()
        )
        return response.json()

    def get_sync_details(self, mirror_id: str) -> dict:
        """Get detailed sync information."""
        response = requests.get(
            f"{self.base_url}/workspaces/{self.workspace_id}/mirroredDatabases/{mirror_id}/sync",
            headers=self._get_headers()
        )
        return response.json()

# Usage
manager = FabricMirrorManager(workspace_id="your-workspace-id")

mirror = manager.create_mirror(
    display_name="SalesDB-Mirror",
    server="myserver.database.windows.net",
    database="SalesDB",
    tables=[
        {"schema": "dbo", "name": "Customers"},
        {"schema": "dbo", "name": "Orders"},
        {"schema": "dbo", "name": "OrderItems"},
        {"schema": "dbo", "name": "Products"}
    ]
)

print(f"Mirror created: {mirror['id']}")
```

## Step 4: Monitor the Mirror

### Check Sync Status

```python
def monitor_mirror_health(manager: FabricMirrorManager, mirror_id: str):
    """Monitor mirror health and sync status."""

    status = manager.get_sync_details(mirror_id)

    print(f"Mirror Status: {status['status']}")
    print(f"Last Sync: {status.get('lastSyncTime', 'N/A')}")
    print(f"Sync Lag: {status.get('syncLagSeconds', 0)} seconds")

    print("\nTable Status:")
    for table in status.get('tables', []):
        print(f"  {table['schema']}.{table['name']}:")
        print(f"    Status: {table['status']}")
        print(f"    Rows Synced: {table.get('rowsSynced', 0):,}")
        print(f"    Last Change: {table.get('lastChangeTime', 'N/A')}")

    # Check for issues
    if status.get('syncLagSeconds', 0) > 300:
        print("\n⚠️ WARNING: Sync lag exceeds 5 minutes")

    if status['status'] != 'Running':
        print(f"\n⚠️ WARNING: Mirror is not running: {status['status']}")

# Set up continuous monitoring
import time

while True:
    monitor_mirror_health(manager, mirror_id)
    time.sleep(60)  # Check every minute
```

### SQL-Based Monitoring

```sql
-- Query from the Lakehouse SQL endpoint
-- Check data freshness

WITH LatestOrders AS (
    SELECT MAX(ModifiedDate) as LastModified
    FROM dbo.Orders
)
SELECT
    'Orders' as TableName,
    LastModified,
    DATEDIFF(SECOND, LastModified, GETUTCDATE()) as LagSeconds
FROM LatestOrders

UNION ALL

SELECT
    'Customers',
    MAX(ModifiedDate),
    DATEDIFF(SECOND, MAX(ModifiedDate), GETUTCDATE())
FROM dbo.Customers;
```

## Step 5: Access Mirrored Data

### From Power BI

```python
# Direct Lake dataset configuration
# In Power BI Desktop or Service:

# 1. Connect to Lakehouse
# 2. Select tables from the mirrored database
# 3. Configure Direct Lake mode (default for Fabric)

# Benefits:
# - Real-time data without refresh
# - Excellent performance
# - Minimal data movement
```

### From Notebooks

```python
# Spark notebook in Fabric
from pyspark.sql.functions import *

# Read mirrored data
orders = spark.read.format("delta").table("SalesDB_Mirror.dbo.Orders")
customers = spark.read.format("delta").table("SalesDB_Mirror.dbo.Customers")

# Analyze
daily_sales = orders.filter(
    col("OrderDate") >= date_sub(current_date(), 30)
).groupBy(
    date_format("OrderDate", "yyyy-MM-dd").alias("Date")
).agg(
    count("*").alias("OrderCount"),
    sum("TotalAmount").alias("Revenue")
).orderBy("Date")

display(daily_sales)
```

## Troubleshooting

### Common Issues

```python
troubleshooting_guide = {
    "Initial sync stuck": {
        "causes": [
            "Network connectivity issues",
            "Insufficient Fabric capacity",
            "Table without primary key"
        ],
        "solutions": [
            "Check firewall rules",
            "Scale up capacity temporarily",
            "Add primary keys to tables"
        ]
    },
    "Sync lag increasing": {
        "causes": [
            "High transaction volume",
            "Large transactions",
            "Capacity throttling"
        ],
        "solutions": [
            "Enable smoothing",
            "Consider larger capacity",
            "Optimize source workload"
        ]
    },
    "Schema change errors": {
        "causes": [
            "Incompatible schema change",
            "Column dropped",
            "Type change"
        ],
        "solutions": [
            "Recreate mirror after changes",
            "Use additive changes only"
        ]
    }
}
```

## Best Practices Summary

1. **Plan tables carefully**: Start with essential tables
2. **Enable change tracking first**: Before creating mirror
3. **Use managed identity**: For secure authentication
4. **Monitor sync lag**: Set up alerts
5. **Test schema changes**: In non-production first

## Conclusion

Azure SQL mirroring to Fabric transforms how operational data becomes available for analytics. With proper setup and monitoring, you get near real-time data access without complex ETL pipelines.

Follow this guide to set up your first mirror, then expand to more tables as you validate the approach.

