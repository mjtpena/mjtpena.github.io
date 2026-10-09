---
title: "Building a Unified Data Platform with Microsoft Fabric"
description: "A unified data platform on Fabric eliminates the complexity of managing multiple systems while providing the flexibility to handle any data workload."
author: "Michael John Peña"
draft: false
date: 2024-10-27
tags: ["Microsoft Fabric", "Data Platform", "Architecture", "Azure", "Strategy"]
---

## The Vision of Unified Data

```python
"""
Traditional Data Platform (Fragmented):
- Azure SQL for OLTP
- Synapse for Analytics
- Data Factory for ETL
- Event Hubs for Streaming
- Databricks for Data Science
- Power BI for Visualization
- Purview for Governance

Fabric Unified Platform:
+---------------------------------------------------+
|                Microsoft Fabric                    |
|                                                   |
|  +----------+  +----------+  +----------+         |
|  | Database |  |Lakehouse |  |Warehouse |         |
|  +----------+  +----------+  +----------+         |
|       |             |             |               |
|       +-------------+-------------+               |
|                     |                             |
|              +------+------+                      |
|              |   OneLake   |                      |
|              +------+------+                      |
|                     |                             |
|  +----------+  +----------+  +----------+         |
|  |Pipelines |  |Notebooks |  |Real-Time |         |
|  +----------+  +----------+  +----------+         |
|                                                   |
|  +----------+  +----------+  +----------+         |
|  | Semantic |  |  Reports |  | Copilot  |         |
|  |  Models  |  |          |  |          |         |
|  +----------+  +----------+  +----------+         |
|                                                   |
+---------------------------------------------------+
              Unified Governance (Purview)
"""
```

## Platform Design Framework

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum

class DataLayer(Enum):
    RAW = "raw"           # Bronze layer
    CURATED = "curated"   # Silver layer
    SERVING = "serving"   # Gold layer

class WorkloadType(Enum):
    TRANSACTIONAL = "transactional"
    ANALYTICAL = "analytical"
    REAL_TIME = "real_time"
    DATA_SCIENCE = "data_science"
    REPORTING = "reporting"

@dataclass
class DataDomain:
    """A logical data domain"""
    name: str
    description: str
    owner: str
    workloads: List[WorkloadType]
    source_systems: List[str]
    retention_days: int = 365

@dataclass
class FabricWorkspace:
    """Fabric workspace configuration"""
    name: str
    purpose: str
    domains: List[DataDomain]
    capacity_size: str  # F2, F4, F8, etc.
    environment: str    # dev, test, prod

@dataclass
class UnifiedPlatform:
    """Complete Fabric platform design"""
    name: str
    workspaces: List[FabricWorkspace]
    governance_config: Dict
    security_config: Dict

def design_platform(organization_name: str,
                   domains: List[DataDomain]) -> UnifiedPlatform:
    """Design a unified data platform"""

    workspaces = []

    # Create development workspace
    workspaces.append(FabricWorkspace(
        name=f"{organization_name}-dev",
        purpose="Development and testing",
        domains=domains,
        capacity_size="F4",
        environment="dev"
    ))

    # Create production workspace per domain
    for domain in domains:
        workspaces.append(FabricWorkspace(
            name=f"{organization_name}-{domain.name}-prod",
            purpose=f"Production {domain.name} workloads",
            domains=[domain],
            capacity_size="F8",
            environment="prod"
        ))

    # Create shared analytics workspace
    workspaces.append(FabricWorkspace(
        name=f"{organization_name}-analytics-prod",
        purpose="Cross-domain analytics and reporting",
        domains=domains,
        capacity_size="F16",
        environment="prod"
    ))

    return UnifiedPlatform(
        name=organization_name,
        workspaces=workspaces,
        governance_config={
            "data_classification": ["public", "internal", "confidential", "restricted"],
            "retention_policy": "domain_specific",
            "access_model": "role_based"
        },
        security_config={
            "authentication": "azure_ad",
            "encryption": "microsoft_managed",
            "network": "private_endpoints"
        }
    )
```

## Implementing the Platform

```python
# Infrastructure as Code for Fabric Platform
from azure.identity import DefaultAzureCredential
import requests

