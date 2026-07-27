---
title: "Cross-Cloud Analytics with Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-11
tags:
  - Microsoft Fabric
  - Cross-Cloud
  - Multi-Cloud
  - Analytics
  - Data Architecture

---

I wrote "Cross-Cloud Analytics with Microsoft Fabric" to share practical, production-minded guidance on this topic.

## The Multi-Cloud Reality

Most enterprises use multiple clouds:

```
┌─────────────────────────────────────────────────────────────┐
│                    Enterprise Data Estate                    │
├─────────────────┬─────────────────┬─────────────────────────┤
│     Azure       │      AWS        │         GCP             │
│  ┌───────────┐  │  ┌───────────┐  │  ┌───────────────────┐  │
│  │ ADLS Gen2 │  │  │    S3     │  │  │  Cloud Storage    │  │
│  │ Cosmos DB │  │  │  Redshift │  │  │    BigQuery       │  │
│  │ Azure SQL │  │  │    RDS    │  │  │    Spanner        │  │
│  └───────────┘  │  └───────────┘  │  └───────────────────┘  │
└─────────────────┴─────────────────┴─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │    Microsoft Fabric     │
              │       OneLake           │
              │   (Unified Analytics)   │
              └─────────────────────────┘
```

## Setting Up Cross-Cloud Connections

### AWS S3 Connection

```python
from azure.identity import DefaultAzureCredential
import requests

class CrossCloudConnector:
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

    def create_s3_connection(
        self,
        connection_name: str,
        aws_access_key_id: str,
        aws_secret_access_key: str,
        region: str = "us-east-1"
    ) -> dict:
        """Create connection to AWS S3."""

        payload = {
            "displayName": connection_name,
            "connectionDetails": {
                "type": "AmazonS3",
                "parameters": {
                    "region": region
                }
            },
            "credentialDetails": {
                "credentials": {
                    "credentialType": "Key",
                    "accessKeyId": aws_access_key_id,
                    "secretAccessKey": aws_secret_access_key
                }
            }
        }

        response = requests.post(
            f"{self.base_url}/connections",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

    def create_gcs_connection(
        self,
        connection_name: str,
        service_account_key: dict
    ) -> dict:
        """Create connection to Google Cloud Storage."""

        import base64
        import json

        payload = {
            "displayName": connection_name,
            "connectionDetails": {
                "type": "GoogleCloudStorage",
                "parameters": {}
            },
            "credentialDetails": {
                "credentials": {
                    "credentialType": "ServiceAccountKey",
                    "key": base64.b64encode(
                        json.dumps(service_account_key).encode()
                    ).decode()
                }
            }
        }

        response = requests.post(
            f"{self.base_url}/connections",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

# Usage
connector = CrossCloudConnector("workspace-id")

# AWS connection
aws_conn = connector.create_s3_connection(
    connection_name="AWS-DataLake",
    aws_access_key_id="AKIA...",
    aws_secret_access_key="secret...",
    region="us-west-2"
)

# GCP connection
gcp_conn = connector.create_gcs_connection(
    connection_name="GCP-DataLake",
    service_account_key={
        "type": "service_account",
        "project_id": "my-project",
        # ... rest of service account JSON
    }
)
```

### Creating Cross-Cloud Shortcuts

