---
title: "Data Governance Best Practices: From Policy to Practice"
author: Michael John Pena
draft: false
date: 2021-12-16
tags:
  - Data Governance
  - Azure Purview
  - Data Catalog
  - Compliance
  - Data Management

---

I wrote "Data Governance Best Practices: From Policy to Practice" to share practical, production-minded guidance on this topic.

## Azure Purview Setup

```bicep
// Deploy Azure Purview account
resource purviewAccount 'Microsoft.Purview/accounts@2021-07-01' = {
  name: 'enterprise-purview'
  location: resourceGroup().location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publicNetworkAccess: 'Disabled'
    managedResourceGroupName: 'purview-managed-rg'
  }
}

// Private endpoint for Purview
resource purviewPrivateEndpoint 'Microsoft.Network/privateEndpoints@2021-05-01' = {
  name: 'purview-pe'
  location: resourceGroup().location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'purview-pls'
        properties: {
          privateLinkServiceId: purviewAccount.id
          groupIds: ['account']
        }
      }
    ]
  }
}

// Grant Purview access to scan data sources
resource purviewStorageAccess 'Microsoft.Authorization/roleAssignments@2021-04-01-preview' = {
  scope: storageAccount
  name: guid(storageAccount.id, purviewAccount.id, 'storage-blob-reader')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1') // Storage Blob Data Reader
    principalId: purviewAccount.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Data Classification Framework

```python
from azure.purview.catalog import PurviewCatalogClient
from azure.purview.scanning import PurviewScanningClient
from azure.identity import DefaultAzureCredential

class DataClassificationManager:
    def __init__(self, purview_account_name: str):
        self.credential = DefaultAzureCredential()
        self.catalog_client = PurviewCatalogClient(
            endpoint=f"https://{purview_account_name}.purview.azure.com",
            credential=self.credential
        )
        self.scanning_client = PurviewScanningClient(
            endpoint=f"https://{purview_account_name}.purview.azure.com",
            credential=self.credential
        )

    def create_custom_classification(self, name: str, pattern: str, description: str):
        """Create custom classification rule"""
        classification_rule = {
            "name": name,
            "kind": "Custom",
            "properties": {
                "description": description,
                "classificationName": name,
                "ruleStatus": "Enabled",
                "createdAt": datetime.utcnow().isoformat(),
                "classificationAction": "Keep",
                "dataPatterns": [
                    {
                        "kind": "Regex",
                        "pattern": pattern
                    }
                ],
                "columnPatterns": [],
                "minimumPercentageMatch": 60
            }
        }

        return self.scanning_client.classification_rules.create_or_update(
            classification_rule_name=name,
            body=classification_rule
        )

    def create_scan_ruleset(self, name: str, classifications: list):
        """Create scan ruleset with specific classifications"""
        ruleset = {
            "name": name,
            "kind": "AzureStorage",
            "properties": {
                "description": f"Scan ruleset for {name}",
                "includedCustomClassificationRuleNames": classifications,
                "scanningRule": {
                    "fileExtensions": [".csv", ".json", ".parquet"],
                    "customFileExtensions": [],
                    "includeCsvInlineTypes": True,
                    "includeJsonInlineTypes": True
                }
            }
        }

        return self.scanning_client.scan_rulesets.create_or_update(
            scan_ruleset_name=name,
            body=ruleset
        )

# Define custom classifications
manager = DataClassificationManager("enterprise-purview")

# Customer ID pattern
manager.create_custom_classification(
    name="COMPANY.CUSTOMER_ID",
    pattern=r"CUS-[A-Z]{2}-\d{8}",
    description="Internal customer identifier format"
)

# Product SKU
manager.create_custom_classification(
    name="COMPANY.PRODUCT_SKU",
    pattern=r"SKU-[A-Z]{3}-\d{6}",
    description="Product SKU identifier"
)

