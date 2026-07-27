---
title: "Data Lineage in Microsoft Fabric: Tracking Data Flow"
author: "Michael John Peña"
draft: false
date: 2023-11-15
tags: ["Microsoft Fabric", "Data Lineage", "Data Governance", "Purview", "Metadata"]

---

I wrote "Data Lineage in Microsoft Fabric: Tracking Data Flow" to share practical, production-minded guidance on this topic.

Data lineage in Fabric — the ability to trace where a piece of data came from, what transformations it passed through, and what items depend on it — is built into the platform as a visual lineage view in the workspace rather than a separate governance tool you need to configure and maintain. The lineage view shows the dependency graph: data sources, Lakehouses, Notebooks, Dataflows, Datasets (semantic models), and Reports all appear as nodes with directed edges showing data flow. When something breaks — a data source changes schema and downstream items fail — the lineage view shows you immediately what's affected. Microsoft Purview extends this lineage beyond Fabric: for organisations with Purview Data Catalog, Fabric items and their lineage are automatically surfaced in the enterprise data catalog alongside on-premises and other Azure sources, giving a cross-estate view that the workspace-level lineage can't provide.

## Understanding Data Lineage

Lineage answers critical questions:
- Where did this data come from?
- What transformations were applied?
- What downstream reports depend on this data?
- What happens if I change this table?

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set
from enum import Enum
from datetime import datetime

class AssetType(Enum):
    EXTERNAL_SOURCE = "ExternalSource"
    LAKEHOUSE_TABLE = "LakehouseTable"
    WAREHOUSE_TABLE = "WarehouseTable"
    DATAFLOW = "Dataflow"
    NOTEBOOK = "Notebook"
    PIPELINE = "Pipeline"
    SEMANTIC_MODEL = "SemanticModel"
    REPORT = "Report"
    DASHBOARD = "Dashboard"

@dataclass
class LineageNode:
    id: str
    name: str
    asset_type: AssetType
    workspace: str
    metadata: Dict = field(default_factory=dict)

@dataclass
class LineageEdge:
    source_id: str
    target_id: str
    transformation_type: str  # 'direct', 'aggregation', 'join', 'filter', etc.
    column_mappings: List[Dict] = field(default_factory=list)

class LineageGraph:
    def __init__(self):
        self.nodes: Dict[str, LineageNode] = {}
        self.edges: List[LineageEdge] = []

    def add_node(self, node: LineageNode):
        self.nodes[node.id] = node

    def add_edge(self, edge: LineageEdge):
        self.edges.append(edge)

    def get_upstream(self, node_id: str, depth: int = -1) -> Set[str]:
        """Get all upstream dependencies."""
        upstream = set()
        to_process = [node_id]
        current_depth = 0

        while to_process and (depth == -1 or current_depth < depth):
            current = to_process.pop(0)
            for edge in self.edges:
                if edge.target_id == current and edge.source_id not in upstream:
                    upstream.add(edge.source_id)
                    to_process.append(edge.source_id)
            current_depth += 1

        return upstream

    def get_downstream(self, node_id: str, depth: int = -1) -> Set[str]:
        """Get all downstream dependents."""
        downstream = set()
        to_process = [node_id]
        current_depth = 0

        while to_process and (depth == -1 or current_depth < depth):
            current = to_process.pop(0)
            for edge in self.edges:
                if edge.source_id == current and edge.target_id not in downstream:
                    downstream.add(edge.target_id)
                    to_process.append(edge.target_id)
            current_depth += 1

        return downstream

    def impact_analysis(self, node_id: str) -> Dict:
        """Analyze impact of changes to a node."""
        downstream = self.get_downstream(node_id)

        impact = {
            "node": node_id,
            "downstream_count": len(downstream),
            "affected_reports": [],
            "affected_models": [],
            "affected_pipelines": []
        }

        for dep_id in downstream:
            if dep_id in self.nodes:
                node = self.nodes[dep_id]
                if node.asset_type == AssetType.REPORT:
                    impact["affected_reports"].append(node.name)
                elif node.asset_type == AssetType.SEMANTIC_MODEL:
                    impact["affected_models"].append(node.name)
                elif node.asset_type == AssetType.PIPELINE:
                    impact["affected_pipelines"].append(node.name)

        return impact
```

## Building a Lineage Example

```python
# Create a sample lineage graph
lineage = LineageGraph()

# Add nodes
lineage.add_node(LineageNode(
    id="src-sql-sales",
    name="SQL Server - Sales DB",
    asset_type=AssetType.EXTERNAL_SOURCE,
    workspace="external",
    metadata={"connection_type": "SQL Server", "server": "sales-db.company.com"}
))

lineage.add_node(LineageNode(
    id="lh-raw-sales",
    name="raw_sales_transactions",
    asset_type=AssetType.LAKEHOUSE_TABLE,
    workspace="Sales-Engineering"
))

