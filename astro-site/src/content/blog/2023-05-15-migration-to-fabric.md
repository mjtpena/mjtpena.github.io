---
title: "Migrating to Microsoft Fabric: Strategies and Best Practices"
author: Michael John Peña
draft: false
date: 2023-05-15
tags:
  - Microsoft Fabric
  - Migration
  - Azure
  - Data Platform
  - Best Practices

---

I wrote "Migrating to Microsoft Fabric: Strategies and Best Practices" to share practical, production-minded guidance on this topic.

## Migration Approaches

### Approach 1: Lift and Shift with Shortcuts

The fastest approach uses OneLake shortcuts to reference existing data without copying.

```python
# Step 1: Create shortcuts to existing ADLS data
shortcut_config = {
    "name": "existing_sales_data",
    "target": {
        "adlsGen2": {
            "location": "https://existingstorage.dfs.core.windows.net/",
            "subpath": "/curated/sales/"
        }
    }
}

# Step 2: Data appears in Fabric Lakehouse
# Access via Spark
df = spark.read.format("delta").load("Files/existing_sales_data/")

# Step 3: Gradually move processing to Fabric
# Keep data in place, migrate compute
```

### Approach 2: Side-by-Side Migration

Run Fabric alongside existing platform during transition.

```python
migration_phases = {
    "phase_1": {
        "duration": "1-2 months",
        "activities": [
            "Set up Fabric capacity and workspaces",
            "Create shortcuts to existing data",
            "Migrate BI reports to Direct Lake",
            "Keep Synapse running for ETL"
        ]
    },
    "phase_2": {
        "duration": "2-3 months",
        "activities": [
            "Migrate pipelines to Fabric Data Factory",
            "Migrate notebooks to Fabric",
            "Validate data quality parity",
            "Performance testing"
        ]
    },
    "phase_3": {
        "duration": "1-2 months",
        "activities": [
            "Cutover to Fabric",
            "Decommission old resources",
            "Optimize for Fabric capacity",
            "Documentation and training"
        ]
    }
}
```

### Approach 3: Complete Rebuild

For teams wanting to redesign their data architecture.

```python
rebuild_approach = {
    "when_to_use": [
        "Current architecture has significant tech debt",
        "Requirements have changed significantly",
        "Team has capacity for major project",
        "Clean slate provides better long-term value"
    ],
    "steps": [
        "Design new architecture on Fabric principles",
        "Build new Lakehouses with proper medallion layers",
        "Implement new pipelines with Fabric-native patterns",
        "Historical data load with validation",
        "Parallel run and cutover"
    ]
}
```

## Migrating Specific Components

### Azure Data Factory to Fabric Data Factory

```python
# ADF Pipeline Example
adf_pipeline = {
    "activities": [
        {
            "name": "CopyFromSQL",
            "type": "Copy",
            "inputs": [{"referenceName": "SqlDataset", "type": "DatasetReference"}],
            "outputs": [{"referenceName": "AdlsDataset", "type": "DatasetReference"}],
            "linkedServiceName": {"referenceName": "SqlLinkedService"}
        }
    ]
}

# Fabric Pipeline Equivalent
fabric_pipeline = {
    "activities": [
        {
            "name": "CopyFromSQL",
            "type": "Copy",
            "typeProperties": {
                "source": {
                    "type": "SqlServerSource",
                    "sqlReaderQuery": "SELECT * FROM Sales"
                },
                "sink": {
                    "type": "LakehouseSink",
                    "tableActionOption": "Append"
                }
            }
        }
    ]
}

# Key differences:
# - No linked services needed for OneLake destinations
# - Direct Lakehouse integration
# - Simplified dataset configuration
```

### Synapse Notebooks to Fabric Notebooks

```python
# Synapse Notebook - reading from ADLS
# Original code
storage_account = "mystorageaccount"
container = "data"
path = "curated/sales"

df = spark.read.format("delta").load(
    f"abfss://{container}@{storage_account}.dfs.core.windows.net/{path}"
)

# Fabric Notebook - reading from Lakehouse
# Migrated code (if data copied to Lakehouse)
df = spark.read.format("delta").table("sales")

# Or using shortcut (if data remains in ADLS)
df = spark.read.format("delta").load("Files/external_sales_shortcut/")

# Most PySpark code works without changes
# Main updates: storage paths and authentication
```

### Power BI Import to Direct Lake

```python
# Migration steps for Power BI
pbi_migration = {
    "step_1": {
        "task": "Create Lakehouse with required tables",
        "code": """
# Ensure tables exist in Lakehouse Tables folder
df.write.format("delta").saveAsTable("sales_facts")
df.write.format("delta").saveAsTable("dim_customer")
        """
    },
    "step_2": {
        "task": "Create semantic model from Lakehouse",
        "action": "Lakehouse > SQL endpoint > New semantic model"
    },
    "step_3": {
        "task": "Recreate measures in new model",
        "code": """
-- DAX measures transfer directly
Total Sales = SUM(sales_facts[amount])
        """
    },
    "step_4": {
        "task": "Rebind reports to new semantic model",
        "action": "Report > Transform data > Data source settings > Change source"
    }
}
```