```python
class CrossCloudLakehouse:
    def __init__(self, workspace_id: str, lakehouse_id: str):
        self.workspace_id = workspace_id
        self.lakehouse_id = lakehouse_id
        self.shortcuts = []

    def add_azure_shortcut(
        self,
        name: str,
        storage_account: str,
        container: str,
        path: str
    ):
        """Add shortcut to Azure Data Lake Storage."""

        shortcut = {
            "path": f"Tables/{name}",
            "target": {
                "type": "AdlsGen2",
                "adlsGen2": {
                    "location": f"https://{storage_account}.dfs.core.windows.net",
                    "subpath": f"/{container}/{path}"
                }
            }
        }

        self._create_shortcut(shortcut)
        self.shortcuts.append({"name": name, "cloud": "Azure"})

    def add_aws_shortcut(
        self,
        name: str,
        bucket: str,
        path: str,
        connection_id: str
    ):
        """Add shortcut to AWS S3."""

        shortcut = {
            "path": f"Tables/{name}",
            "target": {
                "type": "S3",
                "s3": {
                    "location": f"https://{bucket}.s3.amazonaws.com",
                    "subpath": f"/{path}",
                    "connectionId": connection_id
                }
            }
        }

        self._create_shortcut(shortcut)
        self.shortcuts.append({"name": name, "cloud": "AWS"})

    def add_gcp_shortcut(
        self,
        name: str,
        bucket: str,
        path: str,
        connection_id: str
    ):
        """Add shortcut to Google Cloud Storage."""

        shortcut = {
            "path": f"Tables/{name}",
            "target": {
                "type": "GoogleCloudStorage",
                "googleCloudStorage": {
                    "location": f"https://storage.googleapis.com/{bucket}",
                    "subpath": f"/{path}",
                    "connectionId": connection_id
                }
            }
        }

        self._create_shortcut(shortcut)
        self.shortcuts.append({"name": name, "cloud": "GCP"})

    def _create_shortcut(self, shortcut: dict):
        # API call to create shortcut
        pass

    def list_shortcuts(self) -> list:
        """List all cross-cloud shortcuts."""
        return self.shortcuts

# Build cross-cloud lakehouse
lakehouse = CrossCloudLakehouse("workspace-id", "lakehouse-id")

# Azure data
lakehouse.add_azure_shortcut(
    name="azure_customers",
    storage_account="azuredatalake",
    container="gold",
    path="customers"
)

# AWS data
lakehouse.add_aws_shortcut(
    name="aws_transactions",
    bucket="company-data-lake",
    path="transactions/parquet",
    connection_id="aws-connection-id"
)

# GCP data
lakehouse.add_gcp_shortcut(
    name="gcp_analytics",
    bucket="analytics-bucket",
    path="processed/events",
    connection_id="gcp-connection-id"
)
```

## Querying Across Clouds

### Unified SQL Queries

```sql
-- Query data from three different clouds in one statement
SELECT
    c.customer_id,
    c.customer_name,
    c.region AS customer_region,
    COUNT(t.transaction_id) AS transaction_count,
    SUM(t.amount) AS total_spend,
    AVG(a.session_duration) AS avg_session_minutes
FROM azure_customers c                      -- Azure ADLS
LEFT JOIN aws_transactions t                -- AWS S3
    ON c.customer_id = t.customer_id
    AND t.transaction_date >= '2024-01-01'
LEFT JOIN gcp_analytics a                   -- GCP Cloud Storage
    ON c.customer_id = a.user_id
    AND a.event_date >= '2024-01-01'
GROUP BY c.customer_id, c.customer_name, c.region
ORDER BY total_spend DESC;
```

### Spark Cross-Cloud Analytics

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import *

# All data accessible through OneLake paths
azure_customers = spark.read.format("delta").load("Tables/azure_customers")
aws_transactions = spark.read.format("delta").load("Tables/aws_transactions")
gcp_analytics = spark.read.format("delta").load("Tables/gcp_analytics")

# Cross-cloud customer 360 view
customer_360 = azure_customers.alias("c") \
    .join(
        aws_transactions.alias("t"),
        col("c.customer_id") == col("t.customer_id"),
        "left"
    ) \
    .join(
        gcp_analytics.alias("a"),
        col("c.customer_id") == col("a.user_id"),
        "left"
    ) \
    .groupBy(
        col("c.customer_id"),
        col("c.customer_name"),
        col("c.segment"),
        col("c.region")
    ) \
    .agg(
        # Transaction metrics (AWS)
        count("t.transaction_id").alias("transaction_count"),
        sum("t.amount").alias("total_spend"),
        max("t.transaction_date").alias("last_transaction"),

        # Engagement metrics (GCP)
        countDistinct("a.session_id").alias("total_sessions"),
        avg("a.session_duration").alias("avg_session_duration"),
        sum("a.page_views").alias("total_page_views")
    )

