---
title: "Azure Databricks Unity Catalog: Unified Data Governance at Scale"
description: "Unity Catalog solves these problems with a unified approach."
author: Michael John Peña
draft: false
date: 2022-03-10
tags:
  - Azure
  - Databricks
  - Data Governance
  - Unity Catalog
  - Data Engineering
---

## Why Unity Catalog Matters

Before Unity Catalog, Databricks governance was workspace-centric:
- Each workspace had its own metastore
- Sharing data between workspaces required manual copying
- Access control was fragmented
- No centralized audit trail

Unity Catalog solves these problems with a unified approach.

## Core Concepts

### Three-Level Namespace

Unity Catalog introduces a hierarchical namespace:

```
catalog.schema.table

Example: production.sales.transactions
```

This enables:
- **Catalogs**: Logical groupings (production, development, sandbox)
- **Schemas**: Database-like containers within catalogs
- **Tables/Views/Functions**: The actual data objects

### Metastore

The metastore is the top-level container that holds all metadata:

```python
# Creating a Unity Catalog metastore (admin operation)
# Typically done via UI or Terraform

# Terraform example
resource "databricks_metastore" "this" {
  name          = "primary"
  storage_root  = "abfss://metastore@storageaccount.dfs.core.windows.net/"
  owner         = "data-platform-team"
  region        = "eastus"

  # Delta Sharing
  delta_sharing_scope                               = "INTERNAL_AND_EXTERNAL"
  delta_sharing_recipient_token_lifetime_in_seconds = 3600
}
```

## Setting Up Unity Catalog

### Enable Unity Catalog for a Workspace

```python
# Assign workspace to metastore
resource "databricks_metastore_assignment" "this" {
  metastore_id = databricks_metastore.this.id
  workspace_id = var.workspace_id
}

# Create a catalog
resource "databricks_catalog" "production" {
  metastore_id = databricks_metastore.this.id
  name         = "production"
  comment      = "Production data catalog"
}

# Create a schema
resource "databricks_schema" "sales" {
  catalog_name = databricks_catalog.production.name
  name         = "sales"
  comment      = "Sales domain data"
}
```

### Creating Tables

```sql
-- Create a managed table
CREATE TABLE production.sales.transactions (
    transaction_id STRING,
    customer_id STRING,
    product_id STRING,
    amount DECIMAL(10, 2),
    transaction_date DATE,
    region STRING
)
USING DELTA
COMMENT 'Sales transactions data'
TBLPROPERTIES ('quality' = 'gold');

-- Create from existing data
CREATE TABLE production.sales.customers
USING DELTA
LOCATION 'abfss://data@storage.dfs.core.windows.net/customers'
COMMENT 'Customer master data';

-- Create external table
CREATE TABLE production.sales.external_orders (
    order_id STRING,
    order_date DATE,
    total DECIMAL(10, 2)
)
USING DELTA
LOCATION 'abfss://external@storage.dfs.core.windows.net/orders';
```

## Access Control

Unity Catalog provides fine-grained access control:

```sql
-- Grant catalog access
GRANT USAGE ON CATALOG production TO `data-analysts@company.com`;

-- Grant schema access
GRANT USAGE ON SCHEMA production.sales TO `data-analysts@company.com`;

-- Grant table-level read access
GRANT SELECT ON TABLE production.sales.transactions TO `data-analysts@company.com`;

-- Grant write access
GRANT SELECT, MODIFY ON TABLE production.sales.transactions TO `data-engineers@company.com`;

-- Grant all privileges on schema
GRANT ALL PRIVILEGES ON SCHEMA production.sales TO `data-platform@company.com`;

-- Create a row filter for sensitive data
CREATE FUNCTION production.sales.region_filter(region STRING)
RETURNS BOOLEAN
RETURN IF(
    is_account_group_member('global-access'),
    TRUE,
    region = current_user_region()
);

ALTER TABLE production.sales.transactions
SET ROW FILTER production.sales.region_filter ON (region);
```

## Column-Level Security

Protect sensitive columns:

```sql
-- Create a column mask function
CREATE FUNCTION production.sales.mask_email(email STRING)
RETURNS STRING
RETURN IF(
    is_account_group_member('pii-access'),
    email,
    CONCAT(LEFT(email, 2), '***@', SPLIT(email, '@')[1])
);

-- Apply mask to column
ALTER TABLE production.sales.customers
ALTER COLUMN email SET MASK production.sales.mask_email;

-- Query results will show masked data for non-privileged users
SELECT customer_id, email FROM production.sales.customers;
-- Returns: C001, jo***@company.com (for users without pii-access)
```

## Data Lineage

Track data dependencies:

```python
# Lineage is automatically captured for all Unity Catalog operations

# Query lineage via REST API
import requests

def get_table_lineage(catalog, schema, table):
    url = f"{workspace_url}/api/2.0/lineage-tracking/table-lineage"

    headers = {"Authorization": f"Bearer {token}"}

    params = {
        "table_name": f"{catalog}.{schema}.{table}",
        "include_entity_lineage": True
    }

    response = requests.get(url, headers=headers, params=params)
    return response.json()

# Get upstream dependencies
lineage = get_table_lineage("production", "sales", "daily_summary")
print("Upstream tables:", lineage.get("upstream_tables", []))
print("Upstream notebooks:", lineage.get("upstream_notebooks", []))
```

