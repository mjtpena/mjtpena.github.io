---
title: "Data Governance in Microsoft Fabric: Purview Integration and Compliance"
description: "Organizations struggle with data sprawl, unclear ownership, inconsistent definitions, and regulatory requirements. A unified governance approach addresses…"
author: Michael John Peña
draft: false
date: 2025-11-27
tags:
  - Data Governance
  - Microsoft Fabric
  - Purview
  - Compliance
  - Data Catalog
---

## Governance Challenges

Organizations struggle with data sprawl, unclear ownership, inconsistent definitions, and regulatory requirements. A unified governance approach addresses these challenges systematically.

## Purview Integration

Connect Fabric workspaces to Purview for automated discovery and classification:

```python
from azure.purview.catalog import PurviewCatalogClient
from azure.purview.scanning import PurviewScanningClient
from azure.identity import DefaultAzureCredential
from dataclasses import dataclass

@dataclass
class DataAsset:
    qualified_name: str
    name: str
    asset_type: str
    classifications: list[str]
    owner: str
    glossary_terms: list[str]

class FabricGovernanceManager:
    def __init__(self, purview_account: str):
        credential = DefaultAzureCredential()
        self.catalog_client = PurviewCatalogClient(
            endpoint=f"https://{purview_account}.purview.azure.com",
            credential=credential
        )
        self.scanning_client = PurviewScanningClient(
            endpoint=f"https://{purview_account}.purview.azure.com",
            credential=credential
        )

    def register_fabric_source(
        self,
        workspace_name: str,
        lakehouse_name: str
    ) -> dict:
        """Register Fabric lakehouse as a data source."""

        source_definition = {
            "kind": "FabricLakehouse",
            "properties": {
                "endpoint": f"https://{workspace_name}.fabric.microsoft.com",
                "lakehouse": lakehouse_name,
                "collection": {
                    "referenceName": "Fabric-Data",
                    "type": "CollectionReference"
                }
            }
        }

        result = self.scanning_client.data_sources.create_or_update(
            data_source_name=f"fabric-{workspace_name}-{lakehouse_name}",
            body=source_definition
        )

        return result

    def setup_scan_schedule(
        self,
        data_source_name: str,
        scan_name: str,
        schedule_cron: str = "0 0 * * 0"  # Weekly
    ):
        """Configure automated scanning for data discovery."""

        scan_definition = {
            "kind": "FabricLakehouseMsi",
            "properties": {
                "scanRulesetName": "FabricLakehouse",
                "collection": {
                    "referenceName": "Fabric-Data",
                    "type": "CollectionReference"
                }
            }
        }

        # Create scan
        self.scanning_client.scans.create_or_update(
            data_source_name=data_source_name,
            scan_name=scan_name,
            body=scan_definition
        )

        # Set schedule
        trigger = {
            "properties": {
                "scanLevel": "Incremental",
                "schedule": {
                    "frequency": "Week",
                    "interval": 1,
                    "schedule": {
                        "hours": [0],
                        "minutes": [0],
                        "weekDays": ["Sunday"]
                    }
                }
            }
        }

        self.scanning_client.triggers.create_or_update(
            data_source_name=data_source_name,
            scan_name=scan_name,
            trigger_name="weekly-scan",
            body=trigger
        )

    def apply_classification(
        self,
        asset_qualified_name: str,
        classifications: list[str]
    ):
        """Apply data classifications to assets."""

        classification_body = {
            "classifications": [
                {"typeName": c} for c in classifications
            ]
        }

        self.catalog_client.entity.add_classifications(
            guid=self._get_asset_guid(asset_qualified_name),
            body=classification_body
        )

    def set_data_owner(
        self,
        asset_qualified_name: str,
        owner_email: str
    ):
        """Assign data ownership for accountability."""

        entity = self.catalog_client.entity.get_by_unique_attributes(
            type_name="DataSet",
            qualified_name=asset_qualified_name
        )

        entity["entity"]["attributes"]["owner"] = owner_email

        self.catalog_client.entity.create_or_update(
            entity=entity
        )
```

## Business Glossary

Define consistent terminology across the organization:

```python
class GlossaryManager:
    def __init__(self, catalog_client: PurviewCatalogClient):
        self.client = catalog_client

    def create_term(
        self,
        name: str,
        definition: str,
        category: str,
        synonyms: list[str] = None,
        related_terms: list[str] = None
    ) -> dict:
        """Create a business glossary term."""

        term = {
            "name": name,
            "qualifiedName": f"glossary@{name}",
            "longDescription": definition,
            "anchor": {
                "glossaryGuid": self._get_default_glossary_guid()
            },
            "resources": [
                {"displayName": "Category", "url": category}
            ]
        }

        if synonyms:
            term["synonyms"] = [
                {"termGuid": self._get_or_create_synonym(s)}
                for s in synonyms
            ]

        result = self.client.glossary.create_glossary_term(body=term)
        return result

    def link_term_to_asset(
        self,
        term_guid: str,
        asset_qualified_name: str
    ):
        """Associate glossary term with data asset."""

        asset_guid = self._get_asset_guid(asset_qualified_name)

        self.client.glossary.assign_term_to_entities(
            term_guid=term_guid,
            body=[{"guid": asset_guid}]
        )
```

Data governance with Fabric and Purview creates a foundation for trusted analytics. Automated discovery, consistent definitions, and clear ownership enable self-service while maintaining control.
