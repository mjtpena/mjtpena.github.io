---
title: "Microsoft Fabric and Databricks: Coexistence Strategies"
author: Michael John Peña
draft: false
date: 2024-08-12
tags:
  - Microsoft Fabric
  - Databricks
  - Delta Lake
  - Data Architecture
  - Integration
---

## The Integration Landscape

```
┌──────────────────────────────────────────────────────────────┐
│                    Enterprise Data Platform                   │
│                                                               │
│  ┌─────────────────────┐      ┌─────────────────────┐        │
│  │    Databricks       │      │   Microsoft Fabric   │        │
│  │  ┌───────────────┐  │      │  ┌───────────────┐  │        │
│  │  │ ML Workloads  │  │      │  │ Power BI      │  │        │
│  │  │ Data Science  │  │      │  │ SQL Analytics │  │        │
│  │  │ Advanced ETL  │  │      │  │ Direct Lake   │  │        │
│  │  └───────────────┘  │      │  └───────────────┘  │        │
│  └──────────┬──────────┘      └──────────┬──────────┘        │
│             │                            │                    │
│             │      Delta Lake            │                    │
│             └──────────┬─────────────────┘                    │
│                        │                                      │
│              ┌─────────▼─────────┐                           │
│              │    Azure ADLS     │                           │
│              │   (Shared Data)   │                           │
│              └───────────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

## Integration Patterns

### Pattern 1: Shared Delta Lake Storage

```python
# Databricks writes to ADLS
# databricks_notebook.py

from delta.tables import DeltaTable

# Databricks job writes Delta tables to ADLS
output_path = "abfss://gold@datalake.dfs.core.windows.net/sales/customers"

customers_df.write.format("delta") \
    .mode("overwrite") \
    .option("overwriteSchema", "true") \
    .save(output_path)

# Optimize for downstream consumers
delta_table = DeltaTable.forPath(spark, output_path)
delta_table.optimize().executeCompaction()
delta_table.vacuum(168)  # 7 days retention
```

```python
# Fabric reads via shortcut
# fabric_notebook.py

# Create shortcut to Databricks-managed Delta table via REST API
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

workspace_id = "your-workspace-id"
lakehouse_id = "your-lakehouse-id"

# Create ADLS shortcut via Fabric REST API
shortcut_payload = {
    "path": "Tables/databricks_customers",
    "target": {
        "adlsGen2": {
            "location": "https://datalake.dfs.core.windows.net/gold/sales/customers"
        }
    }
}

url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{lakehouse_id}/shortcuts"
response = requests.post(url, headers=headers, json=shortcut_payload)
print(f"Shortcut created: {response.json()}")

# Now queryable in Fabric Spark
customers = spark.read.format("delta").load("Tables/databricks_customers")
```

### Pattern 2: Medallion Architecture Split

```python
class MedallionArchitecture:
    """
    Split medallion layers between Databricks and Fabric.

    Bronze/Silver: Databricks (complex transformations, ML)
    Gold: Fabric (BI, reporting, governed access)
    """

    def __init__(self, adls_account: str):
        self.adls_account = adls_account
        self.base_path = f"abfss://{{container}}@{adls_account}.dfs.core.windows.net"

    # Databricks handles Bronze and Silver
    def databricks_bronze_path(self, table: str) -> str:
        return f"{self.base_path.format(container='bronze')}/{table}"

    def databricks_silver_path(self, table: str) -> str:
        return f"{self.base_path.format(container='silver')}/{table}"

    # Fabric handles Gold
    def fabric_gold_path(self, table: str) -> str:
        return f"{self.base_path.format(container='gold')}/{table}"

    def sync_silver_to_gold(self, table_name: str, transformations: list = None):
        """Sync Silver (Databricks) to Gold (Fabric)."""

        silver_df = spark.read.format("delta").load(
            self.databricks_silver_path(table_name)
        )

        # Apply any Fabric-specific transformations
        if transformations:
            for transform in transformations:
                silver_df = transform(silver_df)

        # Write to Gold layer
        silver_df.write.format("delta") \
            .mode("overwrite") \
            .save(self.fabric_gold_path(table_name))

# Example usage
architecture = MedallionArchitecture("mydatalake")

# Databricks writes to Silver
# (done in Databricks job)