lineage.add_node(LineageNode(
    id="nb-transform",
    name="Transform Sales Data",
    asset_type=AssetType.NOTEBOOK,
    workspace="Sales-Engineering"
))

lineage.add_node(LineageNode(
    id="lh-curated-sales",
    name="curated_sales_facts",
    asset_type=AssetType.LAKEHOUSE_TABLE,
    workspace="Sales-Engineering"
))

lineage.add_node(LineageNode(
    id="sm-sales",
    name="Sales Analytics Model",
    asset_type=AssetType.SEMANTIC_MODEL,
    workspace="Sales-Analytics"
))

lineage.add_node(LineageNode(
    id="rpt-dashboard",
    name="Sales Executive Dashboard",
    asset_type=AssetType.REPORT,
    workspace="Sales-Analytics"
))

# Add edges
lineage.add_edge(LineageEdge(
    source_id="src-sql-sales",
    target_id="lh-raw-sales",
    transformation_type="ingestion",
    column_mappings=[
        {"source": "TransactionID", "target": "transaction_id"},
        {"source": "SaleDate", "target": "sale_date"},
        {"source": "Amount", "target": "amount"}
    ]
))

lineage.add_edge(LineageEdge(
    source_id="lh-raw-sales",
    target_id="nb-transform",
    transformation_type="input"
))

lineage.add_edge(LineageEdge(
    source_id="nb-transform",
    target_id="lh-curated-sales",
    transformation_type="aggregation"
))

lineage.add_edge(LineageEdge(
    source_id="lh-curated-sales",
    target_id="sm-sales",
    transformation_type="direct"
))

lineage.add_edge(LineageEdge(
    source_id="sm-sales",
    target_id="rpt-dashboard",
    transformation_type="visualization"
))

# Analyze impact
import json
impact = lineage.impact_analysis("lh-raw-sales")
print(json.dumps(impact, indent=2))
```

## Column-Level Lineage

```python
@dataclass
class ColumnLineage:
    source_table: str
    source_column: str
    target_table: str
    target_column: str
    transformation: str  # SQL expression or description
    confidence: float = 1.0  # For automated detection

class ColumnLineageTracker:
    def __init__(self):
        self.mappings: List[ColumnLineage] = []

    def add_mapping(self, mapping: ColumnLineage):
        self.mappings.append(mapping)

    def trace_column(self, table: str, column: str) -> List[ColumnLineage]:
        """Trace a column back to its sources."""
        result = []
        to_process = [(table, column)]
        processed = set()

        while to_process:
            current_table, current_col = to_process.pop(0)
            if (current_table, current_col) in processed:
                continue
            processed.add((current_table, current_col))

            for mapping in self.mappings:
                if mapping.target_table == current_table and mapping.target_column == current_col:
                    result.append(mapping)
                    to_process.append((mapping.source_table, mapping.source_column))

        return result

    def get_derived_columns(self, table: str, column: str) -> List[ColumnLineage]:
        """Find all columns derived from a source column."""
        result = []
        to_process = [(table, column)]
        processed = set()

        while to_process:
            current_table, current_col = to_process.pop(0)
            if (current_table, current_col) in processed:
                continue
            processed.add((current_table, current_col))

            for mapping in self.mappings:
                if mapping.source_table == current_table and mapping.source_column == current_col:
                    result.append(mapping)
                    to_process.append((mapping.target_table, mapping.target_column))

        return result

# Example usage
col_lineage = ColumnLineageTracker()

col_lineage.add_mapping(ColumnLineage(
    source_table="raw_sales",
    source_column="amount",
    target_table="curated_sales",
    target_column="total_amount",
    transformation="SUM(amount)"
))

col_lineage.add_mapping(ColumnLineage(
    source_table="curated_sales",
    source_column="total_amount",
    target_table="semantic_model",
    target_column="Revenue",
    transformation="Direct mapping"
))

# Trace column origin
origin = col_lineage.trace_column("semantic_model", "Revenue")
for mapping in origin:
    print(f"{mapping.source_table}.{mapping.source_column} -> {mapping.target_table}.{mapping.target_column}")
```

## Accessing Lineage via APIs

```python
import requests
from azure.identity import DefaultAzureCredential

def get_fabric_lineage(workspace_id: str, item_id: str) -> dict:
    """Get lineage for a Fabric item via REST API."""
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    # Lineage API endpoint
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{item_id}/lineage"

    response = requests.get(url, headers=headers)
    return response.json()

# Note: Actual API endpoints may vary - check official documentation
```

## Best Practices

1. **Enable automatic lineage capture** in Fabric settings
2. **Document manual transformations** that can't be auto-detected
3. **Regular lineage reviews** during data audits
4. **Use lineage for change management** - always check impact
5. **Integrate with Purview** for enterprise-wide visibility

Tomorrow, we'll explore the deep integration between Fabric and Microsoft Purview for comprehensive data governance!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
