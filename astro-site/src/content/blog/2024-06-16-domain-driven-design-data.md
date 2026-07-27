---
title: "Domain-Driven Design for Data"
author: Michael John Peña
draft: false
date: 2024-06-16
tags:
  - Data Mesh
  - DDD
  - Data Architecture
  - Microsoft Fabric
  - Design
---

Domain-Driven Design (DDD) principles apply to data architecture just as they do to software. Today I'm exploring how to design data systems around business domains.

## DDD Concepts for Data

```
DDD Building Blocks:
├── Bounded Context → Data Domain
├── Ubiquitous Language → Shared Vocabulary
├── Aggregates → Data Products
├── Entities → Core Business Objects
└── Value Objects → Reference Data
```

## Identifying Data Domains

```python
from dataclasses import dataclass
from typing import List, Set

@dataclass
class BoundedContext:
    """A bounded context representing a data domain."""
    name: str
    description: str
    core_entities: List[str]
    shared_entities: List[str]  # Shared with other contexts
    upstream_contexts: List[str]  # Depends on
    downstream_contexts: List[str]  # Provides data to

# Define bounded contexts
sales_context = BoundedContext(
    name="Sales",
    description="Order management and revenue tracking",
    core_entities=["Order", "OrderLine", "Quote", "SalesRep"],
    shared_entities=["Customer", "Product"],
    upstream_contexts=["Inventory", "Pricing"],
    downstream_contexts=["Finance", "Analytics"]
)

customer_context = BoundedContext(
    name="Customer",
    description="Customer master data and relationships",
    core_entities=["Customer", "Contact", "Account", "Segment"],
    shared_entities=[],
    upstream_contexts=[],
    downstream_contexts=["Sales", "Marketing", "Support"]
)

inventory_context = BoundedContext(
    name="Inventory",
    description="Stock management and warehousing",
    core_entities=["StockItem", "Warehouse", "StockMovement", "Supplier"],
    shared_entities=["Product"],
    upstream_contexts=["Purchasing"],
    downstream_contexts=["Sales", "Fulfillment"]
)
```

## Context Mapping

```python
from enum import Enum

class RelationshipType(Enum):
    PARTNERSHIP = "partnership"  # Equal collaboration
    SHARED_KERNEL = "shared_kernel"  # Shared code/model
    CUSTOMER_SUPPLIER = "customer_supplier"  # Upstream/downstream
    CONFORMIST = "conformist"  # Downstream conforms to upstream
    ANTICORRUPTION_LAYER = "acl"  # Translation layer
    OPEN_HOST = "open_host"  # Published API
    PUBLISHED_LANGUAGE = "published_language"  # Standard format

@dataclass
class ContextRelationship:
    upstream: str
    downstream: str
    relationship_type: RelationshipType
    integration_pattern: str
    shared_artifacts: List[str]

# Define relationships
relationships = [
    ContextRelationship(
        upstream="Customer",
        downstream="Sales",
        relationship_type=RelationshipType.OPEN_HOST,
        integration_pattern="API + Events",
        shared_artifacts=["Customer", "Contact"]
    ),
    ContextRelationship(
        upstream="Sales",
        downstream="Finance",
        relationship_type=RelationshipType.PUBLISHED_LANGUAGE,
        integration_pattern="Event streaming",
        shared_artifacts=["OrderCompleted event", "Revenue schema"]
    ),
    ContextRelationship(
        upstream="Inventory",
        downstream="Sales",
        relationship_type=RelationshipType.CUSTOMER_SUPPLIER,
        integration_pattern="Direct query + CDC",
        shared_artifacts=["ProductAvailability"]
    )
]

def visualize_context_map(contexts: List[BoundedContext], relationships: List[ContextRelationship]):
    """Generate context map visualization."""
    print("Context Map:")
    print("=" * 50)

    for rel in relationships:
        arrow = {
            RelationshipType.PARTNERSHIP: "<-->",
            RelationshipType.CUSTOMER_SUPPLIER: "-->",
            RelationshipType.CONFORMIST: "==>",
            RelationshipType.OPEN_HOST: "-API->",
            RelationshipType.PUBLISHED_LANGUAGE: "-PL->",
        }.get(rel.relationship_type, "-->")

        print(f"[{rel.upstream}] {arrow} [{rel.downstream}]")
        print(f"  Pattern: {rel.integration_pattern}")
        print(f"  Shared: {', '.join(rel.shared_artifacts)}")
        print()
```

