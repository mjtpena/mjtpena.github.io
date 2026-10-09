---
title: "Data Mesh with Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-15
tags:
  - Microsoft Fabric
  - Data Mesh
  - Architecture
  - Data Platform
  - Governance
---

## Data Mesh Principles

```
Data Mesh Pillars:
├── Domain Ownership
│   └── Data owned by business domains
├── Data as a Product
│   └── Discoverable, addressable, self-describing
├── Self-serve Platform
│   └── Enable domains to publish data products
└── Federated Governance
    └── Interoperability with autonomy
```

## Fabric Architecture for Data Mesh

```
┌────────────────────────────────────────────────────────┐
│                   Federated Governance                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │ Catalog │  │ Lineage │  │ Quality │  │ Security│   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
└────────────────────────────────────────────────────────┘
        ↑               ↑               ↑
┌───────┴───────┐ ┌─────┴─────┐ ┌───────┴───────┐
│  Finance      │ │ Marketing │ │  Operations   │
│  Domain       │ │  Domain   │ │   Domain      │
├───────────────┤ ├───────────┤ ├───────────────┤
│ ┌───────────┐ │ │ ┌───────┐ │ │ ┌───────────┐ │
│ │ Revenue   │ │ │ │Campaign│ │ │ │Inventory  │ │
│ │ Data      │ │ │ │ Data  │ │ │ │  Data     │ │
│ │ Product   │ │ │ │Product│ │ │ │ Product   │ │
│ └───────────┘ │ │ └───────┘ │ │ └───────────┘ │
│ ┌───────────┐ │ │ ┌───────┐ │ │ ┌───────────┐ │
│ │ Expense   │ │ │ │Customer│ │ ││ Shipping  │ │
│ │ Data      │ │ │ │ Data  │ │ │ │  Data     │ │
│ │ Product   │ │ │ │Product│ │ │ │ Product   │ │
│ └───────────┘ │ │ └───────┘ │ │ └───────────┘ │
└───────────────┘ └───────────┘ └───────────────┘
        ↓               ↓               ↓
┌────────────────────────────────────────────────────────┐
│                      OneLake                            │
│    Unified storage across all domains and products      │
└────────────────────────────────────────────────────────┘
```

## Domain Implementation

### Domain Structure

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class DataDomain:
    """Represents a data domain in the mesh."""
    name: str
    description: str
    owner: str
    workspaces: List[str]
    data_products: List['DataProduct']
    governance_policies: Dict

@dataclass
class DataProduct:
    """A data product within a domain."""
    name: str
    domain: str
    description: str
    owner: str
    sla: Dict
    schema: Dict
    endpoints: Dict
    quality_rules: List[Dict]

# Define Finance domain
finance_domain = DataDomain(
    name="Finance",
    description="Financial data and analytics",
    owner="finance-data-team@company.com",
    workspaces=[
        "FIN-Revenue-PROD",
        "FIN-Expense-PROD",
        "FIN-Analytics-PROD"
    ],
    data_products=[],
    governance_policies={
        "sensitivity_labels": ["Confidential", "Internal"],
        "retention_days": 2555,  # 7 years
        "encryption": "required"
    }
)
```

### Domain in Fabric

```python
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}
admin_url = "https://api.fabric.microsoft.com/v1/admin"

# Create domain via REST API
domain_payload = {
    "displayName": "Finance",
    "description": "Financial data domain"
}
domain_response = requests.post(f"{admin_url}/domains", headers=headers, json=domain_payload)
domain = domain_response.json()
domain_id = domain.get("id")

# Assign admins to domain
admins_payload = {"principals": [{"id": "finance-admin-principal-id", "type": "User"}]}
requests.post(f"{admin_url}/domains/{domain_id}/assignDomainAdmins", headers=headers, json=admins_payload)

