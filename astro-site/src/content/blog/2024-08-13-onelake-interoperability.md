---
title: "OneLake Interoperability: Connecting Your Data Ecosystem"
author: Michael John Peña
draft: false
date: 2024-08-13
tags:
  - Microsoft Fabric
  - OneLake
  - Data Lake
  - Interoperability
  - Integration
---

## OneLake Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     External Access                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Azure    │ │ Power BI │ │ Spark    │ │ Third-Party      │   │
│  │ Storage  │ │ Desktop  │ │ Clusters │ │ Tools            │   │
│  │ Explorer │ │          │ │          │ │ (Tableau, etc.)  │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘   │
│       │            │            │                │              │
│       └────────────┴────────────┴────────────────┘              │
│                            │                                    │
│                   ┌────────▼────────┐                          │
│                   │    OneLake      │                          │
│                   │   ADLS Gen2     │                          │
│                   │   Compatible    │                          │
│                   └────────┬────────┘                          │
│                            │                                    │
│       ┌────────────────────┼────────────────────┐              │
│       │                    │                    │              │
│  ┌────▼────┐         ┌─────▼─────┐        ┌────▼────┐         │
│  │Lakehouse│         │ Warehouse │        │ KQL DB  │         │
│  │  Data   │         │   Data    │        │  Data   │         │
│  └─────────┘         └───────────┘        └─────────┘         │
└────────────────────────────────────────────────────────────────┘
```

## ADLS Gen2 Compatibility

### OneLake Paths

```python
# OneLake uses ADLS Gen2 compatible paths
# Format: https://onelake.dfs.fabric.microsoft.com/{workspace}/{item}

class OneLakePaths:
    """Generate OneLake-compatible paths."""

    def __init__(self, workspace_name: str):
        self.workspace = workspace_name
        self.base_url = "https://onelake.dfs.fabric.microsoft.com"

    def get_lakehouse_path(
        self,
        lakehouse_name: str,
        folder: str = "Tables"
    ) -> dict:
        """Get paths for lakehouse access."""

        return {
            "https": f"{self.base_url}/{self.workspace}/{lakehouse_name}.Lakehouse/{folder}",
            "abfss": f"abfss://{self.workspace}@onelake.dfs.fabric.microsoft.com/{lakehouse_name}.Lakehouse/{folder}",
            "wasbs": f"wasbs://{self.workspace}@onelake.blob.fabric.microsoft.com/{lakehouse_name}.Lakehouse/{folder}"
        }

    def get_warehouse_path(self, warehouse_name: str) -> dict:
        """Get paths for warehouse access."""

        return {
            "https": f"{self.base_url}/{self.workspace}/{warehouse_name}.Warehouse",
            "abfss": f"abfss://{self.workspace}@onelake.dfs.fabric.microsoft.com/{warehouse_name}.Warehouse"
        }

    def get_file_path(
        self,
        lakehouse_name: str,
        file_path: str
    ) -> str:
        """Get path to specific file."""

        return f"{self.base_url}/{self.workspace}/{lakehouse_name}.Lakehouse/Files/{file_path}"

# Usage
paths = OneLakePaths("my-workspace")
lakehouse_paths = paths.get_lakehouse_path("sales-lakehouse")

print(f"HTTPS: {lakehouse_paths['https']}")
print(f"ABFSS: {lakehouse_paths['abfss']}")
```

### Azure Storage Explorer Access

```python
# Connect to OneLake via Azure Storage Explorer
# Use Azure AD authentication

connection_config = {
    "account_name": "onelake",
    "account_url": "https://onelake.dfs.fabric.microsoft.com",
    "authentication": "Azure AD",
    "container": "workspace-name",  # Workspace appears as container
    "path": "lakehouse-name.Lakehouse/Tables"
}

# In Azure Storage Explorer:
# 1. Add connection -> Azure Data Lake Storage Gen2
# 2. Use Azure AD authentication
# 3. Enter: https://onelake.dfs.fabric.microsoft.com
# 4. Browse workspaces and items
```

## External Spark Cluster Access

### Connecting from Databricks

```python
# Databricks notebook connecting to OneLake

