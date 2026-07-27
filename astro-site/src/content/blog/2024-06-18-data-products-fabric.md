---
title: "Building Data Products in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-18
tags:
  - Microsoft Fabric
  - Data Products
  - Data Mesh
  - Data Engineering
  - Best Practices
---

Data products are the deliverables of a data mesh. Today I'm exploring how to build, manage, and consume data products in Microsoft Fabric.

## What Makes a Data Product

A data product is a self-contained unit of data that is:
- **Discoverable**: Easy to find in a catalog
- **Addressable**: Accessible via well-defined endpoints
- **Self-describing**: Documentation and schema included
- **Trustworthy**: Quality guaranteed with SLAs
- **Interoperable**: Standard formats and interfaces

## Data Product Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime

@dataclass
class DataProductMetadata:
    name: str
    domain: str
    version: str
    description: str
    owner: str
    team_contact: str
    tags: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

@dataclass
class DataProductSchema:
    format: str  # "delta", "parquet", "json"
    tables: List[Dict]
    relationships: List[Dict]
    change_history: List[Dict] = field(default_factory=list)

@dataclass
class DataProductSLA:
    freshness_hours: int
    availability_percent: float
    quality_score_min: float
    support_tier: str  # "gold", "silver", "bronze"

@dataclass
class DataProductEndpoint:
    name: str
    type: str  # "sql", "api", "file", "streaming"
    connection_info: Dict
    documentation_url: str

@dataclass
class DataProduct:
    metadata: DataProductMetadata
    schema: DataProductSchema
    sla: DataProductSLA
    endpoints: List[DataProductEndpoint]
    quality_rules: List[Dict]
    lineage: Dict
```

## Creating a Data Product

```python
class DataProductBuilder:
    """Builder for creating data products in Fabric."""

    def __init__(self, fabric_client, workspace_id: str):
        self.client = fabric_client
        self.workspace_id = workspace_id

    def create_product(self, spec: dict) -> dict:
        """Create a complete data product from specification."""

        product_name = spec["name"]

        # 1. Create Lakehouse for storage
        lakehouse = self.client.lakehouses.create(
            workspace_id=self.workspace_id,
            name=f"{product_name}_lakehouse"
        )

        # 2. Create tables from schema
        for table in spec["schema"]["tables"]:
            self._create_table(lakehouse.id, table)

        # 3. Create data pipeline
        pipeline = self._create_pipeline(spec)

        # 4. Set up quality monitoring
        quality = self._setup_quality_monitoring(lakehouse.id, spec["quality_rules"])

        # 5. Create SQL endpoint for querying
        sql_endpoint = self.client.sql_endpoints.get_for_lakehouse(lakehouse.id)

        # 6. Generate documentation
        docs = self._generate_documentation(spec)

        # 7. Register in catalog
        catalog_entry = self._register_in_catalog(spec, {
            "lakehouse_id": lakehouse.id,
            "sql_endpoint": sql_endpoint.connection_string,
            "pipeline_id": pipeline.id
        })

        return {
            "product_id": catalog_entry.id,
            "lakehouse_id": lakehouse.id,
            "pipeline_id": pipeline.id,
            "sql_endpoint": sql_endpoint.connection_string,
            "documentation_url": docs["url"]
        }

    def _create_table(self, lakehouse_id: str, table_spec: dict):
        """Create a table in the lakehouse."""
        columns_sql = ", ".join([
            f"{col['name']} {self._map_type(col['type'])}"
            for col in table_spec["columns"]
        ])

        self.client.lakehouses.execute_sql(
            lakehouse_id,
            f"CREATE TABLE IF NOT EXISTS {table_spec['name']} ({columns_sql})"
        )

    def _create_pipeline(self, spec: dict) -> object:
        """Create data pipeline for the product."""
        activities = [
            {
                "name": "IngestSource",
                "type": "Copy",
                "source": spec.get("source", {}),
                "sink": {"type": "Lakehouse"}
            },
            {
                "name": "Transform",
                "type": "Notebook",
                "notebook_path": f"/Notebooks/{spec['name']}_transform"
            },
            {
                "name": "QualityCheck",
                "type": "DataQuality",
                "rules": spec.get("quality_rules", [])
            },
            {
                "name": "Publish",
                "type": "Script",
                "script": "UPDATE catalog SET last_updated = CURRENT_TIMESTAMP"
            }
        ]

        return self.client.pipelines.create(
            workspace_id=self.workspace_id,
            name=f"{spec['name']}_pipeline",
            activities=activities,
            schedule=spec.get("schedule", {"type": "daily", "time": "02:00"})
        )

    def _setup_quality_monitoring(self, lakehouse_id: str, rules: List[dict]) -> dict:
        """Set up data quality monitoring."""
        quality_config = {
            "rules": [],
            "alerts": []
        }

        for rule in rules:
            quality_config["rules"].append({
                "name": rule["name"],
                "table": rule.get("table"),
                "column": rule.get("column"),
                "type": rule["type"],
                "threshold": rule.get("threshold", 1.0),
                "severity": rule.get("severity", "warning")
            })

            # Create alert for critical rules
            if rule.get("severity") == "critical":
                quality_config["alerts"].append({
                    "rule": rule["name"],
                    "action": "email",
                    "recipients": ["data-quality@company.com"]
                })

        return quality_config

    def _map_type(self, type_str: str) -> str:
        """Map abstract types to Spark SQL types."""
        type_map = {
            "string": "STRING",
            "int": "INT",
            "long": "BIGINT",
            "float": "FLOAT",
            "double": "DOUBLE",
            "decimal": "DECIMAL(18,2)",
            "date": "DATE",
            "timestamp": "TIMESTAMP",
            "boolean": "BOOLEAN"
        }
        return type_map.get(type_str.lower(), "STRING")
