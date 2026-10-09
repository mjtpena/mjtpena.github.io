---
title: "Data Mesh Implementation: A Practical Guide for 2025"
description: "Data mesh is a journey, not a destination. Start with a few high-value domains, prove the model, then expand. The technology enables data mesh, but success…"
author: Michael John Peña
draft: false
date: 2025-01-13
tags:
  - Data Mesh
  - Data Architecture
  - Data Governance
  - Azure
  - Microsoft Fabric
---

## Data Mesh Principles Recap

1. **Domain Ownership**: Data owned and managed by domain experts
2. **Data as a Product**: Treat data with product thinking
3. **Self-Serve Platform**: Enable teams to work independently
4. **Federated Governance**: Balance autonomy with standards

## Implementing Data Mesh in Microsoft Fabric

### Domain Workspaces

```python
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}
base_url = "https://api.fabric.microsoft.com/v1"

def create_domain_workspace(name: str, description: str, capacity_id: str):
    """Create a workspace for a domain."""
    payload = {
        "displayName": name,
        "description": description,
        "capacityId": capacity_id
    }
    response = requests.post(f"{base_url}/workspaces", headers=headers, json=payload)
    return response.json()

# Sales domain workspace
sales_workspace = create_domain_workspace(
    name="Sales-Domain",
    description="Sales team's data products",
    capacity_id="sales-capacity-id"
)
print(f"Created: {sales_workspace.get('displayName')}")

# Marketing domain workspace
marketing_workspace = create_domain_workspace(
    name="Marketing-Domain",
    description="Marketing team's data products",
    capacity_id="marketing-capacity-id"
)

# Add workspace role assignments via Admin API
admin_url = "https://api.fabric.microsoft.com/v1/admin"
workspace_id = sales_workspace.get("id")

# Note: Role assignments can be managed via REST API or Fabric portal
# Each domain workspace contains: Lakehouse(s), Warehouse(s), Pipelines, Semantic models, Reports
```

### Data Products Definition

```python
# Data products are defined as configuration with metadata
# stored in a catalog (e.g., Microsoft Purview or custom metadata store)
import json
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()

# Define a data product as a configuration dictionary
customer_360_product = {
    "name": "Customer 360",
    "domain": "Sales",
    "owner": "sales-data-team@company.com",
    "description": """
    Unified customer view combining transaction history,
    support interactions, and marketing engagement.
    Updated daily at 6 AM UTC.
    """,

    # Data contract
    "contract": {
        "schema": {
            "customer_id": {"type": "string", "description": "Unique customer identifier"},
            "customer_name": {"type": "string", "description": "Full customer name"},
            "lifetime_value": {"type": "decimal", "description": "Total historical spend"},
            "segment": {"type": "string", "enum": ["Enterprise", "SMB", "Consumer"]},
            "churn_risk": {"type": "decimal", "description": "Churn probability 0-1"},
            "last_updated": {"type": "timestamp", "description": "Last refresh time"}
        },
        "sla": {
            "freshness": "24h",
            "availability": "99.9%",
            "quality_score": "95%"
        },
        "access_patterns": [
            "Full table scan for analytics",
            "Point lookup by customer_id",
            "Filter by segment"
        ]
    },

    # Technical implementation
    "storage": {
        "type": "lakehouse_table",
        "lakehouse": "sales_lakehouse",
        "table": "gold_customer_360"
    },

    # Quality checks
    "quality_rules": [
        "customer_id is not null",
        "lifetime_value >= 0",
        "churn_risk between 0 and 1",
        "last_updated within 25 hours"
    ]
}

# Register to Microsoft Purview (data catalog) via REST API
def register_data_product(product: dict, purview_account: str):
    """Register data product in Microsoft Purview."""
    token = credential.get_token("https://purview.azure.net/.default").token
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Create entity in Purview
    entity_payload = {
        "entity": {
            "typeName": "DataProduct",
            "attributes": {
                "name": product["name"],
                "qualifiedName": f"{product['domain']}/{product['name']}",
                "description": product["description"],
                "owner": product["owner"],
                "contract": json.dumps(product["contract"]),
                "storage": json.dumps(product["storage"])
            }
        }
    }

    response = requests.post(
        f"https://{purview_account}.purview.azure.com/catalog/api/atlas/v2/entity",
        headers=headers,
        json=entity_payload
    )
    return response.json()

register_data_product(customer_360_product, "my-purview-account")
```

### Cross-Domain Data Sharing