## Ubiquitous Language

```python
from typing import Dict

class DataDictionary:
    """Maintain ubiquitous language for a domain."""

    def __init__(self, domain: str):
        self.domain = domain
        self.terms: Dict[str, dict] = {}

    def define_term(
        self,
        term: str,
        definition: str,
        synonyms: List[str] = None,
        related_terms: List[str] = None,
        data_type: str = None,
        examples: List[str] = None
    ):
        self.terms[term] = {
            "definition": definition,
            "synonyms": synonyms or [],
            "related_terms": related_terms or [],
            "data_type": data_type,
            "examples": examples or []
        }

    def export_to_catalog(self, catalog_client):
        """Export dictionary to data catalog."""
        for term, details in self.terms.items():
            catalog_client.create_glossary_term(
                term=term,
                domain=self.domain,
                definition=details["definition"],
                synonyms=details["synonyms"],
                related_terms=details["related_terms"]
            )

# Define Sales domain language
sales_dictionary = DataDictionary("Sales")

sales_dictionary.define_term(
    term="Order",
    definition="A confirmed customer request to purchase products or services",
    synonyms=["Sales Order", "Purchase Order (from customer perspective)"],
    related_terms=["OrderLine", "Customer", "Quote"],
    data_type="Aggregate Root",
    examples=["ORD-2024-001234"]
)

sales_dictionary.define_term(
    term="Revenue",
    definition="The total amount billed to customers for products/services delivered",
    synonyms=["Sales", "Turnover"],
    related_terms=["Order", "Invoice", "ARR"],
    data_type="Monetary Value",
    examples=["$1,234,567.89"]
)

sales_dictionary.define_term(
    term="Booking",
    definition="The value of contracts signed, regardless of delivery or billing",
    synonyms=["Signed Contract Value"],
    related_terms=["Revenue", "Pipeline", "Quota"],
    data_type="Monetary Value"
)
```

## Entity Modeling

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum

class OrderStatus(Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    CONFIRMED = "confirmed"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

@dataclass
class OrderLine:
    """Value object representing a line item."""
    line_id: str
    product_id: str
    product_name: str
    quantity: int
    unit_price: float
    discount_percent: float = 0.0

    @property
    def line_total(self) -> float:
        gross = self.quantity * self.unit_price
        return gross * (1 - self.discount_percent / 100)

@dataclass
class Order:
    """Aggregate root for the Order domain."""
    order_id: str
    customer_id: str
    order_date: datetime
    status: OrderStatus
    lines: List[OrderLine] = field(default_factory=list)
    shipping_address: Optional[dict] = None
    notes: Optional[str] = None

    # Audit fields
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    created_by: Optional[str] = None

    @property
    def order_total(self) -> float:
        return sum(line.line_total for line in self.lines)

    @property
    def line_count(self) -> int:
        return len(self.lines)

    def add_line(self, line: OrderLine):
        if self.status != OrderStatus.DRAFT:
            raise ValueError("Can only add lines to draft orders")
        self.lines.append(line)
        self.updated_at = datetime.utcnow()

    def submit(self):
        if not self.lines:
            raise ValueError("Cannot submit order without lines")
        self.status = OrderStatus.SUBMITTED
        self.updated_at = datetime.utcnow()

    def to_delta_row(self) -> dict:
        """Convert to format suitable for Delta Lake."""
        return {
            "order_id": self.order_id,
            "customer_id": self.customer_id,
            "order_date": self.order_date.isoformat(),
            "status": self.status.value,
            "order_total": self.order_total,
            "line_count": self.line_count,
            "shipping_address": self.shipping_address,
            "notes": self.notes,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by
        }
```

## Data Product Design

```python
@dataclass
class DataProductSpec:
    """Specification for a data product aligned with DDD."""
    name: str
    domain: str
    aggregate_root: str
    description: str

    # Schema definition
    entities: List[dict]
    relationships: List[dict]

    # Access patterns
    read_patterns: List[str]
    write_patterns: List[str]

    # Quality and SLA
    freshness_sla: str
    quality_threshold: float

def design_order_data_product():
    """Design the Order data product."""
    return DataProductSpec(
        name="OrderAnalytics",
        domain="Sales",
        aggregate_root="Order",
        description="Order data optimized for analytics and reporting",

        entities=[
            {
                "name": "orders",
                "grain": "one row per order",
                "columns": [
                    {"name": "order_id", "type": "string", "pk": True},
                    {"name": "customer_id", "type": "string", "fk": "customers.customer_id"},
                    {"name": "order_date", "type": "date"},
                    {"name": "status", "type": "string"},
                    {"name": "order_total", "type": "decimal(18,2)"},
                    {"name": "line_count", "type": "int"}
                ]
            },
            {
                "name": "order_lines",
                "grain": "one row per order line",
                "columns": [
                    {"name": "order_id", "type": "string", "fk": "orders.order_id"},
                    {"name": "line_id", "type": "string"},
                    {"name": "product_id", "type": "string"},
                    {"name": "quantity", "type": "int"},
                    {"name": "unit_price", "type": "decimal(18,2)"},
                    {"name": "line_total", "type": "decimal(18,2)"}
                ]
            }
        ],

        relationships=[
            {"from": "orders", "to": "order_lines", "type": "one-to-many", "key": "order_id"},
            {"from": "orders", "to": "customers", "type": "many-to-one", "key": "customer_id"}
        ],

        read_patterns=[
            "Orders by date range",
            "Orders by customer",
            "Order details with lines",
            "Revenue aggregation by period"
        ],

        write_patterns=[
            "Batch load from source system",
            "Real-time updates via CDC"
        ],

        freshness_sla="4 hours",
        quality_threshold=0.99
    )
```

## Implementing in Fabric

```python
def implement_domain_in_fabric(domain: BoundedContext, fabric_client):
    """Implement a bounded context in Fabric."""

    # 1. Create domain
    domain_obj = fabric_client.domains.create(
        name=domain.name,
        description=domain.description
    )

    # 2. Create workspace for the domain
    workspace = fabric_client.workspaces.create(
        name=f"{domain.name}-DataProducts",
        capacity_id=get_capacity_for_domain(domain.name)
    )

    # Assign workspace to domain
    fabric_client.domains.assign_workspace(domain_obj.id, workspace.id)

    # 3. Create Lakehouse for domain data
    lakehouse = fabric_client.lakehouses.create(
        workspace_id=workspace.id,
        name=f"{domain.name.lower()}_lakehouse"
    )

    # 4. Create data products for each core entity
    for entity in domain.core_entities:
        # Create tables
        fabric_client.lakehouses.create_table(
            lakehouse_id=lakehouse.id,
            name=entity.lower(),
            schema=get_entity_schema(entity)
        )

    # 5. Set up sharing for downstream contexts
    for downstream in domain.downstream_contexts:
        # Create shortcuts or share via OneLake
        setup_domain_sharing(domain.name, downstream)

    return {
        "domain_id": domain_obj.id,
        "workspace_id": workspace.id,
        "lakehouse_id": lakehouse.id
    }
```

## Best Practices

1. **Start with events** - Model domain events first
2. **Identify aggregates** - Find natural boundaries
3. **Define language** - Create shared vocabulary
4. **Map contexts** - Understand relationships
5. **Evolve incrementally** - Don't boil the ocean

## What's Next

Tomorrow I'll cover federated governance for data mesh.

## Resources

- [Domain-Driven Design](https://dddcommunity.org/)
- [Data Mesh Architecture](https://www.datamesh-architecture.com/)
- [Fabric Domains](https://learn.microsoft.com/fabric/governance/domains)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