### Synapse Dedicated Pool to Fabric Warehouse

```sql
-- Synapse Dedicated Pool DDL
CREATE TABLE dbo.fact_sales
WITH (
    DISTRIBUTION = HASH(customer_id),
    CLUSTERED COLUMNSTORE INDEX
)
AS SELECT * FROM staging.sales;

-- Fabric Warehouse DDL (simpler)
CREATE TABLE dbo.fact_sales
AS SELECT * FROM staging.sales;

-- Note: Fabric handles distribution automatically
-- No DISTRIBUTION or INDEX clauses needed
```

## Data Validation

```python
# Validation framework for migration
from pyspark.sql.functions import count, sum as spark_sum, avg

def validate_migration(source_df, target_df, key_columns, metrics_columns):
    """Compare source and target data for migration validation"""

    results = {}

    # Row count comparison
    source_count = source_df.count()
    target_count = target_df.count()
    results["row_count_match"] = source_count == target_count
    results["source_rows"] = source_count
    results["target_rows"] = target_count

    # Aggregate metrics comparison
    for col in metrics_columns:
        source_sum = source_df.agg(spark_sum(col)).collect()[0][0]
        target_sum = target_df.agg(spark_sum(col)).collect()[0][0]
        results[f"{col}_sum_match"] = abs(source_sum - target_sum) < 0.01

    # Sample record comparison
    source_sample = source_df.orderBy(key_columns).limit(100).collect()
    target_sample = target_df.orderBy(key_columns).limit(100).collect()
    results["sample_match"] = source_sample == target_sample

    return results

# Usage
source_df = spark.read.format("delta").load("abfss://...@storage.dfs.core.windows.net/sales")
target_df = spark.read.format("delta").table("sales")

validation = validate_migration(
    source_df, target_df,
    key_columns=["order_id"],
    metrics_columns=["amount", "quantity"]
)

print("Validation Results:")
for key, value in validation.items():
    status = "PASS" if value == True or isinstance(value, (int, float)) else "FAIL"
    print(f"  {key}: {value} [{status}]")
```

## Handling Common Challenges

### Challenge 1: Network Isolation

```python
# Synapse supports VNet integration; Fabric has limited options

# Solution approaches:
network_solutions = {
    "on_premises_data": [
        "Use Fabric On-Premises Data Gateway",
        "Set up hybrid connectivity via ExpressRoute",
        "Stage data to Azure then use shortcuts"
    ],
    "private_endpoints": [
        "Fabric supports limited private networking",
        "Consider hybrid architecture for sensitive data",
        "Use service tags for firewall rules"
    ]
}
```

### Challenge 2: Custom Spark Configurations

```python
# Synapse allows detailed Spark pool configuration
# Fabric uses managed Spark with Environment artifacts

# Solution: Use Fabric Environment
environment_config = {
    "spark_properties": {
        "spark.executor.memory": "28g",
        "spark.executor.cores": "4"
    },
    "libraries": {
        "pypi": ["great-expectations", "pandas==2.0.0"],
        "custom": ["my-package.whl"]
    }
}
```

### Challenge 3: Complex Security Requirements

```python
# Synapse: Granular RBAC at storage level
# Fabric: Workspace-based security model

# Solution: Design workspace structure for security
security_design = {
    "workspace_per_sensitivity": {
        "Public Data": {"access": "All analysts"},
        "Internal Data": {"access": "Internal team"},
        "Confidential Data": {"access": "Restricted group"}
    },
    "item_level_security": {
        "row_level_security": "Implement in semantic models",
        "column_level_security": "Use views to restrict columns"
    }
}
```

## Migration Checklist

```python
migration_checklist = {
    "pre_migration": [
        "[ ] Inventory all current data assets",
        "[ ] Document data lineage",
        "[ ] Identify critical workloads",
        "[ ] Assess Fabric capacity requirements",
        "[ ] Plan workspace structure",
        "[ ] Define success criteria"
    ],
    "during_migration": [
        "[ ] Set up Fabric capacity and workspaces",
        "[ ] Create shortcuts for existing data",
        "[ ] Migrate pipelines and notebooks",
        "[ ] Validate data quality",
        "[ ] Performance test critical workloads",
        "[ ] Train users on Fabric"
    ],
    "post_migration": [
        "[ ] Cutover to Fabric",
        "[ ] Monitor performance and costs",
        "[ ] Decommission old resources",
        "[ ] Update documentation",
        "[ ] Optimize capacity usage"
    ]
}
```

Migration to Fabric requires planning but offers significant simplification benefits. Take an incremental approach and validate thoroughly at each step.

## Resources

- [Migration Overview](https://learn.microsoft.com/en-us/fabric/data-engineering/migrate-synapse-overview)
- [ADF to Fabric Migration](https://learn.microsoft.com/en-us/fabric/data-factory/compare-fabric-data-factory-and-azure-data-factory)
- [Shortcuts Documentation](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
