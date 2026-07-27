---
title: "Snowflake Mirroring to Fabric: Cross-Cloud Data Integration"
author: Michael John Peña
draft: false
date: 2024-08-05
tags:
  - Microsoft Fabric
  - Snowflake
  - Mirroring
  - Cross-Cloud
  - Data Integration

---

I wrote "Snowflake Mirroring to Fabric: Cross-Cloud Data Integration" to share practical, production-minded guidance on this topic.

## Why Snowflake to Fabric?

Organizations often have data across multiple platforms:
- Snowflake for data warehouse workloads
- Azure for operational systems
- Power BI for visualization

Mirroring eliminates the need for complex ETL between these systems.

## Architecture Overview

```
Snowflake (AWS/Azure/GCP)
           │
           │ Snowflake Data Sharing / Direct Access
           ▼
   Fabric Mirroring Service
           │
           │ Delta Lake conversion
           ▼
     OneLake (Delta Lake)
           │
           ├── T-SQL queries
           ├── Spark notebooks
           └── Power BI reports
```

## Prerequisites

```python
prerequisites = {
    "snowflake": {
        "edition": "Standard or higher",
        "role": "ACCOUNTADMIN or custom role with required privileges",
        "networking": "Allow Azure IP ranges or private connectivity"
    },
    "fabric": {
        "capacity": "F4 or higher (recommended for cross-cloud)",
        "workspace": "Contributor access",
        "preview_features": "Enabled"
    }
}
```

## Step 1: Configure Snowflake

### Create Integration User

```sql
-- In Snowflake
USE ROLE ACCOUNTADMIN;

-- Create a dedicated role for Fabric integration
CREATE ROLE FABRIC_INTEGRATION_ROLE;

-- Create warehouse for mirroring operations
CREATE WAREHOUSE FABRIC_MIRROR_WH
    WAREHOUSE_SIZE = 'X-SMALL'
    AUTO_SUSPEND = 60
    AUTO_RESUME = TRUE;

-- Grant permissions
GRANT USAGE ON WAREHOUSE FABRIC_MIRROR_WH TO ROLE FABRIC_INTEGRATION_ROLE;

-- Create integration user
CREATE USER fabric_mirror_user
    PASSWORD = 'StrongPassword123!'
    DEFAULT_ROLE = FABRIC_INTEGRATION_ROLE
    DEFAULT_WAREHOUSE = FABRIC_MIRROR_WH;

GRANT ROLE FABRIC_INTEGRATION_ROLE TO USER fabric_mirror_user;

-- Grant access to source database and schema
GRANT USAGE ON DATABASE SALES_DB TO ROLE FABRIC_INTEGRATION_ROLE;
GRANT USAGE ON SCHEMA SALES_DB.PUBLIC TO ROLE FABRIC_INTEGRATION_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA SALES_DB.PUBLIC TO ROLE FABRIC_INTEGRATION_ROLE;

-- For future tables
GRANT SELECT ON FUTURE TABLES IN SCHEMA SALES_DB.PUBLIC TO ROLE FABRIC_INTEGRATION_ROLE;
```

### Enable Change Tracking

```sql
-- Enable change tracking on tables you want to mirror
ALTER TABLE SALES_DB.PUBLIC.CUSTOMERS SET CHANGE_TRACKING = TRUE;
ALTER TABLE SALES_DB.PUBLIC.ORDERS SET CHANGE_TRACKING = TRUE;
ALTER TABLE SALES_DB.PUBLIC.PRODUCTS SET CHANGE_TRACKING = TRUE;
ALTER TABLE SALES_DB.PUBLIC.ORDER_ITEMS SET CHANGE_TRACKING = TRUE;

-- Verify
SHOW TABLES IN SCHEMA SALES_DB.PUBLIC;
-- Check CHANGE_TRACKING column
```

### Configure Network Access

```sql
-- Option 1: Allow Azure IP ranges (simpler but less secure)
-- Configure in Snowflake network policy

-- Option 2: Private connectivity (recommended for production)
-- Requires Azure Private Link to Snowflake
-- Configure based on your Snowflake cloud provider
```

## Step 2: Create Fabric Connection