# Fabric syncs to Gold with business transformations
architecture.sync_silver_to_gold(
    table_name="sales_transactions",
    transformations=[
        lambda df: df.filter("is_valid = true"),
        lambda df: df.withColumn("region_name", map_region_codes("region_code"))
    ]
)
```

### Pattern 3: Workload-Based Routing

```python
class WorkloadRouter:
    """Route workloads to the optimal platform."""

    def __init__(self):
        self.workload_rules = {
            "ml_training": {
                "platform": "databricks",
                "reason": "MLflow integration, GPU clusters"
            },
            "streaming_etl": {
                "platform": "databricks",
                "reason": "Structured Streaming, Auto Loader"
            },
            "bi_reporting": {
                "platform": "fabric",
                "reason": "Direct Lake, Power BI integration"
            },
            "ad_hoc_sql": {
                "platform": "fabric",
                "reason": "SQL endpoint, warehouse experience"
            },
            "data_science_exploration": {
                "platform": "databricks",
                "reason": "Interactive notebooks, ML libraries"
            },
            "semantic_modeling": {
                "platform": "fabric",
                "reason": "Native semantic model support"
            }
        }

    def get_platform(self, workload_type: str) -> dict:
        """Determine optimal platform for workload."""

        if workload_type in self.workload_rules:
            return self.workload_rules[workload_type]

        # Default to Fabric for unknown workloads
        return {
            "platform": "fabric",
            "reason": "Default platform for general workloads"
        }

    def analyze_workload(self, workload_description: str) -> dict:
        """Analyze workload and recommend platform."""

        ml_keywords = ["training", "model", "ml", "machine learning", "inference"]
        bi_keywords = ["report", "dashboard", "visualization", "power bi"]
        streaming_keywords = ["streaming", "real-time", "kafka", "event"]

        description_lower = workload_description.lower()

        if any(kw in description_lower for kw in ml_keywords):
            return self.get_platform("ml_training")
        elif any(kw in description_lower for kw in bi_keywords):
            return self.get_platform("bi_reporting")
        elif any(kw in description_lower for kw in streaming_keywords):
            return self.get_platform("streaming_etl")
        else:
            return self.get_platform("ad_hoc_sql")

# Usage
router = WorkloadRouter()

# Route based on workload type
ml_platform = router.get_platform("ml_training")
print(f"ML workloads: {ml_platform['platform']} - {ml_platform['reason']}")

# Analyze workload description
recommendation = router.analyze_workload(
    "Build a customer churn prediction model"
)
print(f"Recommended: {recommendation['platform']}")
```

## Unity Catalog and Fabric Catalog Integration

### Reading Unity Catalog Tables in Fabric

```python
# Access Unity Catalog tables from Fabric via external tables

# Option 1: Shortcut to Unity Catalog managed storage
# Create shortcut to the underlying storage location

unity_catalog_path = "abfss://unity-catalog@storage.dfs.core.windows.net/catalog/schema/table"

# In Fabric Lakehouse
manager.create_adls_shortcut(
    shortcut_name="unity_customers",
    storage_account="storage",
    container="unity-catalog",
    path="catalog/schema/table"
)

# Option 2: Use Databricks SQL endpoint as external source
# (Via Data Factory or direct connection)
```

### Syncing Metadata

```python
class CatalogSync:
    """Sync metadata between Unity Catalog and Fabric."""

    def __init__(
        self,
        databricks_workspace_url: str,
        databricks_token: str,
        fabric_workspace_id: str
    ):
        self.databricks_url = databricks_workspace_url
        self.databricks_token = databricks_token
        self.fabric_workspace_id = fabric_workspace_id

    def get_unity_catalog_tables(self, catalog: str, schema: str) -> list:
        """List tables from Unity Catalog."""

        import requests

        headers = {"Authorization": f"Bearer {self.databricks_token}"}

        response = requests.get(
            f"{self.databricks_url}/api/2.1/unity-catalog/tables",
            headers=headers,
            params={"catalog_name": catalog, "schema_name": schema}
        )

        return response.json().get("tables", [])

    def create_fabric_shortcuts(
        self,
        catalog: str,
        schema: str,
        lakehouse_id: str
    ):
        """Create Fabric shortcuts for Unity Catalog tables."""

        tables = self.get_unity_catalog_tables(catalog, schema)

        for table in tables:
            storage_location = table.get("storage_location")
            table_name = table.get("name")

            if storage_location and storage_location.startswith("abfss://"):
                # Parse ADLS path and create shortcut
                self._create_shortcut_for_table(
                    table_name=table_name,
                    storage_path=storage_location,
                    lakehouse_id=lakehouse_id
                )

    def _create_shortcut_for_table(
        self,
        table_name: str,
        storage_path: str,
        lakehouse_id: str
    ):
        """Create individual shortcut."""
        # Parse abfss:// path and create shortcut
        # Implementation depends on path structure
        pass
```

## Performance Optimization

### Optimizing for Both Platforms

```python
class DualPlatformOptimizer:
    """Optimize Delta tables for both Databricks and Fabric."""

    def optimize_table(self, table_path: str, optimize_for: list = None):
        """Optimize table for specified platforms."""

        if optimize_for is None:
            optimize_for = ["databricks", "fabric"]

        delta_table = DeltaTable.forPath(spark, table_path)

        # Common optimizations
        delta_table.optimize().executeCompaction()

        if "fabric" in optimize_for:
            # V-Order optimization for Direct Lake
            spark.conf.set(
                "spark.databricks.delta.optimizeWrite.enabled",
                "true"
            )
            spark.conf.set(
                "spark.microsoft.delta.optimizeWrite.binSize",
                "1073741824"  # 1GB target file size
            )

            # Rewrite with V-Order
            df = spark.read.format("delta").load(table_path)
            df.write.format("delta") \
                .mode("overwrite") \
                .option("dataChange", "false") \
                .save(table_path)

        if "databricks" in optimize_for:
            # Z-Order on frequently filtered columns
            # This benefits both platforms
            delta_table.optimize().executeZOrderBy("date", "region")

    def set_compatible_properties(self, table_path: str):
        """Set table properties compatible with both platforms."""

        spark.sql(f"""
            ALTER TABLE delta.`{table_path}`
            SET TBLPROPERTIES (
                'delta.minReaderVersion' = '1',
                'delta.minWriterVersion' = '2',
                'delta.autoOptimize.optimizeWrite' = 'true',
                'delta.autoOptimize.autoCompact' = 'true'
            )
        """)