# Save consolidated view locally in Fabric
customer_360.write.format("delta") \
    .mode("overwrite") \
    .saveAsTable("customer_360_view")
```

## Cross-Cloud Data Patterns

### Pattern 1: Cloud-Specific Workloads

```python
class CloudWorkloadRouter:
    """Route analytics workloads to optimal cloud."""

    def __init__(self):
        self.workload_mapping = {
            "ml_training": "aws",      # Use SageMaker
            "streaming": "gcp",         # Use Dataflow
            "bi_reporting": "azure",    # Use Power BI
            "data_warehouse": "azure"   # Use Fabric
        }

    def get_data_for_workload(
        self,
        workload_type: str,
        required_tables: list[str]
    ) -> dict:
        """Prepare data for cloud-specific workload."""

        target_cloud = self.workload_mapping.get(workload_type, "azure")

        if target_cloud == "azure":
            # Data already in Fabric, use directly
            return {
                "location": "fabric",
                "tables": required_tables,
                "action": "query_in_place"
            }
        else:
            # Need to export data to target cloud
            return {
                "location": target_cloud,
                "tables": required_tables,
                "action": "export_required",
                "export_format": "delta"
            }

    def export_to_cloud(
        self,
        tables: list[str],
        target_cloud: str,
        target_path: str
    ):
        """Export data to another cloud for processing."""

        for table in tables:
            df = spark.read.format("delta").table(table)

            if target_cloud == "aws":
                df.write.format("delta") \
                    .mode("overwrite") \
                    .save(f"s3a://{target_path}/{table}")

            elif target_cloud == "gcp":
                df.write.format("delta") \
                    .mode("overwrite") \
                    .save(f"gs://{target_path}/{table}")
```

### Pattern 2: Follow-the-Sun Processing

```python
class FollowTheSunProcessor:
    """Process data in the region where it's daytime."""

    def __init__(self):
        self.regional_config = {
            "americas": {
                "cloud": "aws",
                "region": "us-east-1",
                "active_hours": (9, 17),  # EST
                "timezone": "America/New_York"
            },
            "europe": {
                "cloud": "azure",
                "region": "westeurope",
                "active_hours": (9, 17),  # CET
                "timezone": "Europe/Paris"
            },
            "asia": {
                "cloud": "gcp",
                "region": "asia-east1",
                "active_hours": (9, 17),  # JST
                "timezone": "Asia/Tokyo"
            }
        }

    def get_active_region(self) -> str:
        """Determine which region is currently in business hours."""

        from datetime import datetime
        import pytz

        for region, config in self.regional_config.items():
            tz = pytz.timezone(config["timezone"])
            local_time = datetime.now(tz)

            if config["active_hours"][0] <= local_time.hour < config["active_hours"][1]:
                return region

        return "americas"  # Default

    def route_query(self, query: str) -> dict:
        """Route query to active regional processing."""

        active_region = self.get_active_region()
        config = self.regional_config[active_region]

        return {
            "region": active_region,
            "cloud": config["cloud"],
            "execute_in": config["region"],
            "query": query
        }