# Configure authentication
spark.conf.set(
    "fs.azure.account.auth.type.onelake.dfs.fabric.microsoft.com",
    "OAuth"
)
spark.conf.set(
    "fs.azure.account.oauth.provider.type.onelake.dfs.fabric.microsoft.com",
    "org.apache.hadoop.fs.azurebfs.oauth2.ClientCredsTokenProvider"
)
spark.conf.set(
    "fs.azure.account.oauth2.client.id.onelake.dfs.fabric.microsoft.com",
    dbutils.secrets.get(scope="fabric", key="client-id")
)
spark.conf.set(
    "fs.azure.account.oauth2.client.secret.onelake.dfs.fabric.microsoft.com",
    dbutils.secrets.get(scope="fabric", key="client-secret")
)
spark.conf.set(
    "fs.azure.account.oauth2.client.endpoint.onelake.dfs.fabric.microsoft.com",
    f"https://login.microsoftonline.com/{tenant_id}/oauth2/token"
)

# Read from OneLake
onelake_path = "abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse.Lakehouse/Tables/customers"

customers_df = spark.read.format("delta").load(onelake_path)
display(customers_df)

# Write to OneLake (if permissions allow)
output_path = "abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse.Lakehouse/Tables/processed_data"

processed_df.write.format("delta") \
    .mode("overwrite") \
    .save(output_path)
```

### Connecting from Synapse

```python
# Synapse Spark notebook

# OneLake is accessible with workspace managed identity
# No additional configuration needed for same-tenant access

from pyspark.sql import SparkSession

# Read OneLake data
onelake_path = "abfss://my-workspace@onelake.dfs.fabric.microsoft.com/my-lakehouse.Lakehouse/Tables/sales"

sales_df = spark.read.format("delta").load(onelake_path)

# Process and write back
aggregated = sales_df.groupBy("region").agg(
    {"amount": "sum", "order_id": "count"}
)

aggregated.write.format("delta") \
    .mode("overwrite") \
    .save(onelake_path.replace("sales", "sales_aggregated"))
```

## Third-Party Tool Integration

### Tableau Connection

```python
# Tableau connects via SQL endpoint or Direct Lake
# Use ODBC connection with Azure AD

tableau_connection = {
    "server": "your-workspace.datawarehouse.fabric.microsoft.com",
    "port": 1433,
    "database": "lakehouse-sql-endpoint",
    "authentication": "Azure Active Directory",
    "driver": "ODBC Driver 18 for SQL Server",
    "connection_string": (
        "Driver={ODBC Driver 18 for SQL Server};"
        "Server=your-workspace.datawarehouse.fabric.microsoft.com,1433;"
        "Database=lakehouse-sql-endpoint;"
        "Authentication=ActiveDirectoryInteractive;"
        "Encrypt=yes;"
        "TrustServerCertificate=no;"
    )
}
```

### dbt Integration

```yaml
# dbt profile for Fabric
# profiles.yml

fabric_project:
  target: dev
  outputs:
    dev:
      type: fabric
      driver: 'ODBC Driver 18 for SQL Server'
      server: your-workspace.datawarehouse.fabric.microsoft.com
      port: 1433
      database: your-warehouse
      schema: dbo
      authentication: ActiveDirectoryInteractive
      # Or use service principal
      # authentication: ActiveDirectoryServicePrincipal
      # client_id: "{{ env_var('FABRIC_CLIENT_ID') }}"
      # client_secret: "{{ env_var('FABRIC_CLIENT_SECRET') }}"
      # tenant_id: "{{ env_var('FABRIC_TENANT_ID') }}"
```

```sql
-- dbt model example
-- models/sales_summary.sql

{{ config(materialized='table') }}

SELECT
    date_trunc('month', order_date) AS month,
    region,
    COUNT(*) AS order_count,
    SUM(amount) AS total_revenue
FROM {{ source('raw', 'orders') }}
WHERE order_date >= '2024-01-01'
GROUP BY 1, 2
```

### Python SDK Access

```python
# Access OneLake with Azure SDK
from azure.identity import DefaultAzureCredential
from azure.storage.filedatalake import DataLakeServiceClient

