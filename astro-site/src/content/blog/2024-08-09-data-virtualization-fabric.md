---
title: "Data Virtualization in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-09
tags:
  - Microsoft Fabric
  - Data Virtualization
  - Shortcuts
  - OneLake
  - Federation
---

## What is Data Virtualization?

Traditional ETL moves data physically:
```
Source → Extract → Transform → Load → Query
```

Virtualization queries in place:
```
Source ←── Virtual Layer ←── Query
```

## OneLake Shortcuts

Shortcuts create virtual pointers to external data:

```python
from azure.identity import DefaultAzureCredential
import requests

class ShortcutManager:
    def __init__(self, workspace_id: str, lakehouse_id: str):
        self.workspace_id = workspace_id
        self.lakehouse_id = lakehouse_id
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_headers(self):
        credential = DefaultAzureCredential()
        token = credential.get_token("https://api.fabric.microsoft.com/.default")
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def create_adls_shortcut(
        self,
        shortcut_name: str,
        storage_account: str,
        container: str,
        path: str,
        target_path: str = "Tables"
    ) -> dict:
        """Create shortcut to Azure Data Lake Storage."""

        payload = {
            "path": f"{target_path}/{shortcut_name}",
            "target": {
                "type": "AdlsGen2",
                "adlsGen2": {
                    "location": f"https://{storage_account}.dfs.core.windows.net",
                    "subpath": f"/{container}/{path}"
                }
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/lakehouses/{self.lakehouse_id}/shortcuts",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

    def create_s3_shortcut(
        self,
        shortcut_name: str,
        bucket: str,
        path: str,
        connection_id: str,
        target_path: str = "Tables"
    ) -> dict:
        """Create shortcut to Amazon S3."""

        payload = {
            "path": f"{target_path}/{shortcut_name}",
            "target": {
                "type": "S3",
                "s3": {
                    "location": f"https://{bucket}.s3.amazonaws.com",
                    "subpath": f"/{path}",
                    "connectionId": connection_id
                }
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/lakehouses/{self.lakehouse_id}/shortcuts",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

    def create_gcs_shortcut(
        self,
        shortcut_name: str,
        bucket: str,
        path: str,
        connection_id: str,
        target_path: str = "Tables"
    ) -> dict:
        """Create shortcut to Google Cloud Storage."""

        payload = {
            "path": f"{target_path}/{shortcut_name}",
            "target": {
                "type": "GoogleCloudStorage",
                "googleCloudStorage": {
                    "location": f"https://storage.googleapis.com/{bucket}",
                    "subpath": f"/{path}",
                    "connectionId": connection_id
                }
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/lakehouses/{self.lakehouse_id}/shortcuts",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

    def create_onelake_shortcut(
        self,
        shortcut_name: str,
        source_workspace_id: str,
        source_item_id: str,
        source_path: str,
        target_path: str = "Tables"
    ) -> dict:
        """Create shortcut to another OneLake location."""

        payload = {
            "path": f"{target_path}/{shortcut_name}",
            "target": {
                "type": "OneLake",
                "oneLake": {
                    "workspaceId": source_workspace_id,
                    "itemId": source_item_id,
                    "path": source_path
                }
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/lakehouses/{self.lakehouse_id}/shortcuts",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

# Usage
manager = ShortcutManager("workspace-id", "lakehouse-id")

# ADLS shortcut
manager.create_adls_shortcut(
    shortcut_name="external_sales",
    storage_account="mystorage",
    container="data",
    path="sales/parquet"
)

# S3 shortcut (requires connection)
manager.create_s3_shortcut(
    shortcut_name="aws_data",
    bucket="my-data-bucket",
    path="analytics/",
    connection_id="s3-connection-id"
)
```

## Querying Virtualized Data

### Via SQL Endpoint

```sql
-- Shortcuts appear as regular tables
SELECT
    s.product_id,
    s.quantity,
    s.sale_date,
    p.product_name,
    p.category
FROM external_sales s  -- Shortcut to ADLS
JOIN products p ON s.product_id = p.product_id  -- Local table
WHERE s.sale_date >= '2024-01-01';
```

### Via Spark

```python
# Shortcuts are accessible via standard paths
external_sales = spark.read.format("delta").load(
    "Tables/external_sales"  # Shortcut to external data
)

local_products = spark.read.format("delta").table("products")

# Join across sources
combined = external_sales.join(
    local_products,
    external_sales.product_id == local_products.product_id
)

display(combined)
```

## Cross-Cloud Data Federation

