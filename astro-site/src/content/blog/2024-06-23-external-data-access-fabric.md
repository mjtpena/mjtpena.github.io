---
title: "External Data Access Patterns in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-23
tags:
  - Microsoft Fabric
  - External Data
  - OneLake
  - Data Integration
  - Multi-Cloud
---

Accessing external data is essential for hybrid and multi-cloud scenarios. Today I'm exploring external data access patterns in Microsoft Fabric.

## External Data Options

```
External Data Access:
├── OneLake Shortcuts
│   ├── Azure Data Lake Storage Gen2
│   ├── Amazon S3
│   ├── Google Cloud Storage
│   └── Dataverse
├── Data Pipelines (Copy)
├── Dataflows Gen2
├── Spark External Tables
└── Mirroring (Preview)
```

## ADLS Gen2 Shortcuts

```python
class ADLSShortcutManager:
    """Manage shortcuts to Azure Data Lake Storage."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def create_adls_shortcut(
        self,
        workspace_id: str,
        lakehouse_id: str,
        shortcut_name: str,
        storage_account: str,
        container: str,
        path: str = "",
        auth_type: str = "organizational"
    ):
        """Create shortcut to ADLS Gen2."""
        shortcut_config = {
            "name": shortcut_name,
            "target": {
                "type": "AzureDataLakeStorageGen2",
                "url": f"https://{storage_account}.dfs.core.windows.net/{container}",
                "subpath": path
            }
        }

        if auth_type == "organizational":
            # Uses Entra ID authentication
            shortcut_config["target"]["authentication"] = {
                "type": "OrganizationalAccount"
            }
        elif auth_type == "service_principal":
            shortcut_config["target"]["authentication"] = {
                "type": "ServicePrincipal",
                "connectionId": self._get_connection_id(storage_account)
            }

        return self.client.shortcuts.create(
            workspace_id=workspace_id,
            item_id=lakehouse_id,
            shortcut=shortcut_config
        )

    def create_hierarchical_shortcuts(
        self,
        workspace_id: str,
        lakehouse_id: str,
        storage_account: str,
        container: str,
        partitions: list
    ):
        """Create shortcuts for partitioned data."""
        shortcuts = []

        for partition in partitions:
            shortcut = self.create_adls_shortcut(
                workspace_id=workspace_id,
                lakehouse_id=lakehouse_id,
                shortcut_name=f"data_{partition['name']}",
                storage_account=storage_account,
                container=container,
                path=partition['path']
            )
            shortcuts.append(shortcut)

        return shortcuts

# Usage
adls_manager = ADLSShortcutManager(fabric_client)

# Create shortcut to external data lake
adls_manager.create_adls_shortcut(
    workspace_id="ws-analytics",
    lakehouse_id="lh-central",
    shortcut_name="external_sales_data",
    storage_account="companydatalake",
    container="sales",
    path="processed/2024"
)

# Create shortcuts for regional partitions
adls_manager.create_hierarchical_shortcuts(
    workspace_id="ws-analytics",
    lakehouse_id="lh-central",
    storage_account="companydatalake",
    container="sales",
    partitions=[
        {"name": "north_america", "path": "regions/na"},
        {"name": "europe", "path": "regions/eu"},
        {"name": "asia_pacific", "path": "regions/apac"}
    ]
)
```

## Amazon S3 Integration

