---
title: "Azure Purview (Preview): Unified Data Governance"
description: "Microsoft announced Azure Purview at Ignite this week and the timing could not be better. Every consulting engagement I've been on this year has the same…"
author: Michael John Peña
draft: false
date: 2020-10-31
tags:
  - Azure
  - Purview
  - Data Governance
  - Data Catalog
---

Microsoft announced Azure Purview at Ignite this week and the timing could not be better. Every consulting engagement I've been on this year has the same recurring question: "where does this data live, and can we trust it?" Purview's pitch is unified governance across on-prem, multi-cloud, and SaaS—discover, catalog, classify, and lineage in one service. It's still public preview, so the rough edges are real, but it's worth getting hands on early.

**Note**: Azure Purview is in public preview. Some features may change before GA.

## Core Capabilities

- **Data Map**: Automated discovery and cataloging
- **Data Catalog**: Search and browse data assets
- **Data Estate Insights**: Governance analytics
- **Data Lineage**: Track data flow
- **Classifications**: Sensitive data detection

## Creating a Purview Account

```bash
az purview account create \
    --name mypurview \
    --resource-group myRG \
    --location eastus \
    --managed-group-name mypurview-managed
```

## Registering Data Sources

Scan Azure, on-premises, and multi-cloud sources:

### Azure Data Lake Storage

```bash
# Register source
az purview datasource create \
    --account-name mypurview \
    --name adls-source \
    --kind AzureDataLakeStore \
    --data-lake-store-name mystorageaccount
```

### Azure SQL Database

```bash
az purview datasource create \
    --account-name mypurview \
    --name sql-source \
    --kind AzureSqlDatabase \
    --server-endpoint myserver.database.windows.net
```

## Running Scans

```json
{
    "name": "weekly-scan",
    "kind": "AzureDataLakeStorageMsi",
    "properties": {
        "scanRulesetName": "AzureDataLakeStorage",
        "scanRulesetType": "System",
        "collection": {
            "referenceName": "mypurview",
            "type": "CollectionReference"
        },
        "credential": {
            "referenceName": "managed-identity",
            "credentialType": "ManagedIdentity"
        }
    },
    "scanTrigger": {
        "recurrence": {
            "frequency": "Week",
            "interval": 1,
            "startTime": "2020-10-31T00:00:00Z"
        }
    }
}
```

## Classifications

Built-in sensitive data patterns:

| Classification | Example |
|----------------|---------|
| Credit Card Number | 4111-1111-1111-1111 |
| Social Security Number | 123-45-6789 |
| Email Address | user@example.com |
| IP Address | 192.168.1.1 |
| Person Name | John Smith |

## Custom Classifications

```json
{
    "name": "EmployeeId",
    "kind": "RegexClassificationRule",
    "properties": {
        "classificationName": "CUSTOM.EmployeeId",
        "pattern": "EMP[0-9]{6}",
        "minimumPercentageMatch": 60
    }
}
```

## Data Lineage

Visualize data flow:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ SQL Server   │────▶│ Data Factory │────▶│ Data Lake    │
│ (Source)     │     │ (Transform)  │     │ (Destination)│
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Synapse      │
                     │ Analytics    │
                     └──────────────┘
```

## REST API

```python
from azure.identity import DefaultAzureCredential
from azure.purview.catalog import PurviewCatalogClient

credential = DefaultAzureCredential()
client = PurviewCatalogClient(
    endpoint="https://mypurview.purview.azure.com",
    credential=credential
)

# Search for assets
results = client.discovery.query(
    search_request={
        "keywords": "customer",
        "filter": {
            "and": [
                {"classification": "MICROSOFT.PERSONAL.EMAIL"},
                {"assetType": "Azure SQL Table"}
            ]
        }
    }
)

for result in results["value"]:
    print(f"Asset: {result['qualifiedName']}")
    print(f"Classifications: {result.get('classification', [])}")
```

## Glossary Terms

Define business vocabulary:

```json
{
    "name": "Customer",
    "longDescription": "An individual or organization that purchases products or services",
    "abbreviation": "CUST",
    "status": "Approved",
    "resources": [
        {"displayName": "Data Policy", "url": "https://..."}
    ],
    "experts": [
        {"id": "user@company.com"}
    ]
}
```

Purview: know your data, govern your data.
