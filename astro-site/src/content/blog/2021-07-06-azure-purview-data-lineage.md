---
title: Understanding Data Lineage with Azure Purview
author: Michael John Peña
draft: false
date: 2021-07-06
url: /blog/azure-purview-data-lineage/
tags:
  - Azure
  - Data
  - Governance
  - Purview
  - Data Lineage

---

I wrote "2021-07-06-azure-purview-data-lineage" to share practical, production-minded guidance on this topic.

# Setting Up Azure Purview

Create and configure an Azure Purview account:

```bash
# Create resource group
az group create --name rg-purview --location eastus

# Create Purview account
az purview account create \
    --resource-group rg-purview \
    --name purview-data-governance \
    --location eastus \
    --managed-group-name purview-managed-rg

# Get Purview endpoints
az purview account show \
    --resource-group rg-purview \
    --name purview-data-governance \
    --query "{catalog: endpoints.catalog, scan: endpoints.scan}"
```

# Registering Data Sources

Register various data sources for lineage tracking:

```python
from azure.purview.catalog import PurviewCatalogClient
from azure.purview.scanning import PurviewScanningClient
from azure.identity import DefaultAzureCredential

# Initialize clients
credential = DefaultAzureCredential()
catalog_client = PurviewCatalogClient(
    endpoint="https://purview-data-governance.purview.azure.com",
    credential=credential
)
scanning_client = PurviewScanningClient(
    endpoint="https://purview-data-governance.scan.purview.azure.com",
    credential=credential
)

# Register Azure Data Lake Storage
adls_source = {
    "kind": "AdlsGen2",
    "name": "enterprise-data-lake",
    "properties": {
        "endpoint": "https://mydatalake.dfs.core.windows.net/",
        "resourceGroup": "rg-data",
        "subscriptionId": "subscription-id",
        "collection": {
            "referenceName": "DataSources",
            "type": "CollectionReference"
        }
    }
}
scanning_client.data_sources.create_or_update("enterprise-data-lake", adls_source)

# Register Azure SQL Database
sql_source = {
    "kind": "AzureSqlDatabase",
    "name": "sales-database",
    "properties": {
        "serverEndpoint": "sqlserver.database.windows.net",
        "resourceGroup": "rg-data",
        "subscriptionId": "subscription-id",
        "collection": {
            "referenceName": "DataSources",
            "type": "CollectionReference"
        }
    }
}
scanning_client.data_sources.create_or_update("sales-database", sql_source)

# Register Synapse workspace
synapse_source = {
    "kind": "AzureSynapseWorkspace",
    "name": "analytics-synapse",
    "properties": {
        "dedicatedSqlEndpoint": "synapse-ws.sql.azuresynapse.net",
        "serverlessSqlEndpoint": "synapse-ws-ondemand.sql.azuresynapse.net",
        "resourceGroup": "rg-analytics",
        "subscriptionId": "subscription-id"
    }
}
scanning_client.data_sources.create_or_update("analytics-synapse", synapse_source)
```

# Configuring Scans

Set up scans to discover and catalog data:

```python
# Create a scan for ADLS
scan_definition = {
    "kind": "AdlsGen2Msi",
    "name": "weekly-full-scan",
    "properties": {
        "scanRulesetName": "AdlsGen2",
        "scanRulesetType": "System",
        "collection": {
            "referenceName": "DataAssets",
            "type": "CollectionReference"
        }
    }
}

scanning_client.scans.create_or_update(
    data_source_name="enterprise-data-lake",
    scan_name="weekly-full-scan",
    body=scan_definition
)

# Create scan trigger for weekly execution
trigger = {
    "name": "weekly-trigger",
    "properties": {
        "scanLevel": "Full",
        "recurrence": {
            "frequency": "Week",
            "interval": 1,
            "startTime": "2021-07-06T00:00:00Z",
            "timezone": "UTC",
            "schedule": {
                "weekDays": ["Sunday"],
                "hours": [2],
                "minutes": [0]
            }
        }
    }
}

scanning_client.triggers.create_or_update(
    data_source_name="enterprise-data-lake",
    scan_name="weekly-full-scan",
    trigger_name="weekly-trigger",
    body=trigger
)
```

# Data Factory Lineage Integration

Azure Data Factory automatically pushes lineage to Purview:

```python
from azure.mgmt.datafactory import DataFactoryManagementClient
from azure.mgmt.datafactory.models import *

# Create a pipeline with lineage tracking
pipeline = PipelineResource(
    activities=[
        CopyActivity(
            name="CopyToDataLake",
            inputs=[
                DatasetReference(
                    reference_name="SqlSourceDataset",
                    type="DatasetReference"
                )
            ],
            outputs=[
                DatasetReference(
                    reference_name="AdlsSinkDataset",
                    type="DatasetReference"
                )
            ],
            source=SqlSource(
                sql_reader_query="SELECT * FROM Sales.Orders WHERE OrderDate >= @{pipeline().parameters.StartDate}"
            ),
            sink=ParquetSink(
                store_settings=AzureBlobFSWriteSettings()
            )
        ),
        DataFlowActivity(
            name="TransformData",
            data_flow=DataFlowReference(
                reference_name="TransformOrdersFlow",
                type="DataFlowReference"
            ),
            staging=DataFlowStagingInfo(
                linked_service=LinkedServiceReference(
                    reference_name="StagingStorage",
                    type="LinkedServiceReference"
                ),
                folder_path="staging"
            )
        )
    ],
    parameters={
        "StartDate": ParameterSpecification(type="String")
    }
)

# The lineage is automatically captured when pipeline runs
# Purview shows: SQL Table -> Copy Activity -> Parquet Files -> Data Flow -> Output
```