```python
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}
base_url = "https://api.fabric.microsoft.com/v1"

# Option 1: OneLake shortcut (read-only access)
# Marketing domain wants to use Sales' Customer 360
target_workspace_id = "marketing-workspace-id"
target_lakehouse_id = "marketing-lakehouse-id"

shortcut_payload = {
    "path": "Tables/shared_customer_360",
    "target": {
        "oneLake": {
            "workspaceId": "sales-workspace-id",
            "itemId": "sales-lakehouse-id",
            "path": "Tables/gold_customer_360"
        }
    }
}

response = requests.post(
    f"{base_url}/workspaces/{target_workspace_id}/items/{target_lakehouse_id}/shortcuts",
    headers=headers,
    json=shortcut_payload
)
print(f"Shortcut created: {response.json()}")

# Option 2: Semantic model sharing via workspace permissions
# Share the semantic model by granting workspace access or using direct share
# This is typically done via Fabric portal or Power BI REST API

# Using Semantic Link for cross-workspace queries
import sempy.fabric as fabric

# Read from shared semantic model
df = fabric.evaluate_dax(
    dataset="Customer Analytics",
    dax_string="EVALUATE SUMMARIZE(Customers, Customers[Segment])",
    workspace="Sales-Domain"
)
```

### Self-Serve Data Platform

```python
# Self-serve platform using Fabric REST APIs and templates
from azure.identity import DefaultAzureCredential
import requests
import json

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
base_url = "https://api.fabric.microsoft.com/v1"

# Platform templates stored as configuration
TEMPLATES = {
    "domain-lakehouse-template": {
        "type": "Lakehouse",
        "config": {
            "layers": ["bronze", "silver", "gold"],
            "default_format": "delta",
            "retention_days": 90,
            "auto_vacuum": True
        },
        "governance": {
            "sensitivity_classification": "required",
            "data_steward": "required",
            "documentation": "required"
        }
    },
    "ingestion-pipeline-template": {
        "type": "DataPipeline",
        "config": {
            "error_handling": "retry_with_backoff",
            "alerting": "on_failure",
            "logging": "azure_monitor",
            "lineage_tracking": "enabled"
        }
    }
}

def create_domain_lakehouse(domain_name: str, steward_email: str, capacity_id: str):
    """Self-serve lakehouse creation using platform template."""
    template = TEMPLATES["domain-lakehouse-template"]

    # First, create or get the domain workspace
    workspace_name = f"{domain_name}-Domain"
    workspace_payload = {
        "displayName": workspace_name,
        "capacityId": capacity_id,
        "description": f"Data products for {domain_name} domain. Steward: {steward_email}"
    }

    ws_response = requests.post(f"{base_url}/workspaces", headers=headers, json=workspace_payload)
    workspace_id = ws_response.json().get("id")

    # Create lakehouse in the workspace
    lakehouse_payload = {
        "displayName": f"{domain_name.lower()}_lakehouse",
        "type": "Lakehouse",
        "description": json.dumps({
            "data_steward": steward_email,
            "governance": template["governance"],
            "config": template["config"]
        })
    }

    lh_response = requests.post(
        f"{base_url}/workspaces/{workspace_id}/items",
        headers=headers,
        json=lakehouse_payload
    )

    return lh_response.json()

# Domain teams use self-serve function
sales_lakehouse = create_domain_lakehouse(
    domain_name="Sales",
    steward_email="sales-steward@company.com",
    capacity_id="capacity-id"
)
```

### Federated Governance

```python
# Governance policies managed via Microsoft Purview REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
purview_account = "my-purview-account"

def get_purview_token():
    return credential.get_token("https://purview.azure.net/.default").token

# Global policies (platform team) - defined as policy configurations
global_policies = [
    {
        "name": "pii-classification",
        "description": "All PII columns must be classified",
        "scope": "GLOBAL",
        "rule": """
            columns containing 'email', 'phone', 'ssn', 'address'
            must have sensitivity_label in ('Confidential', 'Highly Confidential')
        """,
        "enforcement": "block"
    },
    {
        "name": "retention-minimum",
        "description": "Data must be retained for compliance",
        "scope": "GLOBAL",
        "rule": "tables must have retention_days >= 7",
        "enforcement": "warn"
    }
]

# Domain-specific policies (domain teams)
sales_policies = [
    {
        "name": "sales-data-freshness",
        "description": "Sales data must be refreshed daily",
        "scope": "WORKSPACE",
        "workspace": "Sales-Domain",
        "rule": "gold tables must have last_refresh within 24h",
        "enforcement": "alert"
    }
]

def register_policy(policy: dict):
    """Register governance policy in Microsoft Purview."""
    token = get_purview_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Create policy in Purview
    policy_payload = {
        "name": policy["name"],
        "description": policy["description"],
        "decisionRules": [{
            "effect": policy["enforcement"],
            "dnfCondition": [[{
                "attributeName": "scope",
                "attributeValueIncludes": policy["scope"]
            }]]
        }]
    }

    response = requests.put(
        f"https://{purview_account}.purview.azure.com/policystore/policies/{policy['name']}",
        headers=headers,
        json=policy_payload
    )
    return response.json()

# Register all policies
for policy in global_policies + sales_policies:
    register_policy(policy)
```

### Data Product Discovery

