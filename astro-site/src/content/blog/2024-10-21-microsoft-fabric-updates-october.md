---
title: "Microsoft Fabric Updates: October 2024 Announcements"
description: "Microsoft announced the preview of relational databases directly within Fabric, bringing transactional workloads into the unified platform."
author: "Michael John Peña"
draft: false
date: 2024-10-21
tags: ["Microsoft Fabric", "Azure", "Data Platform", "Analytics", "Updates"]
---

## Key October 2024 Updates

### 1. Fabric Databases Preview

Microsoft announced the preview of relational databases directly within Fabric, bringing transactional workloads into the unified platform.

```python
# Connecting to Fabric SQL Database
import pyodbc
from azure.identity import DefaultAzureCredential

# Get token for Fabric SQL endpoint
credential = DefaultAzureCredential()
token = credential.get_token("https://database.fabric.microsoft.com/.default")

# Connection string for Fabric SQL Database
conn_str = (
    f"Driver={{ODBC Driver 18 for SQL Server}};"
    f"Server=your-workspace.datawarehouse.fabric.microsoft.com;"
    f"Database=your-database;"
    f"Authentication=ActiveDirectoryAccessToken;"
)

conn = pyodbc.connect(conn_str, attrs_before={
    1256: token.token.encode()  # SQL_COPT_SS_ACCESS_TOKEN
})

cursor = conn.cursor()
cursor.execute("SELECT * FROM sales.orders LIMIT 10")
```

### 2. Real-Time Intelligence Enhancements

```python
# Using KQL in Fabric Real-Time Analytics
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

# Connect to Fabric KQL Database
cluster = "https://your-workspace.kusto.fabric.microsoft.com"
database = "your-kql-database"

kcsb = KustoConnectionStringBuilder.with_aad_device_authentication(cluster)
client = KustoClient(kcsb)

# Real-time query
query = """
EventLogs
| where Timestamp > ago(1h)
| summarize EventCount = count() by bin(Timestamp, 5m), EventType
| order by Timestamp desc
"""

response = client.execute(database, query)
for row in response.primary_results[0]:
    print(f"{row['Timestamp']}: {row['EventType']} - {row['EventCount']}")
```

### 3. Copilot for Fabric GA

Copilot is now generally available across Fabric workloads.

```python
# Using Fabric REST API to interact with workspaces
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

# List workspaces
response = requests.get(
    "https://api.fabric.microsoft.com/v1/workspaces",
    headers=headers
)

workspaces = response.json()["value"]
for ws in workspaces:
    print(f"Workspace: {ws['displayName']} ({ws['id']})")
```

## New Lakehouse Features

```python
# Delta Lake enhancements in Fabric Lakehouse
from pyspark.sql import SparkSession
from delta import DeltaTable

spark = SparkSession.builder.getOrCreate()

# New: Liquid Clustering (Preview)
spark.sql("""
    CREATE TABLE sales.transactions (
        transaction_id STRING,
        customer_id STRING,
        amount DECIMAL(10, 2),
        transaction_date DATE
    )
    USING DELTA
    CLUSTER BY (customer_id, transaction_date)
""")

# New: Deletion Vectors for faster deletes
spark.sql("""
    ALTER TABLE sales.transactions
    SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true')
""")

# New: Row-level concurrency
spark.sql("""
    ALTER TABLE sales.transactions
    SET TBLPROPERTIES ('delta.enableRowLevelConcurrency' = 'true')
""")

# Optimized merge with deletion vectors
delta_table = DeltaTable.forName(spark, "sales.transactions")

delta_table.alias("target").merge(
    updates_df.alias("source"),
    "target.transaction_id = source.transaction_id"
).whenMatchedUpdate(
    set={"amount": "source.amount"}
).whenNotMatchedInsert(
    values={
        "transaction_id": "source.transaction_id",
        "customer_id": "source.customer_id",
        "amount": "source.amount",
        "transaction_date": "source.transaction_date"
    }
).execute()
```

## Data Pipeline Improvements