class FabricPlatformBuilder:
    """Build Fabric platform infrastructure"""

    def __init__(self):
        self.credential = DefaultAzureCredential()
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_headers(self):
        token = self.credential.get_token("https://api.fabric.microsoft.com/.default")
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def create_workspace(self, workspace: FabricWorkspace) -> str:
        """Create a Fabric workspace"""
        response = requests.post(
            f"{self.base_url}/workspaces",
            headers=self._get_headers(),
            json={
                "displayName": workspace.name,
                "description": workspace.purpose,
                "capacityId": self._get_capacity_id(workspace.capacity_size)
            }
        )
        return response.json()["id"]

    def create_lakehouse(self, workspace_id: str, name: str) -> str:
        """Create a Lakehouse in workspace"""
        response = requests.post(
            f"{self.base_url}/workspaces/{workspace_id}/lakehouses",
            headers=self._get_headers(),
            json={"displayName": name}
        )
        return response.json()["id"]

    def create_warehouse(self, workspace_id: str, name: str) -> str:
        """Create a Warehouse in workspace"""
        response = requests.post(
            f"{self.base_url}/workspaces/{workspace_id}/warehouses",
            headers=self._get_headers(),
            json={"displayName": name}
        )
        return response.json()["id"]

    def create_database(self, workspace_id: str, name: str,
                       db_type: str = "SQL") -> str:
        """Create a Database in workspace"""
        response = requests.post(
            f"{self.base_url}/workspaces/{workspace_id}/items",
            headers=self._get_headers(),
            json={
                "displayName": name,
                "type": f"{db_type}Database"
            }
        )
        return response.json()["id"]

    def setup_data_layers(self, workspace_id: str, domain: DataDomain):
        """Set up medallion architecture layers"""

        # Raw layer (Bronze)
        raw_lakehouse = self.create_lakehouse(
            workspace_id,
            f"{domain.name}_raw"
        )

        # Curated layer (Silver)
        curated_lakehouse = self.create_lakehouse(
            workspace_id,
            f"{domain.name}_curated"
        )

        # Serving layer (Gold)
        serving_warehouse = self.create_warehouse(
            workspace_id,
            f"{domain.name}_serving"
        )

        return {
            "raw": raw_lakehouse,
            "curated": curated_lakehouse,
            "serving": serving_warehouse
        }

    def build_platform(self, platform: UnifiedPlatform):
        """Build complete platform"""

        workspace_ids = {}

        for workspace in platform.workspaces:
            # Create workspace
            ws_id = self.create_workspace(workspace)
            workspace_ids[workspace.name] = ws_id

            # Set up data layers for each domain
            for domain in workspace.domains:
                self.setup_data_layers(ws_id, domain)

        return workspace_ids
```

## Data Flow Patterns

```python
# Pattern 1: Source to Raw (Ingestion)
ingestion_pipeline = {
    "name": "IngestSourceData",
    "activities": [
        {
            "name": "CopyFromSource",
            "type": "Copy",
            "source": {"type": "AzureSqlDatabase"},
            "sink": {"type": "LakehouseDelta", "path": "raw/source_table"}
        }
    ]
}

# Pattern 2: Raw to Curated (Transformation)
transformation_notebook = """
from pyspark.sql import SparkSession
from delta.tables import DeltaTable

spark = SparkSession.builder.getOrCreate()

# Read raw data
raw_df = spark.read.format("delta").load("raw/source_table")

# Apply transformations
curated_df = raw_df.dropDuplicates(["id"]).dropna().withColumn(
    "processed_at", current_timestamp()
)

# Write to curated
curated_df.write.format("delta").mode("merge").save("curated/cleaned_data")
"""

# Pattern 3: Curated to Serving (Aggregation)
serving_sql = """
CREATE OR REPLACE VIEW serving.daily_summary AS
SELECT
    date_key,
    SUM(amount) as total_amount,
    COUNT(*) as transaction_count,
    AVG(amount) as avg_amount
FROM curated.transactions
GROUP BY date_key
"""

# Pattern 4: Serving to Semantic Model
semantic_model = {
    "tables": ["serving.daily_summary"],
    "measures": [
        {"name": "Total Revenue", "expression": "SUM([total_amount])"},
        {"name": "Transaction Count", "expression": "SUM([transaction_count])"}
    ],
    "relationships": []
}
```

## Governance Framework

```python
@dataclass
class GovernancePolicy:
    """Data governance policy"""
    name: str
    rules: List[Dict]
    enforcement: str  # "audit", "prevent", "alert"

governance_policies = [
    GovernancePolicy(
        name="PII Data Handling",
        rules=[
            {"field_pattern": "*email*", "classification": "PII", "action": "mask"},
            {"field_pattern": "*ssn*", "classification": "PII", "action": "encrypt"},
            {"field_pattern": "*phone*", "classification": "PII", "action": "mask"}
        ],
        enforcement="prevent"
    ),
    GovernancePolicy(
        name="Data Retention",
        rules=[
            {"layer": "raw", "retention_days": 90},
            {"layer": "curated", "retention_days": 365},
            {"layer": "serving", "retention_days": 730}
        ],
        enforcement="audit"
    ),
    GovernancePolicy(
        name="Access Control",
        rules=[
            {"layer": "raw", "access": "data_engineers"},
            {"layer": "curated", "access": "data_analysts"},
            {"layer": "serving", "access": "all_users"}
        ],
        enforcement="prevent"
    )
]
```

## Platform Monitoring

```python
class PlatformMonitor:
    """Monitor unified data platform health"""

    def __init__(self, platform: UnifiedPlatform):
        self.platform = platform

    def get_health_status(self) -> Dict:
        """Get overall platform health"""
        return {
            "workspaces": self._check_workspaces(),
            "pipelines": self._check_pipelines(),
            "capacity": self._check_capacity(),
            "data_quality": self._check_data_quality()
        }

    def _check_workspaces(self) -> Dict:
        # Check workspace availability
        pass

    def _check_pipelines(self) -> Dict:
        # Check pipeline success rates
        pass

    def _check_capacity(self) -> Dict:
        # Check capacity utilization
        pass

    def _check_data_quality(self) -> Dict:
        # Check data quality metrics
        pass
```

A unified data platform on Fabric eliminates the complexity of managing multiple systems while providing the flexibility to handle any data workload.