```python
class S3ShortcutManager:
    """Manage shortcuts to Amazon S3."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def create_s3_connection(
        self,
        name: str,
        access_key_id: str,
        secret_access_key: str,
        region: str = "us-east-1"
    ):
        """Create connection to S3."""
        return self.client.connections.create(
            name=name,
            connection_type="AmazonS3",
            credentials={
                "credentialType": "Key",
                "accessKeyId": access_key_id,
                "secretAccessKey": secret_access_key
            },
            properties={
                "region": region
            }
        )

    def create_s3_shortcut(
        self,
        workspace_id: str,
        lakehouse_id: str,
        shortcut_name: str,
        bucket: str,
        path: str,
        connection_id: str
    ):
        """Create shortcut to S3 bucket."""
        return self.client.shortcuts.create(
            workspace_id=workspace_id,
            item_id=lakehouse_id,
            shortcut={
                "name": shortcut_name,
                "target": {
                    "type": "AmazonS3",
                    "location": f"s3://{bucket}/{path}",
                    "connectionId": connection_id
                }
            }
        )

    def sync_s3_catalog(
        self,
        workspace_id: str,
        lakehouse_id: str,
        bucket: str,
        connection_id: str,
        prefix: str = ""
    ):
        """Create shortcuts for all top-level folders in S3."""
        # List S3 folders
        s3_client = self._get_s3_client(connection_id)
        folders = self._list_folders(s3_client, bucket, prefix)

        shortcuts = []
        for folder in folders:
            shortcut = self.create_s3_shortcut(
                workspace_id=workspace_id,
                lakehouse_id=lakehouse_id,
                shortcut_name=f"s3_{folder['name']}",
                bucket=bucket,
                path=folder['path'],
                connection_id=connection_id
            )
            shortcuts.append(shortcut)

        return shortcuts

# Usage
s3_manager = S3ShortcutManager(fabric_client)

# Create connection
connection = s3_manager.create_s3_connection(
    name="aws-analytics-bucket",
    access_key_id="AKIAIOSFODNN7EXAMPLE",
    secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region="us-west-2"
)

# Create shortcut
s3_manager.create_s3_shortcut(
    workspace_id="ws-analytics",
    lakehouse_id="lh-central",
    shortcut_name="aws_clickstream",
    bucket="company-clickstream-data",
    path="processed/2024",
    connection_id=connection.id
)
```

## Google Cloud Storage

```python
class GCSShortcutManager:
    """Manage shortcuts to Google Cloud Storage."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def create_gcs_connection(
        self,
        name: str,
        service_account_key: dict
    ):
        """Create connection to GCS."""
        return self.client.connections.create(
            name=name,
            connection_type="GoogleCloudStorage",
            credentials={
                "credentialType": "ServiceAccountKey",
                "serviceAccountKey": json.dumps(service_account_key)
            }
        )

    def create_gcs_shortcut(
        self,
        workspace_id: str,
        lakehouse_id: str,
        shortcut_name: str,
        bucket: str,
        path: str,
        connection_id: str
    ):
        """Create shortcut to GCS bucket."""
        return self.client.shortcuts.create(
            workspace_id=workspace_id,
            item_id=lakehouse_id,
            shortcut={
                "name": shortcut_name,
                "target": {
                    "type": "GoogleCloudStorage",
                    "location": f"gs://{bucket}/{path}",
                    "connectionId": connection_id
                }
            }
        )

# Usage
gcs_manager = GCSShortcutManager(fabric_client)

# Create shortcut to BigQuery export
gcs_manager.create_gcs_shortcut(
    workspace_id="ws-analytics",
    lakehouse_id="lh-central",
    shortcut_name="gcp_bigquery_export",
    bucket="company-bq-exports",
    path="daily_exports/customers",
    connection_id="gcs-connection-id"
)
```

## Spark External Tables

```python
# PySpark - Create external table pointing to cloud storage
spark.sql("""
    CREATE EXTERNAL TABLE IF NOT EXISTS external_catalog.aws_events (
        event_id STRING,
        event_type STRING,
        user_id STRING,
        event_data STRING,
        event_timestamp TIMESTAMP
    )
    USING DELTA
    LOCATION 's3a://company-events/delta/events'
    OPTIONS (
        'fs.s3a.access.key' = '${AWS_ACCESS_KEY}',
        'fs.s3a.secret.key' = '${AWS_SECRET_KEY}'
    )
""")

# Query external table
df = spark.sql("""
    SELECT
        event_type,
        COUNT(*) as event_count,
        COUNT(DISTINCT user_id) as unique_users
    FROM external_catalog.aws_events
    WHERE event_timestamp >= current_date() - INTERVAL 7 DAYS
    GROUP BY event_type
    ORDER BY event_count DESC
""")
```

## Dataverse Integration

```python
class DataverseConnector:
    """Connect to Dataverse from Fabric."""

    def __init__(self, fabric_client):
        self.client = fabric_client

    def create_dataverse_shortcut(
        self,
        workspace_id: str,
        lakehouse_id: str,
        shortcut_name: str,
        environment_url: str,
        table_name: str
    ):
        """Create shortcut to Dataverse table."""
        return self.client.shortcuts.create(
            workspace_id=workspace_id,
            item_id=lakehouse_id,
            shortcut={
                "name": shortcut_name,
                "target": {
                    "type": "Dataverse",
                    "environmentUrl": environment_url,
                    "tableName": table_name
                }
            }
        )

    def sync_dataverse_tables(
        self,
        workspace_id: str,
        lakehouse_id: str,
        environment_url: str,
        tables: list
    ):
        """Create shortcuts for multiple Dataverse tables."""
        shortcuts = []

        for table in tables:
            shortcut = self.create_dataverse_shortcut(
                workspace_id=workspace_id,
                lakehouse_id=lakehouse_id,
                shortcut_name=f"dv_{table.lower()}",
                environment_url=environment_url,
                table_name=table
            )
            shortcuts.append(shortcut)

        return shortcuts

# Usage
dataverse = DataverseConnector(fabric_client)

# Sync CRM tables
dataverse.sync_dataverse_tables(
    workspace_id="ws-sales",
    lakehouse_id="lh-crm",
    environment_url="https://org.crm.dynamics.com",
    tables=["account", "contact", "opportunity", "lead"]
)
```

