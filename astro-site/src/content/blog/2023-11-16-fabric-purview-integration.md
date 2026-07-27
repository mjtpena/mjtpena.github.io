---
title: "Microsoft Purview and Fabric: Enterprise Data Governance"
author: "Michael John Peña"
draft: false
date: 2023-11-16
tags: ["Microsoft Fabric", "Purview", "Data Governance", "Data Catalog", "Compliance"]

---

I wrote "Microsoft Purview and Fabric: Enterprise Data Governance" to share practical, production-minded guidance on this topic.

Microsoft Purview and Fabric integration is the enterprise governance story that matters most for regulated industries and large organisations where data governance isn't an afterthought but a compliance requirement. Purview Data Catalog automatically scans Fabric workspaces and registers Lakehouse tables, Warehouse schemas, semantic models, and Dataflow lineage as assets in the enterprise data catalog — no manual registration required. Purview Information Protection sensitivity labels apply to Fabric items through the same label taxonomy used for Microsoft 365 documents, so a dataset labelled "Confidential" in Purview carries that label into downstream reports. And Purview Data Policy (in preview as of late 2023) allows defining data access policies at the Purview level that enforce in Fabric — centralising access governance rather than having each Fabric workspace admin manage permissions independently.

## Purview Integration Overview

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class PurviewCapability(Enum):
    DATA_CATALOG = "Data Catalog"
    DATA_MAP = "Data Map"
    DATA_LINEAGE = "Data Lineage"
    DATA_CLASSIFICATION = "Data Classification"
    SENSITIVITY_LABELS = "Sensitivity Labels"
    DATA_QUALITY = "Data Quality"
    BUSINESS_GLOSSARY = "Business Glossary"
    DATA_SHARING = "Data Sharing"

@dataclass
class PurviewFabricIntegration:
    fabric_workspace: str
    purview_account: str
    capabilities: List[PurviewCapability]
    auto_scan: bool
    scan_frequency: str

# Example integration configuration
integration = PurviewFabricIntegration(
    fabric_workspace="Sales-Analytics-Prod",
    purview_account="company-purview",
    capabilities=[
        PurviewCapability.DATA_CATALOG,
        PurviewCapability.DATA_MAP,
        PurviewCapability.DATA_LINEAGE,
        PurviewCapability.DATA_CLASSIFICATION,
        PurviewCapability.SENSITIVITY_LABELS
    ],
    auto_scan=True,
    scan_frequency="daily"
)
```

## Automatic Asset Discovery

Purview automatically discovers and catalogs Fabric assets:

```python
import requests
from azure.identity import DefaultAzureCredential
from typing import List

class PurviewClient:
    def __init__(self, account_name: str):
        self.account_name = account_name
        self.base_url = f"https://{account_name}.purview.azure.com"
        self.credential = DefaultAzureCredential()

    def _get_token(self) -> str:
        token = self.credential.get_token("https://purview.azure.net/.default")
        return token.token

    def search_assets(self, query: str, filter_type: str = None) -> List[dict]:
        """Search for assets in the catalog."""
        headers = {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json"
        }

        body = {
            "keywords": query,
            "limit": 100
        }

        if filter_type:
            body["filter"] = {
                "objectType": filter_type
            }

        response = requests.post(
            f"{self.base_url}/catalog/api/search/query",
            headers=headers,
            json=body
        )

        return response.json().get("value", [])

    def get_asset_details(self, guid: str) -> dict:
        """Get detailed information about an asset."""
        headers = {"Authorization": f"Bearer {self._get_token()}"}

        response = requests.get(
            f"{self.base_url}/catalog/api/atlas/v2/entity/guid/{guid}",
            headers=headers
        )

        return response.json()

    def get_lineage(self, guid: str, direction: str = "BOTH", depth: int = 3) -> dict:
        """Get lineage for an asset."""
        headers = {"Authorization": f"Bearer {self._get_token()}"}

        response = requests.get(
            f"{self.base_url}/catalog/api/atlas/v2/lineage/{guid}",
            headers=headers,
            params={"direction": direction, "depth": depth}
        )

        return response.json()

# Usage
client = PurviewClient("company-purview")

# Search for Fabric assets
fabric_assets = client.search_assets("sales", filter_type="azure_fabric_lakehouse")
for asset in fabric_assets:
    print(f"Found: {asset['name']} ({asset['qualifiedName']})")
```

## Business Glossary Integration

```python
@dataclass
class GlossaryTerm:
    name: str
    definition: str
    status: str  # 'Draft', 'Approved', 'Expired'
    owners: List[str]
    related_terms: List[str]
    assigned_assets: List[str]

class BusinessGlossary:
    def __init__(self, purview_client: PurviewClient):
        self.client = purview_client
        self.terms: Dict[str, GlossaryTerm] = {}

    def create_term(self, term: GlossaryTerm) -> str:
        """Create a new glossary term."""
        body = {
            "name": term.name,
            "qualifiedName": f"glossary@{term.name}",
            "longDescription": term.definition,
            "status": term.status,
            "contacts": {
                "Owner": [{"id": owner} for owner in term.owners]
            }
        }

        # API call to create term
        # response = self.client.create_glossary_term(body)
        self.terms[term.name] = term
        return term.name

    def assign_to_asset(self, term_name: str, asset_guid: str):
        """Assign a glossary term to an asset."""
        # This creates a link between the term and asset
        # Enables semantic search and understanding
        pass

    def search_by_term(self, term_name: str) -> List[dict]:
        """Find all assets associated with a glossary term."""
        return self.client.search_assets(f"glossaryTerm:{term_name}")

