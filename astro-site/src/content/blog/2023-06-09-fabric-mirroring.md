---
title: "Fabric Mirroring: Real-Time Database Replication"
description: "Mirroring simplifies real-time data replication to Fabric. Tomorrow, I will cover Git integration in Fabric."
author: Michael John Peña
draft: false
date: 2023-06-09
tags:
  - Microsoft Fabric
  - Mirroring
  - CDC
  - Database Replication
  - Real-Time
---

## What is Mirroring?

Mirroring continuously replicates data from source databases to Fabric, keeping OneLake synchronized with operational systems:

```
┌─────────────────────────────────────────────────────┐
│                 Fabric Mirroring                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │ Source Database │    │    Mirrored Database    │ │
│  │                 │    │                         │ │
│  │ ┌─────────────┐ │    │ ┌─────────────────────┐ │ │
│  │ │ Table A     │─┼────┼▶│ Table A (Delta)     │ │ │
│  │ └─────────────┘ │    │ └─────────────────────┘ │ │
│  │ ┌─────────────┐ │    │ ┌─────────────────────┐ │ │
│  │ │ Table B     │─┼────┼▶│ Table B (Delta)     │ │ │
│  │ └─────────────┘ │    │ └─────────────────────┘ │ │
│  │ ┌─────────────┐ │    │ ┌─────────────────────┐ │ │
│  │ │ Table C     │─┼────┼▶│ Table C (Delta)     │ │ │
│  │ └─────────────┘ │    │ └─────────────────────┘ │ │
│  └─────────────────┘    └─────────────────────────┘ │
│                                │                    │
│        Change Data Capture     │                    │
│        (Near Real-Time)        ▼                    │
│                         ┌──────────────────┐       │
│                         │    OneLake       │       │
│                         │  (Delta Format)  │       │
│                         └──────────────────┘       │
│                                │                    │
│                    ┌───────────┼───────────┐       │
│                    ▼           ▼           ▼       │
│               ┌────────┐ ┌────────┐ ┌────────┐    │
│               │Lakehouse│ │Warehouse│ │Power BI│   │
│               └────────┘ └────────┘ └────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Supported Sources

```python
mirroring_sources = {
    "azure_sql_database": {
        "status": "GA",
        "requirements": [
            "Azure SQL Database (any tier)",
            "Change Data Capture enabled",
            "Appropriate permissions"
        ]
    },
    "azure_cosmos_db": {
        "status": "Preview",
        "requirements": [
            "Azure Cosmos DB (SQL API)",
            "Change feed enabled"
        ]
    },
    "snowflake": {
        "status": "Preview",
        "requirements": [
            "Snowflake account",
            "Change tracking enabled"
        ]
    }
}
```

## Setting Up Azure SQL Mirroring

### Prerequisites

```sql
-- Enable CDC on Azure SQL Database
-- Run in source database

-- Enable CDC at database level
EXEC sys.sp_cdc_enable_db;

-- Enable CDC for specific tables
EXEC sys.sp_cdc_enable_table
    @source_schema = N'dbo',
    @source_name = N'Sales',
    @role_name = NULL,
    @supports_net_changes = 1;

EXEC sys.sp_cdc_enable_table
    @source_schema = N'dbo',
    @source_name = N'Customers',
    @role_name = NULL,
    @supports_net_changes = 1;

-- Verify CDC is enabled
SELECT name, is_cdc_enabled
FROM sys.databases
WHERE name = DB_NAME();

SELECT name, is_tracked_by_cdc
FROM sys.tables
WHERE is_tracked_by_cdc = 1;
```

### Create Mirrored Database

```python
# Steps in Fabric Portal:
# 1. Create new item > Mirrored Database
# 2. Select source type (Azure SQL Database)
# 3. Configure connection
# 4. Select tables to mirror
# 5. Start mirroring

mirroring_config = {
    "source": {
        "type": "AzureSqlDatabase",
        "server": "myserver.database.windows.net",
        "database": "SalesDB",
        "authentication": "ManagedIdentity"  # or ServicePrincipal
    },
    "tables": [
        {"schema": "dbo", "table": "Sales"},
        {"schema": "dbo", "table": "Customers"},
        {"schema": "dbo", "table": "Products"}
    ],
    "settings": {
        "replication_mode": "Continuous",
        "initial_load": True
    }
}
```

## Using Mirrored Data

### In Spark

```python
# Access mirrored tables in notebooks
# Tables appear in the mirrored database namespace

