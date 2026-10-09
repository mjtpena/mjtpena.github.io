---
title: "Microsoft Fabric 2025: Roadmap and New Capabilities"
author: Michael John Peña
draft: false
date: 2025-01-10
tags:
  - Microsoft Fabric
  - Azure
  - Data Platform
  - Analytics
  - 2025 Roadmap
---

## Fabric's 2025 Vision

Microsoft's vision for Fabric in 2025 centers on:
1. **AI-native analytics** - Copilot everywhere
2. **Real-time everything** - Sub-second latency
3. **Governance by default** - Security built-in
4. **Developer productivity** - Modern tooling

## New Capabilities for 2025

### 1. Enhanced Copilot Integration

Copilot is now available across all Fabric experiences:

```python
# Using Fabric Copilot in notebooks
# Simply describe what you want in natural language

# %copilot
# "Load the sales data from the lakehouse,
# clean null values, calculate monthly trends,
# and create a visualization"

# Copilot generates:
from pyspark.sql import functions as F
import matplotlib.pyplot as plt

# Load data
df = spark.read.table("lakehouse.sales")

# Clean nulls
df_clean = df.dropna(subset=["amount", "date"])

# Calculate monthly trends
monthly = (df_clean
    .withColumn("month", F.date_trunc("month", "date"))
    .groupBy("month")
    .agg(F.sum("amount").alias("total_sales"))
    .orderBy("month"))

# Visualize
pdf = monthly.toPandas()
plt.figure(figsize=(12, 6))
plt.plot(pdf['month'], pdf['total_sales'])
plt.title('Monthly Sales Trend')
plt.xlabel('Month')
plt.ylabel('Total Sales')
plt.show()
```

### 2. Real-Time Intelligence GA

Real-Time Intelligence is now generally available with enhanced features:

```python
# Create Eventstream via REST API, configure via portal
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

workspace_id = "your-workspace-id"

# Create eventstream item
eventstream_payload = {
    "displayName": "sales_events",
    "type": "Eventstream",
    "description": "Real-time sales event processing"
}

response = requests.post(
    f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items",
    headers=headers,
    json=eventstream_payload
)

# Note: Configure source (Event Hub), transformations, and destinations
# in the Fabric portal visual designer

# Query real-time data using KQL (in Fabric notebook or KQL Queryset)
kql_query = """
realtime_sales
| where processed_time > ago(1h)
| summarize total_sales = sum(amount) by bin(processed_time, 1m), region
| render timechart
"""

# Execute KQL via Azure Data Explorer SDK or Kusto Python client
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

cluster_uri = "https://<kql-database>.kusto.fabric.microsoft.com"
kcsb = KustoConnectionStringBuilder.with_aad_device_authentication(cluster_uri)
client = KustoClient(kcsb)
response = client.execute("sales_analytics", kql_query)
```

### 3. Data Warehouse Enhancements

```sql
-- New T-SQL capabilities in Fabric Data Warehouse

-- Automated statistics management
ALTER DATABASE SCOPED CONFIGURATION SET AUTO_CREATE_STATISTICS = ON;
ALTER DATABASE SCOPED CONFIGURATION SET AUTO_UPDATE_STATISTICS = ON;

-- Workload management
CREATE WORKLOAD GROUP high_priority
WITH (
    MIN_PERCENTAGE_RESOURCE = 30,
    MAX_PERCENTAGE_RESOURCE = 70,
    IMPORTANCE = HIGH
);

-- Query hints for optimization
SELECT /*+ QUERY_HINT(FORCE_HASH_JOIN) */
    c.customer_name,
    SUM(s.amount) as total_sales
FROM customers c
JOIN sales s ON c.customer_id = s.customer_id
GROUP BY c.customer_name;

-- Clone tables for development
CREATE TABLE sales_dev
AS CLONE OF sales
WITH (DATA_CONSISTENCY = EVENTUAL);
```

### 4. Lakehouse Improvements

```python
# New Delta Lake 3.0 features in Fabric

from delta.tables import DeltaTable

# Liquid clustering (replaces partitioning and Z-ordering)
spark.sql("""
    CREATE TABLE lakehouse.sales_optimized
    CLUSTER BY (date, region)
    AS SELECT * FROM lakehouse.sales
""")

# Automatic optimization
spark.sql("""
    ALTER TABLE lakehouse.sales_optimized
    SET TBLPROPERTIES (
        'delta.autoOptimize.autoCompact' = 'true',
        'delta.autoOptimize.optimizeWrite' = 'true'
    )
""")

# UniForm for cross-engine compatibility
spark.sql("""
    ALTER TABLE lakehouse.sales_optimized
    SET TBLPROPERTIES (
        'delta.universalFormat.enabledFormats' = 'iceberg'
    )
""")

# Table now readable by Iceberg-compatible engines
```

