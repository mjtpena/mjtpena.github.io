---
title: "OneLake Explorer: Navigating Your Data Lake in Fabric"
author: Michael John Peña
draft: false
date: 2023-07-05
tags:
  - Microsoft Fabric
  - OneLake
  - Data Lake
  - Data Engineering
---

OneLake Explorer is a Windows desktop application that lets you browse the contents of your organisation's OneLake the same way you'd navigate files in Windows Explorer — drag and drop, copy, move, view file properties. It's conceptually similar to Azure Storage Explorer but designed specifically for OneLake's hierarchical namespace. The UX hides the ADLS Gen2 API underneath and presents workspaces as folders, Lakehouses as sub-folders, and the Files and Tables sections as intuitive directories. What I've found useful: dropping raw files directly into a Lakehouse's Files section from OneLake Explorer, then having a notebook process them — no SAS token configuration, no Azure portal navigation, just file drag-and-drop. It's a small quality-of-life improvement but it matters when you're working with Fabric all day.

## What is OneLake?

OneLake is automatically provisioned with your Fabric tenant:

```python
# OneLake characteristics
onelake_features = {
    "single_instance": "One OneLake per tenant",
    "hierarchical_namespace": "Like ADLS Gen2",
    "format": "Delta Lake by default",
    "access": "ABFS protocol compatible",
    "storage": "Built-in, no separate provisioning"
}

# OneLake structure
"""
OneLake (Tenant)
├── Workspace A
│   ├── Lakehouse 1
│   │   ├── Files/
│   │   └── Tables/
│   └── Lakehouse 2
├── Workspace B
│   └── Lakehouse 3
└── Workspace C
    └── Warehouse 1
"""
```

## Installing OneLake Explorer

OneLake Explorer is a Windows application that mounts OneLake as a drive:

```powershell
# Download OneLake Explorer
# Go to: https://www.microsoft.com/en-us/download/details.aspx?id=105367

# Or install via winget
winget install Microsoft.OneLake

# After installation:
# 1. Sign in with your Microsoft account
# 2. OneLake appears in File Explorer
# 3. Access path: OneLake - {TenantName}
```

## Navigating OneLake

Once installed, OneLake appears as a drive in Windows Explorer:

```
OneLake - Contoso/
├── data-engineering-sandbox/
│   └── sales_lakehouse/
│       ├── Files/
│       │   ├── raw/
│       │   │   └── sales_2023.csv
│       │   └── processed/
│       └── Tables/
│           ├── customers/
│           │   ├── _delta_log/
│           │   └── part-00000.parquet
│           └── orders/
└── analytics-workspace/
    └── reporting_lakehouse/
```

## Accessing OneLake Programmatically

Beyond the explorer, access OneLake via code:

```python
# In Fabric notebooks (automatic authentication)
df = spark.read.format("delta").load("Tables/customers")

# Using the ABFS path explicitly
abfs_path = "abfss://sales_lakehouse@onelake.dfs.fabric.microsoft.com/Tables/customers"
df = spark.read.format("delta").load(abfs_path)

# List files in a directory
files = dbutils.fs.ls("Files/raw/")
for file in files:
    print(f"{file.name}: {file.size} bytes")
```

```python
# From external Python (using Azure Identity)
from azure.identity import DefaultAzureCredential
from azure.storage.filedatalake import DataLakeServiceClient

credential = DefaultAzureCredential()
service_client = DataLakeServiceClient(
    account_url="https://onelake.dfs.fabric.microsoft.com",
    credential=credential
)

# Access a workspace (container equivalent)
file_system_client = service_client.get_file_system_client(
    file_system="sales_lakehouse"  # workspace/lakehouse
)

# List paths
paths = file_system_client.get_paths(path="Files/raw")
for path in paths:
    print(path.name)
```

## Common Operations with OneLake Explorer

### Uploading Files

```python
# Via Explorer:
# 1. Navigate to Files/ folder
# 2. Drag and drop files
# 3. Files appear immediately in Fabric

# Via code (in notebook):
# For small files, use dbutils
dbutils.fs.cp("file:/tmp/local_file.csv", "Files/uploads/local_file.csv")

# For larger uploads, consider Data Pipeline
```

### Downloading Files

```python
# Via Explorer:
# 1. Navigate to the file
# 2. Copy to local drive

# Via code:
dbutils.fs.cp("Files/exports/report.csv", "file:/tmp/report.csv")
```