```python
import requests
from azure.identity import DefaultAzureCredential

class SnowflakeMirrorManager:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_headers(self):
        credential = DefaultAzureCredential()
        token = credential.get_token("https://api.fabric.microsoft.com/.default")
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def create_snowflake_connection(
        self,
        connection_name: str,
        account: str,
        username: str,
        password: str,
        warehouse: str
    ) -> dict:
        """Create Snowflake connection in Fabric."""

        payload = {
            "displayName": connection_name,
            "connectionDetails": {
                "type": "Snowflake",
                "parameters": {
                    "account": account,
                    "warehouse": warehouse
                }
            },
            "credentials": {
                "credentialType": "UsernamePassword",
                "username": username,
                "password": password
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/connections",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

    def create_snowflake_mirror(
        self,
        display_name: str,
        connection_id: str,
        database: str,
        schema: str,
        tables: list[str]
    ) -> dict:
        """Create Snowflake mirror."""

        definition = {
            "source": {
                "type": "Snowflake",
                "connectionId": connection_id,
                "database": database,
                "schema": schema
            },
            "tables": [{"name": t} for t in tables],
            "settings": {
                "syncMode": "Continuous",
                "initialSyncType": "Full"
            }
        }

        # Encode and send
        import base64
        import json

        payload = {
            "displayName": display_name,
            "definition": {
                "parts": [{
                    "path": "definition.json",
                    "payloadType": "InlineBase64",
                    "payload": base64.b64encode(json.dumps(definition).encode()).decode()
                }]
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/mirroredDatabases",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

# Usage
manager = SnowflakeMirrorManager("workspace-id")

# Create connection
connection = manager.create_snowflake_connection(
    connection_name="Snowflake-Sales",
    account="xy12345.us-east-1",  # Your Snowflake account identifier
    username="fabric_mirror_user",
    password="StrongPassword123!",
    warehouse="FABRIC_MIRROR_WH"
)

# Create mirror
mirror = manager.create_snowflake_mirror(
    display_name="Snowflake-Sales-Mirror",
    connection_id=connection["id"],
    database="SALES_DB",
    schema="PUBLIC",
    tables=["CUSTOMERS", "ORDERS", "PRODUCTS", "ORDER_ITEMS"]
)
```

## Data Type Mapping

```python
# Snowflake to Delta Lake type mapping
type_mapping = {
    # Numeric
    "NUMBER": "DECIMAL",
    "INT": "INT",
    "BIGINT": "BIGINT",
    "FLOAT": "DOUBLE",
    "DOUBLE": "DOUBLE",

    # String
    "VARCHAR": "STRING",
    "STRING": "STRING",
    "TEXT": "STRING",
    "CHAR": "STRING",

    # Date/Time
    "DATE": "DATE",
    "TIME": "STRING",  # No native TIME in Delta
    "TIMESTAMP": "TIMESTAMP",
    "TIMESTAMP_NTZ": "TIMESTAMP",
    "TIMESTAMP_TZ": "TIMESTAMP",

    # Semi-structured
    "VARIANT": "STRING",  # JSON as string
    "OBJECT": "STRING",
    "ARRAY": "STRING",

    # Binary
    "BINARY": "BINARY",

    # Boolean
    "BOOLEAN": "BOOLEAN"
}
```

## Querying Mirrored Snowflake Data

### SQL Endpoint

```sql
-- Query mirrored Snowflake data in Fabric
SELECT
    c.CUSTOMER_NAME,
    COUNT(o.ORDER_ID) as order_count,
    SUM(o.TOTAL_AMOUNT) as total_revenue
FROM Snowflake_Mirror.CUSTOMERS c
JOIN Snowflake_Mirror.ORDERS o ON c.CUSTOMER_ID = o.CUSTOMER_ID
WHERE o.ORDER_DATE >= DATEADD(year, -1, GETDATE())
GROUP BY c.CUSTOMER_NAME
ORDER BY total_revenue DESC;
```

### Spark