## Multi-Cloud Data Federation

```python
class MultiCloudFederation:
    """Federate data across cloud providers."""

    def __init__(self, fabric_client):
        self.client = fabric_client
        self.adls = ADLSShortcutManager(fabric_client)
        self.s3 = S3ShortcutManager(fabric_client)
        self.gcs = GCSShortcutManager(fabric_client)

    def create_unified_view(
        self,
        workspace_id: str,
        lakehouse_id: str,
        sources: list
    ):
        """Create unified view across cloud sources."""
        # Create shortcuts for each source
        for source in sources:
            if source["type"] == "adls":
                self.adls.create_adls_shortcut(
                    workspace_id=workspace_id,
                    lakehouse_id=lakehouse_id,
                    shortcut_name=source["name"],
                    storage_account=source["storage_account"],
                    container=source["container"],
                    path=source.get("path", "")
                )
            elif source["type"] == "s3":
                self.s3.create_s3_shortcut(
                    workspace_id=workspace_id,
                    lakehouse_id=lakehouse_id,
                    shortcut_name=source["name"],
                    bucket=source["bucket"],
                    path=source.get("path", ""),
                    connection_id=source["connection_id"]
                )
            elif source["type"] == "gcs":
                self.gcs.create_gcs_shortcut(
                    workspace_id=workspace_id,
                    lakehouse_id=lakehouse_id,
                    shortcut_name=source["name"],
                    bucket=source["bucket"],
                    path=source.get("path", ""),
                    connection_id=source["connection_id"]
                )

        # Create unified SQL view
        self._create_unified_sql_view(workspace_id, lakehouse_id, sources)

    def _create_unified_sql_view(
        self,
        workspace_id: str,
        lakehouse_id: str,
        sources: list
    ):
        """Create SQL view combining all sources."""
        union_queries = []

        for source in sources:
            union_queries.append(f"""
                SELECT
                    '{source['cloud']}' as source_cloud,
                    '{source['name']}' as source_name,
                    *
                FROM {source['name']}
            """)

        view_sql = f"""
            CREATE OR REPLACE VIEW unified_data AS
            {' UNION ALL '.join(union_queries)}
        """

        self.client.sql.execute(workspace_id, lakehouse_id, view_sql)

# Usage
federation = MultiCloudFederation(fabric_client)

# Create unified customer view across clouds
federation.create_unified_view(
    workspace_id="ws-analytics",
    lakehouse_id="lh-central",
    sources=[
        {
            "name": "azure_customers",
            "type": "adls",
            "cloud": "azure",
            "storage_account": "companydatalake",
            "container": "customers",
            "path": "processed"
        },
        {
            "name": "aws_customers",
            "type": "s3",
            "cloud": "aws",
            "bucket": "company-customer-data",
            "path": "customers",
            "connection_id": "s3-conn-id"
        },
        {
            "name": "gcp_customers",
            "type": "gcs",
            "cloud": "gcp",
            "bucket": "company-customers-gcp",
            "path": "exported",
            "connection_id": "gcs-conn-id"
        }
    ]
)
```

## Best Practices

1. **Use shortcuts over copies** - Zero-copy saves storage costs
2. **Secure connections** - Use managed identities when possible
3. **Monitor performance** - Cross-cloud queries have latency
4. **Cache hot data** - Materialize frequently accessed external data
5. **Plan for failures** - External sources can be unavailable

## What's Next

Tomorrow I'll cover security fundamentals in Microsoft Fabric.

## Resources

- [OneLake Shortcuts](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts)
- [S3 Compatible Storage](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts-s3-compatible)
- [Multi-Cloud Data Access](https://learn.microsoft.com/fabric/onelake/access-onelake-shortcuts)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