# Internal employee ID
manager.create_custom_classification(
    name="COMPANY.EMPLOYEE_ID",
    pattern=r"EMP\d{6}",
    description="Employee identifier - confidential"
)
```

## Business Glossary Management

```python
class GlossaryManager:
    def __init__(self, catalog_client: PurviewCatalogClient):
        self.client = catalog_client

    def create_glossary_term(
        self,
        name: str,
        definition: str,
        parent_category: str = None,
        related_terms: list = None,
        stewards: list = None,
        experts: list = None
    ):
        """Create a business glossary term"""
        term = {
            "name": name,
            "qualifiedName": f"{name}@Glossary",
            "longDescription": definition,
            "status": "Approved",
            "anchor": {
                "glossaryGuid": self._get_glossary_guid()
            },
            "resources": [],
            "contacts": {}
        }

        if parent_category:
            term["categories"] = [{"categoryGuid": self._get_category_guid(parent_category)}]

        if related_terms:
            term["seeAlso"] = [
                {"termGuid": self._get_term_guid(t)} for t in related_terms
            ]

        if stewards:
            term["contacts"]["Steward"] = [
                {"id": s, "info": f"Data Steward: {s}"} for s in stewards
            ]

        if experts:
            term["contacts"]["Expert"] = [
                {"id": e, "info": f"Subject Matter Expert: {e}"} for e in experts
            ]

        return self.client.glossary.create_glossary_term(body=term)

    def assign_term_to_asset(self, term_guid: str, asset_guid: str, column_name: str = None):
        """Assign glossary term to a data asset"""
        assignment = {
            "guid": asset_guid,
            "relationshipType": "AtlasGlossarySemanticAssignment"
        }

        if column_name:
            assignment["attributes"] = {"columnName": column_name}

        return self.client.glossary.assign_term_to_entities(
            term_guid=term_guid,
            body=[assignment]
        )

# Build business glossary
glossary = GlossaryManager(catalog_client)

# Create hierarchy
glossary.create_glossary_term(
    name="Customer",
    definition="An individual or organization that purchases products or services",
    stewards=["data-steward@company.com"],
    experts=["customer-analytics@company.com"]
)

glossary.create_glossary_term(
    name="Customer Lifetime Value",
    definition="Predicted total revenue a customer will generate during their relationship with the company",
    parent_category="Customer Metrics",
    related_terms=["Customer", "Revenue"],
    stewards=["data-steward@company.com"]
)

glossary.create_glossary_term(
    name="Churn",
    definition="When a customer stops doing business with the company",
    parent_category="Customer Metrics",
    related_terms=["Customer", "Retention Rate"]
)
```

## Data Lineage Capture

```python
from azure.purview.catalog.models import AtlasEntity, AtlasEntitiesWithExtInfo

def capture_pipeline_lineage(
    catalog_client,
    pipeline_name: str,
    source_datasets: list,
    target_dataset: str,
    transformation_logic: str
):
    """Capture data lineage for an ETL pipeline"""

    # Create process entity
    process_entity = {
        "typeName": "azure_datafactory_pipeline",
        "attributes": {
            "name": pipeline_name,
            "qualifiedName": f"adf://factory/{pipeline_name}",
            "description": transformation_logic
        },
        "relationshipAttributes": {
            "inputs": [
                {
                    "typeName": "azure_datalake_gen2_path",
                    "uniqueAttributes": {"qualifiedName": src}
                } for src in source_datasets
            ],
            "outputs": [
                {
                    "typeName": "azure_datalake_gen2_path",
                    "uniqueAttributes": {"qualifiedName": target_dataset}
                }
            ]
        }
    }

    entities = AtlasEntitiesWithExtInfo(entities=[AtlasEntity(**process_entity)])
    return catalog_client.entity.create_or_update(body=entities)

# Capture lineage for data transformation
capture_pipeline_lineage(
    catalog_client=catalog_client,
    pipeline_name="CustomerFeatureEngineering",
    source_datasets=[
        "abfss://bronze@datalake.dfs.core.windows.net/customers/",
        "abfss://bronze@datalake.dfs.core.windows.net/transactions/"
    ],
    target_dataset="abfss://silver@datalake.dfs.core.windows.net/customer_features/",
    transformation_logic="Join customer and transaction data, calculate aggregates"
)
```

## Data Access Policies

```python
class DataAccessPolicyManager:
    def __init__(self, purview_client):
        self.client = purview_client

    def create_access_policy(
        self,
        policy_name: str,
        data_resource: str,
        principals: list,
        permissions: list,
        conditions: dict = None
    ):
        """Create data access policy"""
        policy = {
            "name": policy_name,
            "properties": {
                "description": f"Access policy for {data_resource}",
                "decisionRules": [
                    {
                        "effect": "Permit",
                        "permission": permissions,
                        "principals": [
                            {"type": "User", "id": p} if "@" in p
                            else {"type": "Group", "id": p}
                            for p in principals
                        ],
                        "resource": {
                            "type": "AzureDataLakeGen2",
                            "path": data_resource
                        }
                    }
                ],
                "collection": {
                    "type": "SqlPermissionCollection",
                    "referenceName": "root-collection"
                }
            }
        }

        if conditions:
            policy["properties"]["decisionRules"][0]["conditions"] = conditions

        return self.client.policies.create_or_update(
            policy_name=policy_name,
            body=policy
        )

