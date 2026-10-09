---
title: "Fabric Mirroring GA: Real-Time Database Replication"
author: Michael John Peña
draft: false
date: 2024-08-02
tags:
  - Microsoft Fabric
  - Mirroring
  - Database
  - Real-Time
  - OneLake
---

## What is Mirroring?

Mirroring creates a continuously synchronized copy of your operational database in OneLake as Delta Lake tables:

```
Source Database (OLTP)
        │
        │  Change Data Capture
        ▼
   Mirroring Service
        │
        │  Near Real-Time
        ▼
  OneLake (Delta Lake)
        │
        ├── Lakehouse SQL Endpoint
        ├── Spark Access
        └── Power BI Direct Lake
```

## Supported Sources

As of GA:
- **Azure SQL Database**: Full support
- **Azure SQL Managed Instance**: Full support
- **Azure Cosmos DB**: Analytical store integration
- **Snowflake**: Cross-cloud preview

## Setting Up Azure SQL Mirroring

### Prerequisites

```sql
-- 1. Ensure compatibility level
ALTER DATABASE [YourDB] SET COMPATIBILITY_LEVEL = 150;

-- 2. Enable change tracking (required)
ALTER DATABASE [YourDB] SET CHANGE_TRACKING = ON
(CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);

-- 3. Enable change tracking for each table
ALTER TABLE [dbo].[Customers]
ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);

ALTER TABLE [dbo].[Orders]
ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);

-- 4. Check current state
SELECT
    DB_NAME() AS DatabaseName,
    t.name AS TableName,
    ct.is_track_columns_updated_on
FROM sys.change_tracking_tables ct
JOIN sys.tables t ON ct.object_id = t.object_id;
```

### Create the Mirror

```python
import requests
from azure.identity import DefaultAzureCredential

def create_sql_mirror(
    workspace_id: str,
    display_name: str,
    sql_connection_string: str,
    tables_to_mirror: list[str]
) -> dict:
    """Create a mirrored database from Azure SQL."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    payload = {
        "displayName": display_name,
        "definition": {
            "parts": [
                {
                    "path": "mirroring.json",
                    "payload": {
                        "sourceType": "AzureSqlDatabase",
                        "connection": {
                            "connectionString": sql_connection_string,
                            "authentication": "ManagedIdentity"
                        },
                        "tables": [
                            {"schema": "dbo", "name": table}
                            for table in tables_to_mirror
                        ],
                        "syncSettings": {
                            "mode": "Continuous",
                            "initialSyncType": "Full"
                        }
                    }
                }
            ]
        }
    }

    response = requests.post(
        f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/mirroredDatabases",
        headers=headers,
        json=payload
    )

    return response.json()

# Usage
mirror = create_sql_mirror(
    workspace_id="your-workspace-id",
    display_name="Sales-Mirror",
    sql_connection_string="your-connection-string",
    tables_to_mirror=["Customers", "Orders", "Products", "OrderItems"]
)
```

## Understanding Sync Behavior

### Initial Sync

The first synchronization captures all existing data:

```python
def monitor_initial_sync(workspace_id: str, mirror_id: str):
    """Monitor initial sync progress."""

    while True:
        status = get_mirror_status(workspace_id, mirror_id)

        print(f"Status: {status['syncStatus']}")
        print(f"Tables completed: {status['tablesCompleted']}/{status['totalTables']}")
        print(f"Rows synced: {status['rowsSynced']:,}")

        if status['syncStatus'] == 'Running':
            break
        elif status['syncStatus'] == 'Failed':
            raise Exception(f"Initial sync failed: {status['error']}")

        time.sleep(30)
```

### Continuous Sync

After initial sync, changes flow continuously:

```
Source Transaction
       │
       ├── Write to source database
       │
       ├── Change tracking captures change
       │
       ├── Mirroring service polls changes (every few seconds)
       │
       └── Delta Lake append/update in OneLake

Typical latency: 30 seconds to 2 minutes
```

### Handling Schema Changes