class OneLakeClient:
    """Python client for OneLake operations."""

    def __init__(self, workspace_name: str):
        self.workspace = workspace_name
        self.account_url = "https://onelake.dfs.fabric.microsoft.com"
        self.credential = DefaultAzureCredential()
        self.service_client = DataLakeServiceClient(
            account_url=self.account_url,
            credential=self.credential
        )

    def list_items(self) -> list:
        """List all items in workspace."""

        file_system_client = self.service_client.get_file_system_client(
            file_system=self.workspace
        )

        items = []
        for path in file_system_client.get_paths():
            items.append({
                "name": path.name,
                "is_directory": path.is_directory,
                "last_modified": path.last_modified
            })

        return items

    def read_file(self, lakehouse: str, file_path: str) -> bytes:
        """Read file from OneLake."""

        file_system_client = self.service_client.get_file_system_client(
            file_system=self.workspace
        )

        file_client = file_system_client.get_file_client(
            f"{lakehouse}.Lakehouse/Files/{file_path}"
        )

        download = file_client.download_file()
        return download.readall()

    def upload_file(
        self,
        lakehouse: str,
        file_path: str,
        data: bytes
    ):
        """Upload file to OneLake."""

        file_system_client = self.service_client.get_file_system_client(
            file_system=self.workspace
        )

        file_client = file_system_client.get_file_client(
            f"{lakehouse}.Lakehouse/Files/{file_path}"
        )

        file_client.upload_data(data, overwrite=True)

    def read_delta_table(self, lakehouse: str, table_name: str):
        """Read Delta table using deltalake library."""

        import deltalake

        table_path = (
            f"abfss://{self.workspace}@onelake.dfs.fabric.microsoft.com/"
            f"{lakehouse}.Lakehouse/Tables/{table_name}"
        )

        dt = deltalake.DeltaTable(
            table_path,
            storage_options={
                "azure_storage_account_name": "onelake",
                "azure_use_azure_cli": "true"
            }
        )

        return dt.to_pandas()

# Usage
client = OneLakeClient("my-workspace")

# List items
items = client.list_items()
for item in items[:5]:
    print(f"{item['name']} - Directory: {item['is_directory']}")

# Read Delta table
df = client.read_delta_table("sales-lakehouse", "customers")
print(df.head())
```

## REST API Access

### OneLake REST API

```python
import requests
from azure.identity import DefaultAzureCredential

class OneLakeAPI:
    """OneLake REST API client."""

    def __init__(self):
        self.base_url = "https://api.fabric.microsoft.com/v1"
        self.credential = DefaultAzureCredential()

    def _get_headers(self):
        token = self.credential.get_token(
            "https://api.fabric.microsoft.com/.default"
        )
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def list_workspaces(self) -> list:
        """List all workspaces."""

        response = requests.get(
            f"{self.base_url}/workspaces",
            headers=self._get_headers()
        )
        response.raise_for_status()
        return response.json().get("value", [])

    def list_lakehouses(self, workspace_id: str) -> list:
        """List lakehouses in workspace."""

        response = requests.get(
            f"{self.base_url}/workspaces/{workspace_id}/lakehouses",
            headers=self._get_headers()
        )
        response.raise_for_status()
        return response.json().get("value", [])

    def get_lakehouse_tables(
        self,
        workspace_id: str,
        lakehouse_id: str
    ) -> list:
        """Get tables in lakehouse."""

        response = requests.get(
            f"{self.base_url}/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/tables",
            headers=self._get_headers()
        )
        response.raise_for_status()
        return response.json().get("data", [])

    def run_sql_query(
        self,
        workspace_id: str,
        lakehouse_id: str,
        query: str
    ) -> list:
        """Run SQL query against lakehouse SQL endpoint."""

        payload = {
            "query": query,
            "maxRows": 10000
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/sqlQueries",
            headers=self._get_headers(),
            json=payload
        )
        response.raise_for_status()
        return response.json()

# Usage
api = OneLakeAPI()

# List workspaces
workspaces = api.list_workspaces()
for ws in workspaces:
    print(f"Workspace: {ws['displayName']} ({ws['id']})")

# List lakehouses
lakehouses = api.list_lakehouses(workspaces[0]['id'])
for lh in lakehouses:
    print(f"Lakehouse: {lh['displayName']}")