# Querying Lineage

Use the Purview API to query lineage information:

```python
# Get lineage for a specific asset
def get_asset_lineage(asset_guid, direction="BOTH", depth=3):
    lineage = catalog_client.lineage.get_lineage_graph(
        guid=asset_guid,
        direction=direction,
        depth=depth
    )
    return lineage

# Search for an asset
search_results = catalog_client.discovery.query(
    search_request={
        "keywords": "sales_orders",
        "filter": {
            "and": [
                {"entityType": "azure_datalake_gen2_path"},
                {"classification": "Microsoft.Personal.Name"}
            ]
        }
    }
)

# Get lineage for found asset
if search_results.value:
    asset_guid = search_results.value[0]["id"]
    lineage = get_asset_lineage(asset_guid)

    # Parse lineage graph
    print("Upstream dependencies:")
    for relation in lineage.get("guidEntityMap", {}).values():
        if relation.get("typeName") == "DataSet":
            print(f"  - {relation.get('attributes', {}).get('qualifiedName')}")

# Get impact analysis (downstream dependencies)
def get_downstream_impact(asset_guid):
    return catalog_client.lineage.get_lineage_graph(
        guid=asset_guid,
        direction="OUTPUT",
        depth=5
    )
```

# Custom Lineage with Apache Atlas API

Push custom lineage for non-Azure sources:

```python
import json

# Define custom lineage entity
custom_lineage = {
    "entities": [
        {
            "typeName": "Process",
            "attributes": {
                "name": "ETL_External_Data_Load",
                "qualifiedName": "etl://external/data_load@enterprise",
                "description": "Loads data from external FTP server"
            },
            "relationshipAttributes": {
                "inputs": [
                    {
                        "typeName": "DataSet",
                        "uniqueAttributes": {
                            "qualifiedName": "ftp://external.server.com/data/orders.csv"
                        }
                    }
                ],
                "outputs": [
                    {
                        "typeName": "azure_datalake_gen2_path",
                        "uniqueAttributes": {
                            "qualifiedName": "https://mydatalake.dfs.core.windows.net/raw/external/orders"
                        }
                    }
                ]
            }
        }
    ]
}

# Push custom lineage
response = catalog_client.entity.create_or_update(custom_lineage)
print(f"Created lineage entity: {response}")

# Create custom process type if needed
custom_type = {
    "entityDefs": [
        {
            "name": "custom_etl_process",
            "superTypes": ["Process"],
            "attributeDefs": [
                {
                    "name": "etlTool",
                    "typeName": "string",
                    "cardinality": "SINGLE"
                },
                {
                    "name": "scheduleFrequency",
                    "typeName": "string",
                    "cardinality": "SINGLE"
                }
            ]
        }
    ]
}

catalog_client.types.create_type_definitions(custom_type)
```

# Synapse Spark Lineage

Capture Spark job lineage in Synapse:

```python
# Spark notebook with lineage tracking
from pyspark.sql import SparkSession

# Read source data
source_df = spark.read.parquet(
    "abfss://raw@mydatalake.dfs.core.windows.net/sales/orders/"
)

# Transform data
transformed_df = source_df \
    .filter("order_date >= '2021-01-01'") \
    .groupBy("customer_id", "product_category") \
    .agg(
        sum("amount").alias("total_amount"),
        count("*").alias("order_count")
    )

# Write to curated zone - lineage automatically captured
transformed_df.write \
    .format("delta") \
    .mode("overwrite") \
    .save("abfss://curated@mydatalake.dfs.core.windows.net/sales/customer_summary/")

# The lineage shows:
# raw/sales/orders/ (Parquet) -> Spark Notebook -> curated/sales/customer_summary/ (Delta)
```

# Viewing Lineage in Purview Studio

The Purview Studio provides a visual lineage graph:

```python
# Generate lineage report
def generate_lineage_report(asset_name):
    # Search for the asset
    search = catalog_client.discovery.query({
        "keywords": asset_name,
        "limit": 1
    })

    if not search.value:
        return None

    asset_guid = search.value[0]["id"]

    # Get full lineage
    lineage = catalog_client.lineage.get_lineage_graph(
        guid=asset_guid,
        direction="BOTH",
        depth=10
    )

    report = {
        "asset_name": asset_name,
        "asset_guid": asset_guid,
        "upstream_count": 0,
        "downstream_count": 0,
        "upstream_assets": [],
        "downstream_assets": [],
        "processes": []
    }

    for guid, entity in lineage.get("guidEntityMap", {}).items():
        entity_type = entity.get("typeName")
        qualified_name = entity.get("attributes", {}).get("qualifiedName", "")

        if entity_type == "Process":
            report["processes"].append({
                "name": entity.get("attributes", {}).get("name"),
                "type": entity_type
            })
        elif guid != asset_guid:
            # Determine if upstream or downstream based on relations
            if "inputs" in str(lineage.get("relations", [])):
                report["upstream_assets"].append(qualified_name)
                report["upstream_count"] += 1
            else:
                report["downstream_assets"].append(qualified_name)
                report["downstream_count"] += 1

    return report

# Generate report
report = generate_lineage_report("customer_summary")
print(json.dumps(report, indent=2))
```

# Conclusion

Azure Purview provides comprehensive data lineage tracking that is essential for data governance and compliance. By integrating with Azure Data Factory, Synapse Analytics, and other services, you get automatic lineage capture without additional development effort.

The ability to query lineage programmatically enables impact analysis, helping you understand the downstream effects of data changes. Combined with Purview's data catalog and classification capabilities, lineage tracking gives you complete visibility into your data estate.