# Assign workspaces to domain
for ws_id in ["workspace-id-1", "workspace-id-2"]:
    assign_payload = {"workspacesIds": [ws_id]}
    requests.post(f"{admin_url}/domains/{domain_id}/assignWorkspaces", headers=headers, json=assign_payload)

# Note: Domain policies and governance settings are configured in the Fabric Admin Portal
# Navigate to Admin Portal > Domains > Select domain > Governance settings
print(f"Domain created: {domain.get('displayName')} (ID: {domain_id})")
```

## Data Products

### Product Definition

```yaml
# data-product.yaml
name: "Customer360"
domain: "Marketing"
version: "2.1.0"
description: "Unified customer view combining interactions, transactions, and preferences"

owner:
  team: "Marketing Data Team"
  email: "marketing-data@company.com"
  slack: "#marketing-data"

sla:
  freshness: "4 hours"
  availability: "99.9%"
  support_hours: "24x7"

schema:
  format: "delta"
  location: "onelake://marketing/customer360"
  tables:
    - name: "customer_profile"
      description: "Core customer attributes"
      columns:
        - name: customer_id
          type: string
          description: "Unique customer identifier"
          pii: false
        - name: email
          type: string
          description: "Customer email"
          pii: true
        - name: segment
          type: string
          description: "Customer segment"

endpoints:
  lakehouse:
    type: "delta"
    path: "Tables/customer360"
  sql:
    type: "sql_endpoint"
    connection_string: "..."
  api:
    type: "rest"
    url: "https://api.fabric.microsoft.com/..."

quality:
  rules:
    - name: "customer_id_not_null"
      column: "customer_id"
      type: "not_null"
      threshold: 100
    - name: "email_valid_format"
      column: "email"
      type: "regex"
      pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
      threshold: 99.5
    - name: "freshness"
      type: "freshness"
      max_age_hours: 4

lineage:
  sources:
    - "CRM.customers"
    - "Transactions.orders"
    - "WebAnalytics.events"
```

### Product Registration

```python
class DataProductRegistry:
    """Registry for data products in the mesh."""

    def __init__(self, catalog_client):
        self.catalog = catalog_client

    def register_product(self, product_config: dict) -> str:
        """Register a new data product."""

        # Create catalog entry
        catalog_entry = self.catalog.create_entry(
            name=product_config["name"],
            type="DataProduct",
            description=product_config["description"],
            domain=product_config["domain"],
            metadata={
                "owner": product_config["owner"],
                "sla": product_config["sla"],
                "version": product_config["version"]
            }
        )

        # Register schema
        for table in product_config["schema"]["tables"]:
            self.catalog.add_table_schema(
                entry_id=catalog_entry.id,
                table_name=table["name"],
                columns=table["columns"]
            )

        # Register endpoints
        for endpoint_name, endpoint_config in product_config["endpoints"].items():
            self.catalog.add_endpoint(
                entry_id=catalog_entry.id,
                name=endpoint_name,
                type=endpoint_config["type"],
                connection_info=endpoint_config
            )

        # Register quality rules
        for rule in product_config.get("quality", {}).get("rules", []):
            self.catalog.add_quality_rule(
                entry_id=catalog_entry.id,
                rule=rule
            )

        return catalog_entry.id

    def discover_products(
        self,
        domain: str = None,
        tags: List[str] = None,
        certified_only: bool = False
    ) -> List[dict]:
        """Discover data products."""

        filters = {}
        if domain:
            filters["domain"] = domain
        if tags:
            filters["tags"] = tags
        if certified_only:
            filters["endorsement"] = "certified"

        return self.catalog.search(
            type="DataProduct",
            filters=filters
        )