# Create access policies
policy_manager = DataAccessPolicyManager(purview_client)

# Data engineers can read/write silver layer
policy_manager.create_access_policy(
    policy_name="data-engineers-silver-access",
    data_resource="abfss://silver@datalake.dfs.core.windows.net/",
    principals=["data-engineers-group-id"],
    permissions=["Read", "Write"]
)

# Analysts can only read gold layer
policy_manager.create_access_policy(
    policy_name="analysts-gold-readonly",
    data_resource="abfss://gold@datalake.dfs.core.windows.net/",
    principals=["analysts-group-id"],
    permissions=["Read"]
)

# Conditional access - only during business hours
policy_manager.create_access_policy(
    policy_name="sensitive-data-business-hours",
    data_resource="abfss://sensitive@datalake.dfs.core.windows.net/",
    principals=["authorized-users-group"],
    permissions=["Read"],
    conditions={
        "timeOfDay": {
            "start": "09:00",
            "end": "17:00",
            "timezone": "Australia/Sydney"
        }
    }
)
```

## Data Quality Integration

```python
from great_expectations.core.batch import RuntimeBatchRequest
from great_expectations.data_context import BaseDataContext

def validate_and_report_to_purview(
    data_context: BaseDataContext,
    data_asset_name: str,
    data_path: str,
    purview_client
):
    """Run data quality checks and report to Purview"""

    # Run validation
    batch_request = RuntimeBatchRequest(
        datasource_name="datalake",
        data_connector_name="runtime",
        data_asset_name=data_asset_name,
        runtime_parameters={"path": data_path},
        batch_identifiers={"batch_id": datetime.now().isoformat()}
    )

    results = data_context.run_checkpoint(
        checkpoint_name=f"{data_asset_name}_checkpoint",
        batch_request=batch_request
    )

    # Extract metrics
    quality_metrics = {
        "completeness": results.statistics["successful_expectations"] / results.statistics["evaluated_expectations"],
        "success_rate": results.success,
        "failed_expectations": [
            exp.expectation_config.expectation_type
            for exp in results.results if not exp.success
        ],
        "run_time": results.meta["run_id"]["run_time"]
    }

    # Update Purview asset with quality metadata
    asset_update = {
        "attributes": {
            "dataQualityScore": quality_metrics["completeness"],
            "lastQualityCheck": quality_metrics["run_time"],
            "qualityStatus": "Passed" if quality_metrics["success_rate"] else "Failed"
        },
        "customAttributes": {
            "failedExpectations": json.dumps(quality_metrics["failed_expectations"])
        }
    }

    purview_client.entity.partial_update_entity_by_unique_attribute(
        type_name="azure_datalake_gen2_path",
        attr="qualifiedName",
        attr_value=data_path,
        body=asset_update
    )

    return quality_metrics
```

## Governance Metrics Dashboard

```sql
-- Data governance metrics query for Power BI
SELECT
    collection_name,
    COUNT(DISTINCT asset_guid) as total_assets,
    SUM(CASE WHEN has_classification = 1 THEN 1 ELSE 0 END) as classified_assets,
    SUM(CASE WHEN has_glossary_term = 1 THEN 1 ELSE 0 END) as documented_assets,
    SUM(CASE WHEN has_owner = 1 THEN 1 ELSE 0 END) as owned_assets,
    AVG(data_quality_score) as avg_quality_score,
    ROUND(
        SUM(CASE WHEN has_classification = 1 THEN 1 ELSE 0 END) * 100.0 /
        COUNT(DISTINCT asset_guid), 2
    ) as classification_coverage_pct
FROM purview_asset_inventory
GROUP BY collection_name
ORDER BY total_assets DESC;
```

## Key Governance Practices for 2021

1. **Start with Business Value**: Focus on high-impact data assets first
2. **Automate Classification**: Manual classification doesn't scale
3. **Federate Stewardship**: Domain teams own their data
4. **Measure Coverage**: Track governance metrics over time
5. **Integrate with Workflows**: Governance in the flow of work

Data governance in 2021 moved from documentation exercise to operational capability. Azure Purview provides the foundation; success depends on organizational commitment.

## Resources

- [Azure Purview Documentation](https://docs.microsoft.com/en-us/azure/purview/)
- [Data Governance Framework](https://www.dama.org/cpages/body-of-knowledge)
- [Data Mesh and Governance](https://martinfowler.com/articles/data-mesh-principles.html)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
