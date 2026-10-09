---
title: Azure Data Lake Storage Gen2 - Building Modern Data Lakes
description: "ADLS Gen2 is the storage layer that most enterprise data platforms in Australia are converging on. The combination of blob-scale storage (petabytes, low…"
author: Michael John Peña
draft: false
date: 2021-04-13
url: /blog/azure-data-lake-storage-gen2-fundamentals/
tags:
  - Azure
  - Data Lake
  - ADLS Gen2
  - Big Data
  - Storage
---

ADLS Gen2 is the storage layer that most enterprise data platforms in Australia are converging on. The combination of blob-scale storage (petabytes, low cost per GB, tiering), a hierarchical namespace for directory-level operations, and HNS-compatible ACLs gives you something neither raw blob storage nor POSIX filesystems quite achieved. Synapse Analytics, Databricks, HDInsight, and Azure ML all read it natively. The decisions that matter on day one: filesystem layout (one container per zone—raw/bronze/silver/gold is the pattern I use most), ACL strategy (security group–based, not individual-user), and whether to enable hierarchical namespace at creation, because you can't change it after the fact.

## What is ADLS Gen2?

ADLS Gen2 adds hierarchical namespace (HNS) to Azure Blob Storage, enabling:

- **True directory operations** - Atomic renames and deletes
- **POSIX-compliant ACLs** - Fine-grained access control
- **Hadoop compatibility** - ABFS driver for big data tools
- **Blob storage features** - Tiering, lifecycle management, encryption

## Creating a Data Lake

### Using Azure CLI

```bash
# Create storage account with hierarchical namespace
az storage account create \
    --name mydatalake \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard_LRS \
    --kind StorageV2 \
    --enable-hierarchical-namespace true \
    --allow-blob-public-access false

# Create file systems (containers)
az storage fs create \
    --name raw \
    --account-name mydatalake \
    --auth-mode login

az storage fs create \
    --name curated \
    --account-name mydatalake \
    --auth-mode login
```

### Using Terraform

```hcl
resource "azurerm_storage_account" "datalake" {
  name                     = "mydatalake"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  is_hns_enabled           = true

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 7
    }
  }

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
    virtual_network_subnet_ids = [
      azurerm_subnet.data.id
    ]
  }

  tags = {
    Environment = "Production"
    Purpose     = "DataLake"
  }
}

resource "azurerm_storage_data_lake_gen2_filesystem" "raw" {
  name               = "raw"
  storage_account_id = azurerm_storage_account.datalake.id
}

resource "azurerm_storage_data_lake_gen2_filesystem" "curated" {
  name               = "curated"
  storage_account_id = azurerm_storage_account.datalake.id
}
```

## Data Lake Architecture Patterns

### Medallion Architecture (Bronze/Silver/Gold)

```
raw/                    # Bronze - Raw ingested data
├── sales/
│   ├── 2021/04/13/
│   │   ├── orders_001.json
│   │   └── orders_002.json
│   └── _checkpoints/
├── inventory/
└── customers/

curated/                # Silver - Cleansed and validated
├── sales/
│   ├── orders/
│   │   └── year=2021/month=04/
│   └── order_items/
├── inventory/
└── customers/

analytics/              # Gold - Business-level aggregates
├── sales_summary/
├── customer_360/
└── inventory_metrics/
```

### Zone-Based Architecture

```
landing/                # Temporary landing zone
├── batch/
└── streaming/

raw/                    # Immutable raw data
├── internal/
│   ├── erp/
│   └── crm/
└── external/
    ├── vendors/
    └── market_data/

enriched/               # Processed and enriched
├── master_data/
└── reference_data/

curated/                # Business-ready datasets
├── sales/
├── finance/
└── operations/

sandbox/                # Exploration and development
├── data_science/
└── experiments/
```

## Working with ADLS Gen2

### Python with azure-storage-file-datalake

