---
title: "Microsoft Fabric Updates: August 2024 Highlights"
description: "3. Create Lakehouse with Shortcuts"
author: Michael John Peña
draft: false
date: 2024-08-01
tags:
  - Microsoft Fabric
  - Azure
  - Data Platform
  - Analytics
  - Updates
---

## Major Announcements

### Mirroring Goes GA

Database mirroring is now generally available, enabling near real-time replication of operational databases into OneLake:

- **Azure SQL Database**: Full GA support
- **Azure Cosmos DB**: GA for analytical workloads
- **Snowflake**: Preview for cross-cloud scenarios

```python
# Mirroring configuration via REST API
import requests

def create_mirror(
    workspace_id: str,
    mirror_name: str,
    source_connection: str,
    target_lakehouse: str
) -> dict:
    """Create a new database mirror."""

    headers = {
        "Authorization": f"Bearer {get_fabric_token()}",
        "Content-Type": "application/json"
    }

    payload = {
        "displayName": mirror_name,
        "description": "Automated mirror from Azure SQL",
        "sourceConnection": source_connection,
        "targetLakehouse": target_lakehouse,
        "syncMode": "continuous",
        "initialSyncType": "full"
    }

    response = requests.post(
        f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/mirroredDatabases",
        headers=headers,
        json=payload
    )

    return response.json()
```

### Capacity Updates

New capacity features improve cost management:

- **Smoothing**: Spreads compute spikes over time
- **Bursting**: Temporary capacity increases for peak loads
- **Autoscale**: Automatic scaling based on demand (preview)

### OneLake Improvements

- **Shortcuts to more sources**: Now supports Google Cloud Storage
- **Better Delta Lake support**: Improved merge and update performance
- **Enhanced security**: Row-level security for lakehouses

## What This Means for Data Teams

**Simplified Architecture**

With mirroring GA, many ETL pipelines can be eliminated. Instead of:
```
Source DB -> ADF -> Staging -> Transform -> Warehouse
```

You get:
```
Source DB -> Mirror -> OneLake (direct queries)
```

**Cost Predictability**

Smoothing and bursting help avoid surprise capacity exhaustion:

```python
def estimate_capacity_usage(
    base_cu: int,
    peak_multiplier: float,
    smoothing_enabled: bool,
    burst_enabled: bool
) -> dict:
    """Estimate capacity usage with new features."""

    peak_cu = base_cu * peak_multiplier

    if smoothing_enabled:
        # Smoothing spreads peaks over 24 hours
        effective_peak = base_cu + (peak_cu - base_cu) * 0.3
    else:
        effective_peak = peak_cu

    if burst_enabled:
        # Bursting allows temporary overages
        max_burst = base_cu * 1.5
        can_handle_peak = peak_cu <= max_burst
    else:
        can_handle_peak = peak_cu <= base_cu

    return {
        "base_cu": base_cu,
        "peak_cu": peak_cu,
        "effective_peak_with_smoothing": effective_peak,
        "can_handle_with_bursting": can_handle_peak,
        "recommended_sku": calculate_recommended_sku(effective_peak)
    }

def calculate_recommended_sku(cu_needed: float) -> str:
    skus = [
        ("F2", 2), ("F4", 4), ("F8", 8), ("F16", 16),
        ("F32", 32), ("F64", 64), ("F128", 128), ("F256", 256)
    ]
    for name, cu in skus:
        if cu >= cu_needed:
            return name
    return "F256+"
```

## Migration Considerations

If you're migrating from existing solutions:

### From Azure Synapse

```python
# Key differences to consider
migration_checklist = {
    "serverless_sql": {
        "fabric_equivalent": "Lakehouse SQL endpoint",
        "migration_effort": "low",
        "notes": "Similar T-SQL support, different billing model"
    },
    "dedicated_sql": {
        "fabric_equivalent": "Warehouse",
        "migration_effort": "medium",
        "notes": "Need to recreate objects, test workloads"
    },
    "spark_pools": {
        "fabric_equivalent": "Spark in Fabric",
        "migration_effort": "low",
        "notes": "Similar API, better integration with OneLake"
    },
    "pipelines": {
        "fabric_equivalent": "Data Factory in Fabric",
        "migration_effort": "low",
        "notes": "Can import existing pipelines"
    }
}
```

### From Databricks

```python
# Interoperability considerations
databricks_fabric_coexistence = {
    "delta_lake": "Native support in both, full compatibility",
    "unity_catalog": "Can use shortcuts to access Databricks-managed tables",
    "notebooks": "Different runtime, may need adjustments",
    "workflows": "Need to rebuild in Fabric or use external orchestration"
}
```

## Getting Started

If you're new to Fabric or these features:

**1. Enable Mirroring**

```sql
-- Check if your Azure SQL database supports mirroring
SELECT
    database_id,
    name,
    compatibility_level,
    is_read_committed_snapshot_on
FROM sys.databases
WHERE name = DB_NAME();

-- Requirements:
-- - Compatibility level >= 130
-- - Read committed snapshot ON (recommended)
-- - Change tracking or CDC enabled
```

**2. Configure Capacity**

```python
def configure_fabric_capacity(
    capacity_name: str,
    sku: str,
    enable_smoothing: bool = True,
    enable_bursting: bool = True
) -> dict:
    """Configure Fabric capacity with new features."""

    # Via Azure Resource Manager
    template = {
        "type": "Microsoft.Fabric/capacities",
        "apiVersion": "2023-11-01",
        "name": capacity_name,
        "location": "eastus",
        "sku": {"name": sku},
        "properties": {
            "administration": {
                "members": ["admin@contoso.com"]
            },
            "capacityFeatures": {
                "smoothingEnabled": enable_smoothing,
                "burstingEnabled": enable_bursting
            }
        }
    }

    return template
```

**3. Create Lakehouse with Shortcuts**

```python
# Using Fabric REST API
def create_lakehouse_with_shortcuts(
    workspace_id: str,
    lakehouse_name: str,
    shortcuts: list[dict]
) -> dict:
    """Create lakehouse and configure shortcuts."""

    # Create lakehouse
    lakehouse = create_lakehouse(workspace_id, lakehouse_name)

    # Add shortcuts
    for shortcut in shortcuts:
        add_shortcut(
            workspace_id=workspace_id,
            lakehouse_id=lakehouse["id"],
            shortcut_name=shortcut["name"],
            target_path=shortcut["target"],
            source_type=shortcut["type"]  # "adls", "s3", "gcs"
        )

    return lakehouse
```

## Best Practices

1. **Start with mirroring**: Evaluate which operational databases can be mirrored
2. **Enable smoothing**: Reduces capacity throttling risk
3. **Plan capacity carefully**: Use the new estimators before committing
4. **Test thoroughly**: New features may have edge cases
5. **Stay updated**: Fabric releases updates frequently

## Conclusion

August 2024 brings Fabric closer to its vision of a unified analytics platform. Mirroring GA removes integration complexity, capacity features improve cost predictability, and OneLake continues to expand its reach.

Evaluate these features for your workloads and start planning your Fabric journey if you haven't already.