```python
# Combine Snowflake data with Azure data
snowflake_orders = spark.read.format("delta").table("Snowflake_Mirror.ORDERS")
azure_sql_inventory = spark.read.format("delta").table("AzureSQL_Mirror.INVENTORY")

# Cross-platform join
combined = snowflake_orders.join(
    azure_sql_inventory,
    snowflake_orders.PRODUCT_ID == azure_sql_inventory.product_id,
    "left"
).select(
    snowflake_orders["*"],
    azure_sql_inventory.current_stock,
    azure_sql_inventory.warehouse_location
)

display(combined)
```

## Handling Semi-Structured Data

```python
# Snowflake VARIANT columns come as JSON strings
from pyspark.sql.functions import from_json, col
from pyspark.sql.types import StructType, StructField, StringType, DoubleType

# Define schema for VARIANT column
metadata_schema = StructType([
    StructField("source", StringType(), True),
    StructField("campaign", StringType(), True),
    StructField("score", DoubleType(), True)
])

# Parse VARIANT column
orders_with_metadata = spark.read.format("delta").table("Snowflake_Mirror.ORDERS")

parsed = orders_with_metadata.withColumn(
    "metadata_parsed",
    from_json(col("METADATA_VARIANT"), metadata_schema)
).select(
    "ORDER_ID",
    "metadata_parsed.source",
    "metadata_parsed.campaign",
    "metadata_parsed.score"
)

display(parsed)
```

## Performance Considerations

```python
performance_factors = {
    "network_latency": {
        "description": "Cross-cloud adds latency",
        "mitigation": "Use private connectivity, choose nearby regions"
    },
    "data_transfer_costs": {
        "description": "Egress from Snowflake can be expensive",
        "mitigation": "Mirror only needed tables, consider incremental patterns"
    },
    "warehouse_costs": {
        "description": "Snowflake warehouse runs during sync",
        "mitigation": "Use X-Small, enable auto-suspend"
    },
    "initial_sync_time": {
        "description": "Large tables take longer",
        "mitigation": "Start with smaller tables, scale up"
    }
}
```

## Cost Optimization

```python
def estimate_snowflake_mirror_costs(
    tables: list[dict],  # [{name, rows, avg_row_bytes, daily_change_pct}]
    snowflake_credit_cost: float = 3.0  # $/credit
) -> dict:
    """Estimate costs for Snowflake mirroring."""

    # Initial sync
    total_bytes = sum(t["rows"] * t["avg_row_bytes"] for t in tables)
    initial_sync_credits = total_bytes / 1e9 * 0.5  # Rough estimate

    # Ongoing sync (daily)
    daily_change_bytes = sum(
        t["rows"] * t["avg_row_bytes"] * t["daily_change_pct"]
        for t in tables
    )
    daily_sync_credits = daily_change_bytes / 1e9 * 0.2

    # Egress costs (Snowflake to Azure)
    egress_per_gb = 0.12  # Varies by region
    initial_egress = total_bytes / 1e9 * egress_per_gb
    daily_egress = daily_change_bytes / 1e9 * egress_per_gb

    return {
        "initial_sync": {
            "snowflake_credits": initial_sync_credits,
            "snowflake_cost": initial_sync_credits * snowflake_credit_cost,
            "egress_cost": initial_egress
        },
        "daily_ongoing": {
            "snowflake_credits": daily_sync_credits,
            "snowflake_cost": daily_sync_credits * snowflake_credit_cost,
            "egress_cost": daily_egress
        },
        "monthly_estimate": (daily_sync_credits * snowflake_credit_cost + daily_egress) * 30
    }
```

## Best Practices

1. **Start small**: Mirror essential tables first
2. **Enable change tracking**: Required for incremental sync
3. **Use dedicated warehouse**: Don't impact production workloads
4. **Monitor costs**: Track Snowflake credits and egress
5. **Consider alternatives**: For very large datasets, evaluate Snowflake Data Sharing

## Limitations (Preview)

- Not all Snowflake features supported
- Some data types may need transformation
- Performance may vary based on network
- Check documentation for latest limitations

## Conclusion

Snowflake mirroring bridges the gap between Snowflake and Microsoft's data ecosystem. While still in preview, it offers a promising path for organizations with multi-cloud data strategies.

Evaluate the cost and performance characteristics for your specific workload before committing to production use.