### 5. Data Engineering Pipelines

```python
# Create and manage pipelines via Fabric REST API
from azure.identity import DefaultAzureCredential
import requests
import json

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
base_url = "https://api.fabric.microsoft.com/v1"

workspace_id = "your-workspace-id"

# Pipeline definition (created/managed via portal or REST API)
pipeline_config = {
    "displayName": "daily_sales_pipeline",
    "type": "DataPipeline",
    "description": "Daily sales data ingestion and transformation pipeline"
}

# Create pipeline item
response = requests.post(
    f"{base_url}/workspaces/{workspace_id}/items",
    headers=headers,
    json=pipeline_config
)
pipeline_id = response.json().get("id")

# Pipeline activities are configured in the pipeline definition
# This is typically done via Fabric portal visual designer
# Activities include: Copy, Notebook, Dataflow Gen2, Semantic Model Refresh

# Example: Trigger pipeline run via REST API
def run_pipeline(workspace_id: str, pipeline_id: str, parameters: dict = None):
    """Trigger a pipeline run."""
    payload = {"parameters": parameters} if parameters else {}

    response = requests.post(
        f"{base_url}/workspaces/{workspace_id}/items/{pipeline_id}/jobs/instances?jobType=Pipeline",
        headers=headers,
        json=payload
    )
    return response.json()

# Trigger the pipeline
run_result = run_pipeline(workspace_id, pipeline_id, {"date": "2025-01-10"})
print(f"Pipeline run ID: {run_result.get('id')}")

# Note: Schedule triggers and event-based triggers are configured
# in the Fabric portal under the pipeline's trigger settings
```

### 6. OneLake Enhancements

```python
# Direct OneLake file access via REST API and ADLS Gen2 compatible endpoints
from azure.identity import DefaultAzureCredential
from azure.storage.filedatalake import DataLakeServiceClient
import requests

credential = DefaultAzureCredential()

# Option 1: Use ADLS Gen2 SDK with OneLake endpoint
onelake_account_url = "https://onelake.dfs.fabric.microsoft.com"
service_client = DataLakeServiceClient(account_url=onelake_account_url, credential=credential)

# Access lakehouse files
workspace_name = "your-workspace"
lakehouse_name = "your-lakehouse"
file_system_client = service_client.get_file_system_client(f"{workspace_name}/{lakehouse_name}.Lakehouse")

# List files
paths = file_system_client.get_paths(path="Files/")
for path in paths:
    print(f"  {path.name}")

# Read file
file_client = file_system_client.get_file_client("Files/config.json")
content = file_client.download_file().readall()

# Option 2: Create shortcuts via REST API
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

workspace_id = "target-workspace-id"
lakehouse_id = "target-lakehouse-id"

shortcut_payload = {
    "path": "Tables/shared_customers",
    "target": {
        "oneLake": {
            "workspaceId": "source-workspace-id",
            "itemId": "source-lakehouse-id",
            "path": "Tables/customers"
        }
    }
}

response = requests.post(
    f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{lakehouse_id}/shortcuts",
    headers=headers,
    json=shortcut_payload
)
```

### 7. Governance and Security