```

### File Format Considerations

```python
# Best practices for cross-platform Delta tables

write_config = {
    # File size
    "spark.databricks.delta.optimizeWrite.enabled": "true",
    "spark.databricks.delta.autoCompact.enabled": "true",
    "spark.sql.parquet.compression.codec": "snappy",

    # Compatibility
    "spark.databricks.delta.properties.defaults.minReaderVersion": "1",
    "spark.databricks.delta.properties.defaults.minWriterVersion": "2",

    # Avoid features not supported in Fabric
    "spark.databricks.delta.properties.defaults.enableChangeDataFeed": "false",

    # Target file size for good performance in both
    "spark.databricks.delta.targetFileSize": "134217728"  # 128MB
}

for key, value in write_config.items():
    spark.conf.set(key, value)
```

## Governance and Security

### Unified Access Control

```python
class UnifiedAccessControl:
    """Manage access across Databricks and Fabric."""

    def __init__(self):
        self.role_mapping = {
            # Map organizational roles to platform-specific roles
            "data_engineer": {
                "databricks": ["workspace_user", "sql_access"],
                "fabric": ["contributor"]
            },
            "data_scientist": {
                "databricks": ["workspace_user", "cluster_create", "ml_access"],
                "fabric": ["viewer"]
            },
            "analyst": {
                "databricks": ["sql_access"],
                "fabric": ["viewer", "build"]
            },
            "admin": {
                "databricks": ["workspace_admin"],
                "fabric": ["admin"]
            }
        }

    def grant_access(self, user_email: str, role: str) -> dict:
        """Grant access based on organizational role."""

        if role not in self.role_mapping:
            raise ValueError(f"Unknown role: {role}")

        permissions = self.role_mapping[role]

        return {
            "user": user_email,
            "role": role,
            "databricks_permissions": permissions["databricks"],
            "fabric_permissions": permissions["fabric"],
            "action": "Grant access in both platforms"
        }

    def audit_access(self, user_email: str) -> dict:
        """Audit user access across platforms."""

        # Query both platforms for user permissions
        return {
            "user": user_email,
            "databricks_access": self._get_databricks_access(user_email),
            "fabric_access": self._get_fabric_access(user_email),
            "storage_access": self._get_storage_access(user_email)
        }

    def _get_databricks_access(self, user_email: str) -> list:
        # Query Databricks SCIM API
        pass

    def _get_fabric_access(self, user_email: str) -> list:
        # Query Fabric API
        pass

    def _get_storage_access(self, user_email: str) -> list:
        # Query Azure RBAC
        pass
```

## Migration Strategies

### Gradual Migration to Fabric

```python
class MigrationPlanner:
    """Plan gradual migration from Databricks to Fabric."""

    def __init__(self):
        self.migration_phases = []

    def add_phase(
        self,
        name: str,
        workloads: list[str],
        timeline_weeks: int
    ):
        self.migration_phases.append({
            "name": name,
            "workloads": workloads,
            "timeline_weeks": timeline_weeks
        })

    def generate_plan(self) -> list:
        """Generate migration plan."""

        return [
            {
                "phase": 1,
                "name": "BI and Reporting",
                "workloads": ["Power BI dashboards", "Ad-hoc SQL"],
                "approach": "Create shortcuts, migrate semantic models",
                "timeline": "4 weeks"
            },
            {
                "phase": 2,
                "name": "Data Warehousing",
                "workloads": ["SQL-based ETL", "Data marts"],
                "approach": "Migrate SQL workloads to Fabric warehouse",
                "timeline": "8 weeks"
            },
            {
                "phase": 3,
                "name": "Batch ETL",
                "workloads": ["Spark jobs", "Data pipelines"],
                "approach": "Migrate non-ML Spark to Fabric notebooks",
                "timeline": "12 weeks"
            },
            {
                "phase": 4,
                "name": "ML Workloads",
                "workloads": ["ML training", "Feature engineering"],
                "approach": "Evaluate: migrate or keep in Databricks",
                "timeline": "Ongoing"
            }
        ]
```

## Best Practices

1. **Use shared storage**: ADLS as the common data layer
2. **Standardize on Delta Lake**: Compatible format for both
3. **Optimize for readers**: Both platforms benefit from compaction
4. **Unified governance**: Single source of truth for access
5. **Right tool for the job**: Use each platform's strengths

## Conclusion

Databricks and Fabric can effectively coexist through their shared Delta Lake foundation. Use Databricks for advanced ML and complex data engineering, and Fabric for BI, semantic modeling, and governed analytics.

The key is establishing clear workload boundaries and maintaining consistent data formats across both platforms.