```python
# New pipeline activities and features
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

# Create pipeline with new Fabric Copy activity
pipeline_definition = {
    "name": "OptimizedCopyPipeline",
    "properties": {
        "activities": [
            {
                "name": "CopyToLakehouse",
                "type": "Copy",
                "inputs": [{
                    "referenceName": "SourceDataset",
                    "type": "DatasetReference"
                }],
                "outputs": [{
                    "referenceName": "LakehouseTable",
                    "type": "DatasetReference"
                }],
                "typeProperties": {
                    # New: Intelligent throughput optimization
                    "enableThroughputOptimization": True,
                    # New: Auto-partitioning
                    "autoPartition": True,
                    # New: Schema drift handling
                    "enableSchemaDrift": True
                }
            }
        ]
    }
}
```

## Semantic Model Enhancements

```python
# New: Direct Lake mode improvements
import pandas as pd
from sempy import fabric

# Connect to semantic model
dataset_id = "your-dataset-id"

# New: Framing for Direct Lake
framing_config = {
    "mode": "automatic",
    "schedule": {
        "frequency": "hourly",
        "interval": 1
    }
}

# Query with new DAX optimizations
query = """
EVALUATE
    SUMMARIZECOLUMNS(
        'Date'[Year],
        'Product'[Category],
        "Total Sales", SUM('Sales'[Amount]),
        "YoY Growth", [YoY Growth %]
    )
"""

result = fabric.evaluate_dax(dataset_id, query)
df = pd.DataFrame(result)
```

## OneLake Shortcuts Enhancements

```python
# New shortcut capabilities
from azure.identity import DefaultAzureCredential
import requests

# Create shortcut to external data
shortcut_definition = {
    "name": "external-data-shortcut",
    "path": "/Files/external",
    "target": {
        # New: Google Cloud Storage support
        "type": "GoogleCloudStorage",
        "location": "gs://bucket-name/path",
        "credential": {
            "type": "ServiceAccountKey",
            "keyVaultUri": "https://your-keyvault.vault.azure.net/secrets/gcs-key"
        }
    }
}

# New: Amazon S3 shortcut with cross-region support
s3_shortcut = {
    "name": "s3-shortcut",
    "path": "/Files/s3-data",
    "target": {
        "type": "AmazonS3",
        "location": "s3://bucket-name/path",
        "region": "us-west-2",
        "credential": {
            "type": "Role",
            "roleArn": "arn:aws:iam::123456789:role/FabricRole"
        }
    }
}
```

## Governance Updates

```python
# New: Enhanced data governance features
from azure.purview.catalog import PurviewCatalogClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()

# Connect to Fabric's integrated Purview
client = PurviewCatalogClient(
    endpoint="https://your-fabric-workspace.purview.azure.com",
    credential=credential
)

# New: Auto-classification for Fabric items
classification_rules = {
    "rules": [
        {
            "name": "PII Detection",
            "patterns": ["email", "phone", "ssn"],
            "action": "classify",
            "classification": "Personal Identifiable Information"
        }
    ]
}

# New: Sensitivity labels propagation
# Labels flow from source to downstream items automatically
```

## Migration Considerations

```python
# Helper for assessing migration readiness
class FabricMigrationAssessor:
    """Assess readiness for migrating to new Fabric features"""

    def __init__(self):
        self.recommendations = []

    def assess_lakehouse(self, current_config: dict) -> dict:
        """Assess Lakehouse migration readiness"""

        assessment = {
            "liquid_clustering_ready": False,
            "deletion_vectors_benefit": False,
            "recommendations": []
        }

        # Check if liquid clustering would help
        if current_config.get("frequent_filter_columns"):
            assessment["liquid_clustering_ready"] = True
            assessment["recommendations"].append(
                "Consider liquid clustering on frequently filtered columns"
            )

        # Check if deletion vectors would help
        if current_config.get("frequent_updates"):
            assessment["deletion_vectors_benefit"] = True
            assessment["recommendations"].append(
                "Enable deletion vectors for faster update/delete operations"
            )

        return assessment

    def assess_database_migration(self, source_db: str) -> dict:
        """Assess readiness for Fabric Database migration"""

        return {
            "compatible": True,
            "considerations": [
                "Fabric SQL Database uses T-SQL subset",
                "Some features may require workarounds",
                "Consider Direct Lake for analytics workloads"
            ],
            "benefits": [
                "Unified platform with analytics",
                "Automatic mirroring to OneLake",
                "Integrated governance"
            ]
        }
```

Microsoft Fabric's October 2024 updates bring exciting capabilities for building unified data platforms. The addition of relational databases and enhanced real-time features make it an increasingly compelling choice.