# Run query
results = api.run_sql_query(
    workspace_id=workspaces[0]['id'],
    lakehouse_id=lakehouses[0]['id'],
    query="SELECT TOP 10 * FROM customers"
)
```

## Data Export Patterns

### Export to External Systems

```python
class OneLakeExporter:
    """Export data from OneLake to external systems."""

    def __init__(self, spark):
        self.spark = spark

    def export_to_adls(
        self,
        source_table: str,
        target_account: str,
        target_container: str,
        target_path: str,
        format: str = "delta"
    ):
        """Export to external ADLS account."""

        df = self.spark.read.format("delta").table(source_table)

        target_url = f"abfss://{target_container}@{target_account}.dfs.core.windows.net/{target_path}"

        df.write.format(format) \
            .mode("overwrite") \
            .save(target_url)

    def export_to_s3(
        self,
        source_table: str,
        bucket: str,
        path: str,
        aws_access_key: str,
        aws_secret_key: str,
        format: str = "parquet"
    ):
        """Export to AWS S3."""

        # Configure S3 access
        self.spark.conf.set("fs.s3a.access.key", aws_access_key)
        self.spark.conf.set("fs.s3a.secret.key", aws_secret_key)

        df = self.spark.read.format("delta").table(source_table)

        df.write.format(format) \
            .mode("overwrite") \
            .save(f"s3a://{bucket}/{path}")

    def export_to_database(
        self,
        source_table: str,
        jdbc_url: str,
        target_table: str,
        username: str,
        password: str,
        mode: str = "overwrite"
    ):
        """Export to external database."""

        df = self.spark.read.format("delta").table(source_table)

        df.write.format("jdbc") \
            .option("url", jdbc_url) \
            .option("dbtable", target_table) \
            .option("user", username) \
            .option("password", password) \
            .mode(mode) \
            .save()

# Usage
exporter = OneLakeExporter(spark)

# Export to external ADLS
exporter.export_to_adls(
    source_table="customers",
    target_account="externalstorage",
    target_container="exports",
    target_path="customers/2024"
)
```

## Security Considerations

### Authentication Methods

```python
auth_methods = {
    "azure_ad_interactive": {
        "description": "User signs in interactively",
        "use_case": "Development, ad-hoc access",
        "example": "Power BI Desktop, Azure Storage Explorer"
    },
    "service_principal": {
        "description": "App registration with client secret",
        "use_case": "Automated pipelines, external applications",
        "requires": ["Client ID", "Client Secret", "Tenant ID"]
    },
    "managed_identity": {
        "description": "Azure resource identity",
        "use_case": "Azure services (Synapse, Databricks, Functions)",
        "requires": ["Managed Identity enabled on resource"]
    },
    "sas_token": {
        "description": "Shared Access Signature",
        "use_case": "Not supported for OneLake",
        "note": "Use Azure AD methods instead"
    }
}
```

### Access Control

```python
# OneLake uses Fabric workspace permissions
# Plus item-level permissions for fine-grained control

access_levels = {
    "workspace_admin": {
        "fabric_permissions": "Full control over workspace",
        "onelake_access": "Read/Write all items"
    },
    "workspace_member": {
        "fabric_permissions": "Create and manage items",
        "onelake_access": "Read/Write items they own or have access to"
    },
    "workspace_contributor": {
        "fabric_permissions": "Edit existing items",
        "onelake_access": "Read/Write items with explicit permission"
    },
    "workspace_viewer": {
        "fabric_permissions": "View items only",
        "onelake_access": "Read-only access to items with permission"
    }
}
```

## Best Practices

1. **Use managed identity**: Preferred for Azure services
2. **Leverage shortcuts**: Don't copy data unnecessarily
3. **Optimize file sizes**: 128MB-1GB for best performance
4. **Monitor access patterns**: Track who accesses what
5. **Use SQL endpoints**: For BI tool connectivity

## Conclusion

OneLake's ADLS Gen2 compatibility makes it interoperable with virtually any tool that can access Azure storage. Whether connecting from Databricks, external Spark clusters, or BI tools like Tableau, OneLake serves as a universal data layer.

Use the appropriate authentication method for your use case, and leverage shortcuts to avoid unnecessary data movement.