# Read mirrored table
sales_df = spark.read.format("delta").table("MirroredSalesDB.dbo.Sales")
customers_df = spark.read.format("delta").table("MirroredSalesDB.dbo.Customers")

# Join mirrored and Lakehouse data
lakehouse_products = spark.read.format("delta").table("products")

enriched_sales = sales_df \
    .join(customers_df, "CustomerID") \
    .join(lakehouse_products, "ProductID")

display(enriched_sales)

# Write analysis results to Lakehouse
enriched_sales.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("enriched_sales")
```

### In SQL

```sql
-- Query mirrored tables via SQL endpoint
SELECT
    s.OrderID,
    s.OrderDate,
    c.CustomerName,
    c.Segment,
    p.ProductName,
    s.Quantity,
    s.Amount
FROM MirroredSalesDB.dbo.Sales s
JOIN MirroredSalesDB.dbo.Customers c ON s.CustomerID = c.CustomerID
JOIN lakehouse.dbo.products p ON s.ProductID = p.ProductID
WHERE s.OrderDate >= '2023-01-01';

-- Create view combining mirrored and Lakehouse data
CREATE VIEW vw_sales_analysis AS
SELECT
    s.*,
    c.CustomerName,
    c.Segment,
    c.Country
FROM MirroredSalesDB.dbo.Sales s
JOIN MirroredSalesDB.dbo.Customers c ON s.CustomerID = c.CustomerID;
```

### In Power BI

```python
# Direct Lake mode works with mirrored tables
# Create semantic model from mirrored database

# Steps:
# 1. Open Mirrored Database
# 2. Go to SQL analytics endpoint
# 3. Create new semantic model
# 4. Select mirrored tables
# 5. Build reports with near real-time data
```

## Monitoring Mirroring

```python
# Monitor mirroring status
# In Fabric Portal: Mirrored Database > Monitoring

monitoring_metrics = {
    "replication_lag": "Time delay between source and mirror",
    "rows_replicated": "Total rows replicated",
    "changes_per_minute": "Rate of change replication",
    "errors": "Any replication errors",
    "table_status": "Status per table"
}

# Via API
from azure.identity import DefaultAzureCredential
import requests

def get_mirroring_status(workspace_id: str, mirrored_db_id: str):
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/mirroredDatabases/{mirrored_db_id}/status"

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {token.token}"}
    )

    return response.json()

status = get_mirroring_status("workspace-id", "mirrored-db-id")
print(f"Status: {status['replicationStatus']}")
print(f"Lag: {status['replicationLagSeconds']}s")
```

## Use Cases

```python
use_cases = {
    "real_time_analytics": {
        "description": "Analyze operational data without impacting production",
        "benefits": [
            "Near real-time data freshness",
            "No load on source database for analytics",
            "Combined with historical data in Lakehouse"
        ]
    },
    "operational_reporting": {
        "description": "Build reports on current operational state",
        "benefits": [
            "Direct Lake for Power BI performance",
            "No ETL pipeline to manage",
            "Always current data"
        ]
    },
    "data_warehouse_feed": {
        "description": "Feed mirrored data into data warehouse",
        "benefits": [
            "CDC without custom implementation",
            "Delta format for efficient updates",
            "Simplified architecture"
        ]
    }
}
```

## Mirroring vs Traditional ETL

```python
comparison = {
    "mirroring": {
        "data_freshness": "Near real-time (seconds to minutes)",
        "setup_complexity": "Low (configuration based)",
        "maintenance": "Managed by Fabric",
        "transformation": "Post-replication",
        "cost_model": "Included in capacity"
    },
    "traditional_etl": {
        "data_freshness": "Scheduled (hours to days)",
        "setup_complexity": "High (custom development)",
        "maintenance": "Self-managed",
        "transformation": "During extraction",
        "cost_model": "Activity-based"
    }
}

# When to use Mirroring:
# - Need near real-time data
# - Source supports CDC/change feed
# - Minimal transformation needed
# - Want simplified architecture

# When to use Traditional ETL:
# - Complex transformations at extraction
# - Source doesn't support CDC
# - Need full control over data movement
# - Historical snapshots required
```

Mirroring simplifies real-time data replication to Fabric. Tomorrow, I will cover Git integration in Fabric.

## Resources

- [Fabric Mirroring Overview](https://learn.microsoft.com/en-us/fabric/database/mirrored-database/overview)
- [Azure SQL Mirroring](https://learn.microsoft.com/en-us/fabric/database/mirrored-database/azure-sql-database)
- [Mirroring FAQ](https://learn.microsoft.com/en-us/fabric/database/mirrored-database/faq)