## Managed vs External Tables

Understanding the difference:

```sql
-- Managed table: Unity Catalog manages both metadata and data
CREATE TABLE production.sales.managed_orders (
    order_id STRING,
    amount DECIMAL(10, 2)
) USING DELTA;

-- When dropped, data is deleted
DROP TABLE production.sales.managed_orders;

-- External table: Unity Catalog manages metadata, you manage data
CREATE TABLE production.sales.external_orders
USING DELTA
LOCATION 'abfss://data@storage.dfs.core.windows.net/orders';

-- When dropped, only metadata is removed, data remains
DROP TABLE production.sales.external_orders;
```

## Storage Credentials

Securely access external storage:

```python
# Create storage credential
resource "databricks_storage_credential" "external" {
  name = "external-storage-cred"

  azure_managed_identity {
    access_connector_id = azurerm_databricks_access_connector.this.id
  }

  comment = "Managed identity for external storage access"
}

# Create external location
resource "databricks_external_location" "data_lake" {
  name            = "data-lake"
  url             = "abfss://data@storageaccount.dfs.core.windows.net/"
  credential_name = databricks_storage_credential.external.name
  comment         = "Primary data lake location"
}
```

```sql
-- Grant access to external location
GRANT READ FILES ON EXTERNAL LOCATION `data-lake` TO `data-engineers@company.com`;
GRANT CREATE TABLE ON EXTERNAL LOCATION `data-lake` TO `data-engineers@company.com`;
```

## Audit Logging

Track all access:

```python
# Query audit logs from Azure Monitor
query = """
DatabricksAudit
| where Category == "unityCatalog"
| where ActionName in ("getTable", "createTable", "deleteTable", "grantPermission")
| project
    TimeGenerated,
    ActionName,
    Identity,
    RequestParams,
    Response
| order by TimeGenerated desc
"""

# Or from system tables
spark.sql("""
    SELECT
        event_time,
        action_name,
        user_identity.email as user,
        request_params.full_name_arg as object_name
    FROM system.access.audit
    WHERE action_name LIKE '%Table%'
    ORDER BY event_time DESC
    LIMIT 100
""")
```

## Best Practices

### Catalog Organization

```
# Recommended structure
production/
├── sales/
│   ├── transactions
│   ├── customers
│   └── products
├── marketing/
│   ├── campaigns
│   └── leads
└── finance/
    ├── invoices
    └── payments

development/
├── sales/
│   └── (mirrors production structure)
└── experiments/
    └── (ad-hoc analysis)

sandbox/
└── (per-user schemas for exploration)
```

### Naming Conventions

```sql
-- Use consistent naming
-- Tables: snake_case, plural for collections
CREATE TABLE production.sales.order_line_items ...;

-- Views: prefix with v_ or suffix with _view
CREATE VIEW production.sales.v_daily_sales ...;

-- Functions: verb_noun format
CREATE FUNCTION production.sales.calculate_discount ...;
```

### Migration Strategy

```python
# Migrate existing Hive tables to Unity Catalog

# 1. List existing tables
legacy_tables = spark.catalog.listTables("legacy_database")

# 2. Create Unity Catalog equivalents
for table in legacy_tables:
    source = f"legacy_database.{table.name}"
    target = f"production.sales.{table.name}"

    # For managed tables, use CTAS
    spark.sql(f"""
        CREATE TABLE {target}
        USING DELTA
        AS SELECT * FROM {source}
    """)

    # Preserve properties
    spark.sql(f"""
        ALTER TABLE {target}
        SET TBLPROPERTIES (
            'migrated_from' = '{source}',
            'migration_date' = current_date()
        )
    """)
```

## Integration with Azure Services

### Azure Purview Integration

```python
# Unity Catalog metadata can be synced to Azure Purview
# for enterprise-wide data catalog

# Configure in Unity Catalog settings
purview_config = {
    "purview_account": "mycompany-purview",
    "collection": "databricks-assets",
    "sync_frequency": "hourly"
}
```

### Azure AD Integration

```python
# Groups from Azure AD are automatically available
# Grant access using Azure AD group names
spark.sql("""
    GRANT SELECT ON TABLE production.sales.transactions
    TO `Sales-Team@mycompany.onmicrosoft.com`
""")
```

## Conclusion

Unity Catalog represents a significant step forward for data governance in Azure Databricks. By providing unified access control, data lineage, and audit capabilities across all workspaces, it enables organizations to implement true data mesh architectures while maintaining centralized governance.

Key benefits:
- Single source of truth for data access policies
- Cross-workspace data sharing without copying
- Automatic lineage tracking
- Fine-grained security down to row and column level
- Enterprise-ready audit trails

## Resources

- [Unity Catalog Documentation](https://docs.databricks.com/data-governance/unity-catalog/index.html)
- [Unity Catalog Best Practices](https://docs.databricks.com/data-governance/unity-catalog/best-practices.html)
- [Migration Guide](https://docs.databricks.com/data-governance/unity-catalog/migrate.html)