```

## Cost Optimization

### Cross-Cloud Data Transfer Costs

```python
class CrossCloudCostOptimizer:
    """Optimize costs for cross-cloud analytics."""

    def __init__(self):
        # Approximate egress costs per GB
        self.egress_costs = {
            "azure": 0.087,  # Azure to internet
            "aws": 0.09,     # AWS to internet
            "gcp": 0.12      # GCP to internet
        }

        # Inter-cloud costs are higher
        self.inter_cloud_costs = {
            ("azure", "aws"): 0.02,
            ("azure", "gcp"): 0.02,
            ("aws", "azure"): 0.02,
            ("aws", "gcp"): 0.02,
            ("gcp", "azure"): 0.02,
            ("gcp", "aws"): 0.02
        }

    def estimate_query_cost(
        self,
        tables_accessed: list[dict],
        destination_cloud: str
    ) -> dict:
        """Estimate data transfer cost for a cross-cloud query."""

        total_cost = 0.0
        transfer_details = []

        for table in tables_accessed:
            source_cloud = table["cloud"]
            estimated_size_gb = table["estimated_size_gb"]

            if source_cloud != destination_cloud:
                cost_per_gb = self.inter_cloud_costs.get(
                    (source_cloud, destination_cloud),
                    0.02
                )
                transfer_cost = estimated_size_gb * cost_per_gb
                total_cost += transfer_cost

                transfer_details.append({
                    "table": table["name"],
                    "from": source_cloud,
                    "to": destination_cloud,
                    "size_gb": estimated_size_gb,
                    "cost": transfer_cost
                })

        return {
            "total_estimated_cost": total_cost,
            "transfers": transfer_details,
            "recommendation": self._get_recommendation(transfer_details)
        }

    def _get_recommendation(self, transfers: list) -> str:
        """Provide cost optimization recommendation."""

        if not transfers:
            return "Query is local, no optimization needed"

        total_size = sum(t["size_gb"] for t in transfers)

        if total_size > 100:
            return "Consider materializing frequently joined data locally"
        elif total_size > 10:
            return "Consider caching query results"
        else:
            return "Transfer cost is minimal"

# Usage
optimizer = CrossCloudCostOptimizer()

cost_estimate = optimizer.estimate_query_cost(
    tables_accessed=[
        {"name": "azure_customers", "cloud": "azure", "estimated_size_gb": 5},
        {"name": "aws_transactions", "cloud": "aws", "estimated_size_gb": 50},
        {"name": "gcp_analytics", "cloud": "gcp", "estimated_size_gb": 20}
    ],
    destination_cloud="azure"
)

print(f"Estimated cost: ${cost_estimate['total_estimated_cost']:.2f}")
print(f"Recommendation: {cost_estimate['recommendation']}")
```

### Materialization Strategy

```python
def optimize_cross_cloud_joins(
    query_history: list[dict],
    materialization_threshold_gb: float = 10
) -> list[dict]:
    """Identify cross-cloud joins that should be materialized."""

    join_patterns = {}

    for query in query_history:
        tables = query.get("tables_joined", [])
        if len(tables) > 1:
            key = tuple(sorted(tables))
            if key not in join_patterns:
                join_patterns[key] = {
                    "tables": tables,
                    "count": 0,
                    "total_data_transferred_gb": 0
                }
            join_patterns[key]["count"] += 1
            join_patterns[key]["total_data_transferred_gb"] += query.get(
                "data_transferred_gb", 0
            )

    recommendations = []
    for pattern, stats in join_patterns.items():
        if stats["total_data_transferred_gb"] > materialization_threshold_gb:
            recommendations.append({
                "tables": stats["tables"],
                "query_count": stats["count"],
                "total_transfer_gb": stats["total_data_transferred_gb"],
                "action": "Create materialized view in Fabric",
                "estimated_savings": f"${stats['total_data_transferred_gb'] * 0.02:.2f}/month"
            })

    return recommendations
```

## Best Practices

1. **Minimize cross-cloud joins**: Materialize frequently joined data
2. **Use shortcuts wisely**: Only for data that changes frequently
3. **Consider latency**: Cross-cloud queries have higher latency
4. **Monitor egress costs**: Data transfer can be expensive
5. **Cache hot data locally**: Keep frequently accessed data in Fabric

## Conclusion

Cross-cloud analytics in Microsoft Fabric enables true multi-cloud data strategies. Use OneLake shortcuts to create a unified view of your data estate, but be mindful of data transfer costs and latency.

Start with read-only analytics across clouds, then materialize high-value, frequently accessed data locally for optimal performance and cost.

