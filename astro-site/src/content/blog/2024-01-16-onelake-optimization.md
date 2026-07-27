---
title: "OneLake Optimization: Storage Patterns and Best Practices"
author: Michael John Peña
draft: false
date: 2024-01-16
tags:
  - OneLake
  - Microsoft Fabric
  - Data Lake
  - Storage
  - Architecture
---

OneLake is central to Fabric's promise. My teams reorganised storage layouts and saw query performance improvements — these patterns capture what worked and where trade-offs lie.

## OneLake Architecture

OneLake provides:
- **Single namespace** across all Fabric workloads
- **Delta Lake format** as the default
- **Shortcuts** for virtual access to external data
- **ADLS Gen2 compatible** APIs

## Storage Organization Patterns

### 1. Medallion Architecture

The recommended pattern for data lakes:

```
OneLake
└── Lakehouse: analytics
    ├── Tables/
    │   ├── bronze/
    │   │   ├── raw_sales_data
    │   │   ├── raw_customer_data
    │   │   └── raw_product_data
    │   ├── silver/
    │   │   ├── cleaned_sales
    │   │   ├── cleaned_customers
    │   │   └── cleaned_products
    │   └── gold/
    │       ├── sales_summary
    │       ├── customer_360
    │       └── product_performance
    └── Files/
        ├── landing/
        │   └── {source}/{date}/
        ├── archive/
        │   └── {year}/{month}/
        └── reference/
            └── lookups/
```

### 2. Domain-Based Organization

For large organizations with multiple domains:

```python
# Python notebook for domain-based structure setup

domains = ["sales", "marketing", "finance", "operations"]
layers = ["bronze", "silver", "gold"]

def create_domain_structure(domain: str):
    """Create standardized folder structure for a domain."""

    base_path = f"abfss://analytics@onelake.dfs.fabric.microsoft.com/{domain}"

    # Create layer folders
    for layer in layers:
        table_path = f"{base_path}/Tables/{layer}"
        files_path = f"{base_path}/Files/{layer}"

        # Create directories using mssparkutils
        mssparkutils.fs.mkdirs(table_path)
        mssparkutils.fs.mkdirs(files_path)

        print(f"Created: {table_path}")
        print(f"Created: {files_path}")

# Initialize all domains
for domain in domains:
    create_domain_structure(domain)
```

## Shortcuts Strategy

### 1. External Data Access

```python
# Create shortcut to external ADLS storage
def create_external_shortcut(
    lakehouse_path: str,
    shortcut_name: str,
    external_storage_url: str,
    sas_token: str
):
    """Create shortcut to external Azure storage."""

    import requests

    # Using Fabric REST API
    payload = {
        "path": f"{lakehouse_path}/Files/{shortcut_name}",
        "target": {
            "type": "AzureBlobStorage",
            "url": external_storage_url,
            "credentials": {
                "sasToken": sas_token
            }
        }
    }

    # API call to create shortcut
    response = requests.post(
        "https://api.fabric.microsoft.com/v1/shortcuts",
        json=payload,
        headers={"Authorization": f"Bearer {access_token}"}
    )

    return response.json()

# Example: Link to partner data
create_external_shortcut(
    lakehouse_path="/workspaces/analytics/lakehouses/main",
    shortcut_name="partner_data",
    external_storage_url="https://partnerstorage.blob.core.windows.net/data",
    sas_token="sv=2021-06-08&ss=b&srt=co&sp=rl..."
)
```

### 2. Cross-Workspace Shortcuts

```python
# Create shortcut between Fabric workspaces
def create_internal_shortcut(
    source_workspace: str,
    source_lakehouse: str,
    source_path: str,
    target_workspace: str,
    target_lakehouse: str,
    shortcut_name: str
):
    """Create shortcut between Fabric lakehouses."""

    payload = {
        "path": f"/workspaces/{target_workspace}/lakehouses/{target_lakehouse}/Files/{shortcut_name}",
        "target": {
            "type": "OneLake",
            "workspaceId": source_workspace,
            "itemId": source_lakehouse,
            "path": source_path
        }
    }

    # Create via API
    # This avoids data duplication while enabling access

    return payload

# Example: Share curated data across workspaces
create_internal_shortcut(
    source_workspace="data-engineering",
    source_lakehouse="curated",
    source_path="Tables/gold",
    target_workspace="data-science",
    target_lakehouse="ml-workspace",
    shortcut_name="curated_data"
)
```

