---
title: "Data Mesh Implementation: Domain-Oriented Data Products"
description: "Data mesh rests on four pillars: domain ownership, data as a product, self-serve data platform, and federated computational governance."
author: Michael John Peña
draft: false
date: 2025-09-06
tags:
  - Data Mesh
  - Data Architecture
  - Domain-Driven Design
  - Data Products
  - Decentralization
---

## Core Principles of Data Mesh

Data mesh rests on four pillars: domain ownership, data as a product, self-serve data platform, and federated computational governance.

## Defining Data Products

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
import json

@dataclass
class DataProductMetadata:
    name: str
    domain: str
    owner: str
    description: str
    schema_version: str
    sla: Dict[str, str]
    quality_metrics: Dict[str, float]
    lineage: List[str]
    tags: List[str]
    created_at: datetime = field(default_factory=datetime.now)

@dataclass
class DataProduct:
    metadata: DataProductMetadata
    access_endpoints: Dict[str, str]
    documentation_url: str
    sample_queries: List[str]

    def to_catalog_entry(self) -> dict:
        """Generate data catalog entry for discoverability."""
        return {
            "id": f"{self.metadata.domain}/{self.metadata.name}",
            "name": self.metadata.name,
            "domain": self.metadata.domain,
            "owner": self.metadata.owner,
            "description": self.metadata.description,
            "endpoints": self.access_endpoints,
            "sla": self.metadata.sla,
            "quality_score": self._calculate_quality_score(),
            "documentation": self.documentation_url,
            "tags": self.metadata.tags
        }

    def _calculate_quality_score(self) -> float:
        """Calculate overall quality score from individual metrics."""
        metrics = self.metadata.quality_metrics
        weights = {
            "completeness": 0.25,
            "accuracy": 0.25,
            "timeliness": 0.20,
            "consistency": 0.15,
            "uniqueness": 0.15
        }
        return sum(metrics.get(k, 0) * v for k, v in weights.items())

# Example: Sales domain data product
sales_orders = DataProduct(
    metadata=DataProductMetadata(
        name="sales-orders",
        domain="sales",
        owner="sales-analytics-team",
        description="Cleansed and enriched sales order data with customer segments",
        schema_version="2.1.0",
        sla={"freshness": "< 15 minutes", "availability": "99.9%"},
        quality_metrics={
            "completeness": 0.98,
            "accuracy": 0.995,
            "timeliness": 0.99,
            "consistency": 0.97,
            "uniqueness": 1.0
        },
        lineage=["raw-orders", "customer-master", "product-catalog"],
        tags=["revenue", "orders", "b2b", "b2c"]
    ),
    access_endpoints={
        "sql": "fabric://sales/sales_orders",
        "api": "https://api.company.com/data/sales/orders",
        "streaming": "eventhub://sales-orders-stream"
    },
    documentation_url="https://wiki.company.com/data/sales-orders",
    sample_queries=["SELECT * FROM sales_orders WHERE order_date > CURRENT_DATE - 7"]
)
```

## Federated Governance

Governance in data mesh is collaborative, not dictatorial. Central teams define standards and policies; domain teams implement them.

The success of data mesh depends on treating data consumers as customers and continuously improving data products based on their feedback.