```python
class CrossCloudFederation:
    """Federate data across multiple clouds."""

    def __init__(self, lakehouse_manager: ShortcutManager):
        self.manager = lakehouse_manager

    def setup_multi_cloud_lakehouse(self):
        """Create shortcuts to multiple cloud sources."""

        # Azure source
        self.manager.create_adls_shortcut(
            shortcut_name="azure_transactions",
            storage_account="azurestorage",
            container="datalake",
            path="transactions"
        )

        # AWS source
        self.manager.create_s3_shortcut(
            shortcut_name="aws_customer_data",
            bucket="customer-data-lake",
            path="customers/",
            connection_id="aws-connection"
        )

        # GCP source
        self.manager.create_gcs_shortcut(
            shortcut_name="gcp_analytics",
            bucket="analytics-bucket",
            path="processed/",
            connection_id="gcp-connection"
        )

        print("Multi-cloud lakehouse configured")

    def query_federated_data(self):
        """Query across all cloud sources."""

        query = """
        SELECT
            t.transaction_id,
            t.amount,
            c.customer_name,
            c.region,
            a.segment
        FROM azure_transactions t
        JOIN aws_customer_data c ON t.customer_id = c.customer_id
        JOIN gcp_analytics a ON c.customer_id = a.customer_id
        WHERE t.transaction_date >= '2024-01-01'
        """

        return spark.sql(query)
```

## Performance Optimization

### Caching Strategy

```python
class VirtualizationOptimizer:
    def analyze_query_patterns(self, query_history: list[dict]) -> dict:
        """Analyze which virtual data is accessed frequently."""

        access_counts = {}
        for query in query_history:
            for table in query.get("tables_accessed", []):
                if table.startswith("shortcut_"):
                    access_counts[table] = access_counts.get(table, 0) + 1

        return {
            "frequent_shortcuts": sorted(
                access_counts.items(),
                key=lambda x: x[1],
                reverse=True
            )[:10],
            "recommendation": self._recommend_materialization(access_counts)
        }

    def _recommend_materialization(self, access_counts: dict) -> list[str]:
        """Recommend which shortcuts should be materialized."""

        recommendations = []
        for table, count in access_counts.items():
            if count > 100:  # Threshold
                recommendations.append(
                    f"Consider materializing {table} - accessed {count} times"
                )
        return recommendations

    def create_cached_view(
        self,
        shortcut_name: str,
        cache_table_name: str,
        partition_columns: list[str] = None
    ):
        """Create cached copy of frequently accessed virtual data."""

        source_df = spark.read.format("delta").load(f"Tables/{shortcut_name}")

        writer = source_df.write.format("delta").mode("overwrite")

        if partition_columns:
            writer = writer.partitionBy(*partition_columns)

        writer.saveAsTable(cache_table_name)

        # Create view that falls back to cache
        spark.sql(f"""
            CREATE OR REPLACE VIEW {shortcut_name}_optimized AS
            SELECT * FROM {cache_table_name}
        """)
```

### Predicate Pushdown

```python
# Enable predicate pushdown for better performance
spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")
spark.conf.set("spark.sql.parquet.filterPushdown", "true")
spark.conf.set("spark.sql.parquet.recordLevelFilter.enabled", "true")

# Query with pushdown-friendly predicates
efficient_query = """
SELECT *
FROM external_sales
WHERE sale_date = '2024-08-09'  -- Partition column
AND region = 'US'               -- Filter pushed to source
"""
```

## Security Considerations

```python
# Shortcuts inherit security from connection
security_model = {
    "authentication": {
        "adls": "Managed Identity or Service Principal",
        "s3": "IAM Role via Cross-Account",
        "gcs": "Service Account Key"
    },
    "authorization": {
        "workspace_access": "Controls who can see shortcuts",
        "data_access": "Controlled at source level",
        "row_level": "Apply in views or Direct Lake"
    },
    "encryption": {
        "in_transit": "TLS 1.2+",
        "at_rest": "Source-dependent (SSE, CMK)"
    }
}
```

## Best Practices

1. **Use for read-heavy workloads**: Virtualization adds latency
2. **Materialize hot data**: Cache frequently accessed shortcuts
3. **Design partitions wisely**: Enable effective predicate pushdown
4. **Monitor cross-cloud costs**: Data transfer can be expensive
5. **Test query performance**: Compare virtualized vs materialized

## Conclusion

Data virtualization through shortcuts enables flexible, multi-cloud analytics without massive data movement. Use it to federate data across your cloud estate while maintaining a unified query interface.

Start with shortcuts for exploratory work, then materialize frequently accessed data for production workloads.