```

## Data Product Specification

```yaml
# customer360_product.yaml
name: "Customer360"
domain: "Marketing"
version: "2.0.0"
description: |
  Unified customer view combining profile, interactions,
  transactions, and behavioral data.

owner: "marketing-data-team@company.com"
team_slack: "#marketing-data"

tags:
  - customer
  - master-data
  - certified

schema:
  format: delta
  tables:
    - name: customer_profile
      description: Core customer attributes
      grain: one row per customer
      columns:
        - name: customer_id
          type: string
          description: Unique customer identifier
          pk: true
        - name: email
          type: string
          pii: true
        - name: first_name
          type: string
          pii: true
        - name: last_name
          type: string
          pii: true
        - name: segment
          type: string
          values: ["Premium", "Standard", "Basic"]
        - name: lifetime_value
          type: decimal
        - name: created_date
          type: date
        - name: last_activity_date
          type: date

    - name: customer_interactions
      description: Customer touchpoints
      grain: one row per interaction
      columns:
        - name: interaction_id
          type: string
          pk: true
        - name: customer_id
          type: string
          fk: customer_profile.customer_id
        - name: interaction_type
          type: string
        - name: channel
          type: string
        - name: timestamp
          type: timestamp

sla:
  freshness_hours: 4
  availability_percent: 99.5
  quality_score_min: 0.95
  support:
    tier: gold
    response_time_hours: 4
    escalation_email: marketing-data-escalation@company.com

quality_rules:
  - name: customer_id_not_null
    table: customer_profile
    column: customer_id
    type: not_null
    threshold: 1.0
    severity: critical

  - name: email_format
    table: customer_profile
    column: email
    type: regex
    pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    threshold: 0.99
    severity: warning

  - name: segment_valid
    table: customer_profile
    column: segment
    type: in_set
    values: ["Premium", "Standard", "Basic"]
    threshold: 1.0
    severity: critical

  - name: freshness
    type: freshness
    max_hours: 4
    severity: critical

lineage:
  sources:
    - name: CRM.Customers
      type: sql_server
      refresh: incremental
    - name: Web.Events
      type: event_hub
      refresh: streaming
    - name: Transactions.Orders
      type: delta
      refresh: daily

schedule:
  type: cron
  expression: "0 */4 * * *"  # Every 4 hours
  timezone: UTC
```

## Consuming Data Products

```python
class DataProductConsumer:
    """Helper for consuming data products."""

    def __init__(self, catalog_client, fabric_client):
        self.catalog = catalog_client
        self.fabric = fabric_client

    def discover_products(
        self,
        domain: str = None,
        tags: List[str] = None,
        certified_only: bool = True
    ) -> List[dict]:
        """Discover available data products."""
        filters = {}
        if domain:
            filters["domain"] = domain
        if tags:
            filters["tags"] = {"$all": tags}
        if certified_only:
            filters["endorsement"] = "certified"

        return self.catalog.search(
            item_type="DataProduct",
            filters=filters
        )

    def get_product_info(self, product_id: str) -> dict:
        """Get detailed information about a data product."""
        entry = self.catalog.get_entry(product_id)

        return {
            "metadata": entry.metadata,
            "schema": entry.schema,
            "sla": entry.sla,
            "endpoints": entry.endpoints,
            "quality_score": self._get_latest_quality_score(product_id),
            "last_updated": entry.last_updated
        }

    def connect_sql(self, product_id: str) -> str:
        """Get SQL connection string for a product."""
        info = self.get_product_info(product_id)
        sql_endpoint = next(
            (e for e in info["endpoints"] if e["type"] == "sql"),
            None
        )
        if sql_endpoint:
            return sql_endpoint["connection_info"]["connection_string"]
        raise ValueError("No SQL endpoint available")

    def request_access(self, product_id: str, reason: str) -> str:
        """Request access to a data product."""
        return self.catalog.create_access_request(
            item_id=product_id,
            reason=reason,
            requested_role="Reader"
        )

# Usage
consumer = DataProductConsumer(catalog_client, fabric_client)

# Find customer data products
products = consumer.discover_products(
    domain="Marketing",
    tags=["customer"],
    certified_only=True
)

for product in products:
    print(f"{product['name']}: {product['description']}")

# Connect to a product
conn_str = consumer.connect_sql("customer360-product-id")
df = spark.read.format("jdbc").option("url", conn_str).load()
```

## Best Practices

1. **Clear ownership** - Every product has an owner
2. **Documented contracts** - Schema and SLA are contracts
3. **Quality built-in** - Don't ship bad data
4. **Self-service discovery** - Make products findable
5. **Version everything** - Enable safe evolution

## What's Next

Tomorrow I'll cover data contracts.

## Resources

- [Data Products](https://www.datamesh-architecture.com/data-products)
- [Fabric Catalog](https://learn.microsoft.com/fabric/governance/catalog)
- [Data Quality](https://learn.microsoft.com/fabric/data-engineering/data-quality)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
