---
title: "Data Mesh: Implementing Self-Serve Data Infrastructure"
author: Michael John Peña
draft: false
date: 2025-09-15
tags:
  - Data Mesh
  - Self-Serve
  - Platform Engineering
  - Data Infrastructure
  - Developer Experience

---

I wrote "Data Mesh: Implementing Self-Serve Data Infrastructure" to share practical, production-minded guidance on this topic.

## The Self-Serve Platform

A data platform that enables self-service must provide templates, guardrails, and automation while maintaining governance.

```python
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from enum import Enum
import yaml

class DataProductTemplate(Enum):
    BATCH_PIPELINE = "batch_pipeline"
    STREAMING_PIPELINE = "streaming_pipeline"
    ML_FEATURE_STORE = "ml_feature_store"
    ANALYTICAL_DATASET = "analytical_dataset"

@dataclass
class DataProductSpec:
    name: str
    domain: str
    owner_email: str
    template: DataProductTemplate
    schema_definition: Dict
    sla_requirements: Dict
    access_policies: List[str] = field(default_factory=list)

    def to_yaml(self) -> str:
        """Generate deployment specification."""
        return yaml.dump({
            "apiVersion": "datamesh.platform/v1",
            "kind": "DataProduct",
            "metadata": {
                "name": self.name,
                "domain": self.domain,
                "owner": self.owner_email
            },
            "spec": {
                "template": self.template.value,
                "schema": self.schema_definition,
                "sla": self.sla_requirements,
                "access": self.access_policies
            }
        })

class SelfServeDataPlatform:
    def __init__(self, config: Dict):
        self.config = config
        self.provisioned_products: Dict[str, DataProductSpec] = {}

    def provision_data_product(self, spec: DataProductSpec) -> Dict:
        """Provision a new data product with all required infrastructure."""

        # Validate against governance policies
        validation = self._validate_spec(spec)
        if not validation["valid"]:
            return {"success": False, "errors": validation["errors"]}

        # Provision infrastructure
        resources = self._provision_infrastructure(spec)

        # Set up monitoring
        monitoring = self._configure_monitoring(spec)

        # Register in catalog
        catalog_entry = self._register_in_catalog(spec)

        self.provisioned_products[spec.name] = spec

        return {
            "success": True,
            "product_id": spec.name,
            "resources": resources,
            "monitoring_dashboard": monitoring["dashboard_url"],
            "catalog_url": catalog_entry["url"]
        }

    def _validate_spec(self, spec: DataProductSpec) -> Dict:
        """Validate specification against governance policies."""
        errors = []

        # Check naming conventions
        if not spec.name.startswith(f"{spec.domain}-"):
            errors.append(f"Name must start with domain prefix: {spec.domain}-")

        # Check required fields
        if not spec.sla_requirements.get("freshness"):
            errors.append("SLA must define data freshness requirement")

        # Check access policies exist
        if not spec.access_policies:
            errors.append("At least one access policy must be defined")

        return {"valid": len(errors) == 0, "errors": errors}

    def _provision_infrastructure(self, spec: DataProductSpec) -> Dict:
        """Provision compute, storage, and networking."""
        template_infra = {
            DataProductTemplate.BATCH_PIPELINE: ["storage_account", "synapse_pool", "adf_pipeline"],
            DataProductTemplate.STREAMING_PIPELINE: ["eventhub", "stream_analytics", "cosmos_db"],
            DataProductTemplate.ML_FEATURE_STORE: ["feature_store", "redis_cache", "ml_workspace"],
            DataProductTemplate.ANALYTICAL_DATASET: ["lakehouse", "semantic_model", "power_bi"]
        }

        return {
            "provisioned_resources": template_infra[spec.template],
            "status": "active"
        }
```

## Developer Experience

```bash
# CLI for self-service provisioning
datamesh init --template batch_pipeline --domain sales
datamesh validate ./data-product.yaml
datamesh deploy --environment dev
datamesh promote --from dev --to prod
```

Self-serve infrastructure removes bottlenecks while maintaining standards. The platform handles complexity; domain teams focus on delivering value through data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