## File Format Optimization

### 1. Delta Table Settings

```python
# Optimal Delta table configuration
def create_optimized_delta_table(
    df,
    table_name: str,
    partition_cols: list = None,
    z_order_cols: list = None
):
    """Create a Delta table with optimal settings."""

    writer = df.write.format("delta")

    # Enable optimized writes
    writer = writer.option("delta.autoOptimize.optimizeWrite", "true")
    writer = writer.option("delta.autoOptimize.autoCompact", "true")

    # Set target file size (128MB is good for most cases)
    writer = writer.option("delta.targetFileSize", "134217728")

    # Enable deletion vectors for faster updates
    writer = writer.option("delta.enableDeletionVectors", "true")

    # Partitioning
    if partition_cols:
        writer = writer.partitionBy(*partition_cols)

    # Save table
    writer.mode("overwrite").saveAsTable(table_name)

    # Apply Z-ordering if specified
    if z_order_cols:
        from delta.tables import DeltaTable
        delta_table = DeltaTable.forName(spark, table_name)
        delta_table.optimize().executeZOrderBy(z_order_cols)

    print(f"Created optimized table: {table_name}")

# Usage
create_optimized_delta_table(
    df=sales_df,
    table_name="gold_sales",
    partition_cols=["year", "month"],
    z_order_cols=["customer_id", "product_id"]
)
```

### 2. Parquet for Raw Files

```python
# Optimize Parquet file writes
def write_optimized_parquet(
    df,
    output_path: str,
    compression: str = "snappy",
    row_group_size: int = 128 * 1024 * 1024  # 128MB
):
    """Write Parquet files with optimal settings."""

    df.write \
        .option("compression", compression) \
        .option("parquet.block.size", row_group_size) \
        .mode("overwrite") \
        .parquet(output_path)

    # Verify output
    files = mssparkutils.fs.ls(output_path)
    print(f"Written {len(files)} files to {output_path}")

    # Check file sizes
    for f in files[:5]:
        print(f"  {f.name}: {f.size / 1024 / 1024:.2f} MB")
```

## Access Patterns

### 1. Direct OneLake Access

```python
# Access patterns for different scenarios

# Pattern 1: Spark (notebooks)
df = spark.read.format("delta").load("Tables/silver_sales")

# Pattern 2: Pandas via fsspec
import pandas as pd

# Install: pip install fsspec adlfs
storage_options = {
    "account_name": "onelake",
    "account_host": "onelake.dfs.fabric.microsoft.com"
}

df_pandas = pd.read_parquet(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse/Files/data.parquet",
    storage_options=storage_options
)

# Pattern 3: REST API
import requests

def read_onelake_file(workspace: str, lakehouse: str, path: str, token: str):
    """Read file from OneLake via REST API."""

    url = f"https://onelake.dfs.fabric.microsoft.com/{workspace}/{lakehouse}/Files/{path}"

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"}
    )

    return response.content
```

### 2. Caching Strategy

```python
# Implement caching for frequently accessed data

class OneLakeCache:
    def __init__(self, cache_path: str = "/tmp/onelake_cache"):
        self.cache_path = cache_path
        self.cache_index = {}

    def get_or_load(
        self,
        table_path: str,
        cache_ttl_hours: int = 1
    ):
        """Get from cache or load from OneLake."""

        import os
        from datetime import datetime, timedelta

        cache_key = table_path.replace("/", "_")
        cache_file = f"{self.cache_path}/{cache_key}"

        # Check if cached and fresh
        if cache_key in self.cache_index:
            cached_time = self.cache_index[cache_key]
            if datetime.utcnow() - cached_time < timedelta(hours=cache_ttl_hours):
                print(f"Cache hit: {table_path}")
                return spark.read.parquet(cache_file)

        # Load from OneLake
        print(f"Cache miss: {table_path}")
        df = spark.read.format("delta").load(table_path)

        # Cache locally
        df.write.mode("overwrite").parquet(cache_file)
        self.cache_index[cache_key] = datetime.utcnow()

        return df

# Usage
cache = OneLakeCache()
df = cache.get_or_load("Tables/gold_sales")
```