```

## Self-Serve Platform

### Product Creation Pipeline

```python
class DataProductPipeline:
    """Pipeline for creating and managing data products."""

    def __init__(self, fabric_client, registry):
        self.fabric = fabric_client
        self.registry = registry

    def create_product_infrastructure(self, product_config: dict):
        """Create all infrastructure for a data product."""

        domain = product_config["domain"]
        name = product_config["name"]

        # 1. Create lakehouse for the product
        lakehouse = self.fabric.lakehouses.create(
            workspace_id=self._get_domain_workspace(domain),
            name=f"{name}_lakehouse"
        )

        # 2. Create notebooks for transformations
        notebook = self.fabric.notebooks.create(
            workspace_id=lakehouse.workspace_id,
            name=f"{name}_transform",
            content=self._generate_transform_notebook(product_config)
        )

        # 3. Create pipeline for orchestration
        pipeline = self.fabric.pipelines.create(
            workspace_id=lakehouse.workspace_id,
            name=f"{name}_pipeline",
            activities=[
                {
                    "name": "Transform",
                    "type": "Notebook",
                    "notebook_id": notebook.id
                },
                {
                    "name": "Quality",
                    "type": "DataQuality",
                    "rules": product_config["quality"]["rules"]
                }
            ]
        )

        # 4. Create SQL endpoint
        sql_endpoint = self.fabric.sql_endpoints.get_for_lakehouse(lakehouse.id)

        # 5. Register in catalog
        product_config["endpoints"] = {
            "lakehouse": {"path": lakehouse.path},
            "sql": {"endpoint": sql_endpoint.connection_string}
        }

        product_id = self.registry.register_product(product_config)

        return {
            "product_id": product_id,
            "lakehouse_id": lakehouse.id,
            "pipeline_id": pipeline.id,
            "sql_endpoint": sql_endpoint.connection_string
        }
```

## Federated Governance

```python
class FederatedGovernance:
    """Implement federated governance across domains."""

    def __init__(self, domains: List[DataDomain]):
        self.domains = {d.name: d for d in domains}
        self.global_policies = {}

    def set_global_policy(self, policy_name: str, policy_config: dict):
        """Set a global policy that all domains must follow."""
        self.global_policies[policy_name] = policy_config

    def validate_domain_compliance(self, domain_name: str) -> dict:
        """Check if a domain complies with global policies."""

        domain = self.domains[domain_name]
        compliance = {
            "domain": domain_name,
            "compliant": True,
            "violations": []
        }

        for policy_name, policy in self.global_policies.items():
            result = self._check_policy(domain, policy)
            if not result["compliant"]:
                compliance["compliant"] = False
                compliance["violations"].append({
                    "policy": policy_name,
                    "details": result["violations"]
                })

        return compliance

    def _check_policy(self, domain: DataDomain, policy: dict) -> dict:
        """Check a domain against a specific policy."""

        if policy["type"] == "sensitivity_label":
            # Check all items in domain have required labels
            items = self._get_domain_items(domain)
            unlabeled = [i for i in items if i.sensitivity_label is None]

            return {
                "compliant": len(unlabeled) == 0,
                "violations": [f"Unlabeled item: {i.name}" for i in unlabeled]
            }

        elif policy["type"] == "quality_threshold":
            # Check quality scores meet threshold
            products = domain.data_products
            below_threshold = []

            for p in products:
                score = self._get_quality_score(p)
                if score < policy["threshold"]:
                    below_threshold.append(f"{p.name}: {score}")

            return {
                "compliant": len(below_threshold) == 0,
                "violations": below_threshold
            }

        return {"compliant": True, "violations": []}
```

## Best Practices

1. **Clear domain boundaries** - Define ownership clearly
2. **Product thinking** - Treat data as a product
3. **Self-serve enablement** - Empower domain teams
4. **Interoperability** - Standard interfaces and formats
5. **Quality at source** - Domain owns quality

## What's Next

Tomorrow I'll cover domain-driven design for data.

## Resources

- [Data Mesh Principles](https://martinfowler.com/articles/data-mesh-principles.html)
- [Fabric Domains](https://learn.microsoft.com/fabric/governance/domains)
- [Data Products](https://learn.microsoft.com/fabric/governance/data-products)
