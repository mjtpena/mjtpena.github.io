---
title: "OneLake Shortcuts: Connecting Data Without Copying"
author: Michael John Peña
draft: false
date: 2023-06-03
tags:
  - Microsoft Fabric
  - OneLake
  - Shortcuts
  - Data Integration
  - Azure
---

Of everything announced at Build 2023, OneLake shortcuts might be the feature I find most architecturally elegant. A shortcut is not a copy, not a linked service, not an external table definition — it's a live pointer that appears as a folder inside OneLake but reads directly from the source. You can shortcut to Azure Data Lake Storage Gen2, Azure Blob Storage, Amazon S3, or even another Fabric Lakehouse or Warehouse. The practical consequence: a team that already has petabytes in ADLS Gen2 can expose that data to Fabric queries, notebooks, and pipelines immediately, without a migration project. I've been building proofs of concept this week and the experience is genuinely different from anything I've set up with linked services in Synapse.

## What are Shortcuts?

Shortcuts are symbolic links that reference data in external locations:

```
┌─────────────────────────────────────────────────────┐
│                    Lakehouse                         │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Tables/                                            │
│  ├── sales           (native Delta table)           │
│  ├── customers       (native Delta table)           │
│  └── external_data ──┐                              │
│                      │ SHORTCUT                     │
│  Files/              │                              │
│  ├── raw/            │                              │
│  ├── staging/        │                              │
│  └── archive ────────┤                              │
│                      │                              │
└──────────────────────┼──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              External Storage                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ ADLS Gen2   │  │ Amazon S3   │  │ GCS         │ │
│  │             │  │             │  │ (coming)    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐                  │
│  │ OneLake     │  │ Dataverse   │                  │
│  │ (other ws)  │  │             │                  │
│  └─────────────┘  └─────────────┘                  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Supported Shortcut Types

```python
shortcut_types = {
    "onelake": {
        "description": "Reference data in another Fabric workspace",
        "use_cases": [
            "Cross-workspace data sharing",
            "Shared dimension tables",
            "Central data hub pattern"
        ],
        "auth": "Workspace permissions"
    },
    "adls_gen2": {
        "description": "Reference data in Azure Data Lake Storage",
        "use_cases": [
            "Migration from existing data lake",
            "Hybrid architecture",
            "Data not suitable for Fabric"
        ],
        "auth": "Service principal or managed identity"
    },
    "amazon_s3": {
        "description": "Reference data in AWS S3 buckets",
        "use_cases": [
            "Multi-cloud data access",
            "Data from AWS-based systems",
            "Cross-cloud analytics"
        ],
        "auth": "IAM role or access keys"
    },
    "dataverse": {
        "description": "Reference Dataverse tables",
        "use_cases": [
            "Power Platform integration",
            "Dynamics 365 data access",
            "Business application data"
        ],
        "auth": "Dataverse permissions"
    }
}
```

## Creating Shortcuts

### Via Fabric Portal

```python
# Steps to create shortcut in Fabric UI:
# 1. Open Lakehouse
# 2. Right-click Tables or Files folder
# 3. Select "New shortcut"
# 4. Choose source type (OneLake, ADLS Gen2, S3, etc.)
# 5. Configure connection and path
# 6. Name the shortcut
```

### Via REST API

```python
import requests
from azure.identity import DefaultAzureCredential