# Create business glossary terms
glossary = BusinessGlossary(client)

glossary.create_term(GlossaryTerm(
    name="Customer Lifetime Value",
    definition="The total revenue expected from a customer over the entire relationship",
    status="Approved",
    owners=["data.steward@company.com"],
    related_terms=["Customer", "Revenue", "Churn Rate"],
    assigned_assets=["semantic-model-sales", "report-clv-analysis"]
))

glossary.create_term(GlossaryTerm(
    name="Monthly Recurring Revenue",
    definition="Predictable revenue normalized to a monthly amount",
    status="Approved",
    owners=["finance.analyst@company.com"],
    related_terms=["Revenue", "Subscription", "ARR"],
    assigned_assets=["lh-financial-metrics", "wh-revenue-facts"]
))
```

## Data Classification and Sensitivity

```python
class DataClassificationService:
    """Automatic data classification using Purview."""

    CLASSIFICATION_TYPES = {
        "PII": ["PERSON_NAME", "EMAIL", "PHONE_NUMBER", "ADDRESS", "SSN"],
        "Financial": ["CREDIT_CARD", "BANK_ACCOUNT", "FINANCIAL_AMOUNT"],
        "Health": ["MEDICAL_RECORD", "HEALTH_INSURANCE_ID"],
        "Credentials": ["PASSWORD", "API_KEY", "CONNECTION_STRING"]
    }

    def __init__(self, purview_client: PurviewClient):
        self.client = purview_client

    def scan_table(self, table_guid: str) -> dict:
        """Scan a table for sensitive data."""
        # Get table schema
        asset = self.client.get_asset_details(table_guid)
        columns = asset.get("entity", {}).get("attributes", {}).get("columns", [])

        classifications = {}
        for column in columns:
            col_name = column.get("name", "")
            col_type = column.get("dataType", "")

            # Check for auto-classifications
            detected = self._detect_classification(col_name, col_type)
            if detected:
                classifications[col_name] = detected

        return {
            "table": table_guid,
            "columns_scanned": len(columns),
            "classifications_found": classifications
        }

    def _detect_classification(self, col_name: str, col_type: str) -> Optional[str]:
        """Detect classification based on column name patterns."""
        col_lower = col_name.lower()

        patterns = {
            "EMAIL": ["email", "mail"],
            "PHONE_NUMBER": ["phone", "mobile", "cell"],
            "PERSON_NAME": ["name", "first_name", "last_name"],
            "SSN": ["ssn", "social_security"],
            "CREDIT_CARD": ["card_number", "cc_num", "credit_card"],
            "ADDRESS": ["address", "street", "city", "zip", "postal"]
        }

        for classification, keywords in patterns.items():
            if any(kw in col_lower for kw in keywords):
                return classification

        return None

    def apply_sensitivity_label(self, asset_guid: str, label: str):
        """Apply a sensitivity label to an asset."""
        # Purview API call to apply label
        # This propagates to Fabric and enforces policies
        pass

# Usage
classifier = DataClassificationService(client)
results = classifier.scan_table("lakehouse-customers-guid")
print(f"Found {len(results['classifications_found'])} sensitive columns")
```

## Data Quality Rules in Purview

```python
@dataclass
class DataQualityRule:
    name: str
    description: str
    asset_pattern: str  # Regex for matching assets
    rule_type: str  # 'completeness', 'uniqueness', 'validity', 'timeliness'
    threshold: float
    alert_on_failure: bool

class PurviewDataQuality:
    def __init__(self):
        self.rules: List[DataQualityRule] = []

    def add_rule(self, rule: DataQualityRule):
        self.rules.append(rule)

    def evaluate_asset(self, asset_name: str, metrics: dict) -> List[dict]:
        """Evaluate an asset against applicable rules."""
        results = []

        for rule in self.rules:
            # Check if rule applies to this asset
            import re
            if not re.match(rule.asset_pattern, asset_name):
                continue

            score = metrics.get(rule.rule_type, 0)
            passed = score >= rule.threshold

            results.append({
                "rule": rule.name,
                "type": rule.rule_type,
                "score": score,
                "threshold": rule.threshold,
                "passed": passed
            })

        return results

# Define enterprise data quality rules
dq = PurviewDataQuality()

dq.add_rule(DataQualityRule(
    name="Customer Email Completeness",
    description="Customer email should be 95% complete",
    asset_pattern=".*customer.*",
    rule_type="completeness",
    threshold=0.95,
    alert_on_failure=True
))

dq.add_rule(DataQualityRule(
    name="Order ID Uniqueness",
    description="Order IDs must be 100% unique",
    asset_pattern=".*order.*",
    rule_type="uniqueness",
    threshold=1.0,
    alert_on_failure=True
))
```

## Best Practices

1. **Enable automatic scanning** for all Fabric workspaces
2. **Define glossary terms** before building reports
3. **Apply sensitivity labels** based on classification results
4. **Regular data quality monitoring** with alerts
5. **Use lineage for compliance** documentation

Tomorrow, we'll explore Copilot in Fabric and how AI enhances your analytics workflow!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