```python
# Enhanced Purview integration via REST APIs
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
purview_account = "my-purview-account"

def get_purview_token():
    return credential.get_token("https://purview.azure.net/.default").token

def apply_sensitivity_label(asset_path: str, label: str):
    """Apply sensitivity label to a Fabric asset via Purview."""
    token = get_purview_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Get asset GUID from Purview
    search_payload = {"keywords": asset_path, "limit": 1}
    search_response = requests.post(
        f"https://{purview_account}.purview.azure.com/catalog/api/search/query",
        headers=headers,
        json=search_payload
    )
    asset_guid = search_response.json()["value"][0]["id"]

    # Apply label
    label_payload = {"typeName": "Microsoft_Information_Protection_Label", "attributes": {"label": label}}
    response = requests.put(
        f"https://{purview_account}.purview.azure.com/catalog/api/atlas/v2/entity/guid/{asset_guid}/labels",
        headers=headers,
        json=label_payload
    )
    return response.status_code

# Apply sensitivity labels
apply_sensitivity_label("workspace/lakehouse/Tables/customers", "Confidential")

# Data lineage tracking via Purview REST API
def get_lineage(asset_path: str) -> dict:
    """Get data lineage for an asset."""
    token = get_purview_token()
    headers = {"Authorization": f"Bearer {token}"}

    # Search for asset
    search_response = requests.post(
        f"https://{purview_account}.purview.azure.com/catalog/api/search/query",
        headers=headers,
        json={"keywords": asset_path, "limit": 1}
    )
    asset_guid = search_response.json()["value"][0]["id"]

    # Get lineage
    lineage_response = requests.get(
        f"https://{purview_account}.purview.azure.com/catalog/api/atlas/v2/lineage/{asset_guid}",
        headers=headers,
        params={"direction": "BOTH", "depth": 3}
    )
    return lineage_response.json()

lineage = get_lineage("workspace/report/sales_dashboard")
print(f"Lineage relations: {lineage.get('relations', [])}")

# Access policies via Purview Policy API
def create_access_policy(policy_name: str, scope: str, rules: list):
    """Create access policy in Purview."""
    token = get_purview_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    policy_payload = {
        "name": policy_name,
        "decisionRules": [{
            "effect": rule["access"],
            "dnfCondition": [[
                {"attributeName": "column", "attributeValueIncludes": col}
                for col in rule["columns"]
            ]]
        } for rule in rules]
    }

    response = requests.put(
        f"https://{purview_account}.purview.azure.com/policystore/policies/{policy_name}",
        headers=headers,
        json=policy_payload
    )
    return response.json()

# Create access policies
create_access_policy(
    "PII_access_policy",
    "workspace/lakehouse",
    [
        {"columns": ["email", "phone"], "access": "mask", "roles": ["analyst"]},
        {"columns": ["email", "phone"], "access": "full", "roles": ["admin"]}
    ]
)
```

## Migration Paths

### From Azure Synapse

```python
# Migrate Synapse Dedicated Pool to Fabric Warehouse using REST APIs and T-SQL
from azure.identity import DefaultAzureCredential
import pyodbc
import requests

credential = DefaultAzureCredential()

# Source: Synapse Dedicated Pool connection
synapse_server = "synapse-server.sql.azuresynapse.net"
synapse_database = "dedicated_pool"

# Get token for Synapse SQL
synapse_token = credential.get_token("https://database.windows.net/.default").token

# Connect to Synapse
synapse_conn_str = (
    f"DRIVER={{ODBC Driver 18 for SQL Server}};"
    f"SERVER={synapse_server};"
    f"DATABASE={synapse_database};"
    f"Authentication=ActiveDirectoryAccessToken;"
)
synapse_conn = pyodbc.connect(synapse_conn_str, attrs_before={1256: synapse_token.encode()})

# Assess migration - get table list and sizes
cursor = synapse_conn.cursor()
cursor.execute("""
    SELECT
        s.name AS schema_name,
        t.name AS table_name,
        SUM(p.rows) AS row_count,
        SUM(a.total_pages) * 8 / 1024 AS size_mb
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    JOIN sys.partitions p ON t.object_id = p.object_id
    JOIN sys.allocation_units a ON p.partition_id = a.container_id
    WHERE p.index_id IN (0, 1)
    GROUP BY s.name, t.name
    ORDER BY size_mb DESC
""")

tables = cursor.fetchall()
print(f"Tables to migrate: {len(tables)}")
for table in tables:
    print(f"  {table.schema_name}.{table.table_name}: {table.row_count} rows, {table.size_mb} MB")

# Migration options:
# 1. Use COPY INTO from ADLS staging (recommended for large tables)
# 2. Use Azure Data Factory / Synapse pipelines
# 3. Use Fabric Data Pipelines with copy activity

# Example: Create target warehouse in Fabric
fabric_token = credential.get_token("https://api.fabric.microsoft.com/.default").token
fabric_headers = {"Authorization": f"Bearer {fabric_token}", "Content-Type": "application/json"}

workspace_id = "production-workspace-id"
warehouse_payload = {
    "displayName": "main_warehouse",
    "type": "Warehouse",
    "description": "Migrated from Synapse Dedicated Pool"
}

response = requests.post(
    f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items",
    headers=fabric_headers,
    json=warehouse_payload
)
print(f"Warehouse created: {response.json()}")

# For actual data migration, use Fabric Data Pipelines or COPY INTO statements
```

## What's Next

2025 will bring:
- **Q1**: Enhanced Copilot, Real-Time Intelligence GA
- **Q2**: Advanced governance features, cross-cloud shortcuts
- **Q3**: Performance improvements, new connectors
- **Q4**: Next-gen AI features, Ignite announcements

Microsoft Fabric is becoming the unified platform for analytics and AI. If you haven't started your Fabric journey, now is the time.
