---
title: "Azure Data Lake Storage Gen2: Foundation of Modern Data Platforms"
description: "Gen2 is the standard for new data lakes on Azure. ADLS Gen2 is the foundation. Build your data platform on solid ground."
author: Michael John Peña
draft: false
date: 2020-09-30
tags:
  - Azure
  - Data Lake
  - Storage
  - Data Engineering
---

## Why Gen2?

Gen1 vs Gen2:
- Gen1: Hadoop-first, separate service
- Gen2: Blob Storage + hierarchical namespace, unified

Gen2 is the standard for new data lakes on Azure.

## Enabling Hierarchical Namespace

```hcl
resource "azurerm_storage_account" "datalake" {
  name                     = "mydatalake"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "GRS"
  account_kind             = "StorageV2"
  is_hns_enabled           = true  # This enables Gen2 features
}
```

## Organizing Your Lake

```
datalake/
├── raw/                    # Ingested data, immutable
│   ├── sales/
│   │   ├── 2020/09/30/
│   │   └── 2020/10/01/
│   └── customers/
├── curated/               # Cleansed, transformed
│   ├── dimensions/
│   └── facts/
├── sandbox/              # Exploration, temporary
└── archive/              # Historical, rarely accessed
```

## Access Control

POSIX-style permissions + Azure RBAC:

```bash
# Set ACL on directory
az storage fs access set \
    --acl "user::rwx,group::r-x,other::---,user:data-engineers:rwx" \
    --path "curated/facts" \
    --file-system "datalake" \
    --account-name "mydatalake"
```

## Spark Integration

```python
# Direct access via abfss://
df = spark.read.parquet("abfss://datalake@mydatalake.dfs.core.windows.net/curated/facts/sales/")

# With service principal
spark.conf.set("fs.azure.account.auth.type.mydatalake.dfs.core.windows.net", "OAuth")
spark.conf.set("fs.azure.account.oauth.provider.type.mydatalake.dfs.core.windows.net",
               "org.apache.hadoop.fs.azurebfs.oauth2.ClientCredsTokenProvider")
spark.conf.set("fs.azure.account.oauth2.client.id.mydatalake.dfs.core.windows.net", "<app-id>")
```

## Best Practices

1. **Enable soft delete** for accidental deletion recovery
2. **Use lifecycle policies** for cost optimization
3. **Implement folder structure** that matches your data domains
4. **Apply ACLs** at directory level, not individual files

ADLS Gen2 is the foundation. Build your data platform on solid ground.