```python
from azure.storage.filedatalake import DataLakeServiceClient
from azure.identity import DefaultAzureCredential
import pandas as pd
from io import BytesIO

# Initialize client
credential = DefaultAzureCredential()
service_client = DataLakeServiceClient(
    account_url="https://mydatalake.dfs.core.windows.net",
    credential=credential
)

# Get file system client
file_system_client = service_client.get_file_system_client("raw")

# Create directory
directory_client = file_system_client.create_directory("sales/2021/04/13")

# Upload file
file_client = directory_client.create_file("orders.json")
with open("local_orders.json", "rb") as f:
    file_client.upload_data(f.read(), overwrite=True)

# Upload with append (for large files)
file_client = directory_client.create_file("large_file.csv")
file_client.append_data(data=chunk1, offset=0, length=len(chunk1))
file_client.append_data(data=chunk2, offset=len(chunk1), length=len(chunk2))
file_client.flush_data(len(chunk1) + len(chunk2))

# Read file into DataFrame
file_client = file_system_client.get_file_client("curated/sales/orders.parquet")
download = file_client.download_file()
df = pd.read_parquet(BytesIO(download.readall()))

# List directory contents
paths = file_system_client.get_paths(path="sales/2021")
for path in paths:
    print(f"{path.name} - {'Directory' if path.is_directory else 'File'} - {path.last_modified}")
```

### PySpark Integration

```python
from pyspark.sql import SparkSession

spark = SparkSession.builder \
    .appName("DataLakeDemo") \
    .config("spark.hadoop.fs.azure.account.auth.type.mydatalake.dfs.core.windows.net", "OAuth") \
    .config("spark.hadoop.fs.azure.account.oauth.provider.type.mydatalake.dfs.core.windows.net",
            "org.apache.hadoop.fs.azurebfs.oauth2.ClientCredsTokenProvider") \
    .config("spark.hadoop.fs.azure.account.oauth2.client.id.mydatalake.dfs.core.windows.net", client_id) \
    .config("spark.hadoop.fs.azure.account.oauth2.client.secret.mydatalake.dfs.core.windows.net", client_secret) \
    .config("spark.hadoop.fs.azure.account.oauth2.client.endpoint.mydatalake.dfs.core.windows.net",
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/token") \
    .getOrCreate()

# Read from Data Lake
df = spark.read.parquet("abfss://curated@mydatalake.dfs.core.windows.net/sales/orders/")

# Process data
result = df.groupBy("customer_id") \
    .agg(
        sum("amount").alias("total_amount"),
        count("order_id").alias("order_count")
    )

# Write back to Data Lake
result.write \
    .mode("overwrite") \
    .partitionBy("year", "month") \
    .parquet("abfss://analytics@mydatalake.dfs.core.windows.net/customer_summary/")
```

### Azure Data Factory Integration

```json
{
  "name": "ADLS_LinkedService",
  "type": "Microsoft.DataFactory/factories/linkedservices",
  "properties": {
    "type": "AzureBlobFS",
    "typeProperties": {
      "url": "https://mydatalake.dfs.core.windows.net",
      "accountKey": {
        "type": "SecureString",
        "value": "account-key"
      }
    }
  }
}
```

Or with Managed Identity:

```json
{
  "name": "ADLS_MI_LinkedService",
  "properties": {
    "type": "AzureBlobFS",
    "typeProperties": {
      "url": "https://mydatalake.dfs.core.windows.net"
    },
    "connectVia": {
      "referenceName": "AutoResolveIntegrationRuntime",
      "type": "IntegrationRuntimeReference"
    }
  }
}
```

## Storage Tiers and Lifecycle Management

### Configure Lifecycle Policy

```json
{
  "rules": [
    {
      "name": "archiveOldData",
      "enabled": true,
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["raw/"]
        },
        "actions": {
          "baseBlob": {
            "tierToCool": {
              "daysAfterModificationGreaterThan": 30
            },
            "tierToArchive": {
              "daysAfterModificationGreaterThan": 90
            },
            "delete": {
              "daysAfterModificationGreaterThan": 365
            }
          }
        }
      }
    },
    {
      "name": "deleteOldSnapshots",
      "enabled": true,
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"]
        },
        "actions": {
          "snapshot": {
            "delete": {
              "daysAfterCreationGreaterThan": 90
            }
          }
        }
      }
    }
  ]
}
```

