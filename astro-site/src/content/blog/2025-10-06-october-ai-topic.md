---
title: "Data Governance with Microsoft Purview: Implementing Data Lineage Tracking"
description: "Purview captures lineage automatically from supported sources and allows custom lineage submission via APIs. The lineage graph shows how data flows from…"
author: Michael John Peña
draft: false
date: 2025-10-06
tags:
  - Microsoft Purview
  - Data Governance
  - Data Lineage
  - Compliance
  - Data Catalog
---

## Understanding Purview Lineage Architecture

Purview captures lineage automatically from supported sources and allows custom lineage submission via APIs. The lineage graph shows how data flows from sources through transformations to destinations.

## Implementing Custom Lineage for Python ETL

When running custom ETL pipelines, submit lineage information to maintain visibility:

```python
from azure.purview.catalog import PurviewCatalogClient
from azure.identity import DefaultAzureCredential
from datetime import datetime
import uuid

class LineageTracker:
    def __init__(self, purview_account_name: str):
        self.client = PurviewCatalogClient(
            endpoint=f"https://{purview_account_name}.purview.azure.com",
            credential=DefaultAzureCredential()
        )
        self.account_name = purview_account_name

    def create_process_entity(
        self,
        process_name: str,
        inputs: list[str],
        outputs: list[str],
        description: str
    ) -> dict:
        """Create a process entity that links input and output datasets."""

        process_id = str(uuid.uuid4())

        entity = {
            "entity": {
                "typeName": "Process",
                "attributes": {
                    "name": process_name,
                    "qualifiedName": f"custom-etl://{process_name}/{process_id}",
                    "description": description,
                    "startTime": datetime.utcnow().isoformat(),
                    "inputs": [{"guid": self._get_entity_guid(inp)} for inp in inputs],
                    "outputs": [{"guid": self._get_entity_guid(out)} for out in outputs]
                },
                "status": "ACTIVE"
            }
        }

        response = self.client.entity.create_or_update(entity)
        return response

    def _get_entity_guid(self, qualified_name: str) -> str:
        """Look up entity GUID by qualified name."""
        search_result = self.client.discovery.query(
            search_request={
                "keywords": qualified_name,
                "filter": {
                    "and": [
                        {"attributeName": "qualifiedName", "operator": "eq", "attributeValue": qualified_name}
                    ]
                }
            }
        )

        if search_result.get("value"):
            return search_result["value"][0]["id"]
        return None
```

## Integrating Lineage with Data Factory

For Azure Data Factory pipelines, lineage is captured automatically. Enhance it with custom annotations:

```python
from azure.mgmt.datafactory import DataFactoryManagementClient

def add_lineage_annotations(
    adf_client: DataFactoryManagementClient,
    resource_group: str,
    factory_name: str,
    pipeline_name: str,
    lineage_metadata: dict
):
    """Add custom lineage annotations to ADF pipeline."""

    pipeline = adf_client.pipelines.get(resource_group, factory_name, pipeline_name)
    pipeline.annotations = pipeline.annotations or []
    pipeline.annotations.append({
        "purview_lineage": lineage_metadata,
        "data_classification": "confidential"
    })

    adf_client.pipelines.create_or_update(resource_group, factory_name, pipeline_name, pipeline)
```

## Querying Lineage for Impact Analysis

Before modifying source systems, query lineage to understand downstream impacts. This prevents unintended data quality issues and helps communicate changes to data consumers.
