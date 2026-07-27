---
title: "Azure Purview: Unified Data Governance"
author: Michael John Peña
draft: false
date: 2021-01-15
tags:
  - Azure
  - Purview
  - Data Governance
  - Data Catalog

---

I wrote "Azure Purview: Unified Data Governance" to share practical, production-minded guidance on this topic.

## Create Purview Account

```bash
# Create Purview account
az purview account create \
    --name my-purview \
    --resource-group myRG \
    --location eastus \
    --managed-group-name purview-managed-rg
```

## Register Data Sources

```python
from azure.identity import DefaultAzureCredential
from azure.purview.scanning import PurviewScanningClient
from azure.purview.catalog import PurviewCatalogClient

credential = DefaultAzureCredential()

# Scanning client for data source registration
scanning_client = PurviewScanningClient(
    endpoint="https://my-purview.purview.azure.com",
    credential=credential
)

# Register Azure SQL Database
sql_source = {
    "kind": "AzureSqlDatabase",
    "properties": {
        "serverEndpoint": "myserver.database.windows.net",
        "resourceGroup": "myRG",
        "subscriptionId": "subscription-id",
        "resourceName": "myserver",
        "resourceId": "/subscriptions/.../Microsoft.Sql/servers/myserver",
        "collection": {
            "referenceName": "my-purview",
            "type": "CollectionReference"
        }
    }
}

scanning_client.data_sources.create_or_update("azure-sql-source", sql_source)
```

## Configure and Run Scans

```python
# Create scan
scan_definition = {
    "kind": "AzureSqlDatabaseCredential",
    "properties": {
        "credential": {
            "referenceName": "sql-credential",
            "credentialType": "SqlAuth"
        },
        "serverEndpoint": "myserver.database.windows.net",
        "databaseName": "SalesDB"
    }
}

scanning_client.scans.create_or_update(
    "azure-sql-source",
    "weekly-scan",
    scan_definition
)

# Create scan rule set
scan_ruleset = {
    "kind": "AzureSqlDatabase",
    "properties": {
        "scanningRule": {
            "fileExtensions": [],
            "customClassificationRules": [],
            "systemClassificationRuleNames": [
                "MICROSOFT.FINANCIAL.US.SSN",
                "MICROSOFT.FINANCIAL.CREDIT_CARD_NUMBER",
                "MICROSOFT.PERSONAL.EMAIL",
                "MICROSOFT.PERSONAL.PHONE_NUMBER"
            ]
        }
    }
}

# Run scan
scanning_client.scan_result.run_scan(
    "azure-sql-source",
    "weekly-scan",
    "unique-run-id"
)
```

## Search Data Catalog

```python
catalog_client = PurviewCatalogClient(
    endpoint="https://my-purview.purview.azure.com",
    credential=credential
)

# Search for assets
search_results = catalog_client.discovery.query(
    search_request={
        "keywords": "customer",
        "filter": {
            "and": [
                {"objectType": "Tables"},
                {"classification": "MICROSOFT.PERSONAL.EMAIL"}
            ]
        },
        "limit": 25
    }
)

for result in search_results["value"]:
    print(f"Name: {result['name']}")
    print(f"Type: {result['entityType']}")
    print(f"Classifications: {result.get('classification', [])}")
    print("---")
```

## Data Lineage

```python
# Get lineage for an asset
asset_guid = "asset-guid-here"

lineage = catalog_client.lineage.get_lineage_graph(
    guid=asset_guid,
    direction="BOTH",
    depth=3
)

print("Upstream sources:")
for node in lineage["guidEntityMap"].values():
    if node["typeName"] in ["azure_sql_table", "azure_blob_path"]:
        print(f"  {node['attributes']['name']}")

# Lineage is automatically captured from:
# - Azure Data Factory pipelines
# - Synapse pipelines
# - Databricks notebooks (with connector)
```

## Glossary Terms

```python
# Create glossary term
term = {
    "name": "Customer PII",
    "qualifiedName": "customer-pii@Glossary",
    "anchor": {
        "glossaryGuid": "glossary-guid"
    },
    "status": "Approved",
    "longDescription": "Personal identifiable information related to customers",
    "abbreviation": "PII"
}

catalog_client.glossary.create_glossary_term(term)

# Assign term to asset
catalog_client.entity.add_classification(
    guid=asset_guid,
    classifications=[{
        "typeName": "Customer PII",
        "attributes": {}
    }]
)
```

## Access Policies

```json
{
    "name": "data-reader-policy",
    "decisionRules": [
        {
            "effect": "Permit",
            "dnfCondition": [[
                {
                    "attributeName": "resource.collection",
                    "attributeValueIncludes": "finance-collection"
                },
                {
                    "attributeName": "subject.group",
                    "attributeValueIncludes": "finance-analysts"
                }
            ]]
        }
    ]
}
```

## Insights and Reporting

```python
# Get scan insights
insights = catalog_client.discovery.query(
    search_request={
        "keywords": "*",
        "facets": [
            {"facet": "classification", "count": 10},
            {"facet": "objectType", "count": 10},
            {"facet": "assetType", "count": 10}
        ]
    }
)

print("Classification distribution:")
for facet in insights["@search.facets"]["classification"]:
    print(f"  {facet['value']}: {facet['count']}")
```

Azure Purview: know your data, govern your data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