## Governance and Security

### 1. Access Control

```python
# OneLake inherits Fabric workspace permissions
# Additional granular control via:

# 1. Row-level security in semantic models
# 2. Column-level security via views
# 3. Object-level permissions on tables

def create_secure_view(
    source_table: str,
    view_name: str,
    allowed_columns: list,
    row_filter: str = None
):
    """Create a secure view with column/row restrictions."""

    columns_sql = ", ".join(allowed_columns)

    view_sql = f"""
    CREATE OR REPLACE VIEW {view_name} AS
    SELECT {columns_sql}
    FROM {source_table}
    """

    if row_filter:
        view_sql += f" WHERE {row_filter}"

    spark.sql(view_sql)
    print(f"Created secure view: {view_name}")

# Example: Create view hiding PII
create_secure_view(
    source_table="silver_customers",
    view_name="customers_no_pii",
    allowed_columns=["customer_id", "segment", "region", "signup_date"],
    row_filter="is_active = true"
)
```

### 2. Data Lineage

```python
# Track data lineage in OneLake

def log_data_lineage(
    source_tables: list,
    target_table: str,
    operation: str,
    row_count: int
):
    """Log data lineage for audit trail."""

    lineage_record = {
        "timestamp": datetime.utcnow().isoformat(),
        "source_tables": source_tables,
        "target_table": target_table,
        "operation": operation,
        "row_count": row_count,
        "user": spark.sparkContext.sparkUser(),
        "notebook": mssparkutils.runtime.context.get("notebookPath", "unknown")
    }

    # Append to lineage log
    lineage_df = spark.createDataFrame([lineage_record])
    lineage_df.write \
        .format("delta") \
        .mode("append") \
        .saveAsTable("_metadata.data_lineage")

# Usage
log_data_lineage(
    source_tables=["bronze_sales", "silver_customers"],
    target_table="gold_customer_sales",
    operation="JOIN_AGGREGATE",
    row_count=result_df.count()
)
```

## Monitoring and Maintenance

```python
# OneLake storage monitoring

def analyze_storage_usage(lakehouse_path: str):
    """Analyze storage usage in a lakehouse."""

    tables_path = f"{lakehouse_path}/Tables"
    files_path = f"{lakehouse_path}/Files"

    results = {
        "tables": [],
        "files": []
    }

    # Analyze Delta tables
    for table_dir in mssparkutils.fs.ls(tables_path):
        if table_dir.isDir:
            table_files = mssparkutils.fs.ls(f"{tables_path}/{table_dir.name}")
            total_size = sum(f.size for f in table_files if not f.isDir)

            results["tables"].append({
                "name": table_dir.name,
                "size_mb": total_size / 1024 / 1024,
                "file_count": len([f for f in table_files if not f.isDir])
            })

    # Analyze files
    for file_dir in mssparkutils.fs.ls(files_path):
        if file_dir.isDir:
            dir_files = mssparkutils.fs.ls(f"{files_path}/{file_dir.name}")
            total_size = sum(f.size for f in dir_files if not f.isDir)

            results["files"].append({
                "name": file_dir.name,
                "size_mb": total_size / 1024 / 1024,
                "file_count": len([f for f in dir_files if not f.isDir])
            })

    return results

# Generate report
usage = analyze_storage_usage("abfss://analytics@onelake.dfs.fabric.microsoft.com/main")

print("=== Tables ===")
for t in sorted(usage["tables"], key=lambda x: x["size_mb"], reverse=True):
    print(f"{t['name']}: {t['size_mb']:.2f} MB ({t['file_count']} files)")
```

## Conclusion

OneLake optimization requires:

1. **Thoughtful organization** - Medallion architecture or domain-based
2. **Strategic shortcuts** - Virtual access without duplication
3. **Optimal file formats** - Delta with proper settings
4. **Efficient access patterns** - Caching and proper APIs
5. **Strong governance** - Security and lineage tracking

Treat OneLake as your single source of truth and design around that principle. The unified storage model is powerful when properly architected.