```python
# Data product discovery using Microsoft Purview REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
purview_account = "my-purview-account"

def search_data_products(query: str, filters: dict = None):
    """Search for data products in Microsoft Purview catalog."""
    token = credential.get_token("https://purview.azure.net/.default").token
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    search_payload = {
        "keywords": query,
        "filter": {
            "and": [
                {"typeName": "DataProduct"},
                *([{"attributeName": "domain", "operator": "in", "attributeValue": filters.get("domain")}]
                  if filters and filters.get("domain") else [])
            ]
        },
        "limit": 25
    }

    response = requests.post(
        f"https://{purview_account}.purview.azure.com/catalog/api/search/query",
        headers=headers,
        json=search_payload
    )

    return response.json().get("value", [])

# Search for data products
results = search_data_products(
    query="customer",
    filters={
        "domain": ["Sales", "Marketing"]
    }
)

for product in results:
    attrs = product.get("attributes", {})
    print(f"""
    Name: {attrs.get('name')}
    Domain: {attrs.get('domain')}
    Owner: {attrs.get('owner')}
    Description: {attrs.get('description')}
    """)

# Request access via Purview access request workflow
def request_access(product_name: str, requester: str, reason: str):
    """Submit access request for a data product."""
    token = credential.get_token("https://purview.azure.net/.default").token
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Access requests are typically handled via Purview's self-service access workflow
    # This creates a request that routes to the data owner for approval
    request_payload = {
        "resourceId": f"/subscriptions/.../dataProducts/{product_name}",
        "requestor": requester,
        "justification": reason,
        "accessType": "read"
    }

    # Note: Actual endpoint depends on Purview configuration
    print(f"Access request submitted for {product_name} by {requester}")
    return request_payload

request_access("Customer 360", "marketing-analyst@company.com", "Need for campaign targeting analysis")
```

### Quality Monitoring

```python
# Quality monitoring using PySpark and custom checks
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from datetime import datetime, timedelta

spark = SparkSession.builder.getOrCreate()

def run_quality_checks(table_name: str, rules: list[dict]) -> dict:
    """Run data quality checks on a table."""
    df = spark.read.table(table_name)
    total_rows = df.count()

    results = {"table": table_name, "total_rows": total_rows, "checks": [], "score": 0}
    passed_checks = 0

    for rule in rules:
        rule_name = rule["name"]
        condition = rule["condition"]

        # Count rows that pass the condition
        passing_rows = df.filter(condition).count()
        pass_rate = (passing_rows / total_rows * 100) if total_rows > 0 else 0
        passed = pass_rate >= rule.get("threshold", 100)

        results["checks"].append({
            "name": rule_name,
            "passed": passed,
            "pass_rate": round(pass_rate, 2),
            "failure_details": f"{total_rows - passing_rows} rows failed" if not passed else None
        })

        if passed:
            passed_checks += 1

    results["score"] = round(passed_checks / len(rules) * 100, 1) if rules else 100
    return results

# Define quality rules for Customer 360
quality_rules = [
    {"name": "customer_id_not_null", "condition": "customer_id IS NOT NULL", "threshold": 100},
    {"name": "lifetime_value_positive", "condition": "lifetime_value >= 0", "threshold": 100},
    {"name": "churn_risk_valid", "condition": "churn_risk BETWEEN 0 AND 1", "threshold": 100},
    {"name": "freshness_check", "condition": f"last_updated > '{(datetime.now() - timedelta(hours=25)).isoformat()}'", "threshold": 95}
]

# Run quality checks
results = run_quality_checks("lakehouse.gold_customer_360", quality_rules)

print(f"Overall Quality Score: {results['score']}%")
for check in results["checks"]:
    status = "PASS" if check["passed"] else "FAIL"
    print(f"  {check['name']}: {status} ({check['pass_rate']}%)")
    if not check["passed"]:
        print(f"    Details: {check['failure_details']}")

# Save quality metrics to a monitoring table
quality_df = spark.createDataFrame([{
    "table_name": results["table"],
    "check_time": datetime.now().isoformat(),
    "score": results["score"],
    "details": str(results["checks"])
}])
quality_df.write.mode("append").saveAsTable("lakehouse.data_quality_metrics")
```

## Organizational Considerations

### Team Structure

```
Platform Team (Central)
├── Provides infrastructure
├── Maintains governance tools
├── Supports domain teams
└── Manages shared services

Domain Teams (Distributed)
├── Own their data products
├── Build domain-specific pipelines
├── Define domain contracts
└── Manage domain quality

Data Governance Council (Federated)
├── Representatives from each domain
├── Sets global policies
├── Resolves cross-domain issues
└── Evolves standards
```

### Success Metrics

```python
# Track data mesh health
mesh_metrics = {
    "data_products_count": 45,
    "domains_active": 8,
    "cross_domain_shares": 120,
    "avg_quality_score": 94.5,
    "time_to_new_product": "5 days",
    "self_serve_adoption": "78%",
    "governance_compliance": "96%"
}
```

Data mesh is a journey, not a destination. Start with a few high-value domains, prove the model, then expand. The technology enables data mesh, but success requires organizational alignment.