### Managing Delta Tables

```python
# Delta tables in OneLake have this structure:
"""
Tables/
└── customers/
    ├── _delta_log/
    │   ├── 00000000000000000000.json
    │   ├── 00000000000000000001.json
    │   └── _last_checkpoint
    ├── part-00000-xxx.snappy.parquet
    ├── part-00001-xxx.snappy.parquet
    └── part-00002-xxx.snappy.parquet
"""

# Don't manually edit these files!
# Use Spark or SQL to manage Delta tables

# View table history
history_df = spark.sql("DESCRIBE HISTORY customers")
history_df.show()

# Vacuum old files (be careful!)
spark.sql("VACUUM customers RETAIN 168 HOURS")
```

## OneLake Shortcuts

Shortcuts let you access external data without copying:

```python
# Shortcut types:
shortcut_sources = {
    "onelake": "Another Fabric workspace/lakehouse",
    "adls_gen2": "Azure Data Lake Storage Gen2",
    "s3": "Amazon S3",
    "dataverse": "Dataverse tables"
}

# Creating a shortcut via API (Python SDK)
# Note: Usually done via UI, but possible programmatically

# Shortcut appears like regular folder/table
# Data stays in original location
# No data movement or duplication
```

### Creating Shortcuts via UI

```
1. In your Lakehouse, right-click Tables or Files
2. Select "New shortcut"
3. Choose source type:
   - OneLake (another Fabric location)
   - Azure Data Lake Storage Gen2
   - Amazon S3
4. Configure connection and path
5. Name the shortcut
6. Click "Create"
```

## OneLake API Access

Access OneLake via REST API:

```python
import requests
from azure.identity import DefaultAzureCredential

# Get token
credential = DefaultAzureCredential()
token = credential.get_token("https://storage.azure.com/.default")

# OneLake REST endpoint
base_url = "https://onelake.dfs.fabric.microsoft.com"
workspace = "sales_lakehouse"
path = "Files/raw"

# List files
response = requests.get(
    f"{base_url}/{workspace}?recursive=false&resource=filesystem",
    headers={
        "Authorization": f"Bearer {token.token}",
        "x-ms-version": "2021-06-08"
    },
    params={"directory": path}
)

print(response.json())
```

## Performance Considerations

```python
# OneLake performance tips:
performance_tips = {
    "file_sizes": "Target 100MB-1GB files for optimal performance",
    "partitioning": "Use appropriate partition columns",
    "caching": "Leverage Fabric's built-in caching",
    "shortcuts": "Shortcuts have network latency for external data"
}

# Example: Optimize file sizes during write
df.repartition(10).write \
    .format("delta") \
    .option("maxRecordsPerFile", 1000000) \
    .mode("overwrite") \
    .save("Tables/optimized_table")
```

## Security and Access Control

OneLake inherits Fabric's security model:

```python
# Access is controlled at workspace level
# Item-level permissions for finer control

security_model = {
    "authentication": "Microsoft Entra ID",
    "authorization": "Workspace roles + item permissions",
    "network": "Fabric Private Links (preview)",
    "encryption": "At-rest and in-transit (automatic)"
}

# For shortcuts to external data:
# - ADLS Gen2: Uses stored credentials or SPN
# - S3: Uses IAM credentials
# - Credentials stored securely in Fabric
```

## Troubleshooting OneLake Explorer

Common issues and solutions:

```python
troubleshooting = {
    "explorer_not_showing": {
        "cause": "Sign-in issue",
        "solution": "Sign out and sign in again"
    },
    "empty_workspace": {
        "cause": "Workspace not Fabric-enabled",
        "solution": "Ensure workspace is on Fabric capacity"
    },
    "slow_performance": {
        "cause": "Large directory listings",
        "solution": "Navigate directly to subdirectories"
    },
    "permission_denied": {
        "cause": "Insufficient workspace access",
        "solution": "Request appropriate workspace role"
    }
}
```

Tomorrow we'll create our first Lakehouse and understand the structure in detail.

## Resources

- [OneLake Documentation](https://learn.microsoft.com/en-us/fabric/onelake/onelake-overview)
- [OneLake Explorer Download](https://www.microsoft.com/en-us/download/details.aspx?id=105367)
- [OneLake Shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts)
- [OneLake Security](https://learn.microsoft.com/en-us/fabric/onelake/onelake-security)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