```python
# Supported schema changes (automatic)
supported_changes = [
    "Add column (nullable)",
    "Add table (with change tracking)",
    "Modify column data type (compatible)",
]

# Unsupported (requires mirror recreation)
unsupported_changes = [
    "Drop column",
    "Rename column",
    "Change primary key",
    "Drop table",
]

def handle_schema_change(mirror_id: str, change_type: str):
    """Handle schema changes in mirrored database."""

    if change_type in ["add_column", "add_table"]:
        # Automatic - just wait for sync
        print("Schema change will sync automatically")
        return

    if change_type in ["drop_column", "rename_column"]:
        # Requires intervention
        print("Warning: This change requires mirror recreation")
        print("Steps:")
        print("1. Pause mirror")
        print("2. Apply schema change to source")
        print("3. Delete and recreate mirror")
        return
```

## Querying Mirrored Data

### Via SQL Endpoint

```sql
-- Connect to the Lakehouse SQL endpoint
-- Mirrored tables appear as regular tables

SELECT
    c.CustomerName,
    COUNT(o.OrderID) as OrderCount,
    SUM(o.TotalAmount) as TotalRevenue
FROM dbo.Customers c
JOIN dbo.Orders o ON c.CustomerID = o.CustomerID
WHERE o.OrderDate >= DATEADD(month, -3, GETDATE())
GROUP BY c.CustomerName
ORDER BY TotalRevenue DESC;
```

### Via Spark

```python
# In a Fabric notebook
from pyspark.sql import SparkSession

# Read from mirrored table
customers_df = spark.read.format("delta").load(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse/Tables/Customers"
)

orders_df = spark.read.format("delta").load(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse/Tables/Orders"
)

# Join and analyze
analysis = customers_df.join(
    orders_df,
    customers_df.CustomerID == orders_df.CustomerID
).groupBy("CustomerName").agg(
    count("OrderID").alias("order_count"),
    sum("TotalAmount").alias("total_revenue")
)

display(analysis)
```

### Via Power BI Direct Lake

```python
# Power BI semantic model connects directly to mirrored data
# No import needed - uses Direct Lake mode

# Benefits:
# - Sub-second query response
# - Always up-to-date data
# - No data movement
# - Reduced refresh times
```

## Performance Considerations

```python
def estimate_mirror_performance(
    source_db_size_gb: float,
    transaction_rate_per_second: float,
    avg_row_size_bytes: int
) -> dict:
    """Estimate mirroring performance metrics."""

    # Initial sync estimate
    initial_sync_hours = source_db_size_gb / 50  # ~50 GB/hour typical

    # Continuous sync latency
    if transaction_rate_per_second < 100:
        latency_seconds = 30
    elif transaction_rate_per_second < 1000:
        latency_seconds = 60
    else:
        latency_seconds = 120

    # OneLake storage
    storage_gb = source_db_size_gb * 1.2  # Delta overhead

    # Daily change data volume
    daily_changes_gb = (
        transaction_rate_per_second * 86400 * avg_row_size_bytes
    ) / 1e9

    return {
        "initial_sync_estimate_hours": initial_sync_hours,
        "typical_latency_seconds": latency_seconds,
        "onelake_storage_gb": storage_gb,
        "daily_change_volume_gb": daily_changes_gb,
        "recommended_capacity": "F8" if source_db_size_gb < 100 else "F16"
    }
```

## Best Practices

1. **Enable change tracking early**: Do this before creating the mirror
2. **Start with non-critical tables**: Test with less important data first
3. **Monitor sync lag**: Set up alerts for latency spikes
4. **Plan for schema changes**: Document the process for your team
5. **Use appropriate capacity**: Under-provisioning causes throttling

## When Not to Use Mirroring

Consider alternatives when:
- **Sub-second latency required**: Use event streaming instead
- **Complex transformations needed**: Traditional ETL may be better
- **Source doesn't support change tracking**: Some databases can't be mirrored
- **Network constraints**: Large data volumes over slow connections

## Conclusion

Mirroring simplifies the data pipeline from operational databases to analytics. With GA, it's ready for production use with Azure SQL Database and related sources.

Start by identifying tables that would benefit from near real-time analytics access, set up change tracking, and create your first mirror. The reduction in ETL complexity alone makes it worthwhile.