def create_adls_shortcut(
    workspace_id: str,
    lakehouse_id: str,
    shortcut_name: str,
    storage_account: str,
    container: str,
    path: str
):
    """Create a shortcut to ADLS Gen2"""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{lakehouse_id}/shortcuts"

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    payload = {
        "name": shortcut_name,
        "path": "Tables",  # or "Files"
        "target": {
            "adlsGen2": {
                "location": f"https://{storage_account}.dfs.core.windows.net",
                "subpath": f"/{container}/{path}"
            }
        }
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Create shortcut
result = create_adls_shortcut(
    workspace_id="workspace-guid",
    lakehouse_id="lakehouse-guid",
    shortcut_name="external_sales",
    storage_account="myexternalstorage",
    container="data",
    path="sales/current"
)
print(f"Shortcut created: {result}")
```

### Cross-Workspace Shortcut

```python
def create_onelake_shortcut(
    target_workspace_id: str,
    target_lakehouse_id: str,
    shortcut_name: str,
    source_workspace_id: str,
    source_lakehouse_name: str,
    source_path: str
):
    """Create a shortcut to another OneLake location"""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{target_workspace_id}/items/{target_lakehouse_id}/shortcuts"

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    payload = {
        "name": shortcut_name,
        "path": "Tables",
        "target": {
            "oneLake": {
                "workspaceId": source_workspace_id,
                "itemId": source_lakehouse_id,
                "path": source_path
            }
        }
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()
```

## Using Shortcuts

### In Spark

```python
# Shortcuts appear as regular folders/tables in Lakehouse
# Access shortcut in Tables folder
df = spark.read.format("delta").table("external_sales")

# Access shortcut in Files folder
df = spark.read \
    .option("header", "true") \
    .csv("Files/external_archive/2023/*.csv")

# Join shortcut data with native data
native_customers = spark.read.format("delta").table("customers")
external_orders = spark.read.format("delta").table("external_orders")

joined = native_customers.join(
    external_orders,
    "customer_id",
    "inner"
)
```

### In SQL

```sql
-- Shortcuts are accessible via SQL endpoint
SELECT *
FROM external_sales
WHERE sale_date >= '2023-01-01';

-- Join with native tables
SELECT
    c.customer_name,
    s.product_id,
    s.amount
FROM customers c
JOIN external_sales s ON c.customer_id = s.customer_id;
```

## Migration Patterns with Shortcuts

### Pattern 1: Gradual Migration

```python
# Step 1: Create shortcut to existing ADLS data
# Data stays in place, accessible in Fabric

# Step 2: Process data in Fabric, write to native tables
external_df = spark.read.format("delta").table("shortcut_sales")

# Transform and write to native table
transformed = external_df.transform(apply_business_rules)
transformed.write.format("delta").mode("overwrite").saveAsTable("native_sales")

# Step 3: Update downstream consumers to use native table

# Step 4: Remove shortcut when migration complete
```

### Pattern 2: Hybrid Architecture

```python
# Keep some data external, some native

# External: Large historical archives (cost optimization)
# Shortcut to cold storage
historical_df = spark.read.format("delta").table("shortcut_historical_sales")

# Native: Recent/hot data (performance optimization)
recent_df = spark.read.format("delta").table("current_sales")

# Union for complete view
all_sales = recent_df.unionByName(historical_df)
```

### Pattern 3: Data Hub

```python
# Central workspace with shared dimensions
# Other workspaces create shortcuts to shared data

# In central workspace:
# - dim_customer
# - dim_product
# - dim_date

# In analytics workspace:
# Create shortcuts to dimensions
# dim_customer_shortcut -> central/dim_customer
# dim_product_shortcut -> central/dim_product

# Build local fact tables, join with shared dimensions
fact_sales = spark.read.format("delta").table("fact_sales")
dim_customer = spark.read.format("delta").table("dim_customer_shortcut")

report_data = fact_sales.join(dim_customer, "customer_id")
```

## Shortcut Limitations

```python
limitations = {
    "read_only": "Shortcuts are read-only; cannot write through shortcut",
    "delta_required": "For Tables shortcuts, source must be Delta format",
    "permissions": "User must have access to both shortcut and source",
    "networking": "External sources must be accessible from Fabric",
    "format_support": "Files shortcuts support any format; Tables require Delta"
}

# Working with read-only shortcuts
# Read from shortcut
source_df = spark.read.format("delta").table("shortcut_source")

# Process
transformed_df = source_df.transform(my_transformation)

# Write to native table (not back to shortcut)
transformed_df.write.format("delta").saveAsTable("native_output")
```

## Best Practices

```python
best_practices = {
    "naming": [
        "Use clear naming to indicate shortcuts (e.g., ext_*, shortcut_*)",
        "Document source location in shortcut description"
    ],
    "security": [
        "Ensure consistent security model between source and Fabric",
        "Audit shortcut access regularly"
    ],
    "performance": [
        "Shortcuts add latency for external sources",
        "Consider caching frequently accessed shortcut data",
        "Use native tables for hot data"
    ],
    "governance": [
        "Track data lineage through shortcuts",
        "Document shortcut dependencies",
        "Plan for shortcut lifecycle management"
    ]
}
```

Shortcuts enable powerful data federation scenarios in Fabric. Tomorrow, I will cover Direct Lake mode for Power BI.

## Resources

- [OneLake Shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts)
- [Create Shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/create-shortcuts)
- [Shortcut Security](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts-security)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