### Programmatic Tier Management

```python
from azure.storage.filedatalake import DataLakeServiceClient

def set_blob_tier(file_system, path, tier):
    """Set access tier for a blob"""
    file_client = file_system.get_file_client(path)
    # Note: Tier changes are eventually consistent
    file_client.set_access_tier(tier)  # Hot, Cool, Archive

# Archive old files
from datetime import datetime, timedelta

paths = file_system.get_paths(path="raw/sales/2020")
for path in paths:
    if not path.is_directory:
        age = datetime.utcnow() - path.last_modified.replace(tzinfo=None)
        if age > timedelta(days=90):
            set_blob_tier(file_system, path.name, "Archive")
            print(f"Archived: {path.name}")
```

## Security Best Practices

### Network Security

```bash
# Enable service endpoint
az network vnet subnet update \
    --name data-subnet \
    --vnet-name my-vnet \
    --resource-group myResourceGroup \
    --service-endpoints Microsoft.Storage

# Configure firewall rules
az storage account network-rule add \
    --account-name mydatalake \
    --vnet-name my-vnet \
    --subnet data-subnet

# Enable private endpoint
az network private-endpoint create \
    --name mydatalake-pe \
    --resource-group myResourceGroup \
    --vnet-name my-vnet \
    --subnet private-endpoints \
    --private-connection-resource-id $(az storage account show -n mydatalake -g myResourceGroup --query id -o tsv) \
    --group-id dfs \
    --connection-name mydatalake-connection
```

### Encryption

```bash
# Enable infrastructure encryption
az storage account create \
    --name mydatalake \
    --resource-group myResourceGroup \
    --require-infrastructure-encryption true

# Use customer-managed keys
az storage account update \
    --name mydatalake \
    --resource-group myResourceGroup \
    --encryption-key-source Microsoft.Keyvault \
    --encryption-key-vault https://mykeyvault.vault.azure.net \
    --encryption-key-name storage-encryption-key
```

## Monitoring and Diagnostics

### Enable Diagnostic Settings

```bash
az monitor diagnostic-settings create \
    --name datalake-diagnostics \
    --resource $(az storage account show -n mydatalake -g myResourceGroup --query id -o tsv) \
    --logs '[{"category": "StorageRead", "enabled": true}, {"category": "StorageWrite", "enabled": true}, {"category": "StorageDelete", "enabled": true}]' \
    --metrics '[{"category": "Transaction", "enabled": true}]' \
    --workspace $(az monitor log-analytics workspace show -n myworkspace -g myResourceGroup --query id -o tsv)
```

### Query Logs

```kusto
// Storage operations by path
StorageBlobLogs
| where TimeGenerated > ago(24h)
| where Uri contains "raw/sales"
| summarize count() by OperationName, bin(TimeGenerated, 1h)
| render timechart

// Failed operations
StorageBlobLogs
| where TimeGenerated > ago(24h)
| where StatusCode >= 400
| summarize count() by StatusCode, StatusText, CallerIpAddress
| order by count_ desc

// Data egress by user
StorageBlobLogs
| where TimeGenerated > ago(7d)
| where OperationName == "GetBlob"
| summarize TotalBytes = sum(ResponseBodySize) by UserAgentHeader
| order by TotalBytes desc
```

## Best Practices Summary

1. **Enable hierarchical namespace** - Essential for data lake workloads
2. **Design folder structure carefully** - Supports both analytics and governance
3. **Use partitioning** - Organize by date or key attributes
4. **Implement lifecycle management** - Optimize costs with tiering
5. **Use managed identity** - Avoid key-based authentication
6. **Enable soft delete** - Protect against accidental deletion
7. **Monitor access patterns** - Understand usage and optimize

## Conclusion

ADLS Gen2 provides the foundation for modern data architectures, combining the scale of object storage with the semantics needed for analytics workloads. By understanding the architecture patterns, access methods, and security options, you can build data lakes that serve your organization's analytics needs while maintaining proper governance and cost efficiency.
